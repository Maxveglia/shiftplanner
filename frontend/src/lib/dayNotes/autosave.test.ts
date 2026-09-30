// The note saves itself, so these are the promises that replace the Save
// button: it writes after a pause and not before, it writes what is on screen
// and nothing older, it never has two writes out at once, and a failure stays
// visible until something fixes it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, createAutosave, planSave, type SaveOp } from './autosave';

/** A write the test finishes by hand, to catch what happens while it is out. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A controller whose writes are recorded and succeed at once. */
function recording(initial = '') {
  const ops: SaveOp[] = [];
  const ctl = createAutosave<string>({
    initial,
    save: async (op) => {
      ops.push(op);
      return 'ok';
    },
  });
  return { ctl, ops };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('planSave', () => {
  it('writes the trimmed text when it differs from what the server holds', () => {
    expect(planSave('  Caja 1200  ', '')).toEqual({ kind: 'put', body: 'Caja 1200', send: false });
  });

  it('does nothing when only the whitespace moved', () => {
    expect(planSave('Caja 1200\n', 'Caja 1200')).toBeNull();
  });

  it('deletes a saved note whose box was emptied', () => {
    expect(planSave('   ', 'Caja 1200')).toEqual({ kind: 'delete' });
  });

  it('does nothing for an empty box with nothing saved', () => {
    expect(planSave('', '')).toBeNull();
  });
});

describe('createAutosave', () => {
  it('writes once, after the typing pauses, with the last text', async () => {
    const { ctl, ops } = recording();
    ctl.edit('C');
    await vi.advanceTimersByTimeAsync(1_000);
    ctl.edit('Caja');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(ops).toEqual([]);
    expect(ctl.getSnapshot().phase).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    expect(ops).toEqual([{ kind: 'put', body: 'Caja', send: false }]);
    expect(ctl.getSnapshot()).toMatchObject({ phase: 'saved', saved: 'Caja' });
    expect(ctl.unsynced()).toBe(false);
  });

  it('says nothing about saving before anything was typed', () => {
    const { ctl } = recording('Caja 900');
    expect(ctl.getSnapshot().phase).toBe('idle');
    expect(ctl.unsynced()).toBe(false);
  });

  it('writes nothing when the text comes back to what was saved', async () => {
    const { ctl, ops } = recording('Caja 900');
    ctl.edit('Caja 9000');
    ctl.edit('Caja 900');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(ops).toEqual([]);
    expect(ctl.getSnapshot().phase).toBe('idle');
  });

  it('flush writes at once and the pending pause does not write again', async () => {
    const { ctl, ops } = recording();
    ctl.edit('Lleno de 22 a 1');
    await ctl.flush();
    expect(ops).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(ops).toHaveLength(1);
  });

  it('deletes the note when the box is emptied, with no question asked', async () => {
    const { ctl, ops } = recording('Cerrado por obras');
    ctl.edit('');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(ops).toEqual([{ kind: 'delete' }]);
    expect(ctl.getSnapshot().saved).toBe('');
  });

  it('never has two writes out, and the second writes what is on screen THEN', async () => {
    const first = deferred<string>();
    const ops: SaveOp[] = [];
    let out = 0;
    let most = 0;
    const ctl = createAutosave<string>({
      initial: '',
      save: async (op) => {
        ops.push(op);
        out += 1;
        most = Math.max(most, out);
        try {
          return ops.length === 1 ? await first.promise : 'ok';
        } finally {
          out -= 1;
        }
      },
    });

    ctl.edit('uno');
    void ctl.flush();
    expect(ctl.getSnapshot().phase).toBe('saving');

    // Typing and a flush while the first write is out.
    ctl.edit('uno dos');
    void ctl.flush();
    ctl.edit('uno dos tres');
    expect(ops).toHaveLength(1);

    first.resolve('ok');
    await vi.runAllTimersAsync();
    expect(most).toBe(1);
    expect(ops.map((o) => (o.kind === 'put' ? o.body : 'delete'))).toEqual(['uno', 'uno dos tres']);
    expect(ctl.getSnapshot()).toMatchObject({ phase: 'saved', saved: 'uno dos tres' });
  });

  it('keeps a failure on screen until a retry lands', async () => {
    let fail = true;
    const ctl = createAutosave<string>({
      initial: '',
      save: async () => {
        if (fail) throw new Error('offline');
        return 'ok';
      },
    });
    ctl.edit('Caja 1500');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(ctl.getSnapshot().phase).toBe('error');
    expect(ctl.unsynced()).toBe(true);

    // It does not retry on its own in a loop.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 10);
    expect(ctl.getSnapshot().phase).toBe('error');

    fail = false;
    await ctl.flush();
    expect(ctl.getSnapshot()).toMatchObject({ phase: 'saved', saved: 'Caja 1500', error: null });
  });

  it('typing over a failure clears it and the pause is the retry', async () => {
    let fail = true;
    const ops: SaveOp[] = [];
    const ctl = createAutosave<string>({
      initial: '',
      save: async (op) => {
        ops.push(op);
        if (fail) throw new Error('offline');
        return 'ok';
      },
    });
    ctl.edit('a');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(ctl.getSnapshot().phase).toBe('error');
    fail = false;
    ctl.edit('ab');
    expect(ctl.getSnapshot()).toMatchObject({ phase: 'pending', error: null });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(ctl.getSnapshot().phase).toBe('saved');
    expect(ops).toHaveLength(2);
  });

  it('send writes the text on screen with send: true, after any write already out', async () => {
    const first = deferred<string>();
    const ops: SaveOp[] = [];
    const ctl = createAutosave<string>({
      initial: '',
      save: async (op) => {
        ops.push(op);
        return ops.length === 1 ? first.promise : 'sent';
      },
    });
    ctl.edit('borrador');
    void ctl.flush();
    ctl.edit('final');
    const sent = ctl.send();
    expect(ctl.getSnapshot().sending).toBe(true);
    // A second press is the same send, not a second email.
    expect(ctl.send()).toBe(sent);

    first.resolve('ok');
    await expect(sent).resolves.toBe('sent');
    expect(ops).toEqual([
      { kind: 'put', body: 'borrador', send: false },
      { kind: 'put', body: 'final', send: true },
    ]);
    expect(ctl.getSnapshot()).toMatchObject({ sending: false, phase: 'saved', saved: 'final' });
  });

  it('send sends even when the text is already saved', async () => {
    const { ctl, ops } = recording('Caja 700');
    await expect(ctl.send()).resolves.toBe('ok');
    expect(ops).toEqual([{ kind: 'put', body: 'Caja 700', send: true }]);
  });

  it('a send queued behind a write that fails fails too, and emails nothing', async () => {
    const first = deferred<string>();
    const ops: SaveOp[] = [];
    const ctl = createAutosave<string>({
      initial: '',
      save: async (op) => {
        ops.push(op);
        return first.promise;
      },
    });
    ctl.edit('texto');
    void ctl.flush();
    const sent = ctl.send();
    first.reject(new Error('500'));
    await expect(sent).rejects.toThrow('500');
    expect(ops).toHaveLength(1);
    expect(ctl.getSnapshot()).toMatchObject({ phase: 'error', sending: false });
  });

  it('is unsynced while a write is out, even when the text matches it', async () => {
    const first = deferred<string>();
    const ctl = createAutosave<string>({ initial: '', save: () => first.promise });
    ctl.edit('x');
    void ctl.flush();
    expect(ctl.unsynced()).toBe(true);
    first.resolve('ok');
    await vi.runAllTimersAsync();
    expect(ctl.unsynced()).toBe(false);
  });

  it('tells its subscribers about every change', async () => {
    const { ctl } = recording();
    const seen: string[] = [];
    const stop = ctl.subscribe(() => seen.push(ctl.getSnapshot().phase));
    ctl.edit('hola');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    stop();
    const before = seen.length;
    ctl.edit('hola otra vez');
    // Consecutive repeats folded: how many renders a write costs is not the point.
    expect(seen.filter((p, i) => p !== seen[i - 1])).toEqual(['pending', 'saving', 'saved']);
    expect(seen).toHaveLength(before);
  });

  it('opens owing a write when the server lacks what the box shows, and pays it on flush', async () => {
    const ops: SaveOp[] = [];
    const ctl = createAutosave<string>({
      initial: 'Sábado: sin red',
      saved: '',
      save: async (op) => {
        ops.push(op);
        return 'ok';
      },
    });
    expect(ctl.getSnapshot().phase).toBe('pending');
    expect(ctl.unsynced()).toBe(true);
    await ctl.flush();
    expect(ops).toEqual([{ kind: 'put', body: 'Sábado: sin red', send: false }]);
    expect(ctl.getSnapshot().phase).toBe('saved');
  });

  it('hands the words of a failed write to whoever is listening, even after the editor is gone', async () => {
    const failed: string[] = [];
    let synced = 0;
    const ctl = createAutosave<string>({
      initial: '',
      save: async () => {
        throw new Error('internetdisconnected');
      },
      onFailed: (text) => failed.push(text),
      onSynced: () => {
        synced += 1;
      },
    });
    ctl.edit('Sábado 26: esto no llega');
    // The editor unmounts: its flush is the last thing it does.
    await ctl.flush();
    expect(failed).toEqual(['Sábado 26: esto no llega']);
    expect(synced).toBe(0);
  });

  it('says it is synced once the server has it, and when the text comes back to it', async () => {
    let synced = 0;
    const ctl = createAutosave<string>({
      initial: 'Caja 900',
      save: async () => 'ok',
      onSynced: () => {
        synced += 1;
      },
    });
    ctl.edit('Caja 950');
    expect(synced).toBe(0);
    ctl.edit('Caja 900');
    expect(synced).toBe(1);
    ctl.edit('Caja 1000');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(synced).toBe(2);
  });
});

