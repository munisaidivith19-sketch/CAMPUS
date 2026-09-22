/**
 * Secure QR issue + verify.
 *
 * The QR encodes ONE thing: a 32-byte random token. No name, no roll number, no user id, no
 * signed claims — nothing that stays true after the code is photographed (SECURITY.md §10).
 * Identity is resolved server-side from the stored hash, which is what makes the code
 * revocable, expirable and single-use.
 *
 * Verification is deliberately tenant-checked as "not found": a guard at institution A
 * scanning institution B's card learns only that the code is not valid here, never that it
 * exists elsewhere.
 */
import QRCode from 'qrcode';
import {
  AuditAction,
  AuditResult,
  QRPurpose,
  type QRIssueDTO,
  type QRVerifyDTO,
} from '@campusconnect/types';
import { qrTokenRepository } from '../repositories/qrToken.repository.js';
import { studentProfileRepository } from '../repositories/profile.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import type { IdLike } from '../repositories/base.repository.js';
import { generateOpaqueToken, sha256 } from '../utils/crypto.js';
import { recordAudit, type AuditContext } from './audit.service.js';
import { Errors } from '../utils/errors.js';

/** Short by design: a student ID QR is shown and scanned within seconds, not stored. */
const QR_TTL_MS = 2 * 60 * 1000;

export async function issueQrToken(
  institutionId: IdLike,
  subjectUserId: IdLike,
  issuedByUserId: IdLike,
  purpose: QRPurpose,
  context: AuditContext,
): Promise<QRIssueDTO> {
  // Showing a new code invalidates the previous one, so only the code on screen can be scanned.
  await qrTokenRepository.revokeActiveForSubject(institutionId, subjectUserId, purpose);

  const token = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + QR_TTL_MS);

  await qrTokenRepository.create({
    institutionId,
    subjectUserId,
    purpose,
    tokenHash: sha256(token),
    singleUse: true,
    expiresAt,
    issuedByUserId,
  });

  await recordAudit({
    institutionId,
    actorUserId: issuedByUserId,
    action: AuditAction.QR_TOKEN_ISSUED,
    resourceType: 'QRToken',
    resourceId: null,
    result: AuditResult.SUCCESS,
    context,
    reason: purpose,
  });

  return {
    token,
    purpose,
    expiresAt: expiresAt.toISOString(),
    qrDataUrl: await QRCode.toDataURL(token),
  };
}

/**
 * Verify a scanned code. `verifierInstitutionId` is the SCANNER's tenant, taken from their
 * authenticated principal — never from the payload.
 */
export async function verifyQrToken(
  verifierInstitutionId: string,
  verifierUserId: IdLike,
  token: string,
  context: AuditContext,
): Promise<QRVerifyDTO> {
  const record = await qrTokenRepository.findRedeemableByTokenHash(sha256(token));

  const reject = async (reason: string): Promise<never> => {
    await recordAudit({
      institutionId: verifierInstitutionId,
      actorUserId: verifierUserId,
      action: AuditAction.QR_TOKEN_REJECTED,
      resourceType: 'QRToken',
      resourceId: record ? String(record._id) : null,
      result: AuditResult.DENIED,
      context,
      reason,
    });
    throw Errors.notFound();
  };

  if (!record) return reject('UNKNOWN_OR_EXPIRED');
  // Cross-tenant scan: indistinguishable from an unknown code, by design.
  if (String(record.institutionId) !== verifierInstitutionId) return reject('TENANT_MISMATCH');
  if (record.singleUse && !(await qrTokenRepository.markUsed(record._id))) {
    return reject('ALREADY_USED');
  }

  const [user, profile] = await Promise.all([
    userRepository.findById(verifierInstitutionId, record.subjectUserId),
    studentProfileRepository.findByUserId(verifierInstitutionId, record.subjectUserId),
  ]);
  if (!user) return reject('SUBJECT_MISSING');

  await recordAudit({
    institutionId: verifierInstitutionId,
    actorUserId: verifierUserId,
    action: AuditAction.QR_TOKEN_VERIFIED,
    resourceType: 'QRToken',
    resourceId: String(record._id),
    result: AuditResult.SUCCESS,
    context,
    reason: record.purpose,
  });

  return {
    valid: true,
    purpose: record.purpose,
    subject: {
      userId: String(user._id),
      fullName: user.fullName,
      rollNo: profile?.rollNo ?? null,
      primaryRole: user.primaryRole,
    },
    verifiedAt: new Date().toISOString(),
  };
}

export { QRPurpose };
