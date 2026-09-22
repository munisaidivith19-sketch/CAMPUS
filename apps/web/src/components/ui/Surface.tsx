/**
 * Glass surfaces and page scaffolding for the auth screens.
 *
 * The glassmorphism language is applied here once, so screens never hand-roll translucency and
 * the contrast tuning stays in one place (docs/product/DESIGN_SYSTEM.md — glass is used
 * sparingly and never at the cost of readability).
 */
import type { ReactNode } from 'react';

export function GlassPanel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={`glass rounded-2xl p-8 shadow-lg ${className}`}>{children}</section>
  );
}

/** The centred, gradient-backed layout every unauthenticated screen shares. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 via-neutral-950 to-neutral-900 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-accent-400">
            CampusConnect
          </p>
          <h1 className="mt-2 text-2xl font-bold text-neutral-50">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-neutral-300">{subtitle}</p>}
        </div>

        <GlassPanel>{children}</GlassPanel>

        {footer && <div className="mt-6 text-center text-sm text-neutral-400">{footer}</div>}
      </div>
    </main>
  );
}
