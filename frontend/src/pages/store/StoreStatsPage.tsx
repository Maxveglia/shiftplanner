// What the sales add up to over the last 7, 30 or 90 days: three figures,
// the takings day by day, what each weekday brings in, and what sells.
//
// Everything below the period picker answers to it, so the figures always
// agree with each other. Changing the period keeps the old answer on screen,
// dimmed, until the new one arrives -- no blank page, no jump.
//
// The charts follow the data-viz method: one series, so one hue and no
// legend (the title names it); columns capped at 24 px with a 2 px gap; one
// direct label, on the peak; every value reachable by pointer, tap and
// keyboard, and in a table (ChartFrame).
//
// WHO SEES WHAT. What is here today is `store.stats` (lib/access.ts), the
// version the employee and the till's tablet see as well as the manager: it
// asks for nothing but GET /store/stats. A fuller version -- much longer, the
// manager's alone -- is on its way (Max, 28-sep-2026). Whatever of it is
// added goes behind `FULL_STATS`: `useCan()(FULL_STATS)` around it on this
// page, and its own route on the server behind the same permission, so that
// an employee's screen neither shows it nor asks for it.

import { Link } from 'react-router-dom';
import { PageHeader } from '../DashboardLayout';
import { useStoreStats, type StoreStats } from '../../api/store';
import { formatQuantity } from '../../api/inventory';
import { StatTile } from '../../components/backoffice/StatTile';
import { Card } from '../../components/Card';
import { Spinner, StateMessage } from '../../components/StateMessage';
import { ChartFrame } from '../../components/store/ChartFrame';
import { ColumnChart, type Column } from '../../components/store/ColumnChart';
import { PeriodPicker, usePeriod } from '../../components/store/PeriodPicker';
import { SALES_COLOR } from '../../components/store/viz';
import { getErrorMessage } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { dayTickIndices, peakIndex, shareOfMax, weekdayFigures } from '../../lib/store/chart';
import {
  formatDayMedium,
  formatDayTick,
  formatMoneyShort,
  weekdayLong,
  weekdayShort,
} from '../../lib/store/format';
import { periodRange, weekdayOf } from '../../lib/store/period';
import type { Perm } from '../../lib/access';

/**
 * The permission the full statistics will be shown with (the manager's; see
 * WHO SEES WHAT above). Nothing uses it yet: the version on this page is the
 * one everybody has.
 */
export const FULL_STATS: Perm = 'store.stats.full';

const TABLE_HEAD = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500';
const TABLE_CELL = 'px-3 py-2 text-gray-700';

export function StoreStatsPage() {
  const t = useT();
  const [days, setDays] = usePeriod();
  const { from, to } = periodRange(days);
  const stats = useStoreStats(from, to);
  const data = stats.data;

  return (
    <div>
      <PageHeader title={t('store.stats.title')} description={t('store.stats.description')} />

      {/* The one filter, above everything it scopes. */}
      <div className="mb-5">
        <PeriodPicker value={days} onChange={setDays} />
      </div>

      {stats.isLoading ? (
        <Spinner />
      ) : stats.isError && !data ? (
        <StateMessage tone="error" title={t('store.stats.loadError')} description={getErrorMessage(stats.error)} />
      ) : !data ? null : data.sales_count === 0 ? (
        <Card>
          <StateMessage title={t('store.stats.empty.title')} description={t('store.stats.empty.description')} />
          <div className="mt-4 flex justify-center">
            {/* A link dressed as the secondary button: it goes somewhere. */}
            <Link
              to="/store"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:border-white/25 hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 motion-reduce:transition-none"
            >
              {t('store.stats.empty.action')}
            </Link>
          </div>
        </Card>
      ) : (
        <Figures stats={data} stale={stats.isPlaceholderData} />
      )}
    </div>
  );
}

function Figures({ stats, stale }: { stats: StoreStats; stale: boolean }) {
  const t = useT();
  const daysInPeriod = stats.days.length;

  // --- Day by day ---------------------------------------------------------------
  const ticks = new Set(dayTickIndices(stats.days.map((d) => d.date)));
  const week = daysInPeriod <= 10;
  const dayColumns: Column[] = stats.days.map((d, i) => ({
    key: d.date,
    value: d.total,
    // A week names its days ("lun"): seven weekdays cannot repeat, and the
    // date is in the tooltip. "lun 21" did not fit a column on a phone.
    tick: ticks.has(i) ? (week ? weekdayShort(weekdayOf(d.date)) : formatDayTick(d.date)) : null,
    label: formatDayMedium(d.date),
  }));
  const bestDay = peakIndex(stats.days.map((d) => d.total));

  // --- By weekday -----------------------------------------------------------------
  const weekdays = weekdayFigures(stats);
  const weekdayColumns: Column[] = weekdays.map((w) => ({
    key: String(w.weekday),
    value: w.average,
    tick: weekdayShort(w.weekday),
    label: weekdayLong(w.weekday),
  }));
  const bestWeekday = peakIndex(weekdays.map((w) => w.average));

  // --- What sells -------------------------------------------------------------------
  const shares = shareOfMax(stats.top_dishes.map((d) => d.total));

  return (
    <div
      className={['space-y-4 transition-opacity duration-200 motion-reduce:transition-none', stale ? 'opacity-60' : ''].join(' ')}
      aria-busy={stale || undefined}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label={t('store.stats.total')} value={stats.total} format={(v) => formatMoney(v)} />
        <StatTile label={t('store.stats.sales')} value={stats.sales_count} />
        <StatTile
          label={t('store.stats.average')}
          value={stats.average_per_day}
          format={(v) => formatMoney(v)}
          hint={t('store.stats.averageHint', { days: stats.days_with_sales, total: daysInPeriod })}
        />
      </div>

      <ChartFrame
        title={t('store.stats.daily.title')}
        description={t('store.stats.daily.description')}
        aside={
          bestDay >= 0 ? (
            <>
              {t('store.stats.best')}{' '}
              <span className="font-semibold text-gray-900">{formatDayMedium(stats.days[bestDay].date)}</span>
              {/* Its figure too: on a phone the quarter scrolls, and the
                  labelled peak may be out of sight -- this states the scale. */}
              {' · '}
              <span className="tabular-nums">{formatMoneyShort(stats.days[bestDay].total)}</span>
            </>
          ) : null
        }
        chart={
          <ColumnChart
            columns={dayColumns}
            color={SALES_COLOR}
            format={(v) => formatMoney(v)}
            formatShort={formatMoneyShort}
            ariaLabel={t('store.stats.daily.aria')}
          />
        }
        table={
          <div className="max-h-80 overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr>
                  <th scope="col" className={TABLE_HEAD}>
                    {t('store.stats.col.day')}
                  </th>
                  <th scope="col" className={`${TABLE_HEAD} text-right`}>
                    {t('store.stats.col.takings')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {/* Newest first, as the sales list reads. */}
                {[...stats.days].reverse().map((d) => (
                  <tr key={d.date}>
                    <td className={TABLE_CELL}>{formatDayMedium(d.date)}</td>
                    <td className={`${TABLE_CELL} text-right tabular-nums ${d.total === 0 ? 'text-gray-500' : 'text-gray-900'}`}>
                      {formatMoney(d.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ChartFrame
          title={t('store.stats.weekday.title')}
          description={t('store.stats.weekday.description')}
          aside={
            bestWeekday >= 0 ? (
              <>
                {t('store.stats.best')}{' '}
                <span className="font-semibold text-gray-900">{weekdayLong(bestWeekday)}</span>
                {' · '}
                <span className="tabular-nums">{formatMoneyShort(weekdays[bestWeekday].average)}</span>
              </>
            ) : null
          }
          chart={
            <ColumnChart
              columns={weekdayColumns}
              color={SALES_COLOR}
              format={(v) => formatMoney(v)}
              formatShort={formatMoneyShort}
              ariaLabel={t('store.stats.weekday.aria')}
            />
          }
          table={
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col" className={TABLE_HEAD}>
                      {t('store.stats.col.weekday')}
                    </th>
                    <th scope="col" className={`${TABLE_HEAD} text-right`}>
                      {t('store.stats.col.days')}
                    </th>
                    <th scope="col" className={`${TABLE_HEAD} text-right`}>
                      {t('store.stats.col.average')}
                    </th>
                    <th scope="col" className={`${TABLE_HEAD} text-right`}>
                      {t('store.stats.col.total')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {weekdays.map((w) => (
                    <tr key={w.weekday}>
                      <td className={TABLE_CELL}>{weekdayLong(w.weekday)}</td>
                      <td className={`${TABLE_CELL} text-right tabular-nums`}>{w.days}</td>
                      <td className={`${TABLE_CELL} text-right font-medium tabular-nums text-gray-900`}>{formatMoney(w.average)}</td>
                      <td className={`${TABLE_CELL} text-right tabular-nums`}>{formatMoney(w.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
          />

        <section aria-labelledby="store-top-dishes" className="sc-glass min-w-0 rounded-2xl p-4 sm:p-5">
          <h2 id="store-top-dishes" className="text-sm font-semibold text-gray-900">
            {t('store.stats.top.title')}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">{t('store.stats.top.description')}</p>
          {stats.top_dishes.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">{t('store.stats.top.empty')}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col" className={`${TABLE_HEAD} pl-0`}>
                      {t('store.stats.col.dish')}
                    </th>
                    <th scope="col" className={`${TABLE_HEAD} text-right`}>
                      {t('store.stats.col.units')}
                    </th>
                    <th scope="col" className={`${TABLE_HEAD} pr-0 text-right`}>
                      {t('store.stats.col.takings')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {stats.top_dishes.map((dish, i) => (
                    <tr key={`${dish.dish_id ?? ''}:${dish.name}`}>
                      <td className="py-2 pr-3 text-gray-900">
                        <span className="break-words">{dish.name}</span>
                        {/* Its takings against the best seller's: the list
                            reads as a bar chart without being one. */}
                        <span aria-hidden="true" className="mt-1 block h-1 w-full max-w-[12rem] rounded-full bg-white/[0.06]">
                          <span
                            className="block h-1 rounded-full"
                            style={{ width: `${Math.max(2, shares[i] * 100)}%`, backgroundColor: SALES_COLOR }}
                          />
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatQuantity(dish.quantity)}</td>
                      <td className="py-2 pl-3 text-right font-medium tabular-nums text-gray-900">{formatMoney(dish.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
