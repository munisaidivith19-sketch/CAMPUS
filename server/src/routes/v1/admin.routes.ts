/**
 * Administrative identity routes (role management, user directory, audit log, ID issuance).
 *
 * These require tenant-wide permissions, which in the seeded catalog only SYSTEM_ADMIN holds in
 * full. The permission still grants reach within the caller's own institution only — the
 * controllers scope every query by `principal.institutionId`.
 */
import { Router } from 'express';
import { Permission } from '@campusconnect/types';
import {
  assignRolesSchema,
  issueStudentIdSchema,
  paginationQuerySchema,
  userIdParamSchema,
} from '@campusconnect/validation';
import * as adminController from '../../controllers/admin.controller.js';
import { authenticate, resolveTenant } from '../../middleware/auth.middleware.js';
import { authorize } from '../../middleware/authorize.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';

export const adminRouter = Router();

adminRouter.use(authenticate, resolveTenant);

adminRouter.get(
  '/users',
  authorize({ anyOf: [Permission.USER_READ] }),
  validate({ query: paginationQuerySchema }),
  adminController.getUsers,
);

adminRouter.put(
  '/users/:id/roles',
  authorize({ anyOf: [Permission.ROLE_ASSIGN] }),
  validate({ params: userIdParamSchema, body: assignRolesSchema }),
  adminController.putUserRoles,
);

adminRouter.get('/roles', authorize({ anyOf: [Permission.ROLE_READ] }), adminController.getRoles);

adminRouter.get(
  '/audit-logs',
  authorize({ anyOf: [Permission.AUDIT_READ] }),
  validate({ query: paginationQuerySchema }),
  adminController.getAuditLog,
);

adminRouter.post(
  '/student-ids',
  authorize({ anyOf: [Permission.STUDENT_ID_ISSUE] }),
  validate({ body: issueStudentIdSchema }),
  adminController.postStudentId,
);
