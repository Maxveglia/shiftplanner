// Seven days down the left, the hours of the day across the right, and on
// each day a bar the manager drags over the hours the business is open.
//
// Every gesture is one of four: press on an empty day and pull to draw its
// bar; press on a bar and slide it; press on either end and stretch it. The
// arithmetic of all four is in lib/onboarding/weekHours.ts and tested there;
// this file measures the track, turns a pointer into a fraction of it, and
// draws the result. Pointer events rather than mouse events so a finger on a
// phone does the same as a mouse, with the pointer captured by the row so a
// drag that leaves the bar keeps going.
//
// A day is closed by a button, not by dragging the bar away to nothing: a bar
// can never be narrower than an hour (a thinner one cannot be grabbed), so
// "closed" has to be its own state. It is also the one thing the copy button
// copies along with the hours -- a shop shut on Sundays is shut on Sundays.
//
// The line on how the bars behave is not drawn here but under the grid by
// InterviewChat, beside the form's button when the window is short.

import { useRef, useState } from 'react';
import { WEEK_READING_ORDER } from '../../lib/onboarding/firstRun';
import {
  DragState,
  TRACK_END_MIN,
  closesNextDay,
  copyToAll,
  dragTo,
  fractionAt,
  minutesAtFraction,
  nudge,
  type DayRange,
  type WeekHours,
} from '../../lib/onboarding/weekHours';
import { hhmm, weekdayName, weekdayShortName } from '../../lib/schedule/spec';
import { useT } from '../../lib/i18n';

interface OpeningHoursGridProps {
  week: WeekHours;
  onChange: (week: WeekHours) => void;
  disabled?: boolean;
  /**
   * Lower rows in a short window, on a screen wide enough to be a computer's.
   * The welcome page must show the whole week and its button without
   * scrolling, down to 1000×565; on a phone the rows keep their height for
   * the finger, and the conversation scrolls instead.
   */
  fitWindow?: boolean;
}

/** Where the hour marks go: every six hours, and the end of the track. */
const HOUR_MARKS = [0, 6, 12, 18, 24, 30];

/** Below this share of the track a bar cannot hold its own times. */
const LABEL_INSIDE_MIN_PCT = 24;
/** Room a label needs beside a bar, as a share of the track. */
const LABEL_OUTSIDE_PCT = 20;

export function OpeningHoursGrid({
  week,
  onChange,
  disabled = false,
  fitWindow = false,
}: OpeningHoursGridProps) {
  const t = useT();
  const drag = useRef<DragState | null>(null);

  const setDay = (weekday: number, range: DayRange) => onChange({ ...week, [weekday]: range });

  return (
    <div className="select-none">
      {/* The ruler: hour marks over the tracks, aligned with the same grid
          the rows use so 12:00 on the ruler is 12:00 on every bar. */}
      <div className="grid grid-cols-[4.5rem_1fr_auto] items-end gap-x-2 sm:grid-cols-[6rem_1fr_auto]">
        <div />
        <div className="relative h-5 text-[10px] text-gray-500">
          {HOUR_MARKS.map((h) => (
            <span
              key={h}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${fractionAt(h * 60) * 100}%` }}
            >
              {h === 30 ? '06:00' : `${String(h % 24).padStart(2, '0')}:00`}
            </span>
          ))}
        </div>
        <div className="w-[4.5rem]" />
      </div>

      <div
        className={[
          'mt-1 space-y-1.5',
          fitWindow ? '[@media(min-width:640px)_and_(max-height:920px)]:space-y-1' : '',
        ].join(' ')}
      >
        {WEEK_READING_ORDER.map((weekday) => (
          <DayRow
            key={weekday}
            weekday={weekday}
            range={week[weekday] ?? null}
            disabled={disabled}
            fitWindow={fitWindow}
            drag={drag}
            onRange={(r) => setDay(weekday, r)}
            onCopy={() => onChange(copyToAll(week, weekday))}
            labels={{
              closed: t('interview.hours.closed'),
              open: t('interview.hours.open'),
              copy: t('interview.hours.copyToAll'),
              copyShort: t('interview.hours.copy'),
              closedHint: t('interview.hours.closedHint'),
              openHandle: t('interview.hours.handle.open', { day: weekdayName(weekday) }),
              closeHandle: t('interview.hours.handle.close', { day: weekdayName(weekday) }),
            }}
          />
        ))}
      </div>
    </div>
  );
}

interface DayRowProps {
  weekday: number;
  range: DayRange;
  disabled: boolean;
  fitWindow: boolean;
  drag: React.MutableRefObject<DragState | null>;
  onRange: (range: DayRange) => void;
  onCopy: () => void;
  labels: {
    closed: string;
    open: string;
    copy: string;
    copyShort: string;
    closedHint: string;
    openHandle: string;
    closeHandle: string;
  };
}

function DayRow({
  weekday,
  range,
  disabled,
  fitWindow,
  drag,
  onRange,
  onCopy,
  labels,
}: DayRowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  // Re-rendered while dragging so the bar follows the pointer; the range
  // itself lives in the parent's week, this is only what is on screen now.
  const [preview, setPreview] = useState<DayRange | undefined>(undefined);
  const shown = preview === undefined ? range : preview;

  const minutesAt = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const box = el.getBoundingClientRect();
    return minutesAtFraction((clientX - box.left) / Math.max(1, box.width));
  };

  const begin = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    const target = e.target as HTMLElement;
    const handle = target.closest<HTMLElement>('[data-edge]')?.dataset.edge;
    const onBar = !!target.closest('[data-bar]');
    const at = minutesAt(e.clientX);
    const kind: DragState['kind'] =
      handle === 'start' || handle === 'end' ? handle : range && onBar ? 'move' : 'create';
    drag.current = { kind, weekday, anchorMin: at, origin: range };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPreview(dragTo(drag.current, at));
    e.preventDefault();
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.weekday !== weekday) return;
    setPreview(dragTo(d, minutesAt(e.clientX)));
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.weekday !== weekday) return;
    const final = dragTo(d, minutesAt(e.clientX));
    drag.current = null;
    setPreview(undefined);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    onRange(final);
  };

  const cancel = () => {
    drag.current = null;
    setPreview(undefined);
  };

  const onHandleKey = (edge: 'start' | 'end') => (e: React.KeyboardEvent) => {
    if (disabled) return;
    const steps = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!steps) return;
    e.preventDefault();
    onRange(nudge(range, edge, e.shiftKey ? steps * 2 : steps));
  };

  const left = shown ? fractionAt(shown.openMin) * 100 : 0;
  const width = shown ? (fractionAt(shown.closeMin) - fractionAt(shown.openMin)) * 100 : 0;
  // A short day's bar is too narrow for its own times, so they sit beside
  // it instead -- to the right when there is room, to the left at the end
  // of the track.
  const labelInside = width >= LABEL_INSIDE_MIN_PCT;
  const labelAfter = left + width <= 100 - LABEL_OUTSIDE_PCT;
  const times = shown ? (
    <>
      {hhmm(shown.openMin)}–{hhmm(shown.closeMin)}
      {closesNextDay(shown) && <span className="ml-1 opacity-80">+1</span>}
    </>
  ) : null;

  return (
    <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-x-2 sm:grid-cols-[6rem_1fr_auto]">
      <div className="truncate text-sm font-medium text-gray-800">
        <span className="sm:hidden">{weekdayShortName(weekday)}</span>
        <span className="hidden sm:inline">{weekdayName(weekday)}</span>
      </div>

      <div
        ref={trackRef}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={cancel}
        className={[
          'relative h-10 touch-none rounded-lg border border-white/10 bg-black/20',
          // 40px, then 32px and 28px as the window gets shorter; the bar
          // inside keeps 22px in both, room for its times and to be grabbed.
          fitWindow
            ? '[@media(min-width:640px)_and_(max-height:760px)]:h-7 [@media(min-width:640px)_and_(min-height:761px)_and_(max-height:920px)]:h-8'
            : '',
          disabled ? 'opacity-60' : range ? 'cursor-crosshair' : 'cursor-copy',
        ].join(' ')}
      >
        {/* Six-hour lines, and the small hours of the next day shaded so a
            bar that reaches into them visibly leaves the day. */}
        <div
          aria-hidden
          className="absolute inset-y-0 right-0 rounded-r-lg bg-white/[0.05]"
          style={{ width: `${(1 - fractionAt(24 * 60)) * 100}%` }}
        />
        {HOUR_MARKS.slice(1, -1).map((h) => (
          <div
            key={h}
            aria-hidden
            className="absolute inset-y-0 w-px bg-white/[0.07]"
            style={{ left: `${fractionAt(h * 60) * 100}%` }}
          />
        ))}

        {shown ? (
          <div
            data-bar
            className={[
              'sc-self-bar absolute inset-y-1 flex items-center justify-center rounded-md bg-brand-600 text-[11px] font-medium text-white',
              fitWindow ? '[@media(min-width:640px)_and_(max-height:760px)]:inset-y-0.5' : '',
              disabled ? '' : 'cursor-grab active:cursor-grabbing',
            ].join(' ')}
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            {labelInside ? (
              <span className="truncate px-3">{times}</span>
            ) : (
              <span
                className={[
                  'pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-gray-700',
                  labelAfter ? 'left-full ml-2' : 'right-full mr-2',
                ].join(' ')}
              >
                {times}
              </span>
            )}
            <button
              type="button"
              data-edge="start"
              aria-label={labels.openHandle}
              onKeyDown={onHandleKey('start')}
              disabled={disabled}
              className="absolute inset-y-0 left-0 w-3 cursor-ew-resize rounded-l-md bg-white/20 hover:bg-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            />
            <button
              type="button"
              data-edge="end"
              aria-label={labels.closeHandle}
              onKeyDown={onHandleKey('end')}
              disabled={disabled}
              className="absolute inset-y-0 right-0 w-3 cursor-ew-resize rounded-r-md bg-white/20 hover:bg-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            />
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-gray-500">
            {labels.closedHint}
          </div>
        )}
      </div>

      {/* Two short lines in a lower row: set tight enough to fit it. */}
      <div
        className={[
          'flex w-[4.5rem] flex-col items-start gap-0.5',
          fitWindow ? '[@media(min-width:640px)_and_(max-height:920px)]:leading-3' : '',
        ].join(' ')}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => onRange(range ? null : { openMin: 9 * 60, closeMin: 20 * 60 })}
          className="text-[11px] text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline disabled:opacity-50"
        >
          {range ? labels.closed : labels.open}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onCopy}
          title={labels.copy}
          aria-label={labels.copy}
          className="text-[11px] text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline disabled:opacity-50"
        >
          ⧉ {labels.copyShort}
        </button>
      </div>
    </div>
  );
}

// Keeps the track's right edge honest if the constant ever moves: the ruler
// is drawn from HOUR_MARKS, and the last mark must be the end of the track.
if (HOUR_MARKS[HOUR_MARKS.length - 1] * 60 !== TRACK_END_MIN) {
  throw new Error('OpeningHoursGrid: HOUR_MARKS must end where the track ends');
}
