// One day's note: the box, a line saying whether it is saved and sent, the
// Send button, and what the AI understood from it.
//
// Remounted per day by the page, so it always starts from that day's saved
// text -- or from words that never reached the server, which it then owes;
// the step away is what writes the last day's (see useAutosave). Every
// keystroke that leaves the box ahead of the server goes into the journal
// first, so a write that fails after the editor has gone loses nothing.

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  useDeleteDayNote,
  useSaveDayNote,
  type DayNote,
  type DayNoteSaved,
} from '../../api/dayNotes';
import { useT } from '../../lib/i18n';
import { plural } from '../../lib/i18n/core';
import { longDate, sentAtLabel } from '../../lib/dayNotes/days';
import { insightChips, type ChipKind } from '../../lib/dayNotes/insight';
import { planSave } from '../../lib/dayNotes/autosave';
import type { Journal } from '../../lib/dayNotes/journal';
import { useAutosave } from '../../lib/dayNotes/useAutosave';
import { Button } from '../Button';
import { FIELD_SKIN, fieldTone } from '../Input';
import { Icon } from './icons';

/** Tall enough to write in, never taller than most of the screen. */
const MAX_HEIGHT_VH = 0.6;

export function NoteEditor({
  day,
  note,
  initialText,
  journal,
  readerCount,
  reading,
  onShare,
  onSaved,
  onFailed,
  onSynced,
}: {
  day: string;
  note: DayNote | null;
  /** The note's text, or the unsaved words the page kept for this day. */
  initialText: string;
  journal: Journal;
  /** Null while the list of readers is loading. */
  readerCount: number | null;
  /** The note's reading is on its way and the page is still waiting for it. */
  reading: boolean;
  onShare: () => void;
  /** A write reached the server: the page starts waiting for its reading. */
  onSaved: () => void;
  /** A write failed; the page keeps `text` for this day and says so. */
  onFailed: (day: string, text: string) => void;
  /** The server holds what the box shows; whatever the page kept can go. */
  onSynced: (day: string) => void;
}) {
  const t = useT();
  const saveNote = useSaveDayNote();
  const deleteNote = useDeleteDayNote();
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const autosave = useAutosave<DayNoteSaved | null>({
    initial: initialText,
    saved: note?.body ?? '',
    save: async (op) => {
      let saved: DayNoteSaved | null = null;
      if (op.kind === 'delete') await deleteNote.mutateAsync(day);
      else saved = await saveNote.mutateAsync({ date: day, body: op.body, send: op.send });
      onSavedRef.current();
      return saved;
    },
    onFailed: (text) => {
      journal.write(day, text);
      onFailed(day, text);
    },
    onSynced: () => {
      journal.clear(day);
      onSynced(day);
    },
  });

  const [outcome, setOutcome] = useState<DayNoteSaved | null>(null);
  // Typed since the note was last emailed, in this sitting. `updated_at`
  // catches the rest once the write lands.
  const [touched, setTouched] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  // The box grows with the text instead of scrolling inside itself -- on
  // every change of text, and of width: a phone turned sideways rewraps the
  // same words into fewer lines.
  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, window.innerHeight * MAX_HEIGHT_VH)}px`;
  }, []);
  useLayoutEffect(fit, [autosave.text, fit]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    // Width only: setting the height fires the observer too, and reacting to
    // that would be a loop.
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  const hasText = autosave.text.trim() !== '';
  const noReaders = readerCount === 0;
  const sentAt = note?.sent_at ?? null;
  const unsent =
    sentAt != null &&
    (touched || (note != null && new Date(note.updated_at) > new Date(sentAt)));

  const send = () => {
    setOutcome(null);
    autosave
      .send()
      .then((saved) => {
        setOutcome(saved);
        setTouched(false);
      })
      // The failure is on the status line already, with its Retry.
      .catch(() => undefined);
  };

  const remove = () => {
    if (!window.confirm(t('dayNotes.deleteConfirm'))) return;
    setOutcome(null);
    autosave.edit('');
    void autosave.flush();
    // The bin goes away with the note; the box is where the hands are next.
    box.current?.focus();
  };

  // A reading still marked pending is of words the note no longer has (or of
  // none yet): never shown as if it were this text's.
  const chips = note?.insight?.pending ? [] : insightChips(note?.insight);

  return (
    <div>
      <textarea
        ref={box}
        value={autosave.text}
        onChange={(e) => {
          const text = e.target.value;
          // Into the journal before anything can go wrong with the write.
          if (planSave(text, autosave.saved)) journal.write(day, text);
          else journal.clear(day);
          autosave.edit(text);
          setTouched(true);
          setOutcome(null);
        }}
        placeholder={t('dayNotes.placeholder')}
        aria-label={longDate(day)}
        rows={6}
        maxLength={20000}
        className={`${FIELD_SKIN} ${fieldTone(false)} block w-full resize-none overflow-y-auto rounded-xl px-3.5 py-3 leading-relaxed`}
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="flex min-h-[1.25rem] min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
          {autosave.phase === 'saving' && <span>{t('dayNotes.status.saving')}</span>}
          {autosave.phase === 'saved' && (
            <span className="inline-flex items-center gap-1">
              <Icon name="check" className="h-3.5 w-3.5" />
              {t('dayNotes.status.saved')}
            </span>
          )}
          {autosave.phase === 'error' && (
            <span role="alert" className="inline-flex items-center gap-1.5 font-medium text-red-700">
              {t('dayNotes.status.error')}
              <button
                type="button"
                onClick={() => void autosave.flush()}
                className="rounded px-1 py-0.5 underline underline-offset-2 hover:text-red-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                {t('dayNotes.status.retry')}
              </button>
            </span>
          )}
          {sentAt && (
            <span>{t('dayNotes.status.sent', { when: sentAtLabel(sentAt, new Date()) })}</span>
          )}
          {unsent && <span className="font-medium text-amber-800">{t('dayNotes.status.unsent')}</span>}
        </p>

        <div className="ml-auto flex items-center gap-2">
          {(hasText || autosave.saved !== '') && (
            <button
              type="button"
              onClick={remove}
              aria-label={t('dayNotes.delete')}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 motion-reduce:transition-none"
            >
              <Icon name="trash" />
            </button>
          )}
          {/* With nobody to send to, the button is the way to fix that rather
              than a paragraph explaining it; the ellipsis says a dialog comes
              first. One element either way, so the dialog can hand focus back
              to it once there is somebody. */}
          <Button
            type="button"
            variant={noReaders ? 'secondary' : 'primary'}
            onClick={noReaders ? onShare : send}
            aria-haspopup={noReaders ? 'dialog' : undefined}
            disabled={!noReaders && (readerCount === null || !hasText || autosave.sending)}
          >
            <Icon name="send" />
            {noReaders
              ? t('dayNotes.sendSetup')
              : autosave.sending
                ? t('dayNotes.sending')
                : t('dayNotes.send')}
          </Button>
        </div>
      </div>

      {outcome && (
        <p
          role="status"
          className={[
            'mt-2 flex items-center gap-1.5 text-sm',
            outcome.mail_configured ? 'text-green-800' : 'text-amber-800',
          ].join(' ')}
        >
          <Icon name={outcome.mail_configured ? 'check' : 'info'} className="h-4 w-4" />
          {outcome.mail_configured
            ? plural(outcome.emailed, 'dayNotes.sent.one', 'dayNotes.sent.other')
            : t('dayNotes.sent.noMail')}
        </p>
      )}

      {reading ? (
        <p role="status" className="mt-4 flex items-center gap-2 text-xs text-gray-500">
          <svg
            className="h-3.5 w-3.5 animate-spin text-brand-400 motion-reduce:animate-none"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          {t('dayNotes.insight.reading')}
        </p>
      ) : (
        chips.length > 0 && (
          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <p
              id={`day-note-insight-${day}`}
              className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-500"
            >
              <Icon name="sparkle" className="h-3.5 w-3.5 text-brand-300" />
              {t('dayNotes.insight.title')}
            </p>
            <ul aria-labelledby={`day-note-insight-${day}`} className="flex flex-wrap gap-1.5">
              {chips.map((chip, i) => (
                <li key={i}>
                  <InsightChip kind={chip.kind} text={chip.text} />
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  );
}

/**
 * The tones only group the chips at a glance; the icon and the word each say
 * what a chip is on their own ("Busy 22:00–01:00" needs no colour to read).
 * Dark tints with light text, as the Badge's; blue and purple are written out
 * because the app's palette does not redefine them (Tailwind's 50/800 are a
 * pale chip with dark text).
 */
const CHIP_TONES: Record<ChipKind, string> = {
  revenue: 'bg-green-50 text-green-800 ring-green-200/70',
  customers: 'bg-white/[0.05] text-gray-700 ring-white/10',
  closed: 'bg-white/[0.05] text-gray-700 ring-white/10',
  busy: 'bg-amber-50 text-amber-900 ring-amber-200/70',
  quiet: 'bg-sky-400/[0.1] text-sky-300 ring-sky-400/25',
  short: 'bg-red-50 text-red-800 ring-red-200/70',
  over: 'bg-violet-400/[0.1] text-violet-300 ring-violet-400/25',
  event: 'bg-white/[0.05] text-gray-700 ring-white/10',
};

export function InsightChip({ kind, text }: { kind: ChipKind; text: string }) {
  return (
    <span
      className={[
        'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        CHIP_TONES[kind],
      ].join(' ')}
    >
      <Icon name={kind} className="h-3.5 w-3.5" />
      <span className="min-w-0 break-words">{text}</span>
    </span>
  );
}
