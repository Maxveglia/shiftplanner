// Chart parameters for the back office, kept in one file so a colour is never
// picked at the call site.
//
// These four hues are NOT the app's indigo brand. Brand indigo dresses the
// chrome -- buttons, nav, focus rings -- and a data mark that shares it would
// read as "interactive" rather than "this many". The set below was checked with
// the palette validator against the light chart surface: lightness band, chroma
// floor, normal-vision separation (worst pair dE 28.9) and contrast vs surface
// all pass. On the dark app's surface (#111d1a) they sit inside the dark band
// too and every one clears 3:1 (3.25-4.37:1), so the same four serve both; worst CVD pair is conversions-vs-cancellations at dE 7.2, inside
// the 6-8 band that is legal only with a second identity channel. It has one:
// every series lives in its own titled chart, so colour never has to carry
// identity on its own, and each chart direct-labels its latest value.
import { APP_LOCALE } from '../../lib/locale';
import { plural, translate } from '../../lib/i18n/core';

export const seriesColors = {
  /** New organizations. Neutral: a signup is neither good nor bad yet. */
  signups: '#2a78d6',
  /** Trials that became paying customers. */
  conversions: '#008300',
  /** Customers who left. */
  cancellations: '#e34948',
  /** Dollars spent on the model. Neither good nor bad, and not a fourth
      customer count: the violet keeps it from being read alongside the three
      series above, which count companies. */
  spend: '#7b4fd8',
} as const;

/**
 * Counts, formatted the way a person reads them: exact while they are small
 * enough to matter individually, compact once they stop being countable.
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 10_000) return value.toLocaleString(APP_LOCALE);
  return new Intl.NumberFormat(APP_LOCALE, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Dollars, with cents while they are the whole story. A customer's model
 * spend is often under a dollar, and "$0" would read as "nothing" when the
 * point of the number is that it is not.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(APP_LOCALE, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(value) < 1 ? 3 : 2,
  }).format(value);
}

/**
 * "2026-08" -> "Aug" / "ago".
 *
 * The month is read off the key and formatted through the active locale rather
 * than looked up in a hand-written table of English abbreviations -- the table
 * was the reason a Spanish back office charted "Aug 2026".
 *
 * Parsed by hand: `new Date('2026-08')` is UTC-midnight and can render as the
 * previous month west of Greenwich, so the parts are passed to the local
 * constructor instead.
 */
export function shortMonth(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString(APP_LOCALE, {
    month: 'short',
  });
}

/** "2026-08" -> "Aug 2026" / "ago 2026". */
export function longMonth(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString(APP_LOCALE, {
    month: 'short',
    year: 'numeric',
  });
}

/** Days between a past ISO timestamp and now; null when there is no timestamp. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

/** "3 days ago" / "Today" / "Never" -- the pulse of an account at a glance. */
export function relativeDays(iso: string | null | undefined): string {
  const days = daysSince(iso);
  if (days === null) return translate('backoffice.viz.never');
  if (days <= 0) return translate('backoffice.viz.today');
  if (days === 1) return translate('backoffice.viz.yesterday');
  if (days < 30) return translate('backoffice.viz.daysAgo', { count: days });
  const months = Math.floor(days / 30);
  return plural(
    months,
    'backoffice.viz.monthsAgo.one',
    'backoffice.viz.monthsAgo.other',
  );
}

/**
 * The label for a metered purpose (``plan.month``, ``intake.team``, ...), or
 * the key itself when this build has no words for it: a new kind of call has
 * to be visible in the back office before anyone has translated it, and a
 * blank line would hide exactly the spend nobody is expecting.
 */
export function purposeLabel(purpose: string): string {
  const key = `backoffice.customer.cost.purpose.${purpose}`;
  const label = translate(key);
  return label === key ? purpose : label;
}
