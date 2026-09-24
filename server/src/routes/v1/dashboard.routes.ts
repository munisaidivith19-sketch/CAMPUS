/**
 * Role dashboards.
 *
 * Two gates, like everything else: the permission that opens the door (the same one the
 * underlying data needs), then the service's role check and scope narrowing. A student asking
 * for the HOD dashboard is refused; an HOD with no department gets an empty one.
 */
import { Router } from 'express';
import { Permission } from '@campusconnect/types';
import * as dashboards from '../../controllers/dashboard.controller.js';
import { authenticate, resolveTenant } from '../../middleware/auth.middleware.js';
import { authorize } from '../../middleware/authorize.middleware.js';

export const dashboardRouter = Router();
dashboardRouter.use('/dashboards', authenticate, resolveTenant);

dashboardRouter.get(
  '/dashboards/student',
  authorize({ anyOf: [Permission.ATTENDANCE_READ_SELF] }),
  dashboards.getStudentDashboard,
);
dashboardRouter.get(
  '/dashboards/faculty',
  authorize({ anyOf: [Permission.ATTENDANCE_MARK] }),
  dashboards.getFacultyDashboard,
);
dashboardRouter.get(
  '/dashboards/mentor',
  authorize({ anyOf: [Permission.ATTENDANCE_READ_SCOPE] }),
  dashboards.getMentorDashboard,
);
dashboardRouter.get(
  '/dashboards/hod',
  authorize({ anyOf: [Permission.ATTENDANCE_READ_SCOPE] }),
  dashboards.getHodDashboard,
);
dashboardRouter.get(
  '/dashboards/principal',
  authorize({ anyOf: [Permission.ATTENDANCE_READ_SCOPE] }),
  dashboards.getPrincipalDashboard,
);
dashboardRouter.get(
  '/dashboards/club-admin',
  authorize({ anyOf: [Permission.CLUB_MANAGE] }),
  dashboards.getClubAdminDashboard,
);
