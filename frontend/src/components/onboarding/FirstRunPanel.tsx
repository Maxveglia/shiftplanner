// The first thing a new account is asked, and the only time it is asked.
//
// Signing up used to create an organization, seed it, and leave the manager in
// front of a blank textarea having asked nothing whatsoever. Everything the
// product needed to build a calendar was either in a brief nobody had written
// yet or in a generic constant nobody had chosen — two people on shift, eight
// to ten, open every day — applied in silence.
//
// THE RULE THAT SHAPES THIS PANEL: a visible assumption beats a question. Every
// number the product can defend on its own stays an assumption, shown on the
// rota and correctable by saying so. What is left is the short list of things
// no default can honestly stand in for, and that list is what is asked here.
// It is not an onboarding questionnaire and must never grow into one.
//
// Four properties, none of them negotiable:
//
//   SKIPPABLE     as a whole and one step at a time. An account that skips it
//                 works exactly as every account worked before this existed.
//   NON-BLOCKING  skipping is local state, not a round trip. The dashboard is
//                 one click away and never waits on anything here.
//   ASK ONCE      answered or skipped, `first_run_pending` goes false and this
//                 never appears again.
//   SHOWN FIRST   nothing interpreted is saved before the manager has seen it.
//                 The hours come back as seven editable rows, not as a
//                 reassurance that we understood.
//
// WHY THE HOURS ARE ONE QUESTION. A manager says "Monday to Thursday six to
// two, Friday and Saturday until four" in one breath, and the intake already
// reads exactly that. Asking day by day would be seven questions to replace one
// sentence, and a product that then asks "and Tuesday?" sounds deaf. So the
// answer goes through the intake we already have — no second parser — and what
// comes back is shown as a table before a word of it is used.

import { useCallback, useMemo, useState } from 'react';
import { interpretBrief } from '../../api/schedule';
import { useBusinessProfile, useUpdateBusinessProfile } from '../../api/profile';
import { Button } from '../Button';
import { FIELD_SKIN, fieldTone } from '../Input';
import { getErrorMessage } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { formatClockValue, formatTime, verticalLabel } from '../../lib/format';
import { DEFAULT_SPEC, weekdayName, weekdayShortName } from '../../lib/schedule/spec';
import {
  closeAfterMidnight,
  composeFirstRunBrief,
  daySchedulesFromSpec,
  NIGHT_DAY_BOUNDARY_MIN,
  WEEK_READING_ORDER,
  type DaySchedule,
} from '../../lib/onboarding/firstRun';

interface FirstRunPanelProps {
  /**
   * The brief the answers came out as. The caller puts it in the box the
   * manager edits and generates from it — seeing a week laid out is the fastest
   * way to find out we misread something.
   */
  onFinish: (brief: string) => void;
  /** Put the questions away without answering. Nothing is asked again. */
  onSkip: () => void;
  /**
   * The day boundary and the busy days, straight into the draft on screen.
   *
   * Same reason the profile panel does it: these two live on the profile and
   * would otherwise only reach a calendar the next time a brief is read, which
   * looks like a setting that does nothing.
   */
  onBusinessShapeChange: (shape: {
    dayBoundaryMin: number | null;
    weekendDays: number[] | null;
  }) => void;
  /** True while the caller is building the calendar this panel just asked for. */
  isBuilding: boolean;
  /**
   * Be asked in conversation instead. Offered only when the server has the
   * interview to offer; it replaces these questions, it does not add to them.
   */
  onPreferInterview?: () => void;
}

/**
 * The steps, as an ordered list of codes.
 *
 * An index into this decides what is on screen — never a comparison against
 * anything the manager can read. Adding a step is adding a member here and a
 * branch below; there is no other bookkeeping.
 */
const STEPS = ['vertical', 'hours', 'busy', 'peak', 'split'] as const;
type Step = (typeof STEPS)[number];

/** Minutes in a civil day. A close at or before the open runs into the next. */
const DAY_MIN = 24 * 60;

/** "09:30" -> 570. Null for anything a time input could not have produced. */
function parseClock(value: string): number | null {
  const [h, m] = value.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const minutes = h * 60 + m;
  return minutes >= 0 && minutes < DAY_MIN ? minutes : null;
}

export function FirstRunPanel({
  onFinish,
  onSkip,
  onBusinessShapeChange,
  isBuilding,
  onPreferInterview,
}: FirstRunPanelProps) {
  const t = useT();
  const profile = useBusinessProfile();
  const update = useUpdateBusinessProfile();

  const [stepIndex, setStepIndex] = useState(0);
  const step: Step = STEPS[stepIndex];

  // --- Step 0: what kind of business this is ------------------------------
  const [vertical, setVertical] = useState<string | null>(null);

  // --- Step 1: the hours --------------------------------------------------
  const [hoursText, setHoursText] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  // Null while the question is still being asked; seven rows once there is
  // something to correct. Which of the two is on screen is decided by this
  // being null, never by what the manager has typed.
  const [days, setDays] = useState<DaySchedule[] | null>(null);
  const [nextDayConfirmed, setNextDayConfirmed] = useState<boolean | null>(null);

  // --- Step 2..4: the three short ones ------------------------------------
  const [busyDays, setBusyDays] = useState<number[] | null>(null);
  const [peakRaw, setPeakRaw] = useState('');
  const [splitShift, setSplitShift] = useState<boolean | null>(null);

  const lateClose = days ? closeAfterMidnight(days) : null;
  const peakStaff = useMemo(() => {
    const n = Number.parseInt(peakRaw, 10);
    return Number.isFinite(n) && n >= 1 && n <= 50 ? n : null;
  }, [peakRaw]);

  /**
   * The two profile settings as they stand right now, answers first.
   *
   * Both are pushed into the draft on screen, and both can be pushed twice in
   * one session -- the boundary at the hours step, the weekend at the next one.
   * Reading the second from the query cache the first time would send whatever
   * the server had before the first write landed, and quietly undo it in the
   * calendar. Local answers are the newer truth; the profile is the fallback.
   */
  const shapeNow = useCallback(
    (patch: { dayBoundaryMin?: number | null; weekendDays?: number[] | null }) => ({
      dayBoundaryMin:
        patch.dayBoundaryMin !== undefined
          ? patch.dayBoundaryMin
          : nextDayConfirmed === true
            ? NIGHT_DAY_BOUNDARY_MIN
            : (profile.data?.day_boundary_min ?? null),
      weekendDays:
        patch.weekendDays !== undefined
          ? patch.weekendDays
          : (busyDays ?? profile.data?.weekend_days ?? null),
    }),
    [nextDayConfirmed, busyDays, profile.data],
  );

  /** Close the questions for good. Answered and skipped mean the same here. */
  const close = useCallback(() => {
    update.mutate({ first_run_pending: false });
  }, [update]);

  const handleSkipAll = useCallback(() => {
    close();
    onSkip();
  }, [close, onSkip]);

  /**
   * Read the sentence the manager just wrote, with the intake that already
   * exists.
   *
   * Deliberately the ordinary `/schedule/interpret` call and not a new
   * endpoint: it is the same question ("what does this brief say about hours"),
   * and a second reader would be a second answer to it. The team it also
   * extracts is ignored here — a sentence about opening hours describes no
   * people, and this panel writes no roster.
   *
   * A failure is not a dead end. The seven rows appear anyway, filled with the
   * hours the product would have assumed, and the manager sets them by hand.
   * What we must not do is claim to have understood something we never read,
   * so the two cases say different things on screen.
   */
  const readHours = useCallback(async () => {
    const text = hoursText.trim();
    if (!text) return;
    setIsReading(true);
    setReadError(null);
    setNextDayConfirmed(null);
    try {
      const interpreted = await interpretBrief(text);
      setDays(daySchedulesFromSpec(interpreted.spec));
    } catch (err) {
      setReadError(getErrorMessage(err));
      setDays(daySchedulesFromSpec(DEFAULT_SPEC));
    } finally {
      setIsReading(false);
    }
  }, [hoursText]);

  const editDay = useCallback(
    (weekday: number, patch: Partial<DaySchedule>) => {
      setDays((current) =>
        (current ?? []).map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)),
      );
      // A correction invalidates the answer given about the old closing time.
      setNextDayConfirmed(null);
    },
    [],
  );

  const confirmNextDay = useCallback(
    (yes: boolean) => {
      setNextDayConfirmed(yes);
      if (!yes) return;
      // Six in the morning, once, forever — see NIGHT_DAY_BOUNDARY_MIN. A "no"
      // writes nothing: the column stays null, which is how "never told us"
      // keeps being distinguishable from "confirmed midnight".
      update.mutate({ day_boundary_min: NIGHT_DAY_BOUNDARY_MIN });
      onBusinessShapeChange(shapeNow({ dayBoundaryMin: NIGHT_DAY_BOUNDARY_MIN }));
    },
    [update, onBusinessShapeChange, shapeNow],
  );

  /** Move on, writing whatever the step just finished owns on the profile. */
  const advance = useCallback(
    (answered: boolean) => {
      if (answered && step === 'vertical' && vertical) {
        // A human picked it, so the server marks it `declared` — which is what
        // makes it reach the model and produce suggestions at all.
        update.mutate({ vertical });
      }
      if (answered && step === 'busy' && busyDays) {
        update.mutate({ weekend_days: busyDays });
        onBusinessShapeChange(shapeNow({ weekendDays: busyDays }));
      }
      if (!answered) {
        // Skipping a step is not answering it with a blank. Everything it
        // would have written is dropped, so the brief carries no sentence and
        // the profile keeps its null.
        if (step === 'vertical') setVertical(null);
        if (step === 'hours') setDays(null);
        if (step === 'busy') setBusyDays(null);
        if (step === 'peak') setPeakRaw('');
        if (step === 'split') setSplitShift(null);
      }
      if (stepIndex === STEPS.length - 1) {
        // Only the LAST step's answer is still in a variable rather than in
        // state -- every earlier one has already been kept or dropped by its
        // own pass through here.
        const brief = composeFirstRunBrief(
          { days, peakStaff, splitShift: answered ? splitShift : null },
          weekdayName,
        );
        close();
        // Nothing to build a calendar from is a skip, not an empty brief: the
        // generator would happily produce a week out of pure defaults, which is
        // the silence this flow exists to break.
        if (brief) onFinish(brief);
        else onSkip();
        return;
      }
      setStepIndex((i) => i + 1);
    },
    [
      step,
      stepIndex,
      vertical,
      busyDays,
      days,
      peakStaff,
      splitShift,
      update,
      onBusinessShapeChange,
      shapeNow,
      onFinish,
      onSkip,
      close,
    ],
  );

  const verticals = profile.data?.verticals ?? [];

  return (
    <div className="sc-hero rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            {t('onboarding.title')}
          </h2>
          <p className="mt-0.5 text-sm text-gray-600">{t('onboarding.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {t('onboarding.progress', {
              step: stepIndex + 1,
              total: STEPS.length,
            })}
          </span>
          {onPreferInterview && (
            <button
              type="button"
              onClick={onPreferInterview}
              className="rounded text-xs text-brand-300 underline-offset-4 hover:text-brand-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
            >
              {t('interview.offer.firstRun')}
            </button>
          )}
          <Button variant="ghost" size="sm" onClick={handleSkipAll}>
            {t('onboarding.skipAll')}
          </Button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        {step === 'vertical' && (
          <>
            <p className="text-sm font-medium text-gray-900">
              {t('onboarding.vertical.question')}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {t('onboarding.vertical.help')}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {verticals.map((v) => (
                <button
                  key={v.code}
                  type="button"
                  aria-pressed={vertical === v.code}
                  onClick={() => setVertical(v.code)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    vertical === v.code
                      ? 'border-brand-400/70 bg-brand-50 font-medium text-brand-700'
                      : 'border-white/15 bg-white/[0.03] text-gray-700 hover:bg-white/[0.06]'
                  }`}
                >
                  {verticalLabel(v)}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'hours' && days === null && (
          <>
            <p className="text-sm font-medium text-gray-900">
              {t('onboarding.hours.question')}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {t('onboarding.hours.help')}
            </p>
            <textarea
              value={hoursText}
              onChange={(e) => setHoursText(e.target.value)}
              rows={2}
              placeholder={t('onboarding.hours.placeholder')}
              aria-label={t('onboarding.hours.question')}
              className={`mt-3 w-full resize-y rounded-xl p-3 ${FIELD_SKIN} ${fieldTone(false)}`}
            />
            <div className="mt-3">
              <Button
                size="sm"
                onClick={readHours}
                disabled={isReading || hoursText.trim() === ''}
              >
                {isReading ? t('onboarding.hours.reading') : t('onboarding.hours.read')}
              </Button>
            </div>
          </>
        )}

        {step === 'hours' && days !== null && (
          <>
            <p className="text-sm text-gray-700">
              {readError
                ? t('onboarding.hours.failed', { reason: readError })
                : t('onboarding.hours.review')}
            </p>
            <ul className="mt-3 space-y-1.5">
              {WEEK_READING_ORDER.map((weekday) => {
                const day = days.find((d) => d.weekday === weekday);
                if (!day) return null;
                return (
                  <li
                    key={weekday}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="w-24 shrink-0 text-gray-700">
                      {weekdayName(weekday)}
                    </span>
                    <label className="flex items-center gap-1.5 text-xs text-gray-500">
                      <input
                        type="checkbox"
                        checked={day.closed}
                        onChange={(e) => editDay(weekday, { closed: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      {t('onboarding.hours.closedDay')}
                    </label>
                    {!day.closed && (
                      <>
                        <input
                          type="time"
                          step={900}
                          value={formatClockValue(day.openMin)}
                          aria-label={t('onboarding.hours.openLabel', {
                            day: weekdayName(weekday),
                          })}
                          onChange={(e) => {
                            const openMin = parseClock(e.target.value);
                            if (openMin === null) return;
                            // The close keeps meaning the same wall clock; only
                            // which day it lands on can change.
                            const wall = day.closeMin % DAY_MIN;
                            editDay(weekday, {
                              openMin,
                              closeMin: wall <= openMin ? wall + DAY_MIN : wall,
                            });
                          }}
                          className={`rounded-lg px-2 py-1 ${FIELD_SKIN} ${fieldTone(false)}`}
                        />
                        <span className="text-gray-500">–</span>
                        <input
                          type="time"
                          step={900}
                          value={formatClockValue(day.closeMin)}
                          aria-label={t('onboarding.hours.closeLabel', {
                            day: weekdayName(weekday),
                          })}
                          onChange={(e) => {
                            const wall = parseClock(e.target.value);
                            if (wall === null) return;
                            // A close at or before the open is a night, which is
                            // the same reading the intake gives "de seis a
                            // cuatro" — not an error to reject.
                            editDay(weekday, {
                              closeMin: wall <= day.openMin ? wall + DAY_MIN : wall,
                            });
                          }}
                          className={`rounded-lg px-2 py-1 ${FIELD_SKIN} ${fieldTone(false)}`}
                        />
                        {day.closeMin > DAY_MIN && (
                          <span className="text-xs text-gray-500">
                            {t('onboarding.hours.nextDay')}
                          </span>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>

            {lateClose !== null && nextDayConfirmed === null && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm text-amber-900">
                  {t('onboarding.midnight.question', {
                    time: formatTime(lateClose),
                  })}
                </p>
                <p className="mt-0.5 text-xs text-amber-700">
                  {t('onboarding.midnight.help')}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => confirmNextDay(true)}>
                    {t('onboarding.yes')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => confirmNextDay(false)}
                  >
                    {t('onboarding.no')}
                  </Button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setDays(null);
                setReadError(null);
                setNextDayConfirmed(null);
              }}
              className="mt-3 text-xs text-gray-500 underline hover:text-gray-700"
            >
              {t('onboarding.hours.edit')}
            </button>
          </>
        )}

        {step === 'busy' && (
          <>
            <p className="text-sm font-medium text-gray-900">
              {t('onboarding.busy.question')}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">{t('onboarding.busy.help')}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {WEEK_READING_ORDER.map((weekday) => {
                const on = (busyDays ?? []).includes(weekday);
                return (
                  <button
                    key={weekday}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setBusyDays((current) => {
                        const list = current ?? [];
                        return on
                          ? list.filter((d) => d !== weekday)
                          : [...list, weekday].sort((a, b) => a - b);
                      })
                    }
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                      on
                        ? 'border-brand-400/70 bg-brand-50 text-brand-700'
                        : 'border-white/15 bg-white/[0.03] text-gray-600 hover:bg-white/[0.06]'
                    }`}
                  >
                    {weekdayShortName(weekday)}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === 'peak' && (
          <>
            <p className="text-sm font-medium text-gray-900">
              {t('onboarding.peak.question')}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">{t('onboarding.peak.help')}</p>
            <input
              type="number"
              min={1}
              max={50}
              value={peakRaw}
              onChange={(e) => setPeakRaw(e.target.value)}
              aria-label={t('onboarding.peak.label')}
              className={`mt-3 w-24 rounded-lg px-2.5 py-1.5 ${FIELD_SKIN} ${fieldTone(false)}`}
            />
          </>
        )}

        {step === 'split' && (
          <>
            <p className="text-sm font-medium text-gray-900">
              {t('onboarding.split.question')}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">{t('onboarding.split.help')}</p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant={splitShift === true ? 'primary' : 'secondary'}
                onClick={() => setSplitShift(true)}
              >
                {t('onboarding.yes')}
              </Button>
              <Button
                size="sm"
                variant={splitShift === false ? 'primary' : 'secondary'}
                onClick={() => setSplitShift(false)}
              >
                {t('onboarding.no')}
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          onClick={() => advance(true)}
          disabled={isBuilding || (step === 'hours' && days === null)}
        >
          {stepIndex === STEPS.length - 1
            ? isBuilding
              ? t('onboarding.building')
              : t('onboarding.finish')
            : t('onboarding.next')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => advance(false)}>
          {t('onboarding.skipStep')}
        </Button>
        {stepIndex > 0 && (
          <button
            type="button"
            onClick={() => setStepIndex((i) => i - 1)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            {t('onboarding.back')}
          </button>
        )}
      </div>
    </div>
  );
}
