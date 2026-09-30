// "If I publish this, does anybody end up short?" -- beside the calendar.
//
// The one question a manager cannot answer by looking at a rota: a calendar
// shows who is working on Tuesday, not whether Ana finishes the quarter forty
// hours under her contract. The figures for that live half on the server (the
// published balance) and half on this screen (the draft), and nothing brought
// them together until this column.
//
// WHY IT IS ONE NUMBER PER PERSON AND NOT THREE. The month, the quarter and
// the year are all real, and printing all three would put fifteen figures
// beside a calendar that already carries hundreds. So the stretch is chosen
// once, at the top, and every row answers for that one -- the quarter by
// default, which is the horizon a bar owner actually plans against: long
// enough that a heavy month is allowed to be answered by a light one, short
// enough that there is still time to answer it.
//
// WHY IT IS NOT RED AND GREEN. The repository has made this decision twice
// before (see `HoursBalance` on the employees page and `HoursBalanceCard`) and
// it makes it the same way here: under an annual average, hours over and hours
// short are two DIRECTIONS, not a pass and a fail, and a manager who reads one
// colour as an alarm will "fix" a rota that was working exactly as intended.
// Amber leans over the contract, sky leans under it, grey is even. The two
// carry different weight -- over costs overtime, short is hours still owed --
// but neither is an error, and the column refuses to call one.
//
// WHAT EACH ROW SAYS. "X of Y hours" first: X is everything on the rota over
// the stretch if this draft goes out, Y what the contract asks for over the
// whole stretch. Those are the figures that differ between the tabs -- 182 of
// 177 h in October, 182 of 526 h in the quarter -- and the bar under them is
// the same fraction drawn, dark for what is on the noticeboard already (the
// draft's untouched shifts included -- after publishing, all of them) and
// brand colour for what the draft adds. Where the bar stops short is rota
// nobody has written yet.
//
// The deviation goes underneath and says which months it covers ("+5.4 h in
// October"). It judges only the part of the stretch somebody has planned, so
// with one month drafted it is the SAME figure under Month, Quarter and Year --
// which, as the headline, made the three tabs look like one. It came back as
// "the hour counter does not work" twice before it moved down here.
//
// The arithmetic is not here. It is in lib/schedule/projectedBalance, under
// test, because the subtraction at the heart of it (publishing REPLACES what
// is in the window rather than adding to it) is the kind of mistake that
// produces a plausible wrong number rather than a visible broken screen.

import { useState } from 'react';
import { formatDate, formatDecimal, formatHours } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { monthName } from '../../lib/schedule/calendar';
import {
  draftHoursIn,
  measuredMonths,
  projectRows,
  stretchBar,
  DEAD_BAND_HOURS,
  type DraftShift,
  type BalanceSpan,
  type ProjectedRow,
} from '../../lib/schedule/projectedBalance';
import { shortNames } from '../../lib/shortNames';
import type { BalancesOut } from '../../api/workday';

const SPANS: BalanceSpan[] = ['month', 'quarter', 'year'];

/**
 * "+6h", "−12h", "0h". A real minus sign (U+2212), not a hyphen: at this size
 * a hyphen in front of a digit reads as a dash between two of them.
 */
function signed(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  if (rounded === 0) return formatHours(0);
  return `${rounded > 0 ? '+' : '−'}${formatHours(Math.abs(rounded))}`;
}

const TONE: Record<ProjectedRow['lean'], string> = {
  // Light shades for the dark card: amber 12:1, sky 10.4:1. The sign in
  // front of the figure says the same without colour.
  over: 'text-amber-700',
  short: 'text-sky-300',
  // 500, not 400: this is text, and the 400 is the border grey (3:1).
  level: 'text-gray-500',
};

// The bar's two parts, on the dark track, in the year's own language: what
// is published is the solid menta a published day is filled with (brand-600,
// 3.2:1 on the track), and what this draft adds is the lighter menta a draft
// day is ringed with (brand-300, 9.7:1 on the track, 3:1 against the
// published part). The same colour never means both things on one screen. A
// legend under the column, and the hours in words for a screen reader.
const KEPT_BAR = 'bg-brand-600';
const DRAFT_BAR = 'bg-brand-300';

export function DraftBalanceColumn({
  balances,
  draft,
  settled,
  loading,
}: {
  /** The published balances for the window on screen, or null until they land. */
  balances: BalancesOut | null;
  /**
   * The draft's shifts. Counted per stretch -- see `draftHoursIn` -- because a
   * draft of three months is not three months of anybody's MONTH.
   */
  draft: readonly DraftShift[] | null;
  /**
   * The draft's shifts that are published exactly as drafted. Drawn as
   * published, not as draft: straight after publishing, that is all of them.
   */
  settled: readonly DraftShift[] | null;
  loading: boolean;
}) {
  const t = useT();
  const [span, setSpan] = useState<BalanceSpan>('quarter');
  const rows = projectRows(
    balances,
    draftHoursIn(draft, balances, span),
    span,
    draftHoursIn(draft, balances, span, 'stretch'),
    draftHoursIn(settled, balances, span, 'stretch'),
  );
  const names = shortNames(rows.map((r) => r.name));

  /** "+5,4h en octubre", or "+3,4h del 20 oct al 31 oct" when not whole months. */
  const deviationLine = (row: ProjectedRow): string | null => {
    if (!row.through) return null;
    const hours = signed(row.projected);
    const months = measuredMonths(row.start, row.through);
    if (!months) {
      return t('schedule.balances.deviation.range', {
        hours,
        from: formatDate(row.start),
        to: formatDate(row.through),
      });
    }
    return months.from === months.to
      ? t('schedule.balances.deviation.month', { hours, month: monthName(months.from) })
      : t('schedule.balances.deviation.months', {
          hours,
          from: monthName(months.from),
          to: monthName(months.to),
        });
  };

  return (
    // 1440px, not `lg`, and not a round number chosen for looking tidy: it is
    // the narrowest window where the calendar and this column both fit whole
    // (see the comment on the page container in DashboardLayout). Below it the
    // column keeps its place in the flow and lands under the calendar --
    // readable, out of the way, and not squeezing the rota to get there.
    <aside
      className="m-glass w-full shrink-0 rounded-2xl border border-white/[0.08] p-3 min-[1440px]:sticky min-[1440px]:top-6 min-[1440px]:w-60"
      aria-label={t('schedule.balances.title')}
    >
      <p
        className="text-[11px] font-medium uppercase tracking-wide text-gray-500"
        title={t('schedule.balances.help')}
      >
        {t('schedule.balances.title')}
      </p>

      {/* Three words, one of them chosen. A segmented control rather than a
          <select> because the options are this short and the choice is made
          often enough to deserve a single click. */}
      <div
        className="mt-2 flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5"
        role="group"
        aria-label={t('schedule.balances.spanLabel')}
      >
        {SPANS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpan(s)}
            aria-pressed={span === s}
            className={[
              'flex-1 rounded-md px-1 py-1 text-[11px] transition-colors motion-reduce:transition-none',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
              // The chosen one also in weight and a rule under it, not in
              // colour alone.
              span === s
                ? 'bg-brand-100 font-semibold text-brand-800 shadow-[inset_0_-2px_0_rgb(68_214_180)]'
                : 'font-medium text-gray-500 hover:bg-white/[0.05] hover:text-gray-800',
            ].join(' ')}
          >
            {t(`schedule.balances.span.${s}`)}
          </button>
        ))}
      </div>

      {loading && !balances && (
        <p className="mt-3 text-[11px] text-gray-500">
          {t('schedule.balances.loading')}
        </p>
      )}

      {/* `balances &&`: an empty roster is a thing to say, a failed request is
          not -- one is news and the other is a guess dressed as news. If the
          read fails the column just stands there with nothing in it. */}
      {!loading && balances && rows.length === 0 && (
        <p className="mt-3 text-[11px] text-gray-500">
          {t('schedule.balances.empty')}
        </p>
      )}

      <div className="mt-1 divide-y divide-white/[0.05]">
        {rows.map((row, i) => {
          // Nothing to compare against: this stretch asks for no hours at
          // all, because it ended before the cycle opened or the contract
          // states none. The projection is then the draft's own hours with no
          // line to measure them from, and printing "+159 h" would say
          // somebody is 159 hours over a contract this stretch does not
          // contain. A dash says what is actually known.
          if (!row.measurable) {
            return (
              <div
                key={row.employeeId}
                className="flex items-baseline justify-between gap-2 py-1.5"
                title={t('schedule.balances.row.unmeasurable', { name: row.name })}
              >
                <span className="min-w-0 truncate text-[13px] text-gray-700">
                  {names[i]}
                </span>
                <span className="shrink-0 text-sm text-gray-400">—</span>
              </div>
            );
          }
          const bar = stretchBar(row);
          const deviation = deviationLine(row);
          // Everything the row says, in words: the hover text, and what a
          // screen reader gets for the bar, which is otherwise only colour.
          const split = t('schedule.balances.row.split', {
            kept: formatHours(row.kept),
            drafted: formatHours(row.drafted),
          });
          const pending =
            row.pending >= DEAD_BAND_HOURS
              ? t('schedule.balances.row.pending', { hours: formatHours(row.pending) })
              : null;
          const title = [
            t('schedule.balances.row.title', {
              name: row.name,
              hours: formatHours(row.hours),
              owed: formatHours(row.owed),
            }),
            pending,
            split,
            deviation ? t('schedule.balances.row.deviation', { deviation }) : null,
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={row.employeeId} className="py-2" title={title}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] text-gray-700">
                  {names[i]}
                </span>
                <span className="shrink-0 text-[13px] tabular-nums text-gray-900">
                  {t('schedule.balances.of', {
                    hours: formatDecimal(Math.round(row.hours * 10) / 10),
                    owed: formatHours(row.owed),
                  })}
                </span>
              </div>

              {/* The stretch, from nothing to what the contract asks for over
                  all of it. Solid menta is already published; light menta is
                  what this draft adds; the empty end is rota nobody has written. */}
              <div
                className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100 ring-1 ring-inset ring-white/[0.04]"
                aria-hidden="true"
              >
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${DRAFT_BAR} transition-[width] duration-300 ease-out motion-reduce:transition-none`}
                  style={{ width: `${bar.filled * 100}%` }}
                />
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${KEPT_BAR} transition-[width] duration-300 ease-out motion-reduce:transition-none`}
                  style={{ width: `${bar.kept * 100}%` }}
                />
              </div>
              <span className="sr-only">
                {[split, pending].filter(Boolean).join(' ')}
              </span>

              {/* The planned part against its contract, and which months that
                  is. Coloured by direction, never red or green -- see the
                  header. Nothing planned yet means nothing to say here. */}
              {deviation && (
                <p className={`mt-0.5 text-[11px] tabular-nums ${TONE[row.lean]}`}>
                  {deviation}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Where the count starts. A year's balance measured from the 1st of
          January would be a lie for a business that published its first rota
          in September: it would show everybody a thousand hours short of a
          contract nobody was working under yet. */}
      {rows.some((r) => r.measurable) && (
        <div
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[0.06] pt-2 text-[10px] text-gray-500"
          aria-hidden="true"
        >
          <span className="flex items-center gap-1">
            <span className={`inline-block h-1.5 w-3 rounded-full ${KEPT_BAR}`} />
            {t('schedule.balances.legend.kept')}
          </span>
          <span className="flex items-center gap-1">
            <span className={`inline-block h-1.5 w-3 rounded-full ${DRAFT_BAR}`} />
            {t('schedule.balances.legend.drafted')}
          </span>
        </div>
      )}
      {balances?.cycle_start && rows.length > 0 && (
        <p className="mt-1 text-[10px] text-gray-500">
          {t('schedule.balances.since', {
            date: formatDate(balances.cycle_start),
          })}
        </p>
      )}
    </aside>
  );
}
