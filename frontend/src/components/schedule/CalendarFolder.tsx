// A closed folder over a stretch of the calendar.
//
// The closed state is the whole point. A month view shows four rows instead of
// 31 full-screen grids, and a year shows twelve, because the children are not
// rendered at all until the folder is opened -- the DOM cost of a period is
// the cost of what the manager actually asked to see.
//
// A closed folder still has to be worth reading, so it carries the dates it
// covers and how much work is inside: that is what makes it a summary rather
// than a lid.

import type { ReactNode } from 'react';
import type { FolderTotals } from '../../lib/schedule/calendar';
import { useT } from '../../lib/i18n';

export function CalendarFolder({
  title,
  range,
  dayCount,
  totals,
  open,
  onToggle,
  level = 'week',
  children,
}: {
  title: string;
  range: string;
  dayCount: number;
  /** Null before a schedule exists -- then there is nothing to count yet. */
  totals: FolderTotals | null;
  open: boolean;
  onToggle: () => void;
  /** Months nest weeks, so they read one step heavier. */
  level?: 'month' | 'week';
  children: ReactNode;
}) {
  const t = useT();
  const isMonth = level === 'month';
  // English pluralises with an "s" on the end; Spanish does not always, so the
  // count and the word travel together in one string per language.
  const count = (n: number, key: string) =>
    t(n === 1 ? `${key}.one` : `${key}.other`, { count: n });

  return (
    <section
      className={[
        'snap-start overflow-hidden rounded-2xl bg-surface',
        isMonth ? 'border border-white/10 shadow-[0_24px_60px_-36px_rgb(0_0_0/0.8)]' : 'border border-white/[0.08]',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={[
          'flex w-full items-center gap-3 px-4 text-left transition-colors hover:bg-white/[0.03] motion-reduce:transition-none',
          isMonth ? 'py-4' : 'py-3',
        ].join(' ')}
      >
        <span
          aria-hidden
          className={[
            'inline-block shrink-0 text-xs text-gray-500 transition-transform motion-reduce:transition-none',
            open ? 'rotate-90' : '',
          ].join(' ')}
        >
          ▶
        </span>
        <span className="min-w-0">
          <span
            className={[
              'block font-semibold text-gray-900 first-letter:uppercase',
              isMonth ? 'text-base' : 'text-sm',
            ].join(' ')}
          >
            {title}
          </span>
          <span className="block text-xs text-gray-500">{range}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs tabular-nums text-gray-500">
          <span>{count(dayCount, 'calendar.folder.days')}</span>
          {totals && (
            <>
              <span className="text-gray-400">·</span>
              <span>{count(totals.shifts, 'calendar.folder.shifts')}</span>
              <span className="text-gray-400">·</span>
              <span>{Math.round(totals.hours)}h</span>
            </>
          )}
        </span>
      </button>

      {/* Rendered only while open: this is where the DOM saving comes from. */}
      {open && (
        <div
          className={[
            'border-t border-white/[0.06] p-3',
            isMonth ? 'space-y-3 bg-white/[0.02]' : 'space-y-4',
          ].join(' ')}
        >
          {children}
        </div>
      )}
    </section>
  );
}
