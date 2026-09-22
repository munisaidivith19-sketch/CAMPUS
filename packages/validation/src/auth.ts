/**
 * Auth & identity request schemas (Phase 2).
 *
 * These are the ONE definition of each auth contract: the server validates every request with
 * them at the boundary, and the web/mobile forms reuse them so client-side feedback can never
 * drift from what the server actually accepts. Client validation is UX only — the server
 * re-validates everything.
 */
import { z } from 'zod';
import { objectIdSchema } from './common.js';

/**
 * Password policy. Length is the dominant factor, so we require a genuinely long password and
 * a mix of character classes. Enforced server-side on register and reset.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[a-z]/.test(v), 'Password must contain a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Password must contain an uppercase letter')
  .refine((v) => /\d/.test(v), 'Password must contain a digit');

/** Free-text email schema. Domain enforcement happens server-side (see institutionEmailSchema). */
export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const fullNameSchema = z.string().trim().min(2, 'Enter your full name').max(120);

/** Client-supplied label for a device; never trusted for authorization, only shown in "My Devices". */
export const deviceNameSchema = z.string().trim().min(1).max(80).optional();

/** Opaque, high-entropy tokens delivered by email (verify / reset). */
export const opaqueTokenSchema = z.string().trim().min(20).max(256);

/** A 6-digit one-time code (TOTP or emailed OTP). */
export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code');

/** Short-lived signed challenge issued by /auth/login when MFA or device verification is required. */
export const challengeSchema = z.string().trim().min(20).max(2048);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
  deviceName: deviceNameSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Web sends the refresh token as an httpOnly cookie; mobile sends it in the body. */
export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(512).optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const verifyEmailSchema = z.object({ token: opaqueTokenSchema });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: opaqueTokenSchema,
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Confirms enrollment by proving the authenticator app produced a valid code. */
export const mfaEnrollVerifySchema = z.object({ code: otpCodeSchema });

/** Completes a login that was gated by MFA. */
export const mfaVerifySchema = z.object({
  challengeId: challengeSchema,
  code: otpCodeSchema,
  deviceName: deviceNameSchema,
});
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

/** Completes a login from an unrecognized device using the emailed OTP. */
export const deviceVerifySchema = z.object({
  challengeId: challengeSchema,
  code: otpCodeSchema,
  deviceName: deviceNameSchema,
});
export type DeviceVerifyInput = z.infer<typeof deviceVerifySchema>;

/** Disabling MFA is a sensitive action: re-confirm the password. */
export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(128),
});

export const sessionIdParamSchema = z.object({ id: objectIdSchema });
