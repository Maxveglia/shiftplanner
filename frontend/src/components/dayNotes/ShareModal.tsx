// Who the notes are shared with: one list of addresses. Each is emailed when
// the manager presses Send, and one that is also a login here reads the notes
// in the app -- which is what the tag beside it says, so no paragraph has to.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useDayNoteReaders, useSetDayNoteReaders } from '../../api/dayNotes';
import { getErrorMessage } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { Badge } from '../Badge';
import { FIELD_SKIN, fieldTone } from '../Input';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { Spinner } from '../StateMessage';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function ShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const readers = useDayNoteReaders();
  const setReaders = useSetDayNoteReaders();
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const list = readers.data?.readers ?? [];

  // Straight into the box: opening this dialog is asking to add someone.
  // Keyed on `open` alone, so a page re-render (the notes poll) does not
  // yank focus back here from the list.
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const email = draft.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL.test(email)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (list.some((r) => r.email === email)) {
      setDraft('');
      return;
    }
    setReaders.mutate([...list.map((r) => r.email), email], { onSuccess: () => setDraft('') });
  };

  return (
    <Modal open={open} onClose={onClose} title={t('dayNotes.share.title')}>
      {readers.data && !readers.data.mail_configured && (
        <p className="mb-3 text-xs text-amber-800">{t('dayNotes.share.noMail')}</p>
      )}

      {/* noValidate: the browser's own bubble speaks the browser's language,
          not the one chosen here, and covers the list. The check below says
          the same thing in one line. */}
      <form onSubmit={add} noValidate className="flex gap-2">
        <input
          ref={input}
          type="email"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          placeholder={t('dayNotes.share.placeholder')}
          aria-label={t('dayNotes.share.email')}
          aria-invalid={invalid}
          aria-describedby={invalid ? 'day-note-share-invalid' : undefined}
          maxLength={254}
          className={[FIELD_SKIN, fieldTone(invalid), 'min-w-0 flex-1 rounded-xl px-3.5 py-2'].join(' ')}
        />
        <Button type="submit" variant="secondary" disabled={setReaders.isPending}>
          {t('dayNotes.share.add')}
        </Button>
      </form>
      {invalid && (
        <p id="day-note-share-invalid" className="mt-1 text-xs text-red-700">
          {t('dayNotes.share.invalid')}
        </p>
      )}
      {setReaders.isError && (
        <p className="mt-1 text-xs text-red-700">{getErrorMessage(setReaders.error)}</p>
      )}

      {readers.isLoading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">{t('dayNotes.share.empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/[0.06]">
          {list.map((r) => (
            <li key={r.email} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{r.email}</span>
              <Badge tone={r.has_login ? 'green' : 'gray'}>
                {r.has_login ? t('dayNotes.share.login') : t('dayNotes.share.emailOnly')}
              </Badge>
              <button
                type="button"
                aria-label={t('dayNotes.share.remove', { email: r.email })}
                disabled={setReaders.isPending}
                onClick={() => {
                  setReaders.mutate(list.filter((x) => x.email !== r.email).map((x) => x.email));
                  // The row and its button go; the box is the one place left to be.
                  input.current?.focus();
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-white/[0.06] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
