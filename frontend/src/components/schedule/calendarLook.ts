// What the calendar looks like: every colour and texture the year and the day
// are drawn in, in one place.
//
// The calendar draws with these and the Colours page explains them with the
// SAME values, imported, so the legend cannot drift from the thing it
// describes -- it did once already, when the bars changed colour and the page
// went on showing the old ones.
//
// THE GROUND. The app stands on the launcher's dark stage: cards are `surface`
// (#111d1a) and the page `ground` (#0b1512). Every figure below is measured
// against those (WCAG 2.1): text 4.5:1 or more, a bar, a ring or a mark 3:1
// or more against what it sits on.
//
// COLOUR IS NEVER THE ONLY SIGN. Each state carries a second one that shows
// without colour: the words on a bar, a texture on the hours paid more and on
// a short hour, an outline for a draft, the reason written across an absent
// row, and a name a screen reader can say.

import type { CSSProperties } from 'react';

// --- One day ---------------------------------------------------------------

/**
 * A shift. Every bar is this one colour: what a shift IS is written on it,
 * and a calendar in one colour reads as one calendar (the legend of eight
 * colours went at the manager's request, PR #112). It is the brand's menta,
 * so a bar is unmistakably the product's own mark and not a warning.
 *
 * A faint fall from top to bottom and a hairline of light along the top edge:
 * the launcher's glass, at the size of a bar. White on it is 4.9:1 at the
 * top and 5.3:1 at the bottom; the bar is 3.2:1 against the card.
 */
export const SHIFT_BAR: CSSProperties = {
  backgroundColor: '#0e7c66',
  backgroundImage: 'linear-gradient(180deg, #0f8069, #0d7865)',
  boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.14)',
};

/**
 * The shift being carried to a row that cannot take it. The words on the
 * badge above it say why; the colour only says "not here". White 5.4:1.
 */
export const SHIFT_BAR_REFUSED: CSSProperties = {
  backgroundColor: '#c2383b',
};

/**
 * Hours not paid like the rest of the shift -- night work, 22:00-06:00 here.
 *
 * The same bar gone dark, the way the hours it marks are, and hatched in
 * menta: a texture, so the difference shows without telling colours apart
 * (the skill's rule 3), and an edge of menta so the part stays one piece
 * with the bar. White on the dark is 12.6:1 and on a hatch line 4.6:1; the
 * edge is 4.4:1 against the card.
 */
export const PREMIUM_HOURS: CSSProperties = {
  backgroundColor: '#083a31',
  backgroundImage:
    'repeating-linear-gradient(135deg, rgb(110 217 192 / 0.45) 0 1.5px, transparent 1.5px 7px)',
  boxShadow: 'inset 0 0 0 1px rgb(68 214 180 / 0.55)',
};

/**
 * An hour with at least the people asked for: the count in light green on a
 * dark green, 10.9:1. Green is the manager's own requirement being met.
 */
export const COVERED_HOUR = 'bg-green-50 text-green-700';

/**
 * An hour short of people. A tint alone was 1.1:1 against the card -- a colour
 * nobody could find -- so it is a red hatch with a red rule under the count
 * (6.3:1), and the count in pale red on it (7.6:1). A screen reader hears
 * "understaffed" with the count (DayGrid).
 */
export const SHORT_HOUR = 'bg-red-100 font-semibold text-red-800';
export const SHORT_HOUR_STYLE: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(135deg, rgb(248 113 113 / 0.2) 0 1.5px, transparent 1.5px 6px)',
  boxShadow: 'inset 0 -2px 0 #f87171',
};

/**
 * Closed, or outside the business's hours: nothing can go there and nothing
 * is missing. Sunk a step below the card and finely hatched, so the open
 * hours read as the space to work in -- a flat grey a shade off the card was
 * 1.05:1 and simply not there.
 */
export const CLOSED_HOURS: CSSProperties = {
  backgroundColor: '#0d1815',
  backgroundImage:
    'repeating-linear-gradient(135deg, rgb(255 255 255 / 0.05) 0 1px, transparent 1px 6px)',
};

/**
 * Somebody away that day -- on leave, a booked absence -- with the reason
 * written across the row: amber, because it is true today and not tomorrow.
 * Text 10.9:1.
 */
export const AWAY_ROW = 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200';

/** Not scheduled for a reason that is simply how things are: grey, 6.7:1. */
export const OFF_ROW = 'bg-gray-100 text-gray-500';

// --- The year --------------------------------------------------------------

/**
 * One class list per state of a day in the year (lib/schedule/focus.ts
 * `dayState` decides which). Published is filled and a draft is an outline
 * on purpose: at arm's length the year reads as "done up to here", and a
 * month that only LOOKS done stands out because it is hollow.
 *
 *   today      the launcher's bright menta, dark figures (10.2:1) and a halo;
 *              it takes the figures the other way round from everything else
 *   published  solid menta, white figures (5.1:1), 3.4:1 against the card
 *   draft      a menta ring (10.2:1 against the card), figures in ink
 *   outside    the neighbouring months' days, faint on purpose
 */
export const YEAR_DAY: Record<'today' | 'outside' | 'published' | 'draft' | 'empty', string> = {
  today:
    'bg-brand-400 text-ground font-semibold shadow-[0_0_0_3px_rgb(68_214_180/0.22),0_0_18px_-4px_rgb(68_214_180/0.7)]',
  outside: 'text-gray-300',
  published: 'bg-brand-600 text-white font-medium',
  draft: 'text-gray-900 ring-[1.5px] ring-inset ring-brand-300',
  empty: 'text-gray-900',
};

/** The two swatches of the year's legend: the same fill and the same ring. */
export const YEAR_SWATCH = {
  published: 'bg-brand-600',
  draft: 'ring-[1.5px] ring-inset ring-brand-300',
} as const;

// --- Hours and pay -----------------------------------------------------------

/**
 * The payroll's bar: ordinary hours in the rota's menta and overtime in red,
 * hatched and parted from them by a gap, so the two never have to be told
 * apart by hue alone. Menta 5.3:1 and red 5.6:1 against the grey track.
 */
export const PAY_REGULAR: CSSProperties = { backgroundColor: '#14a184' };
export const PAY_OVERTIME: CSSProperties = {
  backgroundColor: '#f87171',
  backgroundImage:
    'repeating-linear-gradient(135deg, rgb(11 21 18 / 0.5) 0 1.5px, transparent 1.5px 5px)',
};
