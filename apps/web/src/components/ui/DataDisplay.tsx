/**
 * Small display primitives shared by the dashboards.
 *
 * `AttendanceMeter` is the one with a rule in it: the bar is coloured by the same 75% threshold
 * the server applies, and the raw counts are always shown beside the percentage. Showing
 * "38/50" next to "76%" is what lets a student verify the figure rather than take it on trust.
 */
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-neutral-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'neutral' | 'good' | 'warn';
}): JSX.Element {
  const valueTone =
    tone === 'good' ? 'text-success-500' : tone === 'warn' ? 'text-warning-500' : 'text-neutral-50';

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueTone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
}): JSX.Element {
  const tones = {
    neutral: 'bg-white/10 text-neutral-200',
    good: 'bg-success-500/20 text-success-500',
    warn: 'bg-warning-500/20 text-warning-500',
    bad: 'bg-danger-500/20 text-danger-500',
    info: 'bg-brand-500/20 text-brand-200',
  } as const;

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/**
 * An attendance figure with its counts and a bar.
 *
 * `role="meter"` with the ARIA value attributes means a screen reader announces the actual
 * number rather than describing a decorative bar.
 */
export function AttendanceMeter({
  percentage,
  present,
  total,
  threshold,
  label,
}: {
  percentage: number;
  present: number;
  total: number;
  threshold: number;
  label?: string;
}): JSX.Element {
  const below = total > 0 && percentage < threshold;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        {label && <span className="text-sm text-neutral-200">{label}</span>}
        <span
          className={`text-sm font-semibold ${below ? 'text-warning-500' : 'text-neutral-100'}`}
        >
          {total === 0 ? 'No records' : `${percentage}%`}
          {/* The raw counts, so the number can be checked rather than trusted. */}
          <span className="ml-2 font-normal text-neutral-400">
            ({present}/{total})
          </span>
        </span>
      </div>

      <div
        role="meter"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ? `${label} attendance` : 'Attendance'}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-standard ${
            below ? 'bg-warning-500' : 'bg-success-500'
          }`}
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="glass rounded-2xl p-6 shadow-lg">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-neutral-50">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
