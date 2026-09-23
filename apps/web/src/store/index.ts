/** Store composition + typed hooks. */
import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { authApi } from './authApi.js';
import { campusApi } from './campusApi.js';
import { chatApi } from './chatApi.js';
import { authReducer } from './authSlice.js';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    [authApi.reducerPath]: authApi.reducer,
    [campusApi.reducerPath]: campusApi.reducer,
    [chatApi.reducerPath]: chatApi.reducer,
  },
  middleware: (getDefault) =>
    getDefault().concat(authApi.middleware, campusApi.middleware, chatApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
