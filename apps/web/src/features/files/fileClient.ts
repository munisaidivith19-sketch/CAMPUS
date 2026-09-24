/**
 * File transfer for the web client.
 *
 * Uploads go through the shared axios instance (so they get the same silent token refresh as
 * everything else) with progress and cancellation. Downloads never build a URL themselves: they
 * ask the server for a short-lived signed URL, which re-authorizes on every request, and then
 * navigate to it.
 */
import axios from 'axios';
import { UPLOAD } from '@campusconnect/config';
import type { FileDTO, FileDownloadDTO } from '@campusconnect/types';
import { api, type ApiErrorBody } from '../../lib/api.js';

export class UploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Friendly wording for the pipeline's stable error codes. */
const MESSAGES: Record<string, string> = {
  PAYLOAD_TOO_LARGE: 'This file is larger than the 25 MB limit.',
  QUOTA_EXCEEDED: 'This would go over your storage allowance. Delete some unattached files first.',
  UNSUPPORTED_MEDIA_TYPE: 'This type of file is not allowed, or its contents did not match its type.',
  MALWARE_DETECTED: 'The malware scanner rejected this file.',
  SCAN_FAILED: 'The malware scanner is unavailable, so this file was held and cannot be shared yet.',
  RATE_LIMITED: 'Too many uploads — try again later.',
  CANCELLED: 'Upload cancelled.',
};

/** A client-side pre-check for a better message. The server decides regardless. */
export function precheck(file: File): UploadError | null {
  if (file.size > UPLOAD.MAX_BYTES) return new UploadError('PAYLOAD_TOO_LARGE', MESSAGES.PAYLOAD_TOO_LARGE ?? '');
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!(UPLOAD.ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
    return new UploadError('UNSUPPORTED_MEDIA_TYPE', MESSAGES.UNSUPPORTED_MEDIA_TYPE ?? '');
  }
  return null;
}

export async function uploadFile(
  file: File,
  options: { signal: AbortSignal; onProgress: (fraction: number) => void },
): Promise<FileDTO> {
  const form = new FormData();
  form.append('file', file, file.name);
  try {
    const response = await api.post<{ data: FileDTO }>('/files', form, {
      signal: options.signal,
      // Large files on a slow connection take longer than the default request timeout.
      timeout: 0,
      onUploadProgress: (event) => {
        if (event.total) options.onProgress(event.loaded / event.total);
      },
    });
    return response.data.data;
  } catch (err) {
    if (axios.isCancel(err)) throw new UploadError('CANCELLED', MESSAGES.CANCELLED ?? '');
    if (axios.isAxiosError<ApiErrorBody>(err)) {
      const code = err.response?.data?.error?.code ?? 'NETWORK_ERROR';
      throw new UploadError(code, MESSAGES[code] ?? err.response?.data?.error?.message ?? 'Upload failed.');
    }
    throw new UploadError('UNKNOWN', 'Upload failed.');
  }
}

/** Ask for a signed URL, then let the browser download it. */
export async function downloadFile(fileId: string): Promise<void> {
  const response = await api.get<{ data: FileDownloadDTO }>(`/files/${fileId}`);
  const origin = new URL(api.defaults.baseURL ?? window.location.origin, window.location.origin).origin;
  const target = new URL(response.data.data.url, origin);
  // Same tab: the response is `Content-Disposition: attachment`, so the page stays put.
  window.location.assign(target.toString());
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
