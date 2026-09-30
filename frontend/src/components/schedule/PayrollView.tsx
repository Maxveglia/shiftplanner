// Hours and pay for the period, one row per employee.
//
// Designed to be read at a glance: the bar shows the SHAPE of each person's
// month (how much is overtime) so an expensive pattern is visible without
// reading a single number.

import { useMemo } from 'react';
import type { Assignment, DayRef } from '../../lib/schedule/types';
import type { EmployeeOut } from '../../types';
import {
  computePayroll,
  nightPremiumBelowFloor,
  type PayPolicy,
} from '../../lib/schedule/payroll';
import type { NightWindow } from '../../lib/schedule/night';
import type { YearBasis } from '../../lib/schedule/rate';
import { formatHours, formatMoney, formatRate } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { PAY_OVERTIME, PAY_REGULAR } from './calendarLook';

// The bar's two colours, and the hatch that tells them apart without colour,
// live with the rest of the calendar's look (./calendarLook).

// Amounts in whole euros -- a month's pay, where the cents are noise -- and
// rates to the cent, never as a factor. Both through lib/format, which knows
// the currency: this table wrote a "$" of its own.
const money = (n: number) => formatMoney(n, { whole: true });
const perHour = formatRate;
// The decimal mark belongs to the language, so this is not a local helper:
// a third copy of it is how "7.5h" ended up on Spanish payslips.
const hours = formatHours;

interface PayrollViewProps {
  assignments: Assignment[];
  employees: EmployeeOut[];
  days: DayRef[];
  policy: PayPolicy;
  periodLabel: string;
  /** Ids the scheduler flagged as genuinely short of contracted hours. */
  belowMinimum: string[];
  /** Wage floor for the jurisdiction, or null when none is on record. */
  minimumWage: number | null;
  /**
   * The agreement's night premium, in percent, or null where none is stated.
   * Only for the warning: nobody is priced at it, each person is priced at
   * their own figure or the business's.
   */
  nightPremiumFloor?: number | null;
  /** Weekdays this business pays the weekend differential on. */
  weekendDays?: number[];
  /** What a year of work is here, to turn a salary into an hourly rate. */
  year?: YearBasis;
  /**
   * The hours this jurisdiction calls night -- the same window the generator
   * books the night premium on, so the table and the rota's total agree.
   * Left off, 22:00-06:00.
   */
  nightWindow?: NightWindow | null;
}

export function PayrollView({
  assignments,
  employees,
  days,
  policy,
  periodLabel,
  belowMinimum,
  minimumWage,
  nightPremiumFloor = null,
  weekendDays,
  year,
  nightWindow,
}: PayrollViewProps) {
  const t = useT();
  // The weekend differential has to be paid on the days THIS business calls a
  // weekend. Leaving the argument off fell back to Saturday and Sunday, and
  // the employee's own pay screen did pass it -- so a bar whose weekend is
  // Friday and Saturday showed its manager one figure and the person who
  // worked the shift another, for the same shift.
  const payroll = useMemo(
    () =>
      computePayroll(assignments, employees, days, policy, weekendDays, year, nightWindow),
    [assignments, employees, days, policy, weekendDays, year, nightWindow],
  );

  const maxHours = Math.max(1, ...payroll.rows.map((r) => r.totalHours));

  /** Hourly staff paid below the jurisdiction's wage floor. */
  const underMinimum = (r: (typeof payroll.rows)[number]) =>
    minimumWage != null && !r.isSalaried && r.rate > 0 && r.rate < minimumWage;
  const underpaid = payroll.rows.filter(underMinimum).length;

  /**
   * People whose night premium is under the agreement's with no reason on
   * file. Amber and never blocking, unlike the wage floor above: a lower
   * figure is lawful when the night is priced into the salary (art. 36.2 ET),
   * and only the manager knows whether it is -- the warning asks them to say
   * so on the contract, not to change the number.
   */
  const nightUnder = (r: (typeof payroll.rows)[number]) =>
    nightPremiumBelowFloor(r.employee, policy, nightPremiumFloor);
  const nightUnderCount = payroll.rows.filter(nightUnder).length;

  return (
    <div className="m-glass rounded-2xl border border-white/[0.08]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            {t('calendar.payroll.title')}
          </h3>
          <p className="mt-0.5 text-sm text-gray-500 first-letter:uppercase">{periodLabel}</p>
        </div>
        <div className="flex items-center gap-6 text-right">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500">
              {t('calendar.payroll.hours')}
            </p>
            <p className="text-lg font-semibold tabular-nums text-gray-900">
              {hours(Math.round(payroll.totalHours))}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500">
              {t('calendar.payroll.totalPayroll')}
            </p>
            <p className="text-lg font-semibold tabular-nums text-gray-900">
              {money(payroll.totalPay)}
            </p>
          </div>
        </div>
      </header>

      {underpaid > 0 && (
        <div className="border-b border-red-200/60 bg-red-50 px-5 py-2 text-sm text-red-800">
          {t(
            underpaid === 1
              ? 'calendar.payroll.belowMinimum.one'
              : 'calendar.payroll.belowMinimum.other',
            { count: underpaid, rate: perHour(minimumWage!) },
          )}
        </div>
      )}

      {nightUnderCount > 0 && (
        <div className="border-b border-amber-200/60 bg-amber-50 px-5 py-2 text-sm text-amber-800">
          {t(
            nightUnderCount === 1
              ? 'calendar.payroll.nightBelowFloor.one'
              : 'calendar.payroll.nightBelowFloor.other',
            { count: nightUnderCount, pct: nightPremiumFloor! },
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 border-b border-white/[0.06] px-5 py-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-3.5 rounded-sm"
            style={PAY_REGULAR}
          />
          {t('calendar.payroll.legend.regular')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-3.5 rounded-sm"
            style={PAY_OVERTIME}
          />
          {t('calendar.payroll.legend.overtime')}
        </span>
        <span className="text-gray-500">
          {t('calendar.payroll.legend.note')}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-5 py-2 font-medium">#</th>
              <th className="py-2 font-medium">{t('calendar.payroll.col.employee')}</th>
              <th className="py-2 font-medium">
                {t('calendar.payroll.col.composition')}
              </th>
              <th className="py-2 text-right font-medium">
                {t('calendar.payroll.col.hours')}
              </th>
              <th className="py-2 text-right font-medium">
                {t('calendar.payroll.col.base')}
              </th>
              <th className="py-2 text-right font-medium">
                {t('calendar.payroll.col.overtime')}
              </th>
              <th className="py-2 text-right font-medium">
                {t('calendar.payroll.col.night')}
              </th>
              <th className="py-2 text-right font-medium">
                {t('calendar.payroll.col.weekend')}
              </th>
              <th className="px-5 py-2 text-right font-medium">
                {t('calendar.payroll.col.total')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {payroll.rows.map((r, i) => {
              const width = (r.totalHours / maxHours) * 100;
              const seg = (h: number) =>
                r.totalHours > 0 ? (h / r.totalHours) * 100 : 0;
              // Trust the scheduler's own verdict: it already excluded people
              // who were unavailable, so nobody on leave gets a false alarm.
              const short = belowMinimum.includes(r.employee.id);
              return (
                <tr key={r.employee.id}>
                  <td className="px-5 py-2.5 tabular-nums text-gray-500">
                    {r.employee.display_number || i + 1}
                  </td>
                  <td className="py-2.5">
                    <p className="font-medium text-gray-900">
                      {r.employee.full_name}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {r.employee.external_id}
                      {r.isSalaried && (
                        <span className="ml-1.5 text-gray-500">
                          · {t('calendar.payroll.salaried')}
                        </span>
                      )}
                      {/* Their own figures are why their premium columns do
                          not match the business's percentages. */}
                      {!r.isSalaried &&
                        (r.own.night || r.own.weekend || r.own.overtime) && (
                          <span
                            className="ml-1.5 text-gray-500"
                            title={t('calendar.payroll.ownPremiums.title', {
                              night: r.policy.nightDifferentialPct,
                              weekend: r.policy.weekendPremiumPct,
                              overtime: r.policy.overtimeMultiplier,
                            })}
                          >
                            · {t('calendar.payroll.ownPremiums')}
                          </span>
                        )}
                      {short && (
                        <span
                          className="ml-1.5 text-amber-600"
                          title={t('calendar.payroll.underContract.title', {
                            hours: hours(Math.round(r.expectedHours)),
                          })}
                        >
                          · {t('calendar.payroll.underContract')}
                        </span>
                      )}
                    </p>
                  </td>
                  <td className="w-2/5 py-2.5 pr-6">
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100 ring-1 ring-inset ring-white/[0.04]">
                      <div className="flex h-full" style={{ width: `${width}%` }}>
                        <div
                          style={{
                            ...PAY_REGULAR,
                            width: `${seg(r.regularHours)}%`,
                          }}
                          title={t('calendar.payroll.bar.regular', {
                            hours: hours(Math.round(r.regularHours)),
                          })}
                        />
                        <div
                          style={{
                            ...PAY_OVERTIME,
                            width: `${seg(r.overtimeHours)}%`,
                            // A sliver of the track between the two, so they
                            // never have to be told apart by their edge.
                            boxShadow:
                              r.regularHours > 0 ? 'inset 2px 0 0 #15221e' : undefined,
                          }}
                          title={t('calendar.payroll.bar.overtime', {
                            hours: hours(Math.round(r.overtimeHours)),
                          })}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-gray-900">
                    {hours(Math.round(r.totalHours * 10) / 10)}
                  </td>

                  {/* Base */}
                  <td className="py-2.5 text-right">
                    <span className="tabular-nums text-gray-900">
                      {money(r.basePay)}
                    </span>
                    <p className="text-[10px] tabular-nums text-gray-500">
                      {r.isSalaried
                        ? t('calendar.payroll.base.salary')
                        : `${hours(Math.round(r.regularHours * 10) / 10)} x ${perHour(r.rate)}`}
                    </p>
                    {underMinimum(r) && (
                      <p
                        className="text-[10px] font-medium text-red-600"
                        title={t('calendar.payroll.underMinimum.title', {
                          rate: perHour(minimumWage!),
                        })}
                      >
                        {t('calendar.payroll.underMinimum', {
                          rate: perHour(minimumWage!),
                        })}
                      </p>
                    )}
                  </td>

                  {/* Overtime -- the amount, and the exact $/h behind it */}
                  <td className="py-2.5 text-right">
                    {r.overtimePay > 0 ? (
                      <>
                        <span className="tabular-nums font-medium text-red-600">
                          {money(r.overtimePay)}
                        </span>
                        <p className="text-[10px] tabular-nums text-gray-500">
                          {hours(Math.round(r.overtimeHours * 10) / 10)} x{' '}
                          {perHour(r.overtimeRate)}
                        </p>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* Night differential */}
                  <td className="py-2.5 text-right">
                    {r.nightPay > 0 ? (
                      <>
                        <span className="tabular-nums text-gray-900">
                          {money(r.nightPay)}
                        </span>
                        <p className="text-[10px] tabular-nums text-gray-500">
                          {hours(Math.round(r.nightHours * 10) / 10)} x +
                          {perHour(r.nightRate)}
                        </p>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                    {nightUnder(r) && (
                      <p
                        className="text-[10px] font-medium text-amber-600"
                        title={t('calendar.payroll.nightBelowFloor.title', {
                          pct: nightPremiumFloor!,
                        })}
                      >
                        {t('calendar.payroll.nightBelowFloor', {
                          pct: nightPremiumFloor!,
                        })}
                      </p>
                    )}
                  </td>

                  {/* Weekend premium */}
                  <td className="py-2.5 text-right">
                    {r.weekendPay > 0 ? (
                      <>
                        <span className="tabular-nums text-gray-900">
                          {money(r.weekendPay)}
                        </span>
                        <p className="text-[10px] tabular-nums text-gray-500">
                          {hours(Math.round(r.weekendHours * 10) / 10)} x +
                          {perHour(r.weekendRate)}
                        </p>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* Total */}
                  <td className="px-5 py-2.5 text-right">
                    <span className="text-base font-semibold tabular-nums text-gray-900">
                      {money(r.totalPay)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/[0.08] bg-white/[0.03] font-semibold text-gray-900">
              <td className="px-5 py-3">{''}</td>
              <td className="py-3">{t('calendar.payroll.total')}</td>
              <td className="py-3">{''}</td>
              <td className="py-3 text-right tabular-nums">
                {hours(Math.round(payroll.totalHours))}
              </td>
              <td className="py-3 text-right tabular-nums">
                {money(payroll.rows.reduce((s, r) => s + r.basePay, 0))}
              </td>
              <td className="py-3 text-right tabular-nums text-red-600">
                {money(payroll.rows.reduce((s, r) => s + r.overtimePay, 0))}
              </td>
              <td className="py-3 text-right tabular-nums">
                {money(payroll.rows.reduce((s, r) => s + r.nightPay, 0))}
              </td>
              <td className="py-3 text-right tabular-nums">
                {money(payroll.rows.reduce((s, r) => s + r.weekendPay, 0))}
              </td>
              <td className="px-5 py-3 text-right text-base tabular-nums">
                {money(payroll.totalPay)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
