# ADR 0004: Argon2id for password hashing

- **Status:** Accepted
- **Date:** 2026-09-22

## Context

Passwords must be stored irreversibly with a modern, memory-hard algorithm resistant to GPU/ASIC
cracking. The build rules mandate Argon2id and forbid inventing cryptography.

## Decision

Hash passwords with **Argon2id** via the maintained `argon2` library. Tuning parameters
(`ARGON2_MEMORY_COST`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM`) are environment-configurable so
they can be raised as hardware improves. Plaintext passwords are never stored or logged; password
reset tokens, OTPs, private keys, and session secrets are never logged.

## Consequences

- **Positive:** current best-practice memory-hard hashing; per-hash salt handled by the library;
  tunable cost.
- **Negative / accepted:** higher CPU/memory per login than bcrypt; acceptable and desirable
  (that cost is the point). Defaults chosen to balance security and interactive login latency.

## Alternatives considered

- **bcrypt:** widely used but not memory-hard and has a 72-byte input limit. **scrypt:** viable
  but Argon2id is the current recommendation and is mandated here. Rejected.
