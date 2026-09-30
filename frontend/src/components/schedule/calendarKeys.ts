// Whose key is it: the calendar's, or a dialog's over it?
//
// The day view and the day grid listen for keys on the WINDOW -- the arrows
// step a day, Escape closes it or puts a shift down, Delete removes the
// selected shift -- because a manager reading a day has no particular element
// focused. But a window hears every key on the page, including the ones meant
// for a dialog on top: Escape pressed to close the publish dialog put the
// selected shift down instead (the grid listens in the capture phase and marks
// the key handled, and a dialog leaves a handled Escape alone), Backspace in
// the dialog removed the shift behind it, and the arrows in the assistant
// stepped the day underneath. So: while a dialog is open, or the key comes
// from inside one, the calendar does nothing with it.
//
// Pure, so vitest can hold it without a DOM: anything with `closest` will do
// for the target, and the open dialog is passed in rather than looked up.

/** What marks a dialog, modal or not. */
export const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

/** What marks a dialog that holds the page while it is open. */
export const MODAL_SELECTOR = '[aria-modal="true"]';

interface KeyTarget {
  closest?: (selector: string) => unknown;
}

/**
 * Whether a key pressed on `target` is the calendar's to act on: not while a
 * modal dialog is open anywhere (`openModal`), and not when it was pressed
 * inside any dialog.
 */
export function keyIsCalendars(target: KeyTarget | null | undefined, openModal: unknown): boolean {
  if (openModal) return false;
  if (target && typeof target.closest === 'function' && target.closest(DIALOG_SELECTOR)) {
    return false;
  }
  return true;
}

/** The same, read off a real key event and the page. */
export function keyForCalendar(e: KeyboardEvent): boolean {
  if (typeof document === 'undefined') return true;
  return keyIsCalendars(e.target as KeyTarget | null, document.querySelector(MODAL_SELECTOR));
}
