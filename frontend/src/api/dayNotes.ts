// The manager's notes of each day, and the addresses they are shared with.
//
// One list of addresses, two channels: every address is emailed when the
// manager sends a note, and an address that is also a login in this business
// reads the notes in the app (the feed).
//
// Each saved note is also read by a small model in the background, which pulls
// out what it says about the BUSINESS -- takings, busy and quiet hours, where
// people were short -- so the planner can use it. The reading comes back on the
// note as `insight`, and the whole of what has been learned as the summary.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';
import { pollInterval, removeNote, upsertNote } from '../lib/dayNotes/insight';
import { withInFlight, type InFlight } from '../lib/dayNotes/unsaved';

/** Mutation keys, so the list can find the writes still on their way. */
const SAVE_KEY = ['day-notes', 'save'] as const;
const DELETE_KEY = ['day-notes', 'delete'] as const;

/**
 * The saves and deletes the server has not answered yet, oldest first. A list
 * fetched while one is out left the server before it arrived, so these are
 * replayed on top of it (see lib/dayNotes/unsaved). A write that FAILED is no
 * longer pending and is not replayed: its words live with the page, which
 * keeps them and says so.
 */
function inFlight(qc: QueryClient): InFlight[] {
  return qc
    .getMutationCache()
    .findAll({ mutationKey: ['day-notes'], status: 'pending' })
    .sort((a, b) => a.mutationId - b.mutationId)
    .flatMap((m): InFlight[] => {
      const key = m.options.mutationKey?.[1];
      if (key === SAVE_KEY[1]) {
        const v = m.state.variables as { date: string; body: string } | undefined;
        return v ? [{ kind: 'save', date: v.date, body: v.body }] : [];
      }
      if (key === DELETE_KEY[1]) {
        const date = m.state.variables as string | undefined;
        return date ? [{ kind: 'delete', date }] : [];
      }
      return [];
    });
}

/** A stretch of the day. `end <= start` crosses midnight: 22:00–01:00. */
export interface TimeSpan {
  /** HH:MM */
  start: string;
  /** HH:MM */
  end: string;
}

/** What the model understood from ONE note. */
export interface DayInsight {
  revenue: number | null;
  customers: number | null;
  closed: boolean;
  busy: TimeSpan[];
  quiet: TimeSpan[];
  short_staffed: TimeSpan[];
  over_staffed: TimeSpan[];
  events: string[];
  /** The note changed and has not been read again yet; the screen polls. */
  pending: boolean;
}

export interface DayNote {
  /** YYYY-MM-DD. */
  note_date: string;
  body: string;
  updated_at: string;
  sent_at: string | null;
  /**
   * Null when the note was never read (learning off, no key). Optional because
   * the employee feed never carries it and an older server did not either.
   */
  insight?: DayInsight | null;
}

export interface DayNoteSaved extends DayNote {
  emailed: number;
  mail_configured: boolean;
}

export interface DayNoteReaders {
  readers: { email: string; has_login: boolean }[];
  mail_configured: boolean;
}

/** One weekday of what has been learned; 0 = Monday … 6 = Sunday. */
export interface WeekdayInsight {
  weekday: number;
  notes: number;
  avg_revenue: number | null;
  revenue_notes: number;
  avg_customers: number | null;
  busy: TimeSpan[];
  quiet: TimeSpan[];
  short_staffed: TimeSpan[];
  over_staffed: TimeSpan[];
  closed: number;
}

/** Everything learned from the notes of the last twelve weeks. */
export interface InsightSummary {
  notes_read: number;
  since: string | null;
  until: string | null;
  /** Always seven entries, Monday first. */
  by_weekday: WeekdayInsight[];
  recent_events: { date: string; text: string }[];
  learning_enabled: boolean;
}

/**
 * Everything a saved or deleted note changes: the list, the reader's feed, and
 * what has been learned. Not the readers -- a note does not change who reads
 * it, and the page asks for them on every autosave otherwise.
 */
function refreshNotes(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: queryKeys.dayNotes });
  qc.invalidateQueries({ queryKey: queryKeys.dayNoteFeed });
  qc.invalidateQueries({ queryKey: queryKeys.dayNoteInsights });
}

/**
 * The manager's notes. With `poll` on, the list is asked again every few
 * seconds for as long as one of its notes is still being read; the page turns
 * it off a while after the last change (see POLL_WINDOW_MS).
 */
export function useDayNotes(poll = false) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: queryKeys.dayNotes,
    queryFn: async () => {
      const { data } = await api.get<DayNote[]>('/day-notes');
      // Checked when the answer ARRIVES, not when the request left: a save
      // started in between is exactly the one this answer does not know about.
      return withInFlight(data, inFlight(qc));
    },
    refetchInterval: (query) => pollInterval(query.state.data, poll),
  });
}

export function useSaveDayNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: SAVE_KEY,
    mutationFn: async ({ date, body, send }: { date: string; body: string; send: boolean }) => {
      const { data } = await api.put<DayNoteSaved>(`/day-notes/${date}`, { body, send });
      return data;
    },
    // Into the list before the request leaves. The editor is remounted per
    // day and starts from the list, so a manager who writes, steps to the
    // next day and straight back must find their words there -- not the
    // version from before, which a keystroke would then save over them.
    onMutate: async ({ date, body }) => {
      await qc.cancelQueries({ queryKey: queryKeys.dayNotes });
      qc.setQueryData<DayNote[]>(queryKeys.dayNotes, (list) =>
        upsertNote(list, { note_date: date, body: body.trim() }),
      );
    },
    onSuccess: (saved) => {
      qc.setQueryData<DayNote[]>(queryKeys.dayNotes, (list) => upsertNote(list, saved));
      refreshNotes(qc);
    },
    // Back to what the server has. The words that failed are not lost: the
    // editor hands them to the page (and the journal) as the write rejects.
    //
    // NOT returned, and that matters: react-query awaits what onError
    // returns before it marks the mutation failed, so the list fetched here
    // would still find it "pending" and replay the failed words on top --
    // the editor would then reopen believing the server had them.
    onError: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.dayNotes });
    },
  });
}

export function useDeleteDayNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: DELETE_KEY,
    mutationFn: async (date: string) => {
      try {
        await api.delete(`/day-notes/${date}`);
      } catch (err) {
        // Already gone is what was asked for: the box was emptied before the
        // first save reached the server, or another tab got there first.
        if ((err as { response?: { status?: number } }).response?.status !== 404) throw err;
      }
    },
    onMutate: async (date) => {
      await qc.cancelQueries({ queryKey: queryKeys.dayNotes });
      qc.setQueryData<DayNote[]>(queryKeys.dayNotes, (list) => removeNote(list, date));
    },
    onSettled: () => refreshNotes(qc),
  });
}

/** What the notes have taught the planner, per weekday. Managers only. */
export function useDayNoteInsights() {
  return useQuery({
    queryKey: queryKeys.dayNoteInsights,
    queryFn: async () => {
      const { data } = await api.get<InsightSummary>('/day-notes/insights');
      return data;
    },
    // A server without the endpoint yet answers 404; one try is enough to
    // know, and the section simply stays away.
    retry: false,
  });
}

export function useDayNoteReaders() {
  return useQuery({
    queryKey: queryKeys.dayNoteReaders,
    queryFn: async () => {
      const { data } = await api.get<DayNoteReaders>('/day-notes/readers');
      return data;
    },
  });
}

export function useSetDayNoteReaders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (emails: string[]) => {
      const { data } = await api.put<DayNoteReaders>('/day-notes/readers', { emails });
      return data;
    },
    onSuccess: (data) => qc.setQueryData(queryKeys.dayNoteReaders, data),
  });
}

/** What a reader sees. `can_read` false = not on the list; show nothing. */
export function useDayNoteFeed() {
  return useQuery({
    queryKey: queryKeys.dayNoteFeed,
    queryFn: async () => {
      const { data } = await api.get<{ can_read: boolean; notes: DayNote[] }>(
        '/day-notes/feed',
      );
      return data;
    },
  });
}
