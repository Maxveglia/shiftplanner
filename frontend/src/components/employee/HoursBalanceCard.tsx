// One person's hours against their contract: the month, the quarter, the year.
//
// The bar is the stretch. Its far end is what the contract adds up to over
// that stretch -- 173 hours for a 40-hour month -- and what fills it is the
// rota: solid for the hours already behind them, faint for the ones ahead of
// them that are already scheduled. Where the faint part stops short of the
// end is the part of the month nobody is staffed for yet.
//
// A tick marks the hours the contract asks for BY TODAY, which is what turns
// a length into "ahead" or "behind".
//
// On the dark ground the worked part is the light menta (brand-400) and the
// planned part the mid one (brand-200): the brand itself (600) and the mid
// menta are the same lightness there, and the two parts ran together.
//
// TWO COLOURS, NEITHER OF THEM RED. Under an annual average (art. 34.1 ET) a
// long month is answered by a short one, so somebody ahead in September is
// not a problem to be fixed -- they are somebody who will work a shorter
// February. Red stays for what is actually wrong.
//
// The arithmetic lives in lib/schedule/balanceBar, where a test can reach it.

import { barShape } from '../../lib/schedule/balanceBar';
import { formatHours } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { Card } from '../Card';
import { Spinner, StateMessage } from '../StateMessage';
import type { Balance, EmployeeBalances } from '../../api/workday';

function Row({
  label,
  since,
  balance,
}: {
  label: string;
  since: string;
  balance: Balance;
}) {
  const t = useT();
  const bar = barShape(balance);

  const text =
    bar.lean === 'level'
      ? 'text-gray-500'
      : bar.lean === 'ahead'
        ? 'text-amber-700'
        : 'text-sky-300';

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        {/* The headline is the length of the bar in words: how much of the
            stretch is done. The verdict goes underneath. */}
        <p className="text-sm tabular-nums text-gray-900">
          {t('people.employee.balance.of', {
            worked: formatHours(balance.worked),
            total: formatHours(balance.total),
          })}
        </p>
      </div>

      <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
        {/* On the rota and still to come. Drawn first, so the solid part of
            the bar sits on top of it rather than beside it. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-brand-200 transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${bar.planned * 100}%` }}
        />
        {/* Worked. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-brand-400 transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${bar.worked * 100}%` }}
        />
        {/* Today, as a notch across the whole height: a line the eye can
            compare the solid part against without reading a number. */}
        {bar.today !== null && (
          <div
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white ring-1 ring-ground"
            style={{ left: `${bar.today * 100}%` }}
          />
        )}
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-3 text-[11px]">
        <span className={text}>
          {bar.lean === 'level'
            ? t('people.employee.balance.level')
            : t(
                bar.lean === 'ahead'
                  ? 'people.employee.balance.ahead'
                  : 'people.employee.balance.behind',
                { hours: formatHours(Math.abs(balance.deviation)) },
              )}
        </span>
        <span className="tabular-nums text-gray-500">
          {bar.over
            ? t('people.employee.balance.over', {
                hours: formatHours(balance.planned - balance.total),
              })
            : bar.unplanned > 0
              ? t('people.employee.balance.unplanned', {
                  hours: formatHours(bar.unplanned),
                })
              : t('people.employee.balance.since', { date: since })}
        </span>
      </div>
    </div>
  );
}

export function HoursBalanceCard({
  balances,
  months,
  isLoading,
  isError,
}: {
  balances: EmployeeBalances | null;
  /** Where each stretch starts, for the captions. */
  months: { month: string; quarter: string; year: string } | null;
  isLoading: boolean;
  isError: boolean;
}) {
  const t = useT();

  return (
    <Card title={t('people.employee.balance.title')}>
      {isLoading && <Spinner />}

      {isError && (
        <StateMessage
          tone="error"
          title={t('people.employee.balance.loadError')}
        />
      )}

      {!isLoading && !isError && !balances && (
        <StateMessage
          title={t('people.employee.balance.empty.title')}
          description={t('people.employee.balance.empty.description')}
        />
      )}

      {balances && months && (
        <div className="space-y-4">
          <Row
            label={t('people.employee.balance.month')}
            since={months.month}
            balance={balances.month}
          />
          <Row
            label={t('people.employee.balance.quarter')}
            since={months.quarter}
            balance={balances.quarter}
          />
          <Row
            label={t('people.employee.balance.year')}
            since={months.year}
            balance={balances.year}
          />

          {/* What the three colours mean, once, under all of them. */}
          <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-3 text-[11px] text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-400" />
              {t('people.employee.balance.key.worked')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-200" />
              {t('people.employee.balance.key.planned')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-0.5 bg-white ring-1 ring-ground" />
              {t('people.employee.balance.key.today')}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
