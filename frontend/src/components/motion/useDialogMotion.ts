// What a layer over the page needs in order to arrive and leave instead of
// blinking in and out, without losing the keyboard on the way: used by Modal
// and by the assistant's panel.
//
// The exit needs the dialog to stay mounted while it plays, so callers keep
// it mounted and pass `open={false}` rather than taking it off the page; a
// caller whose content comes and goes with a value keeps showing the last one
// with useLastShown.
//
// The decisions are pure and tested in lib/motion/componentsMotion.ts; this
// file only holds the timers, the refs and the DOM they act on.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import {
  canTakeFocus,
  inTabOrder,
  lastShown,
  nextPresence,
  wrapFocus,
  tabFromBetween,
  type Presence,
} from '../../lib/motion/componentsMotion';
import { useReducedMotion } from '../../lib/motion/useReducedMotion';

/**
 * `open` as a dialog lives it: `closing` for `exitMs` after the caller closes
 * it, so the exit can play, then `closed`. Under reduced motion there is no
 * exit and it closes at once, as it always did.
 */
export function usePresence(open: boolean, exitMs: number): Presence {
  const reduced = useReducedMotion();
  const ms = reduced ? 0 : exitMs;
  const [phase, setPhase] = useState<Presence>(open ? 'open' : 'closed');
  const next = nextPresence(phase, open, ms);
  // Derived during render (React allows a component to update its own state
  // here), so the frame the caller opens in is already the open one.
  if (next !== phase) setPhase(next);

  useEffect(() => {
    if (phase !== 'closing') return;
    const id = window.setTimeout(() => setPhase('closed'), ms);
    return () => window.clearTimeout(id);
  }, [phase, ms]);

  return next;
}

/**
 * The last value that was not null: what a dialog was about, kept while it
 * leaves after the caller has already let go of it (the absence just
 * answered, the item just saved). The same during render as lastShown().
 */
export function useLastShown<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value);
  const shown = lastShown(last, value);
  if (shown !== last) setLast(shown);
  return shown;
}

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function candidate(el: HTMLElement) {
  return {
    connected: el.isConnected,
    disabled: 'disabled' in el && (el as HTMLButtonElement).disabled === true,
    tabIndex: el.tabIndex,
    rendered: el.getClientRects().length > 0,
    inert: el.closest('[inert]') !== null,
  };
}

/** Whether focus() would really land on `el` (see canTakeFocus). */
function takesFocus(el: HTMLElement): boolean {
  return canTakeFocus(candidate(el));
}

/** What Tab can reach inside `box`, in order: enabled, rendered, in the tab order. */
function focusables(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) =>
    inTabOrder(candidate(el)),
  );
}

/**
 * Focus in and back out. While `active`, focus is put on the dialog (unless
 * something inside already took it, like an `autoFocus` field) and, when it
 * stops being active, handed back to whatever held it before -- the button
 * that opened it, usually -- so a keyboard user carries on from where they
 * were instead of from the top of the page.
 *
 * If that button cannot take focus by then -- gone (the dialog's own action
 * replaced it), disabled, or in a panel that is now hidden -- focus goes to
 * the first thing that can in the nearest part of the page around it, rather
 * than falling to <body> and making a keyboard user start again from the top.
 *
 * While open, focus that drops out of the dialog onto <body> -- the focused
 * button was disabled ("Publishing…") or removed -- is caught by the dialog
 * itself: from <body> Escape and Tab would no longer reach it.
 */
export function useDialogFocus(panel: RefObject<HTMLElement>, active: boolean): void {
  // Who had focus before the dialog, and the elements around it, nearest
  // first. Read while rendering the frame that opens it: by the time any
  // effect runs, an `autoFocus` inside has already moved focus into the
  // dialog, and the opener would be lost.
  const opener = useRef<HTMLElement[]>([]);
  const wasActive = useRef(false);
  if (active && !wasActive.current && typeof document !== 'undefined') {
    const path: HTMLElement[] = [];
    const start = document.activeElement;
    for (
      let el = start instanceof HTMLElement ? start : null;
      el && el !== document.body;
      el = el.parentElement
    ) {
      path.push(el);
    }
    opener.current = path;
  }
  wasActive.current = active;

  useEffect(() => {
    if (!active) return;
    const box = panel.current;
    if (box && !box.contains(document.activeElement)) box.focus({ preventScroll: true });
    let frame = 0;
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) return; // going somewhere real
      cancelAnimationFrame(frame);
      // Next frame: by then a new button with autoFocus may have taken it.
      frame = requestAnimationFrame(() => {
        const now = document.activeElement;
        if (box?.isConnected && (!now || now === document.body)) box.focus({ preventScroll: true });
      });
    };
    box?.addEventListener('focusout', onFocusOut);
    return () => {
      box?.removeEventListener('focusout', onFocusOut);
      cancelAnimationFrame(frame);
      const now = document.activeElement;
      // Only take focus back if it is still in the dialog or was dropped on
      // the body with it; a caller that moved it somewhere on purpose keeps it.
      const stranded = !now || now === document.body || (box?.contains(now) ?? false);
      if (!stranded) return;
      const [first, ...around] = opener.current;
      if (first && takesFocus(first)) {
        first.focus({ preventScroll: true });
        return;
      }
      for (const el of around) {
        if (!el.isConnected) continue;
        const target = focusables(el).find((x) => !(box?.contains(x) ?? false));
        if (target) {
          target.focus({ preventScroll: true });
          return;
        }
      }
    };
  }, [active, panel]);
}

/**
 * A dialog on its way out is `inert`: nothing in it can be focused, clicked
 * or pressed, and it is out of the accessibility tree. Without it, a button
 * that still held focus answered Enter during the exit and ran its action a
 * second time -- Cancel on the absence question undid somebody else's change.
 * Set as an attribute (React 18 does not know `inert`), before paint.
 */
export function useInert(el: RefObject<HTMLElement>, on: boolean): void {
  useLayoutEffect(() => {
    el.current?.toggleAttribute('inert', on);
  }, [el, on]);
}

/**
 * The key handling every dialog shares: Escape closes it, Tab goes round
 * inside it. Put on the dialog's outermost element.
 *
 * Escape that something inside already handled (`defaultPrevented`) is left
 * alone, and Escape the dialog does handle is marked handled and stopped
 * there -- the day view and the roster close or clear things on Escape from a
 * window listener, and one press must not close the dialog AND the day
 * behind it.
 */
export function dialogKeys(
  e: KeyboardEvent<HTMLElement>,
  panel: HTMLElement | null,
  close: () => void,
): void {
  if (e.key === 'Escape') {
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    close();
    return;
  }
  if (e.key !== 'Tab' || !panel) return;
  const items = focusables(panel);
  const active = document.activeElement;
  const current = items.findIndex((el) => el === active);
  if (current < 0 && active && active !== panel && panel.contains(active)) {
    // Focus is on something inside that is not one of the stops -- a list the
    // browser made focusable because it scrolls. Carry on from where it sits.
    const following = items.findIndex(
      (el) => (active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    );
    const next = tabFromBetween(following, items.length, e.shiftKey);
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
    return;
  }
  const to = wrapFocus(current, items.length, e.shiftKey);
  if (to === null) return;
  e.preventDefault();
  (to === -1 ? panel : items[to]).focus();
}

/**
 * A click on the backdrop closes -- but only a click that also STARTED on the
 * backdrop. Selecting text in a field and letting go outside the panel sends
 * a click to the backdrop too, and closing the form on the person mid-drag is
 * the dialog losing their work for them.
 */
export function useBackdropClose(close: () => void, enabled: boolean) {
  const downHere = useRef(false);
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      downHere.current = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const started = downHere.current;
      downHere.current = false;
      if (enabled && started && e.target === e.currentTarget) close();
    },
  };
}
