import { useT } from '../../lib/i18n';
import { formatCount, longMonth, shortMonth } from './viz';

export interface MonthlyPoint {
  /** YYYY-MM */
  month: string;
  value: number;
}

interface MonthlyBarsProps {
  title: string;
  /** What the count means. One line, no hedging. */
  description: string;
  color: string;
  data: MonthlyPoint[];
  /**
   * How a value is written. Counts by default; the money series passes
   * `formatUsd`, because "0.37" under a bar is a number without a unit and
   * the unit is the whole point of a cost chart.
   */
  format?: (value: number) => string;
}

/**
 * Twelve months of one count, as a small multiple.
 *
 * Three measures on one grouped chart would be thirty-six bars fighting in the
 * space of twelve, and would make colour the only thing telling signups from
 * churn. Faceting instead gives each measure its own titled chart, so the
 * title carries identity and the colour is free to be merely semantic --
 * neutral for signups, green for conversions, red for cancellations.
 *
 * The bars are flex children rather than SVG rects so the 2px surface gap and
 * the 24px thickness cap hold at any container width without measuring
 * anything.
 *
 * Two labels, no y-axis: the tallest month and the latest one. Between them
 * they carry the scale and the present, which is everything a gridline would
 * have said, without a second layer of ink -- direct labels before gridlines.
 * Every other value is a hover away and all twelve are in the table view.
 */
export function MonthlyBars({
  title,
  description,
  color,
  data,
  format = formatCount,
}: MonthlyBarsProps) {
  const t = useT();
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const lastIndex = data.length - 1;
  // First occurrence, so a repeated maximum labels the earliest one and the
  // "latest month" label stays the only thing speaking for the right edge.
  const peakIndex = data.findIndex((d) => d.value === max);

  const summary = data
    .map((d) => `${longMonth(d.month)}: ${format(d.value)}`)
    .join('; ');
  // `{count}` stays unfilled: the number is emphasised, and splitting the one
  // sentence on it keeps the word order free to differ between languages.
  const [totalBefore, totalAfter = ''] = t(
    'backoffice.monthlyBars.total',
  ).split('{count}');

  return (
    <figure className="sc-glass rounded-2xl p-4">
      <figcaption className="mb-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="shrink-0 text-xs text-gray-500">
            {totalBefore}
            <span className="font-semibold tabular-nums text-gray-900">
              {format(total)}
            </span>
            {totalAfter}
          </p>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">{description}</p>
      </figcaption>

      {/* Top padding reserves room for the peak label, which sits above a bar
          drawn at the full height of the plot. */}
      <div className="relative pt-5">
        <div
          className="flex h-24 items-end gap-[2px]"
          role="img"
          aria-label={t('backoffice.monthlyBars.aria', { title, summary })}
        >
          {data.map((point, index) => {
            const isLast = index === lastIndex;
            const heightPct = (point.value / max) * 100;
            const labelled =
              point.value > 0 && (isLast || index === peakIndex);
            return (
              <div
                key={point.month}
                className="group relative flex h-full flex-1 items-end justify-center"
              >
                {point.value > 0 && (
                  <div
                    className="w-full max-w-[24px] rounded-t-[4px]"
                    style={{ height: `${heightPct}%`, backgroundColor: color }}
                  />
                )}

                {labelled && (
                  <span
                    className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[10px] font-semibold tabular-nums text-gray-700"
                    style={{ bottom: `calc(${heightPct}% + 2px)` }}
                  >
                    {format(point.value)}
                  </span>
                )}

                <div
                  className={[
                    'pointer-events-none absolute bottom-full z-10 mb-1 hidden',
                    'whitespace-nowrap rounded-lg border border-white/10 bg-gray-200 px-2 py-1 shadow-lg',
                    'text-[11px] font-medium text-gray-900 group-hover:block',
                    index === 0
                      ? 'left-0'
                      : isLast
                        ? 'right-0'
                        : 'left-1/2 -translate-x-1/2',
                  ].join(' ')}
                >
                  {longMonth(point.month)}:{' '}
                  <span className="tabular-nums">{format(point.value)}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="h-px w-full bg-white/15" aria-hidden="true" />

        <div className="mt-1 flex gap-[2px]" aria-hidden="true">
          {data.map((point, index) => (
            <span
              key={point.month}
              className="flex-1 text-center text-[10px] text-gray-500"
            >
              {index % 3 === 0 || index === lastIndex ? shortMonth(point.month) : ''}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
