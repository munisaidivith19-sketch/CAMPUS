/**
 * Loading, empty and error states.
 *
 * Every data-driven view is required to implement all three
 * (docs/architecture/04-frontend-architecture.md), so they exist as primitives rather than
 * being improvised per screen. `Alert` uses `role="alert"` for errors so the message is
 * announced the moment it appears.
 */
import type { ReactNode } from 'react';

type Tone = 'error' | 'success' | 'info' | 'warning';

const TONES: Record<Tone, string> = {
  error: 'border-danger-500/40 bg-danger-500/10 text-danger-500',
  success: 'border-success-500/40 bg-success-500/10 text-success-500',
  info: 'border-brand-400/40 bg-brand-500/10 text-brand-200',
  warning: 'border-warning-500/40 bg-warning-500/10 text-warning-500',
};

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3.5 py-3 text-sm ${TONES[tone]}`}
    >
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-3 py-8 text-sm text-neutral-400">
      <span
        aria-hidden="true"
        className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-brand-400"
      />
      <span>{label}</span>
    </div>
  );
}

/** Skeleton rows for list views while data loads. */
export function SkeletonRows({ rows = 3 }: { rows?: number }): JSX.Element {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-lg bg-white/5" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-white/15 px-4 py-10 text-center">
      <p className="text-sm font-medium text-neutral-200">{title}</p>
      {description && <p className="mt-1 text-sm text-neutral-400">{description}</p>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger-500/40 bg-danger-500/10 px-4 py-6 text-center"
    >
      <p className="text-sm text-danger-500">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 text-sm font-medium text-brand-200 underline underline-offset-4 hover:text-white"
        >
          Try again
        </button>
      )}
    </div>
  );
}
