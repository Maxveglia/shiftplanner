import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useEmployees } from '../api/employees';
import { useAbsences, useAbsenceTypes } from '../api/absences';
import { useShiftTemplates } from '../api/shiftTemplates';
import { queryKeys } from '../api/keys';
import { useAuth } from '../auth/useAuth';
import {
  collectPlanJob,
  interpretBrief,
  planCalendar,
  planJobIsLive,
  readLatestPlanJob,
  type PlanJob,
  refineSchedule,
  useDraftSchedule,
  usePublishSchedule,
  usePublishedSchedule,
  useShiftMarks,
  useSaveDraft,
  type AppliedHint,
  type ProfileSuggestion,
  type OpenQuestion,
  type SpecGap,
  declareDayHours,
  type Declaration,
  type PlanEffort,
  type PlanJobHealth,
} from '../api/schedule';
import { useBusinessProfile, useRecordObservations } from '../api/profile';
import { usePayPolicyEditor } from '../api/payPolicy';
import { getErrorMessage } from '../lib/api';
import { plural, useT } from '../lib/i18n';
import { translate } from '../lib/i18n/core';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { formatTime } from '../lib/format';
import {
  answerDayHours,
  type DayWindow,
} from '../lib/schedule/questions';
import { APP_LOCALE } from '../lib/locale';
import { PromptPanel } from '../components/schedule/PromptPanel';
import {
  GenerationProgress,
  type GenerationState,
} from '../components/schedule/GenerationProgress';
import { FirstRunPanel } from '../components/onboarding/FirstRunPanel';
import { InferredVerticalPrompt } from '../components/onboarding/InferredVerticalPrompt';
import { InterviewChat } from '../components/onboarding/InterviewChat';
import { useCompleteInterview, useInterviewStatus } from '../api/interview';
import { useAssistantStatus } from '../api/assistant';
import { AssistantPanel } from '../components/assistant/AssistantPanel';
import type { WelcomeHandoff } from './WelcomePage';
import { toPayload } from '../lib/onboarding/weekHours';
import type { FirstMonthPick } from '../lib/onboarding/firstMonth';
import { OpenQuestions } from '../components/schedule/OpenQuestions';
import { TeamProposal } from '../components/schedule/TeamProposal';
import { reconcile, type RosterPlan } from '../lib/roster/reconcile';
import { explainEmptyCalendar } from '../lib/schedule/emptyCalendar';
import { applyRosterPlan, type ApplySelection } from '../lib/roster/apply';
import {
  absenceOp,
  applyRosterOps,
  isRosterOp,
  toAbsenceRequest,
  toRosterOp,
  type AbsenceRequest,
  type RosterOp,
} from '../lib/roster/ops';
import { typeForKind } from '../lib/roster/absenceKind';
import { AbsenceKindModal } from '../components/schedule/AbsenceKindModal';
import type {
  AbsenceOut,
  AbsenceTypeOut,
  EmployeeOut,
  PublishResult,
  TeamMemberSpec,
} from '../types';
import { PayrollView } from '../components/schedule/PayrollView';
import { RefineBar, type ReplanScope } from '../components/schedule/RefineBar';
import { ChangeSummary } from '../components/schedule/ChangeSummary';
import { PublishConfirmModal } from '../components/schedule/PublishConfirmModal';
import { diffSchedules, slotKey, type ScheduleDiff } from '../lib/schedule/diff';
import {
  handEditNote,
  keepHandEdits,
  keepableOn,
  refusedHandEditNote,
} from '../lib/schedule/handEdits';
import {
  damageBetween,
  damageLines,
  isBetter,
  worthRearranging,
} from '../lib/schedule/damage';
import { fromAssignmentOutList, seedFromRows } from '../lib/schedule/persist';
import {
  NO_MARK,
  draftOf,
  resolveLoad,
  sameSnapshot,
  shouldSave,
  snapshotOf,
  windowKey,
  withinWindow,
  cleanStrays,
  startsOutside,
  validPins,
  type Snapshot,
  type SyncMark,
} from '../lib/schedule/draftSync';
import {
  applyOps,
  buildRefineContext,
  outsidePeriodNotice,
  toEditOp,
  type EditOp,
} from '../lib/schedule/refine';
import {
  EMPTY_OVERLAY,
  withBlackouts,
  withPinned,
  withoutPinned,
  type ScheduleOverlay,
} from '../lib/schedule/overlay';
import { movedShift, resizedShift } from '../lib/schedule/resize';
import {
  minimumWage,
  nightPremiumFloor,
  withLabourFloor,
} from '../lib/schedule/jurisdiction';
import { useLaborProfiles } from '../api/laborProfiles';
import { DayGrid } from '../components/schedule/DayGrid';
import { placeShift } from '../lib/schedule/placeShift';
import { DayView } from '../components/schedule/DayView';
import { YearGrid } from '../components/schedule/YearGrid';
import { ViewTabs, panelIdFor, tabIdFor } from '../components/schedule/ViewTabs';
import { PublishBurst } from '../components/schedule/PublishBurst';
import {
  identityKey,
  tabDirection,
  type DayEntrance,
  type DayOrigin,
  type Point,
} from '../components/schedule/calendarMotion';
import {
  dateKey,
  daysFromFloor,
  fromDateKey,
  monthWindow,
  windowHolds,
  shiftDay,
  yearOf,
  type Focus,
} from '../lib/schedule/focus';
import { WorkdayView } from '../components/schedule/WorkdayView';
import { DraftBalanceColumn } from '../components/schedule/DraftBalanceColumn';
import { useBalances, useWorkday } from '../api/workday';
import {
  planPeriodFor,
} from '../lib/schedule/planPeriod';
import { monthsNamedIn } from '../lib/schedule/namedMonth';
import { useDraftState } from '../lib/schedule/draftStore';
import {
  monthNameList,
  monthsOf,
} from '../lib/schedule/calendar';
import {
  cutFor,
  daysInMonths,
  monthsOfDays,
  planningScope,
  type PlanScope,
} from '../lib/schedule/planScope';
import {
  judgeMonths,
  mergeRetried,
  monthsToRetry,
} from '../lib/schedule/planRetry';
import { DEFAULT_SPEC, statesRequirement, weekdayName } from '../lib/schedule/spec';
import {
  generateSchedule,
  manualShift,
  summarize,
} from '../lib/schedule/generate';
import { scheduleFromProposal } from '../lib/schedule/fromProposal';
import { buildPlanContext, type PlanRevision } from '../lib/schedule/planContext';
import type { Assignment, DayRef, ScheduleResult, SchedulingSpec } from '../lib/schedule/types';
import { objectiveFor } from '../lib/schedule/objective';


/**
 * A YYYY-MM-DD from the spec, as a LOCAL date.
 *
 * Built from the parts rather than `new Date(key)`, which reads a bare date as
 * UTC and lands on the previous day west of Greenwich -- the calendar would
 * start on the 30th of September for a brief that said October.
 */
function parseDayKey(key: string | null): Date | null {
  if (!key) return null;
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * Every day of a window, as the calendar's own day refs.
 *
 * The window is whole months by construction (`savedWindow`), so this is the
 * period the brief asked for, day by day -- what gets planned, drawn and
 * saved. ONE list, where there used to be three that could disagree: the days
 * shown, the days planned and the days saved. When they disagreed, the draft
 * did not save.
 */
function daysOfWindow(window: { from: Date; to: Date }): DayRef[] {
  const out: DayRef[] = [];
  const d = new Date(window.from);
  while (d < window.to) {
    out.push({
      date: dateKey(d),
      weekday: d.getDay(),
      label: d.toLocaleDateString(APP_LOCALE, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
    });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

type View = 'calendar' | 'payroll' | 'workday';

/** The views in the order their tabs are drawn, for the panel's direction. */
const VIEWS: View[] = ['calendar', 'payroll', 'workday'];
/** Prefix of the view tabs' and panels' ids (see ViewTabs). */
const VIEW_TABS = 'dashboard-view';
/** A panel reached with Tab from its tab shows it has the focus. */
const PANEL_FOCUS =
  'mt-4 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2';

/**
 * How long after the last change the draft is sent to the server.
 *
 * Longer than the localStorage mirror's 250 ms: that one is a local write,
 * this one is a request that replaces the whole window, and a drag across
 * the grid produces a change per step.
 */
const SAVE_DRAFT_DELAY_MS = 1500;
/** Windows whose sync marks are kept; the oldest go first. */
const SYNC_MARKS_KEPT = 12;

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * An error, cut to a length that fits under a heading.
 *
 * It used to do more: it read the message looking for "credit balance",
 * "rate limit" and the rest, and turned each into a sentence a manager could
 * act on. That work now happens on the server, which names the cause with a
 * code (`ai_failure` in backend/app/errors.py) that `getErrorMessage` turns
 * into a sentence in the right language. Doing it here meant matching English
 * prose, so the moment the prose was translated the matching stopped finding
 * anything -- and the one reading it in Spanish was the one who most needed
 * to be told the account had run out of credit.
 *
 * What is left is the truncation, for the long tail of messages nobody has
 * given a code to.
 */
function shortReason(reason: string): string {
  return reason.length > 70 ? reason.slice(0, 70) + '…' : reason;
}

export function DashboardPage() {
  const t = useT();
  const { user } = useAuth();
  const qc = useQueryClient();
  const employees = useEmployees();
  const absences = useAbsences();
  const absenceTypes = useAbsenceTypes();
  /**
   * Absences waiting on one answer, and the adjustment held behind them.
   *
   * Deliberately NOT draft state: a half-asked question must not come back
   * three days later on another browser, with the sentence that prompted it
   * long gone. If the tab closes the adjustment is simply not made, which is
   * the outcome the manager can see.
   */
  const [pendingAbsences, setPendingAbsences] = useState<{
    queue: AbsenceRequest[];
    plan: { ops: EditOp[]; rosterOps: RosterOp[]; instruction: string };
  } | null>(null);
  const templates = useShiftTemplates();
  const laborProfiles = useLaborProfiles();
  // Read here rather than further down: the jurisdiction below is derived
  // from it, and a business's rules cannot wait for the rest of the page.
  const businessProfile = useBusinessProfile();

  const [rawSpec, setSpec] = useDraftState<SchedulingSpec>('spec', DEFAULT_SPEC);
  const [result, setResult] = useDraftState<ScheduleResult | null>('result', null);
  const [prompt, setPrompt] = useDraftState('prompt', '');
  // The brief the calendar ON SCREEN was built from. `prompt` is not that: it
  // is set the moment Generate is pressed, so after a brief the intake refused
  // it holds a paragraph that built nothing, and a period seeded from the
  // published rota has a `prompt` left over from whatever came before.
  // Replanning quotes this one, so the words the planner is told to honour are
  // the words the rules on screen came from.
  const [briefInEffect, setBriefInEffect] = useDraftState('briefInEffect', '');
  // Where the planner is while the calendar is on its way. Set while either
  // the brief or a reorganize has the AI arranging shifts, which is the one
  // wait in the product long enough to need a picture; a spoken adjustment
  // takes seconds and keeps its button label.
  const [generation, setGeneration] = useState<GenerationState | null>(null);
  // The same fact as a ref, because the handlers below are memoised on
  // other things and would read a stale `generation`. Two runs at once
  // would share one panel and one `result`, and the first to finish would
  // hide the other's work.
  const generationInFlight = useRef(false);
  /**
   * One run of the planner, from the panel going up to the panel coming
   * down. The `finally` is what makes a thrown error unable to leave the
   * panel over the calendar; the ref is what refuses a second run.
   */
  const runGeneration = useCallback(
    async (initial: GenerationState, work: () => Promise<void>) => {
      if (generationInFlight.current) return;
      generationInFlight.current = true;
      setGeneration(initial);
      try {
        await work();
      } finally {
        generationInFlight.current = false;
        setGeneration(null);
      }
    },
    [],
  );
  const setPhase = useCallback(
    (phase: GenerationState['phase'], extra?: Partial<GenerationState>) =>
      setGeneration((g) => g && { ...g, ...extra, phase }),
    [],
  );
  /**
   * How many months of the calendar are already written.
   *
   * Reported by the server, which stores each month as it arrives, so the panel
   * counts something real instead of animating. Only while 'plan' is the
   * current step: 'tune' names its months rather than counting them, and a
   * count arriving late must not overwrite that.
   */
  const notePlanProgress = useCallback(
    (done: number, total: number, health?: PlanJobHealth) => {
      setGeneration((g) =>
        g && g.phase === 'plan'
          ? { ...g, done, months: total, health: health ?? g.health }
          : g,
      );
    },
    [],
  );
  // How much of the horizon a replan is allowed to touch, and whether it may
  // touch the months the team already has.
  //
  // The narrow answer is the default because it is the common case AND the
  // one that is expensive to get wrong: a replan is a call to the model per
  // month, so a sentence about October used to cost twelve of them on a year
  // and fourteen when the surgical path handed it over (see `handleAdjust`).
  // The manager can widen it in one click, and the bar says what the click
  // will do -- guessing the scope from their words is the one automation here
  // that could make the product worse rather than cheaper.
  //
  // Drafted, like the horizon it qualifies: it is a property of the calendar
  // being worked on, and losing it on a screen change would silently widen
  // the next replan. `includePublished` is NOT drafted: it is consent for one
  // action over a rota the team already has, and consent that persists
  // quietly is not consent.
  const [planScope, setPlanScope] = useDraftState<PlanScope>('planScope', 'month');
  const [includePublished, setIncludePublished] = useState(false);
  /**
   * Where the manager is looking. The year, or one day of it.
   *
   * This replaced five horizons in a toolbar -- week, four weeks, month, year,
   * brief -- and the replacement is not a simplification for its own sake.
   * Those five decided what got SAVED as well as what got shown, and the
   * combination cost a manager their October: a brief plans 31 days, the
   * toolbar said "4 weeks", and the draft went up with a 28-day window around
   * 31 days of shifts. The server refused all of it.
   *
   * Now looking decides nothing. `days` below comes from the PERIOD, and the
   * only thing this picks is what is drawn.
   */
  const [focus, setFocus] = useDraftState<Focus>('focus', () => ({
    kind: 'year' as const,
    year: new Date().getFullYear(),
  }));
  const [showPrompt, setShowPrompt] = useDraftState('showPrompt', true);
  // Coming back to a calendar that is already drafted opens on the calendar,
  // not on the brief that made it: the brief is kept, but reopening it is a
  // click on "Edit requirements", not the first thing on the screen.
  useEffect(() => {
    if (result !== null) setShowPrompt(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [view, setView] = useDraftState<View>('view', 'calendar');

  // --- Motion ----------------------------------------------------------------
  //
  // How things on this screen arrive. None of it is drafted, saved or sent:
  // it is what the eye needs to follow a change, and it is decided at the
  // moment of the change (see calendarMotion.ts for the numbers).
  //
  // How the day on screen came to be there: grown out of the year, stepped
  // to, or neither. Named with its date, so a stale one is never replayed.
  const [dayEntrance, setDayEntrance] = useState<DayEntrance | null>(null);
  // The circle a day was opened from, kept while stepping: closing that day
  // shrinks it back there, and the year puts the circle back in that spot.
  const [dayOrigin, setDayOrigin] = useState<DayOrigin | null>(null);
  // The year cascades in when it is new to the eye, and only settles when a
  // day was just closed -- that happens too often to cascade every time.
  const [yearArrival, setYearArrival] = useState<'cascade' | 'return'>('cascade');
  // The day just closed, which the year rings -- and scrolls back to, at the
  // height it was pressed at when that is known -- so it can be found again.
  const [landing, setLanding] = useState<{ date: string; y: number | null } | null>(null);
  // Which side the panel a tab brings comes in from. Zero until a tab has
  // been changed: the first paint of the page is not a change of view.
  const [panelDir, setPanelDir] = useState<-1 | 0 | 1>(0);
  // The celebration a publish throws up, and the button it is thrown from.
  const [burst, setBurst] = useState<{ id: number; at: Point } | null>(null);
  const changeView = (next: View) => {
    if (next === view) return;
    setPanelDir(tabDirection(VIEWS.indexOf(view), VIEWS.indexOf(next)) || 1);
    setView(next);
  };
  /**
   * Which labour rules this business is under. READ FROM THE SERVER, always.
   *
   * It used to be draft state, seeded from the session and then frozen in the
   * browser -- and that is a bug with two faces. A manager who picked their
   * jurisdiction changed only their own browser, because the picker never
   * called the API; and a business whose jurisdiction changed anywhere else
   * went on being planned under the old one, for ever, because the stored
   * value won. Both showed up the same way: the rules a manager had just
   * chosen did nothing, and nothing on screen said why.
   *
   * The profile is the source (it is what `PUT /profile` writes and what the
   * planner reads on the server), the session is the fallback while it loads,
   * and nothing is cached in between.
   */
  const jurisdiction =
    businessProfile.data?.jurisdiction_code ??
    user?.org_jurisdiction ??
    'ES-CT-HOSTELERIA';

  /**
   * The spec everything below works from: what the brief said, plus the law
   * where this business is.
   *
   * Derived rather than stored, and derived HERE rather than at the twenty
   * places that read it. The stored one is the manager's -- their sentences,
   * their corrections -- and it is what gets saved and reloaded; the statute
   * is not theirs to store and changes under them when they choose a
   * jurisdiction. Without this, a draft built before the Spanish rules
   * existed goes on being replanned under the American ones for ever, because
   * "reorganise" sends back the spec in the browser rather than asking the
   * server to read the brief again.
   */
  const spec = useMemo(
    () => withLabourFloor(rawSpec, laborProfiles.data ?? [], jurisdiction),
    [rawSpec, laborProfiles.data, jurisdiction],
  );
  // Left unset on purpose. The statute's floor -- the SMI over a full year --
  // is seeded, but the rate a given person is owed is their category's line in
  // their convenio's salary table, which this product does not hold. The
  // manager enters theirs; without a figure there is no underpayment warning.
  const [minWage] = useDraftState<number | null>('minWage', null);
  // Every adjustment is a step you can take back.
  const [overlay, setOverlay] = useDraftState<ScheduleOverlay>('overlay', EMPTY_OVERLAY);
  const [history, setHistory] = useDraftState<
    { result: ScheduleResult; spec: SchedulingSpec; overlay: ScheduleOverlay }[]
  >('history', []);
  const [isRefining, setIsRefining] = useState(false);
  // Any AI work in flight. One word for every control that must wait for it.
  const busy = generation !== null || isRefining;
  // Counts every calendar the AI actually delivered, so what it built arrives
  // on screen instead of just being there: the day's shifts draw themselves
  // in again, the year's months come in again. Bumped by `announceArrival`
  // at the four places an AI answer is put on screen -- a resumed job, a
  // generation, a surgical adjustment, a reorganize -- and nowhere else:
  // not when the AI failed, and not for the manager's own edits made while
  // it worked, either of which would announce a calendar that is not there.
  // Set in the same batch as the result, so the new shifts are never drawn
  // once whole and then again from nothing.
  const [landedAt, setLandedAt] = useState(0);
  const announceArrival = useCallback(() => setLandedAt((n) => n + 1), []);
  // The calendar on screen NOW. An AI answer arrives in a closure from the
  // render that asked, holding the calendar as it was then; the grid stays
  // editable meanwhile, so the answer has to be landed on this instead of
  // written over it -- see `keepHandEdits`.
  const onScreen = useRef({ result, overlay });
  useEffect(() => {
    onScreen.current = { result, overlay };
  }, [result, overlay]);
  // People the brief did NOT mention. Retiring someone is the one roster change
  // that is never automatic, so it waits here for a confirmation.
  const [teamPlan, setTeamPlan] = useDraftState<RosterPlan | null>('teamPlan', null);
  const [isApplyingTeam, setIsApplyingTeam] = useState(false);
  // What the brief just did to the roster, so the manager sees it happen.
  const [teamNote, setTeamNote] = useDraftState<string[]>('teamNote', []);
  // Why the last AI call failed, and WHICH call it was. All three refuse
  // rather than guess, but they refuse different things: the brief builds a
  // calendar, the adjustment changes the one already on screen, and the third
  // is the model saying a request cannot be done at all. Telling a manager
  // their brief could not be read, when what failed was "give Ana Friday off",
  // sends them to rewrite a paragraph that was never the problem.
  //
  // `prose` says the text is the model's own sentences, written for the
  // manager. That is a fact about where the message came from, so it travels
  // with it rather than being re-derived by the banner from the kind.
  const [aiError, setAiError] = useState<{
    kind: 'intake' | 'refine' | 'unsupported';
    text: string;
    prose: boolean;
  } | null>(null);
  // Months Claude could not plan, so the calendar for them is the greedy
  // pass's own work. Not an error -- there IS a calendar -- but the manager is
  // told, because a rota they believe was reasoned about and one that was
  // filled by a heuristic deserve different amounts of trust from them.
  const [unplannedMonths, setUnplannedMonths] = useState<string[]>([]);
  // What the last adjustment or reorganisation did, per person. Not part of
  // the draft: it describes a transition, and a reload has nothing to
  // compare against.
  // `skipped` is what the adjustment asked for and could not honour, each
  // with its reason. It was computed and thrown away before: a manager who
  // asked for Ana on Friday and got "nothing changed" had no way to know Ana
  // is on leave that week. One state, because the two halves describe the
  // same event and a `setLastChange` without its pair would leave the old
  // reasons under the new diff.
  const [lastChange, setLastChange] = useState<{
    diff: ScheduleDiff;
    skipped: string[];
  } | null>(null);
  // What the adaptive layer contributed to the calendar on screen, what it had
  // to assume, and what businesses like this one usually do. Drafted state:
  // it describes THIS calendar, so it must survive a change of screen with it.
  const [, setProfileApplied] = useDraftState<AppliedHint[]>(
    'profileApplied',
    [],
  );
  const [, setProfileGaps] = useDraftState<SpecGap[]>('profileGaps', []);
  const [, setDeclared] = useDraftState<Declaration[]>('declared', []);
  const [, setProfileSuggestions] = useDraftState<
    ProfileSuggestion[]
  >('profileSuggestions', []);
  // Requirements the manager stated that need one number from them. Drafted
  // with the calendar they belong to, so changing screen does not lose the
  // question — the sentence that raised it is not asked again.
  const [questions, setQuestions] = useDraftState<OpenQuestion[]>('questions', []);
  // Corrections are reported after they land, never before. Fire-and-forget:
  // a failure to record why must not surface as a failure to schedule.
  const recordObservations = useRecordObservations();
  // The questions a brand-new account is asked once, and never again. The
  // server decides whether they are owed (`first_run_pending`); the local flag
  // is what makes putting them away instant -- skipping must not wait on a
  // round trip to hand the manager back their dashboard.
  const [firstRunClosed, setFirstRunClosed] = useState(false);
  const showFirstRun =
    !firstRunClosed && businessProfile.data?.first_run_pending === true;
  // Being asked instead of writing. Takes the place of the brief box or the
  // first-run questions while it is open. What the manager approves at the
  // end is kept on their business profile, so every brief after this one is
  // read by a planner that already knows the business.
  const interviewStatus = useInterviewStatus();
  const interviewOffered = interviewStatus.data?.available === true;
  // The business assistant: shown only when the server says it exists (a
  // switch and two ids; off by default). Closing the panel keeps the
  // conversation, so the manager can check the calendar and come back.
  const assistantStatus = useAssistantStatus();
  const assistantOffered = assistantStatus.data?.enabled === true;
  const [assistantOpen, setAssistantOpen] = useState(false);
  const completeInterview = useCompleteInterview();
  // Opened from a button here; a NEW account is interviewed on the welcome
  // screen instead, before it ever reaches this page (see FirstRunGate).
  const [interviewing, setInterviewing] = useState(false);
  /**
   * Asked before a SECOND round of the fixed questions, never before the first.
   *
   * A new interview replaces the old one whole -- what you told us, the week's
   * hours, and what we went and read about your business. That is the right
   * behaviour and it is not one to discover afterwards: the button that
   * starts it sits next to the brief box, one row from "Adjust", and the
   * screen it opens looks like a friendly chat rather than like something
   * that just forgot a paragraph the manager wrote in April.
   */
  const [confirmingInterview, setConfirmingInterview] = useState(false);
  const interviewedBefore = Boolean(businessProfile.data?.interview_notes);
  const startInterview = useCallback(() => {
    if (interviewedBefore) setConfirmingInterview(true);
    else setInterviewing(true);
  }, [interviewedBefore]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const manualSeq = useRef(0);

  const briefMonths = spec.horizonMonths ?? null;

  /**
   * The window that is planned, and therefore saved. Whole months, always.
   *
   * STATE, not a derivation of `focus`, and the difference is a bug that
   * reached production. Deriving it from where the manager was looking meant
   * that closing a day -- which puts the focus back on the year, and a year
   * has no month -- silently moved the period to January. Pressing a day in
   * October then read as leaving the month, dropped the calendar and reported
   * that none had been made.
   *
   * Which was the very mistake this view was built to remove, made one layer
   * further in. So the period is now only ever set on purpose: when a brief
   * names one, or when a day outside it is opened. Looking cannot reach it.
   */
  const [periodStart, setPeriodStart] = useDraftState('periodStart', () =>
    dateKey(new Date()),
  );
  const period = useMemo(
    () => monthWindow(fromDateKey(periodStart), briefMonths),
    [periodStart, briefMonths],
  );
  const anchor = useMemo(() => new Date(period.from), [period]);
  /**
   * The first day of the period that is planned, when it is not the 1st: a
   * first calendar for the month already under way starts today (see
   * lib/onboarding/firstMonth). Set only by a generation that was handed a
   * month; kept for the window it was set in.
   */
  const [periodFloor, setPeriodFloor] = useDraftState<string | null>('periodFloor', null);
  // The month picked in the interview, kept so that running the brief again
  // -- it stays open beside the first calendar for exactly that -- plans the
  // same month. The brief itself never names it (see lib/onboarding/firstMonth).
  const [firstMonth, setFirstMonth] = useDraftState<FirstMonthPick | null>('firstMonth', null);
  // The month as it is SHOWN -- every day of it, the ones already gone
  // included, so the folders keep their shape -- and as it is PLANNED.
  // Everything that generates, summarises or saves reads `days`.
  const shownDays = useMemo(() => daysOfWindow(period), [period]);
  const days = useMemo(() => daysFromFloor(shownDays, periodFloor), [shownDays, periodFloor]);
  // Publishing replaces every row in the window it is sent. A period planned
  // from a floor is published from that floor, so what the team already had
  // on the days before it is left where it was.
  const publishFrom = useMemo(
    () => (days[0] ? fromDateKey(days[0].date) : period.from),
    [days, period],
  );
  // A floor holds only while the calendar has nothing before it. Shifts there
  // -- the team's published rota seeded in, a draft from another browser that
  // never had the floor, one added by hand -- mean the month is being kept
  // whole, and a floor left standing would hide them from every rebuild and
  // publish a window that does not contain them (the server refuses that).
  useEffect(() => {
    if (!periodFloor || !result) return;
    const first = dateKey(period.from);
    if (periodFloor <= first || periodFloor >= dateKey(period.to)) return;
    if (result.assignments.some((a) => a.date >= first && a.date < periodFloor)) {
      setPeriodFloor(null);
    }
  }, [result, periodFloor, period, setPeriodFloor]);

  // --- Folders ------------------------------------------------------------
  // A week is read straight through; a month and a year are read through
  // folders, so the period is grouped once here and both views read the same
  // grouping. Months always come back split into four weeks, whatever the
  // month's length.
  const months = useMemo(() => monthsOf(shownDays), [shownDays]);
  // Overnight shifts can spill into the next day, so a day needs the one before
  // it even when a folder boundary sits between them -- the neighbour comes
  // from the whole period, never from the folder. The whole DayRef travels,
  // not just its date, because the grid has to know the HOURS that day kept to
  // tell an overnight shift it has already drawn from one it still owes a row.
  const prevDays = useMemo(() => {
    const out = new Map<string, DayRef | null>();
    shownDays.forEach((d, i) => out.set(d.date, i > 0 ? shownDays[i - 1] : null));
    return out;
  }, [shownDays]);

  const roster = useMemo(
    () => (employees.data ?? []).filter((e) => e.employment_status !== 'resigned'),
    [employees.data],
  );

  /**
   * Why the calendar came back empty, when it did. See `explainEmptyCalendar`:
   * it answers across the whole period rather than from one sampled day, and
   * it separates "this team has not started yet" — which is not a fault —
   * from an obstacle the manager can actually act on.
   */
  const emptyCalendar = useMemo(
    () =>
      explainEmptyCalendar(
        result,
        spec,
        days,
        roster,
        absences.data ?? [],
        absenceTypes.data ?? [],
      ),
    [result, spec, days, roster, absences.data, absenceTypes.data],
  );

  // --- Pay policy ---------------------------------------------------------
  // Stored on the org, not in this component, because the team reads it too:
  // an employee's pay estimate has to be the same arithmetic as the payroll
  // table below. Edited in Settings; read here to price the roster.
  const [payPolicy] = usePayPolicyEditor();

  // --- Publish to team ----------------------------------------------------
  // The draft lives in this component; what the team sees lives on the server.
  // Publishing is the handover — the only way a shift becomes visible to an
  // employee. What is published is also where a period STARTS when there is
  // no draft, and what a publish is compared against before it happens.
  // The window the draft is saved over: the period itself, not a span read
  // back off the days on screen. Same dates `savedWindow` already decided.
  const bounds = period;
  const publish = usePublishSchedule();

  // --- The draft on the server ------------------------------------------
  // What is on screen is also kept on the server, per window, so the same
  // unpublished draft is on the office laptop and on the phone. localStorage
  // stays what it was: a cache, for the instant first paint. The decisions
  // -- is a load news or an echo, is a change worth a PUT -- are pure and
  // live in ./draftSync; this component only wires them to state.
  //
  // `syncMarks` is what this browser knows about each window: the server's
  // draft as last exchanged, and the published rota as last seen. Drafted
  // state rather than a ref on purpose: a reload straight after an edit must
  // still know that the edit was never sent, and a remount must not mistake
  // its own unsent change for something the server holds.
  const [syncMarks, setSyncMarks] = useDraftState<Record<string, SyncMark>>('draftSync', {});
  const draftKey = windowKey(bounds.from, bounds.to);
  const mark = syncMarks[draftKey] ?? NO_MARK;
  const remember = useCallback(
    (key: string, patch: Partial<SyncMark>) => {
      setSyncMarks((all) => {
        const current = all[key] ?? NO_MARK;
        const next = { ...current, ...patch };
        const same = (a: Snapshot | null, b: Snapshot | null) =>
          a === b || (a !== null && b !== null && sameSnapshot(a, b));
        if (same(current.server, next.server) && same(current.rota, next.rota)) return all;
        // Insertion order is the age order; a window revisited moves to the end.
        const kept = Object.entries(all)
          .filter(([k]) => k !== key)
          .slice(-(SYNC_MARKS_KEPT - 1));
        return { ...Object.fromEntries(kept), [key]: next };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const draft = useDraftSchedule(
    bounds.from,
    bounds.to,
    Boolean(employees.data && templates.data),
  );
  const saveDraft = useSaveDraft();
  const draftEmpty = draft.isSuccess && draft.data.length === 0;
  // The published rota is SEEDED FROM only once the server has said there is
  // no draft (or could not say): it is what a period starts from when nothing
  // is drafted anywhere. The publish dialog reads it again, fresh, on its own.
  const publishedWanted = result === null && (draftEmpty || draft.isError);
  // It is READ more often than that: with a calendar on screen it is the only
  // way to know which months the team already has, and a replan leaves those
  // alone unless asked. Seeding still waits for `publishedWanted` -- the
  // effects below guard on it -- so this only adds a GET the publish dialog
  // was going to make anyway.
  const published = usePublishedSchedule(
    bounds.from,
    bounds.to,
    publishedWanted || result !== null,
  );

  // Which days of the year carry shifts, for the grid. Asked for only while
  // the year is the thing on screen -- and cheap when it is: two fields per
  // shift rather than whole assignments.
  const marks = useShiftMarks(yearOf(focus), focus.kind === 'year');

  // The working year. Asked for only while its own tab is open: it reads the
  // whole year on the server, which is the point of it and also the reason not
  // to pay for it on every calendar render.
  const workday = useWorkday(bounds.from, bounds.to, view === 'workday');

  // Where everybody stands on PUBLISHED hours, measured against the window
  // being edited. The column beside the calendar lays the draft over this to
  // answer "if I publish, who ends up short?" -- which is why the window
  // travels with the request: it brings back the hours publishing would
  // overwrite, and without them the draft would be counted on top of a rota it
  // actually replaces. See lib/schedule/projectedBalance.
  //
  // Asked for only while the calendar is open AND there is a draft to project:
  // the server reads a whole year of assignments to answer it, and with
  // nothing to publish there is no question to ask.
  const balances = useBalances(view === 'calendar' && result !== null, bounds);

  /**
   * The months of this period the team has already been given.
   *
   * Read through `fromAssignmentOutList` rather than by slicing `start_at`:
   * the rows carry a UTC instant and the calendar is filed by LOCAL day, so a
   * shift starting at 23:00 on the 31st would be filed under the wrong month
   * -- exactly at the boundary this is used to defend.
   */
  const publishedMonths = useMemo(() => {
    if (!published.data || !templates.data) return new Set<string>();
    return new Set(
      fromAssignmentOutList(published.data, templates.data).map((a) =>
        a.date.slice(0, 7),
      ),
    );
  }, [published.data, templates.data]);

  /**
   * The month the manager is actually looking at.
   *
   * It used to be a guess: a year was twelve folders, eleven of them shut, so
   * "the period being viewed" had to be inferred from which one was open, with
   * two fallbacks for when none or several were. Now either a day is open or
   * the year is, and both answer this in one line -- which matters because a
   * replan scopes itself to this month, and a scope arrived at by guesswork
   * could not be explained on screen.
   */
  const focusMonth = useMemo(
    () => (focus.kind === 'day' ? focus.date.slice(0, 7) : months[0]?.key ?? null),
    [focus, months],
  );

  /**
   * The scope control the adjustment bar shows, or null when there is nothing
   * to ask: a period of one month makes both answers the same rota, and a
   * question whose answers cannot differ is worse than no question.
   *
   * The published months offered are the ones inside the CHOSEN scope, so the
   * box says what ticking it would actually replan rather than listing months
   * the current choice was never going to reach.
   */
  const replanScope = useMemo<ReplanScope | null>(() => {
    if (months.length < 2 || focusMonth === null) return null;
    const withoutPublished = planningScope(days, {
      scope: planScope,
      focus: focusMonth,
      published: publishedMonths,
      includePublished: false,
    });
    return {
      value: planScope,
      onChange: setPlanScope,
      focus: focusMonth,
      horizonMonths: months.length,
      published: cutFor(withoutPublished, 'published'),
      includePublished,
      onIncludePublishedChange: setIncludePublished,
    };
  }, [
    months.length,
    focusMonth,
    days,
    planScope,
    setPlanScope,
    publishedMonths,
    includePublished,
  ]);

  // Permission to rewrite a rota the team already has belongs to the period it
  // was given in. The box is only drawn when there IS a published month in
  // scope, so a tick carried over from another window would sit invisible
  // until the click that used it.
  useEffect(() => {
    setIncludePublished(false);
  }, [draftKey]);

  // "New calendar" asked for an empty one: no seeding until a brief is read
  // or the manager moves to another period.
  const [blockSeed, setBlockSeed] = useDraftState('blockSeed', false);

  // A load came back. THE SERVER WINS when it holds something this browser
  // has not seen: the rows become the calendar, summarised under the local
  // spec when there is one for this window, seeded like a published rota
  // when there is not. An echo of our own save, or the rows already on
  // screen, changes nothing -- and what is being typed over stays.
  useEffect(() => {
    if (!draft.data) return;
    if (!templates.data || !employees.data || !absences.data || !absenceTypes.data) return;
    const rows = fromAssignmentOutList(draft.data, templates.data);
    const action = resolveLoad(rows, result?.assignments ?? null, mark);
    remember(draftKey, { server: snapshotOf(rows) });
    if (action === 'keep') return;
    // What was on screen goes into the history rather than into the void:
    // the server won, but an hour of edits that never got sent is one Undo
    // away, and undoing sends it.
    if (result !== null) setHistory((h) => [...h, { result, spec, overlay }].slice(-20));
    setLastChange(null);
    setBlockSeed(false);
    if (action === 'clear') {
      setResult(null);
      setSpec(DEFAULT_SPEC);
      setOverlay(EMPTY_OVERLAY);
      setShowPrompt(true);
      return;
    }
    if (result !== null || rebuildOnEmpty.current) {
      // Adopted under this browser's rules, and PINNED: the generator starts
      // from the pins on the next rebuild, so pins left from the calendar
      // before would quietly bring it back over the other browser's work.
      rebuildOnEmpty.current = false;
      setResult(summarize(rows, employees.data, absences.data, absenceTypes.data, spec, days, payPolicy));
      setOverlay({ ...overlay, pinned: rows });
      return;
    }
    const seeded = seedFromRows(
      draft.data,
      employees.data,
      templates.data,
      absences.data,
      absenceTypes.data,
      days,
      payPolicy,
    );
    setResult(seeded.result);
    setSpec(seeded.spec);
    setOverlay(seeded.overlay);
    setShowPrompt(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.data, templates.data, employees.data, absences.data, absenceTypes.data]);

  // Open a period with nothing drafted -- here or on the server -- and the
  // team's rota for it becomes the draft: pinned, under a spec that asks for
  // nobody, so no rebuild can invent anything around it. Waits for
  // everything the summary reads -- absences included -- so what is saved is
  // right first time. Remembered as the rota, not as a draft: a calendar
  // equal to what the team has is nothing to send to the server.
  useEffect(() => {
    if (result !== null || blockSeed || !publishedWanted) return;
    if (!published.data || published.data.length === 0) return;
    if (!templates.data || !employees.data || !absences.data || !absenceTypes.data) return;
    const seeded = seedFromRows(
      published.data,
      employees.data,
      templates.data,
      absences.data,
      absenceTypes.data,
      days,
      payPolicy,
    );
    remember(draftKey, { rota: snapshotOf(seeded.result.assignments) });
    setResult(seeded.result);
    setSpec(seeded.spec);
    setOverlay(seeded.overlay);
    setShowPrompt(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, blockSeed, publishedWanted, published.data, templates.data, employees.data, absences.data, absenceTypes.data, days]);
  // The brief box must not appear and then vanish under a seed that lands a
  // moment later, taking half a typed brief with it.
  // A brief-born calendar moved to a window the server has nothing for --
  // no draft, no published rota. The window stays EMPTY and says so, with
  // one button that plans it under the same rules.
  //
  // It used to plan the window by itself, and the result was saved as that
  // window's draft. So paging past a month, or a reload landing on one,
  // quietly wrote a whole calendar nobody asked for: on 19-sep-2026 a
  // manager came back from a restart to "January done out of nowhere", with
  // the October they HAD planned out of sight, and read it as October
  // deleted. Moving around the calendar must never write to it.
  const rebuildOnEmpty = useRef(false);
  const [unplannedWithRules, setUnplannedWithRules] = useState(false);
  useEffect(() => {
    if (!rebuildOnEmpty.current || result !== null) return;
    if (!publishedWanted || !published.isSuccess || published.data.length > 0) return;
    rebuildOnEmpty.current = false;
    setUnplannedWithRules(true);
  }, [result, publishedWanted, published.isSuccess, published.data]);
  // The offer belongs to the window it was made in, and ends the moment the
  // window has a calendar of any origin.
  useEffect(() => {
    if (result !== null) setUnplannedWithRules(false);
  }, [result]);
  useEffect(() => {
    setUnplannedWithRules(false);
  }, [draftKey]);

  /** The manager's own "yes, plan this month too". The draft effect saves it. */
  const planUnplanned = useCallback(() => {
    if (!employees.data || !templates.data) return;
    setUnplannedWithRules(false);
    setResult(
      generateSchedule(
        employees.data,
        templates.data,
        absences.data ?? [],
        absenceTypes.data ?? [],
        spec,
        days,
        overlay,
        payPolicy,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees.data, templates.data, absences.data, absenceTypes.data, spec, days, overlay, payPolicy]);

  // A list that failed to load leaves the draft query disabled, and a
  // disabled query is pending forever: the brief box must not wait on it.
  const listsFailed = employees.isError || templates.isError;
  const seedPending =
    result === null &&
    !blockSeed &&
    !listsFailed &&
    (draft.isPending || (publishedWanted && published.isPending));

  // Send the window. A promise rather than mutate-callbacks so the outcome
  // is handled even when the page has been left in the meantime. A failure
  // is logged and nothing else: the draft stays, on screen and in this
  // browser, and the next change sends it again.
  // The last save that failed, shown until one succeeds. Silence here would
  // mean a window that quietly stopped syncing -- a 409 from two overlapping
  // shifts, a 422 after somebody was removed -- while the phone kept
  // showing the draft of before.
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const sendDraft = useCallback(
    (key: string, from: Date, to: Date, assignments: Assignment[]) => {
      saveDraft
        .mutateAsync({ from, to, assignments })
        .then(() => {
          remember(key, { server: snapshotOf(assignments) });
          setDraftSaveError(null);
        })
        .catch((err: unknown) => setDraftSaveError(getErrorMessage(err)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saveDraft.mutateAsync, remember],
  );

  // The save that is waiting for the manager to pause. Held in a ref so a
  // change of window, or leaving the page, can send it now rather than lose
  // it: the debounce is there to coalesce a drag, not to drop its result.
  const pendingSave = useRef<{ timer: ReturnType<typeof setTimeout>; fire: () => void } | null>(null);
  const flushPendingSave = useCallback(() => {
    const pending = pendingSave.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingSave.current = null;
    pending.fire();
  }, []);
  const dropPendingSave = useCallback(() => {
    if (pendingSave.current) clearTimeout(pendingSave.current.timer);
    pendingSave.current = null;
  }, []);
  // Declared before the debounce below: on a window change both clean up,
  // in this order, and the flush has to see the timer before it is cleared.
  useEffect(() => flushPendingSave, [draftKey, flushPendingSave]);

  // Every change to the calendar -- an edit, a refinement, a generation, an
  // undo -- reaches the server a moment after the last one. Also re-checked
  // when the load settles or the mark moves: an edit made before a reload,
  // whose send never fired, is sent once the server has been read.
  // Never a cut-down copy. A shift that starts outside the window, or ends
  // before it starts, fails this PUT (see `withinWindow`), and what to do
  // about one depends on why it is there:
  //  - mid-generation, the screen still holds the period before (a brief of
  //    October to December asked again for November alone): nothing is sent
  //    until the new calendar lands;
  //  - a draft carrying strays among shifts of this window: nothing is sent
  //    this render, and the clean-up further down fixes it, out loud, before
  //    the next one;
  //  - nothing of this window at all (another period's calendar): sent as it
  //    is, so the server's refusal is on screen rather than a silence.
  const screen = useMemo(() => {
    if (!result) return null;
    const { inside, outside } = withinWindow(result.assignments, bounds.from, bounds.to);
    if (outside.length === 0 || (!busy && inside.length === 0)) return result.assignments;
    return null;
  }, [result, bounds, busy]);
  useEffect(() => {
    if (!shouldSave(screen, mark, draft.isPending)) return;
    const assignments = draftOf(screen, mark.rota) ?? [];
    const { from, to } = bounds;
    const fire = () => {
      pendingSave.current = null;
      sendDraft(draftKey, from, to, assignments);
    };
    const timer = setTimeout(fire, SAVE_DRAFT_DELAY_MS);
    pendingSave.current = { timer, fire };
    return () => {
      clearTimeout(timer);
      if (pendingSave.current?.timer === timer) pendingSave.current = null;
    };
  }, [screen, mark, draft.isPending, draftKey, bounds, sendDraft]);

  /**
   * The draft's shifts that are already on the noticeboard exactly as drafted.
   *
   * For the balance column's bar, which draws published and unpublished hours
   * in two shades. Straight after a publish the draft stays on screen and is
   * the rota itself, so all of it is here; before, only what the manager left
   * untouched. Compared by `slotKey` -- who, day, from, to -- as the rest of
   * the draft sync does, never by id.
   */
  const settledDraft = useMemo(() => {
    if (!result || !published.data || !templates.data) return null;
    const out = new Set(fromAssignmentOutList(published.data, templates.data).map(slotKey));
    return result.assignments.filter((a) => out.has(slotKey(a)));
  }, [result, published.data, templates.data]);

  const [publishOpen, setPublishOpen] = useState(false);
  // What the publish answered, kept so the dialog can turn into its own
  // receipt: how many shifts went out, how many people were emailed and how
  // many could not be. Cleared when the dialog opens, never when it closes --
  // closing is the manager saying they have read it.
  const [publishOutcome, setPublishOutcome] = useState<PublishResult | null>(null);
  // Read by the publish's answer, which arrives after the render that sent
  // it: a closed dialog gets no receipt and the page no celebration.
  const publishOpenRef = useRef(publishOpen);
  publishOpenRef.current = publishOpen;
  const openPublish = useCallback(() => {
    setPublishOutcome(null);
    setPublishOpen(true);
  }, []);
  const handlePublish = useCallback((from?: Point) => {
    if (!result) return;
    // What was just published is the rota now, and the server has dropped
    // the draft for the window: nothing on screen is left to send.
    const key = draftKey;
    const rota = snapshotOf(result.assignments);
    // Exactly what the dialog counted, never a silently filtered copy: a
    // stray shift is cleaned off the screen, with a notice, before the
    // dialog can be opened on it, and anything left is the server's to
    // refuse out loud.
    publish.mutate(
      { from: publishFrom, to: bounds.to, assignments: result.assignments },
      {
        onSuccess: (data) => {
          remember(key, { rota, server: [] });
          // The balances counted PUBLISHED hours only, which is the moment
          // that just changed: what was a projection a second ago is now the
          // firm figure, and a cached answer would leave the column beside the
          // calendar -- and the roster, and the employee's own page -- showing
          // the hours as they stood before the publish. Every window's reading
          // goes, not just this one: a quarter that overlaps these dates was
          // just as wrong.
          qc.invalidateQueries({ queryKey: ['workday'] });
          // The dialog cannot be closed while this is on its way (see
          // PublishConfirmModal); should it be closed all the same, the
          // publish stands but nothing pops up over a page that moved on.
          if (!publishOpenRef.current) return;
          // The dialog stays open and becomes the answer: "3 avisados, 1 sin
          // avisar" is the reason to publish through a dialog at all, and it
          // is worth nothing if it disappears with the dialog that earned it.
          setPublishOutcome(data);
          // And the team has it: the one moment on this screen that is
          // celebrated. From the button that was pressed, or the middle of
          // the window if the press came from somewhere without a place.
          setBurst({
            id: Date.now(),
            at: from ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 },
          });
        },
      },
    );
  }, [result, publish, bounds, publishFrom, draftKey, remember, qc]);

  /**
   * Ask the planner for a set of months, and pay twice only for the ones that
   * came out wrong.
   *
   * WHY THIS IS SAFE TO DO ON THE MAIN PATH. What comes back is a proposal,
   * not a calendar: `scheduleFromProposal` validates every shift against the
   * same rules the generator obeys, drops what breaks one, and lets the greedy
   * pass fill the holes. Feeding it `null` -- which is exactly what a failed
   * call produces -- returns the calendar this product built before the model
   * was involved at all. So the downside is bounded at "the old behaviour",
   * and there is no branch here that can produce an illegal rota.
   *
   * The second round exists because the server now plans at the model's
   * cheaper effort setting. Output is where the money goes -- around forty
   * times what the same count of input tokens costs -- so planning every month
   * expensively was paying a premium twelve times over for a year that is
   * nearly always fine either way. Cheap by default is only honest if the
   * failures are still paid for, which is what this does: `planRetry` grades
   * each month off work that is already finished (hard violations left after
   * the repair, hours the greedy pass could not cover) and the bad ones are
   * asked again at `high`.
   *
   * EXACTLY ONE EXTRA ROUND. Not a loop with a cap -- there is no second
   * grading and no third call. A month that comes back bad twice keeps what it
   * has, which is a legal rota the greedy pass filled: the outcome a failed
   * month has always had here.
   *
   * The whole period is rebuilt from the merged proposal rather than the
   * retried months being patched in on their own, because a weekly ceiling and
   * a rest gap run across a month boundary and a month judged alone cannot see
   * them.
   */
  const planMonths = useCallback(
    async (args: {
      months: string[];
      /** The days the proposal is judged against: every month in scope. */
      days: DayRef[];
      spec: SchedulingSpec;
      roster: EmployeeOut[];
      overlay?: ScheduleOverlay;
      revision?: PlanRevision;
      brief: string;
      /**
       * A job the server is already working on, instead of asking for a new
       * one. What a reopened tab hands in: those months were bought before this
       * page existed, and asking again would buy them twice.
       */
      adopt?: PlanJob;
    }): Promise<{
      result: ScheduleResult;
      failed: string[];
      /**
       * Whether the planner answered AT ALL. False only when the call itself
       * threw, and it is the difference between "the model rearranged nothing"
       * and "there was no model": a replan that never reached the server must
       * leave the calendar alone rather than hand the month to the greedy pass
       * and call that a rearrangement.
       */
      answered: boolean;
    } | null> => {
      if (args.months.length === 0) return null;
      const ids = {
        employees: args.roster.map((e) => e.id),
        templates: (templates.data ?? []).map((tpl) => tpl.id),
      };
      const ask = (months: string[], days: DayRef[], effort?: PlanEffort) =>
        planCalendar(
          buildPlanContext(
            args.roster,
            templates.data ?? [],
            absences.data ?? [],
            absenceTypes.data ?? [],
            args.spec,
            days,
            jurisdiction,
            new Date(),
            args.revision,
            args.brief,
          ),
          months,
          ids,
          {
            ...(effort ? { effort } : {}),
            onProgress: notePlanProgress,
          },
        );
      const build = (proposal: unknown) =>
        scheduleFromProposal(
          proposal,
          args.roster,
          templates.data ?? [],
          absences.data ?? [],
          absenceTypes.data ?? [],
          args.spec,
          args.days,
          args.overlay,
          payPolicy,
        );

      let proposal: unknown = null;
      let failed: string[] = [];
      let answered = false;
      try {
        const planned = args.adopt
          ? await collectPlanJob(args.adopt, { onProgress: notePlanProgress })
          : await ask(args.months, args.days);
        proposal = planned.shifts;
        failed = planned.failed ?? [];
        answered = true;
      } catch {
        // No key on the server, a timeout, a bad gateway: every one of them
        // means the same thing here, and it is not an error the manager has to
        // act on. They get a calendar; it is just ours rather than the model's.
        failed = args.months;
      }

      let outcome = build(proposal);
      const retry = monthsToRetry(
        judgeMonths(args.months, outcome.result, outcome.report),
        failed,
      );
      if (retry.length > 0) {
        setPhase('tune', { tuning: retry });
        try {
          // Asked fresh, not handed its own first attempt to improve on. The
          // planner has no way to say WHY the month was rejected -- the
          // verdict is coverage arithmetic, not prose -- so the only thing
          // sending the bad rota back would achieve is anchoring the model to
          // it.
          const again = await ask(retry, daysInMonths(args.days, retry), 'high');
          // A month the second call also could not plan keeps the first
          // attempt's shifts rather than losing them: only the months that
          // actually came back are swapped out.
          const stillFailed = new Set(again.failed ?? []);
          const landed = retry.filter((m) => !stillFailed.has(m));
          if (landed.length > 0) {
            outcome = build(mergeRetried(proposal, again.shifts, new Set(landed)));
          }
        } catch {
          // The expensive round is a bonus, never a dependency. It timing out
          // leaves the cheap month exactly as it was -- which is a calendar.
        }
      }
      return { result: outcome.result, failed, answered };
    },
    [
      templates.data,
      absences.data,
      absenceTypes.data,
      jurisdiction,
      setPhase,
      notePlanProgress,
      payPolicy,
    ],
  );

  /**
   * The calendar that was still being written when this tab was closed.
   *
   * Planning is a job on the server now: months are stored as they arrive, so
   * shutting the laptop mid-plan no longer throws away work that has been
   * billed. This is the other half of that -- without it the months would be
   * safe on disk and invisible, which is the same as lost to the person who
   * paid for them.
   *
   * ONCE, AND ONLY INTO THE SAME PERIOD. The horizon is drafted, so a reload
   * lands on the months the job was asked for and the ordinary case just works.
   * When it does not match -- the manager moved on to next year -- this does
   * nothing: the job finishes server-side either way, and the next ask joins it
   * (`generation_already_running`) rather than paying for it twice.
   */
  const resumeAttempted = useRef(false);
  useEffect(() => {
    if (resumeAttempted.current) return;
    if (!employees.data || !templates.data || days.length === 0) return;
    resumeAttempted.current = true;

    let abandoned = false;
    // Whether the resume actually got as far as doing something. StrictMode
    // mounts every effect twice in development: the first run starts, the
    // cleanup marks it abandoned, and the second run sees the ref and returns --
    // so without this the resume never happens in development and looks broken
    // in the one place it is tested by hand.
    let started = false;
    void (async () => {
      let job: PlanJob | null = null;
      try {
        job = await readLatestPlanJob();
      } catch {
        // Nothing to resume, or nobody to ask. Not worth a word on screen.
        return;
      }
      if (!job || !planJobIsLive(job) || abandoned) return;

      const onScreen = new Set(monthsOfDays(days));
      if (!job.months.every((month) => onScreen.has(month))) return;

      const roster = employees.data;
      if (!roster) return;
      const live = job;
      started = true;
      await runGeneration(
        {
          mode: 'generate',
          phase: 'plan',
          months: live.months.length,
          done: live.done.length,
          startedAt: Date.now(),
        },
        async () => {
          const planned = await planMonths({
            months: live.months,
            days,
            spec,
            roster,
            overlay,
            brief: briefInEffect,
            adopt: live,
          });
          if (abandoned) return;
          setUnplannedMonths(planned?.failed ?? live.months);
          if (planned) {
            setResult(planned.result);
            announceArrival();
          }
        },
      );
    })();

    return () => {
      abandoned = true;
      // Nothing was under way, so this mount does not count as the attempt.
      if (!started) resumeAttempted.current = false;
    };
    // Deliberately not re-run when spec or overlay change: the ref makes this a
    // once-per-mount question, and what it reads is what is in effect when the
    // answer arrives.
  }, [employees.data, templates.data, days.length]);

  const handleGenerate = useCallback(
    async (
      text: string,
      options?: {
        /**
         * The month ("YYYY-MM") the manager picked in the interview. It
         * outranks whatever period the brief implies -- it was asked for by
         * name -- and when it is the month already under way, only what is
         * left of it is planned.
         */
        month?: FirstMonthPick | null;
      },
    ) => {
      if (!employees.data || !templates.data) return;
      setPrompt(text);
      await runGeneration({ mode: 'generate', phase: 'interpret', startedAt: Date.now() }, async () => {
        // Intake: ask Claude to compile the brief into the closed spec schema.
        // If the server has no API key (503) or the call fails, fall back to the
        // local parser so the product still works. Either way the manager sees
        // the resulting rules and can regenerate.
        let nextSpec: SchedulingSpec = DEFAULT_SPEC;
        // The team the brief described, if any. Only Claude extracts it; the
        // local fallback parser leaves it empty (graceful degradation).
        let nextTeam: TeamMemberSpec[] = [];
        if (text.trim()) {
          try {
            const interpreted = await interpretBrief(text);
            nextSpec = interpreted.spec;
            nextTeam = interpreted.team ?? [];
            setProfileApplied(interpreted.applied ?? []);
            setProfileGaps(interpreted.gaps ?? []);
            setDeclared(interpreted.declared ?? []);
            setProfileSuggestions(interpreted.suggestions ?? []);
            setQuestions(interpreted.questions ?? []);
          } catch (err) {
            // No AI, no calendar. Falling back to the local regex parser here
            // produced a calendar that quietly ignored half the brief and said
            // so only in a small label -- the manager read it as the AI having
            // understood them. Refusing is the honest answer: nothing is built
            // on an interpretation that never happened.
            setAiError({ kind: 'intake', text: getErrorMessage(err), prose: false });
            return;
          }
        }
        setAiError(null);
        setPhase('roster');

        // Reconcile the described team against the real roster (client-side; the
        // roster never goes to the model).
        const plan = nextTeam.length
          ? reconcile(nextTeam, employees.data ?? [], todayISO())
          : null;

        // Additions and term changes are written immediately: saying "we're three
        // people" IS the instruction to have three people, and asking the manager
        // to tick three boxes before a calendar can exist is the friction this
        // product is meant to remove. Retiring someone is the exception — it is
        // never inferred from an omission, so it stays a confirmation below.
        let workingRoster = roster;
        const note: string[] = [];
        if (plan && (plan.creates.length > 0 || plan.updates.length > 0)) {
          try {
            await applyRosterPlan(
              plan,
              {
                creates: new Set(plan.creates.map((c) => c.key)),
                updates: new Set(plan.updates.map((u) => u.key)),
                resignations: new Set<string>(),
              },
              todayISO(),
            );
            await qc.invalidateQueries({ queryKey: queryKeys.employees });
            const fresh = await employees.refetch();
            workingRoster = (fresh.data ?? []).filter(
              (e) => e.employment_status !== 'resigned',
            );
            // Nothing is announced when it works. Adding the people a brief
            // named is what the manager just asked for, and they can see the
            // result in the calendar and in Employees; a green receipt listing
            // four names back at them is the product congratulating itself.
          } catch (err) {
            note.push(
              t('dashboard.teamNote.failed', { reason: getErrorMessage(err) }),
            );
          }
        }
        setTeamNote(note);
        setTeamPlan(
          plan && plan.resignations.length > 0
            ? { creates: [], updates: [], resignations: plan.resignations }
            : null,
        );

        // A horizon the brief asked for outranks the toolbar: the manager said
        // it in words, which is more specific than a button they left on a
        // default. The days are computed here rather than read from `days`,
        // which still holds the previous horizon at this point.
        // "Solo el mes de octubre" says WHICH period, not just how long, so the
        // calendar moves to it instead of building October's rules over whatever
        // week the toolbar was showing.
        // What is PLANNED comes from the brief, never from the toolbar: see
        // lib/schedule/planPeriod. The toolbar is for looking.
        // The interview's month, when there is one: handed in now, or picked
        // earlier and this is the same brief run again over the same month.
        // A brief that names its own period outranks the second case.
        const briefDated = nextSpec.horizonStart != null || nextSpec.horizonMonths != null;
        const pick =
          options?.month ??
          (!briefDated && firstMonth && firstMonth.month === dateKey(anchor).slice(0, 7)
            ? firstMonth
            : null);
        if (pick) {
          nextSpec = { ...nextSpec, horizonStart: `${pick.month}-01`, horizonMonths: 1 };
        }
        // Planned from today only while nothing before today is on the
        // calendar. A month that already has its first weeks -- published, or
        // drafted by hand -- is replanned whole, as any brief replans it:
        // leaving those weeks out would show them blank and publish around them.
        const earlier =
          pick?.from != null &&
          (result?.assignments ?? []).some(
            (a) => a.date >= `${pick.month}-01` && a.date < (pick.from as string),
          );
        const floor = pick ? (earlier ? null : pick.from) : periodFloor;
        const briefStart = parseDayKey(nextSpec.horizonStart ?? null);
        const briefSpan = nextSpec.horizonMonths ?? null;
        const period = planPeriodFor({
          briefStart,
          briefMonths: briefSpan,
          today: new Date(),
          anchor,
        });
        const nextAnchor = period.anchor;
        // The days that will be PLANNED: whole months, from the period the
        // brief named. The same window that will be saved -- there is no
        // longer a second answer to which days these are.
        const nextDays = daysFromFloor(
          daysOfWindow(monthWindow(nextAnchor, briefSpan)),
          floor,
        );
        // The period the brief asked for, set here and nowhere else.
        setPeriodStart(dateKey(nextAnchor));
        if (pick) setPeriodFloor(floor);
        if (options?.month) setFirstMonth(options.month);
        // Land the manager on the first day of what was just planned. The
        // year stays one press away, and a calendar nobody can see is worse
        // than one opened somewhere they did not ask for.
        setFocus({ kind: 'day', date: nextDays[0]?.date ?? dateKey(nextAnchor) });

        // What a good calendar means to THIS business, on the spec the generator
        // is about to read.
        //
        // Done here rather than server-side because the weights live next to the
        // generator: the intake returns a spec, not a rota, and teaching it the
        // numbers would put two halves of the product in a position to disagree
        // about them. It is also deliberately NOT part of the brief -- the intake
        // schema is at its complexity ceiling, and this is a standing fact about
        // the business rather than something said in one paragraph.
        //
        // Unset when nobody has chosen, which is what keeps every existing
        // customer's calendar exactly as it is.
        nextSpec = { ...nextSpec, objective: objectiveFor(businessProfile.data?.objective) };

        setSpec(nextSpec);
        setOverlay(EMPTY_OVERLAY);
        setHistory([]);

        // Ask Claude for the rota itself, a month per call. The whole brief is
        // planned here, never a slice of it: the manager asked for this period
        // in words, and answering half of it would be a different calendar
        // rather than a cheaper one. Scoping is for REPLANS, where the period
        // already has a rota and most of it is not in question -- see
        // `handleReorganize`.
        //
        // The intake above refuses rather than degrades, and that is still right:
        // without an interpretation there are no RULES, and a calendar built on
        // rules nobody wrote is a lie. Here the rules exist and are the manager's
        // own -- only the quality of the arrangement is at stake -- so degrading
        // is the honest answer instead, provided we say so, which `plannedBy` does.
        const months = monthsOfDays(nextDays);
        setPhase('plan', { months: months.length });
        const planned = await planMonths({
          months,
          days: nextDays,
          spec: nextSpec,
          roster: workingRoster,
          brief: text,
        });
        setUnplannedMonths(planned?.failed ?? months);

        const built =
          planned?.result ??
          generateSchedule(
            workingRoster,
            templates.data ?? [],
            absences.data ?? [],
            absenceTypes.data ?? [],
            nextSpec,
            nextDays,
            EMPTY_OVERLAY,
            payPolicy,
          );
        setResult(built);
        announceArrival();
        setBriefInEffect(text);
        setBlockSeed(false);
        // Generating folds the brief away, the first run included: once there
        // is a draft the calendar is the screen, and "Edit requirements"
        // brings the brief back.
        setShowPrompt(false);
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      });
    },
    [
      employees,
      roster,
      qc,
      templates.data,
      absences.data,
      absenceTypes.data,
      focus,
      anchor,
      t,
      businessProfile.data?.objective,
      runGeneration,
      setPhase,
      planMonths,
      payPolicy,
      periodFloor,
      setPeriodFloor,
      firstMonth,
      setFirstMonth,
      result,
    ],
  );

  // The welcome screen ends by handing over the brief it produced, so a
  // manager lands here on a calendar being built rather than on an empty
  // one. Router state, not a query param: it is gone on the next navigation
  // and a reload, which is right -- the brief was already kept on the
  // profile, and this page must not build it again every time it mounts.
  const location = useLocation();
  const navigate = useNavigate();
  const handoffState = location.state as WelcomeHandoff | null;
  const handoff = handoffState?.brief ?? null;
  const handoffMonth = handoffState?.month ?? null;
  const handoffTaken = useRef(false);
  useEffect(() => {
    if (!handoff || handoffTaken.current) return;
    if (!employees.data || !templates.data) return;
    handoffTaken.current = true;
    navigate(location.pathname, { replace: true, state: null });
    void handleGenerate(handoff, { month: handoffMonth });
  }, [handoff, handoffMonth, employees.data, templates.data, handleGenerate, navigate, location.pathname]);

  /**
   * Write the confirmed roster changes, then rebuild the draft over the new
   * team. This is where the brief "feeds back": once the people are real rows,
   * the calendar, hours & pay and time-off all read them automatically.
   */
  const handleApplyTeam = useCallback(
    async (selection: ApplySelection) => {
      if (!teamPlan) return;
      setIsApplyingTeam(true);
      try {
        await applyRosterPlan(teamPlan, selection, todayISO());
        // Refresh the roster everywhere (Employees page, detail, this draft).
        await qc.invalidateQueries({ queryKey: queryKeys.employees });
        const fresh = await employees.refetch();
        const nextRoster = (fresh.data ?? []).filter(
          (e) => e.employment_status !== 'resigned',
        );
        setResult(
          generateSchedule(
            nextRoster,
            templates.data ?? [],
            absences.data ?? [],
            absenceTypes.data ?? [],
            spec,
            days,
            overlay,
            payPolicy,
          ),
        );
        setTeamPlan(null);
      } finally {
        setIsApplyingTeam(false);
      }
    },
    [teamPlan, qc, employees, templates.data, absences.data, absenceTypes.data, spec, days, overlay, payPolicy],
  );

  const handleDismissTeam = useCallback(() => setTeamPlan(null), []);

  /** Re-derive all totals after a manual edit, so numbers never drift. */
  const applyEdit = useCallback(
    (nextAssignments: Parameters<typeof summarize>[0]) => {
      setResult(
        summarize(
          nextAssignments,
          roster,
          absences.data ?? [],
          absenceTypes.data ?? [],
          spec,
          days,
          payPolicy,
        ),
      );
    },
    [roster, absences.data, absenceTypes.data, spec, days, payPolicy],
  );

  // A draft that already carries a shift outside its window -- placed by a
  // refinement before it checked the date, and kept since in this browser's
  // storage -- is cleaned rather than left to fail every save for good. Said
  // out loud: the manager was told that shift was added.
  //
  // Whenever the calendar changes and nothing is being generated -- never
  // mid-generation, when the screen still holds the calendar of the period
  // before (see `screen`) and cutting it down would announce strays that are
  // not. It cannot loop: the pins that would bring a stray back on a rebuild
  // go with it (see `validPins`), so a cleaned calendar stays clean.
  const [strayDropped, setStrayDropped] = useState(0);
  // A hand edit refused because it would start outside the window: the
  // reason, until the next edit that lands or a change of window.
  // Kept with the day it was made on, so only that day's grid shows it.
  const [editRefused, setEditRefused] = useState<{ date: string; text: string } | null>(null);
  useEffect(() => {
    setStrayDropped(0);
    setEditRefused(null);
  }, [draftKey]);
  // A new calendar is on its way: the notice was about the one before.
  useEffect(() => {
    if (busy) setStrayDropped(0);
  }, [busy]);
  useEffect(() => {
    if (!result || busy) return;
    // The summary below reads the team and its absences.
    if (!employees.data || !absences.data) return;
    const cleaned = cleanStrays(result.assignments, bounds.from, bounds.to);
    if (!cleaned) return;
    setStrayDropped((n) => n + cleaned.dropped);
    setOverlay((o) => ({ ...o, pinned: validPins(o.pinned, bounds.from, bounds.to) }));
    applyEdit(cleaned.assignments);
  }, [result, busy, bounds, applyEdit, employees.data, absences.data]);

  /**
   * Whether a hand edit may land: not when the shift it leaves would START
   * outside the window -- "0:00 +1" on the last evening of the month is the
   * 1st of the next one. Refused with the same sentence a refinement gets.
   */
  const refuseOutside = useCallback(
    (shift: Assignment): boolean => {
      const day = startsOutside(shift, bounds.from, bounds.to);
      if (day === null) {
        setEditRefused(null);
        return false;
      }
      setEditRefused({ date: shift.date, text: outsidePeriodNotice(day, days) });
      return true;
    },
    [bounds, days],
  );

  const handleAddShift = useCallback(
    (employeeId: string, date: string, startAt: number) => {
      if (!result) return;
      manualSeq.current += 1;
      // Pressing an hour this person already works EXTENDS that shift rather
      // than laying a second one over it -- nobody works two shifts at once,
      // the server refuses to store them, and the coverage strip read the
      // pair as two people. See lib/schedule/placeShift.
      const placed = placeShift({
        assignments: result.assignments,
        employeeId,
        date,
        startAt,
        spec,
        create: (startMin) =>
          manualShift(
            employeeId,
            date,
            startMin,
            templates.data ?? [],
            spec,
            manualSeq.current,
          ),
      });
      // Nothing to do when the shift is already as long as the day allows.
      if (!placed.changed) return;
      if (refuseOutside(placed.changed)) return;
      setOverlay((o) => withPinned(o, [placed.changed as Assignment]));
      applyEdit(placed.assignments);
    },
    [result, templates.data, spec, applyEdit, refuseOutside],
  );

  /**
   * Stretching or trimming a bar by hand is the same kind of instruction as
   * dragging one in: the new hours are pinned, so the next rebuild -- from a
   * prompt, a changed objective, a new hire -- keeps them. An AI shift the
   * manager has resized stops being a suggestion at that moment.
   */
  const handleResizeShift = useCallback(
    (assignmentId: string, startMin: number, endMin: number) => {
      if (!result) return;
      const current = result.assignments.find((a) => a.id === assignmentId);
      if (!current) return;
      const next = resizedShift(current, { startMin, endMin });
      if (refuseOutside(next)) return;
      setOverlay((o) => withPinned(o, [next]));
      applyEdit(result.assignments.map((a) => (a.id === assignmentId ? next : a)));
    },
    [result, applyEdit, refuseOutside],
  );

  /**
   * Carrying a whole bar to other hours, or to somebody else, is a resize
   * that may also change hands. The new place is pinned like any manual
   * edit. When the person changes, the one it came from is treated as if the
   * shift had been removed from them: their slot that day is blacked out, so
   * the next rebuild does not quietly hand them a replacement for the shift
   * the manager just took away.
   */
  const handleMoveShift = useCallback(
    (assignmentId: string, employeeId: string, startMin: number, endMin: number) => {
      if (!result) return;
      const current = result.assignments.find((a) => a.id === assignmentId);
      if (!current) return;
      const next = movedShift(current, employeeId, { startMin, endMin });
      if (refuseOutside(next)) return;
      setOverlay((o) => {
        if (current.employeeId === employeeId) return withPinned(o, [next]);
        const freed = withBlackouts(
          withoutPinned(o, (a) => a.id === assignmentId),
          [{ employeeId: current.employeeId, date: current.date }],
        );
        return withPinned(freed, [next]);
      });
      applyEdit(result.assignments.map((a) => (a.id === assignmentId ? next : a)));
    },
    [result, applyEdit, refuseOutside],
  );

  const handleRemoveShift = useCallback(
    (assignmentId: string) => {
      if (!result) return;
      const gone = result.assignments.find((a) => a.id === assignmentId);
      if (gone) {
        // Removing by hand is an instruction, same as saying it in a prompt.
        setOverlay((o) =>
          withBlackouts(
            withoutPinned(o, (a) => a.id === assignmentId),
            [{ employeeId: gone.employeeId, date: gone.date }],
          ),
        );
      }
      applyEdit(result.assignments.filter((a) => a.id !== assignmentId));
    },
    [result, applyEdit],
  );

  /**
   * A changed spec, and the draft rebuilt under it. The one place a setting
   * from the profile panel reaches the calendar. A draft seeded from the
   * published rota is pinned under a spec that asks for nobody, so the
   * generator hands back exactly the pins.
   */
  const applySpecPatch = useCallback(
    (next: SchedulingSpec) => {
      setSpec(next);
      if (!result || !employees.data || !templates.data) return;
      setResult(
        generateSchedule(
          employees.data,
          templates.data,
          absences.data ?? [],
          absenceTypes.data ?? [],
          next,
          days,
          overlay,
          payPolicy,
        ),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, employees.data, templates.data, absences.data, absenceTypes.data, days, overlay, payPolicy],
  );

  /**
   * Take the day boundary and weekend straight into the draft on screen.
   *
   * The spec normally arrives from `/schedule/interpret`, which reads these two
   * off the profile -- but that only happens the next time somebody runs a
   * brief. Without this, changing the weekend in the first-run panel appears to do
   * nothing at all until the manager retypes their requirements, which reads as
   * a broken setting rather than a deferred one.
   */
  const applyBusinessShape = useCallback(
    (shape: { dayBoundaryMin: number | null; weekendDays: number[] | null }) => {
      const next: SchedulingSpec = {
        ...spec,
        dayBoundaryMin: shape.dayBoundaryMin ?? undefined,
        weekendDays: shape.weekendDays ?? undefined,
      };
      applySpecPatch(next);
    },
    [spec, applySpecPatch],
  );

  /** Rebuild the draft for a different period, keeping the requirements. */
  const rebuildFor = useCallback(
    () => {
      // Moving on from an empty calendar re-arms the seed: "New calendar"
      // meant this period, not every period after it.
      if (!result) {
        setBlockSeed(false);
        return;
      }
      // The next window is the server's to answer first: its draft if it
      // has one, the published rota if not. Only when it has neither does a
      // brief-born calendar carry its rules over and generate the window --
      // see `rebuildOnEmpty`. Regenerating here, before asking, was how
      // paging back to a week overwrote the draft edited on it.
      setResult(null);
      if (statesRequirement(spec)) {
        rebuildOnEmpty.current = true;
      } else {
        // A draft under a spec that asks for nobody was the team's rota; it
        // has no rules to carry.
        setOverlay(EMPTY_OVERLAY);
        setShowPrompt(true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, spec],
  );

  /**
   * The manager answered the missing number, so the sentence becomes a rule.
   *
   * A plain coverage rule, indistinguishable from one the brief stated
   * outright — because that is what it is now. `origin: 'parsed'` is the
   * honest tag: it came from the manager, not from anything we inferred. It is
   * deliberately NOT `exact`, so it can only raise cover on those days, never
   * cap it below what another requirement asks for.
   */
  const handleAnswerQuestion = useCallback(
    (question: OpenQuestion, window: DayWindow) => {
      if (!employees.data || !templates.data) return;
      const answered = answerDayHours(spec, question.weekday, window);
      const nextSpec: SchedulingSpec = {
        ...answered,
        rules: [
          ...spec.rules,
          {
            id: `answered-${question.weekday}`,
            kind: 'day_hours',
            label: t('questions.ruleLabel', {
              day: weekdayName(question.weekday),
              from: formatTime(window.openMin),
              to: formatTime(window.closeMin),
            }),
            // Their words, not ours: this is the manager stating a requirement,
            // which is the authority `parsed` already carries. Answering a
            // question is not weaker evidence than writing it in the brief.
            sourceText: question.quote || null,
            origin: 'parsed',
          },
        ],
      };
      setSpec(nextSpec);
      setQuestions((qs) => qs.filter((q) => q.id !== question.id));
      setResult(
        generateSchedule(
          employees.data,
          templates.data,
          absences.data ?? [],
          absenceTypes.data ?? [],
          nextSpec,
          days,
          overlay,
          payPolicy,
        ),
      );
      // Remembered in the background, because the calendar must not wait on a
      // round trip to redraw. If this write fails the rota is still right and
      // the only cost is being asked the same thing again next time -- which is
      // a worse product but not a wrong one, and it is a better trade than
      // blocking the answer on the network.
      declareDayHours({
        weekday: question.weekday,
        open_min: window.openMin,
        close_min: window.closeMin,
      }).catch(() => {});
    },
    [spec, employees.data, templates.data, absences.data, absenceTypes.data, days, overlay, t, payPolicy],
  );

  /**
   * The manager's own number in place of one we assumed.
   *
   * This is the second half of saying an assumption out loud: a figure they can
   * see but not change is still a decision taken away from them. It rebuilds the
   * calendar through the ordinary generator rather than patching the rota, so a
   * corrected requirement behaves exactly like one the brief had stated.
   *
   * The row then LEAVES the list. It is no longer something we assumed -- it is
   * something they said -- so it becomes a rule with their own sentence on it,
   * and the panel stops taking credit for a number that is now theirs.
   */


  /**
   * Adjust the calendar that is already on screen. The prompt becomes edit
   * operations, which are validated and applied — the model never writes
   * shifts directly.
   *
   * Returns the model's reason when the sentence is one no operation can
   * express, and `null` in every other case — applied, or failed with the
   * banner already set. That reason is the only thing the caller acts on.
   */
  /**
   * An adjustment whose every absence has a type: ready to write.
   *
   * The second half of `handleRefine`, and a function of its own for one
   * reason: between reading the sentence and writing anything, the manager may
   * have to answer a question (see `AbsenceKindModal`). That answer arrives in
   * a later render, so the applying half has to be re-enterable rather than a
   * continuation inside the reading half.
   */
  /**
   * Repair what an adjustment cost -- but only when it cost something, and
   * only if the repair is measurably better.
   *
   * A day off, a week of sick leave, somebody leaving: the surgical edit
   * empties those days and the deterministic pass refills them, on those days
   * alone, with whoever happens to fit. Most of the time that is the end of
   * it. Sometimes it leaves the shop short on a Thursday evening, or leaves a
   * 40-hour contract with 31 hours in it -- and until now NOTHING SAID SO. The
   * calendar came back, the diff listed the shifts that moved, and the two
   * facts a manager answers for were not among them.
   *
   * So this measures (see `damage.ts`) and acts on the measurement:
   *
   * IT DOES NOTHING when the edit cost nothing, which is most edits. No call,
   * no delay, no shifts moved on anybody's phone. That is what makes it
   * affordable to have this run on every adjustment rather than on a button.
   *
   * IT ASKS THE PLANNER when cover was lost or somebody fell below contract,
   * scoped to the months the damage is actually in -- not the horizon. The
   * planner is given the manager's own request AND what granting it cost, kept
   * apart, so it repairs around the request instead of undoing it.
   *
   * IT KEEPS THE ANSWER ONLY IF THE NUMBERS IMPROVED. This is the part that
   * makes it safe to let a model move other people's shifts without being
   * asked: `isBetter` refuses a rearrangement that buys cover by leaving
   * somebody short, refuses one that buys somebody's hours with an uncovered
   * evening, and refuses one that changed nothing -- because churn with no
   * measurable gain is exactly what a manager in week two cannot forgive.
   */
  const repairDamage = useCallback(
    async (
      before: ScheduleResult,
      after: ScheduleResult,
      workingRoster: EmployeeOut[],
      currentSpec: SchedulingSpec,
      currentOverlay: ScheduleOverlay,
      liveAbsences: AbsenceOut[],
      instruction: string,
    ): Promise<{ result: ScheduleResult; note: string | null }> => {
      const nothing = { result: after, note: null };
      if (!templates.data) return nothing;
      const damage = damageBetween(before, after, workingRoster);
      // The common case, and the reason this can run on every adjustment: the
      // edit cost nothing, so there is no call, no delay and no note.
      if (!worthRearranging(damage)) return nothing;

      // The months the damage is IN, not the horizon. A week gone wrong in
      // October is no reason to rewrite March, and a scope the manager is not
      // looking at is a diff they cannot check.
      const months = [...new Set(damage.dates.map((d) => d.slice(0, 7)))];
      for (const short of damage.shortfalls) {
        // A shortfall has no date of its own: it is somebody's month being
        // light. Scope it to the months the edit touched at all.
        for (const a of before.assignments) {
          if (a.employeeId === short.employeeId) months.push(a.date.slice(0, 7));
        }
      }
      const scopeMonths = [...new Set(months)].sort();
      const inScope = (date: string) => scopeMonths.includes(date.slice(0, 7));
      const scopeDays = days.filter((d) => inScope(d.date));
      if (scopeDays.length === 0) return nothing;

      // Months outside the scope keep their shifts exactly: the generator
      // drops every pin outside the days it is given, so they are held here
      // and stitched back on.
      const kept = after.assignments.filter((a) => !inScope(a.date));

      const state: GenerationState = {
        mode: 'reorganize',
        phase: 'plan',
        months: scopeMonths.length,
        startedAt: Date.now(),
      };
      let repaired: ScheduleResult = after;
      let note: string | null = null;
      // If a generation is already in flight this does nothing at all and the
      // deterministic calendar stands -- `runGeneration` refuses to overlap,
      // and that refusal is the old behaviour, which is a safe place to land.
      await runGeneration(state, async () => {
        const planned = await planMonths({
          months: scopeMonths,
          days: scopeDays,
          spec: currentSpec,
          roster: workingRoster,
          overlay: currentOverlay,
          revision: {
            current: after.assignments,
            instruction,
            damage: damageLines(damage, workingRoster),
          },
          brief: briefInEffect,
        });
        // The planner never reached the server, or answered nothing usable.
        // The deterministic calendar stands, exactly as it did before this
        // function existed -- a repair that cannot be made is not a failure
        // of the adjustment.
        if (!planned?.answered) return;

        const rearranged = summarize(
          [...kept, ...planned.result.assignments],
          workingRoster,
          liveAbsences,
          absenceTypes.data ?? [],
          currentSpec,
          days,
          payPolicy,
        );
        if (isBetter(damage, damageBetween(before, rearranged, workingRoster))) {
          repaired = rearranged;
          note = plural(
            Math.round(damage.uncoveredHours) + damage.shortfalls.length,
            'dashboard.repair.done.one',
            'dashboard.repair.done.other',
          );
          return;
        }
        // Tried, and nothing better exists. SAID OUT LOUD, because the manager
        // has just waited half a minute for a calendar that did not change,
        // and an unexplained wait reads as the product having hung. It is also
        // the truth they need: this team cannot cover that week, and no
        // rearrangement will fix it.
        note = damage.uncoveredHours > 0
          ? translate('dashboard.repair.noBetter.cover', {
              hours: Math.round(damage.uncoveredHours),
            })
          : translate('dashboard.repair.noBetter.hours');
      });
      return { result: repaired, note };
    },
    [
      templates.data,
      absenceTypes.data,
      days,
      runGeneration,
      planMonths,
      briefInEffect,
      payPolicy,
    ],
  );

  const applyPlan = useCallback(
    async ({
      ops,
      rosterOps,
      instruction,
    }: {
      ops: EditOp[];
      rosterOps: RosterOp[];
      /**
       * The manager's own sentence, carried through so a repair pass can tell
       * the planner what it must repair AROUND rather than undo.
       */
      instruction: string;
    }) => {
      if (!result || !employees.data || !templates.data) return null;
      setIsRefining(true);
      // Whatever throws below -- a roster write, the repair's planner, the
      // landing -- the button must come back. Without this a single throw
      // left `busy` up for the rest of the session: no adjusting, no undo.
      try {

        // The roster is written first: a shift can only be handed to someone who
        // exists, and the rebuild has to happen over the team the sentence leaves
        // behind — not the one it started with.
        let workingRoster = roster;
        let liveAbsences = absences.data ?? [];
        if (rosterOps.length > 0) {
          const written = await applyRosterOps(rosterOps, roster, todayISO());
          if (written.changed) {
            await qc.invalidateQueries({ queryKey: queryKeys.employees });
            // AND the absences. A week of sick leave that was just written is a
            // day the generator must refuse to staff, and it only knows that
            // from this list — without the refetch the row is in the database,
            // the calendar still has Juanito working, and the manager has every
            // reason to think the sentence did nothing.
            await qc.invalidateQueries({ queryKey: queryKeys.absences });
            const [fresh, freshAbsences] = await Promise.all([
              employees.refetch(),
              absences.refetch(),
            ]);
            workingRoster = (fresh.data ?? []).filter(
              (e) => e.employment_status !== 'resigned',
            );
            liveAbsences = freshAbsences.data ?? liveAbsences;
          }
        }

        // A team change is a change to what the calendar is even made of, so the
        // draft is rebuilt over the new roster before the shift edits land on it.
        // The overlay carries every earlier instruction through the rebuild.
        const changedTeam =
          workingRoster !== roster || liveAbsences !== (absences.data ?? []);
        const base = changedTeam
          ? generateSchedule(
              workingRoster,
              templates.data,
              liveAbsences,
              absenceTypes.data ?? [],
              spec,
              days,
              overlay,
              payPolicy,
            )
          : result;

        const outcome = applyOps(
          ops,
          base,
          spec,
          overlay,
          workingRoster,
          templates.data,
          liveAbsences,
          absenceTypes.data ?? [],
          days,
          payPolicy,
        );
        // The adjustment has landed, deterministically, and that is the result.
        // It changes what was asked -- and covers the hole it leaves, on that
        // day -- and nothing else; see `applyOps`. Nothing else moves, because
        // an adjustment that also moved three other people's shifts, however
        // good the rota, is the thing a manager in week two cannot trust: those
        // shifts are already on the team's phones.
        //
        // That is why this path is tried FIRST and not the only path. A request
        // no operation can express is not refused any more -- `handleAdjust`
        // hands it to the planner, which may move anybody. The manager sees it
        // happen (the panel says "rearranging"), reads the diff, and can undo.
        // What the surgical edit cost, repaired -- if it cost anything, and if
        // the repair measures better. Most adjustments return here unchanged and
        // without a call; see `repairDamage`.
        const repair = await repairDamage(
          result,
          outcome.result,
          workingRoster,
          outcome.spec,
          outcome.overlay,
          liveAbsences,
          instruction,
        );
        // Everything above was built on `result`, the calendar the sentence
        // was sent with. The manager may have added, moved or removed shifts by
        // hand since -- the grid does not lock while the AI thinks -- and
        // writing `repair.result` as it stands would throw those edits away. So
        // it lands on the calendar on screen now: the days they touched keep
        // what they left there, every other day takes the answer.
        const now = onScreen.current;
        const shownNow = now.result ?? result;
        const hand = now.result
          ? keepHandEdits({
              base: result.assignments,
              current: now.result.assignments,
              next: repair.result.assignments,
              baseOverlay: overlay,
              currentOverlay: now.overlay,
              nextOverlay: outcome.overlay,
              mayKeep: keepableOn(workingRoster, liveAbsences, absenceTypes.data ?? []),
            })
          : null;
        const settled = hand?.touched
          ? summarize(
              hand.assignments,
              workingRoster,
              liveAbsences,
              absenceTypes.data ?? [],
              outcome.spec,
              days,
              payPolicy,
            )
          : repair.result;
        const handNotes = hand
          ? [
              handEditNote(hand.conflicts, workingRoster),
              refusedHandEditNote(
                hand.refused,
                workingRoster,
                new Map(roster.map((e) => [e.id, e.full_name])),
              ),
            ].filter((n): n is string => n !== null)
          : [];
        if (hand?.touched) {
          // Undo goes back to what was on screen when the answer landed, hand
          // edits included -- not to the calendar the sentence was sent with,
          // which would take the manager's clicks back along with the AI's.
          setHistory((h) =>
            h.length > 0 ? [...h.slice(0, -1), { result: shownNow, spec, overlay: now.overlay }] : h,
          );
        }

        // ONE diff for both passes. The manager asked for one thing and reads
        // one change: splitting it into "here is your day off" and then "here is
        // what moved because of it" would make an undo ambiguous -- and undo is
        // the promise that makes it acceptable for this to run on its own.
        setLastChange({
          diff: diffSchedules(shownNow, settled),
          skipped: [
            ...outcome.skipped,
            ...(repair.note ? [repair.note] : []),
            ...handNotes,
          ],
        });
        setResult(settled);
        announceArrival();
        setSpec(outcome.spec);
        setOverlay(hand?.overlay ?? outcome.overlay);
        // Only the operations that landed, and only the ones about the business:
        // the server drops anything about a person before it writes a row. The
        // sentence goes with them: it is the only thing that says whether
        // "four at the peak" was meant for this week or for good.
        if (outcome.appliedOps.length > 0) {
          recordObservations.mutate({ ops: outcome.appliedOps, text: instruction });
        }
        // Whatever the last attempt could not do, this one did: the red banner
        // above must not outlive it, still telling them the calendar is
        // unchanged next to a diff of what changed.
        setAiError(null);
        return null;
      } finally {
        setIsRefining(false);
      }
    },
    [result, spec, overlay, roster, employees, absences, qc, templates.data, absenceTypes.data, days, recordObservations, repairDamage, payPolicy],
  );

  const handleRefine = useCallback(
    async (text: string) => {
      if (!result || !employees.data || !templates.data) return;
      setIsRefining(true);
      setHistory((h) => [...h, { result, spec, overlay }].slice(-20));

      // Ask Claude to turn the sentence into operations against the calendar it
      // can actually see. On 503/502 fall back to the local parser, so the
      // calendar stays adjustable without a key or a network.
      let ops: EditOp[] = [];
      let rosterOps: RosterOp[] = [];
      let unsettled: AbsenceRequest[] = [];
      let unsupported: string | null = null;
      try {
        const context = buildRefineContext(
          roster,
          result.assignments,
          spec,
          days,
          absences.data ?? [],
          absenceTypes.data ?? [],
          jurisdiction,
        );
        const plan = await refineSchedule(text, context);
        unsupported = plan.unsupported;
        // One sentence can touch both the team and the calendar ("hire Ana and
        // give her Fridays off"), so the ops are split, not chosen between.
        rosterOps = plan.ops
          .filter((o) => isRosterOp(o.op))
          .map(toRosterOp)
          .filter((o): o is RosterOp => o !== null);
        ops = plan.ops
          .filter((o) => !isRosterOp(o.op))
          .map(toEditOp)
          .filter((o): o is EditOp => o !== null);

        // Time off with a reason is read apart from the rest, because it is the
        // one operation that may not be buildable yet: it needs one of THIS
        // business's absence types, and the model is not allowed to guess which
        // (see `absenceKind.ts`). What the sentence settles is applied with
        // everything else; what it leaves open becomes a question.
        const types = absenceTypes.data ?? [];
        for (const raw of plan.ops) {
          const request = toAbsenceRequest(raw as Record<string, unknown>);
          if (!request) continue;
          const type = typeForKind(request.kind, types);
          if (type) {
            rosterOps = [...rosterOps, absenceOp(request, type)];
          } else {
            unsettled = [...unsettled, request];
          }
        }
      } catch (err) {
        // Same rule as the brief: an adjustment the AI never read is not
        // applied by a regex guessing at it.
        setAiError({ kind: 'refine', text: getErrorMessage(err), prose: false });
        setIsRefining(false);
        setHistory((h) => h.slice(0, -1));
        return null;
      }

      // The model read the sentence and could not say it as operations. That
      // is not "nothing changed": the sentence goes to the planner, which can
      // rebuild the period around it -- see `handleAdjust`. The history entry
      // pushed above is taken back because the planner pushes its own.
      if (
        ops.length === 0 &&
        rosterOps.length === 0 &&
        unsettled.length === 0 &&
        unsupported
      ) {
        setIsRefining(false);
        setHistory((h) => h.slice(0, -1));
        return unsupported;
      }

      // Somebody is away and nothing in the sentence says whether those hours
      // are paid. NOTHING IS WRITTEN UNTIL THAT IS ANSWERED -- not the days
      // off, not the shift edits that came with them. Writing the half we
      // understood would leave the calendar changed and the absence missing,
      // which is the state hardest to notice and hardest to undo. The spinner
      // stops, because what is happening now is a question, not work.
      if (unsettled.length > 0) {
        setPendingAbsences({
          queue: unsettled,
          plan: { ops, rosterOps, instruction: text },
        });
        setIsRefining(false);
        return null;
      }

      return applyPlan({ ops, rosterOps, instruction: text });
    },
    [result, spec, overlay, roster, employees.data, templates.data, absences.data, absenceTypes.data, days, jurisdiction, applyPlan],
  );

  /**
   * The manager answered which kind of leave one absence is.
   *
   * Asked one at a time: two people off in the same sentence may be off for
   * different reasons, and a form with two of everything is how the second one
   * silently gets whatever the first one got.
   */
  const handleAbsenceKind = useCallback(
    (type: AbsenceTypeOut) => {
      if (!pendingAbsences) return;
      const [answered, ...rest] = pendingAbsences.queue;
      const plan = {
        ops: pendingAbsences.plan.ops,
        rosterOps: [...pendingAbsences.plan.rosterOps, absenceOp(answered, type)],
        instruction: pendingAbsences.plan.instruction,
      };
      // Read from state and written back, rather than computed inside a
      // `setState` updater. An updater must be pure, and under StrictMode React
      // runs it twice -- which, with the write in there, is one absence created
      // and approved TWICE, two rows in Time off, and a holiday balance down by
      // two weeks for one week off.
      if (rest.length > 0) {
        setPendingAbsences({ queue: rest, plan });
        return;
      }
      setPendingAbsences(null);
      void applyPlan(plan);
    },
    [pendingAbsences, applyPlan],
  );

  /**
   * They closed the question instead of answering it.
   *
   * The whole adjustment is dropped, including the parts that needed no
   * question. Half of a sentence about somebody being away is not a smaller
   * version of it -- it is a calendar that moved for a reason that was never
   * recorded.
   */
  const handleAbsenceCancel = useCallback(() => {
    setPendingAbsences(null);
    setHistory((h) => h.slice(0, -1));
  }, []);


  /**
   * The model rearranges the whole calendar around what is there now.
   *
   * Explicit and separate from `handleRefine`: an instruction is satisfied
   * by one edit, but a good rota may need five, and only the model can say
   * which four other shifts should move. That is worth having when the
   * manager asks for it and accepts that people move, and worth refusing
   * when they did not. The text in the box, if any, is the instruction; an
   * empty box asks for the best arrangement of what is already there.
   * Undoable like any adjustment. If a month cannot be planned the calendar
   * is left as it was and the banner says so.
   *
   * IT DOES NOT REPLAN THE WHOLE HORIZON ANY MORE. It used to, because the
   * months were read straight off the days on screen, so one sentence about
   * October cost twelve calls to the model on a year -- and fourteen when it
   * arrived here from `handleAdjust`. The scope is the manager's choice now
   * (see the control in `RefineBar`), it defaults to the month they have open,
   * and the months left out are named under the diff rather than quietly
   * skipped: a month nobody touched looks exactly like a month the model
   * decided to leave alone.
   */
  const handleReorganize = useCallback(
    async (instruction: string, whyNotSurgical?: string) => {
      if (!result || !employees.data || !templates.data) return;
      // A month named in the instruction wins over the control and over
      // whichever folder is open: it is the most specific thing the manager
      // said, and they said it in the box they were looking at.
      const named = monthsNamedIn(instruction, monthsOfDays(days));
      const scope = planningScope(days, {
        scope: planScope,
        focus: focusMonth,
        named,
        published: publishedMonths,
        includePublished,
      });
      // What the manager should be told about the months that were NOT
      // touched, in the place an adjustment already says what it could not do.
      const notes: string[] = [];
      const outOfScope = cutFor(scope, 'out_of_scope');
      const untouched = cutFor(scope, 'published');
      if (scope.months.length > 0 && outOfScope.length > 0) {
        // Said differently when the months came from the manager's own
        // sentence: the same fact under a heading that reads "could not be
        // done" is a complaint about doing exactly what was asked.
        notes.push(
          named.length > 0
            ? plural(
                outOfScope.length,
                'dashboard.replan.named.one',
                'dashboard.replan.named.other',
                { months: monthNameList(scope.months) },
              )
            : plural(
                outOfScope.length,
                'dashboard.replan.scoped.one',
                'dashboard.replan.scoped.other',
                { months: monthNameList(scope.months) },
              ),
        );
      }
      if (untouched.length > 0) {
        notes.push(
          scope.months.length === 0
            ? t('dashboard.replan.nothing')
            : t('dashboard.replan.published', { months: monthNameList(untouched) }),
        );
      }

      // Every month in scope is already in the team's hands. Nothing to ask
      // the model, so nothing is asked: the panel would go up over a calendar
      // that cannot change, and the reason belongs under the bar with the
      // other "could not be done" lines.
      if (scope.months.length === 0) {
        setLastChange({ diff: diffSchedules(result, result), skipped: notes });
        return;
      }

      const initial: GenerationState = {
        mode: 'reorganize',
        phase: 'plan',
        months: scope.months.length,
        startedAt: Date.now(),
      };
      await runGeneration(initial, async () => {
        setHistory((h) => [...h, { result, spec, overlay }].slice(-20));
        // The months NOT being replanned keep exactly the shifts they have.
        // They cannot travel through the generator to get there -- it drops
        // every pin outside the days it was given (see `inPeriod`) -- so they
        // are held here and stitched back on below.
        const kept = result.assignments.filter(
          (a) => !scope.months.includes(a.date.slice(0, 7)),
        );
        const planned = await planMonths({
          months: scope.months,
          days: scope.days,
          spec,
          roster,
          overlay,
          // The model still sees the WHOLE calendar, scope or no scope: "leave
          // Ana her Fridays" is about a person's month, and a model shown only
          // the weeks it may rewrite would answer a different question.
          revision: { current: result.assignments, instruction },
          brief: briefInEffect,
        });
        setUnplannedMonths(planned?.failed ?? scope.months);
        // Totals, overtime and coverage gaps re-derived over the WHOLE period,
        // so the numbers under the calendar describe the calendar on screen
        // rather than the slice that was replanned.
        //
        // What a scoped replan cannot see is the week that straddles its own
        // edge: hours already worked in the last days of the month before are
        // not counted against a weekly ceiling here. That is not new -- the
        // product plans a month per call and the default horizon IS one month,
        // so a manager replanning October has always had exactly this
        // boundary -- and narrowing the scope does not make it worse.
        const rearranged =
          planned && planned.answered
            ? summarize(
                [...kept, ...planned.result.assignments],
                roster,
                absences.data ?? [],
                absenceTypes.data ?? [],
                spec,
                days,
                payPolicy,
              )
            : null;
        const failed = planned?.failed ?? scope.months;
        if (rearranged === null) {
          // Nothing to undo and nothing to describe: the calendar is as it was,
          // and the banner above says why.
          setHistory((h) => h.slice(0, -1));
          // Only when the planner actually answered. A month it could not
          // plan -- no key, a timeout, a bad gateway -- already says so in
          // the amber banner above, and telling somebody their request is
          // impossible when it was never evaluated sends them to rewrite a
          // sentence that was fine.
          if (whyNotSurgical && failed.length === 0) {
            setAiError({ kind: 'unsupported', text: whyNotSurgical, prose: true });
          }
        } else {
          // The replan was built on `result`; the manager may have edited by
          // hand during the half minute it took. Those days keep their edits
          // (see `keepHandEdits`) and the line under the diff names any the
          // planner had also rewritten. The overlay is not the planner's to
          // change, so the one on screen -- hand pins included -- stands.
          const now = onScreen.current;
          const shownNow = now.result ?? result;
          const hand = keepHandEdits({
            base: result.assignments,
            current: shownNow.assignments,
            next: rearranged.assignments,
            baseOverlay: overlay,
            currentOverlay: now.overlay,
            mayKeep: keepableOn(roster, absences.data ?? [], absenceTypes.data ?? []),
          });
          const landed = hand.touched
            ? summarize(
                hand.assignments,
                roster,
                absences.data ?? [],
                absenceTypes.data ?? [],
                spec,
                days,
                payPolicy,
              )
            : rearranged;
          const handNotes = [
            handEditNote(hand.conflicts, roster),
            refusedHandEditNote(hand.refused, roster),
          ].filter((n): n is string => n !== null);
          if (hand.touched) {
            setHistory((h) =>
              h.length > 0 ? [...h.slice(0, -1), { result: shownNow, spec, overlay: now.overlay }] : h,
            );
          }
          setLastChange({
            diff: diffSchedules(shownNow, landed),
            skipped: [...notes, ...handNotes],
          });
          setResult(landed);
          announceArrival();
          if (whyNotSurgical) setAiError(null);
        }
      });
    },
    [
      result,
      spec,
      overlay,
      roster,
      employees.data,
      templates.data,
      absences.data,
      absenceTypes.data,
      days,
      runGeneration,
      briefInEffect,
      planMonths,
      planScope,
      focusMonth,
      publishedMonths,
      includePublished,
      t,
      payPolicy,
    ],
  );

  /**
   * What the adjustment bar calls.
   *
   * A sentence the surgical operations can express is applied as one, and
   * touches nothing else. A sentence they cannot -- "alternate the weekends",
   * "never Ana and Luis together", "Pedro only Mondays and Thursdays" -- is
   * not the end of the road: it goes to the planner, which rebuilds the period
   * with those words satisfied and the rules kept. The manager asked in plain
   * language; they get an answer either way, or the reason there is none.
   */
  const handleAdjust = useCallback(
    async (text: string) => {
      const whyNotSurgical = await handleRefine(text);
      if (whyNotSurgical) await handleReorganize(text, whyNotSurgical);
    },
    [handleRefine, handleReorganize],
  );

  const handleUndo = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (!prev) return h;
      setResult(prev.result);
      setSpec(prev.spec);
      setOverlay(prev.overlay);
      return h.slice(0, -1);
    });
    setLastChange(null);
  }, []);

  const handleNewCalendar = useCallback(() => {
    setLastChange(null);
    setBlockSeed(true);
    setResult(null);
    setSpec(DEFAULT_SPEC);
    setOverlay(EMPTY_OVERLAY);
    setHistory([]);
    setTeamPlan(null);
    setTeamNote([]);
    setProfileApplied([]);
    setProfileGaps([]);
    setProfileSuggestions([]);
    setQuestions([]);
    setPrompt('');
    setBriefInEffect('');
    setShowPrompt(true);
    // The other browser is owed the empty calendar too. A send still waiting
    // on the old calendar would bring it straight back, so it is dropped, and
    // the empty draft goes now: this was a click, not a keystroke. Skipped
    // when the server is already known to hold nothing for the window.
    dropPendingSave();
    // Only once the server's draft has been read: an empty PUT before that
    // would delete a draft this browser never saw. If the read is still out
    // and comes back with rows, they take the screen -- the server wins.
    if (mark.server !== null && mark.server.length > 0) {
      sendDraft(draftKey, bounds.from, bounds.to, []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mark, draftKey, bounds, sendDraft, dropPendingSave]);

  // --- Moving around -------------------------------------------------------
  //
  // Two moves, and only one of them costs anything. Stepping between days
  // inside a month changes what is DRAWN and nothing else -- same period,
  // same window, same shifts already in hand -- so it never rebuilds. Leaving
  // the month is a different period, and that is the one `rebuildFor` exists
  // for: the next window is the server's to answer first.

  /**
   * Open a day. `from` is where on screen the manager pressed it, when they
   * did: the day grows out of that spot (DayView).
   */
  const openDay = (date: string, from?: Point) => {
    setDayEntrance(from ? { kind: 'grow', date, at: from } : null);
    if (from) setDayOrigin({ date, at: from });
    setLanding(null);
    setFocus({ kind: 'day', date });
    // Only a day OUTSIDE the period is a new period. Asked against the window
    // itself rather than against its first month, so a brief that covers three
    // months keeps all three: the old check compared month strings and treated
    // the second month of its own period as somewhere else.
    if (!windowHolds(period, date)) {
      setPeriodStart(date);
      rebuildFor();
    }
  };

  const stepDay = (delta: number) => {
    if (focus.kind !== 'day') return;
    const next = shiftDay(focus.date, delta);
    openDay(next);
    // Turned to, like a page: in from the side it was stepped towards.
    setDayEntrance({ kind: 'step', date: next, dir: delta < 0 ? -1 : 1 });
  };

  /** Put the year on screen. How it arrives is the caller's to say. */
  const focusYear = (year: number) => setFocus({ kind: 'year', year });

  /** A year asked for (the arrows, a new period): its months come in. */
  const showYear = (year: number) => {
    setYearArrival('cascade');
    setLanding(null);
    focusYear(year);
  };

  /**
   * Back from a day: the year settles rather than cascading, and rings the
   * day that was open -- scrolled back to where it was pressed -- so the eye
   * lands where it left. Its own arrival, not showYear's overwritten.
   */
  const closeDay = () => {
    const closing = focus.kind === 'day' ? focus.date : null;
    setYearArrival('return');
    setLanding(
      closing
        ? { date: closing, y: dayOrigin?.date === closing ? dayOrigin.at.y : null }
        : null,
    );
    focusYear(yearOf(focus));
  };

  /** The period, a month either way. Always a new period, so always a rebuild. */
  const stepMonth = (delta: number) => {
    const d = new Date(period.from);
    d.setMonth(d.getMonth() + delta);
    openDay(dateKey(d));
  };

  /** "September 2026" for a month key of "2026-09". */
  const monthAndYear = (key: string): string => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(APP_LOCALE, {
      month: 'long',
      year: 'numeric',
    });
  };

  /** The period's months in words, for the offer to plan an empty one. */
  const periodMonths =
    months.length === 0
      ? ''
      : months.length === 1
        ? monthAndYear(months[0].key)
        : `${monthAndYear(months[0].key)} – ${monthAndYear(months[months.length - 1].key)}`;
  const capitalize = (text: string): string =>
    text.charAt(0).toLocaleUpperCase(APP_LOCALE) + text.slice(1);

  /**
   * What the period covers, in words. The PERIOD, never the day being read.
   *
   * It labels payroll and the publish dialog, both of which act on the whole
   * window: telling somebody they are about to publish "Tuesday" when the
   * button writes the month would be the same confusion between looking and
   * doing that this whole view exists to end.
   */
  const rangeLabel = (() => {
    const first = months[0];
    const last = months[months.length - 1];
    if (!first || !last) return '';
    return first.key === last.key
      ? monthAndYear(first.key)
      : `${monthAndYear(first.key)} — ${monthAndYear(last.key)}`;
  })();

  const loading = employees.isLoading || templates.isLoading;

  /**
   * A view's panel, as the tablist's: named by its tab and named in it. Only
   * while there IS a tablist -- it is drawn with a calendar -- or the label
   * would point at a tab that is not on the page.
   */
  const viewPanel = (v: View) =>
    result
      ? {
          role: 'tabpanel' as const,
          id: panelIdFor(VIEW_TABS, v),
          'aria-labelledby': tabIdFor(VIEW_TABS, v),
        }
      : {};
  // Only after a tab has been changed: the first paint is not a change.
  const panelMotion = panelDir !== 0 ? 'cal-panel-in' : '';
  const panelStyle = (panelDir !== 0 ? { '--dir': panelDir } : undefined) as
    | CSSProperties
    | undefined;

  /**
   * One day-screen. Every horizon renders days the same way -- only how they
   * are grouped changes -- so there is one definition of a day, not three.
   */
  const renderDay = (day: DayRef) =>
    result ? (
      <div key={day.date}>
      {/* Right above the grid the refused edit was made on. */}
      {editRefused?.date === day.date && (
        <div
          role="alert"
          className="m-rise mb-3 rounded-xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {editRefused.text}
        </div>
      )}
      <DayGrid
        day={day}
        prevDay={prevDays.get(day.date) ?? null}
        days={days}
        employees={roster}
        assignments={result.assignments}
        absences={absences.data ?? []}
        absenceTypes={absenceTypes.data ?? []}
        spec={spec}
        onAddShift={handleAddShift}
        onRemoveShift={handleRemoveShift}
        onResizeShift={handleResizeShift}
        onMoveShift={handleMoveShift}
        nightPremiumPct={payPolicy.nightDifferentialPct}
        // Hidden under another tab, its Delete and Escape are not its own.
        keys={view === 'calendar'}
      />
      </div>
    ) : null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {t('dashboard.header.welcome', {
              name: user?.full_name?.split(' ')[0] ?? '',
            })}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('dashboard.header.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {assistantOffered && (
            <button
              type="button"
              onClick={() => setAssistantOpen(true)}
              className="rounded-lg border border-brand-200/70 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 motion-reduce:transition-none"
            >
              {t('assistant.open')}
            </button>
          )}
          {!showPrompt && (
            <button
              type="button"
              onClick={() => setShowPrompt(true)}
              className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:border-white/25 hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 motion-reduce:transition-none"
            >
              {t('dashboard.header.editRequirements')}
            </button>
          )}
        </div>
      </div>

      {assistantOffered && (
        <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
      )}

      {/* A new account, asked the few things no default can honestly stand in
          for. It takes the brief's place rather than sitting above it: two
          boxes both asking about opening hours is a worse screen than one, and
          "skip" gives the ordinary dashboard back on the click. */}
      {/* The warning before a second round. It lists what goes by name --
          including the thing a manager would never guess, which is the
          research we did about their business -- and it is a confirmation
          rather than a note, because by the time the chat has started the
          first question is already on screen. */}
      <Modal
        open={confirmingInterview}
        onClose={() => setConfirmingInterview(false)}
        title={t('interview.restart.title')}
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => setConfirmingInterview(false)}
            >
              {t('interview.restart.cancel')}
            </Button>
            <Button
              onClick={() => {
                setConfirmingInterview(false);
                setInterviewing(true);
              }}
            >
              {t('interview.restart.confirm')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-700">{t('interview.restart.body')}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>{t('interview.restart.item.notes')}</li>
          <li>{t('interview.restart.item.hours')}</li>
          <li>{t('interview.restart.item.research')}</li>
        </ul>
        <p className="mt-3 text-sm text-gray-500">{t('interview.restart.keeps')}</p>
      </Modal>

      {interviewing && (
        <InterviewChat
          onFinish={(brief, week, month) => {
            // Remembered first, built second. The save is fire-and-forget:
            // a failure to keep the paragraph must not cost the manager the
            // calendar they were promised at the end of the conversation.
            completeInterview.mutate({
              notes: brief,
              open_hours: week ? toPayload(week) : undefined,
            });
            setInterviewing(false);
            setFirstRunClosed(true);
            handleGenerate(brief, { month });
          }}
          onCancel={() => setInterviewing(false)}
          isBuilding={busy}
        />
      )}

      {showFirstRun && !interviewing && (
        <FirstRunPanel
          onFinish={(brief) => {
            setFirstRunClosed(true);
            handleGenerate(brief);
          }}
          onSkip={() => setFirstRunClosed(true)}
          onBusinessShapeChange={applyBusinessShape}
          isBuilding={busy}
          onPreferInterview={interviewOffered ? startInterview : undefined}
        />
      )}

      {/* The kind of business the interview made us guess, put to the manager
          once. Never beside the first-run questions, which ask it themselves. */}
      {!showFirstRun && !interviewing && <InferredVerticalPrompt />}

      {showPrompt && !showFirstRun && !interviewing && !seedPending && (
        <PromptPanel
          onGenerate={handleGenerate}
          isGenerating={busy}
          lastPrompt={prompt}
          onInterview={interviewOffered ? startInterview : undefined}
        />
      )}

      {result && (
        <OpenQuestions
          questions={questions}
          ready={Boolean(employees.data && templates.data)}
          onAnswer={handleAnswerQuestion}
          onDismiss={(q) =>
            setQuestions((qs) => qs.filter((x) => x.id !== q.id))
          }
        />
      )}

      {/* The rules behind the rota are NOT here any more: eleven rows under
          the brief filled the screen a manager opens to write one. They are
          in Settings, reading the same draft state this page writes -- see
          components/schedule/StandingRules. */}

      {/* What the brief could NOT do to the roster. Only that: a change that
          worked needs no receipt, and one that did not is the thing nobody
          would otherwise find out about until a name was missing from a
          shift. */}
      {teamNote.length > 0 && (
        <div className="m-rise mt-4 rounded-2xl border border-red-200 bg-red-50 p-4">
          <ul className="space-y-0.5">
            {teamNote.map((n) => (
              <li key={n} className="text-sm text-red-900">
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* People the brief left out. Retiring someone is never automatic. */}
      {teamPlan && (
        <TeamProposal
          plan={teamPlan}
          onApply={handleApplyTeam}
          onDismiss={handleDismissTeam}
          isApplying={isApplyingTeam}
        />
      )}

      {/* Keep shaping this calendar by talking to it. */}
      {result && (
        <div className="mt-4">
          <RefineBar
            onRefine={handleAdjust}
            onReorganize={handleReorganize}
            onUndo={handleUndo}
            onNewCalendar={handleNewCalendar}
            canUndo={history.length > 0 && !busy}
            isWorking={busy}
            scope={replanScope}
          />
          {lastChange && (
            <ChangeSummary
              // A new change arrives as a new note, not as new words in the
              // old one: the manager just asked for something, and this is
              // the answer coming in.
              key={identityKey(lastChange)}
              diff={lastChange.diff}
              skipped={lastChange.skipped}
              employees={roster}
            />
          )}
          {strayDropped > 0 && (
            <div className="m-rise mt-3 rounded-xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {plural(strayDropped, 'dashboard.draft.strayDropped.one', 'dashboard.draft.strayDropped.other')}
            </div>
          )}
          {draftSaveError && (
            <div className="m-rise mt-3 rounded-xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">{t('dashboard.draft.saveFailed.title')}</p>
              <p className="mt-0.5">{draftSaveError}</p>
              <p className="mt-0.5 text-xs">{t('dashboard.draft.saveFailed.help')}</p>
            </div>
          )}
        </div>
      )}

      {/* The calendar exists and is legal, but nobody reasoned about it.
          Said out loud rather than left implicit: a manager who believes a rota
          was considered trusts it differently from one who knows it was filled
          in by a heuristic, and only one of those beliefs would be true here. */}
      {unplannedMonths.length > 0 && result && (
        <div className="m-rise mt-4 rounded-2xl border border-amber-200/70 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            {t('dashboard.unplanned.title')}
          </p>
          <p className="mt-1 text-sm text-amber-900">{t('dashboard.unplanned.help')}</p>
        </div>
      )}

      {/* A calendar with nothing in it, and the reason it is empty. */}
      {emptyCalendar && (
        <div
          className={
            emptyCalendar.kind === 'notStarted'
              ? 'm-rise mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4'
              : 'm-rise mt-4 rounded-2xl border border-amber-200/70 bg-amber-50 p-4'
          }
        >
          <p
            className={
              emptyCalendar.kind === 'notStarted'
                ? 'text-sm font-semibold text-gray-900'
                : 'text-sm font-semibold text-amber-900'
            }
          >
            {t(
              emptyCalendar.kind === 'notStarted'
                ? 'dashboard.emptyCalendar.notStartedTitle'
                : 'dashboard.emptyCalendar.title',
            )}
          </p>
          <ul className="mt-2 space-y-0.5">
            {emptyCalendar.people.map((b) => (
              <li
                key={b.name}
                className={
                  emptyCalendar.kind === 'notStarted'
                    ? 'text-sm text-gray-700'
                    : 'text-sm text-amber-900'
                }
              >
                {b.name} — {b.reason}
              </li>
            ))}
          </ul>
          <p
            className={
              emptyCalendar.kind === 'notStarted'
                ? 'mt-2 text-xs text-gray-600'
                : 'mt-2 text-xs text-amber-800'
            }
          >
            {t(
              emptyCalendar.kind === 'notStarted'
                ? 'dashboard.emptyCalendar.notStartedHelp'
                : 'dashboard.emptyCalendar.help',
            )}
          </p>
        </div>
      )}

      {/* Nothing was built, or nothing was changed -- and which one it was is
          the first thing the manager needs to know. */}
      {aiError && (
        <div className="m-rise mt-4 rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-900">
            {t(`dashboard.${aiError.kind}Error.title`)}
          </p>
          <p className="mt-1 text-sm text-red-800">
            {aiError.prose ? aiError.text : shortReason(aiError.text)}
          </p>
          <p className="mt-2 text-xs text-red-700">
            {t(`dashboard.${aiError.kind}Error.help`)}
          </p>
        </div>
      )}

      {/* Anything the intake understood but could not turn into a rule */}
      {spec.notes && spec.notes.length > 0 && (
        <div className="m-rise mt-3 rounded-xl border border-amber-200/70 bg-amber-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
            {t('dashboard.notes.title')}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-amber-900">
            {spec.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Calendar toolbar */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => stepMonth(-1)}
            aria-label={t('dashboard.toolbar.prevPeriod')}
            className="rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-sm text-gray-800 transition-colors hover:border-white/25 hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 motion-reduce:transition-none"
          >
            ←
          </button>
          <h2 className="min-w-[10rem] text-center text-base font-semibold text-gray-900 first-letter:uppercase">
            {rangeLabel}
          </h2>
          <button
            type="button"
            onClick={() => stepMonth(1)}
            aria-label={t('dashboard.toolbar.nextPeriod')}
            className="rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-sm text-gray-800 transition-colors hover:border-white/25 hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 motion-reduce:transition-none"
          >
            →
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Publishing is the handover: until it happens the draft is the
              manager's alone; publishing is the only way it reaches the team. */}
          {result && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={openPublish}
                // What is on screen may be about to be replaced; publishing
                // it now would hand the team a calendar the manager never saw.
                disabled={busy}
              >
                {t('dashboard.publish.cta')}
              </Button>
            </div>
          )}
          {result && (
            // A real tablist (WAI-ARIA): the panels below are its tabpanels.
            <ViewTabs
              label={t('dashboard.view.label')}
              idBase={VIEW_TABS}
              value={view}
              onChange={changeView}
              tabs={[
                { value: 'calendar', label: t('dashboard.view.calendar') },
                { value: 'payroll', label: t('dashboard.view.payroll') },
                { value: 'workday', label: t('workday.view') },
              ]}
            />
          )}
        </div>
      </div>

      {/* Mounted whenever there is a calendar and opened with `open`, so
          closing plays the dialog's exit instead of taking it off the page. */}
      {result && (
        <PublishConfirmModal
          open={publishOpen}
          from={publishFrom}
          to={bounds.to}
          draft={result.assignments}
          employees={employees.data ?? []}
          templates={templates.data ?? []}
          onConfirm={handlePublish}
          onClose={() => setPublishOpen(false)}
          isPublishing={publish.isPending}
          error={publish.isError ? publish.error : null}
          outcome={publishOutcome}
        />
      )}
      {burst && (
        <PublishBurst key={burst.id} at={burst.at} onDone={() => setBurst(null)} />
      )}

      {/* The one question that stops the manager. It is a modal, unlike every
          other question this product asks, because its answer cannot be seen
          in the calendar behind it: sick leave, holiday and unpaid leave all
          draw the same week. See `AbsenceKindModal`. */}
      {/* Always mounted: with no question pending it shows the last one
          while it leaves, then nothing. */}
      <AbsenceKindModal
        request={pendingAbsences?.queue[0] ?? null}
        remaining={pendingAbsences ? pendingAbsences.queue.length - 1 : 0}
        types={absenceTypes.data ?? []}
        onChoose={handleAbsenceKind}
        onCancel={handleAbsenceCancel}
      />


      {/* While the AI is arranging shifts the work shows above the calendar,
          and what is underneath -- the previous calendar, or hours & pay --
          fades, so nothing on screen reads as the brief having done nothing.
          The calendar stays mounted rather than swapped out: unmounting it
          would drop the manager's scroll position and open folders. */}
      {generation && (
        <div className="mt-4">
          <GenerationProgress state={generation} />
        </div>
      )}

      {/* What is underneath the work: visible, faded, inert. */}
      <div
        className={
          generation
            ? 'pointer-events-none opacity-40 transition-opacity duration-300 motion-reduce:transition-none'
            : 'transition-opacity duration-300 motion-reduce:transition-none'
        }
        aria-busy={generation !== null}
      >
        {/* The three views are the tablist's panels (ViewTabs, in the
            toolbar). Each is always on the page, shown or hidden, so every
            tab names a panel that exists; what a panel HOLDS is still only
            built while it is showing. The one being shown comes in from the
            side the pill went (`cal-panel-in`, `--dir`). */}
        {result && (
          <div
            {...viewPanel('payroll')}
            tabIndex={0}
            hidden={view !== 'payroll'}
            className={[PANEL_FOCUS, panelMotion].join(' ')}
            style={panelStyle}
          >
            {view === 'payroll' && (
              <PayrollView
                assignments={result.assignments}
                employees={roster}
                days={days}
                policy={payPolicy}
                periodLabel={rangeLabel}
                belowMinimum={result.belowMinimum}
                minimumWage={minWage ?? minimumWage(laborProfiles.data ?? [], jurisdiction)}
                nightPremiumFloor={nightPremiumFloor(laborProfiles.data ?? [], jurisdiction)}
                weekendDays={spec.weekendDays}
                year={spec}
                nightWindow={spec.nightWindow}
              />
            )}
          </div>
        )}

        <div
          {...viewPanel('workday')}
          tabIndex={result ? 0 : undefined}
          hidden={view !== 'workday'}
          className={[PANEL_FOCUS, panelMotion].join(' ')}
          style={panelStyle}
        >
          {view === 'workday' && (
            <WorkdayView data={workday.data ?? null} loading={workday.isLoading} />
          )}
        </div>

        {/* The year, or one day of it. Nothing in between, which is the
            whole point: there is no view that can be narrower than the period
            being saved, so a draft can no longer go up in a window three days
            short of the month it belongs to. */}
        {/* Two columns on a wide monitor, one on anything narrower. The hours
            column is the half that gives way: it falls UNDER the calendar
            rather than squeezing it, because a rota too tight to read is worse
            than a balance the manager has to scroll to. The threshold is where
            both fit whole -- see DraftBalanceColumn and the page container in
            DashboardLayout, which widens for this page at the same width. */}
        <div
          {...viewPanel('calendar')}
          hidden={view !== 'calendar'}
          className={
            view === 'calendar'
              ? ['mt-4 flex flex-col items-start gap-4 min-[1440px]:flex-row min-[1440px]:gap-3', panelMotion].join(' ')
              : 'hidden'
          }
          style={panelStyle}
        >
          {/* `min-w-0` is load-bearing: without it a flex child refuses to
              shrink below its content and the day grid pushes the column off
              the screen instead of scrolling inside its own box. */}
          <div className="w-full min-w-0 flex-1">
            {loading && (
              <div className="m-glass rounded-2xl border border-white/[0.08] p-10 text-center text-sm text-gray-500">
                {t('dashboard.loading')}
              </div>
            )}

            {!loading && focus.kind === 'year' && (
              // It animates itself: the months cascade in, or settle after
              // a day closes, and the day just closed is rung (YearGrid).
              <YearGrid
                year={focus.year}
                marks={marks.data ?? new Map()}
                today={new Date()}
                loading={marks.isLoading}
                onOpenDay={openDay}
                onYearChange={showYear}
                onToday={(from) => openDay(dateKey(new Date()), from)}
                arrival={yearArrival}
                landing={landing}
                arrivalKey={landedAt}
              />
            )}

            {!loading && focus.kind === 'day' && (
              <DayView
                // Keyed on the date so every step remounts and the entrance
                // plays again: stepping through days reads as turning pages.
                key={focus.date}
                date={focus.date}
                onPrev={() => stepDay(-1)}
                onNext={() => stepDay(1)}
                onClose={closeDay}
                entrance={dayEntrance}
                origin={dayOrigin}
                arrivalKey={landedAt}
                // Hidden under another tab, it keeps its hands off the keys.
                keys={view === 'calendar'}
              >
                {result ? (
                  renderDay(
                    shownDays.find((d) => d.date === focus.date) ?? {
                      date: focus.date,
                      weekday: fromDateKey(focus.date).getDay(),
                      label: fromDateKey(focus.date).toLocaleDateString(APP_LOCALE, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      }),
                    },
                  )
                ) : generation ? null : unplannedWithRules ? (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-surface p-10 text-center">
                    <p className="text-base font-medium text-gray-900">
                      {t('dashboard.empty.unplanned.title', { month: capitalize(periodMonths) })}
                    </p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                      {t('dashboard.empty.unplanned.body')}
                    </p>
                    <button
                      type="button"
                      onClick={planUnplanned}
                      className="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-[0_10px_28px_-12px_rgb(68_214_180/0.6)] transition-colors hover:bg-brand-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none"
                    >
                      {t('dashboard.empty.unplanned.action', { month: periodMonths })}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-surface p-10 text-center">
                    <p className="text-base font-medium text-gray-900">
                      {t('dashboard.empty.title')}
                    </p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                      {t('dashboard.empty.body')}{' '}
                      {roster.length === 0
                        ? t('dashboard.empty.rosterEmpty')
                        : roster.length === 1
                          ? t('dashboard.empty.rosterCount.one', {
                              count: roster.length,
                            })
                          : t('dashboard.empty.rosterCount.other', {
                              count: roster.length,
                            })}{' '}
                      {t('dashboard.empty.horizon.month')}
                    </p>
                  </div>
                )}
              </DayView>
            )}
          </div>

          {/* Only with a draft on screen. With nothing to publish the column
              would be three columns of the roster's own figures, repeated
              beside a calendar -- and the roster already says them better. */}
          {result && (
            <DraftBalanceColumn
              balances={balances.data ?? null}
              draft={result.assignments}
              settled={settledDraft}
              loading={balances.isLoading}
            />
          )}
        </div>
      </div>
    </div>
  );
}
