/** Attendance handlers: marking, student views, scope roster and the correction workflow. */
import type { NextFunction, Request, Response } from 'express';
import type {
  attendanceCorrectionDecisionSchema,
  attendanceCorrectionRequestSchema,
  attendanceQuerySchema,
  attendanceSummaryQuerySchema,
  attendanceTrendQuerySchema,
  correctionQuerySchema,
  idParamSchema,
  markAttendanceSchema,
  rosterQuerySchema,
} from '@campusconnect/validation';
import { requirePrincipal } from '../middleware/auth.middleware.js';
import { validatedBody, validatedParams, validatedQuery } from '../middleware/validate.middleware.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { getRequestContext } from '../utils/requestContext.js';
import {
  decideCorrection,
  getAttendanceOverview,
  getAttendanceTrend,
  getClassRoster,
  getScopeAttendanceSummary,
  listAttendanceRecords,
  listCorrectionsForReviewer,
  listOwnCorrections,
  markAttendance,
  requestCorrection,
} from '../services/attendance.service.js';

export async function postAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const input = validatedBody<typeof markAttendanceSchema>(res);
    sendSuccess(res, await markAttendance(principal, input, getRequestContext(req)), { status: 201 });
  } catch (err) {
    next(err);
  }
}

export async function getRoster(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    const { date, period } = validatedQuery<typeof rosterQuerySchema>(res);
    sendSuccess(res, await getClassRoster(principal, id, date, period));
  } catch (err) {
    next(err);
  }
}

export async function getAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit, ...filters } = validatedQuery<typeof attendanceQuerySchema>(res);
    const result = await listAttendanceRecords(principal, { page, limit }, filters);

    sendSuccess(res, result.items, {
      pagination: { page, limit, total: result.total, hasNext: page * limit < result.total },
    });
  } catch (err) {
    next(err);
  }
}

export async function getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { studentUserId, from, to } = validatedQuery<typeof attendanceSummaryQuerySchema>(res);
    sendSuccess(res, await getAttendanceOverview(principal, studentUserId, { from, to }));
  } catch (err) {
    next(err);
  }
}

export async function getTrend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { studentUserId, granularity, from, to } = validatedQuery<typeof attendanceTrendQuerySchema>(res);
    sendSuccess(res, await getAttendanceTrend(principal, studentUserId, granularity, { from, to }));
  } catch (err) {
    next(err);
  }
}

/** The mentor/HOD/principal roster view: per-student percentages across the caller's scope. */
export async function getScopeSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { from, to } = validatedQuery<typeof attendanceSummaryQuerySchema>(res);
    sendSuccess(res, await getScopeAttendanceSummary(principal, { from, to }));
  } catch (err) {
    next(err);
  }
}

export async function postCorrection(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const input = validatedBody<typeof attendanceCorrectionRequestSchema>(res);
    sendSuccess(res, await requestCorrection(principal, input, getRequestContext(req)), { status: 201 });
  } catch (err) {
    next(err);
  }
}

export async function patchCorrection(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    const input = validatedBody<typeof attendanceCorrectionDecisionSchema>(res);
    sendSuccess(res, await decideCorrection(principal, id, input, getRequestContext(req)));
  } catch (err) {
    next(err);
  }
}

export async function getCorrections(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit, status } = validatedQuery<typeof correctionQuerySchema>(res);
    const result = await listCorrectionsForReviewer(principal, { page, limit }, status);

    sendSuccess(res, result.items, {
      pagination: { page, limit, total: result.total, hasNext: page * limit < result.total },
    });
  } catch (err) {
    next(err);
  }
}

export async function getMyCorrections(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit, status } = validatedQuery<typeof correctionQuerySchema>(res);
    const result = await listOwnCorrections(principal, { page, limit }, status);

    sendSuccess(res, result.items, {
      pagination: { page, limit, total: result.total, hasNext: page * limit < result.total },
    });
  } catch (err) {
    next(err);
  }
}
