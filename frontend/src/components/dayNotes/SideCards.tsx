// Beside the editor (under it on a phone): what the AI has learned from all
// the notes, and the notes themselves as a way back to any day.

import { useState } from 'react';
import { useDayNoteInsights, type DayNote } from '../../api/dayNotes';
import { useT } from '../../lib/i18n';
import { plural } from '../../lib/i18n/core';
import { shortDate, weekdayName } from '../../lib/dayNotes/days';
import { formatSpan, formatTakings, learnedRows } from '../../lib/dayNotes/insight';
import { Card } from '../Card';
import { Icon } from './icons';
import { InsightChip } from './NoteEditor';

/** How many notes the list shows at first, and adds per "Show more". */
const PAGE = 10;

/**
 * The summary the planner is given, shown to the manager so it is not a black
 * box. Nothing at all while it loads or if the server has no summary to give
 * (an older server): the notes work without it.
 */
export function LearnedCard() {
  const t = useT();
  const summary = useDayNoteInsights();
  if (!summary.data) return null;
  const s = summary.data;
  const rows = learnedRows(s);

  return (
    <Card
      title={
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-gray-900">
          <Icon name="sparkle" className="h-4 w-4 text-brand-300" />
          {t('dayNotes.learned.title')}
        </h2>
      }
      actions={
        s.learning_enabled && rows.length > 0 ? (
          <span className="shrink-0 text-xs text-gray-500">
            {plural(s.notes_read, 'dayNotes.learned.read.one', 'dayNotes.learned.read.other')}
          </span>
        ) : undefined
      }
    >
      {!s.learning_enabled ? (
        <p className="text-sm text-gray-500">{t('dayNotes.learned.off')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">{t('dayNotes.learned.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.weekday} className="flex gap-3">
              <span className="w-9 shrink-0 pt-0.5 text-sm font-semibold text-gray-900 first-letter:uppercase">
                <span aria-hidden="true">{weekdayName(r.weekday, 'short')}</span>
                <span className="sr-only">{weekdayName(r.weekday, 'long')}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800">
                  {r.revenue != null && (
                    <span className="font-medium tabular-nums">
                      {t('dayNotes.learned.revenue', { amount: formatTakings(r.revenue) })}
                      {' · '}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">
                    {plural(r.notes, 'dayNotes.learned.read.one', 'dayNotes.learned.read.other')}
                  </span>
                </p>
                {(r.busy.length > 0 || r.short.length > 0 || r.closed > 0) && (
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {r.busy.map((span) => (
                      <li key={`b${span.start}`}>
                        <InsightChip
                          kind="busy"
                          text={t('dayNotes.insight.busy', { span: formatSpan(span) })}
                        />
                      </li>
                    ))}
                    {r.short.map((span) => (
                      <li key={`s${span.start}`}>
                        <InsightChip
                          kind="short"
                          text={t('dayNotes.learned.short', { span: formatSpan(span) })}
                        />
                      </li>
                    ))}
                    {r.closed > 0 && (
                      <li>
                        <InsightChip
                          kind="closed"
                          text={plural(r.closed, 'dayNotes.learned.closed.one', 'dayNotes.learned.closed.other')}
                        />
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Every note, newest first; a click opens its day. Absent until there is one. */
export function RecentNotes({
  notes,
  day,
  today,
  onPick,
}: {
  notes: DayNote[];
  day: string;
  today: string;
  onPick: (key: string) => void;
}) {
  const t = useT();
  const [shown, setShown] = useState(PAGE);
  if (notes.length === 0) return null;

  return (
    <Card title={t('dayNotes.history.title')}>
      <ul className="-mx-2 space-y-0.5">
        {notes.slice(0, shown).map((n) => {
          const current = n.note_date === day;
          // Not from a reading that is still pending: that one is of other words.
          const revenue = n.insight && !n.insight.pending ? n.insight.revenue : null;
          return (
            <li key={n.note_date}>
              <button
                type="button"
                onClick={() => onPick(n.note_date)}
                aria-current={current ? 'date' : undefined}
                className={[
                  'w-full rounded-lg border-l-2 px-2 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 motion-reduce:transition-none',
                  current
                    ? 'border-brand-400 bg-brand-400/[0.1]'
                    : 'border-transparent hover:bg-white/[0.04]',
                ].join(' ')}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900 first-letter:uppercase">
                    {shortDate(n.note_date, today)}
                  </span>
                  {revenue != null && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium tabular-nums text-green-800">
                      <Icon name="revenue" className="h-3.5 w-3.5" />
                      <span className="sr-only">
                        {t('dayNotes.insight.revenue', { amount: formatTakings(revenue) })}
                      </span>
                      <span aria-hidden="true">{formatTakings(revenue)}</span>
                    </span>
                  )}
                </span>
                <span className="mt-0.5 line-clamp-2 text-xs text-gray-500">{n.body}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {notes.length > shown && (
        <button
          type="button"
          onClick={() => setShown((s) => s + PAGE)}
          className="mt-2 rounded px-1 py-1 text-sm font-medium text-brand-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          {t('dayNotes.history.more')}
        </button>
      )}
    </Card>
  );
}
