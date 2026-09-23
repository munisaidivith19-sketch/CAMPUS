/**
 * Mobile API client.
 *
 * Identical contract to the web client with one difference: it identifies itself with
 * `X-Client: mobile`, which makes the server return the refresh token in the response body
 * instead of setting a cookie. That token goes straight into SecureStore and is rotated on
 * every refresh, exactly as on web.
 *
 * Only EXPO_PUBLIC_* configuration is read here — anything else would be bundled into the app
 * and is therefore not a secret.
 */
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { LoginResponseDTO, UserDTO } from '@campusconnect/types';
import {
  clearSession,
  getAccessToken,
  readRefreshToken,
  saveRefreshToken,
  setAccessToken,
} from './secureStorage.js';

const baseURL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export const api = axios.create({
  baseURL,
  timeout: 15_000,
  headers: { 'x-client': 'mobile' },
});

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.set('authorization', `Bearer ${token}`);
  return config;
});

let refreshInFlight: Promise<string | null> | null = null;

/** Exchange the stored refresh token for a fresh pair, persisting the rotated token. */
async function refreshSession(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const stored = await readRefreshToken();
      if (!stored) return null;

      const response = await axios.post<{ data: { tokens: { accessToken: string; refreshToken?: string } } }>(
        `${baseURL}/auth/refresh`,
        { refreshToken: stored },
        { timeout: 15_000, headers: { 'x-client': 'mobile' } },
      );

      const { accessToken, refreshToken } = response.data.data.tokens;
      setAccessToken(accessToken);
      // Rotation: the old token is already dead server-side, so persist the new one or the
      // next refresh would replay a retired token and trip reuse detection.
      if (refreshToken) await saveRefreshToken(refreshToken);
      return accessToken;
    } catch {
      await clearSession();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const url = original?.url ?? '';

    const isRefreshable =
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !url.includes('/auth/refresh') &&
      !url.includes('/auth/login');

    if (!isRefreshable) return Promise.reject(error);

    original._retried = true;
    const token = await refreshSession();
    if (!token) return Promise.reject(error);

    original.headers.set('authorization', `Bearer ${token}`);
    return api.request(original);
  },
);

export async function login(email: string, password: string): Promise<LoginResponseDTO> {
  const response = await api.post<{ data: LoginResponseDTO }>('/auth/login', { email, password });
  const result = response.data.data;

  if (result.status === 'AUTHENTICATED') {
    setAccessToken(result.tokens.accessToken);
    if (result.tokens.refreshToken) await saveRefreshToken(result.tokens.refreshToken);
  }

  return result;
}

export async function fetchMe(): Promise<UserDTO> {
  const response = await api.get<{ data: UserDTO }>('/me');
  return response.data.data;
}

/** Restore a session at app start from the token in SecureStore. */
export async function restoreSession(): Promise<UserDTO | null> {
  const token = await refreshSession();
  if (!token) return null;
  try {
    return await fetchMe();
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    // Local state is cleared even if the server call fails, so the device never keeps a token
    // the user believes they signed out of.
    await clearSession();
  }
}
