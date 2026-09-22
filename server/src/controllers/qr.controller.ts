/** QR verification handler (security guard / faculty scanning a student ID). */
import type { NextFunction, Request, Response } from 'express';
import type { qrVerifySchema } from '@campusconnect/validation';
import { requirePrincipal } from '../middleware/auth.middleware.js';
import { validatedBody } from '../middleware/validate.middleware.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { getRequestContext } from '../utils/requestContext.js';
import { verifyQrToken } from '../services/qr.service.js';

export async function verifyQr(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const principal = requirePrincipal(req);
    const { token } = validatedBody<typeof qrVerifySchema>(res);

    // The scanner's own institution comes from their principal — never from the scanned payload.
    sendSuccess(
      res,
      await verifyQrToken(principal.institutionId, principal.userId, token, getRequestContext(req)),
    );
  } catch (err) {
    next(err);
  }
}
