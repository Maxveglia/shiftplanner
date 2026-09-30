// The opening interview: a few questions about the business, asked by Gemini,
// that come back as a paragraph the manager approves. Stateless while it
// runs: the whole transcript goes up every turn. What is kept is the ending
// -- `completeInterview` writes the approved paragraph to the business
// profile, and from then on every brief is read with it as background.
//
// Free tier on the server side, which is why the server -- not this client --
// is the one that enforces what is asked. Nothing from the stored roster is
// ever sent: only what the manager typed or filled in here, which since
// 2026-09-14 includes the names of the people who work there and their
// contract hours, and nothing else about any of them. See backend
// services/interview.py.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';

export interface InterviewMessage {
  role: 'manager' | 'assistant';
  text: string;
}

/** The forms this client can put under a question. A code, never a guess. */
export type InterviewForm = 'roster';

export interface InterviewTurn {
  reply: string;
  done: boolean;
  brief: string | null;
  /**
   * Which form answers this question, when one of ours does.
   *
   * The server sends the code the model chose, and only codes it knows; an
   * unknown one arrives as null, so a question we have no table for is
   * answered the way every other one is -- by typing.
   */
  form?: InterviewForm | null;
  /**
   * With the roster form: how many people the manager already said work
   * there, so the table opens with a row each. Null when they never gave a
   * number, and then the table opens with one empty row.
   */
  form_people?: number | null;
}

/** Weekday (0 = Sunday) -> [open, close] in minutes from that day's midnight, or null when closed. */
export type OpenHoursPayload = Record<string, [number, number] | null>;

export interface InterviewCompletion {
  /** The paragraph the manager approved. Empty means they skipped. */
  notes: string;
  /** The week from the opening-hours form, when they filled it in. */
  open_hours?: OpenHoursPayload;
}

export interface ResearchSource {
  title: string;
  url: string;
}

export interface ResearchResult {
  summary: string;
  sources: ResearchSource[];
  researched_at: string;
}

/** Whether the server offers the interview (a GEMINI_API_KEY is configured). */
/** The status's query, shared by the hook and by whoever warms it up in advance. */
export const interviewStatusQuery = {
  queryKey: queryKeys.interviewStatus,
  queryFn: async () => {
    const { data } = await api.get<{ available: boolean; model: string | null }>(
      '/interview/status',
    );
    return data;
  },
  staleTime: 5 * 60_000,
};

export function useInterviewStatus(enabled = true) {
  return useQuery({ ...interviewStatusQuery, enabled });
}

/**
 * How long a turn of the interview may take before we call it lost.
 *
 * Above the server's own deadline for a turn (TURN_DEADLINE_S, 37 s with the
 * Claude fallback, in services/interview.py), so that when Gemini is slow the server is the one
 * that gives up -- with a sentence the manager can read -- and not this
 * client, with "timeout of 30000ms exceeded" while a retry was still running.
 */
export const INTERVIEW_TURN_TIMEOUT_MS = 50_000;

export async function interviewTurn(
  messages: InterviewMessage[],
  language: string,
  finish = false,
): Promise<InterviewTurn> {
  const { data } = await api.post<InterviewTurn>(
    '/interview/turn',
    { messages, language, finish },
    { timeout: INTERVIEW_TURN_TIMEOUT_MS },
  );
  return data;
}

/**
 * Keep what the interview found out, and close the first run.
 *
 * Empty notes are a skip: the first run closes and nothing is remembered.
 * The profile is refetched rather than patched by hand because the server
 * stamps `interviewed_at` and flips `first_run_pending`, and guessing at
 * both here is how a dashboard shows the questions a second time.
 */
export function useCompleteInterview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (completion: InterviewCompletion) => {
      const { data } = await api.post<{ remembered: boolean; hours_declared: number }>(
        '/interview/complete',
        completion,
      );
      return data;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.businessProfile }),
  });
}

/**
 * Look up, on the web, how a business like this one usually runs where it
 * is, and keep the summary on the profile as OURS -- the planner reads it
 * labelled as something we found, never as something the manager said.
 *
 * Built on the server from what the interview left, so it is only worth
 * calling once `completeInterview` has kept something. Slow (it searches),
 * allowed to fail, and refetches the profile because the server stamps
 * `researched_at`.
 */
export function useResearchBusiness() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (language: string) => {
      const { data } = await api.post<ResearchResult>('/interview/research', { language });
      return data;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.businessProfile }),
  });
}
