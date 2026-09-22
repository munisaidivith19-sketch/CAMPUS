/**
 * API v1 router. Phase 2 mounts the identity surface; later feature routers are added by the
 * phase that delivers them (see docs/api/API.md for the full planned map).
 */
import { Router } from 'express';
import { API_VERSION } from '@campusconnect/config';
import { sendSuccess } from '../../utils/apiResponse.js';
import { authRouter } from './auth.routes.js';
import { meRouter } from './me.routes.js';
import { adminRouter } from './admin.routes.js';
import { qrRouter } from './qr.routes.js';

export const v1Router = Router();

// Non-sensitive metadata. No auth. Feature flags are added as features land.
v1Router.get('/meta', (_req, res) => {
  sendSuccess(res, {
    name: 'CampusConnect API',
    version: API_VERSION,
    phase: 2,
    status: 'identity-and-security',
    features: {
      auth: true,
      mfa: true,
      sessions: true,
      rbac: true,
      studentId: true,
      // Everything below arrives in Phase 3+.
      academics: false,
      community: false,
      realtime: false,
    },
  });
});

// --- Phase 2: Identity & Security --------------------------------------------
v1Router.use('/auth', authRouter);
v1Router.use('/me', meRouter);
v1Router.use('/admin', adminRouter);
v1Router.use('/qr', qrRouter);

// --- Feature routers (mounted in later phases) -------------------------------
// v1Router.use('/attendance', attendanceRouter); // Phase 3
// ... see docs/api/API.md for the full planned map.
