/**
 * Button primitive. Design-system components are the only place raw visual styling is defined
 * (docs/architecture/04-frontend-architecture.md); everything else composes these.
 *
 * Accessibility is part of the primitive, not an afterthought: a visible focus ring, a disabled
 * state that is announced rather than only greyed out, and a busy state that keeps the label
 * readable instead of swapping it for a bare spinner.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  busy?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-500 text-white hover:bg-brand-600 focus-visible:outline-brand-300 shadow-glow disabled:hover:bg-brand-500',
  secondary:
    'bg-white/10 text-neutral-100 border border-white/15 hover:bg-white/15 focus-visible:outline-brand-300',
  ghost: 'text-neutral-300 hover:text-white hover:bg-white/10 focus-visible:outline-brand-300',
  danger: 'bg-danger-500 text-white hover:bg-danger-600 focus-visible:outline-danger-500',
};

export function Button({
  variant = 'primary',
  busy = false,
  fullWidth = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      {...rest}
      disabled={disabled ?? busy}
      aria-busy={busy}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold',
        'transition duration-200 ease-standard',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
        />
      )}
      {children}
    </button>
  );
}
