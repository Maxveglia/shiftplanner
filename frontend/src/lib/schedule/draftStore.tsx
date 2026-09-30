// Where the draft calendar lives between screens -- and now between reloads.
//
// It used to live in `DashboardPage`'s own state, which meant React owned its
// lifetime: opening Employees to check something unmounted the page and took
// the calendar with it. So it moved one level up, into `DashboardLayout`,
// which stays mounted across every screen the manager can reach from the
// sidebar: a plain Map held in a ref, read back when the page remounts.
//
// That survived navigation but not a reload: a refresh, or the browser
// discarding the tab, started from an empty calendar and threw away every
// refinement that produced it. Now the Map is mirrored to localStorage under
// the workspace it belongs to, and hydrated from there when the layout mounts.
// The manager comes back to exactly the screen they left.
//
// WHAT IS WRITTEN AND WHEN. Every write to the store schedules one save, a
// moment later, so typing a brief is one write per pause rather than one per
// keystroke; and the page flushes on `pagehide`, so a reload straight after an
// edit still keeps the edit. The encoding, and what gets dropped when the
// browser refuses the write, are in ./draftPersist and tested there.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { decodeDraft, draftStorageKey, writeDraft } from './draftPersist';

/** How long after the last change the draft is written. */
const SAVE_DELAY_MS = 250;

class Store {
  private readonly map = new Map<string, unknown>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(private readonly storageKey: string | null) {
    if (!storageKey) return;
    try {
      const entries = decodeDraft(localStorage.getItem(storageKey));
      if (entries) for (const [k, v] of entries) this.map.set(k, v);
    } catch {
      // Storage disabled or unreadable: start empty, exactly as before.
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): unknown {
    return this.map.get(key);
  }

  set(key: string, value: unknown): void {
    if (this.map.get(key) === value) return;
    this.map.set(key, value);
    this.dirty = true;
    if (!this.storageKey) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  /** Write now, whatever is pending. Safe to call when nothing is. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty || !this.storageKey) return;
    this.dirty = false;
    try {
      const outcome = writeDraft(localStorage, this.storageKey, this.map);
      if (outcome === 'failed') {
        console.warn('ShiftPlanner: the draft could not be saved in this browser.');
      }
    } catch {
      // Storage disabled entirely: the draft stays in memory, as before.
    }
  }
}

const DraftContext = createContext<Store | null>(null);

/**
 * @param scope What the draft belongs to -- the workspace id. Without one
 *   (no user yet, a test) the store works in memory only and writes nothing.
 */
export function DraftProvider({
  scope,
  children,
}: {
  scope?: string | null;
  children: ReactNode;
}) {
  // Built once -- lazily: `useRef(new Store(...))` read and decoded the saved
  // draft from localStorage on every render and threw it away. The layout
  // remounts this provider (a React `key`) when the workspace changes, so a
  // store never outlives the workspace it was read for and a re-login never
  // sees the previous manager's draft.
  const [store] = useState(() => new Store(scope ? draftStorageKey(scope) : null));

  // A reload, a closed tab, a phone switching apps: the last edit goes to disk
  // before the page does. `pagehide` fires in every one of those cases where
  // `beforeunload` does not.
  useEffect(() => {
    const flush = () => store.flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      store.flush();
    };
  }, [store]);

  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>;
}

/**
 * `useState`, except the value is remembered across unmounts of this screen
 * and across reloads of the page.
 *
 * Deliberately the same signature as `useState` -- including the lazy initial
 * value and the updater form -- so adopting it is a one-line change per piece
 * of state and no call site has to be restructured.
 *
 * Without a provider it degrades to plain `useState`: the calendar stops
 * surviving navigation, but nothing breaks. That matters because this hook is
 * reachable from tests and from any future screen mounted outside the layout.
 */
export function useDraftState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const store = useContext(DraftContext);

  const [value, setValue] = useState<T>(() => {
    if (store?.has(key)) return store.get(key) as T;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  // Mirrored in an effect rather than inside the state updater: an updater has
  // to be a pure function of the previous state, and React calls it twice in
  // StrictMode. Writing through here keeps the store a consequence of the
  // rendered value instead of a side effect of asking for it.
  useEffect(() => {
    store?.set(key, value);
  }, [store, key, value]);

  return [value, setValue];
}
