// The sidebar, on a phone.
//
// Below `md` a 256px sidebar left the page ~119px of a 375px screen and the
// rest was clipped -- and since the roles came in, employees and the shop's
// tablet work in this layout too, most of them on a phone. There the sidebar
// steps aside (DashboardLayout: `hidden md:flex`) and this takes its place: a
// thin bar across the top with the way to open it, the page's name and the
// way to the other apps, and the sidebar itself as a panel that slides over
// the page from the side it lives on. From `md` up none of this is drawn.
//
// The panel is a modal dialog, with what Modal does (useDialogMotion): focus
// goes into it and back to the button, Tab goes round inside it, Escape and a
// tap on the veil close it, and leaving it is `inert`. On top of that the
// page under it does not scroll while it is open, and it closes by itself
// when a link in it is followed or the window grows past `md`.
//
// Portalled to <body>, for Modal's reason: the page's entrance animates a
// transform, and a fixed layer inside it would be fixed to the page.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useT } from '../../lib/i18n';
import { useReducedMotion } from '../../lib/motion/useReducedMotion';
import {
  dialogKeys,
  useBackdropClose,
  useDialogFocus,
  useInert,
  usePresence,
} from '../motion/useDialogMotion';

/** How long the closed panel stays to slide out (the animation below lasts 220ms). */
const EXIT_MS = 230;

/** Tailwind's `md`: from here up the sidebar is back and the panel has no business open. */
const DESKTOP = '(min-width: 768px)';

interface MobileNavProps {
  /** The page's name, as the sidebar calls it. */
  title: string;
  /** Under it, smaller: the app it is in. */
  subtitle: string;
  /** The way to the launcher, at the bar's far end. */
  switcher: ReactNode;
  /** The sidebar's contents, for the panel; `close` for what in it closes it. */
  children: (close: () => void) => ReactNode;
  /** Not drawn at all (the delivery screen brings its own bar). */
  hidden?: boolean;
}

export function MobileNav({ title, subtitle, switcher, children, hidden = false }: MobileNavProps) {
  const t = useT();
  const reduced = useReducedMotion();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const phase = usePresence(open, EXIT_MS);
  const closing = phase === 'closing';
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();
  useDialogFocus(panel, phase === 'open');
  useInert(root, closing);
  const close = () => {
    if (phase === 'open') setOpen(false);
  };
  const backdropClose = useBackdropClose(close, !closing);

  // A link followed from the panel lands on another page: the panel goes as
  // the page comes, in the same render, never a frame of it over the new one.
  const [shownOn, setShownOn] = useState(pathname);
  if (shownOn !== pathname) {
    setShownOn(pathname);
    if (open) setOpen(false);
  }

  // The window turned into a tablet on its side: the sidebar is back.
  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(DESKTOP);
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [open]);

  // The page under the panel stays where it was.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = before;
    };
  }, [open]);

  // In from the left edge, where the sidebar lives, and back out to it. From
  // script because the stylesheet's sheet (m-sheet-in) comes from the right;
  // nothing at all under reduced motion, where usePresence also skips the exit.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || reduced || typeof el.animate !== 'function') return;
    el.getAnimations().forEach((a) => a.cancel());
    if (phase === 'open') {
      el.animate([{ transform: 'translateX(-100%)' }, { transform: 'none' }], {
        duration: 420,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      });
    } else if (phase === 'closing') {
      el.animate([{ transform: 'none' }, { transform: 'translateX(-100%)' }], {
        duration: 220,
        easing: 'cubic-bezier(0.4, 0, 1, 1)',
        fill: 'forwards',
      });
    }
  }, [phase, reduced]);

  return (
    <>
      {/* Sticky, and outside <main>: main clips its overflow, and sticking
          does not reach past a box that does. Nearly opaque (sc-bar), so the
          page scrolling under it does not read through. */}
      <header
        data-mobile-bar=""
        className={[
          'sc-bar sticky top-0 z-30 h-14 items-center gap-1 px-2',
          hidden ? 'hidden' : 'flex md:hidden',
        ].join(' ')}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('chrome.mobileNav.open')}
          aria-expanded={phase === 'open'}
          aria-controls={panelId}
          aria-haspopup="dialog"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-gray-700 transition-colors hover:bg-white/[0.06] hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300 motion-reduce:transition-none"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10zm0 5.25a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-sm font-semibold text-gray-900">{title}</p>
          <p className="truncate text-xs text-gray-500">{subtitle}</p>
        </div>
        {switcher}
      </header>

      {phase !== 'closed' &&
        createPortal(
          <div
            ref={root}
            aria-hidden={closing ? true : undefined}
            className={['fixed inset-0 z-40 flex md:hidden', closing ? 'pointer-events-none' : ''].join(' ')}
            onKeyDown={(e) => {
              if (!closing) dialogKeys(e, panel.current, close);
            }}
          >
            <div
              aria-hidden="true"
              className={['absolute inset-0 bg-[rgb(4_9_8/0.6)]', closing ? 'm-scrim-out' : 'm-scrim-in'].join(' ')}
              {...backdropClose}
            />
            <div
              ref={panel}
              id={panelId}
              role="dialog"
              aria-modal={closing ? undefined : true}
              aria-labelledby={titleId}
              tabIndex={-1}
              className="m-glass-float relative flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto overscroll-contain border-r border-white/10 focus:outline-none"
              // A link followed from the panel closes it -- the same page's
              // too, where the route does not change. And, as Modal does, a
              // click in here is not a click on what the panel hangs from.
              onClick={(e) => {
                e.stopPropagation();
                if (e.target instanceof Element && e.target.closest('a[href]')) close();
              }}
            >
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] py-1.5 pl-5 pr-2">
                <h2 id={titleId} className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {t('chrome.mobileNav.title')}
                </h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label={t('chrome.mobileNav.close')}
                  className="grid h-11 w-11 place-items-center rounded-xl text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300 motion-reduce:transition-none"
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
              </div>
              {children(close)}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
