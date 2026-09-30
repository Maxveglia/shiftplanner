// "Your business looks like a bar. Is that right?" -- one line, asked once.
//
// The opening interview can leave a GUESS about the kind of business on the
// profile (`vertical_source: "inferred"`). A guess does nothing until a human
// confirms it, and since the profile panel went (PR #160) there was no screen
// left to confirm it on. This is that screen, cut down to what Max chose: a
// single discreet line under the header, not a card or a panel. Answering it
// declares the vertical, the server stops calling it a guess, and the line is
// gone for good -- `verticalToConfirm` only asks about an inferred one.
//
// Three states, all on the same line:
//
//   asking     the guess, [Yes] and [No, it is another kind].
//   choosing   the other kinds as buttons; picking one declares it. Esc or
//              [Cancel] goes back to asking, with focus on the "No" it left.
//   saving     every button refuses clicks; a failure says so in one sentence
//              and hands the buttons back.
//
// WHY `aria-disabled` AND NOT `disabled` while saving. A button that becomes
// disabled drops keyboard focus to <body>, so a manager who pressed Enter on
// "Yes" and got an error would have to Tab from the top of the page to try
// again. aria-disabled announces the same thing, looks the same, and keeps
// focus where they left it; the handlers do the refusing.

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useBusinessProfile, useUpdateBusinessProfile } from '../../api/profile';
import { getErrorMessage } from '../../lib/api';
import { verticalLabel } from '../../lib/format';
import { useT } from '../../lib/i18n';
import {
  otherVerticals,
  verticalToConfirm,
  type VerticalChoice,
} from '../../lib/onboarding/inferredVertical';

// 44 px tall at least, the touch target this line promises on a phone. The
// focus ring is the design system's, as on Button.
const BASE =
  'inline-flex min-h-[44px] max-w-full items-center justify-center rounded-full border px-4 py-2 text-left text-sm break-words focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-70';
// Outlined, not filled: the filled brand button on this screen is "Generate",
// and a one-word answer to a side question must not outshout it.
const YES = `${BASE} min-w-[4rem] border-brand-400/70 bg-white/[0.03] font-medium text-brand-700 hover:bg-brand-50 focus-visible:outline-brand-300`;
const QUIET = `${BASE} border-gray-400 bg-white/[0.03] text-gray-700 hover:bg-white/[0.06] focus-visible:outline-gray-400`;
const LINK =
  'inline-flex min-h-[44px] max-w-full items-center rounded-md px-2 text-sm text-gray-600 underline underline-offset-2 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 aria-disabled:cursor-not-allowed aria-disabled:opacity-70';

export function InferredVerticalPrompt() {
  const profile = useBusinessProfile();
  // Held here and not by the line: a successful save removes the line, and a
  // mutation's per-call callbacks do not fire once the component that made
  // the call has unmounted -- the announcement below would never be written.
  const update = useUpdateBusinessProfile();
  const guess = verticalToConfirm(profile.data);
  // Outlives the line on purpose: the question disappears the moment the
  // answer is saved, and a screen reader would otherwise hear nothing at all
  // about what just happened to the button it was on.
  const [announcement, setAnnouncement] = useState('');

  return (
    <>
      {guess && profile.data && (
        // Keyed by the guess: a new interview can replace it with another, and
        // "choosing" or an old error must not carry over to a different question.
        <Question
          key={guess.code}
          guess={guess}
          verticals={profile.data.verticals}
          update={update}
          onSaved={setAnnouncement}
        />
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

function Question({
  guess,
  verticals,
  update,
  onSaved,
}: {
  guess: VerticalChoice;
  verticals: VerticalChoice[];
  update: ReturnType<typeof useUpdateBusinessProfile>;
  onSaved: (announcement: string) => void;
}) {
  const t = useT();
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const chooseId = useId();
  const noRef = useRef<HTMLButtonElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  // Where focus goes after the next render: the options when they open, the
  // "No" they were opened from when they close. Never on first paint -- a line
  // that grabs focus when the dashboard loads would steal it from the page.
  const focusNext = useRef<'options' | 'no' | null>(null);

  useEffect(() => {
    if (focusNext.current === 'options') firstOptionRef.current?.focus();
    if (focusNext.current === 'no') noRef.current?.focus();
    focusNext.current = null;
  }, [choosing]);

  const saving = update.isPending;
  const savingCode = saving ? update.variables?.vertical : undefined;

  const declare = (choice: VerticalChoice) => {
    if (saving) return;
    setError(null);
    // The server marks whatever arrives here as `declared`, which is both what
    // lets it reach a calendar and what makes this line never come back.
    update.mutate(
      { vertical: choice.code },
      {
        onSuccess: () =>
          onSaved(t('onboarding.inferredVertical.saved', { label: verticalLabel(choice) })),
        onError: (err) =>
          setError(
            t('onboarding.inferredVertical.failed', { reason: getErrorMessage(err) }),
          ),
      },
    );
  };

  const open = () => {
    if (saving) return;
    setError(null);
    focusNext.current = 'options';
    setChoosing(true);
  };

  const close = () => {
    if (saving) return;
    setError(null);
    focusNext.current = 'no';
    setChoosing(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && choosing) {
      e.stopPropagation();
      close();
    }
  };

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={saving}
      onKeyDown={onKeyDown}
      className="sc-glass mb-4 min-w-0 rounded-2xl px-4 py-2 text-sm text-gray-800"
    >
      {/* The region's name is the kind of question, for someone landing on it
          from a landmark list; the sentence itself follows. */}
      <h2 id={titleId} className="sr-only">
        {t('onboarding.inferredVertical.label')}
      </h2>
      {!choosing ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 break-words">
            {t('onboarding.inferredVertical.question', { label: verticalLabel(guess) })}
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              className={YES}
              aria-disabled={saving || undefined}
              onClick={() => declare(guess)}
            >
              {t('onboarding.inferredVertical.yes')}
            </button>
            <button
              ref={noRef}
              type="button"
              className={QUIET}
              aria-disabled={saving || undefined}
              onClick={open}
            >
              {t('onboarding.inferredVertical.no')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <p id={chooseId} className="min-w-0 break-words">
            {t('onboarding.inferredVertical.choose')}
          </p>
          <div
            role="group"
            aria-labelledby={chooseId}
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            {otherVerticals(verticals, guess.code).map((v, i) => {
              const picked = savingCode === v.code;
              return (
                <button
                  key={v.code}
                  ref={i === 0 ? firstOptionRef : undefined}
                  type="button"
                  aria-pressed={picked}
                  aria-disabled={saving || undefined}
                  onClick={() => declare(v)}
                  // FirstRunPanel's pill, grown to a thumb's width.
                  className={`${BASE} ${
                    picked
                      ? 'border-brand-400/70 bg-brand-50 font-medium text-brand-700 focus-visible:outline-brand-300'
                      : 'border-gray-400 bg-white/[0.03] text-gray-700 hover:bg-white/[0.06] focus-visible:outline-gray-400'
                  }`}
                >
                  {verticalLabel(v)}
                </button>
              );
            })}
            <button
              type="button"
              className={LINK}
              aria-disabled={saving || undefined}
              onClick={close}
            >
              {t('onboarding.inferredVertical.cancel')}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 break-words text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
