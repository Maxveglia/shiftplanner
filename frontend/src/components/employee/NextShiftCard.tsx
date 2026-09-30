// The one thing an employee opens this app to find out.
//
// It sits above the period switcher and ignores it: whichever month you happen
// to be browsing, "when am I next in?" has the same answer. A shift already
// under way counts as the next one -- it is still the shift you are on.

import type { Assignment } from '../../lib/schedule/types';
import { minutesToDate } from '../../lib/schedule/persist';
import { formatHours, formatShiftRange } from '../../lib/format';
import { APP_LOCALE } from '../../lib/locale';
import { useT, type TFunction } from '../../lib/i18n';
import type { CSSProperties } from 'react';
import { SHIFT_BAR } from '../schedule/calendarLook';

/** Second on the screen, after the greeting (`sc-rise`, motion-screens.css). */
const RISE = { '--i': 1 } as CSSProperties;

interface NextShiftCardProps {
  /** Upcoming shifts, any order. */
  assignments: Assignment[];
  now: Date;
  /**
   * Ids of shifts this reader has not seen before. See `ShiftList`.
   *
   * It matters most here: this card is the one thing somebody opens the app
   * to check, and it is the shift they are most likely to have memorised
   * wrongly.
   */
  fresh?: Set<string>;
}

function whenLabel(start: Date, now: Date, t: TFunction): string {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round(
    (new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() -
      midnight.getTime()) /
      86_400_000,
  );
  if (days === 0) return t('employee.next.today');
  if (days === 1) return t('employee.next.tomorrow');
  return start.toLocaleDateString(APP_LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function NextShiftCard({ assignments, now, fresh }: NextShiftCardProps) {
  const t = useT();
  const upcoming = assignments
    .map((a) => ({
      shift: a,
      start: minutesToDate(a.date, a.startMin),
      end: minutesToDate(a.date, a.endMin),
    }))
    .filter((s) => s.end > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const next = upcoming[0];

  if (!next) {
    return (
      <section className="sc-glass sc-rise rounded-3xl p-5 sm:p-6" style={RISE}>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {t('employee.next.label')}
        </p>
        <p className="mt-1 text-lg font-medium text-gray-900">
          {t('employee.next.empty.title')}
        </p>
        <p className="mt-0.5 text-sm text-gray-500">
          {t('employee.next.empty.body')}
        </p>
      </section>
    );
  }

  const onShift = next.start <= now;
  const hoursAway = (next.start.getTime() - now.getTime()) / 3_600_000;
  const daysAway = Math.round(hoursAway / 24);
  const countdown = onShift
    ? t('employee.next.endsAt', {
        time: next.end.toLocaleTimeString(APP_LOCALE, {
          hour: '2-digit',
          minute: '2-digit',
        }),
      })
    : hoursAway < 1
      ? t('employee.next.startsInMinutes', {
          minutes: Math.max(1, Math.round(hoursAway * 60)),
        })
      : hoursAway < 24
        ? t('employee.next.startsInHours', { hours: Math.round(hoursAway) })
        : t(
            daysAway === 1
              ? 'employee.next.inDays.one'
              : 'employee.next.inDays.other',
            { count: daysAway },
          );

  return (
    // The panel the screen is for, lit in menta; on shift it also takes the
    // "now" edge the list gives today.
    <section
      className={['sc-hero sc-rise rounded-3xl p-5 sm:p-6', onShift ? 'sc-now' : ''].join(' ')}
      style={RISE}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-300">
          {onShift ? t('employee.next.onShift') : t('employee.next.label')}
        </p>
        <div className="flex items-center gap-2">
          {fresh?.has(next.shift.id) && (
            <span className="rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-white shadow-[0_6px_18px_-8px_rgb(68_214_180/0.9)]">
              {t('employee.shiftList.tag.new')}
            </span>
          )}
          <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-white/15">
            {countdown}
          </span>
        </div>
      </div>

      <p className="mt-3 text-sm font-medium text-gray-700 first-letter:uppercase">
        {whenLabel(next.start, now, t)}
      </p>
      <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums text-gray-900 sm:text-5xl">
        {formatShiftRange(next.shift.startMin, next.shift.endMin)}
      </p>
      <p className="mt-2 flex items-center gap-2 text-sm text-gray-500">
        {/* The calendar's own shift, not the template's colour from the
            server: every bar the manager sees is this one menta now, and
            the employee's card speaks the same (calendarLook). */}
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={SHIFT_BAR} aria-hidden />
        {t('employee.next.meta', {
          template: next.shift.templateName,
          hours: formatHours(next.shift.paidHours),
        })}
      </p>
    </section>
  );
}
