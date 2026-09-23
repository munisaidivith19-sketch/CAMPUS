/**
 * Self-service identity handlers ("/me").
 *
 * Every handler derives the subject from `req.principal` — never from a path or body parameter.
 * That is what makes this whole surface IDOR-proof by construction: there is no id a caller
 * could tamper with to reach another account.
 */
import type { NextFunction, Request, Response } from 'express';
import { QRPurpose, Role } from '@campusconnect/types';
import type {
  mfaDisableSchema,
  mfaEnrollVerifySchema,
  paginationQuerySchema,
  pushTokenSchema,
  sessionIdParamSchema,
  updateFacultyProfileSchema,
  updateMeSchema,
  updateStudentProfileSchema,
} from '@campusconnect/validation';
import { requirePrincipal } from '../middleware/auth.middleware.js';
import { validatedBody, validatedParams, validatedQuery } from '../middleware/validate.middleware.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { Errors } from '../utils/errors.js';
import { getRequestContext } from '../utils/requestContext.js';
import { getUserById, toUserDTO, updateOwnProfile } from '../services/user.service.js';
import {
  listSessions,
  revokeOtherSessions,
  revokeSession,
} from '../services/session.service.js';
import { getSecurityOverview, listLoginHistory } from '../services/security.service.js';
import {
  getFacultyProfile,
  getStudentProfile,
  updateFacultyProfile,
  updateStudentProfile,
} from '../services/profile.service.js';
import { getActiveStudentId } from '../services/studentId.service.js';
import { issueQrToken } from '../services/qr.service.js';
import { confirmUserTotp, disableUserTotp, enrollUserTotp } from '../services/mfa.service.js';
import { recordAudit } from '../services/audit.service.js';
import { userRepository } from '../repositories/user.repository.js';
import { AuditAction, AuditResult } from '@campusconnect/types';

export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const user = await getUserById(principal.institutionId, principal.userId);
    sendSuccess(res, await toUserDTO(user));
  } catch (err) {
    next(err);
  }
}

export async function patchMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const fields = validatedBody<typeof updateMeSchema>(res);
    sendSuccess(
      res,
      await updateOwnProfile(principal.institutionId, principal.userId, fields, getRequestContext(req)),
    );
  } catch (err) {
    next(err);
  }
}

export async function getSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const sessions = await listSessions(principal.institutionId, principal.userId, principal.sessionId);
    sendSuccess(res, sessions);
  } catch (err) {
    next(err);
  }
}

export async function deleteSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof sessionIdParamSchema>(res);

    // Ownership is part of the query, so another user's session id simply does not match.
    const revoked = await revokeSession(principal.institutionId, principal.userId, id, 'USER_REVOKED_DEVICE');
    if (!revoked) throw Errors.notFound();

    await recordAudit({
      institutionId: principal.institutionId,
      actorUserId: principal.userId,
      action: AuditAction.SESSION_REVOKED,
      resourceType: 'Session',
      resourceId: id,
      result: AuditResult.SUCCESS,
      context: getRequestContext(req),
    });

    sendSuccess(res, { status: 'REVOKED', sessionId: id });
  } catch (err) {
    next(err);
  }
}

export async function revokeOthers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const revoked = await revokeOtherSessions(
      principal.institutionId,
      principal.userId,
      principal.sessionId,
      'USER_REVOKED_OTHER_DEVICES',
    );

    await recordAudit({
      institutionId: principal.institutionId,
      actorUserId: principal.userId,
      action: AuditAction.ALL_SESSIONS_REVOKED,
      resourceType: 'Session',
      result: AuditResult.SUCCESS,
      context: getRequestContext(req),
      reason: `${revoked} other session(s) revoked`,
    });

    sendSuccess(res, { status: 'REVOKED_OTHERS', revoked });
  } catch (err) {
    next(err);
  }
}

export async function getLoginHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit } = validatedQuery<typeof paginationQuerySchema>(res);
    const result = await listLoginHistory(principal.institutionId, principal.userId, { page, limit });

    sendSuccess(res, result.items, {
      pagination: {
        page,
        limit,
        total: result.total,
        hasNext: page * limit < result.total,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getSecurityDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const user = await getUserById(principal.institutionId, principal.userId);
    sendSuccess(
      res,
      await getSecurityOverview(
        principal.institutionId,
        principal.userId,
        principal.sessionId,
        user.mfaEnabled,
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function getMyProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);

    if (principal.roles.includes(Role.STUDENT)) {
      sendSuccess(res, {
        type: 'STUDENT',
        profile: await getStudentProfile(principal.institutionId, principal.userId),
      });
      return;
    }

    sendSuccess(res, {
      type: 'FACULTY',
      profile: await getFacultyProfile(principal.institutionId, principal.userId),
    });
  } catch (err) {
    next(err);
  }
}

export async function patchStudentProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const fields = validatedBody<typeof updateStudentProfileSchema>(res);
    sendSuccess(
      res,
      await updateStudentProfile(principal.institutionId, principal.userId, fields, getRequestContext(req)),
    );
  } catch (err) {
    next(err);
  }
}

export async function patchFacultyProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const fields = validatedBody<typeof updateFacultyProfileSchema>(res);
    sendSuccess(
      res,
      await updateFacultyProfile(principal.institutionId, principal.userId, fields, getRequestContext(req)),
    );
  } catch (err) {
    next(err);
  }
}

export async function getMyStudentId(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    sendSuccess(res, await getActiveStudentId(principal.institutionId, principal.userId));
  } catch (err) {
    next(err);
  }
}

/** Mint a short-lived QR for the caller's own student ID. */
export async function issueMyQr(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    // Only issue a code for a card that actually exists and is valid.
    await getActiveStudentId(principal.institutionId, principal.userId);

    sendSuccess(
      res,
      await issueQrToken(
        principal.institutionId,
        principal.userId,
        principal.userId,
        QRPurpose.STUDENT_ID,
        getRequestContext(req),
      ),
    );
  } catch (err) {
    next(err);
  }
}

/**
 * Register this device for push notifications.
 *
 * The token is always the caller's own — there is no user id in the path — so one user cannot
 * register a device against another account and start receiving their notifications.
 */
export async function postPushToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { token } = validatedBody<typeof pushTokenSchema>(res);
    await userRepository.addPushToken(principal.institutionId, principal.userId, token);
    sendSuccess(res, { status: 'REGISTERED' }, { status: 201 });
  } catch (err) {
    next(err);
  }
}

export async function deletePushToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { token } = validatedBody<typeof pushTokenSchema>(res);
    await userRepository.removePushToken(principal.institutionId, principal.userId, token);
    sendSuccess(res, { status: 'UNREGISTERED' });
  } catch (err) {
    next(err);
  }
}

export async function enrollMfa(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const user = await getUserById(principal.institutionId, principal.userId);
    sendSuccess(res, await enrollUserTotp(principal.institutionId, principal.userId, user.email));
  } catch (err) {
    next(err);
  }
}

export async function confirmMfa(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { code } = validatedBody<typeof mfaEnrollVerifySchema>(res);
    await confirmUserTotp(principal.institutionId, principal.userId, code, getRequestContext(req));
    sendSuccess(res, { status: 'MFA_ENABLED' });
  } catch (err) {
    next(err);
  }
}

export async function disableMfa(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { password } = validatedBody<typeof mfaDisableSchema>(res);
    await disableUserTotp(principal.institutionId, principal.userId, password, getRequestContext(req));
    sendSuccess(res, { status: 'MFA_DISABLED' });
  } catch (err) {
    next(err);
  }
}
