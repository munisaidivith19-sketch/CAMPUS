/**
 * Vitest configuration for the server workspace.
 *
 * Integration and security suites run against a REAL MongoDB — the `cc-mongodb` replica set
 * from docker-compose — using a throwaway database (`campusconnect_test`) that is cleared
 * between tests. docs/deployment/TESTING.md allows either `mongodb-memory-server` or a
 * disposable container; the container is used here because it is already running for
 * development and exercises the same replica-set behaviour (and therefore transactions) that
 * production uses, rather than a different embedded build.
 *
 * `fileParallelism: false` keeps suites from racing on that shared database.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // The cross-cutting security suites live at the repo root (docs/deployment/TESTING.md).
    include: ['tests/**/*.test.ts', '../tests/security/**/*.test.ts'],
    setupFiles: ['tests/setup/testEnv.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    restoreMocks: true,
  },
});
