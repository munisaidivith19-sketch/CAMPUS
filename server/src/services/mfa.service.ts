/**
 * Multi-factor authentication.
 *
 * Two factors, for two different jobs:
 *  - **TOTP** (RFC 6238, via the maintained `otplib`): an opt-in second factor the user enrolls
 *    once. The seed is stored AES-256-GCM-encrypted, and enrollment only counts once the user
 *    proves their authenticator produces a valid code — so a half-finished enrollment can never
 *    lock someone out.
 *  - **Emailed OTP**: not a second factor by choice but a challenge for a device we have not
 *    seen before. Single-use, 10-minute, attempt-capped.
 *
 * No code path here logs a secret, a seed, or a code.
 */
import { generate, generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { AuditAction, AuditResult, MfaType, type MfaEnrollDTO } from '@campusconnect/types';
import { mfaRepository } from '../repositories/mfa.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import type { IdLike } from '../repositories/base.repository.js';
import { decryptSecret, encryptSecret, generateNumericCode, safeEqual, sha256 } from '../utils/crypto.js';
import { Errors } from '../utils/errors.js';
import { sendDeviceOtpEmail } from './email.service.js';
import { verifyPassword } from './password.service.js';
import { recordAudit, type AuditContext } from './audit.service.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const TOTP_ISSUER = 'CampusConnect';

export interface TotpEnrollment {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}

/**
 * Begin (or restart) TOTP enrollment. The plaintext seed is returned exactly once, here, so the
 * user can store it in their authenticator; afterwards only the encrypted copy exists.
 */
export async function beginTotpEnrollment(
  institutionId: IdLike,
  userId: IdLike,
  email: string,
): Promise<TotpEnrollment> {
  const secret = generateSecret();
  await mfaRepository.upsertTotp(institutionId, userId, encryptSecret(secret));

  const otpauthUri = generateURI({ issuer: TOTP_ISSUER, label: email, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauthUri);
  return { secret, otpauthUri, qrDataUrl };
}

/** Confirm enrollment by checking a code the authenticator just produced. */
export async function confirmTotpEnrollment(
  institutionId: IdLike,
  userId: IdLike,
  code: string,
): Promise<boolean> {
  const factor = await mfaRepository.findTotp(institutionId, userId, true);
  if (!factor?.secretEnc) return false;

  const valid = await verifyTotpCode(factor.secretEnc, code);
  if (!valid) return false;

  await mfaRepository.markTotpVerified(institutionId, userId);
  return true;
}

/** Verify a login-time TOTP code against the user's confirmed factor. */
export async function verifyUserTotp(
  institutionId: IdLike,
  userId: IdLike,
  code: string,
): Promise<boolean> {
  const factor = await mfaRepository.findTotp(institutionId, userId, true);
  if (!factor?.secretEnc || !factor.verifiedAt) return false;
  return verifyTotpCode(factor.secretEnc, code);
}

async function verifyTotpCode(secretEnc: string, code: string): Promise<boolean> {
  try {
    const secret = decryptSecret(secretEnc);
    // One step of tolerance either side absorbs clock skew without widening the window much.
    const result = await verify({ secret, token: code, epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}

export async function hasConfirmedTotp(institutionId: IdLike, userId: IdLike): Promise<boolean> {
  const factor = await mfaRepository.findTotp(institutionId, userId);
  return Boolean(factor?.verifiedAt);
}

export async function disableTotp(institutionId: IdLike, userId: IdLike): Promise<void> {
  await mfaRepository.deleteTotp(institutionId, userId);
}

/** Generate a current TOTP code for a secret — used by tests and the seed, never by a route. */
export async function generateTotpCode(secret: string): Promise<string> {
  return generate({ secret });
}

/**
 * Issue and email a one-time code for new-device verification. Only the code's hash is stored;
 * the plaintext exists just long enough to be put in the email.
 */
export async function issueDeviceOtp(
  institutionId: IdLike,
  userId: IdLike,
  email: string,
  fullName: string,
): Promise<void> {
  const code = generateNumericCode(6);
  await mfaRepository.createOtpChallenge({
    institutionId,
    userId,
    codeHash: sha256(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  await sendDeviceOtpEmail(email, fullName, code);
}

export type OtpVerification = 'VALID' | 'INVALID' | 'TOO_MANY_ATTEMPTS' | 'NO_CHALLENGE';

/** Verify an emailed OTP. Attempts are capped so the 6-digit space can't be walked. */
export async function verifyDeviceOtp(
  institutionId: IdLike,
  userId: IdLike,
  code: string,
): Promise<OtpVerification> {
  const challenge = await mfaRepository.findActiveOtp(institutionId, userId);
  if (!challenge?.codeHash) return 'NO_CHALLENGE';

  if (challenge.attempts >= MAX_OTP_ATTEMPTS) return 'TOO_MANY_ATTEMPTS';

  if (!safeEqual(challenge.codeHash, sha256(code))) {
    const attempts = await mfaRepository.incrementOtpAttempts(challenge._id);
    return attempts >= MAX_OTP_ATTEMPTS ? 'TOO_MANY_ATTEMPTS' : 'INVALID';
  }

  // Atomic claim: a race can only let one request consume the challenge.
  const consumed = await mfaRepository.consumeOtp(challenge._id);
  return consumed ? 'VALID' : 'INVALID';
}

// --- Enrollment management (the /me/mfa endpoints) ---------------------------

/**
 * Start enrollment. `mfaEnabled` is deliberately NOT set here: the flag flips only once a code
 * has been confirmed, so abandoning this step cannot lock the user out of their own account.
 */
export async function enrollUserTotp(
  institutionId: IdLike,
  userId: IdLike,
  email: string,
): Promise<MfaEnrollDTO> {
  const enrollment = await beginTotpEnrollment(institutionId, userId, email);
  return {
    secret: enrollment.secret,
    otpauthUri: enrollment.otpauthUri,
    qrDataUrl: enrollment.qrDataUrl,
  };
}

export async function confirmUserTotp(
  institutionId: IdLike,
  userId: IdLike,
  code: string,
  context: AuditContext,
): Promise<void> {
  if (!(await confirmTotpEnrollment(institutionId, userId, code))) {
    throw Errors.authInvalid('That code is not valid. Check your authenticator and try again.');
  }

  await userRepository.setMfaEnabled(institutionId, userId, true);
  await recordAudit({
    institutionId,
    actorUserId: userId,
    action: AuditAction.MFA_ENROLLED,
    resourceType: 'MFA',
    resourceId: String(userId),
    result: AuditResult.SUCCESS,
    context,
  });
}

/** Turning MFA off is a sensitive downgrade, so it re-confirms the password first. */
export async function disableUserTotp(
  institutionId: IdLike,
  userId: IdLike,
  password: string,
  context: AuditContext,
): Promise<void> {
  const user = await userRepository.findByIdWithPassword(institutionId, userId);
  if (!user) throw Errors.notFound();

  if (!(await verifyPassword(user.passwordHash, password))) {
    await recordAudit({
      institutionId,
      actorUserId: userId,
      action: AuditAction.MFA_DISABLED,
      resourceType: 'MFA',
      resourceId: String(userId),
      result: AuditResult.DENIED,
      context,
      reason: 'PASSWORD_RECONFIRMATION_FAILED',
    });
    throw Errors.authInvalid();
  }

  await disableTotp(institutionId, userId);
  await userRepository.setMfaEnabled(institutionId, userId, false);

  await recordAudit({
    institutionId,
    actorUserId: userId,
    action: AuditAction.MFA_DISABLED,
    resourceType: 'MFA',
    resourceId: String(userId),
    result: AuditResult.SUCCESS,
    context,
  });
}

export { MfaType };
