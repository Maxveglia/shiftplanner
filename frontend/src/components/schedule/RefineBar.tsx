// Keep talking to the calendar you already have.
//
// The first prompt builds a schedule; every prompt after it adjusts THIS one.
// Nothing is thrown away unless the manager explicitly asks for a new calendar,
// and every adjustment can be undone.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { useLanguage, useT } from '../../lib/i18n';
import { dictationLocale } from '../../lib/locale';
import { monthName, monthNameList } from '../../lib/schedule/calendar';
import type { PlanScope } from '../../lib/schedule/planScope';
import { useReducedMotion } from '../../lib/motion/useReducedMotion';

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: { length: number; [i: number]: { 0: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type Ctor = new () => SpeechRecognitionLike;

/** How long the sent sentence takes to lift out of the box: `.cal-sent`. */
const SENT_MS = 560;

function recognitionCtor(): Ctor | null {
  const w = window as unknown as {
    SpeechRecognition?: Ctor;
    webkitSpeechRecognition?: Ctor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * How much of the calendar a replan is allowed to touch, as the manager's own
 * choice rather than ours.
 *
 * It is a choice and not a rule because both answers are right for different
 * sentences, and no code here can tell which was said. "Give Ana lighter
 * Mondays" is about the month on screen; "alternate the weekends" is about the
 * year, and answering that one for October alone would be a worse product
 * rather than a cheaper one. So the default is narrow -- that is the common
 * case, and it is the one that costs a call per month to get wrong -- and the
 * wider answer is one visible click away.
 */
export interface ReplanScope {
  value: PlanScope;
  onChange: (next: PlanScope) => void;
  /** The month "this month" means, as "YYYY-MM". */
  focus: string;
  /** How many months the horizon holds; always more than one, or no control. */
  horizonMonths: number;
  /**
   * Months inside the chosen scope that the TEAM ALREADY HAS. Left out of a
   * replan unless the box below is ticked: rearranging a rota somebody has
   * already arranged their week around is not something to do by default.
   */
  published: string[];
  includePublished: boolean;
  onIncludePublishedChange: (next: boolean) => void;
}

interface RefineBarProps {
  /**
   * A sentence to act on. Tries the surgical path first and escalates to the
   * planner itself when the sentence cannot be expressed as operations.
   */
  onRefine: (text: string) => void;
  /**
   * Hand the whole calendar to the planner with no instruction: "just make it
   * better". Reached by pressing the same button with the box EMPTY, because
   * there is nothing to refine surgically and asking the model to read an
   * empty sentence first would be two calls to learn that.
   */
  onReorganize: (text: string) => void;
  onUndo: () => void;
  onNewCalendar: () => void;
  canUndo: boolean;
  isWorking: boolean;
  /**
   * Null when the period on screen is one month: "this month" and "the whole
   * horizon" are then the same rota, and a control whose two answers cannot
   * differ is a question that should not have been asked.
   */
  scope: ReplanScope | null;
}

export function RefineBar({
  onRefine,
  onReorganize,
  onUndo,
  onNewCalendar,
  canUndo,
  isWorking,
  scope,
}: RefineBarProps) {
  const t = useT();
  const { language } = useLanguage();
  const [text, setText] = useState('');
  // The sentence just sent, drawn lifting out of the emptied box for half a
  // second (`cal-sent`) so it is plain where it went. Keyed per send.
  const [sent, setSent] = useState<{ id: number; text: string } | null>(null);
  const reduced = useReducedMotion();
  // The sentence is let go when its animation ends -- or, whatever happens
  // to the animation (a tab in the background runs none), shortly after: the
  // box's hint is hidden while it is there, and must never stay hidden.
  useEffect(() => {
    if (!sent?.text) return;
    const id = sent.id;
    const timer = window.setTimeout(
      () => setSent((s) => (s && s.id === id ? { ...s, text: '' } : s)),
      SENT_MS + 150,
    );
    return () => window.clearTimeout(timer);
  }, [sent]);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const base = useRef('');
  const supported = typeof window !== 'undefined' && recognitionCtor() !== null;

  useEffect(() => () => recRef.current?.stop(), []);

  const toggleVoice = useCallback(() => {
    const C = recognitionCtor();
    if (!C) return;
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new C();
    // The language the manager chose, not the one their laptop is set to --
    // same reasoning as the brief panel, and the same cost when it is wrong:
    // an adjustment dictated in English against a Spanish recogniser does not
    // fail, it arrives as words nobody said and gets sent to the model.
    rec.lang = dictationLocale(language);
    rec.continuous = true;
    rec.interimResults = true;
    base.current = text ? text.trim() + ' ' : '';
    rec.onresult = (e) => {
      let out = '';
      for (let i = 0; i < e.results.length; i += 1) out += e.results[i][0].transcript;
      setText(base.current + out);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening, text, language]);

  /**
   * One button, two jobs, and the box decides which.
   *
   * It was two buttons -- "Adjust" and "Reorganize with AI" -- sitting side by
   * side, and the difference between them was invisible: both send the same
   * sentence to the same product, and the manager had to know that one tries
   * a surgical edit first while the other goes straight to replanning. They
   * mostly pressed the wrong one.
   *
   * The rule that replaces the choice costs nothing and loses nothing. A
   * sentence goes the cheap way first: edits are two small calls, and the
   * planner is only paid for when the sentence turns out to need it -- which
   * is what `handleAdjust` already did on its own. An EMPTY box has no
   * sentence to turn into edits, so it goes straight to the planner: asking
   * the model to read nothing first would be two calls spent learning that
   * nothing was said.
   */
  const submit = () => {
    if (isWorking) return;
    const value = text.trim();
    setText('');
    // Nothing lifts out for anyone who asked for less motion: the box simply
    // empties, as it always did.
    if (!reduced) setSent((prev) => ({ id: (prev?.id ?? 0) + 1, text: value }));
    if (value) onRefine(value);
    else onReorganize('');
  };

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-surface p-4 shadow-[0_24px_60px_-36px_rgb(0_0_0/0.8)]">
      <div className="flex flex-wrap items-start gap-3">
        <div className="relative min-w-[18rem] flex-1">
          {sent && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"
            >
              <span key={`sheen-${sent.id}`} className="cal-sheen" />
              {sent.text && (
                <span
                  key={sent.id}
                  className="cal-sent left-3 right-11 text-sm text-gray-900"
                  onAnimationEnd={() => setSent((s) => (s && s.id === sent.id ? { ...s, text: '' } : s))}
                >
                  {sent.text}
                </span>
              )}
            </span>
          )}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder={t('schedule.refine.placeholder')}
            // The hint stays out of the way while the sentence just sent is
            // still lifting out of the box; two lines of text on one line
            // read as neither.
            className={[
              'relative w-full rounded-xl border border-gray-400 bg-white/[0.04] py-2.5 pl-3 pr-11 text-sm text-gray-900 hover:border-gray-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40',
              sent?.text ? 'placeholder-transparent' : 'placeholder-gray-500',
            ].join(' ')}
          />
          <button
            type="button"
            onClick={toggleVoice}
            disabled={!supported}
            aria-label={
              listening
                ? t('schedule.refine.voice.stop')
                : t('schedule.refine.voice.start')
            }
            title={
              supported
                ? t('schedule.refine.voice.start')
                : t('schedule.refine.voice.unsupported')
            }
            className={[
              'absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full transition-colors',
              !supported
                ? 'cursor-not-allowed text-gray-400'
                : listening
                  ? 'animate-pulse bg-danger text-white motion-reduce:animate-none'
                  : 'text-gray-500 hover:bg-white/[0.08] hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
            ].join(' ')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
            </svg>
          </button>
        </div>

        {/* The label says which of the two jobs this press will do, so the
            choice the two buttons used to ask for is answered by what the
            manager has already typed -- or not typed. */}
        <Button
          onClick={submit}
          disabled={isWorking}
          title={
            text.trim()
              ? t('schedule.refine.submit.help')
              : t('schedule.refine.reorganize.help')
          }
        >
          {isWorking
            ? t('schedule.refine.working')
            : text.trim()
              ? t('schedule.refine.submit')
              : t('schedule.refine.reorganize')}
        </Button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:border-white/25 hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
          >
            {t('schedule.refine.undo')}
          </button>
          <button
            type="button"
            onClick={onNewCalendar}
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-white/[0.06] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 motion-reduce:transition-none"
          >
            {t('schedule.refine.newCalendar')}
          </button>
        </div>
      </div>

      {/* What a reorganize -- and any adjustment that escalates into one --
          is going to replan. Under the buttons rather than beside them: it
          qualifies the action, it is not another action. */}
      {scope && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {t('schedule.refine.scope.label')}
            </span>
            <div
              role="group"
              aria-label={t('schedule.refine.scope.label')}
              className="inline-flex overflow-hidden rounded-lg border border-white/15"
            >
              {(
                [
                  ['month', t('schedule.refine.scope.month', { month: monthName(scope.focus) })],
                  [
                    'horizon',
                    t('schedule.refine.scope.horizon', { count: scope.horizonMonths }),
                  ],
                ] as [PlanScope, string][]
              ).map(([value, label], i) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => scope.onChange(value)}
                  aria-pressed={scope.value === value}
                  className={[
                    'px-3 py-1.5 text-xs font-medium transition-colors',
                    i > 0 ? 'border-l border-white/15' : '',
                    scope.value === value
                      ? 'bg-brand-100 font-semibold text-brand-800 shadow-[inset_0_-2px_0_rgb(68_214_180)]'
                      : 'bg-white/[0.03] text-gray-600 hover:bg-white/[0.07] hover:text-gray-800',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>

            {scope.published.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={scope.includePublished}
                  onChange={(e) => scope.onIncludePublishedChange(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-white/25 text-brand-300 focus:ring-brand-400"
                />
                {t('schedule.refine.scope.published', {
                  months: monthNameList(scope.published),
                })}
              </label>
            )}
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            {t('schedule.refine.scope.help')}
          </p>
        </div>
      )}
    </div>
  );
}
