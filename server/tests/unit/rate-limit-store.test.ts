/**
 * The rate-limit store's degradation behaviour.
 *
 * No live Redis here, by design: the interesting cases are the ones where Redis is broken, and
 * those are easier to produce with a fake than with a real server. What matters is that a broken
 * store never rejects a request (fail open) and never stops counting (the in-process floor).
 */
import express from 'express';
import supertest from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { rateLimit, type IncrementResponse, type Options, type Store } from 'express-rate-limit';
import { ResilientStore } from '../../src/middleware/rateLimit.middleware.js';

const WINDOW_MS = 60_000;

function initialised(primary: Store | null): ResilientStore {
  const store = new ResilientStore(primary);
  store.init({ windowMs: WINDOW_MS } as Options);
  return store;
}

/** A primary store that works. */
function workingPrimary(): Store & { hits: number } {
  const stub = {
    hits: 0,
    init: () => undefined,
    increment: async (): Promise<IncrementResponse> => {
      stub.hits += 1;
      return { totalHits: stub.hits, resetTime: new Date(Date.now() + WINDOW_MS) };
    },
    decrement: async () => undefined,
    resetKey: async () => undefined,
    get: async () => ({ totalHits: stub.hits, resetTime: undefined }),
  };
  return stub;
}

/** A primary store that is down. */
function brokenPrimary(): Store {
  const fail = async (): Promise<never> => {
    throw new Error('ECONNREFUSED 127.0.0.1:6379');
  };
  return {
    init: () => undefined,
    increment: fail,
    decrement: fail,
    resetKey: fail,
    get: fail,
  };
}

describe('ResilientStore', () => {
  it('uses the shared store when it is healthy', async () => {
    const primary = workingPrimary();
    const store = initialised(primary);

    expect((await store.increment('a')).totalHits).toBe(1);
    expect((await store.increment('a')).totalHits).toBe(2);
    // Counting happened in the shared store, which is what makes the limit hold across instances.
    expect(primary.hits).toBe(2);
  });

  it('keeps counting in process when the shared store is down', async () => {
    const store = initialised(brokenPrimary());

    expect((await store.increment('a')).totalHits).toBe(1);
    expect((await store.increment('a')).totalHits).toBe(2);
    expect((await store.increment('b')).totalHits).toBe(1);
  });

  it('counts locally when Redis is NOT CONFIGURED at all', async () => {
    const store = initialised(null);
    expect((await store.increment('a')).totalHits).toBe(1);
    expect((await store.increment('a')).totalHits).toBe(2);
  });

  it('does not propagate a broken store out of any operation', async () => {
    const store = initialised(brokenPrimary());
    await expect(store.increment('a')).resolves.toBeDefined();
    await expect(store.decrement('a')).resolves.toBeUndefined();
    await expect(store.resetKey('a')).resolves.toBeUndefined();
    // `get` on an unknown key is legitimately undefined; what matters is that it resolves.
    await expect(store.get('a')).resolves.toBeUndefined();
  });

  it('declares its keys as its own, so limiters are not confused for one another', () => {
    // express-rate-limit identifies a store without this by class name, and then reports a
    // spurious double count when one request passes the global limiter and a per-route one.
    expect(new ResilientStore(null).localKeys).toBe(true);
  });

  it('resets only the local counter', async () => {
    const primary = workingPrimary();
    const resetAll = vi.fn();
    const store = initialised({ ...primary, resetAll } as Store);

    await store.resetAll();
    // Clearing a shared namespace from one instance would wipe every other instance's limits.
    expect(resetAll).not.toHaveBeenCalled();
  });
});

describe('a limiter backed by a broken store', () => {
  /** Mount one limiter on a bare app so the assertion is about the middleware, not the API. */
  function appWith(store: Store, limit: number): supertest.Agent {
    const app = express();
    app.use(rateLimit({ windowMs: WINDOW_MS, limit, store, legacyHeaders: false }));
    app.get('/ping', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    return supertest.agent(app);
  }

  it('lets requests through rather than locking everyone out', async () => {
    const client = appWith(new ResilientStore(brokenPrimary()), 5);

    // Fail OPEN: a Redis outage must not turn into an authentication outage.
    for (let i = 0; i < 3; i += 1) {
      expect((await client.get('/ping')).status).toBe(200);
    }
  });

  it('still enforces the limit per instance while degraded', async () => {
    const client = appWith(new ResilientStore(brokenPrimary()), 2);

    expect((await client.get('/ping')).status).toBe(200);
    expect((await client.get('/ping')).status).toBe(200);
    // Failing open is not the same as giving up: the in-process floor still holds.
    expect((await client.get('/ping')).status).toBe(429);
  });
});
