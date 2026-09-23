/**
 * Client-side session state.
 *
 * This slice is presentation state: who is signed in, so the UI can render a name and decide
 * which links to show. It is NOT a security boundary — the access token it mirrors is verified
 * server-side on every request, and every permission in `user.permissions` is re-checked there
 * too. Editing this store in devtools changes what the UI draws and nothing else.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { UserDTO } from '@campusconnect/types';
import { clearAccessToken, setAccessToken } from '../lib/tokenStore.js';
import { closeSocket } from '../lib/socket.js';

export type AuthStatus = 'booting' | 'authenticated' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  user: UserDTO | null;
}

const initialState: AuthState = { status: 'booting', user: null };

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    sessionEstablished(state, action: PayloadAction<{ user: UserDTO; accessToken: string }>) {
      setAccessToken(action.payload.accessToken);
      state.status = 'authenticated';
      state.user = action.payload.user;
    },
    /** The user object refreshed without a new token (e.g. after PATCH /me). */
    userUpdated(state, action: PayloadAction<UserDTO>) {
      state.user = action.payload;
      state.status = 'authenticated';
    },
    sessionEnded(state) {
      clearAccessToken();
      // The socket authenticated with the token that just went away; leaving it open would keep
      // a signed-out tab receiving messages until the server happened to drop it.
      closeSocket();
      state.status = 'anonymous';
      state.user = null;
    },
    bootFinishedAnonymous(state) {
      state.status = 'anonymous';
      state.user = null;
    },
  },
});

export const { sessionEstablished, userUpdated, sessionEnded, bootFinishedAnonymous } = authSlice.actions;
export const authReducer = authSlice.reducer;
