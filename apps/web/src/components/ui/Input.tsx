/**
 * Labelled text input.
 *
 * The label is always a real `<label>` bound by id — never a placeholder standing in for one,
 * which disappears as soon as someone types. Errors are wired with `aria-describedby` and
 * `aria-invalid` so a screen reader announces them with the field.
 */
import { useId, type InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: string;
}

export function Input({ label, error, hint, className = '', id, ...rest }: InputProps): JSX.Element {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-neutral-200">
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={[
          'w-full rounded-lg border bg-white/5 px-3.5 py-2.5 text-sm text-neutral-100',
          'placeholder:text-neutral-500 transition duration-200',
          'focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-brand-400',
          error ? 'border-danger-500' : 'border-white/15 hover:border-white/25',
          className,
        ].join(' ')}
      />
      {hint && !error && (
        <p id={hintId} className="text-xs text-neutral-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-danger-500">
          {error}
        </p>
      )}
    </div>
  );
}
