import { useEffect, useState } from 'react';
import { useT } from '../../lib/i18n';
import { AssistantAvatar, ThinkingDots } from '../AssistantAvatar';
import { CheckIcon, Elapsed, STEP_STYLE } from '../schedule/GenerationProgress';

/**
 * The wait between "keep this and build the calendar" and the dashboard.
 *
 * Two real waits happen here, in this order: the paragraph is saved, then the
 * server searches the web for how a business like this one runs where it is.
 * The third step is not ours: it is the calendar being built, which the
 * dashboard's own panel reports the moment the manager lands there. It is
 * listed so the manager knows where this is going, and it is never ticked
 * here -- it would be a lie told a second before the page changes.
 *
 * The search is the long one (tens of seconds, no progress to report), so it
 * gets a bar that sweeps and a line underneath that changes every few
 * seconds. The lines say what the search is looking for, not how far it got.
 */
export type WelcomePhase = 'save' | 'research';

const STEPS = ['save', 'research', 'build'] as const;
const TIPS = [1, 2, 3, 4, 5] as const;
const TIP_EVERY_MS = 4500;

export function WelcomeProgress({
  phase,
  location,
  startedAt,
}: {
  phase: WelcomePhase;
  /** Where the business is, when the profile knows; the search step names it. */
  location?: string | null;
  /** `Date.now()` when the manager pressed the button, for the clock. */
  startedAt: number;
}) {
  const t = useT();
  const active = STEPS.indexOf(phase);

  const label = (step: (typeof STEPS)[number]) =>
    step === 'research' && location?.trim()
      ? t('interview.progress.step.research.at', { location: location.trim() })
      : t(`interview.progress.step.${step}`);

  return (
    <div className="chat-in sc-glass rounded-2xl !border-brand-300/20 p-4 sm:p-5">
      <div role="status" aria-live="polite">
        <div className="flex items-center gap-3">
          <AssistantAvatar />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{t('interview.progress.title')}</p>
            <Elapsed since={startedAt} />
          </div>
        </div>

        {/* The only text in the region that changes with the step: the list
            below reads the same in every phase, only its icons move, so a
            screen reader would otherwise hear nothing when the search starts. */}
        <p className="sr-only">
          {t('interview.progress.sr', { step: active + 1, total: STEPS.length, label: label(phase) })}
        </p>

        <div aria-hidden className="progress-track mt-4 h-1 overflow-hidden rounded-full bg-brand-50">
          <div className="progress-sweep h-full w-2/5 rounded-full bg-gradient-to-r from-brand-200 via-brand-500 to-brand-200" />
        </div>

        <ol className="mt-4 space-y-2.5">
          {STEPS.map((step, i) => {
            const status = i < active ? 'done' : i === active ? 'current' : 'todo';
            const style = STEP_STYLE[status];
            return (
              <li
                key={step}
                className={`flex items-start gap-3 text-sm transition-colors ${style.text}`}
                aria-current={status === 'current' ? 'step' : undefined}
              >
                <span
                  className={`-mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${style.badge}`}
                >
                  {status === 'done' ? (
                    <CheckIcon />
                  ) : status === 'current' ? (
                    <ThinkingDots dotClassName="h-1.5 w-1.5 bg-brand-500" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                  )}
                </span>
                <span className="min-w-0">
                  {label(step)}
                  {/* Hidden from the live region: a line that changes every
                      few seconds would be read out over and over, burying the
                      step changes that matter. */}
                  {step === 'research' && status === 'current' && <RotatingTip />}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <p className="mt-4 text-xs text-gray-500">{t('interview.progress.stay')}</p>
    </div>
  );
}

function RotatingTip() {
  const t = useT();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => (i + 1) % TIPS.length), TIP_EVERY_MS);
    return () => window.clearInterval(id);
  }, []);
  return (
    // Keyed so each new line arrives with the chat's own entrance.
    <span
      key={index}
      aria-hidden
      className="chat-in mt-1 block text-xs font-normal italic text-gray-500"
    >
      {t(`interview.progress.tip.${TIPS[index]}`)}
    </span>
  );
}
