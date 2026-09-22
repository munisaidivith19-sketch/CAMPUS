/** QR verification route — used by security, faculty and mentors to check a digital ID. */
import { Router } from 'express';
import { Permission } from '@campusconnect/types';
import { qrVerifySchema } from '@campusconnect/validation';
import * as qrController from '../../controllers/qr.controller.js';
import { authenticate, resolveTenant } from '../../middleware/auth.middleware.js';
import { authorize } from '../../middleware/authorize.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';

export const qrRouter = Router();

qrRouter.use(authenticate, resolveTenant);

qrRouter.post(
  '/verify',
  authorize({ anyOf: [Permission.QR_VERIFY] }),
  validate({ body: qrVerifySchema }),
  qrController.verifyQr,
);
