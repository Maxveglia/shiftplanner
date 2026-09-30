// The employee's shifts for a period, as a list rather than a grid.
//
// The manager needs a 24-hour grid because their question is "who covers this
// hour?". The employee's question is "when do I work?", and for one person a
// grid is 23 empty columns. Days without a shift are left out entirely: an
// empty row is not information.

import type { Assignment, DayRef } from '../../lib/schedule/types';
import { isWeekendDay } from '../../lib/schedule/demand';
import { formatHours, formatShiftRange } from '../../lib/format';
import { useT, type TFunction } from '../../lib/i18n';

interface ShiftListProps {
  days: DayRef[];
  assignments: Assignment[];
  /** Local YYYY-MM-DD of today, so "Today" is marked without re-deriving it. */
  todayKey: string;
  /**
   * The weekdays this business calls its weekend, or undefined for Sat/Sun.
   *
   * The tag has to agree with what the payslip says: telling somebody a Friday
   * night is not a weekend while paying them a weekend premium for it is worse
   * than not tagging it at all.
   */
  weekendDays?: number[];
  /**
   * Ids of shifts this reader has not seen before.
   *
   * "New to you", not "newly created": a shift whose hours moved is new to the
   * person working it, and that is the case the badge exists for. The screen
   * cannot tell the two apart -- both are stamped as announced today -- and a
   * badge that says only "look again" is true in both. The email and the push
   * notification, which are built from the server's own comparison, are where
   * the precise sentence belongs.
   */
  fresh?: Set<string>;
  /**
   * Open the team for a day. Absent where there is nothing to open.
   *
   * Only ever called with a date this person WORKS -- the list only draws
   * days they have a shift on -- which is also the rule the server enforces
   * before it answers.
   */
  onOpenDay?: (date: string) => void;
}

function dayHeading(day: DayRef, todayKey: string, t: TFunction): string {
  if (day.date === todayKey) return t('employee.shiftList.today', { label: day.label });
  return day.label;
}

export function ShiftList({
  days,
  assignments,
  todayKey,
  weekendDays,
  fresh,
  onOpenDay,
}: ShiftListProps) {
  const t = useT();
  const byDate = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const list = byDate.get(a.date);
    if (list) list.push(a);
    else byDate.set(a.date, [a]);
  }

  const worked = days.filter((d) => byDate.has(d.date));

  if (worked.length === 0) {
    return (
      <div className="sc-glass rounded-3xl border-dashed !border-white/15 p-8 text-center">
        <p className="text-base font-medium text-gray-900">
          {t('employee.shiftList.empty.title')}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {t('employee.shiftList.empty.body')}
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-2.5">
      {worked.map((day) => {
        const shifts = [...byDate.get(day.date)!].sort(
          (a, b) => a.startMin - b.startMin,
        );
        const isToday = day.date === todayKey;
        return (
          <li
            key={day.date}
            className={['sc-glass rounded-2xl px-4 py-3.5', isToday ? 'sc-now' : ''].join(' ')}
          >
            <p
              className={[
                'text-xs font-medium uppercase tracking-wide',
                isToday ? 'text-brand-300' : 'text-gray-500',
              ].join(' ')}
            >
              {dayHeading(day, todayKey, t)}
            </p>

            <div className="mt-2 space-y-2">
              {shifts.map((s) => (
                // A button when there is somewhere to go, a plain row when
                // there is not. Rendering a button that does nothing would
                // promise a press this screen cannot answer.
                <button
                  key={s.id}
                  type="button"
                  onClick={onOpenDay ? () => onOpenDay(day.date) : undefined}
                  disabled={!onOpenDay}
                  aria-label={
                    onOpenDay
                      ? t('employee.shiftList.openDay', {
                          range: formatShiftRange(s.startMin, s.endMin),
                        })
                      : undefined
                  }
                  className={[
                    'flex w-full items-center gap-3 rounded-lg text-left',
                    onOpenDay
                      ? '-mx-2 px-2 py-1.5 transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300'
                      : 'cursor-default',
                  ].join(' ')}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-base font-semibold tabular-nums text-gray-900">
                      {formatShiftRange(s.startMin, s.endMin)}
                      {fresh?.has(s.id) && (
                        <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-800 ring-1 ring-brand-300/30">
                          {t('employee.shiftList.tag.new')}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {s.templateName}
                      {s.isNight && ` · ${t('employee.shiftList.tag.night')}`}
                      {isWeekendDay(day.weekday, weekendDays) &&
                        ` · ${t('employee.shiftList.tag.weekend')}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium tabular-nums text-gray-900">
                      {formatHours(s.paidHours)}
                    </p>
                    {s.overtimeHours > 0 && (
                      <p className="text-[11px] font-medium tabular-nums text-red-600">
                        {t('employee.shiftList.overtime', {
                          hours: formatHours(s.overtimeHours),
                        })}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
