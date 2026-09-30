import { useState } from 'react';
import { usePlatformMetrics } from '../../api/backoffice';
import { getErrorMessage } from '../../lib/api';
import { Card } from '../../components/Card';
import { Spinner, StateMessage } from '../../components/StateMessage';
import { Table, TBody, TD, TH, THead, TR } from '../../components/Table';
import { HeroFigure, StatTile } from '../../components/backoffice/StatTile';
import { Metric } from '../../components/backoffice/Metric';
import { MonthlyBars } from '../../components/backoffice/MonthlyBars';
import {
  formatCount,
  formatUsd,
  longMonth,
  purposeLabel,
  seriesColors,
} from '../../components/backoffice/viz';
import { planLabel, subscriptionStatusLabel } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { BackOfficeHeader } from './BackOfficeLayout';

function share(part: number, whole: number): string {
  if (whole <= 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

export function BackOfficeOverviewPage() {
  const metrics = usePlatformMetrics();
  const [showMonthlyTable, setShowMonthlyTable] = useState(false);
  const t = useT();

  if (metrics.isLoading) {
    return <Spinner label={t('backoffice.overview.loading')} />;
  }
  if (metrics.isError || !metrics.data) {
    return (
      <StateMessage
        tone="error"
        title={t('backoffice.overview.error')}
        description={getErrorMessage(metrics.error)}
      />
    );
  }

  const { customers, people, usage, api_spend, by_plan, monthly } = metrics.data;
  const planTotal = by_plan.reduce((sum, p) => sum + p.customers, 0);
  // Biggest first: the question this card answers is "what is the money going
  // on", and the answer is the top line.
  const purposeEntries = Object.entries(api_spend.by_purpose_30d).sort(
    (a, b) => b[1] - a[1],
  );
  const maxPlan = Math.max(1, ...by_plan.map((p) => p.customers));

  // One sentence, one key. `{status}` is left unfilled so the emphasised word
  // can be wrapped in a span without cutting the sentence into fragments.
  const [payingHintBefore, payingHintAfter = ''] = t(
    'backoffice.overview.paying.hint',
    {
      share: share(customers.paying, customers.total),
      total: formatCount(customers.total),
    },
  ).split('{status}');

  return (
    <div>
      <BackOfficeHeader
        title={t('backoffice.overview.title')}
        description={t('backoffice.overview.description')}
      />

      {/* The headline, then the rest of the pipeline around it. One hero per
          view: paying customers is the number this whole screen exists for. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <HeroFigure
          label={t('backoffice.overview.paying.label')}
          value={customers.paying}
          hint={
            <>
              {payingHintBefore}
              <span className="font-medium text-gray-700">
                {subscriptionStatusLabel('active')}
              </span>
              {payingHintAfter}
            </>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          <StatTile
            label={t('backoffice.overview.trialing.label')}
            value={customers.trialing}
            hint={t('backoffice.overview.trialing.hint')}
          />
          <StatTile
            label={t('backoffice.overview.trialExpired.label')}
            value={customers.trial_expired}
            tone={customers.trial_expired > 0 ? 'warning' : 'default'}
            hint={t('backoffice.overview.trialExpired.hint')}
          />
          <StatTile
            label={t('backoffice.overview.pastDue.label')}
            value={customers.past_due}
            tone={customers.past_due > 0 ? 'warning' : 'default'}
            hint={t('backoffice.overview.pastDue.hint')}
          />
          <StatTile
            label={t('backoffice.overview.canceled.label')}
            value={customers.canceled}
            hint={t('backoffice.overview.canceled.hint')}
          />
        </div>
      </div>

      {/* People. The platform's scale, and how much of it is paid for. */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">
        {t('backoffice.overview.people.title')}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t('backoffice.overview.managers.label')}
          value={people.managers_total}
          hint={t('backoffice.overview.people.hint', {
            count: formatCount(people.managers_paying),
          })}
        />
        <StatTile
          label={t('backoffice.overview.employees.label')}
          value={people.employees_total}
          hint={t('backoffice.overview.people.hint', {
            count: formatCount(people.employees_paying),
          })}
        />
        <StatTile
          label={t('backoffice.overview.active7d.label')}
          value={usage.active_7d}
          hint={t('backoffice.overview.active7d.hint')}
        />
        <StatTile
          label={t('backoffice.overview.dormant.label')}
          value={usage.dormant_paying}
          tone={usage.dormant_paying > 0 ? 'critical' : 'default'}
          hint={t('backoffice.overview.dormant.hint')}
        />
      </div>

      {/* Cost. The platform's only variable expense, and the one number here
          that is money -- what the calls cost us, never what anyone is
          charged. It sits above the plan mix on purpose: the counts below say
          how the business grows, this says what growing costs. */}
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card
          title={t('backoffice.overview.spend.title')}
          className="min-w-0 lg:col-span-1"
        >
          <dl className="grid grid-cols-2 gap-4">
            <Metric
              label={t('backoffice.overview.spend.usd30d')}
              value={api_spend.usd_30d}
              format={formatUsd}
            />
            <Metric
              label={t('backoffice.overview.spend.usdTotal')}
              value={api_spend.usd_total}
              format={formatUsd}
            />
            <Metric
              label={t('backoffice.overview.spend.calls30d')}
              value={api_spend.calls_30d}
            />
            <Metric
              label={t('backoffice.overview.spend.tokens30d')}
              value={api_spend.input_tokens_30d + api_spend.output_tokens_30d}
            />
          </dl>

          {purposeEntries.length > 0 ? (
            <div className="mt-5 border-t border-white/[0.06] pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                {t('backoffice.overview.spend.byPurpose')}
              </p>
              <ul className="space-y-1 text-sm text-gray-700">
                {purposeEntries.map(([purpose, usd]) => (
                  <li key={purpose} className="flex justify-between gap-4">
                    <span>{purposeLabel(purpose)}</span>
                    <span className="tabular-nums font-medium text-gray-900">
                      {formatUsd(usd)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-500">
              {t('backoffice.overview.spend.empty')}
            </p>
          )}

          <p className="mt-5 rounded-xl bg-white/[0.03] p-3 text-xs text-gray-500 ring-1 ring-inset ring-white/[0.06]">
            {t('backoffice.overview.spend.note')}
          </p>
        </Card>

        <div className="min-w-0 lg:col-span-2">
          <MonthlyBars
            title={t('backoffice.overview.spend.months.title')}
            description={t('backoffice.overview.spend.months.description')}
            color={seriesColors.spend}
            data={api_spend.monthly.map((point) => ({
              month: point.month,
              value: point.usd,
            }))}
            format={formatUsd}
          />
        </div>
      </div>

      {/* Plans. One measure, so length carries it and colour is constant. */}
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card
          title={t('backoffice.overview.byPlan.title')}
          className="min-w-0 lg:col-span-1"
        >
          <ul className="space-y-3">
            {by_plan.map((entry) => (
              <li key={entry.plan}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium text-gray-700">
                    {planLabel(entry.plan)}
                  </span>
                  <span className="tabular-nums text-gray-900">
                    {formatCount(entry.customers)}
                    <span className="ml-1 text-xs text-gray-500">
                      {share(entry.customers, planTotal)}
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-2 w-full rounded-sm bg-white/[0.06]">
                  <div
                    className="h-2 rounded-sm"
                    style={{
                      width: `${(entry.customers / maxPlan) * 100}%`,
                      backgroundColor: seriesColors.signups,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-gray-500">
            {t('backoffice.overview.byPlan.note', {
              total: formatCount(planTotal),
            })}
          </p>
        </Card>

        <Card
          title={t('backoffice.overview.months.title')}
          className="min-w-0 lg:col-span-2"
          actions={
            <button
              type="button"
              onClick={() => setShowMonthlyTable((v) => !v)}
              className="rounded text-xs font-medium text-brand-300 underline-offset-4 hover:text-brand-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
            >
              {showMonthlyTable
                ? t('backoffice.overview.months.showCharts')
                : t('backoffice.overview.months.showTable')}
            </button>
          }
        >
          {showMonthlyTable ? (
            <Table>
              <THead>
                <TR>
                  <TH>{t('backoffice.overview.months.column')}</TH>
                  <TH>{t('backoffice.overview.signups.title')}</TH>
                  <TH>{t('backoffice.overview.conversions.title')}</TH>
                  <TH>{t('backoffice.overview.cancellations.title')}</TH>
                </TR>
              </THead>
              <TBody>
                {monthly.map((row) => (
                  <TR key={row.month}>
                    <TD>{longMonth(row.month)}</TD>
                    <TD className="tabular-nums">{row.signups}</TD>
                    <TD className="tabular-nums">{row.conversions}</TD>
                    <TD className="tabular-nums">{row.cancellations}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <MonthlyBars
                title={t('backoffice.overview.signups.title')}
                description={t('backoffice.overview.signups.description')}
                color={seriesColors.signups}
                data={monthly.map((m) => ({ month: m.month, value: m.signups }))}
              />
              <MonthlyBars
                title={t('backoffice.overview.conversions.title')}
                description={t('backoffice.overview.conversions.description')}
                color={seriesColors.conversions}
                data={monthly.map((m) => ({
                  month: m.month,
                  value: m.conversions,
                }))}
              />
              <MonthlyBars
                title={t('backoffice.overview.cancellations.title')}
                description={t('backoffice.overview.cancellations.description')}
                color={seriesColors.cancellations}
                data={monthly.map((m) => ({
                  month: m.month,
                  value: m.cancellations,
                }))}
              />
            </div>
          )}
        </Card>
      </div>

      <p className="mt-6 text-xs text-gray-500">
        {t('backoffice.overview.note')}
      </p>
    </div>
  );
}
