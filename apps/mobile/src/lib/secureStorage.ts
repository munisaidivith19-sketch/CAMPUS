/**
 * Refresh-token storage for the native app (ADR-0006).
 *
 * Native clients cannot use the httpOnly cookie the web app relies on, so the refresh token is
 * held in **Expo SecureStore** — Keychain on iOS, EncryptedSharedPreferences/Keystore on
 * Android — never in AsyncStorage, which is plain unencrypted files readable on a rooted or
 * jailbroken device.
 *
 * The short-lived ACCESS token deliberately stays in memory only: persisting it would widen the
 * window in which a stolen device yields a usable credential, and it can always be re-minted
 * from the refresh token.
 */
import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'campusconnect.refreshToken';

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export async function saveRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function readRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    // A corrupt or inaccessible keychain entry is treated as "signed out", never as an error
    // the user has to resolve.
    return null;
  }
}

export async function clearSession(): Promise<void> {
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}
