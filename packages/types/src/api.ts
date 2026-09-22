/** The consistent API response envelope used across the platform. */

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  pagination?: Pagination;
  requestId: string;
}

export interface ApiFailure {
  success: false;
  error: ApiError;
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
