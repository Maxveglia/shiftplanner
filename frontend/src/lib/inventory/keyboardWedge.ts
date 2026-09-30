// A barcode scanner on a keyboard's wire.
//
// A USB or Bluetooth scanner is a keyboard as far as the browser knows: it
// "types" the code, a character every few milliseconds, and presses Enter (or
// Tab, depending on how it is configured). Two cases, both handled here:
//
// - NOTHING editable has the focus -- which on a phone is the case we want,
//   because a focused field opens the on-screen keyboard over half the screen
//   for every box. The keys are collected on the window (`createKeyboardWedge`).
//   A person using the keyboard on the same page must not be mistaken for a
//   scanner, so a code is only what arrives fast: keys more than GAP_MS apart
//   start over, a lone key never waits around to be glued onto the next scan,
//   and fewer than MIN_LENGTH characters are not a code. Enter or Tab with
//   nothing collected is left alone (somebody pressing a focused button), and
//   so is anything with Ctrl, Meta or Alt held and anything not a character.
//
// - A TEXT FIELD has the focus -- the product search, a quantity, the
//   supplier -- and the gun fires anyway. Left alone, the code would land in
//   that field and its Enter would submit whatever form the field is in: the
//   delivery saved with a barcode for a supplier. So a field's keys are
//   watched too (`createFieldBurstTracker`), and a burst no person can type
//   (BURST_MIN_CHARS characters under BURST_MAX_GAP_MS apart, then Enter or
//   Tab) is taken out of the field, which gets back what it held before, and
//   read as a scan.
//
// Some scanners end a code with CR+LF, which the browser delivers as two
// Enters: the second one, arriving right after a code, is swallowed rather
// than pressing whatever button or submitting whatever form is focused.
//
// The decisions are pure, with the clock passed in, so they are tested
// without a DOM; `attachKeyboardWedge` only wires them to a window.

/** Longest pause between two keys of one code with no field focused. Scanners send one every ~5-30 ms. */
export const WEDGE_GAP_MS = 300;

/** Fewer characters than this, collected outside a field, are a person, not a code. */
export const WEDGE_MIN_LENGTH = 4;

/** A runaway buffer (a stuck key, a cat) is cut here rather than growing forever. */
export const WEDGE_MAX_LENGTH = 256;

/** Inside a field: this many characters at least... */
export const BURST_MIN_CHARS = 6;

/** ...each under this many ms after the one before. A fast typist leaves ~80-150 ms. */
export const BURST_MAX_GAP_MS = 35;

/** A second Enter this soon after a code is the LF of a CR+LF suffix. */
export const SUFFIX_ENTER_MS = 50;

/** The parts of a KeyboardEvent the wedge reads. */
export interface WedgeKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  target?: unknown;
}

export interface WedgeResult {
  /** A whole code, when this key finished one. */
  code: string | null;
  /**
   * Whether the key belongs to a scan and its default should be stopped: the
   * Enter at the end of a code must not also press the button that happens to
   * have the focus, nor the Tab move the focus away.
   */
  consume: boolean;
}

export interface KeyboardWedge {
  /** Feed one keydown, at `now` (ms, any monotonic clock). */
  key(event: WedgeKeyEvent, now: number): WedgeResult;
  /** Forget whatever was collected. */
  reset(): void;
}

// The input types a person types text into. A focused checkbox, radio or
// button is not one: keys on those are the scanner's.
const TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'number',
  'tel',
  'email',
  'url',
  'password',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
]);

/**
 * Whether the focus is somewhere that takes typing itself -- a text field, a
 * textarea, anything contenteditable. Read by duck typing, so tests can hand
 * it plain objects.
 */
export function isTextEntry(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = typeof el.type === 'string' ? el.type.toLowerCase() : '';
    return TEXT_INPUT_TYPES.has(type);
  }
  return false;
}

function isCharacter(key: string): boolean {
  // One character, whatever its UTF-16 length ("Enter", "Shift", "Dead" and
  // "Unidentified" are names, not characters).
  return [...key].length === 1;
}

const isEnd = (key: string) => key === 'Enter' || key === 'Tab';

/**
 * Whether keys pressed at these times (ms, in order) are a scanner's rather
 * than a person's: enough of them, each one close on the last.
 */
export function isScannerBurst(
  times: readonly number[],
  options: { minChars?: number; maxGapMs?: number } = {},
): boolean {
  const minChars = options.minChars ?? BURST_MIN_CHARS;
  const maxGap = options.maxGapMs ?? BURST_MAX_GAP_MS;
  if (times.length < minChars) return false;
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] >= maxGap) return false;
  }
  return true;
}

export function createKeyboardWedge(
  options: { gapMs?: number; minLength?: number; maxLength?: number } = {},
): KeyboardWedge {
  const gapMs = options.gapMs ?? WEDGE_GAP_MS;
  const minLength = options.minLength ?? WEDGE_MIN_LENGTH;
  const maxLength = options.maxLength ?? WEDGE_MAX_LENGTH;
  let buffer = '';
  let lastAt = -Infinity;

  const nothing: WedgeResult = { code: null, consume: false };

  return {
    reset() {
      buffer = '';
      lastAt = -Infinity;
    },
    key(event, now) {
      // A field with the focus is the field tracker's.
      if (isTextEntry(event.target)) {
        buffer = '';
        return nothing;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return nothing;
      if (event.repeat || event.isComposing) return nothing;
      // Too long since the last key: that was a person, not the same scan.
      if (now - lastAt > gapMs) buffer = '';

      if (isEnd(event.key)) {
        const code = buffer;
        buffer = '';
        lastAt = -Infinity;
        // Two or three quick keys and Enter are a person, whose Enter is
        // theirs to press.
        if (code.length < minLength) return nothing;
        return { code, consume: true };
      }
      if (!isCharacter(event.key)) return nothing;
      // A space does not start a code (it is how a person presses a focused
      // button), but inside one it is part of it -- and must not press that
      // button halfway through a scan.
      if (event.key === ' ' && buffer === '') return nothing;
      if (buffer.length >= maxLength) buffer = '';
      buffer += event.key;
      lastAt = now;
      return { code: null, consume: true };
    },
  };
}

export interface FieldBurstResult extends WedgeResult {
  /** What the field held before the burst, to put back; set only with a code. */
  restore?: { target: unknown; value: string };
}

export interface FieldBurstTracker {
  /**
   * Feed one keydown in a text field, at `now`. `value` is what the field
   * holds at that moment -- before this key lands in it.
   */
  key(event: WedgeKeyEvent, now: number, value: string): FieldBurstResult;
  reset(): void;
}

/** A scanner firing into a text field: see the header. */
export function createFieldBurstTracker(
  options: { minChars?: number; maxGapMs?: number; endGapMs?: number } = {},
): FieldBurstTracker {
  const maxGap = options.maxGapMs ?? BURST_MAX_GAP_MS;
  // The Enter after the last character: generous, some scanners pause there.
  const endGap = options.endGapMs ?? WEDGE_GAP_MS;
  let run: { target: unknown; startValue: string; chars: string; times: number[] } | null = null;
  const nothing: FieldBurstResult = { code: null, consume: false };

  return {
    reset() {
      run = null;
    },
    key(event, now, value) {
      if (!isTextEntry(event.target)) {
        run = null;
        return nothing;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
        run = null;
        return nothing;
      }
      if (isEnd(event.key)) {
        const r = run;
        run = null;
        if (
          r &&
          r.target === event.target &&
          now - r.times[r.times.length - 1] <= endGap &&
          isScannerBurst(r.times, { minChars: options.minChars, maxGapMs: maxGap })
        ) {
          return { code: r.chars, consume: true, restore: { target: r.target, value: r.startValue } };
        }
        return nothing;
      }
      if (!isCharacter(event.key)) {
        // Shift comes before a scanner's capitals; anything else (Backspace,
        // an arrow) is a person editing.
        if (event.key !== 'Shift') run = null;
        return nothing;
      }
      if (event.repeat) {
        run = null;
        return nothing;
      }
      const fresh =
        !run || run.target !== event.target || now - run.times[run.times.length - 1] >= maxGap;
      if (fresh) run = { target: event.target, startValue: value, chars: '', times: [] };
      run!.chars += event.key;
      run!.times.push(now);
      return nothing;
    },
  };
}

interface KeyTarget {
  addEventListener(type: 'keydown', fn: (e: KeyboardEvent) => void, capture: boolean): void;
  removeEventListener(type: 'keydown', fn: (e: KeyboardEvent) => void, capture: boolean): void;
}

/**
 * Put a text field back to `value` in a way React notices: the native value
 * setter (React's own setter on the element would swallow it) and an `input`
 * event, which is what a controlled field's onChange listens for.
 */
function restoreFieldValue(target: unknown, value: string): void {
  const el = target as HTMLInputElement | HTMLTextAreaElement;
  if (!el || typeof el.dispatchEvent !== 'function') return;
  const proto =
    typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function fieldValue(target: unknown): string {
  const v = (target as { value?: unknown } | null)?.value;
  return typeof v === 'string' ? v : '';
}

/**
 * Listen for scans on `target` (the window) and hand each whole code to
 * `onCode` -- from the keys collected with no field focused, and from bursts
 * into the text fields. Returns the function that stops listening.
 *
 * On the capture phase, so it sees the key before anything on the page does;
 * it never stops propagation, only the default of the keys it took.
 */
export function attachKeyboardWedge(
  target: KeyTarget,
  onCode: (code: string) => void,
  options: {
    now?: () => number;
    gapMs?: number;
    /** Put a field back to what it held before a burst (the DOM's by default). */
    restore?: (field: unknown, value: string) => void;
  } = {},
): () => void {
  const wedge = createKeyboardWedge({ gapMs: options.gapMs });
  const bursts = createFieldBurstTracker();
  const now = options.now ?? (() => performance.now());
  const restore = options.restore ?? restoreFieldValue;
  let swallowUntil = -Infinity;
  const listener = (e: KeyboardEvent) => {
    const at = now();
    if (e.key === 'Enter' && at < swallowUntil) {
      // The LF after a CR: the code was read already.
      swallowUntil = -Infinity;
      e.preventDefault();
      return;
    }
    const inField = isTextEntry(e.target);
    // Each side forgets its half-collected keys when the focus crosses over.
    if (inField) wedge.reset();
    else bursts.reset();
    const result = inField ? bursts.key(e, at, fieldValue(e.target)) : wedge.key(e, at);
    if (result.consume) e.preventDefault();
    if (result.code === null) return;
    swallowUntil = at + SUFFIX_ENTER_MS;
    const put = (result as FieldBurstResult).restore;
    if (put) restore(put.target, put.value);
    onCode(result.code);
  };
  target.addEventListener('keydown', listener, true);
  return () => target.removeEventListener('keydown', listener, true);
}
