import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UNDO_WINDOW_MS,
  clearUndos,
  dismissUndo,
  getPending,
  offerUndo,
  subscribe,
  takeUndo,
} from './undo';

beforeEach(() => {
  vi.useFakeTimers();
  clearUndos();
});

afterEach(() => {
  clearUndos();
  vi.useRealTimers();
});

describe('the undo offer', () => {
  it('stands for the window and then lapses on its own', () => {
    offerUndo('emp-1', 'Ana');
    expect(getPending().map((p) => p.name)).toEqual(['Ana']);

    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    expect(getPending()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(getPending()).toEqual([]);
  });

  it('survives the screen the removal happened on', () => {
    // The store is the whole point: nothing here is tied to a component, so a
    // manager who navigates away still has the offer when they land.
    offerUndo('emp-1', 'Ana');
    const unsubscribe = subscribe(() => {});
    unsubscribe();
    expect(getPending().map((p) => p.id)).toEqual(['emp-1']);
  });

  it('keeps one offer per person, oldest first', () => {
    offerUndo('emp-1', 'Ana');
    offerUndo('emp-2', 'Marcus');
    offerUndo('emp-3', 'Iris');
    expect(getPending().map((p) => p.name)).toEqual(['Ana', 'Marcus', 'Iris']);
  });

  it('lapses each offer on its own clock', () => {
    offerUndo('emp-1', 'Ana');
    vi.advanceTimersByTime(UNDO_WINDOW_MS / 2);
    offerUndo('emp-2', 'Marcus');

    vi.advanceTimersByTime(UNDO_WINDOW_MS / 2);
    expect(getPending().map((p) => p.name)).toEqual(['Marcus']);

    vi.advanceTimersByTime(UNDO_WINDOW_MS / 2);
    expect(getPending()).toEqual([]);
  });
});

describe('acting on an offer', () => {
  it('hands the entry back exactly once', () => {
    offerUndo('emp-1', 'Ana');
    expect(takeUndo('emp-1')?.name).toBe('Ana');
    // The second caller gets nothing, which is what stops a click that lands on
    // the same tick as the timer from sending two restores.
    expect(takeUndo('emp-1')).toBeNull();
    expect(getPending()).toEqual([]);
  });

  it('gives nothing back once the offer has lapsed', () => {
    offerUndo('emp-1', 'Ana');
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(takeUndo('emp-1')).toBeNull();
  });

  it('stops the clock when taken, so nothing fires afterwards', () => {
    const seen: number[] = [];
    const unsubscribe = subscribe(() => seen.push(getPending().length));

    offerUndo('emp-1', 'Ana');
    takeUndo('emp-1');
    const afterTake = seen.length;

    vi.advanceTimersByTime(UNDO_WINDOW_MS * 2);
    expect(seen.length).toBe(afterTake);
    unsubscribe();
  });

  it('lets the manager close the notice and let the removal stand', () => {
    offerUndo('emp-1', 'Ana');
    dismissUndo('emp-1');
    expect(getPending()).toEqual([]);
  });
});

describe('the snapshot', () => {
  it('keeps the same array identity between changes', () => {
    // useSyncExternalStore compares by identity; a fresh array per read would
    // re-render the layout forever.
    offerUndo('emp-1', 'Ana');
    expect(getPending()).toBe(getPending());
  });

  it('notifies subscribers on every change and no more', () => {
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });

    offerUndo('emp-1', 'Ana');
    expect(calls).toBe(1);

    dismissUndo('emp-does-not-exist');
    expect(calls).toBe(1);

    dismissUndo('emp-1');
    expect(calls).toBe(2);

    unsubscribe();
    offerUndo('emp-2', 'Marcus');
    expect(calls).toBe(2);
  });
});
