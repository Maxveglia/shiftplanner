import { describe, expect, it, vi } from 'vitest';
import {
  attachKeyboardWedge,
  BURST_MAX_GAP_MS,
  createFieldBurstTracker,
  createKeyboardWedge,
  isScannerBurst,
  isTextEntry,
  WEDGE_GAP_MS,
  type WedgeKeyEvent,
} from './keyboardWedge';

const BODY = { tagName: 'BODY' };
const BUTTON = { tagName: 'BUTTON' };

/** Types `text` into the wedge one key every `every` ms from `start`, then `end`. */
function type(
  wedge: ReturnType<typeof createKeyboardWedge>,
  text: string,
  { start = 1000, every = 8, end = 'Enter', target = BODY as unknown } = {},
) {
  const results = [];
  let t = start;
  for (const key of [...text]) {
    results.push(wedge.key({ key, target }, t));
    t += every;
  }
  if (end) results.push(wedge.key({ key: end, target }, t));
  return { results, last: results[results.length - 1], at: t };
}

const nothing = { code: null, consume: false };

describe('createKeyboardWedge', () => {
  it('reads a code typed fast and ended with Enter', () => {
    const w = createKeyboardWedge();
    const { results, last } = type(w, '8410188012345');
    expect(last).toEqual({ code: '8410188012345', consume: true });
    // Every key of the scan is taken, so none of them does anything else.
    expect(results.every((r) => r.consume)).toBe(true);
  });

  it('takes Tab as the end of a code too', () => {
    const w = createKeyboardWedge();
    expect(type(w, 'ABC-123', { end: 'Tab' }).last).toEqual({ code: 'ABC-123', consume: true });
  });

  it('leaves Enter and Tab alone when nothing was collected', () => {
    const w = createKeyboardWedge();
    expect(w.key({ key: 'Enter', target: BUTTON }, 0)).toEqual(nothing);
    expect(w.key({ key: 'Tab', target: BUTTON }, 10)).toEqual(nothing);
  });

  it('takes fewer than four quick characters for a person, and leaves their Enter alone', () => {
    const w = createKeyboardWedge();
    expect(type(w, '123', { target: BUTTON }).last).toEqual(nothing);
    expect(type(createKeyboardWedge(), '1234').last.code).toBe('1234');
  });

  it('forgets a lone key once more than the gap has passed', () => {
    const w = createKeyboardWedge({ minLength: 1 });
    w.key({ key: '7', target: BODY }, 0);
    // A person pressed 7, and later presses Enter on a focused button.
    expect(w.key({ key: 'Enter', target: BUTTON }, WEDGE_GAP_MS + 1)).toEqual(nothing);
  });

  it('starts over when the next scan comes after a pause', () => {
    const w = createKeyboardWedge();
    w.key({ key: '1', target: BODY }, 0);
    const { last } = type(w, '96385074', { start: 5000 });
    expect(last.code).toBe('96385074');
  });

  it('keeps a code whose keys are just under the gap apart', () => {
    const w = createKeyboardWedge();
    expect(type(w, '1234', { every: WEDGE_GAP_MS }).last.code).toBe('1234');
    // One millisecond slower and each key starts over -- the Enter included,
    // which then finds nothing to end.
    const w2 = createKeyboardWedge();
    expect(type(w2, '1234', { every: WEDGE_GAP_MS + 1 }).last).toEqual(nothing);
  });

  it('reads two scans back to back as two codes', () => {
    const w = createKeyboardWedge();
    const first = type(w, '1111');
    const second = type(w, '2222', { start: first.at + 5 });
    expect(first.last.code).toBe('1111');
    expect(second.last.code).toBe('2222');
  });

  it('ignores keys with Ctrl, Meta or Alt, and keeps collecting around them', () => {
    const w = createKeyboardWedge();
    w.key({ key: '1', target: BODY }, 0);
    expect(w.key({ key: 'c', ctrlKey: true, target: BODY }, 5)).toEqual(nothing);
    expect(w.key({ key: 'v', metaKey: true, target: BODY }, 10)).toEqual(nothing);
    expect(w.key({ key: 'x', altKey: true, target: BODY }, 15)).toEqual(nothing);
    w.key({ key: '2', target: BODY }, 20);
    w.key({ key: '3', target: BODY }, 22);
    w.key({ key: '4', target: BODY }, 24);
    expect(w.key({ key: 'Enter', target: BODY }, 25).code).toBe('1234');
  });

  it('ignores keys that are not characters (Shift before a capital)', () => {
    const w = createKeyboardWedge();
    const keys: WedgeKeyEvent[] = [
      { key: 'Shift' },
      { key: 'A' },
      { key: 'Shift' },
      { key: 'B' },
      { key: 'Unidentified' },
      { key: '1' },
      { key: 'Dead' },
      { key: '2' },
      { key: 'ArrowDown' },
    ];
    keys.forEach((k, i) => {
      const r = w.key({ ...k, target: BODY }, i * 5);
      if (k.key.length > 1) expect(r).toEqual(nothing);
    });
    expect(w.key({ key: 'Enter', target: BODY }, 50).code).toBe('AB12');
  });

  it('ignores held-down repeats and IME composition', () => {
    const w = createKeyboardWedge({ minLength: 1 });
    w.key({ key: '1', target: BODY }, 0);
    expect(w.key({ key: '1', repeat: true, target: BODY }, 5).consume).toBe(false);
    expect(w.key({ key: 'a', isComposing: true, target: BODY }, 10).consume).toBe(false);
    expect(w.key({ key: 'Enter', target: BODY }, 15).code).toBe('1');
  });

  it('leaves a focused text field to the field tracker', () => {
    const w = createKeyboardWedge();
    const field = { tagName: 'INPUT', type: 'text' };
    const { results } = type(w, '8410188012345', { target: field });
    expect(results.every((r) => r.code === null && !r.consume)).toBe(true);
  });

  it('drops what it had when the focus lands in a field mid-way', () => {
    const w = createKeyboardWedge();
    type(w, '12', { end: '' });
    w.key({ key: '9', target: { tagName: 'TEXTAREA' } }, 1020);
    expect(type(w, '3456', { start: 1030 }).last.code).toBe('3456');
  });

  it('reads the scan on a focused button, and takes the Enter away from it', () => {
    const w = createKeyboardWedge();
    const { last } = type(w, '036000291452', { target: BUTTON });
    expect(last).toEqual({ code: '036000291452', consume: true });
  });

  it('keeps a space inside a code but never starts one with it', () => {
    const w = createKeyboardWedge();
    expect(w.key({ key: ' ', target: BUTTON }, 0)).toEqual(nothing);
    expect(type(w, 'AB CD', { start: 10 }).last.code).toBe('AB CD');
  });

  it('cuts a runaway buffer instead of growing forever', () => {
    const w = createKeyboardWedge({ maxLength: 4, minLength: 1 });
    expect(type(w, '123456').last.code).toBe('56');
  });

  it('forgets everything on reset', () => {
    const w = createKeyboardWedge({ minLength: 1 });
    w.key({ key: '1', target: BODY }, 0);
    w.reset();
    expect(w.key({ key: 'Enter', target: BODY }, 5).code).toBeNull();
  });
});

describe('isScannerBurst', () => {
  const at = (gap: number, n: number, start = 0) => Array.from({ length: n }, (_, i) => start + i * gap);

  it('is a scanner at 5-20 ms a key', () => {
    expect(isScannerBurst(at(5, 13))).toBe(true);
    expect(isScannerBurst(at(20, 8))).toBe(true);
    expect(isScannerBurst([0, 4, 19, 30, 41, 60])).toBe(true);
  });

  it('is a person at 80-150 ms a key, however many', () => {
    expect(isScannerBurst(at(80, 13))).toBe(false);
    expect(isScannerBurst(at(150, 20))).toBe(false);
    expect(isScannerBurst([0, 90, 170, 260, 340, 420, 510])).toBe(false);
  });

  it('needs six characters, and every gap under 35 ms', () => {
    expect(isScannerBurst(at(10, 5))).toBe(false);
    expect(isScannerBurst(at(10, 6))).toBe(true);
    expect(isScannerBurst(at(BURST_MAX_GAP_MS - 1, 6))).toBe(true);
    expect(isScannerBurst(at(BURST_MAX_GAP_MS, 6))).toBe(false);
    // One slow key in the middle: a person who happened to be quick.
    expect(isScannerBurst([0, 10, 20, 120, 130, 140, 150])).toBe(false);
  });
});

describe('createFieldBurstTracker', () => {
  const FIELD = { tagName: 'INPUT', type: 'search' };

  /** Types into a field whose value grows with each key, like a real one. */
  function typeInto(
    tr: ReturnType<typeof createFieldBurstTracker>,
    text: string,
    { start = 1000, every = 8, before = '', end = 'Enter', target = FIELD as unknown } = {},
  ) {
    let value = before;
    let t = start;
    for (const key of [...text]) {
      tr.key({ key, target }, t, value);
      value += key;
      t += every;
    }
    return { result: end ? tr.key({ key: end, target }, t, value) : null, value, at: t };
  }

  it('takes a scanner burst out of the field, giving back what it held', () => {
    const tr = createFieldBurstTracker();
    const { result } = typeInto(tr, '8410188012345', { before: 'coca' });
    expect(result).toEqual({
      code: '8410188012345',
      consume: true,
      restore: { target: FIELD, value: 'coca' },
    });
  });

  it('reads the burst after what a person typed, not the whole field', () => {
    const tr = createFieldBurstTracker();
    const typed = typeInto(tr, 'coca', { every: 120, end: '' });
    const { result } = typeInto(tr, '96385074', { start: typed.at + 400, before: typed.value, end: 'Tab' });
    expect(result?.code).toBe('96385074');
    expect(result?.restore?.value).toBe('coca');
  });

  it('leaves a person alone: their Enter submits as always', () => {
    const tr = createFieldBurstTracker();
    expect(typeInto(tr, 'Coca-Cola 33', { every: 110 }).result).toEqual(nothing);
    expect(typeInto(tr, '24', { every: 5 }).result).toEqual(nothing); // quick, but two keys
  });

  it('does not count a burst typed into another field', () => {
    const tr = createFieldBurstTracker();
    typeInto(tr, '8410188012345', { end: '' });
    expect(tr.key({ key: 'Enter', target: { tagName: 'INPUT', type: 'text' } }, 1200, '')).toEqual(nothing);
  });

  it('gives up when the Enter comes long after the burst', () => {
    const tr = createFieldBurstTracker();
    const { at } = typeInto(tr, '8410188012345', { end: '' });
    expect(tr.key({ key: 'Enter', target: FIELD }, at + WEDGE_GAP_MS + 50, '8410188012345')).toEqual(nothing);
  });

  it('keeps collecting through Shift, and starts over on Backspace', () => {
    const tr = createFieldBurstTracker();
    let t = 0;
    for (const key of ['Shift', 'A', 'B', 'Shift', 'C', '1', '2', '3']) tr.key({ key, target: FIELD }, (t += 5), '');
    expect(tr.key({ key: 'Enter', target: FIELD }, (t += 5), 'ABC123').code).toBe('ABC123');
    for (const key of ['1', '2', '3', 'Backspace', '4', '5', '6']) tr.key({ key, target: FIELD }, (t += 5), '');
    expect(tr.key({ key: 'Enter', target: FIELD }, (t += 5), '').code).toBeNull();
  });

  it('ignores a field when the key is not in one', () => {
    const tr = createFieldBurstTracker();
    expect(tr.key({ key: '1', target: BODY }, 0, '')).toEqual(nothing);
  });
});

describe('isTextEntry', () => {
  it('is true for the fields a person types into', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTextEntry({ tagName: 'input', type: 'NUMBER' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'datetime-local' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT' })).toBe(true);
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false for everything else', () => {
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(undefined)).toBe(false);
    expect(isTextEntry(BODY)).toBe(false);
    expect(isTextEntry(BUTTON)).toBe(false);
    expect(isTextEntry({ tagName: 'SELECT' })).toBe(false);
    expect(isTextEntry({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextEntry({ tagName: 'INPUT', type: 'button' })).toBe(false);
    expect(isTextEntry({ tagName: 'A', isContentEditable: false })).toBe(false);
  });
});

describe('attachKeyboardWedge', () => {
  function fakeWindow() {
    let listener: ((e: KeyboardEvent) => void) | null = null;
    let capture: boolean | null = null;
    return {
      addEventListener: (_t: 'keydown', fn: (e: KeyboardEvent) => void, c: boolean) => {
        listener = fn;
        capture = c;
      },
      removeEventListener: (_t: 'keydown', fn: (e: KeyboardEvent) => void) => {
        if (listener === fn) listener = null;
      },
      press(key: string, target: unknown = BODY) {
        const e = { key, target, preventDefault: vi.fn() } as unknown as KeyboardEvent;
        listener?.(e);
        return e.preventDefault as unknown as ReturnType<typeof vi.fn>;
      },
      get listening() {
        return listener !== null;
      },
      get capture() {
        return capture;
      },
    };
  }

  it('hands whole codes over, stops their defaults, and detaches', () => {
    const win = fakeWindow();
    let t = 0;
    const codes: string[] = [];
    const stop = attachKeyboardWedge(win, (c) => codes.push(c), { now: () => (t += 10) });
    expect(win.capture).toBe(true);
    for (const k of '4006381333931') expect(win.press(k, BUTTON)).toHaveBeenCalled();
    expect(win.press('Enter', BUTTON)).toHaveBeenCalled();
    expect(codes).toEqual(['4006381333931']);
    // An ordinary Enter on a button, later, still presses it.
    t += 1000;
    expect(win.press('Enter', BUTTON)).not.toHaveBeenCalled();
    stop();
    expect(win.listening).toBe(false);
  });

  it('swallows the LF of a CR+LF suffix, and only right after a code', () => {
    const win = fakeWindow();
    let t = 0;
    const codes: string[] = [];
    attachKeyboardWedge(win, (c) => codes.push(c), { now: () => (t += 5) });
    for (const k of '96385074') win.press(k, BUTTON);
    win.press('Enter', BUTTON);
    // 5 ms later: the second half of the suffix.
    expect(win.press('Enter', BUTTON)).toHaveBeenCalled();
    expect(codes).toEqual(['96385074']);
    // Another Enter, now, is a person's.
    t += 100;
    expect(win.press('Enter', BUTTON)).not.toHaveBeenCalled();
  });

  it('takes a burst out of a text field and puts the field back', () => {
    const win = fakeWindow();
    let t = 0;
    const codes: string[] = [];
    const restored: [unknown, string][] = [];
    const field = { tagName: 'INPUT', type: 'text', value: 'Makro' };
    attachKeyboardWedge(win, (c) => codes.push(c), {
      now: () => (t += 8),
      restore: (f, v) => restored.push([f, v]),
    });
    for (const k of '8410188012345') {
      expect(win.press(k, field)).not.toHaveBeenCalled(); // the characters land, as typed
      field.value += k;
    }
    // Its Enter would have submitted the form the field is in.
    expect(win.press('Enter', field)).toHaveBeenCalled();
    expect(codes).toEqual(['8410188012345']);
    expect(restored).toEqual([[field, 'Makro']]);
  });

  it('leaves a person typing in a field alone', () => {
    const win = fakeWindow();
    let t = 0;
    const codes: string[] = [];
    const field = { tagName: 'INPUT', type: 'text', value: '' };
    attachKeyboardWedge(win, (c) => codes.push(c), { now: () => (t += 120), restore: () => {} });
    for (const k of 'Makro Sevilla') win.press(k, field);
    expect(win.press('Enter', field)).not.toHaveBeenCalled();
    expect(codes).toEqual([]);
  });
});
