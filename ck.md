Phase 3 Part C-1 is complete and verified.

1. Delivery-details visibility (Step 0.2) — already own-row, structurally
A notification is one row per recipient (notificationRepository.createMany writes a document each), so deliveries on a row only ever holds that recipient's outcomes. There is no per-recipient breakdown anywhere in the code, and the only read path filters on recipientUserId from the principal. Nothing needed scoping.

Tests added anyway, in notification-durability.test.ts: a student sees exactly two delivery records (their own EMAIL + PUSH) and not a peer's — with the peer deliberately given a registered device and a failing provider so their outcomes differ visibly — and the announcement payload carries no delivery data at all.

2. Queue mechanism
Claim: pending LIST + inflight ZSET scored by a visibility deadline. One Lua script does RPOP → ZADD deadline, falling back to the oldest item whose deadline has passed. Pop and reserve are one atomic step, so two instances cannot hold the same item. Ack is ZREM.
Restart recovery: the queue lives in Redis, not the process. Anything still in pending is claimed normally; anything a dead worker held becomes re-claimable after VISIBILITY_MS (120 s). startDeliveryWorker() drains once at boot, then polls (NOTIFICATION_DELIVERY_POLL_MS, default 5 s).
Idempotency: a channel is claimed in MongoDB before the first attempt — a PENDING record pushed under a 'deliveries.channel': {$ne: channel} filter. Losing that race means someone already sent. A PENDING record older than 5 minutes (its worker died) is finalised FAILED / "interrupted before the outcome was known; not retried to avoid a duplicate send" — we cannot know whether the provider accepted it, and a duplicate email is worse than a recorded miss.
Redis down at enqueue: fail open, matching the rate limiter. The item goes to the in-process queue, delivery still happens on that instance, the lost durability is logged and exposed via isDeliveryQueueDegraded(). The in-app row is written before anything is queued and is never at risk.
3. What changed vs Part B, and the doc
enqueueDelivery now writes to the queue module instead of an array; drain claims/acks instead of shifting; outcome writes became claim-then-finalise. The architecture doc's in-process limitation note is replaced with the durable design plus the degraded mode. docs/deployment/TESTING.md gained the floor and optional-services sections.

4. Tests — 361 (floor raised 341 → 361), 5 consecutive clean runs
356 passed + 5 skipped; typecheck, server lint, web lint, web build, tsc build all clean. The 5 skipped are the live-Redis file, gated on TEST_REDIS_URL; I ran it against real Redis and all 5 pass, including 10 workers racing for one item and two workers draining 20 items with zero duplicates. maxSkipped now stops skipped tests from meeting the floor.

Three real bugs, all caught by running things, not by the suite:

First enqueue after boot always degraded — with the offline queue disabled, the first command loses the connect race against a perfectly healthy Redis. Now waits out the handshake once. My first fix waited on every task, which made a Redis outage crawl (2 of 13 emails in 6 s); bounded to the first command, the same outage delivers 13 of 13 in under 6 s.
Spurious ERR_ERL_DOUBLE_COUNT from Part B: express-rate-limit identifies a store by class name unless it sets localKeys, so all five limiters looked like one store. Committed separately; no limit or policy changed.
npm start has never worked — pre-existing, unrelated to this work, flagged not fixed (below).
5. Live verification (real Redis + Mailpit)
Restart: a process queued work and exited without draining → item sat in cc:dq:pending; a different running instance claimed and delivered it. Exactly one email.
Kill mid-flight: instance killed with -9 while holding a claimed item (push hanging). Item survived in inflight; EMAIL: SENT, PUSH: PENDING. Restarted, rewound the deadline → reclaimed and acked, 13 emails still 13, no resend. Aged the PENDING record past 5 min → finalised FAILED / interrupted…, still 13.
Two instances: 20 items queued while both polled → 20 emails, 20 distinct, zero duplicates, queue empty.
Redis down at enqueue: publish 201, in-app row intact (EMAIL=SENT, PUSH=SKIPPED), all 13 delivered on the degraded path, one warning logged. Redis restored → next publish went through Redis normally, queue drained to 0.
Dead provider port: PUSH: FAILED, attempts 3, "fetch failed", EMAIL: SENT, notification intact.
Tenant audience: college-wide publish → 13 recipients, zero outside @jnn.edu.in; a live foreign student's id → 404.
Part A/B invariants: identical 202 RESET_EMAIL_SENT for known and unknown email; cross-tenant → 404; attendance 94/101 = 93.07% (SUM/SUM).
Binaries: seed ✅, dev/tsx src/index.ts ✅ (logs backend: "redis"), start ✗.
6. npm start is broken — flagged, not fixed
Two causes, both predating Part B/C: the shared packages export raw TypeScript ("main": "./src/index.ts", no build step), so compiled output can't resolve them (ERR_MODULE_NOT_FOUND on packages/validation/src/common.js); and because tsc pulls those packages in, the server entry emits to dist/server/src/index.js, not the dist/index.js that package.json points at. Fixing it means giving each package a real build and exports map — a build-system increment, outside "delivery-queue durability", so I left it alone rather than quietly widening scope. dev and seed are unaffected.

7. Commits and tree
e3737ac durable queue · fb3ab69 rate-limiter store identity · b7b8916 floor 361 + maxSkipped. Working tree clean apart from your own ck.md edit and the untracked playground-1.mongodb.js.

8. Deferred
The npm start packaging fix; secure chat; file sharing; realtime/Socket.IO; moderation-queue UI; E2E tests; multi-tenant registration (Phase 5). No guardrail path was changed — enumeration, cross-tenant 404, attendance math and the limiter's fail-open decision were only re-verified. 