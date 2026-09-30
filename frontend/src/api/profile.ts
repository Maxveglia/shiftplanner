// What the product believes about this business, and the manager's control over it.
//
// The adaptive layer is only defensible if the manager can see all of it. Every
// belief here comes back with the evidence that earned it and a way to switch
// it off, and the whole thing has one master switch.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import type { EditOp } from '../lib/schedule/refine';

export interface VerticalOut {
  code: string;
  label: string;
}

export interface LearnedHint {
  /** The shape of the claim: "min_staff", "busy_window:5:1200-1380", … */
  key: string;
  /**
   * The claim's own numbers -- staff, weekday, startMin, closeMin.
   *
   * What the sentence is built from, client-side, in the manager's language.
   * Absent on a server older than this client, and then `claim` is all there
   * is. See lib/schedule/hints.
   */
  value?: Record<string, unknown> | null;
  /**
   * The same statement in English, written by the server.
   *
   * The prompt reads it, and the client falls back to it for a claim shape it
   * has no sentence for. Never branch on it.
   */
  claim: string;
  /** Separate days this correction has been seen on. */
  evidence: number;
  /** Days needed before it is allowed to affect a calendar. */
  needed: number;
  contradictions: number;
  /** Whether it currently changes anything. */
  active: boolean;
  rejected: boolean;
  /**
   * Read out of something the manager SAID, rather than inferred from what
   * they corrected.
   *
   * The two need different words and a different control. An inferred hint is
   * promoted by evidence ("seen on 2 of the 3 days needed"); a stated one is
   * promoted by the manager confirming it, and `evidence`/`needed` mean
   * nothing beside a sentence they typed. Absent on a server older than this
   * client, which then behaves exactly as it did before.
   */
  stated?: boolean;
  /** For a stated rule: whether they have confirmed it. */
  accepted?: boolean;
}

/** What the research inferred, in the shape the planner acts on. */
export interface ResearchSignalsOut {
  busy_weekdays: number[];
  busy_windows: [number, number][];
  peak_staff: number | null;
  busy_months: number[];
  quiet_months: number[];
  holidays: { date: string; name: string; closes: boolean }[];
  /** The one clause explaining it, in the manager's language. */
  rationale: string;
}

export interface BusinessProfile {
  vertical: string | null;
  vertical_source: 'declared' | 'inferred';
  house_notes: string | null;
  /** What the manager said in the opening interview, approved by them. */
  interview_notes: string | null;
  interviewed_at: string | null;
  /** Where the business is, in the manager's own words. */
  location: string | null;
  /**
   * The labour jurisdiction in force, from the organization.
   *
   * Distinct from `location`: this is a body of rules we hold, and there are
   * three of them. A business elsewhere has a real location and no applicable
   * jurisdiction, and both halves of that have to be storable.
   */
  jurisdiction_code: string;
  /** What we looked up about businesses like this one. Ours, not theirs. */
  research_notes: string | null;
  /**
   * What that research MEANS for the calendar, as figures rather than prose.
   *
   * Shown beside the paragraph it was drawn from, because this is the panel
   * where a manager reads every belief the product holds about them -- and a
   * belief that changes who works on Friday belongs in it. Null for a business
   * whose research never ran, or whose inference came back empty.
   */
  research_signals: ResearchSignalsOut | null;
  /** ISO timestamp of that research, or null if nobody has looked. */
  researched_at: string | null;
  learning_enabled: boolean;
  /**
   * Where this business's day ends, and which days are its weekend.
   *
   * Both null until somebody says, and null is not the same as the default it
   * falls back to: it is how "nobody has been asked" is told apart from "the
   * manager confirmed midnight", which is the distinction the vertical
   * proposals will need.
   */
  day_boundary_min: number | null;
  weekend_days: number[] | null;
  /**
   * Which trade-off this business wants made when several legal rotas exist,
   * as one of `ObjectiveCode` -- or null, meaning nobody has chosen.
   *
   * A CODE, and the weights it stands for never cross the wire: they live in
   * lib/schedule/objective beside the generator that scores with them. Typed
   * as a plain string on purpose, so a code from a newer server deserialises
   * instead of throwing; `objectiveFor` is where an unknown one turns back
   * into the default.
   */
  objective: string | null;
  /**
   * Whether this org has still to be asked the questions a new account gets
   * once. False by default and for every org that predates the flow, so a
   * business already using the product is never interrupted by it.
   */
  first_run_pending: boolean;
  hints: LearnedHint[];
  verticals: VerticalOut[];
}

/** The profile's query, shared by the hook and by whoever warms it up in advance. */
export const businessProfileQuery = {
  queryKey: queryKeys.businessProfile,
  queryFn: async () => {
    const { data } = await api.get<BusinessProfile>('/profile');
    return data;
  },
};

export function useBusinessProfile(enabled = true) {
  return useQuery({ ...businessProfileQuery, enabled });
}

export interface ProfileUpdate {
  vertical?: string;
  /** "" clears it. */
  location?: string;
  /** Must be a jurisdiction we hold rules for, or the server answers 422. */
  jurisdiction_code?: string;
  house_notes?: string;
  /** "" clears it. Editable so a paraphrase can be corrected. */
  interview_notes?: string;
  /** "" clears it. Ours, from a web search, and the belief most worth striking out. */
  research_notes?: string;
  learning_enabled?: boolean;
  day_boundary_min?: number;
  /** An empty list is an answer -- an office with no weekend differential. */
  weekend_days?: number[];
  /**
   * An objective code, or `''` to go back to having chosen nothing.
   *
   * Same shape as the empty weekend, for the same reason: leaving the field out
   * means "not touching this", so clearing needs a value of its own. Without
   * one, picking a profile would be a door that only opens one way.
   */
  objective?: string;
  /** Sent as false when the first-run questions are answered OR skipped. */
  first_run_pending?: boolean;
}

export function useUpdateBusinessProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ProfileUpdate) => {
      const { data } = await api.put<BusinessProfile>('/profile', payload);
      return data;
    },
    onSuccess: (data) => qc.setQueryData(queryKeys.businessProfile, data),
  });
}

/** Accept or reject one belief. Rejection keeps the evidence, drops the effect. */
export function useSetHintRejected() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      key,
      rejected,
      accepted,
    }: {
      key: string;
      rejected: boolean;
      /** Only meaningful for a stated rule: the confirmation that activates it. */
      accepted?: boolean;
    }) => {
      const { data } = await api.put<BusinessProfile>(
        `/profile/hints/${encodeURIComponent(key)}`,
        accepted === undefined ? { rejected } : { rejected, accepted },
      );
      return data;
    },
    onSuccess: (data) => qc.setQueryData(queryKeys.businessProfile, data),
  });
}

/**
 * The wire shape the server learns from.
 *
 * `set_hours` is the one operation whose client-side field names differ from
 * the wire ones (`open`/`close` here, `start`/`end` there), so it is mapped
 * back rather than teaching the server a second spelling.
 */
function toObservation(op: EditOp): Record<string, unknown> {
  if (op.op === 'set_hours') {
    return { op: op.op, start: op.open, end: op.close };
  }
  return { ...op } as Record<string, unknown>;
}

/**
 * Tell the server which corrections actually landed.
 *
 * Fire-and-forget on purpose: this is a background signal, and a manager whose
 * calendar is correct must never see an error because we failed to write down
 * why. The server drops anything about a person before it stores a row.
 *
 * `text` is the sentence the operations came from, left undefined when they
 * did not come from one. It is what tells "this Saturday, four" from "always
 * four" -- the same `set_min_staff` either way -- and so whether the server
 * keeps the correction as a rule for every brief after it. The server masks
 * the names in it before asking, and does not store it.
 */
export function useRecordObservations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ops, text }: { ops: EditOp[]; text?: string }) => {
      if (ops.length === 0) return { recorded: 0, learned: [] as string[] };
      const { data } = await api.post<{ recorded: number; learned: string[] }>(
        '/profile/observations',
        { ops: ops.map(toObservation), text },
      );
      return data;
    },
    onSuccess: (data) => {
      if (data.learned.length > 0) {
        qc.invalidateQueries({ queryKey: queryKeys.businessProfile });
      }
    },
  });
}

/**
 * The two business settings an employee's own screens have to agree with.
 *
 * Read from `/me/business` rather than `/profile`, which is manager-only: an
 * employee needs to know when their employer's day ends and which days it pays
 * as a weekend, and nothing else the profile holds. Both come back null until
 * somebody sets them, and every reader falls back to midnight and Sat/Sun.
 */
export interface BusinessShape {
  day_boundary_min: number | null;
  weekend_days: number[] | null;
}

export function useMyBusinessShape() {
  return useQuery({
    queryKey: queryKeys.myBusiness,
    queryFn: async () => {
      const { data } = await api.get<BusinessShape>('/me/business');
      return data;
    },
  });
}
