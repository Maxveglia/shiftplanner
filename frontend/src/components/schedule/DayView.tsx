// One day, opened from the year, with a way back.
//
// A frame rather than a grid: the day itself is `DayGrid`, unchanged and
// still editable, and this supplies what opening one day out of 365 needs --
// which day it is, the two arrows either side of it, and the door out.
//
// It takes `children` instead of the dozen props `DayGrid` needs. Passing
// them through would mean this file had an opinion about shifts, absences and
// pay policy, none of which it has any business holding: it knows a date and
// three callbacks.
//
// THE ARROWS ARE ALSO THE KEYBOARD. A manager checking a run of days presses
// the same key twenty times, and reaching for a mouse to do it is the kind of
// friction that ends with the calendar being read somewhere else. Escape
// closes, which is what every other layer in this product does.
//
// HOW IT ARRIVES. Out of the day that was pressed: the view grows as a circle
// from that day's own circle in the year, the way the launcher's reveal grows
// from the icon that was chosen, and closing shrinks it back into the same
// spot. Stepped to with the arrows, it comes in from the side it was stepped
// to. The numbers are `revealFrom` / `exitPoint` in calendarMotion.ts; the
// animation is the Web Animations API on this one element, with no fill, so
// nothing here holds a transform once it has arrived.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { APP_LOCALE } from '../../lib/locale';
import { useT } from '../../lib/i18n';
import { fromDateKey } from '../../lib/schedule/focus';
import { useReducedMotion } from '../../lib/motion/useReducedMotion';
import { keyForCalendar } from './calendarKeys';
import {
  entranceFor,
  exitPoint,
  revealFrom,
  type DayEntrance,
  type DayOrigin,
} from './calendarMotion';

/**
 * How long the day's people and shifts take to finish arriving: the last of
 * eight staggered rows, drawn. After it the `data-arriving` attribute goes and
 * a shift that is dropped somewhere new just appears there.
 */
const ARRIVING_MS = 900;

/** The same step button as the month's, in the toolbar above. */
const STEP_BUTTON =
  'rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-sm text-gray-700 transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 motion-reduce:transition-none';

interface DayViewProps {
  /** The day being shown, as YYYY-MM-DD. */
  date: string;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  /** True while this day belongs to a month still being loaded. */
  loading?: boolean;
  /** How this day came on screen; see `DayEntrance`. */
  entrance?: DayEntrance | null;
  /**
   * The circle in the year the manager opened a day from. Closing THAT day
   * shrinks it back into the circle -- also after stepping away and back.
   */
  origin?: DayOrigin | null;
  /** Changes when the AI lands a new calendar: the shifts arrive again. */
  arrivalKey?: number;
  /**
   * Whether the arrow keys and Escape are this view's. False while another
   * tab is showing: the day is still mounted (hidden) under Hours & pay, and
   * an arrow pressed there must not step a day nobody can see.
   */
  keys?: boolean;
  children: ReactNode;
}

export function DayView({
  date,
  onPrev,
  onNext,
  onClose,
  loading = false,
  entrance = null,
  origin = null,
  arrivalKey = 0,
  keys = true,
  children,
}: DayViewProps) {
  const t = useT();
  const d = fromDateKey(date);
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  // Closing: from the press until the day is gone. Keys and clicks on it are
  // ignored meanwhile -- the manager has already left it.
  const leaving = useRef(false);
  // The close to call when the exit ends: the CURRENT one, not the one this
  // day was rendered with 260 ms earlier.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  // The exit in flight, so it can be dropped if the day goes first (another
  // day opened on top of it): a stale exit finishing later would close THAT
  // day, which the manager has just opened.
  const exit = useRef<{ anim: Animation; timer: number } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (exit.current) {
        window.clearTimeout(exit.current.timer);
        exit.current.anim.cancel();
        exit.current = null;
      }
    };
  }, []);

  // Arriving: for the first moments after the day is opened, and again
  // whenever a new calendar lands in it. Read by motion-calendar.css, which
  // staggers the rows and draws the shifts in -- see `.cal-dayview`. Not on
  // a day STEPPED to: someone going through a week with the arrow keys wants
  // each day's shifts the moment it turns, not a quarter of a second later.
  const [arriving, setArriving] = useState(() => entranceFor(date, entrance).kind !== 'step');
  const firstArrival = useRef(true);
  useLayoutEffect(() => {
    // Before paint, so the new shifts are never drawn once whole and then
    // again from nothing.
    if (!firstArrival.current) setArriving(true);
    firstArrival.current = false;
    const id = window.setTimeout(() => setArriving(false), ARRIVING_MS);
    return () => window.clearTimeout(id);
  }, [arrivalKey]);

  // The entrance, once, as the day is mounted (the caller keys it on the
  // date, so every day gets its own).
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || reduced || typeof el.animate !== 'function') return;
    const how = entranceFor(date, entrance);
    let anim: Animation;
    if (how.kind === 'grow') {
      const r = revealFrom(how.at, el.getBoundingClientRect());
      const at = `${r.x}px ${r.y}px`;
      anim = el.animate(
        [
          {
            clipPath: `circle(${r.from}px at ${at})`,
            transform: 'scale(0.985)',
            transformOrigin: at,
            opacity: 0.4,
          },
          { opacity: 1, offset: 0.35 },
          {
            clipPath: `circle(${r.to}px at ${at})`,
            transform: 'none',
            transformOrigin: at,
            opacity: 1,
          },
        ],
        { duration: 440, easing: 'cubic-bezier(0.6, 0, 0.2, 1)' },
      );
    } else if (how.kind === 'step') {
      anim = el.animate(
        [
          { opacity: 0, transform: `translateX(${how.dir * 16}px)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
    } else {
      anim = el.animate(
        [
          { opacity: 0, transform: 'translateY(8px)', filter: 'blur(4px)' },
          { opacity: 1, transform: 'none', filter: 'none' },
        ],
        { duration: 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
    }
    return () => anim.cancel();
    // Mount only: a day's entrance is decided the moment it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Close, shrinking back into the circle the day was opened from when there
   * is one to aim at (the year then puts that circle back in the same spot).
   * Otherwise -- a day only stepped to, reduced motion -- close at once: the
   * year's own return, and its ring on the day, say where it went.
   */
  const leave = useCallback(() => {
    if (leaving.current) return;
    const el = root.current;
    const to = exitPoint(date, origin);
    if (!el || reduced || !to || typeof el.animate !== 'function') {
      onCloseRef.current();
      return;
    }
    leaving.current = true;
    el.style.pointerEvents = 'none';
    const r = revealFrom(to, el.getBoundingClientRect());
    const at = `${r.x}px ${r.y}px`;
    const anim = el.animate(
      [
        { clipPath: `circle(${r.to}px at ${at})`, opacity: 1 },
        { clipPath: `circle(${r.from}px at ${at})`, opacity: 0.3 },
      ],
      { duration: 260, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' },
    );
    let done = false;
    const finish = () => {
      // Once, and only for a day still on screen: unmounting cancels the
      // animation, which settles `finished` too.
      if (done || !mounted.current) return;
      done = true;
      if (exit.current) window.clearTimeout(exit.current.timer);
      exit.current = null;
      onCloseRef.current();
    };
    // A tab in the background may never finish an animation.
    const timer = window.setTimeout(finish, 450);
    exit.current = { anim, timer };
    anim.finished.then(finish, finish);
  }, [date, origin, reduced]);

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      // Already on its way out: an arrow now would open the next day under
      // a close that is about to land.
      if (leaving.current) return;
      // A dialog on top owns its keys (calendarKeys): the assistant's arrows
      // are not this day's, nor is the Escape that closes a dialog.
      if (!keyForCalendar(e)) return;
      // The calendar inside got there first: Escape let go of a shift being
      // dragged, or put down a selected one. That is all it should do -- it
      // must not also close the day the manager is still working on.
      if (e.defaultPrevented) return;
      // Not while somebody is typing: the brief box is on this same screen,
      // and stealing an arrow key from it would move the calendar mid-sentence.
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable);
      if (typing) return;

      if (e.key === 'ArrowLeft') onPrev();
      else if (e.key === 'ArrowRight') onNext();
      else if (e.key === 'Escape') leave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys, onPrev, onNext, leave]);

  return (
    <div
      ref={root}
      // Keyed on the date by the caller, so React remounts on every move and
      // the entrance plays again -- which is what makes stepping through days
      // feel like turning pages rather than watching numbers change.
      className="cal-dayview"
      data-arriving={arriving && !reduced ? '' : undefined}
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Arrow, day, arrow: the same order as the month above it, so the
            two rows read as one pattern at two sizes rather than two
            different controls. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!leaving.current) onPrev();
            }}
            aria-label={t('calendar.day.previous')}
            className={STEP_BUTTON}
          >
            ←
          </button>
          <h2 className="min-w-[16rem] text-center text-sm font-semibold text-gray-900 first-letter:uppercase">
            {d.toLocaleDateString(APP_LOCALE, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </h2>
          <button
            type="button"
            onClick={() => {
              if (!leaving.current) onNext();
            }}
            aria-label={t('calendar.day.next')}
            className={STEP_BUTTON}
          >
            →
          </button>
          {loading && (
            <span className="text-sm text-gray-500">
              {t('calendar.day.loading')}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={leave}
          className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-gray-800 transition-colors hover:border-white/25 hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 motion-reduce:transition-none"
        >
          {t('calendar.day.back')}
        </button>
      </header>

      {children}
    </div>
  );
}
