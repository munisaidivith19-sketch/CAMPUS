/**
 * Authentication: registration, email verification, login (with MFA and new-device gates),
 * refresh, logout, and password reset.
 *
 * Recurring principles in this file:
 *  - **Generic responses on public entry points.** Register and forgot-password behave
 *    identically whether or not the account exists, so neither can be used to enumerate who
 *    holds an account at the institution. Once a caller has *proved* the password, specific
 *    feedback (e.g. "email not verified") is safe and is given, because it leaks nothing they
 *    could not already confirm.
 *  - **Every attempt is recorded.** LoginHistory captures success and failure with a coarse
 *    reason; AuditLog captures the security-relevant events. Neither ever receives a password,
 *    code, or token.
 *  - **Fail closed.** Anything unexpected results in the generic invalid-credentials error.
 */
import type {
  DeviceVerifyInput,
  LoginInput,
  MfaVerifyInput,
  RegisterInput,
} from '@campusconnect/validation';
import {
  AuditAction,
  AuditResult,
  LoginFailureReason,
  LoginResult,
  Role,
  UserStatus,
  type UserDTO,
} from '@campusconnect/types';
import { config } from '../config/env.js';
import type { UserDocument } from '../models/User.model.js';
import { userRepository } from '../repositories/user.repository.js';
import { institutionRepository } from '../repositories/institution.repository.js';
import { loginHistoryRepository } from '../repositories/loginHistory.repository.js';
import { passwordResetRepository } from '../repositories/passwordReset.repository.js';
import { sessionRepository } from '../repositories/session.repository.js';
import { generateOpaqueToken, sha256 } from '../utils/crypto.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { RequestContext } from '../utils/requestContext.js';
import { hashPassword, needsRehash, verifyPassword } from './password.service.js';
import {
  ChallengePurpose,
  accessTokenTtlSeconds,
  signAccessToken,
  signChallengeToken,
  verifyChallengeToken,
} from './token.service.js';
import { createSession, rotateSession } from './session.service.js';
import { hasConfirmedTotp, issueDeviceOtp, verifyDeviceOtp, verifyUserTotp } from './mfa.service.js';
import {
  sendAccountExistsEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from './email.service.js';
import { recordAudit } from './audit.service.js';
import { toUserDTO } from './user.service.js';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const MAX_RESETS_PER_WINDOW = 3;
const RESET_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface AuthResult {
  user: UserDTO;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  sessionId: string;
}

export type LoginOutcome =
  | { status: 'AUTHENTICATED'; auth: AuthResult }
  | { status: 'MFA_REQUIRED'; challengeId: string }
  | { status: 'DEVICE_VERIFICATION_REQUIRED'; challengeId: string };

function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/**
 * A throwaway Argon2id hash used to equalize timing when the email does not exist, so response
 * time cannot be used to tell "no such user" from "wrong password". Computed once, lazily.
 */
let decoyHash: string | null = null;
async function burnPasswordTime(candidate: string): Promise<void> {
  decoyHash ??= await hashPassword('decoy-password-for-timing-equalization');
  await verifyPassword(decoyHash, candidate);
}

/**
 * Registration.
 *
 * Self-service signup is restricted to the deployment's institution domain
 * (COLLEGE_EMAIL_DOMAIN) and grants the STUDENT role only — staff accounts are provisioned by
 * an administrator, never claimed by whoever signs up first. Other onboarded institutions
 * (which log in normally) receive their users through provisioning/seed rather than this route.
 *
 * PHASE 5 (SaaS multi-tenancy): this single-domain check must become a lookup that resolves the
 * Institution by matching the email domain against the `Institution.domains` registry — exactly
 * as `login` already does — treating COLLEGE_EMAIL_DOMAIN as nothing more than the *primary*
 * institution's seed domain. Until then self-registration is deliberately single-tenant; see
 * docs/architecture/06-multi-tenancy.md. Do not change the resolution logic before that phase.
 */
export async function register(input: RegisterInput, context: RequestContext): Promise<void> {
  const domain = emailDomain(input.email);

  // Backend enforcement of the institution domain. The frontend check is UX only.
  if (domain !== config.COLLEGE_EMAIL_DOMAIN.toLowerCase()) {
    throw Errors.validation([
      { path: 'email', message: `Registration is limited to @${config.COLLEGE_EMAIL_DOMAIN} addresses.` },
    ]);
  }

  const institution = await institutionRepository.findByDomain(domain);
  if (!institution) {
    // Configuration problem, not a user error: the domain is allowed but no tenant is onboarded.
    logger.error({ domain }, 'No institution onboarded for the configured COLLEGE_EMAIL_DOMAIN');
    throw Errors.internal();
  }

  const institutionId = String(institution._id);
  const existing = await userRepository.findByEmail(institutionId, input.email);

  if (existing) {
    // Enumeration-resistant: the caller gets the same response as a fresh signup, and no new
    // verification token is minted for an account that already exists. The real mailbox owner
    // is told what happened out-of-band, which the requester cannot observe.
    logger.info({ institutionId }, 'Registration attempted for an existing account');
    await sendAccountExistsEmail(existing.email, existing.fullName);
    return;
  }

  const verificationToken = generateOpaqueToken(32);
  const user = await userRepository.create({
    institutionId,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    fullName: input.fullName,
    status: UserStatus.PENDING_VERIFICATION,
    roles: [Role.STUDENT],
    primaryRole: Role.STUDENT,
    emailVerificationTokenHash: sha256(verificationToken),
    emailVerificationExpiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
  });

  await recordAudit({
    institutionId,
    actorUserId: user._id,
    action: AuditAction.USER_REGISTERED,
    resourceType: 'User',
    resourceId: String(user._id),
    result: AuditResult.SUCCESS,
    context,
  });

  await sendVerificationEmail(input.email, input.fullName, verificationToken);
}

export async function verifyEmail(token: string, context: RequestContext): Promise<void> {
  const user = await userRepository.findByVerificationTokenHash(sha256(token));
  if (!user) throw Errors.authInvalid('This verification link is invalid or has expired.');

  const institutionId = String(user.institutionId);
  await userRepository.markEmailVerified(institutionId, user._id, UserStatus.ACTIVE);

  await recordAudit({
    institutionId,
    actorUserId: user._id,
    action: AuditAction.EMAIL_VERIFIED,
    resourceType: 'User',
    resourceId: String(user._id),
    result: AuditResult.SUCCESS,
    context,
  });
}

async function recordLoginFailure(
  user: UserDocument,
  context: RequestContext,
  reason: LoginFailureReason,
): Promise<void> {
  const institutionId = String(user.institutionId);
  await loginHistoryRepository.record({
    institutionId,
    userId: user._id,
    ip: context.ip,
    device: context.device,
    userAgent: context.userAgent,
    result: LoginResult.FAILURE,
    reason,
  });
  await recordAudit({
    institutionId,
    actorUserId: user._id,
    action: AuditAction.LOGIN_FAILED,
    resourceType: 'User',
    resourceId: String(user._id),
    result: AuditResult.FAILURE,
    context,
    reason,
  });
}

/** Issue the session + tokens once every gate has been passed. */
async function completeLogin(user: UserDocument, context: RequestContext): Promise<AuthResult> {
  const institutionId = String(user.institutionId);

  const { session, refreshToken } = await createSession(institutionId, user._id, context);
  await userRepository.recordSuccessfulLogin(institutionId, user._id, context.fingerprint);

  await loginHistoryRepository.record({
    institutionId,
    userId: user._id,
    ip: context.ip,
    device: context.device,
    userAgent: context.userAgent,
    result: LoginResult.SUCCESS,
  });

  await recordAudit({
    institutionId,
    actorUserId: user._id,
    action: AuditAction.LOGIN_SUCCEEDED,
    resourceType: 'Session',
    resourceId: String(session._id),
    result: AuditResult.SUCCESS,
    context,
  });

  const accessToken = signAccessToken({
    sub: String(user._id),
    iid: institutionId,
    sid: String(session._id),
    roles: [...user.roles],
  });

  // Re-read so the DTO reflects lastLoginAt written a moment ago.
  const fresh = (await userRepository.findById(institutionId, user._id)) ?? user;

  return {
    user: await toUserDTO(fresh),
    accessToken,
    expiresIn: accessTokenTtlSeconds(),
    refreshToken,
    sessionId: String(session._id),
  };
}

export async function login(input: LoginInput, context: RequestContext): Promise<LoginOutcome> {
  const institution = await institutionRepository.findByDomain(emailDomain(input.email));
  if (!institution) {
    // Unknown institution domain. Burn comparable time, then answer generically.
    await burnPasswordTime(input.password);
    throw Errors.authInvalid();
  }

  const institutionId = String(institution._id);
  const user = await userRepository.findByEmailWithPassword(institutionId, input.email);

  if (!user) {
    await burnPasswordTime(input.password);
    throw Errors.authInvalid();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordLoginFailure(user, context, LoginFailureReason.ACCOUNT_NOT_ACTIVE);
    throw Errors.authInvalid();
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  if (!passwordOk) {
    const attempts = await userRepository.incrementFailedLogins(institutionId, user._id);
    if (attempts >= MAX_FAILED_LOGINS) {
      await userRepository.lockAccount(institutionId, user._id, new Date(Date.now() + LOCKOUT_MS));
    }
    await recordLoginFailure(user, context, LoginFailureReason.INVALID_CREDENTIALS);
    throw Errors.authInvalid();
  }

  // From here the caller has proven the password, so specific feedback leaks nothing new.
  if (user.status === UserStatus.PENDING_VERIFICATION) {
    await recordLoginFailure(user, context, LoginFailureReason.ACCOUNT_NOT_ACTIVE);
    throw Errors.authInvalid('Verify your email address before signing in.');
  }

  if (user.status !== UserStatus.ACTIVE) {
    await recordLoginFailure(user, context, LoginFailureReason.ACCOUNT_NOT_ACTIVE);
    throw Errors.authInvalid('This account is not active. Contact your administrator.');
  }

  // Opportunistically upgrade a hash produced under weaker Argon2id settings.
  if (needsRehash(user.passwordHash)) {
    await userRepository.setPasswordHash(institutionId, user._id, await hashPassword(input.password));
  }

  if (user.mfaEnabled && (await hasConfirmedTotp(institutionId, user._id))) {
    await recordLoginFailure(user, context, LoginFailureReason.MFA_REQUIRED);
    return {
      status: 'MFA_REQUIRED',
      challengeId: signChallengeToken({
        sub: String(user._id),
        iid: institutionId,
        purpose: ChallengePurpose.MFA,
        fp: context.fingerprint,
      }),
    };
  }

  if (requiresDeviceVerification(user, context)) {
    await issueDeviceOtp(institutionId, user._id, user.email, user.fullName);
    await recordLoginFailure(user, context, LoginFailureReason.DEVICE_VERIFICATION_REQUIRED);
    return {
      status: 'DEVICE_VERIFICATION_REQUIRED',
      challengeId: signChallengeToken({
        sub: String(user._id),
        iid: institutionId,
        purpose: ChallengePurpose.DEVICE,
        fp: context.fingerprint,
      }),
    };
  }

  return { status: 'AUTHENTICATED', auth: await completeLogin(user, context) };
}

/**
 * A device is "new" when we have seen this user log in before, but never from this fingerprint.
 * The very first login is exempt: the user has just proved control of the mailbox by verifying
 * it, so mailing them a code to read from the same mailbox would add friction without adding
 * security.
 */
function requiresDeviceVerification(user: UserDocument, context: RequestContext): boolean {
  if (user.knownDeviceHashes.length === 0) return false;
  return !user.knownDeviceHashes.includes(context.fingerprint);
}

/** Shared tail of the two challenge-completion flows. */
async function loadChallengeUser(
  challengeId: string,
  purpose: (typeof ChallengePurpose)[keyof typeof ChallengePurpose],
  context: RequestContext,
): Promise<UserDocument> {
  const claims = verifyChallengeToken(challengeId, purpose);
  if (!claims) throw Errors.authInvalid('This verification request expired. Sign in again.');

  // The challenge is bound to the device that started it: a stolen challenge id is useless
  // from a different client.
  if (claims.fp !== context.fingerprint) throw Errors.authInvalid('This verification request expired. Sign in again.');

  const user = await userRepository.findById(claims.iid, claims.sub);
  if (!user || user.status !== UserStatus.ACTIVE) throw Errors.authInvalid();
  return user;
}

export async function completeMfaChallenge(
  input: MfaVerifyInput,
  context: RequestContext,
): Promise<AuthResult> {
  const user = await loadChallengeUser(input.challengeId, ChallengePurpose.MFA, context);
  const institutionId = String(user.institutionId);

  if (!(await verifyUserTotp(institutionId, user._id, input.code))) {
    await recordLoginFailure(user, context, LoginFailureReason.MFA_FAILED);
    throw Errors.authInvalid('That code is not valid.');
  }

  // MFA satisfied. A device we have not seen still has to be verified separately.
  if (requiresDeviceVerification(user, context)) {
    await issueDeviceOtp(institutionId, user._id, user.email, user.fullName);
    await recordLoginFailure(user, context, LoginFailureReason.DEVICE_VERIFICATION_REQUIRED);
    throw Errors.mfaRequired();
  }

  return completeLogin(user, context);
}

export async function completeDeviceChallenge(
  input: DeviceVerifyInput,
  context: RequestContext,
): Promise<AuthResult> {
  const user = await loadChallengeUser(input.challengeId, ChallengePurpose.DEVICE, context);
  const institutionId = String(user.institutionId);

  const outcome = await verifyDeviceOtp(institutionId, user._id, input.code);
  if (outcome !== 'VALID') {
    await recordLoginFailure(user, context, LoginFailureReason.DEVICE_VERIFICATION_FAILED);
    if (outcome === 'TOO_MANY_ATTEMPTS') throw Errors.rateLimited();
    throw Errors.authInvalid('That code is not valid.');
  }

  await recordAudit({
    institutionId,
    actorUserId: user._id,
    action: AuditAction.DEVICE_VERIFIED,
    resourceType: 'User',
    resourceId: String(user._id),
    result: AuditResult.SUCCESS,
    context,
  });

  return completeLogin(user, context);
}

export async function refresh(presentedToken: string, context: RequestContext): Promise<AuthResult> {
  const outcome = await rotateSession(presentedToken, context);

  if (outcome.status === 'REUSE_DETECTED') {
    // The session is already revoked by rotateSession; record why.
    await recordAudit({
      institutionId: outcome.session.institutionId,
      actorUserId: outcome.session.userId,
      action: AuditAction.REFRESH_REUSE_DETECTED,
      resourceType: 'Session',
      resourceId: String(outcome.session._id),
      result: AuditResult.FAILURE,
      context,
      reason: 'Rotated refresh token replayed; session chain revoked',
    });
    throw Errors.authInvalid('Your session has expired. Sign in again.');
  }

  if (outcome.status === 'INVALID') throw Errors.authInvalid('Your session has expired. Sign in again.');

  const { session } = outcome;
  const institutionId = String(session.institutionId);
  const user = await userRepository.findById(institutionId, session.userId);

  // A suspended/deleted user must not be able to renew, even with a valid refresh token.
  if (!user || user.status !== UserStatus.ACTIVE) {
    await sessionRepository.revokeById(session._id, 'USER_NOT_ACTIVE');
    throw Errors.authInvalid('Your session has expired. Sign in again.');
  }

  // Roles are re-read here, so a privilege change takes effect on the next refresh at the latest.
  const accessToken = signAccessToken({
    sub: String(user._id),
    iid: institutionId,
    sid: String(session._id),
    roles: [...user.roles],
  });

  return {
    user: await toUserDTO(user),
    accessToken,
    expiresIn: accessTokenTtlSeconds(),
    refreshToken: outcome.refreshToken,
    sessionId: String(session._id),
  };
}

export async function logout(
  institutionId: string,
  userId: string,
  sessionId: string | undefined,
  context: RequestContext,
): Promise<void> {
  if (!sessionId) return;

  const revoked = await sessionRepository.revokeOwnedById(institutionId, userId, sessionId, 'USER_LOGOUT');
  if (!revoked) return;

  await recordAudit({
    institutionId,
    actorUserId: userId,
    action: AuditAction.LOGGED_OUT,
    resourceType: 'Session',
    resourceId: sessionId,
    result: AuditResult.SUCCESS,
    context,
  });
}

export async function logoutAll(
  institutionId: string,
  userId: string,
  context: RequestContext,
): Promise<number> {
  const count = await sessionRepository.revokeAllForUser(institutionId, userId, 'USER_LOGOUT_ALL');

  await recordAudit({
    institutionId,
    actorUserId: userId,
    action: AuditAction.ALL_SESSIONS_REVOKED,
    resourceType: 'Session',
    result: AuditResult.SUCCESS,
    context,
    reason: `${count} session(s) revoked`,
  });

  return count;
}

/**
 * Forgot password. Always completes without revealing whether the address is registered, and
 * quietly stops issuing tokens once a user has requested several in a short window.
 */
export async function forgotPassword(email: string, context: RequestContext): Promise<void> {
  const institution = await institutionRepository.findByDomain(emailDomain(email));
  if (!institution) return;

  const institutionId = String(institution._id);
  const user = await userRepository.findByEmail(institutionId, email);
  if (!user) return;

  const recent = await passwordResetRepository.countRecentForUser(
    institutionId,
    user._id,
    new Date(Date.now() - RESET_WINDOW_MS),
  );
  if (recent >= MAX_RESETS_PER_WINDOW) {
    logger.warn({ institutionId }, 'Password reset throttled for user');
    return;
  }

  const token = generateOpaqueToken(32);
  await passwordResetRepository.create({
    institutionId,
    userId: user._id,
    tokenHash: sha256(token),
    requestedIp: context.ip,
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  });

  await recordAudit({
    institutionId,
    actorUserId: user._id,
    action: AuditAction.PASSWORD_RESET_REQUESTED,
    resourceType: 'User',
    resourceId: String(user._id),
    result: AuditResult.SUCCESS,
    context,
  });

  await sendPasswordResetEmail(user.email, user.fullName, token);
}

/**
 * Complete a password reset. On success every session is revoked (an attacker who already had
 * one must not keep it) and the owner is emailed a notification.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
  context: RequestContext,
): Promise<void> {
  const reset = await passwordResetRepository.findRedeemableByTokenHash(sha256(token));
  if (!reset) throw Errors.authInvalid('This reset link is invalid or has expired.');

  const institutionId = String(reset.institutionId);
  const user = await userRepository.findByIdWithPassword(institutionId, reset.userId);
  if (!user) throw Errors.authInvalid('This reset link is invalid or has expired.');

  // Reuse control: the new password must actually be new.
  if (await verifyPassword(user.passwordHash, newPassword)) {
    throw Errors.validation([
      { path: 'password', message: 'Choose a password you have not used on this account before.' },
    ]);
  }

  // Claim the token atomically before changing anything, so it can only ever be spent once.
  if (!(await passwordResetRepository.markUsed(reset._id))) {
    throw Errors.authInvalid('This reset link is invalid or has expired.');
  }

  await userRepository.setPasswordHash(institutionId, user._id, await hashPassword(newPassword));
  await passwordResetRepository.invalidateAllForUser(institutionId, user._id);
  const revoked = await sessionRepository.revokeAllForUser(institutionId, user._id, 'PASSWORD_RESET');

  await recordAudit({
    institutionId,
    actorUserId: user._id,
    action: AuditAction.PASSWORD_RESET_COMPLETED,
    resourceType: 'User',
    resourceId: String(user._id),
    result: AuditResult.SUCCESS,
    context,
    reason: `${revoked} session(s) revoked`,
  });

  await sendPasswordChangedEmail(user.email, user.fullName);
}
