// The React skin over `createAutosave`. Everything that decides anything is in
// autosave.ts, where a test can reach it; this file only wires the controller
// to a component's life and to the page's.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createAutosave, type SaveOp } from './autosave';

export function useAutosave<R>({
  initial,
  saved,
  save,
  onFailed,
  onSynced,
}: {
  initial: string;
  saved: string;
  save: (op: SaveOp) => Promise<R>;
  onFailed: (text: string) => void;
  onSynced: () => void;
}) {
  // The latest callbacks without rebuilding the controller: they close over
  // mutations and props that are new objects on every render. Read through
  // refs, they still reach the page after this editor has unmounted -- which
  // is exactly when a failed last write needs to be heard.
  const latest = useRef({ save, onFailed, onSynced });
  latest.current = { save, onFailed, onSynced };
  const [ctl] = useState(() =>
    createAutosave<R>({
      initial,
      saved,
      save: (op) => latest.current.save(op),
      onFailed: (text) => latest.current.onFailed(text),
      onSynced: () => latest.current.onSynced(),
    }),
  );
  const snapshot = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot);

  useEffect(() => {
    // Opened on words the server never got (a write that failed after the
    // editor was gone): try again straight away rather than after a keystroke.
    if (ctl.unsynced()) void ctl.flush();

    // Leaving the screen writes: closing the tab, switching to another app on
    // a phone (which may kill the tab later without another word), and the
    // editor going away because another day was picked. If that write never
    // lands, the journal the editor keeps still has the words.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!ctl.unsynced()) return;
      void ctl.flush();
      // The browser's own "leave the page?" holds the tab open long enough for
      // that write to land. It only shows in the second and a half after a
      // keystroke, which is the only time there is anything to lose.
      e.preventDefault();
      e.returnValue = '';
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') void ctl.flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onHide);
      // Unmounting is not cancelling: the day that was open gets its words.
      void ctl.flush();
    };
  }, [ctl]);

  return { ...snapshot, edit: ctl.edit, flush: ctl.flush, send: ctl.send };
}
