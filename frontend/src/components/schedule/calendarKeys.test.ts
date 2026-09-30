// A key belongs to the calendar only when no dialog is in the way. The
// failures this pins were all a dialog's key doing something to the calendar
// behind it: Escape putting a shift down instead of closing the dialog,
// Backspace removing a shift, the arrows stepping the day.

import { describe, expect, it } from 'vitest';
import { DIALOG_SELECTOR, keyIsCalendars } from './calendarKeys';

/** A stand-in element: inside a dialog or not. */
const element = (insideDialog: boolean) => ({
  closest: (selector: string) =>
    insideDialog && selector === DIALOG_SELECTOR ? { role: 'dialog' } : null,
});

describe('keyIsCalendars', () => {
  it('is the calendar’s with no dialog anywhere', () => {
    expect(keyIsCalendars(element(false), null)).toBe(true);
    // The window or the document as the target: nothing focused.
    expect(keyIsCalendars({}, null)).toBe(true);
    expect(keyIsCalendars(null, null)).toBe(true);
  });

  it('is not the calendar’s while a modal dialog is open, wherever focus is', () => {
    expect(keyIsCalendars(element(false), { modal: true })).toBe(false);
    expect(keyIsCalendars(null, { modal: true })).toBe(false);
  });

  it('is not the calendar’s when pressed inside a dialog, modal or not', () => {
    expect(keyIsCalendars(element(true), null)).toBe(false);
  });
});
