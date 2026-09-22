/**
 * Auth HTTP handlers. Thin by design: read validated input, call exactly one service, shape the
 * response. No business rules and no database access live here.
 *
 * Note the deliberately uniform responses on `register` and `forgotPassword` — the controller
 * cannot leak what the service refused to distinguish.
 */
import type { NextFunction, Request, Response } from 'express';
import type { LoginResponseDTO } from '@campusconnect/types';
import { MfaType } from '@campusconnect/types';
import type {
  deviceVerifySchema,
  forgotPasswordSchema,
  loginSchema,
  mfaVerifySchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@campusconnect/validation';
import * as authService from '../services/auth.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { Errors } from '../utils/errors.js';
import { getRequestContext } from '../utils/requestContext.js';
import { validatedBody } from '../middleware/validate.middleware.js';
import { clearRefreshCookie, isNativeClient, readRefreshToken, setRefreshCookie } from '../utils/cookies.js';
import { requirePrincipal } from '../middleware/auth.middleware.js';

/** Shape an authenticated result, putting the refresh token where this client type keeps it. */
function respondWithAuth(req: Request, res: Response, auth: authService.AuthResult, status = 200): void {
  const native = isNativeClient(req);
  if (!native) setRefreshCookie(res, auth.refreshToken);

  sendSuccess(
    res,
    {
      status: 'AUTHENTICATED',
      user: auth.user,
      tokens: {
        accessToken: auth.accessToken,
        expiresIn: auth.expiresIn,
        ...(native ? { refreshToken: auth.refreshToken } : {}),
      },
    } satisfies LoginResponseDTO,
    { status },
  );
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.register(validatedBody<typeof registerSchema>(res), getRequestContext(req));
    // Identical whether or not the address was already registered.
    sendSuccess(res, { status: 'VERIFICATION_SENT' }, { status: 202 });
  } catch (err) {
    next(err);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = validatedBody<typeof verifyEmailSchema>(res);
    await authService.verifyEmail(token, getRequestContext(req));
    sendSuccess(res, { status: 'VERIFIED' });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const outcome = await authService.login(validatedBody<typeof loginSchema>(res), getRequestContext(req));

    if (outcome.status === 'MFA_REQUIRED') {
      sendSuccess(res, {
        status: 'MFA_REQUIRED',
        challengeId: outcome.challengeId,
        methods: [MfaType.TOTP],
      } satisfies LoginResponseDTO);
      return;
    }

    if (outcome.status === 'DEVICE_VERIFICATION_REQUIRED') {
      sendSuccess(res, {
        status: 'DEVICE_VERIFICATION_REQUIRED',
        challengeId: outcome.challengeId,
      } satisfies LoginResponseDTO);
      return;
    }

    respondWithAuth(req, res, outcome.auth);
  } catch (err) {
    next(err);
  }
}

export async function verifyMfa(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = await authService.completeMfaChallenge(
      validatedBody<typeof mfaVerifySchema>(res),
      getRequestContext(req),
    );
    respondWithAuth(req, res, auth);
  } catch (err) {
    next(err);
  }
}

export async function verifyDevice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = await authService.completeDeviceChallenge(
      validatedBody<typeof deviceVerifySchema>(res),
      getRequestContext(req),
    );
    respondWithAuth(req, res, auth);
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = validatedBody<typeof refreshSchema>(res);
    const presented = readRefreshToken(req, refreshToken);
    if (!presented) throw Errors.authRequired();

    const auth = await authService.refresh(presented, getRequestContext(req));
    respondWithAuth(req, res, auth);
  } catch (err) {
    // A failed refresh should not leave a stale cookie behind on the client.
    clearRefreshCookie(res);
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    await authService.logout(
      principal.institutionId,
      principal.userId,
      principal.sessionId,
      getRequestContext(req),
    );
    clearRefreshCookie(res);
    sendSuccess(res, { status: 'LOGGED_OUT' });
  } catch (err) {
    next(err);
  }
}

export async function logoutAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const revoked = await authService.logoutAll(
      principal.institutionId,
      principal.userId,
      getRequestContext(req),
    );
    clearRefreshCookie(res);
    sendSuccess(res, { status: 'LOGGED_OUT_ALL', revoked });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = validatedBody<typeof forgotPasswordSchema>(res);
    await authService.forgotPassword(email, getRequestContext(req));
    // Always the same answer, registered or not.
    sendSuccess(res, { status: 'RESET_EMAIL_SENT' }, { status: 202 });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, password } = validatedBody<typeof resetPasswordSchema>(res);
    await authService.resetPassword(token, password, getRequestContext(req));
    clearRefreshCookie(res);
    sendSuccess(res, { status: 'PASSWORD_RESET' });
  } catch (err) {
    next(err);
  }
}
