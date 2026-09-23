#!/usr/bin/env node
/**
 * Enforce a minimum test count on the suite.
 *
 * WHY THIS EXISTS: a vitest worker that dies takes its file's tests out of the run, and vitest
 * still exits 0 and prints a green summary — just with a smaller total. We hit exactly that
 * (309/320, 312/320, 303/320 across runs) and it looked like a pass. A green run that quietly
 * covered less than it claims is worse than a red one, because nobody investigates green.
 *
 * Reusing one worker fixed the cause, but "it has been stable for N runs" is not a guarantee
 * against regression — a hard floor is. This turns any silent shrinkage into a failed build.
 *
 * Usage: node scripts/check-test-floor.mjs <path-to-vitest-json-report>
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const floorFile = resolve(scriptDir, '../tests/test-count-floor.json');

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('check-test-floor: expected a path to the vitest JSON report');
  process.exit(2);
}

function fail(message) {
  console.error(`\n  ✖ TEST COUNT FLOOR: ${message}\n`);
  process.exit(1);
}

let floor;
let maxSkipped = 0;
try {
  const config = JSON.parse(readFileSync(floorFile, 'utf8'));
  floor = config.floor;
  maxSkipped = config.maxSkipped ?? 0;
} catch (err) {
  fail(`could not read the floor from ${floorFile} (${err.message})`);
}

if (typeof floor !== 'number' || !Number.isFinite(floor)) {
  fail(`the floor in ${floorFile} is not a number`);
}

let report;
try {
  report = JSON.parse(readFileSync(resolve(process.cwd(), reportPath), 'utf8'));
} catch (err) {
  // No report means the run did not get far enough to write one — that is a failure too,
  // not something to shrug at.
  fail(`could not read the vitest report at ${reportPath} (${err.message})`);
}

const total = report.numTotalTests ?? 0;
const passed = report.numPassedTests ?? 0;
const failed = report.numFailedTests ?? 0;

if (failed > 0) {
  // vitest already failed the run; say so rather than reporting a confusing floor error.
  fail(`${failed} test(s) failed`);
}

if (total < floor) {
  fail(
    `the suite reported ${total} tests but the floor is ${floor}.\n` +
      `    ${floor - total} test(s) did not run. This usually means a worker died and took a\n` +
      `    whole file with it — check the run output for "Worker exited unexpectedly".\n` +
      `    If you deliberately removed tests, lower the floor in tests/test-count-floor.json\n` +
      `    and say why in the commit message.`,
  );
}

// The total counts skipped tests, so without this the floor could be met by tests that never
// ran. Only the deliberately environment-gated ones are allowed to be skipped.
const skipped = report.numPendingTests ?? 0;
if (skipped > maxSkipped) {
  fail(
    `${skipped} test(s) were skipped but only ${maxSkipped} may be.
` +
      `    Skipped tests still count toward the total, so this would otherwise hide a shrinking
` +
      `    suite. Un-skip them, or raise maxSkipped in tests/test-count-floor.json and say why.`,
  );
}

console.log(
  `  ✓ test count ${passed}/${total} is at or above the floor of ${floor}` +
    (skipped ? ` (${skipped} skipped, ${maxSkipped} allowed)` : ''),
);
