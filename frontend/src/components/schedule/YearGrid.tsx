// The year at a glance: twelve months, and which days the team already has.
//
// WHAT IT REPLACES. Five horizons in a toolbar -- week, four weeks, month,
// year, brief -- of which "year" was twelve folders that had to be opened one
// by one, so the one view that promised an overview never gave one. Worse,
// the control decided what got SAVED, and a manager who asked for October
// while the toolbar said "4 weeks" lost their draft to a window three days
// short of the month.
//
// So this is the whole map, and the only thing it decides is where to look.
//
// WHAT THE COLOURS ARE FOR. A month that is drafted and a month the team can
// read are different states of the world, and the second is the one people
// turn up for. Published is solid, draft is an outline: at arm's length the
// year reads as "done up to here", and a month that only LOOKS done stands
// out because it is hollow.

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { APP_LOCALE } from '../../lib/locale';
import { useT } from '../../lib/i18n';
import { dateKey, dayState, type DayMark } from '../../lib/schedule/focus';
import { trackPointerLight } from '../motion/pointerLight';
import { useReducedMotion } from '../../lib/motion/useReducedMotion';
import { monthDelay, returnScroll, type Point } from './calendarMotion';
import { YEAR_DAY, YEAR_SWATCH } from './calendarLook';

interface YearGridProps {
  year: number;
  /** Date key -> what exists that day. Absent means nothing is planned. */
  marks: Map<string, DayMark>;
  /** Today, passed in rather than read, so the grid can be tested. */
  today: Date;
  /**
   * Open a day. `from` is the centre of what was pressed, on screen, so the
   * day can grow out of it (see DayView).
   */
  onOpenDay: (date: string, from?: Point) => void;
  onYearChange: (year: number) => void;
  onToday: (from?: Point) => void;
  loading?: boolean;
  /**
   * How the year comes on screen: its months one after another (the first
   * time, a new year, a new calendar), or settling back quietly after a day
   * is closed -- which happens too often to cascade every time.
   */
  arrival?: 'cascade' | 'return';
  /**
   * The day just closed, which a ring closes in on so the eye finds it. The
   * year scrolls to put it back at `y` on screen -- where it was pressed --
   * or in the middle when that is not known (a day only stepped to).
   */
  landing?: { date: string; y: number | null } | null;
  /** Changes when the AI lands a new calendar: the months arrive again. */
  arrivalKey?: number;
}

/** How long the ring on a day just closed lasts: `.cal-landing`, 80 + 700 ms. */
const LANDING_RING_MS = 900;

/** The centre of whatever was pressed, in viewport pixels. */
function centreOf(e: MouseEvent<HTMLElement>): Point {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Monday-first, which is how a week is written in both languages we ship. */
const WEEK_STARTS_ON = 1;

/**
 * One class list per state, from ./calendarLook (the Colours page reads the
 * same table). A table rather than a chain of ternaries so that adding a state
 * is a line there and a line in `dayState`, and the two cannot drift into
 * disagreeing about how many states there are.
 */
const TONES: Record<string, string> = YEAR_DAY;

/**
 * The six weeks a month grid needs, as dates, including the neighbours that
 * fill the corners.
 *
 * Six rows always, not five-or-six: a grid whose height changes per month
 * makes the whole year jump as it renders, and the alignment between months
 * is most of what makes the page readable.
 */
function monthMatrix(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - WEEK_STARTS_ON + 7) % 7;
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

// The year names about 600 dates on every render -- each month and weekday,
// and every day for a screen reader. `toLocaleDateString` with options builds
// a formatter per call (some 25 ms a render in Safari's engine); these are
// built once per locale and time zone and kept. Looked up at render, never
// captured: the locale follows the chosen language (lib/locale.ts), and a
// formatter keeps the zone it was built in -- a laptop that changes zone
// without a reload would otherwise name every day of the year a day off.
const FORMATS = {
  month: { month: 'long' },
  weekday: { weekday: 'narrow' },
  day: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

const formatters = new Map<string, Record<keyof typeof FORMATS, Intl.DateTimeFormat>>();

export function formatsFor(locale: string) {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const key = `${locale} ${zone}`;
  let found = formatters.get(key);
  if (!found) {
    found = {
      month: new Intl.DateTimeFormat(locale, FORMATS.month),
      weekday: new Intl.DateTimeFormat(locale, FORMATS.weekday),
      day: new Intl.DateTimeFormat(locale, FORMATS.day),
    };
    formatters.set(key, found);
  }
  return found;
}

function MonthBlock({
  year,
  month,
  marks,
  todayKey,
  landingDate,
  onOpenDay,
}: {
  year: number;
  month: number;
  marks: Map<string, DayMark>;
  todayKey: string;
  landingDate: string | null;
  onOpenDay: (date: string, from?: Point) => void;
}) {
  const t = useT();
  const cells = useMemo(() => monthMatrix(year, month), [year, month]);
  const format = formatsFor(APP_LOCALE);
  const name = format.month.format(new Date(year, month, 1));
  // Built from a known Monday rather than hardcoded, so the initials come from
  // the locale like every other date on screen.
  const headers = Array.from({ length: 7 }, (_, i) =>
    format.weekday.format(new Date(2024, 0, 1 + i)),
  );

  return (
    <section
      aria-label={name}
      className="cal-month"
      // When this month arrives; its days inherit it, so today's ring waits
      // for its own month rather than pulsing into an empty space.
      style={{ '--d': `${monthDelay(month)}ms` } as CSSProperties}
    >
      <h3 className="mb-2 text-base font-semibold capitalize text-brand-300">
        {name}
      </h3>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {headers.map((h, i) => (
          <abbr
            key={i}
            className="text-[11px] font-medium uppercase text-gray-500 no-underline"
          >
            {h}
          </abbr>
        ))}
        {cells.map((d) => {
          const key = dateKey(d);
          const outside = d.getMonth() !== month;
          const mark = marks.get(key);
          // The decision itself is pure and lives in lib/schedule/focus, where
          // a test can reach it: this file only turns it into classes.
          const state = dayState({ key, todayKey, outside, mark });
          const isToday = state === 'today';

          const tone = TONES[state];
          const spoken = t(`calendar.year.day.${state === 'outside' ? 'empty' : state}`);

          return (
            <button
              key={key}
              type="button"
              onClick={(e) => onOpenDay(key, centreOf(e))}
              // The label carries the state as well as the date: a screen
              // reader gets the same information the colour gives everyone
              // else, which is the only way the colour is not the only way.
              aria-label={`${format.day.format(d)} — ${spoken}`}
              aria-current={isToday ? 'date' : undefined}
              // A neighbouring month's day repeats a date its own month
              // already shows, faint on purpose: out of the Tab order and out
              // of what a screen reader reads (where it also said "nothing
              // planned" whatever that day held). A click still opens it.
              tabIndex={outside ? -1 : undefined}
              aria-hidden={outside ? true : undefined}
              data-date={outside ? undefined : key}
              // The spring on hover and press is `cal-day`'s, in
              // styles/motion-calendar.css: one rule for 500 days, and no
              // script per day.
              className={[
                'cal-day mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[13px] tabular-nums',
                // Its own mark: a white outline, not a second menta ring on a day already
                // ringed in menta (a draft day), where focus barely showed.
                'focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                // One hover per day, never two competing for the same property.
                isToday
                  ? 'cal-today hover:bg-brand-300'
                  : state === 'published'
                    ? 'hover:bg-brand-deep'
                    : 'hover:bg-gray-200',
                key === landingDate && !outside ? 'cal-landing' : '',
                tone,
              ].join(' ')}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function YearGrid({
  year,
  marks,
  today,
  onOpenDay,
  onYearChange,
  onToday,
  loading = false,
  arrival = 'cascade',
  landing = null,
  arrivalKey = 0,
}: YearGridProps) {
  const t = useT();
  const todayKey = dateKey(today);
  const card = useRef<HTMLDivElement>(null);
  // The day rung on the way back, for as long as the ring takes and no
  // longer. Taken from `landing` once, as the year arrives: a new calendar
  // landing later brings the months in again, and coming back to this tab
  // shows the year again, and neither is the day being closed.
  const [ringing, setRinging] = useState<string | null>(() => landing?.date ?? null);
  useEffect(() => {
    if (!ringing) return;
    const id = window.setTimeout(() => setRinging(null), LANDING_RING_MS);
    return () => window.clearTimeout(id);
  }, [ringing]);

  // A new calendar from the AI: the months come in again, on the elements
  // already on screen (Web Animations, the same movement as `.cal-month` in
  // motion-calendar.css), so nothing is rebuilt and focus stays where it is.
  const reduced = useReducedMotion();
  const seenArrival = useRef(arrivalKey);
  // The cascade under way, so a second arrival replaces it instead of piling
  // a second set of animations on the same twelve months.
  const cascade = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    if (arrivalKey === seenArrival.current) return;
    seenArrival.current = arrivalKey;
    cascade.current.forEach((a) => a.cancel());
    cascade.current = [];
    if (reduced) return;
    const months = card.current?.querySelectorAll<HTMLElement>('.cal-month') ?? [];
    months.forEach((el, month) => {
      if (typeof el.animate !== 'function') return;
      const a = el.animate(
        [
          { opacity: 0, transform: 'translateY(10px)', filter: 'blur(4px)' },
          { opacity: 1, transform: 'none', filter: 'none' },
        ],
        {
          duration: 480,
          delay: monthDelay(month),
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'backwards',
        },
      );
      cascade.current.push(a);
    });
  }, [arrivalKey, reduced]);

  // Back from a day: the year comes back scrolled to the day that was open,
  // not to January. Before paint, so it is simply there.
  useLayoutEffect(() => {
    if (!landing) return;
    const btn = card.current?.querySelector<HTMLElement>(`[data-date="${landing.date}"]`);
    if (!btn) return;
    const box = btn.getBoundingClientRect();
    const by = returnScroll(box.top + box.height / 2, window.innerHeight, landing.y);
    if (by === 0) return;
    window.scrollBy({ top: by, behavior: 'instant' as ScrollBehavior });
    // When the page is not what scrolls, bring the day into view some other way.
    if (btn.getBoundingClientRect().top === box.top) btn.scrollIntoView({ block: 'center' });
    // Mount only: this is where the year comes back to, not where it stays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // A soft light follows the pointer across the paper (`m-light`), the
    // launcher's gesture at the app's volume: it says where the pointer is
    // over twelve months of small circles, and it costs no render.
    <div
      ref={card}
      className="cal-year m-light m-glass rounded-2xl border border-white/[0.08] p-5"
      data-arrival={arrival}
      onPointerMove={trackPointerLight}
    >
      <header className="mb-6 flex items-center justify-between">
        <h2 className="text-3xl font-bold tabular-nums text-gray-900">
          <span key={year} className={arrival === 'cascade' ? 'cal-year-number' : undefined}>
            {year}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {/* The legend sits with the controls rather than under the grid:
              the colours mean nothing until they are read, and nobody scrolls
              past twelve months to find out what they meant. */}
          <span className="mr-2 hidden items-center gap-3 text-xs text-gray-500 sm:flex">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={`h-3 w-3 rounded-full ${YEAR_SWATCH.published}`} />
              {t('calendar.year.legend.published')}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={`h-3 w-3 rounded-full ${YEAR_SWATCH.draft}`} />
              {t('calendar.year.legend.draft')}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onYearChange(year - 1)}
            aria-label={t('calendar.year.previous', { year: year - 1 })}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-white/[0.08] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 motion-reduce:transition-none"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => onToday(centreOf(e))}
            className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-sm font-medium text-gray-800 transition-colors hover:border-white/25 hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 motion-reduce:transition-none"
          >
            {t('calendar.year.today')}
          </button>
          <button
            type="button"
            onClick={() => onYearChange(year + 1)}
            aria-label={t('calendar.year.next', { year: year + 1 })}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-white/[0.08] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 motion-reduce:transition-none"
          >
            ›
          </button>
        </div>
      </header>

      <div
        // Keyed on the year: a new year is new months. A new calendar is NOT
        // a remount -- that would rebuild 370 buttons and drop the keyboard
        // focus to the page -- it replays the cascade on the months already
        // here (see the effect on `arrivalKey`).
        key={year}
        className={[
          'cal-months grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
          'transition-opacity duration-300 motion-reduce:transition-none',
          // Dimmed while the marks are still coming, rather than hidden: the
          // dates are right from the first paint and only the colours are
          // pending, so blanking the grid would hide twelve correct months to
          // avoid showing one wrong colour.
          loading ? 'opacity-60' : 'opacity-100',
        ].join(' ')}
      >
        {Array.from({ length: 12 }, (_, month) => (
          <MonthBlock
            key={month}
            year={year}
            month={month}
            marks={marks}
            todayKey={todayKey}
            landingDate={ringing}
            onOpenDay={onOpenDay}
          />
        ))}
      </div>
    </div>
  );
}
