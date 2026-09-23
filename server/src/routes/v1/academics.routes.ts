/**
 * Academics routes: subjects, classes, timetable and attendance.
 *
 * Each route declares the permission it needs; the SCOPE narrowing (own records / assigned
 * classes / section / department / college) happens inside the services, because it depends on
 * assignments in the database rather than on the caller's role alone.
 */
import { Router } from 'express';
import { Permission } from '@campusconnect/types';
import {
  assignFacultySchema,
  attendanceCorrectionDecisionSchema,
  attendanceCorrectionRequestSchema,
  attendanceQuerySchema,
  attendanceSummaryQuerySchema,
  attendanceTrendQuerySchema,
  classQuerySchema,
  correctionQuerySchema,
  idParamSchema,
  markAttendanceSchema,
  rosterQuerySchema,
  subjectQuerySchema,
  timetableQuerySchema,
} from '@campusconnect/validation';
import * as academicsController from '../../controllers/academics.controller.js';
import * as attendanceController from '../../controllers/attendance.controller.js';
import { authenticate, resolveTenant } from '../../middleware/auth.middleware.js';
import { authorize } from '../../middleware/authorize.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';

export const academicsRouter = Router();
academicsRouter.use(authenticate, resolveTenant);

// --- Reference data ----------------------------------------------------------

academicsRouter.get(
  '/subjects',
  authorize({ anyOf: [Permission.SUBJECT_READ] }),
  validate({ query: subjectQuerySchema }),
  academicsController.getSubjects,
);

academicsRouter.get(
  '/classes',
  authorize({ anyOf: [Permission.CLASS_READ] }),
  validate({ query: classQuerySchema }),
  academicsController.getClasses,
);

academicsRouter.put(
  '/classes/:id/faculty',
  authorize({ anyOf: [Permission.CLASS_MANAGE] }),
  validate({ params: idParamSchema, body: assignFacultySchema }),
  academicsController.putClassFaculty,
);

academicsRouter.get(
  '/timetable',
  authorize({ anyOf: [Permission.TIMETABLE_READ] }),
  validate({ query: timetableQuerySchema }),
  academicsController.getTimetableView,
);

// --- Attendance --------------------------------------------------------------

academicsRouter.post(
  '/attendance',
  authorize({ anyOf: [Permission.ATTENDANCE_MARK] }),
  validate({ body: markAttendanceSchema }),
  attendanceController.postAttendance,
);

/** The roster a faculty member marks against, with anything already recorded. */
academicsRouter.get(
  '/attendance/roster/:id',
  authorize({ anyOf: [Permission.ATTENDANCE_MARK] }),
  validate({ params: idParamSchema, query: rosterQuerySchema }),
  attendanceController.getRoster,
);

// Reading your own record and reading within a scope are different permissions; either opens
// this route, and the service decides which rows the caller actually gets.
academicsRouter.get(
  '/attendance',
  authorize({ anyOf: [Permission.ATTENDANCE_READ_SELF, Permission.ATTENDANCE_READ_SCOPE] }),
  validate({ query: attendanceQuerySchema }),
  attendanceController.getAttendance,
);

academicsRouter.get(
  '/attendance/summary',
  authorize({ anyOf: [Permission.ATTENDANCE_READ_SELF, Permission.ATTENDANCE_READ_SCOPE] }),
  validate({ query: attendanceSummaryQuerySchema }),
  attendanceController.getSummary,
);

academicsRouter.get(
  '/attendance/trend',
  authorize({ anyOf: [Permission.ATTENDANCE_READ_SELF, Permission.ATTENDANCE_READ_SCOPE] }),
  validate({ query: attendanceTrendQuerySchema }),
  attendanceController.getTrend,
);

/** Cohort view for mentors, HODs and the principal — never available to a student. */
academicsRouter.get(
  '/attendance/scope-summary',
  authorize({ anyOf: [Permission.ATTENDANCE_READ_SCOPE] }),
  validate({ query: attendanceSummaryQuerySchema }),
  attendanceController.getScopeSummary,
);

// --- Corrections --------------------------------------------------------------

academicsRouter.post(
  '/attendance/corrections',
  authorize({ anyOf: [Permission.ATTENDANCE_CORRECTION_REQUEST] }),
  validate({ body: attendanceCorrectionRequestSchema }),
  attendanceController.postCorrection,
);

academicsRouter.get(
  '/attendance/corrections/mine',
  authorize({ anyOf: [Permission.ATTENDANCE_CORRECTION_REQUEST] }),
  validate({ query: correctionQuerySchema }),
  attendanceController.getMyCorrections,
);

academicsRouter.get(
  '/attendance/corrections',
  authorize({ anyOf: [Permission.ATTENDANCE_CORRECTION_REVIEW] }),
  validate({ query: correctionQuerySchema }),
  attendanceController.getCorrections,
);

academicsRouter.patch(
  '/attendance/corrections/:id',
  authorize({ anyOf: [Permission.ATTENDANCE_CORRECTION_REVIEW] }),
  validate({ params: idParamSchema, body: attendanceCorrectionDecisionSchema }),
  attendanceController.patchCorrection,
);
