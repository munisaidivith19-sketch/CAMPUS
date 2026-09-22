/**
 * Per-request client context: IP, user agent, a human-readable device label, and a device
 * fingerprint.
 *
 * The fingerprint is a *signal* used to decide whether to challenge a new device — never an
 * authorization input. It is deliberately coarse and non-reversible; treating it as a secret
 * or as proof of identity would be a mistake, since a client fully controls its user agent.
 */
import type { Request } from 'express';
import { deviceFingerprint } from './crypto.js';

export interface RequestContext {
  ip: string;
  userAgent: string;
  device: string;
  fingerprint: string;
}

/** Best-effort, dependency-free device label for the "My Devices" list. */
export function describeDevice(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  const platform = ua.includes('windows')
    ? 'Windows'
    : ua.includes('android')
      ? 'Android'
      : ua.includes('iphone') || ua.includes('ipad')
        ? 'iOS'
        : ua.includes('mac os') || ua.includes('macintosh')
          ? 'macOS'
          : ua.includes('linux')
            ? 'Linux'
            : 'Unknown platform';

  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('chrome/') && !ua.includes('chromium')
      ? 'Chrome'
      : ua.includes('firefox/')
        ? 'Firefox'
        : ua.includes('safari/') && !ua.includes('chrome/')
          ? 'Safari'
          : ua.includes('expo') || ua.includes('okhttp')
            ? 'Mobile app'
            : 'Unknown browser';

  return `${browser} on ${platform}`;
}

export function getRequestContext(req: Request): RequestContext {
  // `trust proxy` is configured in app.ts, so req.ip already accounts for X-Forwarded-For.
  const ip = req.ip ?? 'unknown';
  const userAgent = (req.header('user-agent') ?? 'unknown').slice(0, 400);
  return {
    ip,
    userAgent,
    device: describeDevice(userAgent),
    fingerprint: deviceFingerprint(userAgent, ip),
  };
}
