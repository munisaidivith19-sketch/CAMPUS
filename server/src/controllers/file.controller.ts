/**
 * File HTTP handlers.
 *
 * Thin: parse, hand to file.service, send. The one handler with real HTTP work is the content
 * download, because the response headers ARE part of the security contract there — the bytes
 * must never be rendered by the browser as a page.
 */
import type { NextFunction, Request, Response } from 'express';
import type { fileContentQuerySchema, fileIdParamSchema } from '@campusconnect/validation';
import { requirePrincipal } from '../middleware/auth.middleware.js';
import { receiveSingleFile } from '../middleware/upload.middleware.js';
import { validatedParams, validatedQuery } from '../middleware/validate.middleware.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { getRequestContext } from '../utils/requestContext.js';
import { logger } from '../utils/logger.js';
import * as fileService from '../services/file.service.js';

export async function postFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const context = getRequestContext(req);
    const file = await receiveSingleFile(req, (incoming) =>
      fileService.uploadFile(principal, incoming, context),
    );
    sendSuccess(res, file, { status: 201 });
  } catch (err) {
    next(err);
  }
}

export async function getFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = validatedParams<typeof fileIdParamSchema>(res);
    sendSuccess(res, await fileService.createDownload(requirePrincipal(req), id));
  } catch (err) {
    next(err);
  }
}

export async function getFileMeta(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = validatedParams<typeof fileIdParamSchema>(res);
    sendSuccess(res, await fileService.getFile(requirePrincipal(req), id));
  } catch (err) {
    next(err);
  }
}

export async function deleteFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = validatedParams<typeof fileIdParamSchema>(res);
    await fileService.deleteOwnFile(requirePrincipal(req), id, getRequestContext(req));
    sendSuccess(res, { status: 'DELETED' });
  } catch (err) {
    next(err);
  }
}

/**
 * Stream the bytes behind a signed URL.
 *
 * - `attachment` + RFC 5987 filename: always a download, never an inline render;
 * - the VERIFIED content type, with `nosniff`, so the browser cannot second-guess it;
 * - `CSP: sandbox`, so even a file a browser did decide to render gets no script, no origin;
 * - `private, no-store`, so nothing caches a file whose access can be revoked.
 */
export async function getFileContent(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = validatedParams<typeof fileIdParamSchema>(res);
    const { token } = validatedQuery<typeof fileContentQuerySchema>(res);
    const content = await fileService.openContent(id, token);

    res.status(200);
    res.setHeader('Content-Type', content.mime);
    res.setHeader('Content-Length', String(content.size));
    res.setHeader('Content-Disposition', content.disposition);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    content.stream.on('error', (err) => {
      logger.error({ err, fileId: id }, 'File stream failed mid-download');
      res.destroy();
    });
    content.stream.pipe(res);
  } catch (err) {
    next(err);
  }
}
