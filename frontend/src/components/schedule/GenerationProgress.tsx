import { useEffect, useState } from 'react';
import { plural, useT } from '../../lib/i18n';
import { WEEK_READING_ORDER } from '../../lib/onboarding/firstRun';
import { monthNameList } from '../../lib/schedule/calendar';
import { weekdayShortName } from '../../lib/schedule/spec';
import { AssistantAvatar, ThinkingDots } from '../AssistantAvatar';
import type { PlanJobHealth } from '../../api/schedule';

/**
 * Where the calendar is on its way from the brief to the screen.
 *
 * These are the waits `handleGenerate` actually passes through, in order, so
 * the list on screen is a report and not a decoration. A reorganize skips the
 * first two: the brief is already read and the roster already matched.
 * Validating the proposal is not a phase: it is synchronous and over before
 * a frame could show it.
 *
 * `tune` is the exception that proves the rule -- it is a second round of
 * calls, so it is a real wait, but it only happens when a month comes back
 * broken enough to be worth paying for twice (see ./lib/schedule/planRetry).
 */
export type GenerationPhase = 'interpret' | 'roster' | 'plan' | 'tune';

export interface GenerationState {
  mode: 'generate' | 'reorganize';
  phase: GenerationPhase;
  /**
   * Months the planner has to arrange. Unknown until the brief is read: it
   * may name its own period, so the toolbar's horizon is not an answer.
   */
  months?: number;
  /**
   * The months being asked again, at the model's expensive setting.
   *
   * Absent until it happens, and the step appears with it rather than sitting
   * greyed out from the start. A step listed up front is a promise the panel
   * usually does not keep -- most runs need no second round at all -- and a
   * list that skips one of its own entries is the kind of thing that makes a
   * manager wonder what else was skipped.
   */
  tuning?: string[];
  /**
   * Months with an answer stored, as the server reports them.
   *
   * Real progress rather than an animation: planning is a job now, each month
   * is written down the moment it arrives, and the panel polls for exactly
   * this. Absent while nothing has come back yet, and absent entirely for a
   * client talking to a server that still plans in one request.
   */
  done?: number;
  /** `Date.now()` when the work began, for the clock. */
  startedAt: number;
  /**
   * Whether anybody is working on the job right now. A deploy can kill the
   * worker holding it; the job waits a few minutes and is taken up again, and
   * the panel says so instead of looking hung.
   */
  health?: PlanJobHealth;
}

/** The line that explains a wait the steps above cannot, or null. */
export function healthNote(health: PlanJobHealth | undefined): string | null {
  if (!health) return null;
  if (health.stalled) return 'dashboard.generating.health.stalled';
  if (health.resumed) return 'dashboard.generating.health.resumed';
  return null;
}

const BASE_STEPS: Record<GenerationState['mode'], GenerationPhase[]> = {
  generate: ['interpret', 'roster', 'plan'],
  reorganize: ['plan'],
};

function stepsFor(state: GenerationState): GenerationPhase[] {
  const base = BASE_STEPS[state.mode];
  return state.tuning && state.tuning.length > 0 ? [...base, 'tune'] : base;
}

/**
 * A week of shifts drawing themselves, over and over, while the real one is
 * being arranged. Columns are the seven weekdays, rows are three people; the
 * blocks are a fixed pattern (not random) so the picture is the same every
 * time and does not jump between renders.
 *
 * Each block has its own place in the cycle so they land one after another,
 * left to right and top to bottom, the way a rota is filled in by hand.
 */
const DRAFT_ROWS: { tone: string; cells: ([start: number, span: number] | null)[] }[] = [
  { tone: 'bg-brand-400', cells: [[0, 60], [5, 55], null, [10, 65], [0, 60], [20, 70], null] },
  { tone: 'bg-brand-300', cells: [[40, 55], null, [5, 60], [35, 60], null, [0, 50], [25, 70]] },
  { tone: 'bg-brand-200', cells: [null, [45, 50], [40, 55], null, [30, 65], [50, 50], [5, 55]] },
];
const BLOCK_STAGGER_MS = 150;

export const STEP_STYLE = {
  done: { text: 'text-gray-500', badge: 'border-brand-600 bg-brand-600 text-white' },
  current: { text: 'font-medium text-gray-900', badge: 'border-brand-300 bg-brand-50' },
  todo: { text: 'text-gray-500', badge: 'border-gray-300 bg-surface' },
} as const;

function DraftWeek() {
  return (
    <div aria-hidden className="select-none">
      <div className="grid grid-cols-7 gap-1.5">
        {WEEK_READING_ORDER.map((wd) => (
          <div
            key={wd}
            className="truncate text-center text-[10px] font-medium uppercase tracking-wide text-gray-500"
          >
            {weekdayShortName(wd)}
          </div>
        ))}
      </div>
      <div className="mt-1.5 space-y-1.5">
        {DRAFT_ROWS.map((row, r) => (
          <div key={r} className="grid grid-cols-7 gap-1.5">
            {row.cells.map((cell, c) => (
              <div key={c} className="relative h-5 rounded bg-gray-100">
                {cell && (
                  <span
                    className={`draft-block absolute inset-y-0.5 rounded-sm ${row.tone}`}
                    style={{
                      left: `${cell[0]}%`,
                      width: `${cell[1]}%`,
                      animationDelay: `${(r * 7 + c) * BLOCK_STAGGER_MS}ms`,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The clock, in its own component so that its tick re-renders one line and
 * not the whole panel. Hidden from assistive tech: the panel is a live
 * region, and a value that changes every second would have it read out the
 * entire card sixty times a minute, burying the phase changes that matter.
 */
export function Elapsed({ since }: { since: number }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const total = Math.max(0, Math.floor((now - since) / 1000));
  const clock = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  return (
    <p aria-hidden className="text-xs tabular-nums text-gray-500">
      {t('dashboard.generating.elapsed', { time: clock })}
    </p>
  );
}

export function GenerationProgress({ state }: { state: GenerationState }) {
  const t = useT();
  const steps = stepsFor(state);
  const active = steps.indexOf(state.phase);

  const label = (phase: GenerationPhase) => {
    if (phase === 'plan' && state.months !== undefined) {
      // Counted, once the count means something. A month that has arrived has
      // been stored, so "4 of 12" is a fact about the database rather than a
      // guess about how long the model takes.
      if (state.done !== undefined && state.months > 1) {
        return t('dashboard.generating.step.plan.progress', {
          done: state.done,
          total: state.months,
        });
      }
      return plural(
        state.months,
        'dashboard.generating.step.plan.one',
        'dashboard.generating.step.plan.other',
      );
    }
    // Named, not counted. "Going back over January and March" tells the
    // manager which months they should look at twice when it lands; "going
    // back over 2 months" tells them to go hunting.
    if (phase === 'tune' && state.tuning && state.tuning.length > 0) {
      return t('dashboard.generating.step.tune', {
        months: monthNameList(state.tuning),
      });
    }
    return t(`dashboard.generating.step.${phase}`);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="chat-in m-glass rounded-2xl border border-brand-200/40 p-6 shadow-[0_24px_60px_-36px_rgb(0_0_0/0.8),0_30px_90px_-50px_rgb(20_161_132/0.45)] sm:p-8"
    >
      <div className="grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,4fr)] md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <AssistantAvatar />
            <div className="min-w-0">
              <p className="text-base font-semibold text-gray-900">
                {t(`dashboard.generating.title.${state.mode}`)}
              </p>
              <Elapsed since={state.startedAt} />
            </div>
          </div>

          <ol className="mt-5 space-y-2.5">
            {steps.map((phase, i) => {
              const status = i < active ? 'done' : i === active ? 'current' : 'todo';
              const style = STEP_STYLE[status];
              return (
                <li
                  key={phase}
                  className={`flex items-center gap-3 text-sm transition-colors ${style.text}`}
                  aria-current={status === 'current' ? 'step' : undefined}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${style.badge}`}
                  >
                    {status === 'done' ? (
                      <CheckIcon />
                    ) : status === 'current' ? (
                      <ThinkingDots dotClassName="h-1.5 w-1.5 bg-brand-500" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                    )}
                  </span>
                  <span>{label(phase)}</span>
                </li>
              );
            })}
          </ol>

          <p className="mt-5 max-w-md text-sm text-gray-600">
            {t(`dashboard.generating.hint.${state.phase}`)}
          </p>
          {healthNote(state.health) && (
            <p className="mt-2 max-w-md rounded-lg border border-amber-200/70 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t(healthNote(state.health) as string)}
            </p>
          )}
          <p className="mt-1 max-w-md text-xs text-gray-500">
            {t('dashboard.generating.stay')}
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
          <DraftWeek />
        </div>
      </div>
    </div>
  );
}
