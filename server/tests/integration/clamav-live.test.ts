/**
 * The malware scan against a REAL clamd.
 *
 * Skipped unless `TEST_CLAMAV_HOST` is set, so the suite stays runnable with no services — the
 * scan path itself is covered everywhere else by the fake clamd in fileFixtures. Start one with
 * `docker compose --profile scan up -d clamav` (first start downloads signatures; give it a
 * minute), then:
 *
 *   TEST_CLAMAV_HOST=localhost npx vitest run tests/integration/clamav-live.test.ts
 *
 * The EICAR test signature is assembled in memory at run time rather than stored in the repo,
 * because a local antivirus quarantines it on sight. On a Windows machine with Defender on, the
 * upload's temp file may still be intercepted before clamd sees it; run this suite in CI/Linux
 * or with the storage root excluded from real-time scanning.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FileScanStatus } from '@campusconnect/types';
import {
  clearDatabase,
  connectTestDatabase,
  createTenant,
  disconnectTestDatabase,
  login,
  type LoggedIn,
} from '../helpers/testHarness.js';
import { createStudentInSection } from '../helpers/academicFixtures.js';
import { MIME, pdfBytes, uploadRequest } from '../helpers/fileFixtures.js';
import { setScannerForTesting } from '../../src/services/file.service.js';

const host = process.env.TEST_CLAMAV_HOST;
const port = Number(process.env.TEST_CLAMAV_PORT ?? 3310);

/** The standard, harmless EICAR antivirus test string — built, not stored. */
function eicar(): Buffer {
  const parts = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!', '$H+H*'];
  return Buffer.from(parts.join(''), 'ascii');
}

describe.skipIf(!host)('malware scanning against a real clamd', () => {
  let student: LoggedIn;

  beforeAll(connectTestDatabase);
  afterAll(async () => {
    setScannerForTesting(null);
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    const tenant = await createTenant();
    student = await login(
      await createStudentInSection(tenant, { localPart: 'scan', rollNo: 'C001' }),
    );
    setScannerForTesting({ enabled: true, host: host ?? 'localhost', port, timeoutMs: 30_000 });
  });

  it('passes a clean file as CLEAN', async () => {
    const response = await uploadRequest(student, pdfBytes(), 'clean.pdf', MIME.pdf);
    expect(response.status).toBe(201);
    expect(response.body.data.scanStatus).toBe(FileScanStatus.CLEAN);
  });

  it('blocks the EICAR test file', async () => {
    const response = await uploadRequest(student, eicar(), 'eicar.txt', MIME.txt);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('MALWARE_DETECTED');
  });
});
