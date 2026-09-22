/**
 * An RTK Query base query backed by the shared axios instance.
 *
 * RTK Query normally uses `fetch`, but the silent-refresh logic lives in the axios interceptors
 * (src/lib/api.ts). Routing RTK Query through the same instance means cached queries get the
 * same automatic token refresh as any hand-written call — there is only one place that knows
 * how a session is renewed.
 */
import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import { api, type ApiErrorBody } from '../lib/api.js';
import axios, { type AxiosRequestConfig } from 'axios';

export interface AxiosBaseQueryArgs {
  url: string;
  method?: AxiosRequestConfig['method'];
  data?: unknown;
  params?: AxiosRequestConfig['params'];
}

export interface NormalizedApiError {
  status: number | undefined;
  code: string;
  message: string;
  details?: unknown;
}

export const axiosBaseQuery =
  (): BaseQueryFn<AxiosBaseQueryArgs, unknown, NormalizedApiError> =>
  async ({ url, method = 'GET', data, params }) => {
    try {
      const response = await api.request({ url, method, data, params });
      // Unwrap the success envelope so components receive just the payload.
      return { data: response.data?.data ?? response.data };
    } catch (err) {
      if (axios.isAxiosError<ApiErrorBody>(err)) {
        return {
          error: {
            status: err.response?.status,
            code: err.response?.data?.error?.code ?? 'NETWORK_ERROR',
            message: err.response?.data?.error?.message ?? 'Could not reach the server.',
            details: err.response?.data?.error?.details,
          },
        };
      }
      return { error: { status: undefined, code: 'UNKNOWN', message: 'Something went wrong.' } };
    }
  };
