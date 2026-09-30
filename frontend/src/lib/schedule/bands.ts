// What a shift LOOKS like, decided by WHEN it happens.
//
// Before this module, a synthesised shift adopted the identity of whichever
// template it overlapped most -- so a Monday 12:00-20:00 shift could come out
// green and labelled "Weekend Day" simply because that template overlapped it
// by one more hour than "Evening". Colours looked random and a morning shift
// was indistinguishable from an afternoon one.
//
// Now the rule is simple and total: a shift's colour comes from the band its
// MIDPOINT falls in. The same hours always look the same, everywhere.
//
// Midpoint, not start: a 3 PM-11 PM shift is an evening shift even though it
// starts in the afternoon, and 7 AM-3 PM is a morning shift even though it
// starts before dawn. That is how people actually name their shifts.

import { translate } from '../i18n/core';

export interface Band {
  key: 'night' | 'early' | 'morning' | 'afternoon' | 'evening';
  /** The band's name in the language the manager chose. Read it, never cache it. */
  label: string;
  /** Inclusive start minute of the band. */
  from: number;
  /** Exclusive end minute. `night` wraps past midnight and is handled last. */
  to: number;
  color: string;
}

/**
 * `label` is a GETTER on purpose.
 *
 * BANDS is a module-level constant, so a plain `label: translate(...)` would be
 * resolved once, at import time, and the legend would still be in English after
 * the manager switched to Spanish. Reading it lazily keeps the shape of the
 * constant -- callers still write `band.label` -- while the word itself is
 * looked up at the moment it is shown.
 */
function band(
  key: Band['key'],
  from: number,
  to: number,
  color: string,
): Band {
  return {
    key,
    from,
    to,
    color,
    get label() {
      return translate(`domain.band.${key}`);
    },
  };
}

export const BANDS: Band[] = [
  band('early', 5 * 60, 8 * 60, '#0EA5E9'),
  band('morning', 8 * 60, 12 * 60, '#2563EB'),
  band('afternoon', 12 * 60, 17 * 60, '#F59E0B'),
  band('evening', 17 * 60, 22 * 60, '#EA580C'),
  band('night', 22 * 60, 5 * 60, '#4F46E5'),
];

const NIGHT = BANDS[BANDS.length - 1];

/** The band a shift belongs to, from the minute it starts. */
export function bandFor(startMin: number): Band {
  const m = ((startMin % (24 * 60)) + 24 * 60) % (24 * 60);
  for (const b of BANDS) {
    if (b.key === 'night') continue; // wraps midnight, checked below
    if (m >= b.from && m < b.to) return b;
  }
  return NIGHT;
}

/** The band a shift belongs to, from the midpoint of its span. */
export function bandForShift(startMin: number, endMin: number): Band {
  return bandFor(Math.round((startMin + endMin) / 2));
}

export interface ShiftAppearance {
  label: string;
  color: string;
  bandKey: Band['key'];
  isNight: boolean;
}

/**
 * Name and colour for a shift.
 *
 * The colour is ALWAYS the band's — never a template's — so nothing can drift.
 * The label prefers a template that genuinely starts at the same time (managers
 * recognise their own shift names); otherwise it falls back to the band name.
 */
export function shiftAppearance(
  startMin: number,
  endMin: number,
  templateName?: string | null,
): ShiftAppearance {
  const band = bandForShift(startMin, endMin);
  return {
    label: templateName?.trim() ? templateName : band.label,
    color: band.color,
    bandKey: band.key,
    isNight: band.key === 'night',
  };
}
