// Saving a note without a Save button.
//
// WHY A CONTROLLER AND NOT A useEffect WITH A TIMER. The page used to have a
// Save button and a confirm() on every step away from unsaved text. Taking
// both away means the saving has to be right on its own: a pause in typing
// saves, stepping to another day saves, leaving the screen saves, and two of
// those must never race -- a slow first save landing after a quick second one
// would put the older text back on the server. That is a small state machine,
// and a state machine written into effects is one nobody can test here (vitest
// runs in node, with no DOM). So it lives in plain TypeScript, driven by
// timers the tests can fake, and `useAutosave` is a thin React skin over it.
//
// THE RULES IT KEEPS:
//   - One write at a time. Anything asked for during a write waits for it and
//     then writes whatever the box holds THEN, not what it held when asked.
//   - Emptying the box deletes the note. There is no confirm: an empty note is
//     not a note, and the text is one ctrl+Z away while the box has focus.
//   - A failed write stops and says so. It does not retry in a loop; the next
//     keystroke or the Retry link tries again.
//   - Send is a write with `send: true`, queued like any other, so the text
//     emailed is always the text on screen.
//   - It can open on text the server does NOT have (`saved` differs from
//     `initial`): the words of a write that failed after the editor had gone.
//     It then starts pending, and whoever mounts it flushes.

/** How long typing has to pause before the note is written. */
export const AUTOSAVE_DELAY_MS = 1_500;

export type SaveOp = { kind: 'put'; body: string; send: boolean } | { kind: 'delete' };

/**
 * What it takes for the server to hold `text`, given it holds `saved`, or null
 * when it already does. The server trims, so trailing spaces are not a change.
 */
export function planSave(text: string, saved: string): SaveOp | null {
  const body = text.trim();
  if (body === saved) return null;
  if (!body) return { kind: 'delete' };
  return { kind: 'put', body, send: false };
}

/**
 * idle     nothing typed since the editor opened
 * pending  typed, waiting for the pause
 * saving   a write is in flight
 * saved    the server holds what is on screen
 * error    the last write failed; what is on screen is NOT saved
 */
export type AutosavePhase = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface AutosaveSnapshot {
  text: string;
  /** What the server holds, as far as this editor knows (trimmed). */
  saved: string;
  phase: AutosavePhase;
  error: unknown;
  /** A send is queued or in flight. */
  sending: boolean;
}

export interface Autosave<R> {
  getSnapshot: () => AutosaveSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** The box changed. Schedules a write after the pause. */
  edit: (text: string) => void;
  /** Write now, if anything needs writing. Resolves when the server has it (or failed). */
  flush: () => Promise<void>;
  /** Write the current text with `send: true`. Rejects if that write fails. */
  send: () => Promise<R>;
  /** Anything on screen the server does not have yet, or a write still out. */
  unsynced: () => boolean;
}

export function createAutosave<R>({
  initial,
  saved = initial,
  save,
  delay = AUTOSAVE_DELAY_MS,
  onFailed,
  onSynced,
}: {
  /** What the box opens with. */
  initial: string;
  /** What the server holds; the same as `initial` unless a write is owed. */
  saved?: string;
  save: (op: SaveOp) => Promise<R>;
  delay?: number;
  /**
   * A write failed, with the text that did not land. Called even when nobody
   * is subscribed any more: the editor that failed may already be gone, and
   * its words must reach someone who can keep them.
   */
  onFailed?: (text: string, error: unknown) => void;
  /** The server now holds what is on screen, and nothing is out. */
  onSynced?: () => void;
}): Autosave<R> {
  let state: AutosaveSnapshot = {
    text: initial,
    saved: saved.trim(),
    phase: planSave(initial, saved.trim()) ? 'pending' : 'idle',
    error: null,
    sending: false,
  };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  // Asked for again while a write was out: go round once more before stopping.
  let again = false;
  type Waiter = { promise: Promise<R>; resolve: (r: R) => void; reject: (e: unknown) => void };
  // A send asked for and not yet written. Taken through `takeWaiter` so the
  // compiler does not narrow it across an await, which is where it changes.
  let sendWaiter: Waiter | null = null;
  const takeWaiter = (): Waiter | null => {
    const w = sendWaiter;
    sendWaiter = null;
    return w;
  };
  let wroteOnce = false;

  const set = (patch: Partial<AutosaveSnapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  /** Where the phase rests when nothing is in flight. */
  const restingPhase = (): AutosavePhase =>
    planSave(state.text, state.saved) ? 'pending' : wroteOnce ? 'saved' : 'idle';

  /** Come to rest, and say so when that means the server has it all. */
  const settle = (patch: Partial<AutosaveSnapshot> = {}) => {
    set({ ...patch, phase: restingPhase() });
    if (!planSave(state.text, state.saved)) onSynced?.();
  };

  async function drain(): Promise<void> {
    try {
      do {
        again = false;
        const waiter = takeWaiter();
        const text = state.text;
        const op: SaveOp | null = waiter
          ? { kind: 'put', body: text.trim(), send: true }
          : planSave(text, state.saved);
        if (!op) continue;
        set({ phase: 'saving', error: null });
        try {
          const result = await save(op);
          wroteOnce = true;
          set({ saved: op.kind === 'delete' ? '' : op.body });
          waiter?.resolve(result);
        } catch (error) {
          set({ phase: 'error', error, sending: false });
          onFailed?.(state.text, error);
          waiter?.reject(error);
          // A send queued behind the failed write fails with it: sending
          // after a write that did not land would email a note the server
          // does not hold.
          takeWaiter()?.reject(error);
          return;
        }
      } while (again || sendWaiter);
    } finally {
      running = null;
    }
    settle({ sending: false });
  }

  function start(): Promise<void> {
    clearTimer();
    if (running) {
      again = true;
      return running;
    }
    if (!sendWaiter && !planSave(state.text, state.saved)) {
      if (state.phase === 'error' || state.phase === 'pending') settle({ error: null });
      return Promise.resolve();
    }
    // `drain` always awaits the write before it can finish, so `running` is
    // set before its `finally` clears it.
    running = drain();
    return running;
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    edit: (text) => {
      if (text === state.text) return;
      clearTimer();
      state = { ...state, text };
      // Typing over an error clears it: the pause that follows is the retry.
      // During a write the line keeps saying "Saving…" -- it is true.
      if (running) set({});
      else settle({ error: null });
      if (planSave(text, state.saved)) timer = setTimeout(() => void start(), delay);
    },
    flush: () => start(),
    send: () => {
      // A second press before the first went out is the same send.
      if (sendWaiter) return sendWaiter.promise;
      let resolve!: (r: R) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<R>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      sendWaiter = { promise, resolve, reject };
      set({ sending: true });
      void start();
      return promise;
    },
    unsynced: () => running !== null || planSave(state.text, state.saved) !== null,
  };
}
