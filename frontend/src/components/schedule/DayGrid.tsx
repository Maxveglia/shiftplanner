// One day of the schedule: employees down the left, the day's OPEN hours across
// the top -- 09:00-22:00 for a shop, 17:00-03:00 for a bar. Which hours those
// are, and which shifts land in them, is ./dayTrack; this file draws them.
//
// PERFORMANCE NOTE: shifts render as absolutely-positioned BARS over the track
// -- O(shifts) DOM nodes, not O(employees x hours). An 8-hour shift is one
// element, not eight cells. This is what makes a month of days scrollable.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AbsenceOut, AbsenceTypeOut, EmployeeOut } from '../../types';
import { formatHours, formatMoney } from '../../lib/format';
import { useT, type TFunction } from '../../lib/i18n';
import { availability, contractedMinHours } from '../../lib/schedule/availability';
import { weekHoursFor } from '../../lib/schedule/weekHours';
import {
  DAY_MIN,
  coverageMinute,
  isClosedOn,
  needAt,
  windowFor,
} from '../../lib/schedule/demand';
import type { Assignment, DayRef, SchedulingSpec } from '../../lib/schedule/types';
import { dayTrack, segmentsForDay, type DaySegment } from './dayTrack';
import {
  DEFAULT_NIGHT_WINDOW,
  nightHoursIn,
  nightSpans,
} from '../../lib/schedule/night';
import {
  daysBetween,
  draggedInterval,
  movedInterval,
  onAxis,
  overlapsAny,
  resizeBounds,
  type Interval,
  type ResizeBounds,
  type ShiftEdge,
} from '../../lib/schedule/resize';
import { peopleAt } from '../../lib/schedule/coverage';
import { keyForCalendar } from './calendarKeys';
import {
  AWAY_ROW,
  CLOSED_HOURS,
  COVERED_HOUR,
  OFF_ROW,
  PREMIUM_HOURS,
  SHIFT_BAR,
  SHIFT_BAR_REFUSED,
  SHORT_HOUR,
  SHORT_HOUR_STYLE,
} from './calendarLook';

/**
 * Pointer travel, in pixels, before a press on a bar counts as a drag and no
 * longer as a click. Small enough that a deliberate drag of half a column is
 * never mistaken for a click; large enough that a hand resting on a trackpad
 * does not stretch a shift by accident.
 */
const DRAG_SLOP_PX = 4;

/**
 * How far in from each end of a bar a press takes hold of that EDGE rather
 * than of the whole shift. Matches the grip drawn there (`w-2.5`), so the
 * cursor changes exactly where the press changes meaning.
 */
const GRIP_PX = 10;

/**
 * What a press on a bar is doing: pulling one edge, carrying the whole shift,
 * or nothing yet (a bar with nothing movable, where the press can still be a
 * click that selects it).
 */
type DragMode = ShiftEdge | 'move' | 'none';

/** What is being dragged right now, and where it has got to. */
interface DragSession {
  assignment: Assignment;
  mode: DragMode;
  /** The shift as it was when the press began, on its own axis. */
  from: Interval;
  /** How far an edge may go, for a resize. */
  bounds: ResizeBounds;
  /** The open hours on the shift's own axis, for a move. */
  wall: Interval;
  /** Track minutes to assignment minutes: 0 today, a day for a spill from yesterday. */
  offset: number;
  /** The row's box, measured once: the pointer is placed against it on every move. */
  left: number;
  width: number;
  pressX: number;
  pressY: number;
  moved: boolean;
  /** Where the shift has got to so far, on the assignment's axis. */
  preview: Interval;
  /** Whose row it would land in: the owner's, unless it has been carried. */
  employeeId: string;
  /** Why it cannot land there, in the manager's words, or null when it can. */
  problem: string | null;
}

/** The part of a drag the picture needs; the rest stays in the ref. */
type DragPreview = Pick<
  DragSession,
  'assignment' | 'mode' | 'preview' | 'offset' | 'employeeId' | 'problem'
>;

// Every colour and texture drawn here -- the bar, the hours paid more, a short
// hour, a closed one, somebody away -- comes from ./calendarLook, which the
// Colours page reads too: the legend cannot drift from the calendar.

/** Hours the way the reader's language writes a decimal. One implementation. */
const fmtHours = formatHours;

/**
 * Compact column label: 12a, 1a, ... 11a, 12p, 1p, ... 11p in English.
 *
 * The 12-hour clock is an English convention, not a universal one, so the
 * SHAPE of the label lives in the dictionary too: Spanish reads the same
 * ruler as 0..23. Both the 12-hour and the raw hour go in, and the string
 * picks the one its language writes.
 *
 * The hour handed in is a WALL-CLOCK hour, 0..23, never the column's own
 * number: the bar's column 25 is one in the morning to everybody who works
 * there, and "25" is an internal coordinate, not a time anyone tells.
 */
function hourLabel(t: TFunction, h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return t(h < 12 ? 'calendar.dayGrid.hour.am' : 'calendar.dayGrid.hour.pm', {
    h12,
    h,
  });
}

/**
 * Full clock for tooltips, e.g. "9:00 AM" in English, "9:00" in Spanish.
 *
 * Past midnight it is the same wall clock with a day marker: "2:00 AM +1". The
 * marker is not decoration -- once a row can hold both 2 AM the night before
 * and 2 AM tonight, an unmarked "2:00" is genuinely ambiguous, and "+1" is
 * already how this product writes an overnight span (see lib/format.ts). It
 * comes from the dictionary rather than being appended here, so a language that
 * writes it differently can. The choice is made on the MINUTE, not on the text.
 */
function clock(t: TFunction, min: number): string {
  const nextDay = min >= DAY_MIN;
  const total = ((min % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  // Written out rather than assembled, so every key in the dictionary is still
  // findable by searching for it.
  const key = nextDay
    ? h24 < 12
      ? 'calendar.dayGrid.clock.am.nextDay'
      : 'calendar.dayGrid.clock.pm.nextDay'
    : h24 < 12
      ? 'calendar.dayGrid.clock.am'
      : 'calendar.dayGrid.clock.pm';
  return t(key, { h12, h24, m: String(m).padStart(2, '0') });
}

interface DayGridProps {
  day: DayRef;
  /**
   * The day before this one, or null at the start of the period.
   *
   * The whole DayRef, not just its date: whether a shift worked into the small
   * hours has already been drawn depends on how far THAT day's track reached,
   * and only its own window can answer that.
   */
  prevDay: DayRef | null;
  /**
   * Every day the calendar covers. A week is only judged short of contract
   * when all seven of its days are here.
   */
  days: DayRef[];
  employees: EmployeeOut[];
  assignments: Assignment[];
  absences: AbsenceOut[];
  absenceTypes: AbsenceTypeOut[];
  spec: SchedulingSpec;
  /**
   * Manual editing: press an open half hour to add a shift there.
   *
   * `startAt` is minutes from the track's midnight, not an hour: the columns
   * are hours because a day reads better that way, but a press lands on the
   * half it fell in -- the same half hours the resize handles already move in.
   */
  onAddShift?: (employeeId: string, date: string, startAt: number) => void;
  /**
   * The X on a selected shift's frame, or Delete while one is selected. A
   * plain click only selects: once a press-and-hold carries a shift, a click
   * that deleted would cost a shift every time a hand let go without moving.
   */
  onRemoveShift?: (assignmentId: string) => void;
  /**
   * Press on either end of a shift and drag: that edge follows the pointer.
   * Called once, on release, with the hours on the shift's own axis.
   */
  onResizeShift?: (assignmentId: string, startMin: number, endMin: number) => void;
  /**
   * Press on the body of a shift and drag: the whole shift follows -- along
   * the row to other hours, across rows to somebody else. Called once, on
   * release, and only for a place it can actually land.
   */
  onMoveShift?: (
    assignmentId: string,
    employeeId: string,
    startMin: number,
    endMin: number,
  ) => void;
  /**
   * What a night hour earns on top, as a percentage. Zero -- or absent --
   * paints nothing: a calendar that shaded night hours where nobody pays a
   * premium for them would be inventing money.
   */
  nightPremiumPct?: number;
  /**
   * Whether the keyboard is this grid's. False while the day is hidden under
   * another tab (Hours & pay, Working year): it stays mounted there, and a
   * Backspace pressed on a screen of payroll must not remove a shift nobody
   * can see. Going hidden also puts the selection down.
   */
  keys?: boolean;
}

export function DayGrid({
  day,
  prevDay,
  days,
  employees,
  assignments,
  absences,
  absenceTypes,
  spec,
  onAddShift,
  onRemoveShift,
  onResizeShift,
  onMoveShift,
  nightPremiumPct = 0,
  keys = true,
}: DayGridProps) {
  const t = useT();
  // Closure and opening hours come from the same helpers the generator uses,
  // so the strip can never claim a day is covered when the generator disagrees.
  const isClosed = isClosedOn(spec, day);
  const win = windowFor(spec, day);

  // Every column, every gridline, every bar and the coverage strip are measured
  // off this one object, which is what stops the strip and the bars from
  // telling two different stories about two in the morning.
  const track = useMemo(() => dayTrack(spec, day, assignments), [spec, day, assignments]);
  const trackSpan = track.endMin - track.startMin;

  /**
   * Where inside one drawn bar the differently-paid hours are, as percentages
   * OF THAT BAR -- the stripe is positioned inside the bar, not on the row.
   *
   * The window is the jurisdiction's where there is one (Spain states 22:00 to
   * 06:00 in art. 36.1 ET), and the same default everything else uses when
   * there is not.
   */
  const nightWindow = spec.nightWindow ?? DEFAULT_NIGHT_WINDOW;
  /** Hours of one whole shift that carry the premium, for the tooltip. */
  const premiumHours = (a: Assignment): number =>
    nightPremiumPct ? nightHoursIn(a.startMin, a.endMin, nightWindow) : 0;

  const premiumSpans = (
    segStart: number,
    segEnd: number,
  ): { from: number; to: number; left: number; width: number }[] => {
    if (!nightPremiumPct || segEnd <= segStart) return [];
    const span = segEnd - segStart;
    return nightSpans(segStart, segEnd, nightWindow).map((p) => ({
      ...p,
      left: ((p.from - segStart) / span) * 100,
      width: ((p.to - p.from) / span) * 100,
    }));
  };

  // Measured with the SAME function, so the two days can never disagree about
  // where one of them stopped drawing.
  const prev = useMemo(
    () =>
      prevDay
        ? { date: prevDay.date, track: dayTrack(spec, prevDay, assignments) }
        : null,
    [spec, prevDay, assignments],
  );

  const segments = useMemo(
    () => segmentsForDay(assignments, day.date, prev, track),
    [assignments, day.date, prev, track],
  );

  // The drag lives in a ref because pointer events arrive faster than React
  // re-renders and every one of them needs the latest position; the state
  // copy exists only so the bar being dragged redraws where it has got to.
  const dragRef = useRef<DragSession | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragPreview(null);
  }, []);

  /**
   * The shift wearing the frame with the X. One at a time, and only one that
   * still exists: a shift removed or regenerated away takes its selection
   * with it rather than leaving an X over nothing.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId && assignments.some((a) => a.id === selectedId) ? selectedId : null;
  /**
   * Set when a press outside the bars has just put a selection down, so that
   * same press does not ALSO drop a new shift into the empty hour it landed
   * on. Clicking away from a frame is how a frame is dismissed everywhere;
   * doing so should never add work to undo.
   */
  const dismissed = useRef(false);

  // Escape lets go of a drag without changing anything, the same as it would
  // in a form; with nothing held, it puts the selection down. Delete removes
  // the selected shift, like the X does. Listened for in the CAPTURE phase and
  // marked handled, so the day view around this grid -- which closes on
  // Escape -- sees it was already spent.
  useEffect(() => {
    if (!keys || (!dragPreview && !selected)) return;
    const onKey = (e: KeyboardEvent) => {
      // A dialog on top owns its keys: its Escape closes it, and Backspace
      // typed there must not remove the shift behind it (calendarKeys).
      if (!keyForCalendar(e)) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (dragRef.current) endDrag();
        else setSelectedId(null);
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selected &&
        !dragRef.current &&
        onRemoveShift
      ) {
        e.preventDefault();
        setSelectedId(null);
        onRemoveShift(selected);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [keys, dragPreview, selected, endDrag, onRemoveShift]);

  // Hidden under another tab: nothing stays selected there, so nothing is
  // armed for a Delete when the calendar comes back either.
  useEffect(() => {
    if (!keys) setSelectedId(null);
  }, [keys]);

  // A press anywhere that is not a shift puts the selection down.
  useEffect(() => {
    if (!selected) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('[data-shift-bar]')) return;
      setSelectedId(null);
      if (!target || !sectionRef.current?.contains(target)) return;
      dismissed.current = true;
      // Only for this one press: the click it becomes fires right after the
      // release, so the flag is cleared just after that, wherever it landed.
      window.addEventListener(
        'pointerup',
        () => setTimeout(() => (dismissed.current = false), 0),
        { once: true, capture: true },
      );
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [selected]);

  /**
   * The walls this shift may be dragged out to, on its own axis.
   *
   * The open window is the day's, translated onto the shift's date; the other
   * fences are the same person's shifts yesterday, today and tomorrow, which is
   * every one that can share an hour with this one.
   */
  const wallFor = useCallback(
    (offset: number): Interval => ({
      startMin: Math.max(win.openMin, track.startMin) + offset,
      endMin: Math.min(win.closeMin, track.endMin) + offset,
    }),
    [win.openMin, win.closeMin, track.startMin, track.endMin],
  );

  const boundsFor = useCallback(
    (a: Assignment, offset: number): ResizeBounds => {
      const wall = wallFor(offset);
      const others = assignments
        .filter(
          (o) =>
            o.id !== a.id &&
            o.employeeId === a.employeeId &&
            Math.abs(daysBetween(a.date, o.date)) <= 1,
        )
        .map((o) => onAxis(o, a.date));
      return resizeBounds(a, wall, others);
    },
    [assignments, wallFor],
  );

  const periodDates = useMemo(() => new Set(days.map((d) => d.date)), [days]);

  // This week's hours per person, next to today's. Summed over the whole
  // period's assignments, not just this day's segments, so a Thursday knows
  // about Monday.
  const weekByEmployee = useMemo(() => {
    const m = new Map<string, ReturnType<typeof weekHoursFor>>();
    for (const emp of employees) {
      m.set(
        emp.id,
        weekHoursFor(emp.id, day.date, assignments, contractedMinHours(emp), periodDates),
      );
    }
    return m;
  }, [employees, day.date, assignments, periodDates]);

  const byEmployee = useMemo(() => {
    const m = new Map<string, DaySegment[]>();
    for (const s of segments) {
      const list = m.get(s.assignment.employeeId) ?? [];
      list.push(s);
      m.set(s.assignment.employeeId, list);
    }
    return m;
  }, [segments]);

  // Why each person can or cannot work today -- status, hire date, contract
  // window and absences. This is the SAME function the generator used to
  // decide, so the explanation always matches the schedule.
  const statusToday = useMemo(() => {
    const m = new Map<string, ReturnType<typeof availability>>();
    for (const emp of employees) {
      m.set(emp.id, availability(emp, absences, absenceTypes, day.date));
    }
    return m;
  }, [employees, absences, absenceTypes, day.date]);

  /**
   * Why `a`, carried to `next`, cannot land in `employeeId`'s row -- or null
   * when it can. Asked of every row the pointer crosses, so the bar turns red
   * BEFORE the manager lets go, not after.
   *
   * The same two walls a resize respects, and for the same reasons: the
   * person has to be able to work today (the SAME `availability` the generator
   * used), and the shift may not share a minute with another of theirs.
   */
  const moveProblem = (a: Assignment, employeeId: string, next: Interval): string | null => {
    const name = employees.find((e) => e.id === employeeId)?.full_name ?? '';
    const status = statusToday.get(employeeId);
    if (status && !status.ok) {
      return t('calendar.dayGrid.shift.unavailable', { name, reason: status.reason });
    }
    const theirs = assignments
      .filter(
        (o) =>
          o.id !== a.id &&
          o.employeeId === employeeId &&
          Math.abs(daysBetween(a.date, o.date)) <= 1,
      )
      .map((o) => onAxis(o, a.date));
    return overlapsAny(next, theirs) ? t('calendar.dayGrid.shift.overlaps', { name }) : null;
  };

  /**
   * Whose row is under the pointer, or null between rows and off the grid.
   *
   * Asked of the page rather than worked out from row heights: a row grows
   * when a name wraps or a note appears, and the page already knows where
   * every one of them is. The bar being carried holds the pointer capture,
   * which is exactly why its own events cannot say where it is.
   */
  const rowUnder = (x: number, y: number): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const row = el.closest('[data-employee-row]');
      if (row && sectionRef.current?.contains(row)) {
        return row.getAttribute('data-employee-row');
      }
    }
    return null;
  };

  /** The floating caption over a shift being dragged: its hours, or why not. */
  const dragBadge = (iv: Interval, offset: number, problem: string | null) => (
    <span
      className={[
        'pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2',
        'whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium tabular-nums shadow-md',
        // Light on the dark card, so the caption reads as floating over it.
        problem ? 'bg-danger text-white' : 'bg-gray-800 text-ground',
      ].join(' ')}
    >
      {problem ??
        `${clock(t, iv.startMin - offset)}–${clock(t, iv.endMin - offset)} · ${fmtHours((iv.endMin - iv.startMin) / 60)}`}
    </span>
  );

  // Headcount per hour + the requirement, for the coverage strip.
  //
  // `h` is the column's own hour, counted from this working day's midnight, so
  // it reaches 27 for a bar -- the same number `needAt` and the generator's
  // audit are asked, and the same axis the segments are measured on. Comparing
  // an hour past 23 against `openMin` used to be what broke this: 0 >= 540 is
  // false, so the strip called the small hours shut and needing nobody, in the
  // exact columns where it was drawing last night's shift.
  const coverage = useMemo(() => {
    return track.hours.map((h) => {
      // The hour a 19:30 opening falls in is counted from 19:30, the same
      // minute the generator and the audit look at -- otherwise this strip
      // would call the column shut while the gap list reported it uncovered.
      const m = coverageMinute(win, h);
      // PEOPLE, not bars. One person with two shifts over the same minute --
      // which pressing an already-worked hour used to create -- is one person
      // standing there, and counting the bars said two. See lib/schedule/coverage.
      const have = peopleAt(
        segments.map((s) => ({
          employeeId: s.assignment.employeeId,
          startMin: s.startMin,
          endMin: s.endMin,
        })),
        m,
      );
      const openNow = !isClosed && m >= win.openMin && m < win.closeMin;
      const need = openNow ? needAt(spec, day, h) : 0;
      return { hour: h, have, need, openNow };
    });
  }, [segments, spec, day, isClosed, track, win.openMin, win.closeMin]);

  const dayHours = segments.reduce(
    (s, seg) => s + (seg.endMin - seg.startMin) / 60,
    0,
  );
  const dayCost = segments.reduce((s, seg) => {
    const span = seg.assignment.endMin - seg.assignment.startMin;
    const part = span > 0 ? (seg.endMin - seg.startMin) / span : 0;
    return s + seg.assignment.cost * part;
  }, 0);

  const gapCount = coverage.filter((c) => c.openNow && c.have < c.need).length;

  const gridCols = {
    gridTemplateColumns: `repeat(${track.hours.length}, minmax(0, 1fr))`,
  };

  /**
   * The vertical rule between one calendar day and the next.
   *
   * A bar's row runs 9 to 27, and the reader needs to see WHERE the date turns
   * over: without it, "1" sitting to the right of "11" reads as a mistake. The
   * separator is the whole marking -- it runs through the ruler, the coverage
   * strip and every employee row, so it lands as one line down the day rather
   * than three unrelated marks. Considered and rejected: tinting the small
   * hours (the rows already use a grey wash to mean CLOSED, and a second wash
   * would read as the same thing), and a "+1" on each label past midnight (four
   * more glyphs in a column ten pixels wide, to repeat what one line says
   * once). The "+1" does appear where there is room for it: every tooltip and
   * every bar caption, via `clock`.
   *
   * A day that ends by midnight has no boundary to draw, so every column keeps
   * the hairline it always had.
   */
  const colBorder = (i: number): string =>
    i === track.midnightIndex
      ? 'border-l-2 border-gray-400/80'
      : 'border-l border-white/[0.05]';

  /**
   * A day is as tall as the day is. It used to be as tall as the screen --
   * `min-h-[88vh]`, so that scrolling landed one day at a time -- but a team of
   * four left two thirds of the card empty, and the manager scrolled past white
   * space to reach the next date. Snap still puts the top of a day under the
   * eye; it never needed the day to fill the viewport to do that.
   */
  return (
    <section
      ref={sectionRef}
      className="m-glass flex snap-start flex-col rounded-2xl border border-white/[0.08] p-5"
      aria-label={day.label}
    >
      {/* Day header */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 first-letter:uppercase">
            {day.label}
          </h3>
          <p className="mt-0.5 text-sm text-gray-500">
            {isClosed ? (
              t('calendar.dayGrid.closed')
            ) : (
              <>
                {t('calendar.dayGrid.scheduled', {
                  hours: fmtHours(Math.round(dayHours * 10) / 10),
                })}{' '}
                ·{' '}
                <span className="tabular-nums">{formatMoney(dayCost, { whole: true })}</span>{' '}
                {t('calendar.dayGrid.marginalCost')}
                {gapCount > 0 && (
                  <span className="ml-2 font-medium text-red-600">
                    ·{' '}
                    {t(
                      gapCount === 1
                        ? 'calendar.dayGrid.gaps.one'
                        : 'calendar.dayGrid.gaps.other',
                      { count: gapCount },
                    )}
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        {isClosed ? (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-white/10">
            {t('calendar.dayGrid.closed')}
          </span>
        ) : gapCount === 0 ? (
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 ring-1 ring-inset ring-green-200">
            {t('calendar.dayGrid.fullyCovered')}
          </span>
        ) : (
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-800 ring-1 ring-inset ring-red-200">
            {t('calendar.dayGrid.understaffed')}
          </span>
        )}
      </header>

      {/* Hour ruler */}
      <div className="flex border-b border-white/[0.08] pb-1">
        <div className="w-44 shrink-0 pr-3 text-[11px] font-medium uppercase tracking-wide text-gray-500">
          {t('calendar.dayGrid.employee')}
        </div>
        <div className="grid flex-1" style={gridCols}>
          {track.hours.map((h, i) => {
            const wall = h % 24;
            return (
              <div
                key={h}
                className={[
                  colBorder(i),
                  'text-center text-[10px] tabular-nums',
                  i === track.midnightIndex
                    ? 'font-semibold text-gray-700'
                    : wall === 0 || wall === 12
                      ? 'font-semibold text-gray-600'
                      : 'text-gray-500',
                ].join(' ')}
                title={
                  i === track.midnightIndex
                    ? t('calendar.dayGrid.hour.midnight')
                    : clock(t, h * 60)
                }
              >
                {hourLabel(t, wall)}
              </div>
            );
          })}
        </div>
      </div>

      {/* Coverage strip */}
      <div className="flex items-stretch border-b border-white/[0.08] py-1">
        <div className="w-44 shrink-0 pr-3 text-[11px] text-gray-500">
          {t('calendar.dayGrid.coverage')}
        </div>
        <div className="grid flex-1" style={gridCols}>
          {coverage.map((c, i) => {
            const short = c.openNow && c.have < c.need;
            return (
              <div
                key={c.hour}
                title={
                  c.openNow
                    ? t('calendar.dayGrid.coverage.tooltip', {
                        time: clock(t, c.hour * 60),
                        have: c.have,
                        need: c.need,
                      })
                    : t('calendar.dayGrid.closed')
                }
                className={[
                  colBorder(i),
                  'text-center text-[10px] font-medium tabular-nums',
                  !c.openNow ? 'text-gray-400' : short ? SHORT_HOUR : COVERED_HOUR,
                ].join(' ')}
                // A short hour is a hatch with a rule under it, not only a
                // red: the texture shows without telling colours apart.
                style={!c.openNow ? CLOSED_HOURS : short ? SHORT_HOUR_STYLE : undefined}
              >
                {c.openNow ? c.have : '·'}
                {/* The count alone does not say it is short; the tooltip is
                    not read out, so the sentence goes in as text. */}
                {short && (
                  <span className="sr-only">
                    {' '}
                    {t('calendar.dayGrid.understaffed')}:{' '}
                    {t('calendar.dayGrid.coverage.tooltip', {
                      time: clock(t, c.hour * 60),
                      have: c.have,
                      need: c.need,
                    })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Employee rows. No flex-1: the rows take the height they need and the
          card ends under the last of them. */}
      <div className="divide-y divide-white/[0.05]">
        {employees.map((emp) => {
          const segs = byEmployee.get(emp.id) ?? [];
          const status = statusToday.get(emp.id);
          const blocked = status && !status.ok ? status : null;
          const note = status && status.ok ? status.note : null;
          const empHours = segs.reduce(
            (s, seg) => s + (seg.endMin - seg.startMin) / 60,
            0,
          );
          const week = weekByEmployee.get(emp.id);
          const contracted = contractedMinHours(emp);
          return (
            <div key={emp.id} data-employee-row={emp.id} className="flex items-center py-1.5">
              {/* Sticky-left identity column: name + ID */}
              <div className="w-44 shrink-0 pr-3">
                <p className="truncate text-sm font-medium text-gray-900">
                  {emp.full_name}
                </p>
                <p className="text-[11px] text-gray-500">
                  {emp.external_id}
                  {empHours > 0 && (
                    <span className="ml-1.5 tabular-nums text-gray-500">
                      · {fmtHours(Math.round(empHours * 10) / 10)}
                    </span>
                  )}
                  {week && week.hours > 0 && (
                    <span
                      className={[
                        'ml-1.5 tabular-nums',
                        // Red is reserved for one thing: fewer hours than the
                        // contract promises, on a week the calendar covers.
                        week.short ? 'font-semibold text-red-600' : 'text-gray-500',
                      ].join(' ')}
                      title={
                        week.short
                          ? t('calendar.dayGrid.week.short', {
                              hours: fmtHours(Math.round(week.hours * 10) / 10),
                              contract: fmtHours(contracted),
                            })
                          : week.coveredDays < 7
                            ? t('calendar.dayGrid.week.partial.tooltip', {
                                days: week.coveredDays,
                              })
                            : t('calendar.dayGrid.week', {
                                hours: fmtHours(Math.round(week.hours * 10) / 10),
                              })
                      }
                    >
                      ·{' '}
                      {week.coveredDays < 7
                        ? t('calendar.dayGrid.week.partial', {
                            hours: fmtHours(Math.round(week.hours * 10) / 10),
                            days: week.coveredDays,
                          })
                        : t('calendar.dayGrid.week', {
                            hours: fmtHours(Math.round(week.hours * 10) / 10),
                          })}
                    </span>
                  )}
                  {note && (
                    <span className="ml-1.5 text-amber-600">· {note}</span>
                  )}
                </p>
              </div>

              {/* The day's open hours, with interval bars */}
              <div className="relative h-10 flex-1">
                {/* hour gridlines */}
                <div
                  className={[
                    'absolute inset-0 grid',
                    onAddShift ? '' : 'pointer-events-none',
                  ].join(' ')}
                  style={gridCols}
                  aria-hidden
                >
                  {track.hours.map((h, i) => {
                    // `win`, not `spec.openMin`/`spec.closeMin`. Reading the
                    // standing hours here while the strip two rows up read the
                    // per-weekday ones meant a Friday that closes at four had
                    // its late columns washed grey AND counted as open at the
                    // same time -- and clicking one of them did nothing.
                    const closedHour =
                      isClosed || h * 60 < win.openMin || h * 60 >= win.closeMin;
                    const canAdd = !closedHour && !blocked && Boolean(onAddShift);
                    return (
                      <div
                        key={h}
                        onClick={
                          canAdd
                            ? (e) => {
                                // This press only put a selected shift down.
                                if (dismissed.current) {
                                  dismissed.current = false;
                                  return;
                                }
                                // Which half of the column was pressed. Read
                                // off the element rather than off the row, so
                                // it is right whatever the column's width.
                                const box =
                                  e.currentTarget.getBoundingClientRect();
                                const into =
                                  box.width > 0
                                    ? (e.clientX - box.left) / box.width
                                    : 0;
                                onAddShift!(
                                  emp.id,
                                  day.date,
                                  h * 60 + (into >= 0.5 ? 30 : 0),
                                );
                              }
                            : undefined
                        }
                        title={
                          canAdd
                            ? t('calendar.dayGrid.addShift', {
                                time: clock(t, h * 60),
                              })
                            : undefined
                        }
                        className={[
                          'group/cell relative',
                          colBorder(i),
                          canAdd
                            ? 'pointer-events-auto cursor-cell hover:bg-brand-50'
                            : '',
                        ].join(' ')}
                        style={closedHour ? CLOSED_HOURS : undefined}
                      >
                        {/* The half hour, drawn only under the pointer. A
                            column is an hour because a day reads better that
                            way, but a press lands on the half it fell in, and
                            a control that can do something it never shows is
                            a control nobody uses. */}
                        {canAdd && (
                          <span
                            aria-hidden
                            className="absolute inset-y-1 left-1/2 hidden w-px bg-brand-300 group-hover/cell:block"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Unavailable: say exactly why, in the manager's words. */}
                {blocked && (
                  <div
                    className={[
                      'absolute inset-y-1 left-0 right-0 flex items-center justify-center rounded',
                      'text-[11px] font-medium',
                      // Settled fact reads grey; a this-day-only reason
                      // (on leave, booked absence) reads amber. Decided on the
                      // kind, never on the wording -- the wording is translated.
                      blocked.kind === 'on_leave' || blocked.kind === 'absence'
                        ? AWAY_ROW
                        : OFF_ROW,
                    ].join(' ')}
                    title={t('calendar.dayGrid.notScheduled', {
                      reason: blocked.reason,
                    })}
                  >
                    {blocked.reason}
                  </div>
                )}

                {/* shift bars */}
                {!blocked &&
                  segs.map((seg) => {
                    const a = seg.assignment;
                    // A spill from last night is drawn on today's track but
                    // its hours are counted from yesterday's midnight.
                    const offset = a.date === day.date ? 0 : DAY_MIN;
                    const drag = dragPreview?.assignment.id === a.id ? dragPreview : null;
                    // A resize redraws the bar itself at its new size, cut to
                    // the track like any segment so it cannot poke out past
                    // the ruler. A move leaves the bar where it was, faded,
                    // and draws the shift again where it is going (the ghost,
                    // below): the manager sees both ends of the trip.
                    const live = drag && drag.mode !== 'move' ? drag.preview : null;
                    const carried = drag?.mode === 'move';
                    const segStart = live
                      ? Math.max(live.startMin - offset, track.startMin)
                      : seg.startMin;
                    const segEnd = live
                      ? Math.min(live.endMin - offset, track.endMin)
                      : seg.endMin;
                    // Measured off the track, not off a fixed 24 hours: for a
                    // day that ends by midnight the track IS the 24 hours, so
                    // this is the same arithmetic it always was.
                    const left = ((segStart - track.startMin) / trackSpan) * 100;
                    const width = ((segEnd - segStart) / trackSpan) * 100;
                    const ot = a.overtimeHours > 0;
                    const extra = a.extraHours > 0;
                    // An edge cut by the track belongs to another row: the
                    // start of a spill from last night is yesterday's to move.
                    const canDragStart = Boolean(onResizeShift) && !seg.continuesFromPrev;
                    const canDragEnd = Boolean(onResizeShift) && !seg.continuesToNext;
                    // Carried only from the day it starts on, for the same
                    // reason: the spill is the tail of yesterday's shift, and
                    // yesterday's row is where the whole of it can be seen.
                    const canMove = Boolean(onMoveShift) && offset === 0;
                    const editable =
                      Boolean(onRemoveShift) || canDragStart || canDragEnd || canMove;
                    const isSelected = selected === a.id;
                    // The shade alone marks the night hours; what they are
                    // paid is in the tooltip. Written on the bar as well, it
                    // repeated the same percentage on every night shift.
                    const stripes = premiumSpans(segStart, segEnd);

                    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
                      if (!editable || e.button !== 0) return;
                      e.stopPropagation();
                      const row = e.currentTarget.parentElement;
                      if (!row) return;
                      const bar = e.currentTarget.getBoundingClientRect();
                      const rect = row.getBoundingClientRect();
                      // The ends take hold of an edge, the body of the whole
                      // shift. On a bar too short for both, the grips shrink
                      // so there is always some middle left to carry.
                      const grip = Math.min(GRIP_PX, bar.width / 4);
                      const x = e.clientX - bar.left;
                      const mode: DragMode =
                        canDragStart && x <= grip
                          ? 'start'
                          : canDragEnd && x >= bar.width - grip
                            ? 'end'
                            : canMove
                              ? 'move'
                              : // Nothing to carry (the tail of last night):
                                // the body pulls whichever edge this row owns.
                                canDragEnd
                                ? 'end'
                                : canDragStart
                                  ? 'start'
                                  : 'none';
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const from = { startMin: a.startMin, endMin: a.endMin };
                      dragRef.current = {
                        assignment: a,
                        mode,
                        from,
                        bounds:
                          mode === 'start' || mode === 'end'
                            ? boundsFor(a, offset)
                            : { minStart: a.startMin, maxEnd: a.endMin },
                        wall: wallFor(offset),
                        offset,
                        left: rect.left,
                        width: rect.width,
                        pressX: e.clientX,
                        pressY: e.clientY,
                        moved: false,
                        preview: from,
                        employeeId: a.employeeId,
                        problem: null,
                      };
                    };

                    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
                      const d = dragRef.current;
                      if (!d || d.assignment.id !== a.id || d.mode === 'none') return;
                      if (
                        !d.moved &&
                        Math.hypot(e.clientX - d.pressX, e.clientY - d.pressY) < DRAG_SLOP_PX
                      ) {
                        return;
                      }
                      d.moved = true;
                      let next: Interval;
                      if (d.mode === 'move') {
                        const deltaMin = ((e.clientX - d.pressX) / d.width) * trackSpan;
                        next = movedInterval(d.from, deltaMin, d.wall);
                        // Between rows, or out over the ruler, it stays in
                        // the last row it was over rather than snapping home.
                        const target = rowUnder(e.clientX, e.clientY) ?? d.employeeId;
                        if (
                          next.startMin === d.preview.startMin &&
                          next.endMin === d.preview.endMin &&
                          target === d.employeeId
                        ) {
                          return;
                        }
                        d.employeeId = target;
                        d.problem = moveProblem(a, target, next);
                      } else {
                        const ratio = (e.clientX - d.left) / d.width;
                        const pointerMin = track.startMin + ratio * trackSpan + d.offset;
                        next = draggedInterval(d.from, d.mode, pointerMin, d.bounds);
                        if (
                          next.startMin === d.preview.startMin &&
                          next.endMin === d.preview.endMin
                        ) {
                          return;
                        }
                      }
                      d.preview = next;
                      setDragPreview({
                        assignment: a,
                        mode: d.mode,
                        preview: next,
                        offset: d.offset,
                        employeeId: d.employeeId,
                        problem: d.problem,
                      });
                    };

                    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
                      const d = dragRef.current;
                      if (!d || d.assignment.id !== a.id) return;
                      e.stopPropagation();
                      endDrag();
                      // A press that never travelled is a click: it puts the
                      // frame with the X on this shift, or takes it off.
                      if (!d.moved) {
                        setSelectedId((cur) => (cur === a.id ? null : a.id));
                        return;
                      }
                      const changed =
                        d.preview.startMin !== d.from.startMin ||
                        d.preview.endMin !== d.from.endMin;
                      if (d.mode === 'move') {
                        // Somewhere it cannot land is a drop that does not
                        // happen: the shift goes back where it was.
                        if (d.problem) return;
                        if (changed || d.employeeId !== a.employeeId) {
                          onMoveShift?.(a.id, d.employeeId, d.preview.startMin, d.preview.endMin);
                        }
                        return;
                      }
                      if (changed) onResizeShift?.(a.id, d.preview.startMin, d.preview.endMin);
                    };

                    const hints = [
                      onRemoveShift ? t('calendar.dayGrid.shift.clickToSelect') : '',
                      canMove ? t('calendar.dayGrid.shift.dragToMove') : '',
                      canDragStart || canDragEnd ? t('calendar.dayGrid.shift.dragToResize') : '',
                    ].filter(Boolean);

                    /** One grip, drawn only where the edge can actually move. */
                    const grip = (side: 'left' | 'right') => (
                      <span
                        aria-hidden
                        className={[
                          'absolute inset-y-0 z-10 flex w-2.5 cursor-ew-resize items-center justify-center',
                          side === 'left' ? 'left-0' : 'right-0',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'h-3.5 w-[3px] rounded-full bg-white/90 shadow-[0_0_0_1px_rgb(11_21_18/0.35)] transition-opacity',
                            'motion-reduce:transition-none',
                            isSelected || live
                              ? 'opacity-100'
                              : 'opacity-0 group-hover:opacity-90',
                          ].join(' ')}
                        />
                      </span>
                    );

                    return (
                      <div
                        key={seg.key}
                        data-shift-bar
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={endDrag}
                        className={[
                          'group absolute inset-y-1',
                          // No text selection and no page scroll on a phone
                          // while a bar is being dragged.
                          editable ? 'select-none touch-none' : '',
                          editable
                            ? carried
                              ? 'cursor-grabbing'
                              : canMove
                                ? 'cursor-grab'
                                : 'cursor-pointer'
                            : '',
                          // The frame goes round the outside of the bar, so
                          // it reads as "this one" without repainting it.
                          isSelected || live
                            ? 'z-20 ring-2 ring-brand-300 ring-offset-2 ring-offset-surface'
                            : 'z-10',
                          seg.continuesFromPrev ? 'rounded-l-none' : 'rounded-l-md',
                          seg.continuesToNext ? 'rounded-r-none' : 'rounded-r-md',
                        ].join(' ')}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        // No tooltip while dragging: it would follow the
                        // pointer and cover the very hour being aimed at.
                        title={
                          dragPreview
                            ? undefined
                            : `${a.templateName} · ${clock(t, a.startMin)}–${clock(t, a.endMin)} · ${fmtHours(a.paidHours)}${premiumHours(a) ? ` · ${t('calendar.dayGrid.shift.nightPremium', { hours: fmtHours(premiumHours(a)), pct: nightPremiumPct })}` : ''}${extra ? ` · ${t('calendar.dayGrid.shift.beyondContract', { hours: fmtHours(a.extraHours) })}` : ''}${ot ? ` · ${t('calendar.dayGrid.shift.overtime', { hours: fmtHours(a.overtimeHours) })}` : ''}${a.source === 'manual' ? ` · ${t('calendar.dayGrid.shift.manual')}` : ''}${hints.length ? ` — ${hints.join(' · ')}` : ''}`
                        }
                      >
                        {/* The bar itself. Clipped, so the stripes keep to its
                            rounded corners; the grips, the X and the caption
                            live outside the clip, on the wrapper. */}
                        <div
                          className={[
                            'absolute inset-0 flex items-center overflow-hidden px-3',
                            'text-[11px] font-medium text-white transition-[opacity,filter]',
                            'motion-reduce:transition-none',
                            seg.continuesFromPrev ? 'rounded-l-none' : 'rounded-l-md',
                            seg.continuesToNext ? 'rounded-r-none' : 'rounded-r-md',
                            carried
                              ? 'opacity-30'
                              : editable
                                ? 'group-hover:brightness-110'
                                : '',
                          ].join(' ')}
                          style={SHIFT_BAR}
                        >
                          {/* The hours inside this shift that are paid at a
                              different rate, shaded where they actually fall.
                              Positioned against the SEGMENT, not the day: a
                              shift drawn across two rows gets the part of the
                              night that belongs to the piece being drawn. */}
                          {stripes.map((p) => (
                            <span
                              key={`${p.from}-${p.to}`}
                              aria-hidden
                              className="pointer-events-none absolute inset-y-0"
                              style={{
                                ...PREMIUM_HOURS,
                                left: `${p.left}%`,
                                width: `${p.width}%`,
                              }}
                            />
                          ))}
                          {/* `relative` is what keeps the words on top. The
                              stripes are positioned, and a positioned box
                              paints over anything that is not -- which is how
                              a shift worked wholly at night used to lose its
                              name under its own shading. */}
                          <span className="relative truncate">
                            {width > 20
                              ? `${a.templateName} · ${clock(t, live ? live.startMin - offset : seg.startMin)}–${clock(t, live ? live.endMin - offset : seg.endMin)}`
                              : width > 8
                                ? a.templateName
                                : ''}
                            {extra && width > 28
                              ? ` · ${t('calendar.dayGrid.shift.extraTag')}`
                              : ''}
                            {ot && width > 28
                              ? ` · ${t('calendar.dayGrid.shift.overtimeTag')}`
                              : ''}
                          </span>
                          {/* The hatch says it to the eye; this says it to a
                              screen reader. Not on the bar in words: Max took
                              "night +X%" off the bars (PR #112). */}
                          {premiumHours(a) > 0 && (
                            <span className="sr-only">
                              {' · '}
                              {t('calendar.dayGrid.shift.nightPremium', {
                                hours: fmtHours(premiumHours(a)),
                                pct: nightPremiumPct,
                              })}
                            </span>
                          )}
                        </div>

                        {/* Grips at each edge that can move: shown on hover
                            and on the selected shift, so a month of bars stays
                            clean but the one in hand shows where to pull. */}
                        {canDragStart && !carried && grip('left')}
                        {canDragEnd && !carried && grip('right')}

                        {/* While an edge is pulled, the hours it has got to,
                            above the bar -- the words inside it truncate
                            exactly when the bar gets short enough to matter. */}
                        {live && dragBadge(live, offset, null)}

                        {/* Removing is a second, deliberate press on the
                            frame, never the click that selected it. */}
                        {isSelected && onRemoveShift && !drag && (
                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(null);
                              onRemoveShift(a.id);
                            }}
                            aria-label={t('calendar.dayGrid.shift.remove')}
                            title={t('calendar.dayGrid.shift.remove')}
                            className={[
                              'absolute -right-2.5 -top-2.5 z-30 flex h-5 w-5 items-center justify-center',
                              'rounded-full bg-surface text-gray-700 shadow-[0_4px_12px_-2px_rgb(0_0_0/0.6)] ring-1 ring-white/20',
                              'transition-colors hover:bg-danger hover:text-white hover:ring-danger',
                              'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500',
                              'motion-reduce:transition-none',
                            ].join(' ')}
                          >
                            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
                              <path
                                d="M3 3l6 6M9 3l-6 6"
                                stroke="currentColor"
                                strokeWidth="1.75"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })}

                {/* The shift being carried, drawn where it would land. In the
                    row it is over, whoever's that is -- including a row that
                    cannot take it, where it turns red and says why. */}
                {dragPreview?.mode === 'move' &&
                  dragPreview.employeeId === emp.id &&
                  (() => {
                    const g = dragPreview;
                    const gs = Math.max(g.preview.startMin - g.offset, track.startMin);
                    const ge = Math.min(g.preview.endMin - g.offset, track.endMin);
                    if (ge <= gs) return null;
                    const gw = ((ge - gs) / trackSpan) * 100;
                    return (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-y-1 z-30"
                        style={{
                          left: `${((gs - track.startMin) / trackSpan) * 100}%`,
                          width: `${gw}%`,
                        }}
                      >
                        <div
                          className={[
                            'flex h-full items-center overflow-hidden rounded-md px-3',
                            'text-[11px] font-medium text-white ring-2 ring-white/90',
                            'shadow-[0_12px_28px_-10px_rgb(68_214_180/0.55)]',
                          ].join(' ')}
                          style={g.problem ? SHIFT_BAR_REFUSED : SHIFT_BAR}
                        >
                          <span className="truncate">
                            {gw > 20
                              ? `${g.assignment.templateName} · ${clock(t, gs)}–${clock(t, ge)}`
                              : gw > 8
                                ? g.assignment.templateName
                                : ''}
                          </span>
                        </div>
                        {dragBadge(g.preview, g.offset, g.problem)}
                      </div>
                    );
                  })()}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
