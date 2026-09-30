import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { rippleFrame } from '../lib/motion/componentsMotion';
import { useRipple } from './motion/useRipple';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

// `m-btn-glow` lifts the primary on hover with a shadow in the brand's own
// green; `m-btn-quiet` tints the ripple of the light buttons green too, where
// their grey text would leave a grey smudge (motion-components.css).
//
// Every focus ring is menta-light (brand-300, 10:1 on the ground): a ring in
// the button's own colour -- green round green, red round red -- was the
// login's lesson, and on this ground a grey one all but vanished.
const variantClasses: Record<Variant, string> = {
  primary:
    'm-btn-glow bg-brand-600 text-white hover:bg-brand-deep disabled:bg-brand-600/50',
  secondary:
    'm-btn-quiet bg-white/[0.04] text-gray-800 border border-white/15 hover:border-white/25 hover:bg-white/[0.08]',
  danger:
    'bg-danger text-white shadow-[0_8px_24px_-14px_rgb(239_68_68/0.6)] hover:bg-danger-hover disabled:bg-danger/50 disabled:shadow-none',
  ghost:
    'm-btn-quiet bg-transparent text-gray-600 hover:bg-white/[0.06] hover:text-gray-900',
};

// Rounder than the old paper buttons, as the login's are; the small ones a
// step less, so a row of them in a table does not read as a row of pills.
const sizeClasses: Record<Size, string> = {
  sm: 'rounded-lg px-2.5 py-1.5 text-xs',
  md: 'rounded-xl px-4 py-2 text-sm',
};

/**
 * The app's button. A press answers where it landed -- a ripple grows from
 * the pointer -- and the button gives a little under it (`m-press`); both
 * stop under reduced motion. A caller's own `onPointerDown` runs first, and
 * one that calls `preventDefault()` gets no ripple.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  onPointerDown,
  ...props
}: ButtonProps) {
  const ripple = useRipple<HTMLButtonElement>();
  const frame = rippleFrame(className);
  return (
    <button
      {...props}
      className={[
        'inline-flex items-center justify-center gap-2 font-medium',
        'm-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300',
        'disabled:cursor-not-allowed disabled:opacity-70',
        frame ?? '',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(' ')}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        if (frame && !e.defaultPrevented && !e.currentTarget.disabled) ripple.onPointerDown(e);
      }}
    >
      {frame && ripple.ripples}
      {children}
    </button>
  );
}
