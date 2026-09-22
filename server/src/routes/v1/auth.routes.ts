/**
 * Authentication routes.
 *
 * Public entry points carry a strict per-route rate limit in addition to the global one, and
 * every one of them validates its body with the shared Zod schema before the controller runs.
 * `logout`/`logout-all` are the only authenticated routes here, since they act on the caller's
 * own session rather than on a credential.
 */
import { Router } from 'express';
import {
  deviceVerifySchema,
  forgotPasswordSchema,
  loginSchema,
  mfaVerifySchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@campusconnect/validation';
import * as authController from '../../controllers/auth.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, resolveTenant } from '../../middleware/auth.middleware.js';
import {
  forgotPasswordLimiter,
  loginLimiter,
  otpLimiter,
  registerLimiter,
  resetPasswordLimiter,
} from '../../middleware/rateLimit.middleware.js';

export const authRouter = Router();

authRouter.post(
  '/register',
  registerLimiter,
  validate({ body: registerSchema }),
  authController.register,
);

authRouter.post('/verify-email', validate({ body: verifyEmailSchema }), authController.verifyEmail);

authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), authController.login);

authRouter.post('/mfa/verify', otpLimiter, validate({ body: mfaVerifySchema }), authController.verifyMfa);

authRouter.post(
  '/device/verify',
  otpLimiter,
  validate({ body: deviceVerifySchema }),
  authController.verifyDevice,
);

// No auth middleware: the refresh token IS the credential here.
authRouter.post('/refresh', validate({ body: refreshSchema }), authController.refresh);

authRouter.post('/logout', authenticate, resolveTenant, authController.logout);
authRouter.post('/logout-all', authenticate, resolveTenant, authController.logoutAll);

authRouter.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword,
);

authRouter.post(
  '/reset-password',
  resetPasswordLimiter,
  validate({ body: resetPasswordSchema }),
  authController.resetPassword,
);
