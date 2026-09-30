// Who else is on, the day you are on.
//
// Opened from one of your own shifts, which is also what entitles you to it:
// the server checks for a published shift of yours in the window and answers
// 403 otherwise (see `day_team` in backend services/schedule). This component
// never asks for a day; it is handed one it already knows the person works.
//
// WHY THIS IS NOT `DayGrid` WITH FEWER PROPS. The manager's grid takes the
// roster with contracts on it, the absences and the spec, and draws each
// person's weekly hours, their employee code, and a red mark when they are
// short of contract. Reaching for it and passing less would leave the drawing
// one edit away from showing all of that again. What the team may see is
// decided by what the server sends -- `TeammateShiftOut`, which carries a
// name and two timestamps -- and this file can only draw what it was given.
//
// That is also why the hours axis is built here instead of borrowed from
// `dayTrack`: the manager's version derives the window from the spec -- the
// opening hours, the per-weekday overrides, the closures -- and reaching for
// it would mean sending all of that to the phone of somebody who asked who
// they are on with.

import { useMemo } from 'react';
import { useDayTeam } from '../../api/schedule';
import { fromDateKey } from '../../lib/schedule/focus';
import { APP_LOCALE } from '../../lib/locale';
import { formatHours } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { getErrorMessage } from '../../lib/api';
import { Spinner, StateMessage } from '../StateMessage';
import { SHIFT_BAR } from '../schedule/calendarLook';

/** One person's bar, on the day's own minute axis. */
interface Row {
  employeeId: string;
  name: string;
  isSelf: boolean;
  startMin: number;
  endMin: number;
  hours: number;
}

export function TeamDay({
  date,
  onClose,
}: {
  date: string;
  onClose: () => void;
}) {
  const t = useT();
  const day = fromDateKey(date);
  const from = new Date(day);
  const to = new Date(day);
  to.setDate(to.getDate() + 1);

  const team = useDayTeam(from, to);

  const rows = useMemo<Row[]>(() => {
    const midnight = day.getTime();
    return (team.data ?? []).map((shift) => {
      const start = new Date(shift.start_at);
      const end = new Date(shift.end_at);
      // Minutes from THIS day's midnight, so a shift that ends at 04:00 comes
      // out past 1440 and draws as one bar rather than wrapping.
      const startMin = Math.round((start.getTime() - midnight) / 60000);
      const endMin = Math.round((end.getTime() - midnight) / 60000);
      return {
        employeeId: shift.employee_id,
        name: shift.employee_name,
        isSelf: shift.is_self,
        startMin,
        endMin,
        hours: Math.max(endMin - startMin - shift.unpaid_break_minutes, 0) / 60,
      };
    });
  }, [team.data, day]);

  /**
   * The hours the axis covers, taken from the shifts themselves.
   *
   * `dayTrack` -- the manager's version of this -- derives the window from the
   * SPEC: opening hours, per-weekday overrides, closures. None of that is sent
   * here and none of it should be, so the axis is simply the stretch that is
   * worked, rounded out to whole hours. It runs past 24 for a night that ends
   * in the small hours, which is what keeps a 17:00–04:00 bar in one piece.
   */
  const track = useMemo(() => {
    const first = rows.length ? Math.min(...rows.map((r) => r.startMin)) : 9 * 60;
    const last = rows.length ? Math.max(...rows.map((r) => r.endMin)) : 22 * 60;
    const startMin = Math.floor(first / 60) * 60;
    const endMin = Math.max(Math.ceil(last / 60) * 60, startMin + 60);
    return {
      startMin,
      endMin,
      hours: Array.from(
        { length: (endMin - startMin) / 60 },
        (_, i) => startMin / 60 + i,
      ),
    };
  }, [rows]);

  const span = track.endMin - track.startMin;
  const scheduled = rows.reduce((sum, r) => sum + r.hours, 0);

  return (
    <section className="sc-glass rounded-3xl p-4 animate-[dayIn_200ms_ease-out] motion-reduce:animate-none sm:p-5">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold capitalize text-gray-900">
            {day.toLocaleDateString(APP_LOCALE, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </h2>
          {/* Hours, never money. What the day costs is the business's
              figure, and it says nothing about who you are working with. */}
          <p className="mt-0.5 text-sm text-gray-500">
            {t('employee.team.scheduled', { hours: formatHours(scheduled) })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-sm font-medium text-gray-800 transition-colors hover:border-white/25 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          {t('employee.team.close')}
        </button>
      </header>

      {team.isLoading && <Spinner />}

      {team.isError && (
        <StateMessage
          tone="error"
          title={t('employee.team.error')}
          description={getErrorMessage(team.error)}
        />
      )}

      {!team.isLoading && !team.isError && rows.length === 0 && (
        <p className="py-6 text-center text-sm text-gray-500">
          {t('employee.team.empty')}
        </p>
      )}

      {!team.isLoading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <div className="min-w-[22rem]">
            {/* Hour ruler */}
            <div className="flex border-b border-white/10 pb-1">
              <div className="w-24 shrink-0" />
              <div
                className="grid flex-1"
                style={{
                  gridTemplateColumns: `repeat(${track.hours.length}, minmax(0, 1fr))`,
                }}
              >
                {track.hours.map((h) => (
                  <div
                    key={h}
                    className="border-l border-white/[0.06] text-center text-[10px] tabular-nums text-gray-500"
                  >
                    {h % 24}
                  </div>
                ))}
              </div>
            </div>

            <div className="divide-y divide-white/[0.06]">
              {rows.map((row) => (
                <div
                  key={`${row.employeeId}-${row.startMin}`}
                  className="flex items-center py-1.5"
                >
                  {/* Name and the hours of THIS day. No employee code, no
                      weekly hours, no contract -- none of it was sent. */}
                  <div className="w-24 shrink-0 pr-2">
                    <p
                      className={[
                        'truncate text-sm',
                        row.isSelf
                          ? 'font-semibold text-gray-900'
                          : 'font-medium text-gray-700',
                      ].join(' ')}
                    >
                      {row.isSelf ? t('employee.team.you') : row.name}
                    </p>
                    <p className="text-[11px] tabular-nums text-gray-500">
                      {formatHours(row.hours)}
                    </p>
                  </div>

                  <div className="relative h-8 flex-1">
                    <div
                      className={[
                        'absolute inset-y-1 flex items-center overflow-hidden rounded px-1.5 text-[11px] font-medium',
                        // Yours in the brand, the rest as glass with an
                        // edge; the name column says "You" as well, so the
                        // colour is never the only thing telling.
                        row.isSelf
                          ? 'text-white'
                          : 'bg-white/[0.08] text-gray-800 ring-1 ring-inset ring-white/15',
                      ].join(' ')}
                      style={{
                        // Yours is drawn as the manager's calendar draws a
                        // shift (calendarLook), so it is the same thing seen
                        // from the other side.
                        ...(row.isSelf ? SHIFT_BAR : null),
                        left: `${((row.startMin - track.startMin) / span) * 100}%`,
                        width: `${((row.endMin - row.startMin) / span) * 100}%`,
                      }}
                    >
                      <span className="truncate">
                        {clock(row.startMin)}–{clock(row.endMin)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** "17:00", and "01:00" for a minute past midnight rather than "25:00". */
function clock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
