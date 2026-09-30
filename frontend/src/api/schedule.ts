import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import type { AssignmentOut, DraftOut, PublishResult, TeamMemberSpec } from '../types';
import type { Assignment, SchedulingSpec } from '../lib/schedule/types';
import { toShiftPayload } from '../lib/schedule/persist';
import { dateKey } from '../lib/schedule/focus';

/** One thing this business's own past corrections added to the spec. */
export interface AppliedHint {
  key: string;
  /** The claim's numbers, for the sentence the client writes. See `LearnedHint`. */
  value?: Record<string, unknown> | null;
  field: string;
  /** The English sentence the server composed. A fallback, never a source. */
  label: string;
  source: 'profile';
  /** Separate days of evidence behind it. */
  evidence: number;
}

/**
 * A requirement nobody stated, and what was decided instead.
 *
 * Two kinds, told apart by `filledBy`. A `derived` one rests on something this
 * brief actually said -- "one more than the floor, because you called Mondays
 * busier" -- and is defensible. A `default` one rests on nothing at all, and
 * `reason: 'generic'` is the honest admission of that. Both are shown; the
 * manager is owed the difference between the two.
 */
export interface SpecGap {
  field: string;
  label: string;
  filledBy: 'default' | 'derived';
  /**
   * The figure that ended up in the spec, when the field is a single one.
   * Null for the fields that are not a number (which hours, which closures).
   */
  value?: number | number[] | null;
  /**
   * WHY that figure, as a discriminant rather than a sentence.
   *
   * The sentence is built client-side from this and `params`, because it is
   * shown to a person and the server has no dictionary. Never branch on the
   * label.
   */
  reason?:
    | 'generic'
    | 'lowest_stated'
    | 'ranked_weekday'
    | 'ranked_window'
    // Inferred from what we looked up about this trade in this city, rather
    // than from anything the brief said. Same rules, different sentence: the
    // manager is owed the difference between their own words and our reading.
    | 'researched_weekday'
    | 'researched_window'
    | 'researched_holiday';
  /** The numbers the sentence interpolates: staff, weekday, startMin, floor. */
  params?: Record<string, number>;
  /**
   * One clause about this trade in this city, for the `researched_*` reasons.
   *
   * Its own field rather than a string among the numbers in `params`: those
   * are interpolated into a translated sentence and every reader of them
   * expects a number. This is quoted, shown, and never branched on -- the
   * `reason` is what the client branches on.
   */
  why?: string;
  /** The day a `researched_holiday` closes, as "YYYY-MM-DD". */
  date?: string;
  /** Whether it is worth interrupting the manager about. */
  loud: boolean;
}

/** An industry-typical proposal. Never applied — the manager accepts it. */
export interface ProfileSuggestion {
  key: string;
  label: string;
  field: string;
  shape: string;
  value: unknown;
  source: 'template';
  vertical: string;
}

/**
 * Something the manager stated that needs one answer from them to be enforced.
 *
 * Not a gap (nobody mentioned it) and not a note (we cannot express it at all).
 *
 * The server sends none today. "Saturdays are our busiest" used to arrive here
 * and is an ASSUMPTION now -- one more than the floor, shown and correctable --
 * because a question asked in the abstract is answered worse than a rota that
 * is visibly wrong. What belongs here is the residue that no rota can show: a
 * stretch of a brief we understood and could turn into no number at all
 * ("sábados casi todo el día" -- open at eight, at ten, at twelve?). The type
 * and its component stay for that.
 */
export interface OpenQuestion {
  id: string;
  kind: 'day_hours';
  /** The day being asked about, 0 = Sunday. */
  weekday: number;
  /**
   * The manager's own words that raised the question, verbatim.
   *
   * Asking "what hours do you keep on Saturdays?" of somebody who has just
   * written about Saturdays reads as not having listened. Empty when the model
   * returned no quote, and then the question is asked without one rather than
   * quoting silence.
   */
  quote: string;
}

/** One answer, on its way to being remembered. */
export interface DeclareDayHours {
  weekday: number;
  open_min: number;
  close_min: number;
}

/**
 * Remember the hours a manager just gave us for one weekday.
 *
 * The calendar does not wait for this: the client already has the answer and
 * redraws immediately. This is the half that makes the question worth
 * answering -- the next brief that goes quiet about that day gets these hours
 * instead of a coin flip.
 */
export async function declareDayHours(body: DeclareDayHours): Promise<void> {
  await api.post('/schedule/declare', body);
}

export interface InterpretResponse {
  spec: SchedulingSpec;
  /** The team the brief described, if any — reconciled client-side. */
  team?: TeamMemberSpec[];
  source: 'claude';
  model: string | null;
  /** What we knew about this business and the brief left room for. */
  applied?: AppliedHint[];
  /** What nobody decided, so a default did. */
  gaps?: SpecGap[];
  /** What businesses like this one often do. Proposals, not rules. */
  suggestions?: ProfileSuggestion[];
  /** Requirements one answer away from being enforceable. */
  questions?: OpenQuestion[];
  /** What is in force because the manager said so. */
  declared?: Declaration[];
}

/**
 * Something this manager told us directly, and that the calendar is obeying.
 *
 * Its own list rather than a row in `applied`: that one is what we INFERRED
 * from watching corrections and carries days of evidence behind it. This
 * carries none, because it needs none — they said it.
 */
export interface Declaration {
  /** Identity of the claim, and what `forgetDeclaration` takes back. */
  key: string;
  /** The spec field it decided. */
  field: string;
  /**
   * The claim's own numbers — staff, weekday, startMin, closeMin.
   *
   * The sentence is built client-side from the key and these, never sent as
   * prose: the server has no dictionary, and a label it composed would be
   * English on a Spanish screen. Same contract as `SpecGap`.
   */
  value: Record<string, number | boolean>;
  source: 'declared';
  /** The gap it takes out of play, when it takes one. */
  gapField?: string | null;
}

/** Take back one thing the manager told us. Silent when it is already gone. */
export async function forgetDeclaration(key: string): Promise<void> {
  await api.delete(`/profile/declared/${encodeURIComponent(key)}`);
}

/**
 * Ask the server to translate the manager's brief into a scheduling spec using
 * Claude. Throws when the server has no API key (503) or the call fails (502);
 * the caller falls back to the local parser so the app still works offline.
 */
/**
 * Deadlines for the two calls that wait on a model.
 *
 * Both are generous on purpose -- the server's own attempt budget is the real
 * limit, and cutting the client off first would show a timeout for work that
 * was about to succeed. What they rule out is the case the default allowed:
 * waiting forever.
 */
const INTERPRET_TIMEOUT_MS = 300_000;
const REFINE_TIMEOUT_MS = 120_000;
// Generation is no longer a request that waits: it is a job, and these two are
// about the POLLING, not about one call.
//
// `PLAN_POLL_MS` is how often we ask how it is going -- the answer is one
// indexed read, and two seconds is what a progress panel needs to look alive.
//
// `PLAN_WAIT_MS` is how long the BROWSER stays interested. It is not a deadline
// for the work: the job keeps going on the server and a reopened tab finds it
// through `readLatestPlanJob`. Giving up here means "build the rest locally
// for now", which is why it can be generous -- a year is twelve months at up to
// nine minutes a batch in the worst case, and the old 600s ceiling was the
// thing that used to turn a slow year into a lost one.
const PLAN_POLL_MS = 2_000;
// How long the eager cadence lasts, and how much slower it gets after that.
// A month takes about a minute, so nothing useful happens in the first seconds
// except the job being picked up -- but that is the moment a manager is
// actually looking at the panel.
const EAGER_POLL_FOR_MS = 30_000;
const SETTLED_POLL_FACTOR = 3;
const PLAN_WAIT_MS = 1_500_000;

export async function interpretBrief(text: string): Promise<InterpretResponse> {
  const { data } = await api.post<InterpretResponse>(
    '/schedule/interpret',
    { text },
    { timeout: INTERPRET_TIMEOUT_MS },
  );
  return data;
}

export interface RefinePlanResponse {
  ops: Record<string, unknown>[];
  unsupported: string | null;
  source: 'claude';
  model: string | null;
}

/**
 * Ask the server to turn an adjustment request into edit operations.
 * Throws when Claude is unavailable; the caller falls back to the local parser
 * so the calendar can still be shaped offline.
 */
export async function refineSchedule(
  text: string,
  context: string,
): Promise<RefinePlanResponse> {
  const { data } = await api.post<RefinePlanResponse>(
    '/schedule/refine',
    { text, context },
    { timeout: REFINE_TIMEOUT_MS },
  );
  return data;
}

export interface PlannedShift {
  employeeId: string;
  date: string;
  /** 24-hour "HH:MM". */
  start: string;
  /** 24-hour "HH:MM". At or before `start` means it runs past midnight. */
  end: string;
  templateId?: string;
}

export interface PlanCalendarResponse {
  shifts: PlannedShift[];
  /** Months the model could not plan; the client covers these on its own. */
  failed: string[];
  source: 'claude';
  model: string | null;
}

/**
 * How hard the model is asked to think about a month.
 *
 * Every month used to be planned at `high`, and a month's OUTPUT -- which is
 * where the money is, at roughly forty times what the same count of input
 * tokens costs -- is the part that grows with it. A year of a manager's
 * calendar was twelve expensive calls to arrange twelve months that are nearly
 * always fine.
 *
 * The server's default is `medium` now. `high` is not gone: it is what a month
 * that came back BROKEN is asked again with, once, and `src/lib/schedule/
 * planRetry.ts` decides which months those are. That is the whole bargain --
 * cheap by default is only honest if the failures are still paid for.
 */
export type PlanEffort = 'medium' | 'high';

/**
 * Ask the server to draft the calendar, one month per call.
 *
 * What this business PREFERS is not sent from here: the server reads it from
 * the org's own profile. A preference the client could supply is a preference
 * the client could invent, and these decide how somebody's month is arranged.
 *
 * What comes back is a PROPOSAL. Nothing in it is trusted: `scheduleFromProposal`
 * parses it, prices it, validates it against the same rules the generator obeys,
 * drops whatever breaks one and fills the holes deterministically. So a caller
 * that catches this and builds the calendar locally loses quality, never
 * correctness -- which is why `months` failing individually is not an error.
 */
export type PlanJobStatus = 'queued' | 'running' | 'done' | 'failed';

/** A calendar being planned, and whatever of it has arrived. */
export interface PlanJob {
  jobId: string;
  status: PlanJobStatus;
  /** Every month the job was asked for. */
  months: string[];
  /** Months with an answer stored. What a progress panel counts. */
  done: string[];
  /** Months the model could not write. The client covers those itself. */
  failed: string[];
  shifts: PlannedShift[];
  /**
   * Whether `shifts` is the calendar or just absent.
   *
   * Polling asks for counts only, so a job read mid-flight has `done` months and
   * an empty `shifts`, which is indistinguishable from a job whose months are
   * genuinely empty -- and reading it as the latter is how ten planned months
   * turn into ten blank ones on screen with nothing to cover them.
   */
  shiftsLoaded: boolean;
  errorCode: string | null;
  source: 'claude';
  model: string | null;
  health: PlanJobHealth;
}

/**
 * Whether anybody is working on the job right now, as the server sees it.
 *
 * A deploy restarts the container the workers live in; the job survives and is
 * taken up again once it has been silent long enough, which takes minutes. A
 * progress panel that says nothing meanwhile reads as a hang -- it was one
 * manager's twenty minutes of "Reorganizando".
 */
export interface PlanJobHealth {
  /** Running, but no worker has checked in for over a minute and a half. */
  stalled: boolean;
  /** A worker died holding it and another has taken it up. */
  resumed: boolean;
}

/** The job never produced an answer at all -- no key, no credit, no model. */
export class PlanJobFailed extends Error {
  readonly code: string | null;

  constructor(code: string | null) {
    super(code ?? 'plan_failed');
    this.name = 'PlanJobFailed';
    this.code = code;
  }
}

interface PlanJobWire {
  job_id: string;
  status: PlanJobStatus;
  months: string[];
  done: string[];
  failed: string[];
  shifts: PlannedShift[];
  error_code: string | null;
  source: 'claude';
  model: string | null;
  attempts?: number;
  stalled?: boolean;
}

function toPlanJob(wire: PlanJobWire, shiftsLoaded = true): PlanJob {
  return {
    jobId: wire.job_id,
    status: wire.status,
    months: wire.months ?? [],
    done: wire.done ?? [],
    failed: wire.failed ?? [],
    shifts: wire.shifts ?? [],
    shiftsLoaded,
    errorCode: wire.error_code ?? null,
    source: wire.source,
    model: wire.model,
    health: { stalled: Boolean(wire.stalled), resumed: (wire.attempts ?? 1) > 1 },
  };
}

/** The job id an "already planning" refusal names, if that is what this is. */
function runningJobId(error: unknown): string | null {
  const detail = (error as { response?: { status?: number; data?: { detail?: unknown } } })
    ?.response;
  if (detail?.status !== 409) return null;
  const body = detail.data?.detail as
    | { code?: string; params?: { job_id?: string } }
    | undefined;
  if (body?.code !== 'generation_already_running') return null;
  return body.params?.job_id ?? null;
}

/**
 * Ask for a calendar. Returns as soon as the server has written the job down.
 *
 * What this business PREFERS is not sent from here: the server reads it from
 * the org's own profile. A preference the client could supply is a preference
 * the client could invent, and these decide how somebody's month is arranged.
 */
export async function enqueuePlan(
  context: string,
  months: string[],
  ids: { employees: string[]; templates: string[] } = { employees: [], templates: [] },
  opts: { effort?: PlanEffort } = {},
): Promise<PlanJob> {
  const { data } = await api.post<PlanJobWire>('/schedule/generate/jobs', {
    context,
    months,
    employees: ids.employees,
    templates: ids.templates,
    ...(opts.effort ? { effort: opts.effort } : {}),
  });
  return toPlanJob(data);
}

/**
 * Read a job. `shifts: false` asks for the counts alone.
 *
 * Polling uses the light form on purpose: a year is on the order of 1.500
 * shifts and the question being asked every few seconds is "how is it going?".
 * The calendar is read once, when it is finished.
 */
export async function readPlanJob(
  jobId: string,
  opts: { shifts?: boolean } = {},
): Promise<PlanJob> {
  const light = opts.shifts === false;
  const { data } = await api.get<PlanJobWire>(
    `/schedule/generate/jobs/${jobId}`,
    light ? { params: { shifts: false } } : undefined,
  );
  return toPlanJob(data, !light);
}

/**
 * The last calendar this account asked for, whatever became of it.
 *
 * What a reopened tab reads: a manager who shut the laptop mid-plan comes back
 * to the months that were written while it was closed, rather than to an empty
 * calendar and a line on the bill.
 */
export async function readLatestPlanJob(): Promise<PlanJob | null> {
  const { data } = await api.get<PlanJobWire | null>('/schedule/generate/jobs/latest');
  return data ? toPlanJob(data) : null;
}

const TERMINAL: ReadonlySet<PlanJobStatus> = new Set<PlanJobStatus>(['done', 'failed']);

/**
 * Watch a job until it settles, or until we stop being interested.
 *
 * `read` and `wait` are injected so the loop can be tested without a network
 * or a clock -- this is the one piece of the queue the browser owns, and a
 * polling loop nobody can test is a polling loop that spins forever in
 * production.
 *
 * Running out of patience is NOT an error: the last state seen is returned, the
 * caller treats the months that did not arrive as unplanned and builds them
 * itself, and the job carries on server-side for the next tab that asks.
 */
export async function awaitPlanJob(
  job: PlanJob,
  deps: {
    read?: (jobId: string, opts?: { shifts?: boolean }) => Promise<PlanJob>;
    wait?: (ms: number) => Promise<void>;
    now?: () => number;
    onProgress?: (done: number, total: number, health?: PlanJobHealth) => void;
    pollMs?: number;
    waitMs?: number;
  } = {},
): Promise<PlanJob> {
  const read = deps.read ?? readPlanJob;
  const wait =
    deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const pollMs = deps.pollMs ?? PLAN_POLL_MS;
  const waitMs = deps.waitMs ?? PLAN_WAIT_MS;

  const giveUpAt = now() + waitMs;
  let latest = job;
  deps.onProgress?.(
    latest.done.length + latest.failed.length,
    latest.months.length,
    latest.health,
  );

  const startedAt = now();
  while (!TERMINAL.has(latest.status)) {
    if (now() >= giveUpAt) return latest;
    // Eager at first, then calmer. The first month lands in about a minute, so
    // the early seconds are where a quick answer is worth a request; after that
    // a manager is not watching the seconds and a year of polling at two
    // seconds is hundreds of requests for one calendar.
    const eager = now() - startedAt < EAGER_POLL_FOR_MS;
    await wait(eager ? pollMs : pollMs * SETTLED_POLL_FACTOR);
    try {
      latest = await read(latest.jobId, { shifts: false });
    } catch {
      // A poll that fails is not a job that failed: a dropped connection, a
      // token refreshed in another tab. Keep asking until the patience above
      // runs out -- the work is on the server either way.
      continue;
    }
    deps.onProgress?.(
      latest.done.length + latest.failed.length,
      latest.months.length,
      latest.health,
    );
  }

  // The polls above asked for counts only, so the calendar has to be read now
  // -- once. Whatever the status: a job that ENDED badly, or one we stopped
  // waiting for, can still have months that were written and billed, and those
  // are precisely the ones this whole change exists to stop throwing away.
  if (latest.done.length > 0 && !latest.shiftsLoaded) {
    try {
      latest = await read(latest.jobId, { shifts: true });
    } catch {
      /* keep what we have */
    }
  }
  return latest;
}

/**
 * Ask the server to draft the calendar and wait for it, as one call.
 *
 * SAME SIGNATURE, SAME ANSWER, different transport. It used to be one HTTP
 * request that stayed open for the minutes the model took, so a manager who
 * closed the tab threw away months that had already been billed. Now it queues
 * a job, watches it, and hands back exactly the shape it always did -- which is
 * why the calendar code above it did not have to learn anything.
 *
 * What comes back is a PROPOSAL. Nothing in it is trusted: `scheduleFromProposal`
 * parses it, prices it, validates it against the same rules the generator obeys,
 * drops whatever breaks one and fills the holes deterministically. So a caller
 * that catches this and builds the calendar locally loses quality, never
 * correctness -- which is why `months` failing individually is not an error.
 */
export async function planCalendar(
  context: string,
  months: string[],
  // The ids inside `context`, said plainly. The server shortens them for the
  // model -- a month of shifts is mostly ids -- and these are what let it tell
  // a person from a shift template when the answer comes back.
  ids: { employees: string[]; templates: string[] } = { employees: [], templates: [] },
  // `effort` is left off for the ordinary pass ON PURPOSE, rather than sent as
  // 'medium': what the cheap setting IS belongs to the server, next to the
  // prompt and the budget it has to fit. Only the deliberate second attempt
  // names one.
  opts: {
    effort?: PlanEffort;
    onProgress?: (done: number, total: number, health?: PlanJobHealth) => void;
  } = {},
): Promise<PlanCalendarResponse> {
  let job: PlanJob;
  try {
    job = await enqueuePlan(context, months, ids, opts);
  } catch (error) {
    // Another tab -- or this one before a reload -- already has one in flight.
    // Joining it is the honest answer: refusing would tell the manager to wait
    // for something they cannot see, and asking again would buy the same
    // months twice.
    const already = runningJobId(error);
    if (!already) throw error;
    job = await readPlanJob(already, { shifts: false });
    // Only if it is planning what we asked about. Another tab generating next
    // year is not an answer to a question about this one, and adopting it would
    // hand back that job's months as the unplanned ones -- so the manager would
    // get a locally-built calendar with no sign that the model never saw it.
    const covered = new Set(job.months);
    if (!months.every((month) => covered.has(month))) {
      throw new PlanJobFailed('generation_already_running');
    }
  }

  return collectPlanJob(job, { ...opts, want: months });
}

/**
 * Wait for a job already in flight and read it as an ordinary plan answer.
 *
 * Its own function because there are two ways to arrive at a job: asking for
 * one, and FINDING one -- a tab reopened while the server was still writing.
 * Both deserve the same handling of a failure and of the months that never
 * came, and having written that twice is how they would drift apart.
 */
export async function collectPlanJob(
  job: PlanJob,
  opts: {
    onProgress?: (done: number, total: number, health?: PlanJobHealth) => void;
    /**
     * The months the CALLER asked about, when they are not the job's own. Set
     * when joining a job somebody else started: without it the answer would
     * report the other job's months as unplanned and say nothing about the ones
     * that were actually wanted.
     */
    want?: string[];
  } = {},
): Promise<PlanCalendarResponse> {
  const finished = await awaitPlanJob(job, { onProgress: opts.onProgress });
  const months = opts.want ?? finished.months;

  // A failure with nothing to show for it. Only then: a job that died after
  // writing eight of twelve months has eight months that were BILLED, and
  // throwing them away here would reintroduce, at the last step, the exact loss
  // the queue was built to end.
  if (finished.done.length === 0 && finished.status === 'failed') {
    throw new PlanJobFailed(finished.errorCode);
  }

  // If the calendar could not be fetched -- the final read failed, or we ran out
  // of patience while months were still arriving -- then NOTHING is usable, and
  // saying so is the only safe answer. Reporting those months as planned would
  // leave them blank on screen with nothing to fill them: the deterministic pass
  // only covers what it is told is missing.
  if (!finished.shiftsLoaded) {
    return {
      shifts: [],
      failed: [...months],
      source: finished.source,
      model: finished.model,
    };
  }

  // Anything that did not arrive counts as unplanned -- a month the model
  // refused, and a month we stopped waiting for. Both mean the same thing to the
  // caller: cover it locally.
  const arrived = new Set(finished.done);
  return {
    shifts: finished.shifts,
    failed: months.filter((m) => !arrived.has(m)),
    source: finished.source,
    model: finished.model,
  };
}

/** True while a job is still expected to produce something. */
export function planJobIsLive(job: PlanJob): boolean {
  return job.status === 'queued' || job.status === 'running';
}

/**
 * The published schedule for a window.
 *
 * Same endpoint for both roles; the server decides what it contains. A manager
 * gets the whole team, an employee gets their own shifts and nothing else.
 */
export function usePublishedSchedule(
  from: Date,
  to: Date,
  enabled = true,
  // `fresh` refetches on every mount: for the publish dialog, which must
  // compare against what the server holds now, not a cached opinion.
  opts: { fresh?: boolean } = {},
) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return useQuery({
    queryKey: queryKeys.publishedSchedule(fromIso, toIso),
    enabled,
    ...(opts.fresh ? { staleTime: 0, refetchOnMount: 'always' as const } : {}),
    queryFn: async () => {
      const { data } = await api.get<AssignmentOut[]>('/schedule/assignments', {
        params: { from: fromIso, to: toIso },
      });
      return data;
    },
  });
}

export interface PublishArgs {
  from: Date;
  to: Date;
  assignments: Assignment[];
}

/**
 * Hand the draft to the team.
 *
 * A replace over the window, not an append: whatever the manager is looking at
 * becomes exactly what the team sees, so removing a shift from the draft
 * removes it from someone's week too.
 */
export function usePublishSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ from, to, assignments }: PublishArgs) => {
      const { data } = await api.post<PublishResult>('/schedule/publish', {
        period_start: from.toISOString(),
        period_end: to.toISOString(),
        shifts: assignments.map(toShiftPayload),
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule', 'published'] });
      // Publishing replaces every row in the window, drafts included: the
      // draft the server holds for it is gone, and the next read says so.
      qc.invalidateQueries({ queryKey: ['schedule', 'draft'] });
    },
  });
}

/**
 * The draft for a window, as the server holds it.
 *
 * The draft used to live in one browser's localStorage and nowhere else, so
 * the rota a manager refined on the office laptop was not the one they saw on
 * their phone. Now every edit is pushed here (see `useSaveDraft`) and every
 * window opened is read back from here first: the same unpublished draft on
 * every browser. Managers only -- an employee never sees a draft row.
 */
export function useDraftSchedule(from: Date, to: Date, enabled = true) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return useQuery({
    queryKey: queryKeys.draftSchedule(fromIso, toIso),
    enabled,
    queryFn: async () => {
      const { data } = await api.get<AssignmentOut[]>('/schedule/draft', {
        params: { from: fromIso, to: toIso },
      });
      return data;
    },
  });
}

/**
 * Which days of a year carry shifts, and whether the team has seen them.
 *
 * What the year grid is drawn from. Two fields per shift rather than whole
 * assignments: colouring 365 squares does not need employees, costs or
 * templates, and a year of full rows is megabytes to decide a shade.
 *
 * The local day is worked out HERE, from the instant and this browser's
 * clock, exactly as `fromAssignmentOut` does for the calendar itself -- so
 * the day a dot is drawn on and the day a rota is read by are the same day.
 */
export function useShiftMarks(year: number, enabled = true) {
  const from = new Date(year, 0, 1);
  const to = new Date(year + 1, 0, 1);
  return useQuery({
    queryKey: queryKeys.shiftMarks(year),
    enabled,
    queryFn: async () => {
      const { data } = await api.get<{ start_at: string; status: string }[]>(
        '/schedule/marks',
        { params: { from: from.toISOString(), to: to.toISOString() } },
      );
      const marks = new Map<string, { published: boolean; draft: boolean }>();
      for (const row of data) {
        const key = dateKey(new Date(row.start_at));
        const at = marks.get(key) ?? { published: false, draft: false };
        if (row.status === 'published') at.published = true;
        else if (row.status === 'draft') at.draft = true;
        marks.set(key, at);
      }
      return marks;
    },
  });
}

/**
 * Keep the draft on the server.
 *
 * The same shape as a publish and the same rule: a replace over the window,
 * so what is on screen is exactly what the server holds. An empty list is a
 * valid draft -- it is how "New calendar" reaches the other browser.
 */
export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ from, to, assignments }: PublishArgs) => {
      const { data } = await api.put<DraftOut>('/schedule/draft', {
        period_start: from.toISOString(),
        period_end: to.toISOString(),
        shifts: assignments.map(toShiftPayload),
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule', 'draft'] });
    },
  });
}

/** One colleague's shift, as an employee may see it. */
export interface TeammateShift {
  employee_id: string;
  employee_name: string;
  start_at: string;
  end_at: string;
  unpaid_break_minutes: number;
  is_self: boolean;
}

/**
 * Who the reader is on with, on a day the reader works.
 *
 * The only place an employee sees past their own row, and the narrowing is
 * the server's: a window they have a published shift in, published shifts
 * only, and a payload with no cost, contract or absence in it. A 403 here is
 * not a failure -- it is a day they are off.
 */
export function useDayTeam(from: Date, to: Date, enabled = true) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return useQuery({
    queryKey: ['schedule', 'day-team', fromIso, toIso] as const,
    enabled,
    // A day that is off answers 403 and will answer it again; retrying is
    // three more requests for the same no.
    retry: false,
    queryFn: async () => {
      const { data } = await api.get<TeammateShift[]>('/schedule/day-team', {
        params: { from: fromIso, to: toIso },
      });
      return data;
    },
  });
}
