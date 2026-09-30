// The notice that says what just happened, and offers to take it back.
//
// It is mounted on the dashboard layout, not on the Employees page, and that is
// the only interesting thing about where it lives: the manager removes somebody
// and then keeps working, and an offer that disappeared because they clicked
// through to the calendar would be the product forgetting faster than they do.
// The layout survives every navigation inside the app, so the offer does too.
//
// It replaces a `window.confirm()`. The old question was asked before every
// removal, including the hundreds that were meant — which is how a person
// learns to answer it without reading. This asks nothing and shows what it did.

import { useState, useSyncExternalStore } from 'react';
import { useRestoreEmployee } from '../api/employees';
import { useT } from '../lib/i18n';
import {
  dismissUndo,
  getPending,
  offerUndo,
  subscribe,
  takeUndo,
} from '../lib/roster/undo';

export function UndoBar() {
  const t = useT();
  const restore = useRestoreEmployee();
  const pending = useSyncExternalStore(subscribe, getPending, getPending);
  // Ids whose restore came back an error. The offer is put back when that
  // happens, so the button is still there; this only adds the reason.
  const [failed, setFailed] = useState<string[]>([]);

  if (pending.length === 0) return null;

  const undo = (id: string, name: string) => {
    // Taking the entry is what makes this safe to double-click: the second
    // call finds nothing, so only one restore is ever sent.
    const entry = takeUndo(id);
    if (entry === null) return;
    setFailed((ids) => ids.filter((other) => other !== id));
    restore.mutate(id, {
      onError: () => {
        setFailed((ids) => [...ids, id]);
        // Offer it again rather than swallowing the failure: the removal stands
        // on the server, so the manager has to be able to try once more.
        offerUndo(id, name);
      },
    });
  };

  return (
    <div
      // `status`, not `alert`: this is the outcome of something the manager
      // just did, so it is announced when the screen reader gets to it rather
      // than interrupting whatever they are reading.
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 p-4"
    >
      {pending.map((entry) => (
        <div
          key={entry.id}
          // Rises from the bottom edge on a spring (`m-toast-in`): it is news
          // about something just done, and should be seen arriving.
          className="m-toast-in m-glass-float pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-white/10 px-4 py-3 text-sm text-gray-900"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate">
              {t('people.employees.undo.removed', { name: entry.name })}
            </p>
            {failed.includes(entry.id) && (
              <p className="m-fade mt-0.5 text-xs text-red-300">
                {t('people.employees.undo.failed', { name: entry.name })}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => undo(entry.id, entry.name)}
            disabled={restore.isPending && restore.variables === entry.id}
            className="shrink-0 rounded-lg px-2 py-1 font-semibold text-brand-300 transition-colors hover:bg-white/[0.06] hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 disabled:opacity-60"
          >
            {restore.isPending && restore.variables === entry.id
              ? t('people.employees.undo.restoring')
              : t('people.employees.undo.action')}
          </button>
          <button
            type="button"
            onClick={() => dismissUndo(entry.id)}
            aria-label={t('people.employees.undo.dismiss')}
            className="shrink-0 rounded-lg px-2 py-1 text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
