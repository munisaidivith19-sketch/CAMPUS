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
    /**
     * One worker, reused for every file.
     *
     * Suites already run sequentially (`fileParallelism: false`) because they share one test
     * database, so a worker per file bought nothing — and churning workers was costing us runs:
     * one would intermittently die with "Worker exited unexpectedly", taking that file's tests
     * out of the run while vitest still printed a green summary with a smaller total. A pass
     * that quietly covered less than it claims is worse than a failure.
     *
     * `dangerouslyIgnoreUnhandledErrors: false` is belt-and-braces: if a worker ever does die,
     * the run fails loudly instead of under-reporting.
     */
    poolOptions: { threads: { singleThread: true } },
    dangerouslyIgnoreUnhandledErrors: false,
    // The cross-cutting security suites live at the repo root (docs/deployment/TESTING.md).
    include: ['tests/**/*.test.ts', '../tests/security/**/*.test.ts'],
    setupFiles: ['tests/setup/testEnv.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    restoreMocks: true,
  },
});
