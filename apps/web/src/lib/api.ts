/**
 * Axios instance for the web client, with the silent-refresh interceptor.
 *
 * Reads only VITE_* config — never a secret. `withCredentials` matters: the refresh token is an
 * httpOnly cookie the browser attaches automatically and JavaScript cannot read.
 *
 * On a 401 the interceptor tries `/auth/refresh` exactly once and replays the original request.
 * Two details keep that from misbehaving:
 *  - concurrent 401s share ONE refresh promise, so a page firing several requests does not
 *    trigger several rotations (which reuse detection would treat as a stolen token);
 *  - the refresh call itself is never retried, or a failure would recurse forever.
 */
import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { UserDTO } from '@campusconnect/types';
import { clearAccessToken, getAccessToken, setAccessToken } from './tokenStore.js';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export const api = axios.create({
  baseURL,
  withCredentials: true, // sends the httpOnly refresh cookie on /auth routes
  timeout: 15_000,
});

/** The shape the API always answers with (docs/api/API.md). */
export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.set('authorization', `Bearer ${token}`);
  return config;
});

/** Shared in-flight refresh, so parallel 401s rotate the refresh token only once. */
let refreshInFlight: Promise<string | null> | null = null;

/** Called when refreshing fails, so the app can drop to the login screen. */
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

async function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      // A bare axios call: it must not pass back through this interceptor.
      const response = await axios.post<{ data: { tokens: { accessToken: string } } }>(
        `${baseURL}/auth/refresh`,
        {},
        { withCredentials: true, timeout: 15_000 },
      );
      const token = response.data.data.tokens.accessToken;
      setAccessToken(token);
      return token;
    } catch {
      clearAccessToken();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;
    const url = original?.url ?? '';

    // Only a genuine 401 on a non-auth route is worth a silent refresh. A failed login must
    // surface to the form, and refreshing the refresh call itself would recurse.
    const isRefreshable =
      status === 401 && original && !original._retried && !url.includes('/auth/refresh') && !url.includes('/auth/login');

    if (!isRefreshable) return Promise.reject(error);

    original._retried = true;
    const token = await refreshAccessToken();

    if (!token) {
      onSessionExpired?.();
      return Promise.reject(error);
    }

    original.headers.set('authorization', `Bearer ${token}`);
    return api.request(original as AxiosRequestConfig);
  },
);

/**
 * Restore a session on boot using the refresh cookie.
 *
 * The refresh response already carries the user, so this avoids a second round trip to /me.
 * Returns null when there is no valid cookie — the normal "signed out" case, not an error.
 */
export async function bootstrapSession(): Promise<{ user: UserDTO; accessToken: string } | null> {
  try {
    const response = await axios.post<{ data: { user: UserDTO; tokens: { accessToken: string } } }>(
      `${baseURL}/auth/refresh`,
      {},
      { withCredentials: true, timeout: 15_000 },
    );
    const { user, tokens } = response.data.data;
    setAccessToken(tokens.accessToken);
    return { user, accessToken: tokens.accessToken };
  } catch {
    clearAccessToken();
    return null;
  }
}

/** Pull the API's stable error code out of an axios failure, for UI branching. */
export function apiErrorCode(error: unknown): string | null {
  if (axios.isAxiosError<ApiErrorBody>(error)) return error.response?.data?.error?.code ?? null;
  return null;
}

/** A human-readable message for a failed request, preferring the server's own wording. */
export function apiErrorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return error.response?.data?.error?.message ?? fallback;
  }
  return fallback;
}
