/**
 * Refresh-token transport.
 *
 * Web clients get the refresh token as an **httpOnly** cookie, so JavaScript — including
 * injected JavaScript — cannot read it. Native clients cannot use cookies, so they opt in with
 * `X-Client: mobile` and receive the token in the JSON body, where Expo SecureStore holds it
 * (ADR-0006).
 *
 * CSRF: the cookie is `SameSite=Lax` and every route that consumes it is a POST, so a
 * cross-site form or image cannot trigger a refresh with the victim's cookie attached. `Secure`
 * is set outside development, where the app is served over TLS.
 */
import type { Request, Response } from 'express';
import { config } from '../config/env.js';
import { refreshTokenTtlSeconds } from '../services/token.service.js';

export const REFRESH_COOKIE_NAME = 'cc_refresh';

/** Scoping the cookie to the auth routes keeps it off every other API request. */
const COOKIE_PATH = '/api/v1/auth';

export function isNativeClient(req: Request): boolean {
  return (req.header('x-client') ?? '').toLowerCase() === 'mobile';
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: refreshTokenTtlSeconds() * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: COOKIE_PATH,
  });
}

/** Read the refresh token from wherever this client keeps it. */
export function readRefreshToken(req: Request, bodyToken?: string): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return bodyToken ?? cookies?.[REFRESH_COOKIE_NAME];
}
