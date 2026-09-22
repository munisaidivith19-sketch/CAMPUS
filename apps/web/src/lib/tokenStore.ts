/**
 * In-memory access-token holder.
 *
 * The access token lives in a module variable, never in localStorage or sessionStorage: anything
 * persisted there is readable by any injected script, and a token that survives a tab reload is
 * a token an attacker can exfiltrate later. Losing it on refresh is fine — the httpOnly refresh
 * cookie silently re-establishes the session on boot.
 *
 * The axios interceptors need this synchronously, which is why it lives here rather than only
 * in the Redux store; the store mirrors it for rendering.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}
