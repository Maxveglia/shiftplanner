// "Sarah: Friday 6 off. Luis covers Friday 6, 16:00–22:00."
//
// The one line under the adjustment bar that says what just happened to
// whom. A calendar with one shift moved looks exactly like the calendar
// before it, and a manager who cannot see the difference cannot trust the
// tool with a week the team has already seen. Read off a `ScheduleDiff`;
// nothing here decides anything.

import type { EmployeeOut } from '../../types';
import type { ScheduleDiff, ShiftRef } from '../../lib/schedule/diff';
import { APP_LOCALE } from '../../lib/locale';
import { formatTime } from '../../lib/format';
import { useT } from '../../lib/i18n';

function dayLabel(date: string): string {
  // Noon, so no timezone can push the date to the day before.
  return new Date(`${date}T12:00:00`).toLocaleDateString(APP_LOCALE, {
    weekday: 'long',
    day: 'numeric',
  });
}

function span(s: ShiftRef): string {
  return `${formatTime(s.startMin)}–${formatTime(s.endMin)}`;
}

/** The lines of a diff, one per change, ready to print. Exported for tests. */
export function describeDiff(
  diff: ScheduleDiff,
  employees: EmployeeOut[],
  t: (key: string, vars?: Record<string, string | number>) => string,
): string[] {
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.full_name ?? id;
  const lines: string[] = [];
  for (const p of diff.people) {
    const name = nameOf(p.employeeId);
    for (const r of p.removed) {
      lines.push(t('schedule.changes.off', { name, day: dayLabel(r.date), hours: span(r) }));
    }
    for (const m of p.moved) {
      lines.push(
        t('schedule.changes.moved', {
          name,
          day: dayLabel(m.date),
          from: span(m.from),
          to: span(m.to),
        }),
      );
    }
    for (const a of p.added) {
      lines.push(t('schedule.changes.covers', { name, day: dayLabel(a.date), hours: span(a) }));
    }
  }
  return lines;
}

/** The lines, as a list. Shared by the adjustment bar and the publish dialog. */
export function ChangeList({
  diff,
  employees,
  className = '',
}: {
  diff: ScheduleDiff;
  employees: EmployeeOut[];
  className?: string;
}) {
  const t = useT();
  return (
    <ul className={['space-y-0.5', className].join(' ')}>
      {describeDiff(diff, employees, t).map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}

export function ChangeSummary({
  diff,
  employees,
  // What the adjustment asked for and could not do, each line with its
  // reason. Part of the same message: "nothing changed" and the reason
  // nothing changed belong next to each other, not in two cards.
  skipped = [],
}: {
  diff: ScheduleDiff;
  employees: EmployeeOut[];
  skipped?: string[];
}) {
  const t = useT();
  return (
    // Arrives rather than appears: it is the answer to what was just asked
    // (keyed per change by the page, so each answer arrives again).
    <div className="m-rise mt-3 space-y-3">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-gray-800">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {t('schedule.changes.title', { count: diff.total })}
        </p>
        {diff.total === 0 ? (
          <p className="mt-1 text-gray-500">{t('schedule.changes.none')}</p>
        ) : (
          <ChangeList diff={diff} employees={employees} className="mt-1" />
        )}
      </div>
      {skipped.length > 0 && (
        <div className="rounded-xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
            {t('schedule.changes.skipped')}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {skipped.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
