// The few questions worth interrupting a manager for, asked properly.
//
// Almost nothing gets to be a question any more. A number the brief left open
// is assumed, drawn, and corrected in a sentence, because a manager looking at
// a rota can SEE a wrong number. What survives that test is the residue no rota
// can show: "los sabados abrimos casi todo el dia" — open at eight, at ten, at
// twelve? Every choice is a coin flip, the whole day's cover hangs off it, and
// a Saturday drawn wrong looks exactly like a Saturday drawn right.
//
// THREE RULES, AND EACH ONE IS A FAILURE THIS REPLACED.
//
// It never blocks. The calendar is already built and already on screen; this
// sits beside it. A manager who ignores the question keeps their calendar.
//
// It quotes them. Asking "what hours do you keep on Saturdays?" of somebody who
// just wrote a sentence about Saturdays reads as not having listened.
//
// It is closed. Two times, not an essay. Anything answerable with an hour
// should be asked as one.

import { useState } from 'react';
import type { OpenQuestion } from '../../api/schedule';
import { useT } from '../../lib/i18n';
import { weekdayName } from '../../lib/schedule/spec';
import { windowFromAnswer, type DayWindow } from '../../lib/schedule/questions';
import { Button } from '../Button';

/** "HH:MM" -> minutes from midnight, or null when it is not a time. */
function toMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

interface OpenQuestionsProps {
  questions: OpenQuestion[];
  /**
   * False while the roster or the templates are refetching.
   *
   * The handler needs both to rebuild, and several flows on this page
   * invalidate the roster. Without this the button stayed enabled, the click
   * returned early, and the answer vanished with the question still sitting
   * there — the manager typing it again is the only way they would find out.
   */
  ready: boolean;
  onAnswer: (question: OpenQuestion, window: DayWindow) => void;
  onDismiss: (question: OpenQuestion) => void;
}

export function OpenQuestions({
  questions,
  ready,
  onAnswer,
  onDismiss,
}: OpenQuestionsProps) {
  const t = useT();
  const [opens, setOpens] = useState<Record<string, string>>({});
  const [closes, setCloses] = useState<Record<string, string>>({});

  if (questions.length === 0) return null;

  return (
    <div className="m-rise mt-4 rounded-2xl border border-brand-200/60 bg-brand-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-700">
        {t('questions.title')}
      </p>
      <ul className="mt-2 space-y-3">
        {questions.map((q) => {
          // One function decides what a pair of times means, and the button and
          // the handler both ask it. Two readings of "eight to two" is how one
          // of them ends up storing a Saturday that closes before it opens.
          const window = windowFromAnswer(
            toMinutes(opens[q.id] ?? ''),
            toMinutes(closes[q.id] ?? ''),
          );
          return (
            <li key={q.id}>
              <p className="text-sm text-brand-900">
                {/* From the index, never from a name the server sent: those
                    arrive in English, and dropping one into a Spanish sentence
                    produced "Has dicho que Saturday..." for the very brief this
                    was built for. */}
                {q.quote
                  ? t('questions.dayHours.quoted', {
                      quote: q.quote,
                      day: weekdayName(q.weekday),
                    })
                  : t('questions.dayHours', { day: weekdayName(q.weekday) })}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  value={opens[q.id] ?? ''}
                  onChange={(e) =>
                    setOpens((a) => ({ ...a, [q.id]: e.target.value }))
                  }
                  aria-label={t('questions.dayHours.opensAt')}
                  className="rounded-lg border border-brand-200 px-2.5 py-1.5 text-sm text-gray-900 hover:border-brand-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/25"
                />
                <span className="text-xs text-brand-700">
                  {t('questions.dayHours.to')}
                </span>
                <input
                  type="time"
                  value={closes[q.id] ?? ''}
                  onChange={(e) =>
                    setCloses((a) => ({ ...a, [q.id]: e.target.value }))
                  }
                  aria-label={t('questions.dayHours.closesAt')}
                  className="rounded-lg border border-brand-200 px-2.5 py-1.5 text-sm text-gray-900 hover:border-brand-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/25"
                />
                <Button
                  size="sm"
                  disabled={window === null || !ready}
                  onClick={() => window && onAnswer(q, window)}
                >
                  {t('questions.apply')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDismiss(q)}>
                  {t('questions.dismiss')}
                </Button>
              </div>
              <p className="mt-1 text-xs text-brand-700">
                {t('questions.dayHours.help')}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
