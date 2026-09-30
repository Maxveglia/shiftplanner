import { formatCount } from './viz';

interface MetricProps {
  label: string;
  value: number;
  /** Counts by default; money passes `formatUsd`. */
  format?: (value: number) => string;
}

/**
 * One figure inside a card, as a `<dt>`/`<dd>` pair -- so a grid of them is a
 * description list and not four loose paragraphs that happen to sit in a row.
 *
 * Smaller and quieter than `StatTile`, which is the overview's headline
 * vocabulary and brings its own border. This one lives where a `Card` has
 * already drawn the box.
 */
export function Metric({ label, value, format = formatCount }: MetricProps) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold text-gray-900">
        {format(value)}
      </dd>
    </div>
  );
}
