import type { ReactNode } from 'react';
import { useLanguage } from '../../lib/i18n';
import { formatCount } from './viz';

interface StatTileProps {
  label: string;
  value: number;
  /** One line of context under the value. Say what the number excludes. */
  hint?: ReactNode;
  /** Draws attention without shouting: used for the numbers that need action. */
  tone?: 'default' | 'warning' | 'critical';
  /**
   * How the value is written. Counts by default; the shop's statistics pass
   * money, as `Metric` and `MonthlyBars` already can.
   */
  format?: (value: number) => string;
}

const toneValueClasses: Record<
  NonNullable<StatTileProps['tone']>,
  string
> = {
  default: 'text-gray-900',
  warning: 'text-amber-700',
  critical: 'text-red-700',
};

/**
 * One headline count. No sparkline, no delta chip -- the monthly charts below
 * carry the trend, and repeating it twelve times in miniature would say less.
 *
 * The value uses the font's proportional figures on purpose: `tabular-nums`
 * gives every digit the width of a zero, which makes a number like 121 look
 * gappy at display sizes. Tabular figures belong in the customer table, where
 * digits have to line up down a column.
 */
export function StatTile({ label, value, hint, tone = 'default', format = formatCount }: StatTileProps) {
  // No copy of its own, but it prints a formatted number: subscribing to the
  // language is what makes it repaint when the operator switches.
  useLanguage();

  return (
    <div className="sc-glass rounded-2xl p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p
        className={[
          'mt-1 text-3xl font-semibold leading-none',
          toneValueClasses[tone],
        ].join(' ')}
      >
        {format(value)}
      </p>
      {hint && <p className="mt-2 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

interface HeroFigureProps {
  label: string;
  value: number;
  hint?: ReactNode;
}

/**
 * The one number the back office exists to answer: how many customers pay.
 * Exactly one per view -- a second hero is two headlines, which is none.
 */
export function HeroFigure({ label, value, hint }: HeroFigureProps) {
  useLanguage();

  return (
    // The screen's one headline, lit like the employee's next shift.
    <div className="sc-hero rounded-3xl p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-2 text-6xl font-semibold leading-none tracking-tight text-gray-900">
        {formatCount(value)}
      </p>
      {hint && <p className="mt-3 text-sm text-gray-500">{hint}</p>}
    </div>
  );
}
