// The week the chosen day is in, as seven tabs, and the ways to leave it.
//
// Tabs because picking a day swaps the editor underneath (the repo's rule for
// anything that changes a panel; see the ui-movil-y-accesible skill). One
// departure from the textbook pattern, on purpose: ← on Monday and → on Sunday
// do not wrap round the week, they walk into the next one. Days are a line.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../../lib/i18n';
import {
  longDate,
  parsePickedDate,
  shiftDay,
  stripKeyTarget,
  weekOf,
  weekdayInitial,
} from '../../lib/dayNotes/days';
import { fromDateKey } from '../../lib/schedule/focus';
import { Icon } from './icons';

export const dayTabId = (key: string) => `day-note-tab-${key}`;

const ROUND_BUTTON =
  'flex h-10 w-7 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 motion-reduce:transition-none sm:w-9';

export function WeekStrip({
  day,
  today,
  noteDates,
  panelId,
  onSelect,
}: {
  day: string;
  today: string;
  /** Days that have a note, for the dot. */
  noteDates: Set<string>;
  panelId: string;
  onSelect: (key: string) => void;
}) {
  const t = useT();
  const list = useRef<HTMLDivElement>(null);
  // Set by the keyboard only: a click already has focus where it belongs, and
  // stealing it from the ‹ › buttons would make a second click land elsewhere.
  const refocus = useRef(false);

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, [day]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = stripKeyTarget(e.key, day);
    if (!target) return;
    e.preventDefault();
    refocus.current = true;
    onSelect(target);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSelect(shiftDay(day, -7))}
        aria-label={t('dayNotes.previousWeek')}
        className={ROUND_BUTTON}
      >
        <Icon name="chevronLeft" />
      </button>

      <div
        ref={list}
        role="tablist"
        aria-label={t('dayNotes.days')}
        onKeyDown={onKeyDown}
        className="grid min-w-0 flex-1 grid-cols-7"
      >
        {weekOf(day).map((key) => {
          const selected = key === day;
          const isToday = key === today;
          const hasNote = noteDates.has(key);
          // The label says what the ring and the dot say, for whoever cannot
          // see them.
          const label = [
            longDate(key),
            isToday ? t('dayNotes.day.today') : null,
            hasNote ? t('dayNotes.day.hasNote') : null,
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <button
              key={key}
              id={dayTabId(key)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              aria-label={label}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(key)}
              className="group flex min-w-0 flex-col items-center gap-1 rounded-lg py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <span aria-hidden="true" className="text-[11px] font-medium uppercase text-gray-500">
                {weekdayInitial(key)}
              </span>
              <span
                aria-hidden="true"
                className={[
                  // 24px under 360: a 320px phone leaves ~30px a column, and the ring
                  // round today needs room to not touch its neighbours.
                  'flex h-6 w-6 items-center justify-center rounded-full text-sm tabular-nums min-[360px]:h-7 min-[360px]:w-7 sm:h-8 sm:w-8',
                  'transition-colors motion-reduce:transition-none',
                  selected
                    ? 'bg-brand-600 font-semibold text-white shadow-[0_6px_18px_-6px_rgb(68_214_180/0.7)]'
                    : 'text-gray-800 group-hover:bg-white/[0.07]',
                  // Today is a ring as well as a weight: a shape, so it reads
                  // without colour, and it survives being the selected day.
                  isToday && selected ? 'ring-2 ring-brand-400 ring-offset-2' : '',
                  isToday && !selected ? 'font-semibold text-brand-700 ring-2 ring-inset ring-brand-400' : '',
                ].join(' ')}
              >
                {fromDateKey(key).getDate()}
              </span>
              <span
                aria-hidden="true"
                className={['h-1.5 w-1.5 rounded-full', hasNote ? 'bg-brand-400' : ''].join(' ')}
              />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onSelect(shiftDay(day, 7))}
        aria-label={t('dayNotes.nextWeek')}
        className={ROUND_BUTTON}
      >
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}

/**
 * A calendar button that opens the browser's own date picker. Where the
 * browser cannot open it from a button (no `showPicker`), the date box itself
 * appears beside the button instead.
 */
export function DatePickButton({ day, onPick }: { day: string; onPick: (key: string) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) input.current?.focus();
  }, [visible]);

  const open = () => {
    const el = input.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
        return;
      } catch {
        // Not allowed here (an iframe, an old engine): show the box instead.
      }
    }
    setVisible((v) => !v);
  };

  return (
    <span className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={open}
        aria-label={t('dayNotes.pickDate')}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/[0.04] text-gray-600 transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 motion-reduce:transition-none"
      >
        <Icon name="calendar" />
      </button>
      <input
        ref={input}
        type="date"
        value={day}
        onChange={(e) => {
          const picked = parsePickedDate(e.target.value);
          if (picked) {
            onPick(picked);
            setVisible(false);
          }
        }}
        aria-label={t('dayNotes.pickDate')}
        aria-hidden={visible ? undefined : true}
        tabIndex={visible ? 0 : -1}
        className={
          visible
            ? 'rounded-lg border border-gray-400 px-2 py-1 text-sm text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/25'
            : // Rendered, not display:none -- a picker needs a box to hang from --
              // but invisible and under the button, so it opens there.
              'pointer-events-none absolute inset-0 h-8 w-8 opacity-0'
        }
      />
    </span>
  );
}
