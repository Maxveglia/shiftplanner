// The working year: ONE ROW PER PERSON, with their weeks folded underneath.
//
// The calendar next door answers "is this week covered". This answers the
// question the calendar structurally cannot, because it only ever holds four
// weeks: is this person, by now, where their contract says they should be.
//
// WHAT IT USED TO BE, AND WHY THAT FAILED. A weekly table under an annual
// title: five rows per person, seven columns, most of them dashes, and the same
// breach reprinted in every week it touched -- twenty rows and thirty-four
// repeated warnings for a bar with four employees. The owner read it and said
// "esto de jornada anual no se entiende", which was the correct review. The
// unit of the question is a PERSON over a period, so that is the unit of the
// table now; the week is detail, and detail belongs behind a click.
//
// THE BALANCE IS AGAINST THE CONTRACT OF THE PERIOD. The old column measured
// each week against the annual average -- 1.783 h a year is 34,3 h a week --
// and told somebody who had just worked 36,5 hours they were "20,9h por
// detrás". True, and unreadable without knowing a figure that is nowhere on
// screen. Now it is hours of the period over what the contract asks for in the
// period, which is also exactly what the planner's balance column and the
// employees list show: three screens, one number, at last. The reasoning lives
// in workdayRows.ts, with the tests.
//
// WHAT THE DESIGN IS STILL FIGHTING. Under an annual average a week above the
// contract is ordinary and expected -- somebody works a busy Saturday now and
// a short week in February. Drawn carelessly, every one of those lights up red
// and the screen reads as a rota in trouble when it is a rota working exactly
// as intended. So a balance is drawn as a POSITION (amber leans over, sky
// leans under, grey is level -- the same three the employees page and
// DraftBalanceColumn chose), hours moved under art. 34.2 are drawn in grey
// because they are ordinary hours worked early, and red is spent only on the
// findings: a real breach of the tenth art. 34.2 allows, of a cap, or of a
// notice period.

import { Fragment, useMemo, useState } from 'react';
import type {
  EmployeeWorkday,
  WeekReport,
  WorkdayFinding,
  WorkdayOut,
} from '../../types';
import { formatDate, formatDecimal, formatHours } from '../../lib/format';
import { useT, type TFunction } from '../../lib/i18n';
import {
  balanceLean,
  excessHours,
  findingKey,
  hasPending,
  measuredTo,
  pendingHours,
  signedHours,
  weekColumns,
  workdayRows,
  type BalanceLean,
  type WeekColumn,
} from './workdayRows';

/**
 * Amber leans over the contract, sky leans under it, grey is level. Light
 * shades for the dark card: amber 12:1, sky 10.4:1, grey 7.1:1. The sign in
 * front of every figure says the same without colour.
 */
const TONE: Record<BalanceLean, string> = {
  over: 'text-amber-700',
  short: 'text-sky-300',
  level: 'text-gray-500',
};

function Dash({ t }: { t: TFunction }) {
  return <span className="text-gray-500">{t('workday.none')}</span>;
}

/** The sentence for one finding, written from numbers the server sent. */
function findingText(t: TFunction, finding: WorkdayFinding): string {
  const key = findingKey(finding);
  // Every figure through `formatDecimal`, the way every other figure on the
  // screen goes: the server sends JSON numbers, and interpolating one raw put
  // "159.8 h" in a Spanish sentence three words away from "150,5h". A decimal
  // mark belongs to the language, not to the number.
  const detail: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(finding.detail)) {
    detail[name] = formatDecimal(value);
  }
  const text = t(key, {
    ...detail,
    // A percentage reads as a percentage, not as 0.1.
    pct: finding.detail.pct != null ? Math.round(finding.detail.pct * 100) : 0,
  });
  // `t` returns the key itself when nothing matches, which would put
  // "workday.error.something" in front of a manager. A rule this build has
  // never heard of still has to say something true.
  return text === key ? t('workday.error.unknown', { rule: finding.rule }) : text;
}

/**
 * The hours above the contract, under the name the law gives them.
 *
 * Which noun wins is decided in `excessHours` (art. 12.5 / art. 35 / art.
 * 34.2, in that order of precedence) because it is law and not layout. This
 * only draws it, and the one thing it decides is the colour: moved hours are
 * grey because they are ORDINARY, and extra hours are amber because they are a
 * cost and not a breach. Red would say somebody broke a rule; if they did, the
 * finding under their row says so in red and names the article.
 *
 * Hours already given back as rest are said beside the figure rather than
 * subtracted from it. They WERE worked, and the employee is owed the record of
 * that; what the rest changes is only whether they count towards the year's 80
 * (art. 35.2), which is a sentence, not a smaller number.
 */
function Excess({
  person,
  t,
}: {
  person: Pick<
    EmployeeWorkday,
    | 'part_time'
    | 'overtime_hours'
    | 'complementary_hours'
    | 'irregular_hours'
    | 'compensated_hours'
  >;
  t: TFunction;
}) {
  const excess = excessHours(person);
  if (!excess) return <Dash t={t} />;
  const moved = excess.kind === 'moved';
  const given =
    !moved && person.compensated_hours > 0
      ? t('workday.extra.compensated', {
          hours: formatHours(person.compensated_hours),
        })
      : undefined;
  return (
    <div title={moved ? t('workday.moved.tooltip') : given}>
      <span
        className={moved ? 'text-gray-500' : 'font-medium text-amber-700'}
      >
        {t(excess.key, { hours: formatHours(excess.hours) })}
      </span>
      {/* Extra hours AND moved hours are different hours, and a balance the
          extra ones do not account for is a balance left unexplained. */}
      {excess.moved !== null && (
        <p className="text-[11px] text-gray-500" title={t('workday.moved.tooltip')}>
          {t('workday.extra.moved', { hours: formatHours(excess.moved) })}
        </p>
      )}
    </div>
  );
}

/** A week's position against the annual pace. Never an alarm: a position. */
function WeekDeviation({ hoursOff, t }: { hoursOff: number; t: TFunction }) {
  const lean = balanceLean(hoursOff);
  if (lean === 'level') {
    return <span className={TONE.level}>{t('workday.deviation.level')}</span>;
  }
  return (
    <span className={TONE[lean]}>
      {t(
        lean === 'over' ? 'workday.deviation.ahead' : 'workday.deviation.behind',
        { hours: formatHours(Math.abs(hoursOff)) },
      )}
    </span>
  );
}

const WEEK_HEADER: Record<WeekColumn, string> = {
  week: 'workday.col.week',
  hours: 'workday.col.weekHours',
  annual: 'workday.col.annual',
  deviation: 'workday.col.deviation',
  recovery: 'workday.col.recovery',
  moved: 'workday.col.moved',
  extra: 'workday.col.overtime',
};

/** Numbers go right, words and positions go left. */
const WEEK_ALIGN: Record<WeekColumn, string> = {
  week: 'text-left',
  hours: 'text-right',
  annual: 'text-right',
  deviation: 'text-left',
  recovery: 'text-right',
  moved: 'text-right',
  extra: 'text-right',
};

function WeekCell({
  column,
  week,
  t,
}: {
  column: WeekColumn;
  week: WeekReport;
  t: TFunction;
}) {
  switch (column) {
    case 'week':
      return <span className="text-gray-500">{formatDate(week.week_start)}</span>;
    case 'hours':
      return <span className="text-gray-900">{formatHours(week.week_hours)}</span>;
    case 'annual':
      return (
        <span className="text-gray-600">
          {formatHours(week.annual_hours_to_date)}
        </span>
      );
    case 'deviation':
      return <WeekDeviation hoursOff={week.deviation_vs_average} t={t} />;
    case 'recovery':
      return week.recovery_hours > 0 ? (
        <span
          className="text-gray-600"
          title={week.recovery_credits
            .map((c) =>
              t('workday.recovery.tooltip', { date: formatDate(c.day_off) }),
            )
            .join(' · ')}
        >
          {formatHours(week.recovery_hours)}
        </span>
      ) : (
        <Dash t={t} />
      );
    case 'moved':
      return week.irregular_hours > 0 ? (
        <span className="text-gray-600" title={t('workday.moved.tooltip')}>
          {formatHours(week.irregular_hours)}
        </span>
      ) : (
        <Dash t={t} />
      );
    case 'extra':
      // `irregular_hours: 0` on purpose: this drawer already has a column of
      // its own for moved hours, and `excessHours` would otherwise name them
      // twice in the same row.
      return <Excess person={{ ...week, irregular_hours: 0 }} t={t} />;
  }
}

/**
 * One person's weeks.
 *
 * Only the columns this person has something in: somebody who never recovered
 * a day off and never had an hour moved does not need two columns of dashes to
 * prove it, and it was three empty columns per person that buried the two
 * figures that were not empty. Which columns survive is `weekColumns`, under
 * test.
 */
function WeekTable({
  weeks,
  regime,
  t,
}: {
  weeks: WeekReport[];
  regime: WorkdayOut['regime'];
  t: TFunction;
}) {
  const columns = weekColumns(weeks, regime);
  return (
    <div className="overflow-x-auto bg-white/[0.03] px-5 py-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {t('workday.weeks.title')}
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-gray-500">
            {columns.map((column) => (
              <th
                key={column}
                className={`py-1 pr-4 font-medium ${WEEK_ALIGN[column]}`}
              >
                {t(WEEK_HEADER[column])}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {weeks.map((week) => (
            <tr key={week.week_start}>
              {columns.map((column) => (
                <td
                  key={column}
                  className={`py-1.5 pr-4 tabular-nums ${WEEK_ALIGN[column]}`}
                >
                  <WeekCell column={column} week={week} t={t} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WorkdayView({
  data,
  loading,
}: {
  data: WorkdayOut | null;
  loading: boolean;
}) {
  const t = useT();
  // One drawer at a time. Not out of tidiness: the weeks are a table of their
  // own, and four of them open at once is the wall of rows this screen was
  // rebuilt to get rid of.
  const [opened, setOpened] = useState<string | null>(null);

  const rows = useMemo(() => workdayRows(data), [data]);
  // The last day the figures actually cover -- which is not the last day of
  // the window when the rota stops inside it.
  const measured = measuredTo(data);

  if (loading) {
    return (
      <div className="m-glass rounded-2xl border border-white/[0.08] p-10 text-center text-sm text-gray-500">
        {t('workday.loading')}
      </div>
    );
  }

  // No data yet reads as the régime that changes nothing: a weekly ceiling is
  // every jurisdiction that has not said otherwise, and it is the reading that
  // hides the annual columns rather than inventing them.
  const regime = data?.regime ?? 'weekly_ceiling';
  const annual = regime === 'annual_average';

  return (
    <div className="m-glass rounded-2xl border border-white/[0.08]">
      <header className="border-b border-white/[0.06] px-5 py-4">
        <h3 className="text-lg font-semibold text-gray-900">
          {t('workday.title')}
        </h3>
        <p className="mt-0.5 text-sm text-gray-500">
          {annual && data?.weekly_average_hours != null
            ? t('workday.subtitle', { hours: data.weekly_average_hours })
            : t('workday.subtitle.weekly')}
        </p>
        {/* The window the figures are OF. Every number in the table is of
            this period and of nothing else, so it is said once, here, rather
            than qualified in four column headers.

            It ends where the MEASUREMENT ends, not where the window does.
            This view reports whole weeks, so a November on the rota was
            announced as "1 Nov to 6 Dec" -- five days of a December nobody
            had planned, charged to everybody's contract. See `measuredTo`. */}
        {data?.period_start && measured && (
          <p className="mt-0.5 text-xs text-gray-500">
            {t('workday.period.range', {
              from: formatDate(data.period_start),
              to: formatDate(measured),
            })}
          </p>
        )}

        {/* WHAT THE LAW ALLOWS, FOLDED AWAY. The régime, the tenth, the 80
            hours and the four months are all still here and still exact --
            they are what makes the table legible the first time. But they are
            CONTEXT: three grey lines of statute above four rows of figures
            competed with the figures for the same glance, and the statute won,
            because it is longer. Closed by default, one click away, and native
            <details> so it works with a keyboard and a screen reader without
            any state of ours. */}
        {(annual || data?.annual_overtime_cap != null) && (
          <details className="mt-2 text-xs text-gray-500">
            <summary className="cursor-pointer select-none text-gray-500 hover:text-gray-700">
              {t('workday.law.summary')}
            </summary>
            {annual && (
              <p className="mt-1">
                {data?.annual_hours != null &&
                  t('workday.annualHours', { hours: data.annual_hours }) + ' · '}
                {data?.irregular_pct != null &&
                  data?.irregular_notice_days != null &&
                  t('workday.irregular', {
                    pct: Math.round(data.irregular_pct * 100),
                    days: data.irregular_notice_days,
                  })}
              </p>
            )}
            {/* The ceiling on the extra hours, and the way out of it. Stated
                together because art. 35 states them together: the 80 hours
                are only a wall for the hours nobody gave back. */}
            {data?.annual_overtime_cap != null && (
              <p className="mt-1">
                {t('workday.overtimeCap', {
                  hours: data.annual_overtime_cap,
                  months: data.overtime_compensation_months ?? 4,
                })}
              </p>
            )}
          </details>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-500">
          {t('workday.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-5 py-2 font-medium">
                  {t('workday.col.employee')}
                </th>
                <th className="py-2 font-medium">{t('workday.col.contract')}</th>
                {/* WHAT THE SECOND FIGURE IS, said where somebody reading it
                    will ask. The hours the contract asks for over this period
                    come from the ANNUAL figure, spread over the days -- so a
                    month with nobody's holiday in it asks for slightly less
                    than the contracted week times the weeks, because the year
                    already has the holidays taken out of it and spreads them
                    evenly. That is why working exactly your contracted week
                    can read as slightly ahead. It is the reading that closes
                    the year on zero, and a manager should not have to
                    reverse-engineer it from a figure ending in ",4". */}
                <th
                  className="py-2 text-right font-medium"
                  title={t('workday.col.hours.title', {
                    annual: data?.annual_hours ?? 0,
                  })}
                >
                  {t('workday.col.hours')}
                </th>
                <th className="py-2 text-right font-medium">
                  {t('workday.col.balance')}
                </th>
                <th className="px-5 py-2 text-right font-medium">
                  {t('workday.col.overtime')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {rows.map(({ person, weeks }) => {
                const open = opened === person.employee_id;
                const drawerId = `workday-weeks-${person.employee_id}`;
                // A row with a finding but no week to show -- possible, since
                // a finding keeps a row -- has nothing to open, and a chevron
                // that opens an empty drawer is a promise the screen breaks.
                const expandable = weeks.length > 0;
                const toggle = () =>
                  setOpened(open ? null : person.employee_id);
                const lean = balanceLean(person.period_deviation);
                return (
                  <Fragment key={person.employee_id}>
                    <tr
                      className={expandable ? 'cursor-pointer transition-colors hover:bg-white/[0.03] motion-reduce:transition-none' : ''}
                      onClick={expandable ? toggle : undefined}
                    >
                      <td className="px-5 py-2.5">
                        {/* A real button, and the row's click is a
                            convenience on top of it: a drawer you can only
                            open by clicking a table row does not exist for
                            anyone using a keyboard or a screen reader. */}
                        {expandable ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              // The row underneath would toggle it straight
                              // back.
                              e.stopPropagation();
                              toggle();
                            }}
                            aria-expanded={open}
                            aria-controls={drawerId}
                            className="flex items-center gap-1.5 text-left font-medium text-gray-900"
                          >
                            {/* `inline-block` is load-bearing: a transform
                                does nothing to an inline element, so an
                                inline chevron simply never turns. Same
                                marker, same classes, as CalendarFolder. */}
                            <span
                              aria-hidden
                              className={`inline-block shrink-0 text-[10px] text-gray-500 transition-transform ${
                                open ? 'rotate-90' : ''
                              }`}
                            >
                              ▶
                            </span>
                            {person.employee_name}
                          </button>
                        ) : (
                          <span className="font-medium text-gray-900">
                            {person.employee_name}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 tabular-nums text-gray-500">
                        {t('workday.contract.weekly', {
                          hours: formatDecimal(person.contracted_weekly),
                        })}
                      </td>
                      {/* Worked over asked-for, as one figure. The pair is
                          the explanation the old "Acumulado del año" column
                          never gave: a number is only readable next to the
                          number it is being judged against. */}
                      <td
                        className="py-2.5 text-right tabular-nums text-gray-900"
                        title={t('workday.hours.tooltip', {
                          worked: formatHours(person.period_hours),
                          expected: formatHours(person.period_expected),
                        })}
                      >
                        {formatDecimal(person.period_hours)}
                        <span className="text-gray-500">
                          {' / '}
                          {formatHours(person.period_expected)}
                        </span>
                      </td>
                      <td
                        className={`py-2.5 text-right font-medium tabular-nums ${TONE[lean]}`}
                        title={t('workday.balance.tooltip')}
                      >
                        {signedHours(person.period_deviation)}
                        {/* What is still to be handed out over the rest of
                            the period. THE SAME SENTENCE the planner's
                            balance column prints, from the same key, because
                            it is the same fact about the same month: two
                            wordings would be two facts to the person reading
                            them. Grey and small -- the balance above is the
                            figure, this is what the figure does not cover. */}
                        {hasPending(person) && (
                          <p
                            className="text-[10px] font-normal tabular-nums text-gray-500"
                            title={
                              measured
                                ? t('workday.pending.tooltip', {
                                    date: formatDate(measured),
                                    hours: formatHours(pendingHours(person)),
                                  })
                                : undefined
                            }
                          >
                            {t('schedule.balances.pending', {
                              hours: formatHours(pendingHours(person)),
                            })}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        <Excess person={person} t={t} />
                      </td>
                    </tr>

                    {/* The findings, ONCE per person and not once per week.
                        The server groups them by rule now -- a real bar came
                        out of 34 repeated rows as three entries -- and the
                        count is shown because the difference between a thing
                        happening one week and five is the difference between
                        watching it and acting on it. Outside the drawer: a
                        breach is not detail, and nobody should have to click
                        to find out there is one. */}
                    {person.findings.length > 0 && (
                      // Inline, not `border-t-0`: the tbody's `divide-y` puts
                      // a border on every child, and beating it needs more
                      // than being listed after it in the stylesheet. Same
                      // fix, same reason, as the drawer in EmployeesPage.
                      <tr style={{ borderTopWidth: 0 }}>
                        <td />
                        <td colSpan={4} className="px-5 pb-2.5">
                          <ul className="space-y-0.5">
                            {person.findings.map((finding) => (
                              <li
                                key={finding.rule}
                                className="text-xs text-red-700"
                              >
                                <span className="tabular-nums text-red-400">
                                  {formatDate(finding.day)}
                                </span>{' '}
                                {findingText(t, finding)}
                                {finding.count > 1 && (
                                  <span
                                    className="ml-1 rounded bg-red-50 px-1 tabular-nums text-red-700 ring-1 ring-inset ring-red-200"
                                    title={t('workday.findings.countTitle', {
                                      count: finding.count,
                                    })}
                                  >
                                    {t('workday.findings.count', {
                                      count: finding.count,
                                    })}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}

                    {open && (
                      <tr id={drawerId} style={{ borderTopWidth: 0 }}>
                        <td colSpan={5} style={{ padding: 0 }}>
                          <WeekTable weeks={weeks} regime={regime} t={t} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Where the count starts. A year measured from the 1st of January would
          be a lie for a business that published its first rota in September:
          it would show everybody a thousand hours short of a contract nobody
          was working under yet. */}
      {data?.cycle_start && rows.length > 0 && (
        <p className="border-t border-white/[0.06] px-5 py-2 text-[11px] text-gray-500">
          {t('workday.since', { date: formatDate(data.cycle_start) })}
        </p>
      )}
    </div>
  );
}
