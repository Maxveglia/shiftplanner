import type { HTMLAttributes, ReactNode } from 'react';
import { trackPointerLight } from './motion/pointerLight';

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A panel of the page. It rises into place out of a slight blur when the page
 * opens (`m-rise`, one after another when several sit side by side: see
 * `.m-card` in motion-components.css), and a soft light in the brand's green
 * follows the pointer across it (`m-light`, painted in the card's own
 * background). Neither holds on once done: the entrance leaves no transform
 * behind, and the light changes nothing about how the card is positioned or
 * stacked -- no `relative`, no `isolate` -- so what is inside a card (a
 * tooltip, a label) still layers over the cards beside it as before.
 *
 * It is the login's glass (`m-glass`, motion-components.css): a dark tint the
 * stage glows through at the edges, a thin light rim, generous corners.
 */
export function Card({
  title,
  actions,
  children,
  className = '',
  onPointerMove,
  ...rest
}: CardProps) {
  return (
    <section
      {...rest}
      className={[
        'm-card m-light m-rise m-glass rounded-2xl border border-white/[0.08]',
        className,
      ].join(' ')}
      onPointerMove={(e) => {
        onPointerMove?.(e);
        trackPointerLight(e);
      }}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          {typeof title === 'string' ? (
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          ) : (
            title
          )}
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
