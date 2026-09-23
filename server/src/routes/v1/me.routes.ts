/**
 * Self-service identity routes.
 *
 * Every route runs the full pipeline: authenticate → resolveTenant → authorize → validate →
 * controller. The `*:self` permissions combined with `authorizeSelf` mean holding the
 * permission only ever grants access to your own records.
 */
import { Router } from 'express';
import { Permission } from '@campusconnect/types';
import {
  mfaDisableSchema,
  mfaEnrollVerifySchema,
  paginationQuerySchema,
  pushTokenSchema,
  sessionIdParamSchema,
  updateFacultyProfileSchema,
  updateMeSchema,
  updateStudentProfileSchema,
} from '@campusconnect/validation';
import * as meController from '../../controllers/me.controller.js';
import { authenticate, resolveTenant } from '../../middleware/auth.middleware.js';
import { authorizeSelf } from '../../middleware/authorize.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { otpLimiter } from '../../middleware/rateLimit.middleware.js';

export const meRouter = Router();

// Applies to every route below — there is no unauthenticated path into this router.
meRouter.use(authenticate, resolveTenant);

meRouter.get('/', authorizeSelf([Permission.USER_READ_SELF]), meController.getMe);

meRouter.patch(
  '/',
  authorizeSelf([Permission.USER_UPDATE_SELF]),
  validate({ body: updateMeSchema }),
  meController.patchMe,
);

meRouter.get('/sessions', authorizeSelf([Permission.SESSION_READ_SELF]), meController.getSessions);

meRouter.delete(
  '/sessions/:id',
  authorizeSelf([Permission.SESSION_REVOKE_SELF]),
  validate({ params: sessionIdParamSchema }),
  meController.deleteSession,
);

meRouter.post(
  '/sessions/revoke-others',
  authorizeSelf([Permission.SESSION_REVOKE_SELF]),
  meController.revokeOthers,
);

meRouter.get(
  '/login-history',
  authorizeSelf([Permission.LOGIN_HISTORY_READ_SELF]),
  validate({ query: paginationQuerySchema }),
  meController.getLoginHistory,
);

/** Security-dashboard foundation: active sessions + recent logins for the caller. */
meRouter.get(
  '/security',
  authorizeSelf([Permission.SESSION_READ_SELF]),
  meController.getSecurityDashboard,
);

meRouter.get('/profile', authorizeSelf([Permission.PROFILE_READ_SELF]), meController.getMyProfile);

meRouter.patch(
  '/profile/student',
  authorizeSelf([Permission.PROFILE_UPDATE_SELF]),
  validate({ body: updateStudentProfileSchema }),
  meController.patchStudentProfile,
);

meRouter.patch(
  '/profile/faculty',
  authorizeSelf([Permission.PROFILE_UPDATE_SELF]),
  validate({ body: updateFacultyProfileSchema }),
  meController.patchFacultyProfile,
);

meRouter.get(
  '/student-id',
  authorizeSelf([Permission.STUDENT_ID_READ_SELF]),
  meController.getMyStudentId,
);

meRouter.post(
  '/student-id/qr',
  authorizeSelf([Permission.QR_ISSUE_SELF]),
  meController.issueMyQr,
);

/**
 * Push-token registration. Gated on the caller's own notification permission — the token is
 * always attached to the caller, so this can only ever wire up their own device.
 */
meRouter.post(
  '/push-tokens',
  authorizeSelf([Permission.NOTIFICATION_READ_SELF]),
  validate({ body: pushTokenSchema }),
  meController.postPushToken,
);

meRouter.delete(
  '/push-tokens',
  authorizeSelf([Permission.NOTIFICATION_READ_SELF]),
  validate({ body: pushTokenSchema }),
  meController.deletePushToken,
);

meRouter.post('/mfa/enroll', authorizeSelf([Permission.MFA_MANAGE_SELF]), meController.enrollMfa);

meRouter.post(
  '/mfa/confirm',
  otpLimiter,
  authorizeSelf([Permission.MFA_MANAGE_SELF]),
  validate({ body: mfaEnrollVerifySchema }),
  meController.confirmMfa,
);

meRouter.post(
  '/mfa/disable',
  authorizeSelf([Permission.MFA_MANAGE_SELF]),
  validate({ body: mfaDisableSchema }),
  meController.disableMfa,
);
