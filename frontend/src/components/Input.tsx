import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /**
   * `dark` is the sign-in's own field, kept exactly as it was designed for
   * two fields on an empty stage. The default is the same glass made for a
   * form the app shows all day (FIELD_CLASS).
   */
  tone?: 'light' | 'dark';
}

/**
 * The app's field: the sign-in's glass, with an edge that holds 3:1 against
 * the card (gray-400; the sign-in's white/15 is 1.6:1 -- fine for two fields
 * on an empty stage, too faint for a form read all day). Its skin only, no
 * size or corners: exported for the hand-made fields that cannot be an Input
 * -- a textarea, a box inside a row -- which bring their own.
 */
export const FIELD_SKIN =
  'm-field field-dark border bg-white/[0.04] text-sm text-gray-900 placeholder:text-gray-500 hover:bg-white/[0.06] focus:bg-white/[0.07] focus:outline-none focus:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60';

/** The shape of a full-size field (Input, Select). */
export const FIELD_CLASS = `${FIELD_SKIN} rounded-xl px-3.5 py-2.5`;

/** The edge and ring of a field, fine or refused. */
export function fieldTone(error: boolean): string {
  return error
    ? 'border-red-400/80 hover:border-red-400 focus:border-red-400 focus:ring-red-400/25'
    : 'border-gray-400 hover:border-gray-500 focus:border-brand-400 focus:ring-brand-400/40';
}

/**
 * A labelled text field. On focus the brand's ring grows out from the edge
 * instead of snapping on, and the label takes the brand's colour, so the eye
 * lands on the field being typed into (`m-field`, motion-components.css).
 * With an error the ring and border are red, focused or not.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, tone = 'light', className = '', id, ...props },
  ref,
) {
  const inputId = id ?? props.name;
  const dark = tone === 'dark';
  return (
    <div className="group/field flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className={[
            'text-sm font-medium transition-colors duration-200 motion-reduce:transition-none',
            dark
              ? 'text-white/70 group-focus-within/field:text-brand-300'
              : 'text-gray-700 group-focus-within/field:text-brand-300',
          ].join(' ')}
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={[
          dark
            ? 'm-field field-dark rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 hover:border-white/25 focus:bg-white/[0.09] focus:outline-none focus:ring-[3px] disabled:opacity-60'
            : FIELD_CLASS,
          dark
            ? error
              ? 'border-red-400/70 hover:border-red-400/80 focus:border-red-400 focus:ring-red-400/25'
              : 'focus:border-brand-400 focus:ring-brand-400/25'
            : fieldTone(!!error),
          className,
        ].join(' ')}
        {...props}
      />
      {/* A blank error (' ') only turns the field red: its sentence is the
          caller's, elsewhere, and an empty line here would push the field
          out of line with its neighbours. */}
      {error && error.trim() !== '' && <span className="m-fade text-xs text-red-300">{error}</span>}
    </div>
  );
});
