/**
 * File routes.
 *
 * `POST /files` runs: authenticate → tenant → `file:upload` → per-user upload rate limit →
 * the pipeline in file.service (quota, size, type, magic bytes, archive limits, malware scan).
 *
 * `GET /files/:id/content` is the one route without a bearer token: it is what a browser
 * navigates to for a download, so it is authorized by its short-lived signed token instead —
 * and the service still re-checks the token's user against the file before streaming.
 */
import { Router } from 'express';
import { Permission } from '@campusconnect/types';
import { fileContentQuerySchema, fileIdParamSchema } from '@campusconnect/validation';
import * as files from '../../controllers/file.controller.js';
import { authenticate, resolveTenant } from '../../middleware/auth.middleware.js';
import { authorize } from '../../middleware/authorize.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { fileDownloadLimiter, uploadLimiter } from '../../middleware/rateLimit.middleware.js';

/**
 * The token-authorized download. Its own router so it can be mounted AHEAD of the routers that
 * apply `authenticate` to everything beneath them — a browser download carries no bearer token.
 */
export const fileContentRouter = Router();

fileContentRouter.get(
  '/files/:id/content',
  fileDownloadLimiter,
  validate({ params: fileIdParamSchema, query: fileContentQuerySchema }),
  files.getFileContent,
);

export const fileRouter = Router();

fileRouter.post(
  '/files',
  authenticate,
  resolveTenant,
  authorize({ anyOf: [Permission.FILE_UPLOAD] }),
  uploadLimiter,
  files.postFile,
);

fileRouter.get(
  '/files/:id',
  authenticate,
  resolveTenant,
  authorize({ anyOf: [Permission.FILE_READ] }),
  validate({ params: fileIdParamSchema }),
  files.getFile,
);

fileRouter.get(
  '/files/:id/meta',
  authenticate,
  resolveTenant,
  authorize({ anyOf: [Permission.FILE_READ] }),
  validate({ params: fileIdParamSchema }),
  files.getFileMeta,
);

fileRouter.delete(
  '/files/:id',
  authenticate,
  resolveTenant,
  authorize({ anyOf: [Permission.FILE_UPLOAD] }),
  validate({ params: fileIdParamSchema }),
  files.deleteFile,
);
