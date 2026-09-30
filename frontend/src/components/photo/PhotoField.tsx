// The "Photo" part of a dialog -- the dish's, the stock product's: what it
// will show, and the buttons to add, change or remove it.
//
// Nothing is sent from here. A picked photo is reduced at once (shrinkPhoto.ts)
// and held, with its preview, until the dialog's Save -- which writes the
// thing and then its photo (StoreMenuPage, InventoryStockPage). Cancel leaves
// the photo as it was, like every other field of the dialog; and a new one,
// which has no address to put a photo on until it is saved, gets its photo
// the same way.
//
// One button opens the phone's own choice of camera or gallery: an image
// input without `capture`, which on iOS and Android offers both.
//
// The words are the caller's, under one prefix ("menu.photo",
// "inventory.photo"): a dish's photo is saved "with the dish", a product's
// "with the product", and what having none means is not the same for both.

import { useId, useRef, useState } from 'react';
import { Button } from '../Button';
import { useT } from '../../lib/i18n';
import {
  photoNote,
  shownPhoto,
  type PhotoDraft,
  type PhotoFieldMessages,
  type PhotoProblem,
} from '../../lib/photo/photo';
import { shrinkPhoto } from '../../lib/photo/shrinkPhoto';
import { SquarePhoto } from './SquarePhoto';

export function PhotoField({
  messages,
  name,
  current,
  value,
  onChange,
  onPreparing,
  disabled = false,
}: {
  messages: PhotoFieldMessages;
  /** The name as typed so far, for the initials and the preview's alt. */
  name: string;
  /** The `photo_url` as saved; null for a new one or one without. */
  current: string | null;
  value: PhotoDraft;
  onChange: (value: PhotoDraft) => void;
  /** While a picked photo is being reduced: Save waits for it. */
  onPreparing: (preparing: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const labelId = useId();
  const noteId = useId();
  const pickId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<PhotoProblem | null>(null);

  const shown = shownPhoto(value, current);
  const hasPhoto = shown !== null;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setPreparing(true);
    onPreparing(true);
    try {
      const result = await shrinkPhoto(file);
      if (result.ok) onChange({ kind: 'new', blob: result.blob, preview: result.preview });
      else setProblem(result.problem);
    } finally {
      setPreparing(false);
      onPreparing(false);
    }
  };

  const remove = () => {
    setProblem(null);
    onChange({ kind: 'none' });
    // This button goes with the photo, and the focus must not go with it:
    // Safari sends no focusout for a removed element, so the dialog's trap
    // never hears of it and Tab and Escape stop reaching the dialog. The
    // photo button stays, and says "add" now.
    requestAnimationFrame(() => document.getElementById(pickId)?.focus());
  };

  const note = t(`${messages}.${photoNote(problem, value, current)}`);

  return (
    <div role="group" aria-labelledby={labelId}>
      <p id={labelId} className="text-sm font-medium text-gray-700">
        {t(`${messages}.label`)}
      </p>
      <div className="mt-2 flex items-center gap-4">
        <SquarePhoto
          name={name.trim() || '·'}
          url={shown}
          size="preview"
          alt={hasPhoto ? t(`${messages}.alt`, { name: name.trim() }) : ''}
        />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* Out of sight and out of the Tab order: the button below is the
              control, and says what pressing it does. */}
          <input
            ref={input}
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared, so picking the same file again still counts.
              e.target.value = '';
              void pick(file);
            }}
          />
          <Button
            id={pickId}
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={disabled || preparing}
            aria-describedby={noteId}
            onClick={() => input.current?.click()}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
              <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h1.6l1.2-1.7h4.4l1.2 1.7H15A1.5 1.5 0 0 1 16.5 7v7.5A1.5 1.5 0 0 1 15 16H5a1.5 1.5 0 0 1-1.5-1.5z" />
              <circle cx="10" cy="10.5" r="2.8" />
            </svg>
            {preparing ? t(`${messages}.preparing`) : hasPhoto ? t(`${messages}.change`) : t(`${messages}.add`)}
          </Button>
          {hasPhoto && (
            <Button type="button" variant="ghost" className="min-h-11" disabled={disabled || preparing} onClick={remove}>
              {t(`${messages}.remove`)}
            </Button>
          )}
        </div>
      </div>
      <p
        id={noteId}
        // Said when it changes: a photo that could not be read is otherwise
        // a button press that did nothing.
        aria-live="polite"
        className={['mt-2 text-xs', problem ? 'font-medium text-red-300' : 'text-gray-500'].join(' ')}
      >
        {note}
      </p>
    </div>
  );
}
