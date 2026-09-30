// A dialog over the page.
//
// Portalled to <body>. Rendered where it is used it was `position: fixed`
// inside the page, and a fixed element is only fixed to the window while no
// ancestor has a transform or a filter: the page's entrance animates both, and
// a dialog opened during it would have been placed against the content column
// instead of the window, off centre. Out here nothing above it moves.
//
// It arrives and leaves rather than blinking: the page behind dims, the panel
// rises out of a slight blur (`m-pop`), and on close it stays mounted for
// EXIT_MS so it can go the way it came. The dimming is a dark tint and not a
// backdrop blur: on the dark stage a blur re-blurs the drifting washes behind
// every frame the dialog is open, and the tint already quiets the page. The
// panel is the login's card, near-solid (`m-glass-float`). Escape and a
// click on the backdrop close it; focus goes into it on open and back to the
// opener on close, and Tab goes round inside it while it is open.
//
// Leaving, it is `inert` and no longer `aria-modal`: nothing in it answers a
// key or a click any more (its buttons would otherwise run their action a
// second time), screen readers stop announcing a dialog, and the calendar
// behind, which ignores keys while a modal is open, gets them back at once.
//
// So keep it mounted and pass `open={false}` to close it: taken off the page
// (`{x && <Modal open />}`) it has nothing left to play its exit with. A
// dialog that changes what it says -- the publish confirmation turning into
// its receipt -- is one Modal with new content, not one Modal swapped for
// another, so the backdrop stays put and focus stays inside.

import { useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../lib/i18n';
import {
  dialogKeys,
  useBackdropClose,
  useDialogFocus,
  useInert,
  usePresence,
} from './motion/useDialogMotion';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** How long a closed dialog stays to play its exit; .m-pop-out lasts 170ms. */
const EXIT_MS = 180;

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const t = useT();
  const phase = usePresence(open, EXIT_MS);
  const closing = phase === 'closing';
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(panel, phase === 'open');
  useInert(root, closing);
  // Closing is asked for once: Escape, the cross or the backdrop during the
  // exit do nothing (onClose is not idempotent for every caller).
  const close = () => {
    if (phase === 'open') onClose();
  };
  const backdropClose = useBackdropClose(close, !closing);

  if (phase === 'closed') return null;

  return createPortal(
    <div
      ref={root}
      aria-hidden={closing ? true : undefined}
      // While it leaves, clicks go through to the page: the manager has
      // already moved on, and the fading panel must not catch the next one.
      className={[
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        closing ? 'pointer-events-none' : '',
      ].join(' ')}
      onKeyDown={(e) => {
        if (!closing) dialogKeys(e, panel.current, close);
      }}
    >
      <div
        aria-hidden="true"
        className={[
          'absolute inset-0 bg-[rgb(4_9_8/0.72)]',
          closing ? 'm-scrim-out' : 'm-scrim-in',
        ].join(' ')}
        {...backdropClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal={closing ? undefined : true}
        aria-labelledby={titleId}
        tabIndex={-1}
        className={[
          'm-glass-float relative w-full max-w-lg rounded-2xl border border-white/10 focus:outline-none',
          closing ? 'm-pop-out' : 'm-pop',
        ].join(' ')}
        style={{ '--origin': '50% 60%' } as CSSProperties}
        // As before: a click inside the panel is not a click on whatever the
        // dialog was rendered inside of (a row, a card), which React would
        // otherwise hand it to through the portal.
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-gray-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label={t('common.modal.close')}
            className="rounded-lg p-1 text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
              className="m-close-x"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
