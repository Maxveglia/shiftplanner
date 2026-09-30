// The business assistant, as a panel over the dashboard.
//
// A chat that answers about this business and REMEMBERS it between
// conversations (backend services/assistant.py). It looks like the opening
// interview on purpose -- same avatar, same bubbles, same breathing dots -- so
// the product speaks with one voice. Unlike the interview it is not stateless:
// a conversation lives on the server, and closing the panel keeps it, so the
// manager can look at the calendar and come back to the same thread.
//
// What it remembers is shown underneath, line by line, each with a delete,
// and "forget everything" ends the conversation and empties the memory. That
// is the product's rule for anything learned about a business: it can be seen
// and taken away.
//
// The names in the answers are real because the server puts them back; what
// left the building carried pseudonyms. This component never sees one.
//
// It slides in from the right edge over a dimmed, softened page and slides
// back out when closed; portalled to <body> for the same reason as Modal (a
// fixed layer inside a page that animates with transforms is fixed to the
// page, not the window). Escape closes it, and focus goes into it and back.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { AssistantAvatar, ThinkingDots } from '../AssistantAvatar';
import { Button } from '../Button';
import { FIELD_SKIN, fieldTone } from '../Input';
import {
  askAssistant,
  startConversation,
  useAssistantMemories,
  useForgetAssistantMemory,
} from '../../api/assistant';
import { queryKeys } from '../../api/keys';
import { getErrorMessage } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import {
  dialogKeys,
  useBackdropClose,
  useDialogFocus,
  useInert,
  usePresence,
} from '../motion/useDialogMotion';

interface ChatLine {
  role: 'manager' | 'assistant' | 'note';
  text: string;
}

interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
}

/** How long the closed panel stays to slide out; .m-sheet-out lasts 220ms. */
const EXIT_MS = 230;

/** A conversation the server says is over, or never was ours. */
function conversationGone(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const code = (error.response?.data as { detail?: { code?: string } } | undefined)?.detail?.code;
  return code === 'conversation_closed' || code === 'conversation_not_found';
}

export function AssistantPanel({ open, onClose }: AssistantPanelProps) {
  const t = useT();
  const { language } = useLanguage();
  const qc = useQueryClient();
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversation = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const phase = usePresence(open, EXIT_MS);
  const closing = phase === 'closing';
  useDialogFocus(panel, phase === 'open');
  // Leaving, the panel is inert and no longer a modal (see Modal): its
  // buttons stop answering, and the calendar gets its keys back at once.
  useInert(root, closing);
  const close = () => {
    if (phase === 'open') onClose();
  };
  const backdropClose = useBackdropClose(close, !closing);

  const scrollToEnd = useCallback(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, []);
  // `open` too: reopened, the panel shows where the conversation got to, not
  // its first line.
  useEffect(scrollToEnd, [lines, sending, open, scrollToEnd]);

  const newConversation = () => {
    conversation.current = null;
    setLines([]);
    setError(null);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setError(null);
    setLines((ls) => [...ls, { role: 'manager', text }]);
    setSending(true);
    // One retry, and only for a conversation that is over: the manager's
    // question should not be lost because the previous thread hit its limit
    // or was ended in another tab.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (!conversation.current) {
          conversation.current = (await startConversation()).id;
        }
        const answer = await askAssistant(conversation.current, text, language);
        setLines((ls) => [
          ...ls,
          { role: 'assistant', text: answer.reply },
          ...(answer.conversation_open ? [] : [{ role: 'note' as const, text: t('assistant.ended') }]),
        ]);
        if (!answer.conversation_open) conversation.current = null;
        // It may have written something down.
        qc.invalidateQueries({ queryKey: queryKeys.assistantMemories });
        break;
      } catch (e) {
        if (attempt === 0 && conversationGone(e)) {
          conversation.current = null;
          continue;
        }
        setError(getErrorMessage(e));
        break;
      }
    }
    setSending(false);
  };

  if (phase === 'closed') return null;

  return createPortal(
    <div
      ref={root}
      aria-hidden={closing ? true : undefined}
      className={[
        'fixed inset-0 z-40 flex justify-end',
        closing ? 'pointer-events-none' : '',
      ].join(' ')}
      onKeyDown={(e) => {
        if (!closing) dialogKeys(e, panel.current, close);
      }}
    >
      <div
        aria-hidden="true"
        className={[
          'absolute inset-0 bg-[rgb(4_9_8/0.6)]',
          closing ? 'm-scrim-out' : 'm-scrim-in',
        ].join(' ')}
        {...backdropClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal={closing ? undefined : true}
        aria-label={t('assistant.title')}
        tabIndex={-1}
        className={[
          'm-glass-float relative flex h-full w-full max-w-md flex-col border-l border-white/10 focus:outline-none',
          closing ? 'm-sheet-out' : 'm-sheet-in',
        ].join(' ')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] p-4">
          <div className="flex items-center gap-2">
            <AssistantAvatar />
            <h2 className="text-base font-semibold text-gray-900">{t('assistant.title')}</h2>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={newConversation} disabled={sending}>
              {t('assistant.new')}
            </Button>
            <Button variant="ghost" size="sm" onClick={close}>
              {t('assistant.close')}
            </Button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto bg-black/[0.18] p-4">
          <Bubble role="assistant" text={t('assistant.intro')} />
          {lines.map((l, i) => (
            <Bubble key={i} role={l.role} text={l.text} />
          ))}
          {sending && (
            <div className="chat-in flex items-end gap-2" aria-label={t('assistant.thinking')}>
              <AssistantAvatar />
              <div className="flex items-center rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.05] px-4 py-3">
                <ThinkingDots />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-white/[0.06] p-4">
          {error && <p className="mb-2 text-sm text-red-300">{error}</p>}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('assistant.placeholder')}
              maxLength={4000}
              disabled={sending}
              className={`${FIELD_SKIN} ${fieldTone(false)} w-full flex-1 rounded-full py-2.5 pl-4 pr-4`}
            />
            <Button type="submit" disabled={sending || !draft.trim()}>
              {t('assistant.send')}
            </Button>
          </form>
          <p className="mt-2 text-xs text-gray-500">{t('assistant.privacy')}</p>
          <MemoryList onForgotAll={newConversation} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Bubble({ role, text }: ChatLine) {
  if (role === 'note') {
    return <p className="chat-in text-center text-xs text-gray-500">{text}</p>;
  }
  const mine = role === 'manager';
  return (
    <div className={['chat-in flex items-end gap-2', mine ? 'justify-end' : ''].join(' ')}>
      {!mine && <AssistantAvatar />}
      <div
        className={[
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          mine
            ? 'rounded-br-md bg-brand-600 text-white shadow-[0_8px_24px_-14px_rgb(68_214_180/0.7)]'
            : 'rounded-bl-md border border-white/[0.08] bg-white/[0.05] text-gray-800',
        ].join(' ')}
      >
        {text}
      </div>
    </div>
  );
}

/** "Lo que el asistente recuerda": every line, each with a delete. */
function MemoryList({ onForgotAll }: { onForgotAll: () => void }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const memories = useAssistantMemories(expanded);
  const forget = useForgetAssistantMemory();
  const lines = memories.data ?? [];

  return (
    <details
      className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3"
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer rounded text-sm font-medium text-gray-900 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300">
        {t('assistant.memory.title')}
      </summary>
      <p className="mt-1 text-xs text-gray-500">{t('assistant.memory.help')}</p>
      {memories.isLoading && <p className="mt-2 text-sm text-gray-500">{t('assistant.memory.loading')}</p>}
      {memories.isError && <p className="mt-2 text-sm text-red-300">{getErrorMessage(memories.error)}</p>}
      {!memories.isLoading && !memories.isError && lines.length === 0 && (
        <p className="mt-2 text-sm text-gray-500">{t('assistant.memory.empty')}</p>
      )}
      {lines.length > 0 && (
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {lines.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-2 text-sm text-gray-800">
              <span>{l.text}</span>
              <button
                type="button"
                className="shrink-0 rounded text-xs text-gray-500 underline hover:text-red-300 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300 disabled:opacity-50"
                onClick={() => forget.mutate(l.id)}
                disabled={forget.isPending}
                aria-label={t('assistant.memory.deleteLine', { text: l.text })}
              >
                {t('assistant.memory.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {forget.isError && <p className="mt-2 text-sm text-red-300">{getErrorMessage(forget.error)}</p>}
      <div className="mt-3">
        {confirming ? (
          <div className="rounded-xl border border-red-400/25 bg-red-50 p-3">
            <p className="text-xs text-red-900">{t('assistant.memory.forgetAllConfirm')}</p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={forget.isPending}
                onClick={() =>
                  forget.mutate(null, {
                    onSuccess: () => {
                      setConfirming(false);
                      onForgotAll();
                    },
                  })
                }
              >
                {t('assistant.memory.forgetAllYes')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                {t('assistant.memory.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="rounded text-xs text-gray-500 underline hover:text-red-300 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
            onClick={() => setConfirming(true)}
          >
            {t('assistant.memory.forgetAll')}
          </button>
        )}
      </div>
    </details>
  );
}
