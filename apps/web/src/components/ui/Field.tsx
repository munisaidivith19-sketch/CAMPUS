/**
 * Labelled select and multi-line text primitives, matching `Input`.
 *
 * Same contract: a real `<label>` bound by id, errors announced through `aria-describedby`, a
 * visible focus ring, and design-system tokens only.
 */
import {
  useId,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

const FIELD_CLASS = [
  'w-full rounded-lg border bg-white/5 px-3.5 py-2.5 text-sm text-neutral-100',
  'placeholder:text-neutral-500 transition duration-200',
  'focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-brand-400',
].join(' ');

function FieldShell({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-neutral-200">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-neutral-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger-500">
          {error}
        </p>
      )}
    </div>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  error?: string | null;
  hint?: string;
}

export function Select({
  label,
  options,
  error,
  hint,
  id,
  className = '',
  ...rest
}: SelectProps): JSX.Element {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint}>
      <select
        {...rest}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={`${FIELD_CLASS} ${error ? 'border-danger-500' : 'border-white/15 hover:border-white/25'} ${className}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-neutral-900">
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string | null;
  hint?: string;
}

export function TextArea({
  label,
  error,
  hint,
  id,
  className = '',
  rows = 4,
  ...rest
}: TextAreaProps): JSX.Element {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint}>
      <textarea
        {...rest}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={`${FIELD_CLASS} ${error ? 'border-danger-500' : 'border-white/15 hover:border-white/25'} ${className}`}
      />
    </FieldShell>
  );
}
