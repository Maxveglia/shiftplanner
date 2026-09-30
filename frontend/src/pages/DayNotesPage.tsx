// The manager's notes of each day: a week strip to pick the day, the note,
// and beside it what the AI has learned from all of them.
//
// Written to be used at closing time on a phone, so it says little: no Save
// button (it saves as you stop typing), no paragraph on who reads the notes
// (that is the Share button, with the count on it), and no empty headings.
// Saving never emails anyone -- Send does, so a fixed typo does not land in
// six inboxes.
//
// A write that fails is never silent: its words are kept on the device (see
// lib/dayNotes/journal), the day they belong to reopens with them, and while
// another day is open a line above the week says which note did not save.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useDayNoteReaders,
  useDayNotes,
  useDeleteDayNote,
  useSaveDayNote,
  type DayNote,
} from '../api/dayNotes';
import { useAuth } from '../auth/useAuth';
import { queryKeys } from '../api/keys';
import { getErrorMessage } from '../lib/api';
import { useT } from '../lib/i18n';
import { plural } from '../lib/i18n/core';
import { dayHeading, shortDate } from '../lib/dayNotes/days';
import { browserStore, createJournal, stillUnsaved, without } from '../lib/dayNotes/journal';
import { newlyRead, pendingDates, POLL_WINDOW_MS } from '../lib/dayNotes/insight';
import { dateKey } from '../lib/schedule/focus';
import { PageHeader } from './DashboardLayout';
import { Button } from '../components/Button';
import { Spinner, StateMessage } from '../components/StateMessage';
import { Icon } from '../components/dayNotes/icons';
import { NoteEditor } from '../components/dayNotes/NoteEditor';
import { ShareModal } from '../components/dayNotes/ShareModal';
import { LearnedCard, RecentNotes } from '../components/dayNotes/SideCards';
import { DatePickButton, WeekStrip, dayTabId } from '../components/dayNotes/WeekStrip';

const PANEL_ID = 'day-note-panel';

export function DayNotesPage() {
  const t = useT();
  const qc = useQueryClient();
  const today = dateKey(new Date());
  const [day, setDay] = useState(today);

  // Waiting for readings. Every write opens a window in which the list is
  // polled while any note in it is still being read; opening the page opens
  // one too, for readings that were already on their way.
  const [pollKick, setPollKick] = useState(0);
  const [pollOpen, setPollOpen] = useState(true);
  useEffect(() => {
    setPollOpen(true);
    const id = setTimeout(() => setPollOpen(false), POLL_WINDOW_MS);
    return () => clearTimeout(id);
  }, [pollKick]);
  const onSaved = useCallback(() => setPollKick((k) => k + 1), []);

  const notes = useDayNotes(pollOpen);
  const readers = useDayNoteReaders();

  // Words the server does not have, per day. Read from the journal ONCE, when
  // the list first arrives -- nothing is in flight then, so the list is the
  // server's own and an entry it agrees with is a write that landed after the
  // last tab stopped listening. After that it only changes when a write fails,
  // lands, is retried or is discarded, never by comparing with a list that may
  // be carrying a save still on its way.
  const { user } = useAuth();
  const journal = useMemo(() => createJournal(user?.id ?? 'anon', browserStore()), [user?.id]);
  const [unsaved, setUnsaved] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (unsaved !== null || !notes.data) return;
    const all = journal.readAll();
    const fresh = stillUnsaved(all, notes.data);
    Object.keys(all)
      .filter((date) => !(date in fresh))
      .forEach(journal.clear);
    setUnsaved(fresh);
  }, [unsaved, notes.data, journal]);
  const onFailed = useCallback(
    (date: string, text: string) => setUnsaved((u) => ({ ...(u ?? {}), [date]: text })),
    [],
  );
  const onSynced = useCallback(
    (date: string) => setUnsaved((u) => (u ? without(u, date) : u)),
    [],
  );

  // Another day's note that did not save, retried from the line that reports
  // it, without opening that day.
  const saveNote = useSaveDayNote();
  const deleteNote = useDeleteDayNote();
  const [retrying, setRetrying] = useState<string | null>(null);
  const retry = async (date: string, text: string) => {
    setRetrying(date);
    try {
      if (text.trim()) await saveNote.mutateAsync({ date, body: text, send: false });
      else await deleteNote.mutateAsync(date);
      journal.clear(date);
      onSynced(date);
      onSaved();
    } catch {
      // Still not saved: the line stays, and so do the words.
    } finally {
      setRetrying(null);
    }
  };
  const discard = (date: string) => {
    if (!window.confirm(t('dayNotes.unsaved.discardConfirm', { day: shortDate(date, today) }))) return;
    journal.clear(date);
    onSynced(date);
  };
  const failedElsewhere = Object.keys(unsaved ?? {})
    .filter((date) => date !== day)
    .sort()
    .reverse();

  // A reading that has just arrived changes the summary it feeds.
  const wasPending = useRef<string[]>([]);
  useEffect(() => {
    if (newlyRead(wasPending.current, notes.data).length > 0) {
      qc.invalidateQueries({ queryKey: queryKeys.dayNoteInsights });
    }
    wasPending.current = pendingDates(notes.data);
  }, [notes.data, qc]);

  const byDate = useMemo(() => {
    const map = new Map<string, DayNote>();
    notes.data?.forEach((n) => map.set(n.note_date, n));
    return map;
  }, [notes.data]);
  const noteDates = useMemo(() => new Set(byDate.keys()), [byDate]);
  const note = byDate.get(day) ?? null;
  const readerCount = readers.data ? readers.data.readers.length : null;

  // The dialog hands focus back to whatever opened it: the Share button, or
  // Send when there was nobody to send to.
  const [shareOpen, setShareOpen] = useState(false);
  const shareButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const openShare = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setShareOpen(true);
  }, []);
  const closeShare = useCallback(() => {
    setShareOpen(false);
    const back = returnFocus.current;
    // Send stays disabled when the box is empty, and a disabled button
    // cannot take focus: the Share button can, and it is where the dialog
    // lives.
    if (back?.isConnected && !(back as HTMLButtonElement).disabled) back.focus();
    else shareButton.current?.focus();
  }, []);

  return (
    <div>
      <PageHeader
        title={t('dayNotes.title')}
        actions={
          <button
            ref={shareButton}
            type="button"
            onClick={openShare}
            aria-haspopup="dialog"
            aria-label={
              readerCount
                ? plural(readerCount, 'dayNotes.share.label.one', 'dayNotes.share.label.other')
                : undefined
            }
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:border-white/25 hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 motion-reduce:transition-none"
          >
            <Icon name="people" />
            {t('dayNotes.share.button')}
            {readerCount ? (
              <span className="rounded-full bg-brand-400/15 px-1.5 text-xs tabular-nums text-brand-700">
                {readerCount}
              </span>
            ) : null}
          </button>
        }
      />

      {notes.isLoading || (notes.data && unsaved === null) ? (
        <Spinner />
      ) : notes.isError ? (
        <StateMessage
          tone="error"
          title={t('dayNotes.loadError')}
          description={getErrorMessage(notes.error)}
        />
      ) : (
        // items-start: the editor keeps its own height instead of stretching
        // to the side column's, which left a tall empty card under the box.
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section className="m-glass min-w-0 rounded-2xl border border-white/[0.08] p-3 sm:p-5">
            {failedElsewhere.map((date) => {
              const label = shortDate(date, today);
              return (
                <div
                  key={date}
                  role="alert"
                  className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-red-400/30 bg-red-50 px-3 py-2 text-sm text-red-800"
                >
                  <Icon name="info" className="h-4 w-4" />
                  <span className="min-w-0 flex-1">{t('dayNotes.unsaved.line', { day: label })}</span>
                  <button
                    type="button"
                    onClick={() => void retry(date, unsaved![date])}
                    disabled={retrying !== null}
                    className="rounded px-1.5 py-1 font-medium underline underline-offset-2 hover:text-red-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:no-underline disabled:opacity-70"
                  >
                    {retrying === date ? t('dayNotes.status.saving') : t('dayNotes.status.retry')}
                  </button>
                  <button
                    type="button"
                    onClick={() => discard(date)}
                    aria-label={t('dayNotes.unsaved.discard', { day: label })}
                    className="flex h-7 w-7 items-center justify-center rounded text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </div>
              );
            })}

            <WeekStrip
              day={day}
              today={today}
              noteDates={noteDates}
              panelId={PANEL_ID}
              onSelect={setDay}
            />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900 first-letter:uppercase">
                {dayHeading(day, today)}
              </h2>
              <div className="flex items-center gap-2">
                {day !== today && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setDay(today)}>
                    {t('dayNotes.today')}
                  </Button>
                )}
                <DatePickButton day={day} onPick={setDay} />
              </div>
            </div>

            <div role="tabpanel" id={PANEL_ID} aria-labelledby={dayTabId(day)} className="mt-3">
              <NoteEditor
                // Remounted per day: it starts from that day's saved text, and
                // unmounting is what writes the day being left.
                key={day}
                day={day}
                note={note}
                initialText={unsaved?.[day] ?? note?.body ?? ''}
                journal={journal}
                readerCount={readerCount}
                reading={pollOpen && !!note?.insight?.pending}
                onShare={openShare}
                onSaved={onSaved}
                onFailed={onFailed}
                onSynced={onSynced}
              />
            </div>
          </section>

          <div className="min-w-0 space-y-6">
            <LearnedCard />
            <RecentNotes notes={notes.data ?? []} day={day} today={today} onPick={setDay} />
          </div>
        </div>
      )}

      <ShareModal open={shareOpen} onClose={closeShare} />
    </div>
  );
}
