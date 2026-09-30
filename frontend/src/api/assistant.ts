// The business assistant: a chat about this business that remembers it.
//
// It runs on Anthropic's Managed Agents, one memory per business. The server
// replaces every name with a pseudonym before anything leaves it and puts the
// names back in the answer, so what arrives here is already readable -- this
// client never sees, and never has to handle, an alias. See backend
// services/assistant.py.
//
// It may not exist: the server has a switch and needs two ids. `useAssistantStatus`
// is asked first, and nothing here is shown until it says yes.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from './keys';

export interface AssistantConversation {
  id: string;
  created_at: string;
}

export interface AssistantReply {
  reply: string;
  /** "end_turn" normally; "budget_reached"/"terminated" end the conversation. */
  stop: string;
  /** False when this conversation can take no more questions. */
  conversation_open: boolean;
}

export interface AssistantMemoryLine {
  id: string;
  text: string;
}

/**
 * How long one answer may take before the browser gives up. Longer than the
 * server's own deadline (90 s), so it is the server that says "too slow" --
 * with a code and a sentence -- and not a bare network timeout.
 */
const ANSWER_TIMEOUT_MS = 120_000;

export function useAssistantStatus(enabled = true) {
  return useQuery({
    queryKey: queryKeys.assistantStatus,
    enabled,
    queryFn: async () => {
      const { data } = await api.get<{ enabled: boolean }>('/assistant/status');
      return data;
    },
    staleTime: 5 * 60_000,
    // A server without the assistant answers `enabled: false`; an error
    // (an older server with no such route) means the same thing here.
    retry: false,
  });
}

export async function startConversation(): Promise<AssistantConversation> {
  const { data } = await api.post<AssistantConversation>('/assistant/conversations');
  return data;
}

export async function askAssistant(
  conversationId: string,
  text: string,
  language: string,
): Promise<AssistantReply> {
  let tz: string | undefined;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    tz = undefined;
  }
  const { data } = await api.post<AssistantReply>(
    `/assistant/conversations/${encodeURIComponent(conversationId)}/messages`,
    { text, tz, language },
    { timeout: ANSWER_TIMEOUT_MS },
  );
  return data;
}

export function useAssistantMemories(enabled = true) {
  return useQuery({
    queryKey: queryKeys.assistantMemories,
    enabled,
    queryFn: async () => {
      const { data } = await api.get<{ lines: AssistantMemoryLine[] }>('/assistant/memories');
      return data.lines;
    },
  });
}

/** Forget one line, or everything with `id: null`. */
export function useForgetAssistantMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string | null) => {
      const { data } = await api.delete<{ lines: AssistantMemoryLine[] }>(
        id === null ? '/assistant/memories' : `/assistant/memories/${encodeURIComponent(id)}`,
      );
      return data.lines;
    },
    onSuccess: (lines) => qc.setQueryData(queryKeys.assistantMemories, lines),
  });
}
