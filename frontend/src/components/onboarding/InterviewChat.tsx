// Being asked instead of asked to write.
//
// The brief is the whole product, and many managers do not know what a good
// one contains. This is the other way in: a short conversation -- opening
// hours, closures, busy times, how many people on what hours -- one question
// at a time, that ends in a brief written in the manager's own words and put
// in front of them to check. Whatever they approve goes to the same place a
// typed brief goes: `onFinish(brief)`, and from there to Claude.
//
// It is Gemini on the free tier, so the conversation is about the business
// and never about a person, and the line under the box says so before the
// first question is asked. The server enforces the same rule on its side.
//
// The transcript itself is not stored: closing the chat, or reloading,
// starts over. What the manager approves at the end is kept on their
// business profile by the caller; the conversation that led to it is not.
//
// It looks like a chat because it is one: the question arrives typed out,
// three dots breathe while the next is thought of, and there is a
// microphone for a manager who would rather say it than type it.
//
// Three of the questions are answered by a form instead of by typing, because
// their answers are tables or lists and a chat is bad at both. The first is
// when the business is open, each day of the week, as a bar to drag rather
// than seven times to type (see OpeningHoursGrid). The second is which month
// the first calendar is for, as a list of months (see lib/onboarding/
// firstMonth) -- the current one offered as what is left of it. Both are
// asked here, before the model says anything. The third is who works here and on what contract hours,
// which the MODEL asks when it is ready to -- the turn comes back flagged
// `form: "roster"` and a table appears under it (see RosterForm).
//
// Either way what the form produces is written into the transcript as the
// manager's own message, in their language, so the model reads it like any
// other answer and carries it into the brief. The week is handed to the
// caller as numbers as well, for the profile to keep. The month is the
// exception: the model is told to leave it OUT of the brief, which is kept
// for good, and it reaches the caller only as `month`.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AssistantAvatar, ThinkingDots } from '../AssistantAvatar';
import { interviewTurn, type InterviewMessage } from '../../api/interview';
import { Button } from '../Button';
import { FIELD_SKIN, fieldTone } from '../Input';
import { OpeningHoursGrid } from './OpeningHoursGrid';
import { RosterForm } from './RosterForm';
import { getErrorMessage } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { composeFirstRunBrief } from '../../lib/onboarding/firstRun';
import {
  defaultWeek,
  isAllClosed,
  toDaySchedules,
  type WeekHours,
} from '../../lib/onboarding/weekHours';
import {
  composeMonthAnswer,
  isPartial,
  monthChoices,
  monthLabel,
  pickOf,
  type FirstMonthPick,
  type MonthChoice,
} from '../../lib/onboarding/firstMonth';
import {
  composeRosterAnswer,
  entriesFor,
  type RosterEntry,
} from '../../lib/onboarding/roster';
import { weekdayName } from '../../lib/schedule/spec';
import { useSpeechInput } from '../../lib/speech';

/** A form asked inside the conversation: a pane of glass among the bubbles. */
const FORM_BUBBLE =
  'chat-in rounded-2xl bg-white/[0.04] p-3 ring-1 ring-inset ring-white/[0.08] sm:p-4';

interface InterviewChatProps {
  /**
   * The brief the manager approved, the week's opening hours as the form had
   * them, and the month the first calendar is for. The caller generates that
   * month from the brief -- from today on, if it is this one -- and keeps the
   * week.
   */
  onFinish: (brief: string, week: WeekHours | null, month: FirstMonthPick | null) => void;
  /** Back to whatever was on screen before, with nothing kept. */
  onCancel: () => void;
  /** True while the caller is building the calendar from the brief. */
  isBuilding: boolean;
  /** What the build button says meanwhile, when it is doing something other than building. */
  buildingLabel?: string;
  /**
   * What stands in for the buttons under the brief while it is being used.
   * A greyed-out button is all a wait looks like otherwise, and on a wait of
   * half a minute that reads as a page that has stopped.
   */
  buildingPanel?: ReactNode;
  /** What the way out is called. "Back" inside the dashboard; "skip" on the welcome screen. */
  cancelLabel?: string;
  /**
   * Be the whole screen rather than a card on one. The welcome screen is
   * nothing but this conversation, and it never scrolls: the caller gives
   * this component whatever height is left under its header, the title and
   * the box to type in stay put, and only the transcript scrolls -- and only
   * once it no longer fits. Short windows get tighter spacing (see
   * WelcomePage for the two steps).
   */
  fullPage?: boolean;
}

export function InterviewChat({
  onFinish,
  onCancel,
  isBuilding,
  buildingLabel,
  buildingPanel,
  cancelLabel,
  fullPage = false,
}: InterviewChatProps) {
  const t = useT();
  const { language } = useLanguage();
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  // The opening-hours form, shown until the manager confirms it. Its answer
  // becomes the first two lines of the transcript and is kept as `week`.
  const [askingHours, setAskingHours] = useState(true);
  const [week, setWeek] = useState<WeekHours>(defaultWeek);
  // Then the month, as a list. Picking one answers it: there is nothing to
  // confirm about a single choice. `today` is read once, so the list cannot
  // shift under a manager who leaves the tab open past midnight.
  const [askingMonth, setAskingMonth] = useState(false);
  const [today] = useState(() => new Date());
  const choices = useMemo(() => monthChoices(today), [today]);
  const [month, setMonth] = useState<FirstMonthPick | null>(null);
  // The table under the model's question, while that question is the one on
  // screen. It is cleared the moment anything is sent -- by the table or by
  // hand -- because a form belongs to the question it was asked under.
  const [askingRoster, setAskingRoster] = useState(false);
  // Filled in when the question arrives, from the headcount the manager gave
  // a question earlier: a row each, waiting for names.
  const [roster, setRoster] = useState<RosterEntry[]>(() => entriesFor(null));
  // The rows are laid out once per asking. Re-deriving them on every render
  // would wipe out the names as they are typed.
  const rosterLaidOut = useRef(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  // Messages before this index were on screen already and are not typed out
  // again -- a manager who backs out of the brief to "keep talking" should
  // not watch the whole conversation replay itself.
  const [revealFrom, setRevealFrom] = useState(0);
  const scrollToEnd = useCallback(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  // Spoken words go where typed ones go: into the box, to be sent by hand.
  const speech = useSpeechInput(language, (heard) => {
    setDraft((d) => (d ? d + ' ' + heard : heard));
    inputRef.current?.focus();
  });

  const ask = useCallback(
    async (history: InterviewMessage[], finish = false) => {
      setBusy(true);
      setError(null);
      try {
        const turn = await interviewTurn(history, language, finish);
        const next = turn.reply
          ? [...history, { role: 'assistant' as const, text: turn.reply }]
          : history;
        setMessages(next);
        // A form only makes sense under a question that is still on screen,
        // and only one we serve: `form` is a code from the server, never
        // something read out of the words of the reply.
        const wantsRoster = !turn.done && turn.form === 'roster';
        setAskingRoster(wantsRoster);
        if (wantsRoster && !rosterLaidOut.current) {
          rosterLaidOut.current = true;
          setRoster(entriesFor(turn.form_people ?? null));
        }
        if (turn.done) setBrief(turn.brief ?? '');
      } catch (e) {
        setError(getErrorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [language],
  );

  // The first two questions are forms; the model's turn comes once both are
  // answered, with those answers already in the transcript.
  const confirmHours = () => {
    if (!askingHours) return;
    const said = composeFirstRunBrief(
      { days: toDaySchedules(week), peakStaff: null, splitShift: null },
      weekdayName,
    );
    const history: InterviewMessage[] = [
      { role: 'assistant', text: t('interview.hours.question') },
      { role: 'manager', text: said },
    ];
    // Both lines were on screen already, one as the question and one as
    // the form, and the month's question comes from us too: nothing is
    // typed out until the model speaks.
    setRevealFrom(history.length + 2);
    setMessages(history);
    setAskingHours(false);
    setAskingMonth(true);
  };

  const chooseMonth = (choice: MonthChoice) => {
    if (opened.current || busy) return;
    opened.current = true;
    const history: InterviewMessage[] = [
      ...messages,
      { role: 'assistant', text: t('interview.month.question') },
      { role: 'manager', text: composeMonthAnswer(choice, today) },
    ];
    setRevealFrom(history.length);
    setMessages(history);
    setMonth(pickOf(choice, today));
    setAskingMonth(false);
    void ask(history);
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
    if (!busy && brief === null && !askingHours && !askingMonth) inputRef.current?.focus();
  }, [messages, busy, brief, askingHours, askingMonth]);

  // The wait under the brief, brought into view as it appears. In a short
  // window the brief and the wait do not both fit, and it is the wait the
  // manager is watching now -- the brief can no longer be edited anyway.
  // The transcript has just been squeezed to make room, so it is taken back
  // to its last line too.
  const showingPanel = isBuilding && !!buildingPanel;
  useEffect(() => {
    if (!showingPanel) return;
    endRef.current?.scrollIntoView({ block: 'nearest' });
    panelRef.current?.scrollIntoView({ block: 'nearest' });
  }, [showingPanel]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setAskingRoster(false);
    void ask([...messages, { role: 'manager', text }]);
  };

  /**
   * The table, sent as the manager's own words.
   *
   * Not a payload of its own: the transcript is the only state this
   * conversation has, so the answer has to be a message in it like any other.
   */
  const sendRoster = () => {
    if (busy) return;
    const said = composeRosterAnswer(roster);
    if (!said) return;
    setAskingRoster(false);
    void ask([...messages, { role: 'manager', text: said }]);
  };

  const finishNow = () => {
    if (busy) return;
    void ask(messages, true);
  };

  // Going back to the conversation from the brief: everything so far is old
  // news and stays put, only what comes next animates.
  const keepTalking = () => {
    setRevealFrom(messages.length);
    setBrief(null);
  };

  return (
    <div
      className={
        fullPage
          ? // Three rows: the title, the transcript, and what is under it
            // (the box to type in, or the brief). The last is given its full
            // height first and the transcript takes what is left, so when
            // the window is short it is the transcript that scrolls. The
            // transcript keeps 4rem even then: less would not hold its own
            // padding. With room to spare every row is its content's height.
            'grid min-h-0 grid-rows-[auto_minmax(4rem,1fr)_minmax(0,auto)]'
          : 'sc-hero rounded-2xl p-5'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2
          className={
            fullPage
              ? 'text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl [@media(max-height:760px)]:text-xl'
              : 'text-base font-semibold text-gray-900'
          }
        >
          {t('interview.title')}
        </h2>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isBuilding}>
          {cancelLabel ?? t('interview.cancel')}
        </Button>
      </div>

      <div
        className={[
          // A well in the card: the conversation sits lower than the glass.
          'mt-4 space-y-3 overflow-y-auto rounded-2xl border border-white/[0.06] bg-black/25 p-4',
          // On the welcome page it is the one thing that scrolls, and the
          // scroll-padding brings its own padding along when the newest line
          // is scrolled to: the end of the well, not a line cut at its edge.
          fullPage
            ? 'min-h-0 scroll-pb-4 [@media(max-height:760px)]:mt-3 [@media(max-height:760px)]:scroll-pb-3 [@media(max-height:760px)]:space-y-2 [@media(max-height:760px)]:p-3'
            : 'max-h-80',
        ].join(' ')}
      >
        {askingHours && (
          <Bubble
            role="assistant"
            text={t('interview.hours.question')}
            reveal={!isBuilding}
            onGrow={scrollToEnd}
            fitWindow={fullPage}
          />
        )}
        {messages.map((m, i) => (
          <Bubble
            key={i}
            role={m.role}
            text={m.text}
            // Only the newest question is typed out; the rest are already
            // read, and replaying them would make scrolling up feel broken.
            reveal={m.role === 'assistant' && i === messages.length - 1 && i >= revealFrom}
            onGrow={scrollToEnd}
            fitWindow={fullPage}
          />
        ))}
        {askingHours && (
          <div
            className={[
              FORM_BUBBLE,
              fullPage ? '[@media(max-height:760px)]:p-3' : '',
            ].join(' ')}
          >
            <OpeningHoursGrid
              week={week}
              onChange={setWeek}
              disabled={isBuilding}
              fitWindow={fullPage}
            />
            {/* How the bars behave, a word if every day is shut, and the
                button. Beside each other on the welcome page in a short
                window, wide enough for both: stacked, they cost the height
                that keeps the whole week and its button on screen. */}
            <div
              className={[
                'mt-2 items-end justify-between gap-x-4',
                fullPage ? '[@media(min-width:640px)_and_(max-height:920px)]:flex' : '',
              ].join(' ')}
            >
              <div className="min-w-0">
                <p className="text-xs text-gray-500">{t('interview.hours.help')}</p>
                {isAllClosed(week) && (
                  <p className="mt-2 text-xs text-amber-700">{t('interview.hours.allClosed')}</p>
                )}
              </div>
              <div
                className={[
                  'mt-3 flex shrink-0 justify-end',
                  fullPage ? '[@media(min-width:640px)_and_(max-height:920px)]:mt-0' : '',
                ].join(' ')}
              >
                <Button onClick={confirmHours} disabled={isBuilding || isAllClosed(week)}>
                  {t('interview.hours.continue')}
                </Button>
              </div>
            </div>
          </div>
        )}
        {askingMonth && (
          <>
            <Bubble
              role="assistant"
              text={t('interview.month.question')}
              reveal={!isBuilding}
              onGrow={scrollToEnd}
              fitWindow={fullPage}
            />
            <div className={FORM_BUBBLE}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {choices.map((c) => (
                  <button
                    key={c.month}
                    type="button"
                    onClick={() => chooseMonth(c)}
                    disabled={isBuilding || busy}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-gray-800 transition hover:border-brand-400/60 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 disabled:opacity-50 motion-reduce:transition-none"
                  >
                    <span className="block font-medium">{monthLabel(c, today)}</span>
                    {isPartial(c) && (
                      <span className="block text-xs text-gray-500">
                        {t('interview.month.rest', { from: c.fromDay, to: c.lastDay })}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {isPartial(choices[0]) && (
                <p className="mt-2 text-xs text-gray-500">{t('interview.month.help')}</p>
              )}
            </div>
          </>
        )}
        {askingRoster && !busy && brief === null && (
          <div className={FORM_BUBBLE}>
            <RosterForm
              entries={roster}
              onChange={setRoster}
              onDone={sendRoster}
              disabled={isBuilding}
            />
          </div>
        )}
        {busy && (
          <div className="chat-in flex items-end gap-2">
            <AssistantAvatar />
            <div className="flex items-center rounded-2xl rounded-bl-md bg-white/[0.06] px-4 py-3 ring-1 ring-inset ring-white/[0.08]">
              <ThinkingDots />
            </div>
          </div>
        )}
        {/* No gap above the scroll anchor on the welcome page: those 12px
            are part of what lets the whole week fit a short window. */}
        <div ref={endRef} className={fullPage ? '!mt-0' : undefined} />
      </div>

      <div
        className={
          fullPage
            ? // Its own scroll only as a last resort, when the transcript is
              // already down to its 4rem: the brief with the wait under it,
              // in a short window. The padding, taken back by the margin, is
              // room for the fields' focus rings, which a scroll box clips.
              '-mx-1.5 -mb-1.5 min-h-0 overflow-y-auto px-1.5 pb-1.5'
            : undefined
        }
      >
        {error && (
          <p className="mt-2 text-sm text-red-600">
            {error}{' '}
            <button
              type="button"
              className="underline"
              onClick={() => void ask(messages)}
            >
              {t('interview.retry')}
            </button>
          </p>
        )}

        {askingHours || askingMonth ? null : brief === null ? (
          <>
            <form
              className="mt-3 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  value={speech.listening ? speech.interim || draft : draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={busy || speech.listening}
                  placeholder={
                    speech.listening ? t('interview.voice.listening') : t('interview.placeholder')
                  }
                  className={`w-full rounded-full py-2.5 pl-4 pr-4 ${FIELD_SKIN} ${fieldTone(false)}`}
                />
              </div>
              {speech.supported && (
                <button
                  type="button"
                  onClick={speech.listening ? speech.stop : speech.start}
                  disabled={busy}
                  aria-pressed={speech.listening}
                  aria-label={
                    speech.listening ? t('interview.voice.stop') : t('interview.voice.start')
                  }
                  title={speech.listening ? t('interview.voice.stop') : t('interview.voice.start')}
                  className={[
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 motion-reduce:transition-none',
                    speech.listening
                      ? 'mic-pulse border-red-500 bg-red-500 text-white'
                      : 'border-white/15 bg-white/5 text-gray-700 hover:border-white/25 hover:bg-white/10 hover:text-gray-900',
                    busy ? 'opacity-50' : '',
                  ].join(' ')}
                >
                  <MicIcon />
                </button>
              )}
              <Button type="submit" disabled={busy || speech.listening || !draft.trim()}>
                {t('interview.send')}
              </Button>
            </form>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-gray-500">{t('interview.privacy')}</p>
              {messages.some((m) => m.role === 'manager') && (
                <button
                  type="button"
                  onClick={finishNow}
                  disabled={busy}
                  className="text-xs text-gray-500 underline hover:text-gray-700"
                >
                  {t('interview.finishNow')}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="chat-in mt-4">
            <p className="text-sm font-medium text-gray-900">{t('interview.brief.title')}</p>
            <p className="mt-0.5 text-xs text-gray-500">{t('interview.brief.help')}</p>
            <p className="mt-0.5 text-xs text-gray-500">{t('interview.brief.remembered')}</p>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={5}
              // Read-only once it is being used: what is typed now would be
              // shown as kept and silently not be.
              readOnly={isBuilding}
              className={`mt-2 w-full rounded-xl px-3 py-2 ${FIELD_SKIN} ${fieldTone(false)} read-only:bg-black/20 read-only:text-gray-500`}
            />
            {isBuilding && buildingPanel ? (
              <div ref={panelRef} className="mt-3">
                {buildingPanel}
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-3">
                <Button
                  onClick={() => onFinish(brief.trim(), week, month)}
                  disabled={isBuilding || !brief.trim()}
                >
                  {isBuilding ? (buildingLabel ?? t('interview.brief.building')) : t('interview.brief.use')}
                </Button>
                <button
                  type="button"
                  onClick={keepTalking}
                  disabled={isBuilding}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  {t('interview.brief.keepTalking')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

/** One line of the conversation. The newest question types itself out. */
function Bubble({
  role,
  text,
  reveal,
  onGrow,
  fitWindow = false,
}: {
  role: InterviewMessage['role'];
  text: string;
  reveal: boolean;
  onGrow: () => void;
  /** Set lines closer in a short window, on the page that must not scroll. */
  fitWindow?: boolean;
}) {
  const shown = useTypewriter(text, reveal, onGrow);
  const mine = role === 'manager';
  return (
    <div className={['chat-in flex items-end gap-2', mine ? 'justify-end' : ''].join(' ')}>
      {!mine && <AssistantAvatar />}
      <div
        className={[
          'max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          fitWindow ? '[@media(max-height:760px)]:py-2 [@media(max-height:760px)]:leading-snug' : '',
          // The manager's words in the brand, glowing like the sign-in's
          // button; the assistant's as glass with an edge.
          mine
            ? 'sc-self-bar rounded-br-md bg-brand-600 text-white'
            : 'rounded-bl-md bg-white/[0.06] text-gray-800 ring-1 ring-inset ring-white/[0.08]',
        ].join(' ')}
      >
        {shown}
      </div>
    </div>
  );
}

/**
 * Text that appears a few characters at a time, the way a reply is read
 * rather than dumped. Fast enough not to be waited on: a two-line question
 * is on screen in well under a second. Off entirely when the reader has
 * asked the OS for less motion.
 */
function useTypewriter(text: string, enabled: boolean, onGrow: () => void): string {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [count, setCount] = useState(enabled && !reduced ? 0 : text.length);
  useEffect(() => {
    if (!enabled || reduced) {
      setCount(text.length);
      return;
    }
    setCount(0);
    let n = 0;
    const step = Math.max(1, Math.round(text.length / 60));
    const id = window.setInterval(() => {
      n = Math.min(text.length, n + step);
      setCount(n);
      onGrow();
      if (n >= text.length) window.clearInterval(id);
    }, 16);
    return () => window.clearInterval(id);
    // `onGrow` is a stable callback from the parent; re-running on it would
    // restart the animation on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, enabled, reduced]);
  return text.slice(0, count);
}

