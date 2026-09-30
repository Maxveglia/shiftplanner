// The manager's day notes, for an employee the manager gave access to.
//
// Renders nothing at all for everybody else: the server answers `can_read:
// false` rather than an error, and a card saying "you may not read this"
// would only advertise that there is something to read.

import { useState } from 'react';
import { useDayNoteFeed } from '../../api/dayNotes';
import { useT } from '../../lib/i18n';
import { longDate } from '../../lib/dayNotes/days';

/** How many notes show before "Show earlier notes". */
const FIRST = 5;

export function DayNotesCard() {
  const t = useT();
  const feed = useDayNoteFeed();
  const [all, setAll] = useState(false);

  if (!feed.data?.can_read) return null;
  const notes = feed.data.notes;
  const shown = all ? notes : notes.slice(0, FIRST);

  return (
    <section className="sc-glass rounded-3xl px-5 py-5">
      <h2 className="text-base font-semibold text-gray-900">{t('dayNotes.feed.title')}</h2>
      {notes.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">{t('dayNotes.feed.empty')}</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {shown.map((n) => (
            <li key={n.note_date}>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {longDate(n.note_date)}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      {!all && notes.length > FIRST && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-3 rounded text-sm font-medium text-brand-300 underline-offset-4 hover:text-brand-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
        >
          {t('dayNotes.feed.more')}
        </button>
      )}
    </section>
  );
}
