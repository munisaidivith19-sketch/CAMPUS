/**
 * Builds the Express app WITHOUT listening, so integration tests can import it directly.
 * The listen() call lives in index.ts.
 *
 * Phase 1 wires the security/observability middleware baseline and a health check. The
 * ordered pipeline (auth → tenant → authz → validation) is added per-route in later phases;
 * its contract is documented in docs/architecture/03-backend-architecture.md.
 */
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { API_PREFIX } from '@campusconnect/config';
import { config } from './config/env.js';
import { requestIdMiddleware } from './middleware/requestId.middleware.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware.js';
import { sanitizeMiddleware } from './middleware/sanitize.middleware.js';
import { v1Router } from './routes/v1/index.js';

export function buildApp(): Express {
  const app = express();

  // Behind a reverse proxy in prod (nginx). Needed for correct client IPs / rate limiting.
  app.set('trust proxy', 1);

  // Security headers (Helmet + strict-ish defaults; CSP is tightened when the web app ships).
  app.use(
    helmet({
      hsts: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // CORS allowlist (no wildcards). Origins come from validated config.
  app.use(
    cors({
      origin: config.CORS_ALLOWED_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  // Body parsing with size limits (payload-size defense).
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Refresh tokens ride in an httpOnly cookie for web clients (see utils/cookies.ts).
  app.use(cookieParser());

  // Strip Mongo operator keys before anything downstream can see them.
  app.use(sanitizeMiddleware);

  app.use(requestIdMiddleware);

  // Coarse global rate limit (finer per-route/per-user limits added with features).
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  // Liveness/readiness — no auth, minimal info.
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  });

  // Versioned API.
  app.use(API_PREFIX, v1Router);

  // 404 + centralized error handler (must be last).
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
