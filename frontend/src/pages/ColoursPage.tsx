// What every colour on the calendar means, and which of them are the law.
//
// The calendar used to carry a legend of eight swatches above it, and it was
// removed at the manager's request: a rota in one colour reads as one rota,
// and a legend over the thing it describes is furniture. What the legend did
// answer, though, was a real question -- "why is half this bar a darker
// blue?" -- and after the Spanish rules landed the answer stopped being
// decoration and became money: those hours are paid 25% more because they are
// night work under art. 36.1 ET.
//
// So it lives here, on its own page, where it can say the whole thing: the
// colour, what it means, and the article behind it when there is one.
//
// NOTHING ON THIS PAGE IS TYPED TWICE. The night window, the premium and the
// statutory limits are read from the same places the calendar reads them --
// the pay policy and the labour profile of this business -- and so are the
// swatches: every one is drawn with the very style the calendar draws with
// (components/schedule/calendarLook), texture and all. A page about what
// the product does that is maintained by hand would be wrong within a month,
// and wrong in the direction that matters: it would go on claiming a rule
// after the rule changed.

import type { CSSProperties, ReactNode } from 'react';
import { Card } from '../components/Card';
import {
  AWAY_ROW,
  CLOSED_HOURS,
  COVERED_HOUR,
  PREMIUM_HOURS,
  SHIFT_BAR,
  SHORT_HOUR,
  SHORT_HOUR_STYLE,
  YEAR_DAY,
} from '../components/schedule/calendarLook';
import { PageHeader } from './DashboardLayout';
import { useT } from '../lib/i18n';
import { jurisdictionLabel, laborNote } from '../lib/format';
import { useAuth } from '../auth/useAuth';
import { usePayPolicy } from '../api/payPolicy';
import { useLaborProfiles } from '../api/laborProfiles';
import { useBusinessProfile } from '../api/profile';
import { applicableProfiles } from '../lib/schedule/jurisdiction';
import { DEFAULT_NIGHT_WINDOW } from '../lib/schedule/night';

/**
 * The swatch itself: a piece of the calendar, drawn as the calendar draws it.
 * `children` is what sits in it there -- the count in an hour of the coverage
 * strip, the date in a day of the year.
 */
function Sample({
  className = '',
  style,
  round = false,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  round?: boolean;
  children?: ReactNode;
}) {
  return (
    <span
      className={[
        'flex h-6 shrink-0 items-center justify-center overflow-hidden text-[11px] tabular-nums',
        round ? 'w-6 rounded-full' : 'w-10 rounded-md',
        className,
      ].join(' ')}
      style={style}
    >
      {children}
    </span>
  );
}

/** One line of the legend: a swatch, what it is, and why. */
function Swatch({
  sample,
  title,
  body,
  law,
}: {
  sample: ReactNode;
  title: string;
  body: string;
  law?: string | null;
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      {/* A picture of the colour, not information: the title says it. */}
      <span aria-hidden className="mt-0.5 flex w-10 shrink-0 justify-center">
        {sample}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="mt-0.5 text-sm text-gray-600">{body}</p>
        {law && <p className="mt-1 text-xs text-gray-500">{law}</p>}
      </div>
    </li>
  );
}

export function ColoursPage() {
  const t = useT();
  const { user } = useAuth();
  const payPolicy = usePayPolicy();
  const profiles = useLaborProfiles();
  const businessProfile = useBusinessProfile();

  const jurisdiction =
    businessProfile.data?.jurisdiction_code ??
    user?.org_jurisdiction ??
    'ES-CT-HOSTELERIA';
  const chain = applicableProfiles(profiles.data ?? [], jurisdiction);

  /**
   * The most specific rule of a type, or null when nobody states one.
   *
   * The PROFILE comes back with it, because the sentence explaining a rule is
   * looked up by the body of rules it belongs to as well as by its type: the
   * statutory thirty days of leave and the agreement's thirty-one are the same
   * rule type saying two different things.
   */
  const rule = (ruleType: string) => {
    for (const p of chain) {
      const found = p.rules.find((r) => r.rule_type === ruleType);
      if (found) return { profile: p, rule: found };
    }
    return null;
  };
  const figure = (ruleType: string): number | null => {
    const found = rule(ruleType);
    return found?.rule.threshold != null ? Number(found.rule.threshold) : null;
  };

  /** Why a rule says what it says, in the manager's language. */
  const why = (ruleType: string): string | undefined => {
    const found = rule(ruleType);
    return found
      ? laborNote(found.profile.jurisdiction_code, found.rule) ?? undefined
      : undefined;
  };

  const nightStart = figure('night_work_window_start') ?? DEFAULT_NIGHT_WINDOW.startHour;
  const nightEnd = figure('night_work_window_end') ?? DEFAULT_NIGHT_WINDOW.endHour;
  const hhmm = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
  const premium = payPolicy.data
    ? Number(payPolicy.data.night_differential_pct)
    : 0;

  /** The hard rules this business's calendar is built to, with their source. */
  const limits: { key: string; value: number | null; note: string | undefined }[] = [
    {
      key: 'dailyRest',
      value: figure('daily_rest_between_shifts'),
      note: why('daily_rest_between_shifts'),
    },
    {
      key: 'maxDaily',
      value: figure('max_daily_ordinary_hours'),
      note: why('max_daily_ordinary_hours'),
    },
    {
      key: 'weeklyRest',
      value: figure('weekly_rest_hours'),
      note: why('weekly_rest_hours'),
    },
    {
      key: 'nightAverage',
      value: figure('night_work_daily_average_max'),
      note: why('night_work_daily_average_max'),
    },
    {
      key: 'overtimeCap',
      value: figure('annual_overtime_cap'),
      note: why('annual_overtime_cap'),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('colours.title')}
        description={t('colours.description')}
      />

      <Card title={t('colours.calendar.title')} className="mb-6 max-w-3xl">
        <ul className="divide-y divide-white/[0.06]">
          <Swatch
            sample={<Sample style={SHIFT_BAR} />}
            title={t('colours.shift.title')}
            body={t('colours.shift.body')}
          />
          <Swatch
            // Half a bar at night, as the calendar draws a shift that runs
            // into it.
            sample={
              <Sample style={SHIFT_BAR} className="relative">
                <span className="absolute inset-y-0 right-0 w-1/2" style={PREMIUM_HOURS} />
              </Sample>
            }
            title={t('colours.premium.title', { pct: premium })}
            body={
              premium > 0
                ? t('colours.premium.body', {
                    from: hhmm(nightStart),
                    to: hhmm(nightEnd),
                    pct: premium,
                  })
                : t('colours.premium.none', {
                    from: hhmm(nightStart),
                    to: hhmm(nightEnd),
                  })
            }
            law={t('colours.premium.law')}
          />
          <Swatch
            sample={<Sample className={COVERED_HOUR}>2</Sample>}
            title={t('colours.covered.title')}
            body={t('colours.covered.body')}
          />
          <Swatch
            sample={
              <Sample className={SHORT_HOUR} style={SHORT_HOUR_STYLE}>
                1
              </Sample>
            }
            title={t('colours.short.title')}
            body={t('colours.short.body')}
          />
          <Swatch
            // With words on it, as the row says the reason: the tint alone is
            // a shade off the card and would show nothing.
            sample={<Sample className={AWAY_ROW}>Aa</Sample>}
            title={t('colours.away.title')}
            body={t('colours.away.body')}
            law={t('colours.away.law')}
          />
          <Swatch
            sample={<Sample className="ring-1 ring-inset ring-white/[0.06]" style={CLOSED_HOURS} />}
            title={t('colours.closed.title')}
            body={t('colours.closed.body')}
          />
          <Swatch
            sample={
              <Sample round className={YEAR_DAY.published}>
                7
              </Sample>
            }
            title={t('colours.published.title')}
            body={t('colours.published.body')}
          />
          <Swatch
            sample={
              <Sample round className={YEAR_DAY.draft}>
                8
              </Sample>
            }
            title={t('colours.draft.title')}
            body={t('colours.draft.body')}
          />
        </ul>
      </Card>

      <Card title={t('colours.limits.title')} className="mb-6 max-w-3xl">
        <p className="text-sm text-gray-500">
          {t('colours.limits.help', {
            jurisdiction: chain[0] ? jurisdictionLabel(chain[0]) : jurisdiction,
          })}
        </p>
        {chain.length === 0 ? (
          <p className="mt-3 text-sm text-amber-700">{t('colours.limits.none')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.06]">
            {limits
              .filter((l) => l.value !== null)
              .map((l) => (
                <li key={l.key} className="py-3">
                  <p className="text-sm font-medium text-gray-900">
                    {t(`colours.limit.${l.key}`, { value: l.value as number })}
                  </p>
                  {l.note && (
                    <p className="mt-0.5 text-xs text-gray-500">{l.note}</p>
                  )}
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card title={t('colours.elsewhere.title')} className="max-w-3xl">
        {/* The notices themselves: a tint, a rim and light words on it, as
            every amber and red box in the product is drawn. */}
        <ul className="divide-y divide-white/[0.06]">
          <Swatch
            sample={
              <Sample className="border border-amber-200 bg-amber-50 text-amber-900">Aa</Sample>
            }
            title={t('colours.amber.title')}
            body={t('colours.amber.body')}
          />
          <Swatch
            sample={<Sample className="border border-red-200 bg-red-50 text-red-900">Aa</Sample>}
            title={t('colours.red.title')}
            body={t('colours.red.body')}
          />
        </ul>
      </Card>
    </div>
  );
}
