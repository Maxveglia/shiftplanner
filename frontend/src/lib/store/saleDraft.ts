// The sale being typed, kept in the browser until it is saved.
//
// On a phone the browser kills a tab it is not showing: the manager types
// half a day's tickets, answers a call, and comes back to a page loaded from
// scratch. So every change to the form is written here at once, and the form
// reads it back when it opens -- and a dialog closed by a stray tap on the
// backdrop loses nothing either.
//
// One draft per workspace AND person, in localStorage, which can refuse
// (private browsing, storage full). A refusal is swallowed: the form carries
// on in memory, as the inventory's scanning draft does (receiveDraft.ts, the
// model for this one).
//
// The draft keeps the sale's `clientRef`, the id the server recognises a
// retried save by: a tab killed with the save in flight comes back holding
// the same ref, and saving again returns the sale already saved instead of
// recording it twice.
//
// Free of React and of the DOM (the storage is passed in), so what goes wrong
// can be tested: a draft of another version, a half-written one.

import type { DraftScope } from '../inventory/receiveDraft';
import { hasContent, type SaleDraft, type SaleLineDraft } from './sale';

export const SALE_DRAFT_VERSION = 1;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function saleDraftKey(scope: DraftScope): string {
  return `shiftplanner.store.saleDraft.${scope.orgId}.${scope.userId}`;
}

interface Envelope {
  version: number;
  savedAt: string;
  draft: SaleDraft;
}

function isLine(value: unknown): value is SaleLineDraft {
  const l = value as SaleLineDraft;
  return (
    l !== null &&
    typeof l === 'object' &&
    typeof l.key === 'string' &&
    (l.dishId === null || typeof l.dishId === 'string') &&
    typeof l.name === 'string' &&
    typeof l.price === 'string' &&
    typeof l.quantity === 'string'
  );
}

function isDraft(value: unknown): value is SaleDraft {
  const d = value as SaleDraft;
  return (
    d !== null &&
    typeof d === 'object' &&
    typeof d.soldOn === 'string' &&
    typeof d.note === 'string' &&
    typeof d.clientRef === 'string' &&
    d.clientRef !== '' &&
    Array.isArray(d.lines) &&
    d.lines.every(isLine)
  );
}

/** The stored draft, or null: none, another version's, or one that does not read. */
export function readSaleDraft(storage: Store | null, scope: DraftScope): { draft: SaleDraft; savedAt: string } | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(saleDraftKey(scope));
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope;
    if (!env || env.version !== SALE_DRAFT_VERSION || !isDraft(env.draft) || !hasContent(env.draft)) return null;
    return { draft: env.draft, savedAt: typeof env.savedAt === 'string' ? env.savedAt : '' };
  } catch {
    return null;
  }
}

/** Write the draft, or remove it when there is nothing left in it. */
export function saveSaleDraft(
  storage: Store | null,
  scope: DraftScope,
  draft: SaleDraft,
  now: Date = new Date(),
): 'saved' | 'cleared' | 'failed' {
  if (!storage) return 'failed';
  try {
    if (!hasContent(draft)) {
      storage.removeItem(saleDraftKey(scope));
      return 'cleared';
    }
    const env: Envelope = { version: SALE_DRAFT_VERSION, savedAt: now.toISOString(), draft };
    storage.setItem(saleDraftKey(scope), JSON.stringify(env));
    return 'saved';
  } catch {
    return 'failed';
  }
}

/**
 * Forget the draft -- but only the one this ref belongs to, when a ref is
 * given. A save answered after the manager has already started the next sale
 * (a slow network, a second tab) must not throw that new one away.
 */
export function clearSaleDraft(storage: Store | null, scope: DraftScope, clientRef?: string): void {
  if (!storage) return;
  try {
    if (clientRef !== undefined) {
      const stored = readSaleDraft(storage, scope);
      if (stored && stored.draft.clientRef !== clientRef) return;
    }
    storage.removeItem(saleDraftKey(scope));
  } catch {
    /* nothing to be done */
  }
}
