// A chart's box: its title, one line saying what it plots, the figure that
// sums it up on the right -- and a way to read it as a table instead.
//
// The table is not an extra. Every value the chart shows only on hover (all
// but the tallest column) has to be reachable without a pointer, and a list
// of ninety days is a table's job, not a tooltip's. One button swaps the
// chart for its table in the same box.

import { useId, useState, type ReactNode } from 'react';
import { useT } from '../../lib/i18n';

interface ChartFrameProps {
  title: string;
  description: string;
  /** The chart's one headline figure, beside the title: its total, its best. */
  aside?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
}

export function ChartFrame({ title, description, aside, chart, table }: ChartFrameProps) {
  const t = useT();
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  const bodyId = useId();

  return (
    <figure aria-labelledby={titleId} className="sc-glass min-w-0 rounded-2xl p-4 sm:p-5">
      <figcaption className="mb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id={titleId} className="text-sm font-semibold text-gray-900">
            {title}
          </h2>
          {aside && <div className="text-xs text-gray-500">{aside}</div>}
        </div>
        <p className="mt-0.5 text-xs text-gray-500">{description}</p>
      </figcaption>
      <div id={bodyId}>{asTable ? table : chart}</div>
      {/* Under the figure, where a reader who wants the numbers arrives
          having looked at it -- and where it never wraps against the title. */}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          aria-controls={bodyId}
          onClick={() => setAsTable((v) => !v)}
          className="-mr-2 inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-medium text-brand-700 transition-colors hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300 motion-reduce:transition-none"
        >
          {asTable ? t('store.chart.showChart') : t('store.chart.showTable')}
        </button>
      </div>
    </figure>
  );
}
