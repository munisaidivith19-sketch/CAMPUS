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
import { academicsRouter } from './academics.routes.js';
import { communityRouter } from './community.routes.js';
import { chatRouter } from './chat.routes.js';
import { fileContentRouter, fileRouter } from './file.routes.js';

export const v1Router = Router();

// Non-sensitive metadata. No auth. Feature flags are added as features land.
v1Router.get('/meta', (_req, res) => {
  sendSuccess(res, {
    name: 'CampusConnect API',
    version: API_VERSION,
    phase: 3,
    status: 'core-campus-platform-part-a',
    features: {
      auth: true,
      mfa: true,
      sessions: true,
      rbac: true,
      studentId: true,
      // Phase 3 Part A.
      academics: true,
      attendance: true,
      announcements: true,
      clubs: true,
      events: true,
      discussions: true,
      notifications: true,
      search: true,
      // Part B and C-1.
      pushDelivery: true,
      // Part C-2. Chat is NOT end-to-end encrypted; see docs/security/SECURITY.md.
      chat: true,
      realtime: true,
      // Part C-3.
      fileSharing: true,
    },
  });
});

// --- Phase 2: Identity & Security --------------------------------------------
v1Router.use('/auth', authRouter);
v1Router.use('/me', meRouter);
v1Router.use('/admin', adminRouter);
v1Router.use('/qr', qrRouter);

// Signed-URL downloads carry no bearer token, so this must precede every router below that
// authenticates all of its paths.
v1Router.use('/', fileContentRouter);

// --- Phase 3 Part A: Academics & Community -----------------------------------
v1Router.use('/', academicsRouter);
v1Router.use('/', communityRouter);

// --- Phase 3 Part C-2: Chat ---------------------------------------------------
v1Router.use('/', chatRouter);

// --- Phase 3 Part C-3: Files --------------------------------------------------
v1Router.use('/', fileRouter);

// --- Feature routers (mounted in later phases) -------------------------------
// Part B adds chat + files + realtime; see docs/api/API.md for the full planned map.
