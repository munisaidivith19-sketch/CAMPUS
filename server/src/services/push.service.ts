/**
 * Push delivery.
 *
 * **NOT CONFIGURED by default.** `PUSH_PROVIDER=none` is the shipped setting, and in that state
 * this module contacts nothing and reports `SKIPPED` — a degraded, expected outcome, not a
 * failure to chase. The same is true for a user with no registered device. Only a provider that
 * was asked to send and could not counts as `FAILED`.
 *
 * The provider is behind a swappable function so tests can substitute a fake; no test ever
 * reaches a live push service.
 */
import { DeliveryStatus } from '@campusconnect/types';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  /** Relative in-app path the client should open. Never an external URL. */
  link?: string | null;
}

export interface PushResult {
  status: typeof DeliveryStatus.SENT | typeof DeliveryStatus.SKIPPED | typeof DeliveryStatus.FAILED;
  reason?: string;
}

export type PushSender = (message: PushMessage) => Promise<PushResult>;

/** The Expo driver. Kept small: one POST, no SDK, no credentials required for basic use. */
const expoSender: PushSender = async (message) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // The access token is optional for Expo; when present it is read from env, never hardcoded.
  if (config.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${config.EXPO_ACCESS_TOKEN}`;

  const response = await fetch(config.PUSH_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      message.tokens.map((to) => ({
        to,
        title: message.title,
        body: message.body,
        data: message.link ? { link: message.link } : undefined,
      })),
    ),
    // A slow provider must not hold a delivery worker indefinitely.
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    return { status: DeliveryStatus.FAILED, reason: `provider responded ${response.status}` };
  }
  return { status: DeliveryStatus.SENT };
};

const noopSender: PushSender = async () => ({
  status: DeliveryStatus.SKIPPED,
  reason: 'PUSH_PROVIDER=none (NOT CONFIGURED)',
});

let sender: PushSender = config.PUSH_PROVIDER === 'expo' ? expoSender : noopSender;

/** Swap the provider. Used by tests to avoid contacting anything real. */
export function setPushSender(next: PushSender): void {
  sender = next;
}

export function resetPushSender(): void {
  sender = config.PUSH_PROVIDER === 'expo' ? expoSender : noopSender;
}

export async function sendPush(message: PushMessage): Promise<PushResult> {
  // No device registered is a normal state for a user who has never opened the app.
  if (message.tokens.length === 0) {
    return { status: DeliveryStatus.SKIPPED, reason: 'no registered devices' };
  }

  try {
    return await sender(message);
  } catch (err) {
    // Never let a provider problem escape as an exception — the caller records and moves on.
    const reason = err instanceof Error ? err.message : 'unknown push error';
    logger.warn({ err }, 'Push provider threw');
    return { status: DeliveryStatus.FAILED, reason: reason.slice(0, 200) };
  }
}
