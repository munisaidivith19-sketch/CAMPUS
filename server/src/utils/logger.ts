/** Structured logger (pino). Never log secrets, OTPs, tokens, or plaintext credentials. */
import pino from 'pino';
import { config } from '../config/env.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  transport: config.isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined,
  // Defense in depth: redact common secret-bearing paths if they ever slip into a log call.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.otp',
      '*.refreshToken',
      '*.secret',
    ],
    censor: '[redacted]',
  },
});
