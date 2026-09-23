/** Subjects, classes and timetable handlers. Thin: validated input → one service → envelope. */
import type { NextFunction, Request, Response } from 'express';
import type {
  assignFacultySchema,
  classQuerySchema,
  idParamSchema,
  subjectQuerySchema,
  timetableQuerySchema,
} from '@campusconnect/validation';
import { requirePrincipal } from '../middleware/auth.middleware.js';
import { validatedBody, validatedParams, validatedQuery } from '../middleware/validate.middleware.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  assignClassFaculty,
  getTimetable,
  listClasses,
  listSubjects,
} from '../services/academics.service.js';

export async function getSubjects(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit, departmentId } = validatedQuery<typeof subjectQuerySchema>(res);
    const result = await listSubjects(principal, { page, limit }, { departmentId });

    sendSuccess(res, result.items, {
      pagination: { page, limit, total: result.total, hasNext: page * limit < result.total },
    });
  } catch (err) {
    next(err);
  }
}

export async function getClasses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { page, limit, ...filters } = validatedQuery<typeof classQuerySchema>(res);
    const result = await listClasses(principal, { page, limit }, filters);

    sendSuccess(res, result.items, {
      pagination: { page, limit, total: result.total, hasNext: page * limit < result.total },
    });
  } catch (err) {
    next(err);
  }
}

export async function getTimetableView(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const query = validatedQuery<typeof timetableQuerySchema>(res);
    sendSuccess(res, await getTimetable(principal, query));
  } catch (err) {
    next(err);
  }
}

export async function putClassFaculty(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { id } = validatedParams<typeof idParamSchema>(res);
    const { facultyUserId } = validatedBody<typeof assignFacultySchema>(res);
    sendSuccess(res, await assignClassFaculty(principal, id, facultyUserId));
  } catch (err) {
    next(err);
  }
}
