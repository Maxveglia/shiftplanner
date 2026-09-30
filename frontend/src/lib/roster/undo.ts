// The removals a manager can still take back, and how long they can take.
//
// WHY THIS IS A MODULE AND NOT COMPONENT STATE
//
// The removal happens on the Employees page, and the offer to undo it must not
// belong to that page. A manager who removes somebody and immediately clicks
// through to the Dashboard has not changed their mind — losing the offer
// because a component unmounted would be the product forgetting something the
// person still remembers. So the pending removals live here, outside the tree,
// and the bar that shows them is mounted once on the layout that survives every
// navigation inside the app.
//
// Nothing here is persisted. A reload, a closed tab or a crash ends the window
// and the removal simply stands — which is exactly what happens when the timer
// runs out with nobody watching, and is safe because the server already holds
// the truth: the row is marked, not destroyed, and an operator or a later
// feature can still bring it back. Persisting the offer would promise
// otherwise: an "Undo" restored from localStorage on Monday, for something
// removed on Friday from another machine, is a button that lies about how
// recent the decision was.
//
// One entry per employee. Removing three people offers three undos, oldest
// first, because a manager tidying up a roster removes several in a row and
// having the second offer eat the first is how the wrong person stays gone.

export interface PendingRemoval {
  /** The employee the server has marked as removed. */
  id: string;
  /** Their name, for the notice. Read once — the roster no longer lists them. */
  name: string;
  /** When the offer stops standing, as epoch ms. For the countdown, if wanted. */
  expiresAt: number;
}

/**
 * How long the offer stands.
 *
 * Long enough to notice a mistake and reach the button (the notice appears at
 * the other end of the screen from where the gesture happened), short enough
 * that it is gone before the manager's attention is somewhere else entirely.
 */
export const UNDO_WINDOW_MS = 8000;

let pending: PendingRemoval[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function emit(next: PendingRemoval[]): void {
  // A NEW array every time it changes, and the SAME one when it does not:
  // `useSyncExternalStore` compares snapshots by identity and re-renders
  // forever if handed a fresh array on every read.
  pending = next;
  listeners.forEach((fn) => fn());
}

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function drop(id: string): PendingRemoval | null {
  const found = pending.find((entry) => entry.id === id) ?? null;
  if (found === null) return null;
  clearTimer(id);
  emit(pending.filter((entry) => entry.id !== id));
  return found;
}

/** The offers currently standing, oldest first. */
export function getPending(): PendingRemoval[] {
  return pending;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Announce a removal the manager may still take back. */
export function offerUndo(id: string, name: string): void {
  clearTimer(id);
  const entry: PendingRemoval = { id, name, expiresAt: Date.now() + UNDO_WINDOW_MS };
  emit([...pending.filter((other) => other.id !== id), entry]);
  timers.set(
    id,
    setTimeout(() => {
      // Expiry is not a second event for anyone: the row was already gone from
      // the roster the moment the server answered. All that lapses is the offer.
      drop(id);
    }, UNDO_WINDOW_MS),
  );
}

/**
 * Take the offer off the list because it is being acted on.
 *
 * Returns the entry, or null if it had already lapsed — the caller uses that to
 * decide whether to send the restore at all, so a click landing on the same
 * millisecond the timer fires cannot send two.
 */
export function takeUndo(id: string): PendingRemoval | null {
  return drop(id);
}

/** The manager closing the notice: the removal stands, and they said so. */
export function dismissUndo(id: string): void {
  drop(id);
}

/** For tests, and for signing out — nothing offered to the last session. */
export function clearUndos(): void {
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
  emit([]);
}
