/** Dashboard handlers: one per role, each a single call into dashboard.service. */
import type { NextFunction, Request, Response } from 'express';
import type { Principal } from '@campusconnect/security';
import { requirePrincipal } from '../middleware/auth.middleware.js';
import { sendSuccess } from '../utils/apiResponse.js';
import * as dashboards from '../services/dashboard.service.js';

function handler(build: (principal: Principal) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      sendSuccess(res, await build(requirePrincipal(req)));
    } catch (err) {
      next(err);
    }
  };
}

export const getStudentDashboard = handler((p) => dashboards.studentDashboard(p));
export const getFacultyDashboard = handler((p) => dashboards.facultyDashboard(p));
export const getMentorDashboard = handler((p) => dashboards.mentorDashboard(p));
export const getHodDashboard = handler((p) => dashboards.hodDashboard(p));
export const getPrincipalDashboard = handler((p) => dashboards.principalDashboard(p));
export const getClubAdminDashboard = handler((p) => dashboards.clubAdminDashboard(p));
