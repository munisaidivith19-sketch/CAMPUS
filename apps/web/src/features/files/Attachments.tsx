/**
 * Attachment UI shared by chat and announcements: the card that shows an attached file, and the
 * picker that uploads new ones.
 *
 * Nothing here renders file content. There is no inline preview — an image is a card like any
 * other file, and "Download" fetches a fresh signed URL each time. Scan status is shown as a
 * text label, never as a colour alone.
 */
import { useCallback, useRef, useState, type DragEvent } from 'react';
import { FileScanStatus, type AttachmentDTO } from '@campusconnect/types';
import { Badge } from '../../components/ui/DataDisplay.js';
import { Button } from '../../components/ui/Button.js';
import { UploadError, downloadFile, formatBytes, precheck, uploadFile } from './fileClient.js';

const SCAN_LABEL: Record<
  FileScanStatus,
  { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }
> = {
  CLEAN: { text: 'Scanned', tone: 'good' },
  SKIPPED: { text: 'Not scanned', tone: 'warn' },
  PENDING: { text: 'Scanning', tone: 'neutral' },
  SCAN_FAILED: { text: 'Scan failed', tone: 'bad' },
  INFECTED: { text: 'Blocked', tone: 'bad' },
};

export function AttachmentCard({ attachment }: { attachment: AttachmentDTO }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = SCAN_LABEL[attachment.scanStatus];
  const downloadable =
    attachment.scanStatus === FileScanStatus.CLEAN ||
    attachment.scanStatus === FileScanStatus.SKIPPED;

  const onDownload = (): void => {
    setBusy(true);
    setError(null);
    downloadFile(attachment.id)
      .catch(() => setError('This file is no longer available to you.'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left">
      <div className="min-w-0 flex-1">
        {/* The name is text, escaped by React; it was sanitized server-side as well. */}
        <p className="truncate text-sm text-neutral-100" title={attachment.name}>
          {attachment.name}
        </p>
        <p className="flex items-center gap-2 text-xs text-neutral-400">
          <span>{formatBytes(attachment.size)}</span>
          <Badge tone={label.tone}>{label.text}</Badge>
        </p>
        {error && (
          <p role="alert" className="text-xs text-danger-500">
            {error}
          </p>
        )}
      </div>
      <Button
        variant="secondary"
        onClick={onDownload}
        disabled={!downloadable}
        busy={busy}
        aria-label={`Download ${attachment.name}`}
      >
        Download
      </Button>
    </div>
  );
}

export function AttachmentList({
  attachments,
}: {
  attachments: AttachmentDTO[];
}): JSX.Element | null {
  if (attachments.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2" aria-label="Attachments">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <AttachmentCard attachment={attachment} />
        </li>
      ))}
    </ul>
  );
}

// --- Uploading -------------------------------------------------------------------

export interface PendingUpload {
  localId: string;
  name: string;
  size: number;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  fileId: string | null;
  error: string | null;
  controller: AbortController;
}

/** Upload state for one composer or form. `readyIds` is what gets sent. */
export function useAttachmentUploads(max: number): {
  uploads: PendingUpload[];
  readyIds: string[];
  busy: boolean;
  add: (files: FileList | File[]) => void;
  remove: (localId: string) => void;
  reset: () => void;
} {
  const [uploads, setUploads] = useState<PendingUpload[]>([]);

  const patch = useCallback((localId: string, change: Partial<PendingUpload>) => {
    setUploads((current) =>
      current.map((item) => (item.localId === localId ? { ...item, ...change } : item)),
    );
  }, []);

  // Mirrors `uploads` so `add` can count free slots without doing its work inside a state
  // updater — React may run an updater twice, and an upload must start exactly once.
  const uploadsRef = useRef<PendingUpload[]>([]);
  uploadsRef.current = uploads;

  const add = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files);
      const active = uploadsRef.current.filter((item) => item.status !== 'error').length;
      const room = Math.max(0, max - active);

      const entry = (file: File, error: string | null): PendingUpload => ({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        size: file.size,
        progress: 0,
        status: error ? 'error' : 'uploading',
        fileId: null,
        error,
        controller: new AbortController(),
      });

      const accepted = incoming
        .slice(0, room)
        .map((file) => ({ file, item: entry(file, precheck(file)?.message ?? null) }));
      const refused = incoming
        .slice(room)
        .map((file) => entry(file, `At most ${max} attachments.`));
      const added = [...accepted.map(({ item }) => item), ...refused];
      uploadsRef.current = [...uploadsRef.current, ...added];
      setUploads((current) => [...current, ...added]);

      for (const { file, item } of accepted) {
        if (item.status === 'error') continue;
        uploadFile(file, {
          signal: item.controller.signal,
          onProgress: (fraction) => patch(item.localId, { progress: fraction }),
        })
          .then((dto) => patch(item.localId, { status: 'done', progress: 1, fileId: dto.id }))
          .catch((err: unknown) =>
            patch(item.localId, {
              status: 'error',
              error: err instanceof UploadError ? err.message : 'Upload failed.',
            }),
          );
      }
    },
    [max, patch],
  );

  const remove = useCallback((localId: string) => {
    uploadsRef.current.find((item) => item.localId === localId)?.controller.abort();
    setUploads((current) => current.filter((item) => item.localId !== localId));
  }, []);

  const reset = useCallback(() => setUploads([]), []);

  return {
    uploads,
    readyIds: uploads
      .filter((item) => item.status === 'done' && item.fileId)
      .map((item) => item.fileId as string),
    busy: uploads.some((item) => item.status === 'uploading'),
    add,
    remove,
    reset,
  };
}

/** The attach button, drop zone and per-file progress list. */
export function AttachmentPicker({
  uploads,
  onAdd,
  onRemove,
  disabled,
}: {
  uploads: PendingUpload[];
  onAdd: (files: FileList | File[]) => void;
  onRemove: (localId: string) => void;
  disabled?: boolean;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (!disabled && event.dataTransfer.files.length > 0) onAdd(event.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`rounded-lg border border-dashed px-3 py-2 ${dragging ? 'border-brand-300 bg-brand-500/10' : 'border-white/15'}`}
    >
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Attach files
        </Button>
        <span className="text-xs text-neutral-500">or drop them here · up to 25 MB each</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          aria-label="Choose files to attach"
          tabIndex={-1}
          onChange={(event) => {
            if (event.target.files) onAdd(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {uploads.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-live="polite">
          {uploads.map((item) => (
            <li key={item.localId} className="flex items-center gap-3 text-xs">
              <span className="min-w-0 flex-1 truncate text-neutral-200" title={item.name}>
                {item.name} <span className="text-neutral-500">({formatBytes(item.size)})</span>
              </span>
              {item.status === 'uploading' && (
                <span className="flex items-center gap-2 text-neutral-400">
                  <progress
                    className="h-1.5 w-24"
                    max={1}
                    value={item.progress}
                    aria-label={`Uploading ${item.name}`}
                  />
                  {Math.round(item.progress * 100)}%
                </span>
              )}
              {item.status === 'done' && <span className="text-success-500">Ready</span>}
              {item.status === 'error' && (
                <span role="alert" className="text-danger-500">
                  {item.error}
                </span>
              )}
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-neutral-400 underline hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
                onClick={() => onRemove(item.localId)}
                aria-label={
                  item.status === 'uploading'
                    ? `Cancel upload of ${item.name}`
                    : `Remove ${item.name}`
                }
              >
                {item.status === 'uploading' ? 'Cancel' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
