import { forwardRef, type SelectHTMLAttributes, type ReactNode } from 'react';
import { FIELD_CLASS, fieldTone } from './Input';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: ReactNode;
}

/** A labelled select, focused the same way as Input (see there). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, className = '', id, children, ...props },
  ref,
) {
  const selectId = id ?? props.name;
  return (
    <div className="group/field flex flex-col gap-1">
      {label && (
        <label
          htmlFor={selectId}
          className="text-sm font-medium text-gray-700 transition-colors duration-200 group-focus-within/field:text-brand-300 motion-reduce:transition-none"
        >
          {label}
        </label>
      )}
      <select
        id={selectId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        // The open list takes the surface too: Windows draws it with the
        // options' own colours, and they would otherwise be the page's.
        className={[
          FIELD_CLASS,
          fieldTone(!!error),
          '[&>option]:bg-surface [&>option]:text-gray-900',
          className,
        ].join(' ')}
        {...props}
      >
        {children}
      </select>
      {error && <span className="m-fade text-xs text-red-300">{error}</span>}
    </div>
  );
});
