// The bill at the till, kept in the browser until it is charged -- and which
// of the Menu's two modes the tab is in.
//
// The bill is written at every tap, as the sale's draft is (saleDraft.ts, the
// model for this one): a reload, a tablet that went to sleep, a phone that
// killed the tab behind the counter, and the order being rung up comes back as
// it was. One per workspace AND person, in localStorage, which can refuse
// (private browsing, storage full); a refusal is swallowed and the bill
// carries on in memory.
//
// It keeps the bill's `clientRef`: a tab killed with the charge in flight
// comes back holding the same ref, and confirming again returns the sale
// already recorded instead of recording it twice. And what the card reader
// approved for it (ticket.ts, cardApproval): confirming again does not take
// the card a second time.
//
// A bill left for more than TILL_DRAFT_MAX_AGE (12 h) is not somebody's
// order any more but last night's, forgotten: it does not come back as the
// bill on screen. It is not thrown away in silence either -- the page sets it
// aside and says so, with the way to bring it back (TillTicket.tsx).
//
// The mode (charging, or editing the menu) is the tab's, in sessionStorage:
// a second tab opened to fix a price does not turn the till into the editor.
//
// Free of React and of the DOM (the storage is passed in), so what goes wrong
// can be tested: a draft of another version, a half-written one.

import type { DraftScope } from '../inventory/receiveDraft';
import { MAX_LINES } from './sale';
import { MAX_TICKET_QUANTITY, type CardApproval, type Ticket, type TicketLine } from './ticket';

export const TILL_DRAFT_VERSION = 1;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function tillDraftKey(scope: DraftScope): string {
  return `shiftplanner.store.tillDraft.${scope.orgId}.${scope.userId}`;
}

interface Envelope {
  version: number;
  savedAt: string;
  ticket: Ticket;
}

function isLine(value: unknown): value is TicketLine {
  const l = value as TicketLine;
  return (
    l !== null &&
    typeof l === 'object' &&
    typeof l.dishId === 'string' &&
    l.dishId !== '' &&
    typeof l.name === 'string' &&
    Number.isInteger(l.priceCents) &&
    l.priceCents >= 0 &&
    Number.isInteger(l.quantity) &&
    l.quantity >= 1 &&
    l.quantity <= MAX_TICKET_QUANTITY
  );
}

function isTicket(value: unknown): value is Ticket {
  const t = value as Ticket;
  return (
    t !== null &&
    typeof t === 'object' &&
    typeof t.clientRef === 'string' &&
    t.clientRef !== '' &&
    Array.isArray(t.lines) &&
    t.lines.length <= MAX_LINES &&
    t.lines.every(isLine)
  );
}

function isApproval(value: unknown): value is CardApproval {
  const a = value as CardApproval;
  return (
    a !== null &&
    typeof a === 'object' &&
    typeof a.clientRef === 'string' &&
    a.clientRef !== '' &&
    Number.isInteger(a.amountCents) &&
    a.amountCents >= 0
  );
}

/**
 * The stored bill, or null: none, an empty one, another version's, or one that
 * does not read. Only what a bill is made of comes back: an approval that does
 * not read is dropped, not the bill with it.
 */
export function readTillDraft(storage: Store | null, scope: DraftScope): { ticket: Ticket; savedAt: string } | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(tillDraftKey(scope));
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope;
    if (!env || env.version !== TILL_DRAFT_VERSION || !isTicket(env.ticket) || env.ticket.lines.length === 0) return null;
    const { lines, clientRef, cardApproval } = env.ticket;
    const ticket: Ticket = {
      lines: lines.map(({ dishId, name, priceCents, quantity }) => ({ dishId, name, priceCents, quantity })),
      clientRef,
      ...(isApproval(cardApproval) ? { cardApproval: { clientRef: cardApproval.clientRef, amountCents: cardApproval.amountCents } } : {}),
    };
    return { ticket, savedAt: typeof env.savedAt === 'string' ? env.savedAt : '' };
  } catch {
    return null;
  }
}

/** How long a bill left alone stays the bill on screen: a service, not a night. */
export const TILL_DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Whether a bill last changed at `savedAt` is too old to come back as the
 * bill on screen. One whose time does not read is (it is set aside, and can
 * be brought back); one from the future (a clock put right) is not.
 */
export function draftExpired(savedAt: string, now: Date = new Date()): boolean {
  const at = Date.parse(savedAt);
  if (Number.isNaN(at)) return true;
  return now.getTime() - at > TILL_DRAFT_MAX_AGE_MS;
}

/** Write the bill, or remove it when there is nothing on it. */
export function saveTillDraft(
  storage: Store | null,
  scope: DraftScope,
  ticket: Ticket,
  now: Date = new Date(),
): 'saved' | 'cleared' | 'failed' {
  if (!storage) return 'failed';
  try {
    if (ticket.lines.length === 0) {
      storage.removeItem(tillDraftKey(scope));
      return 'cleared';
    }
    const env: Envelope = { version: TILL_DRAFT_VERSION, savedAt: now.toISOString(), ticket };
    storage.setItem(tillDraftKey(scope), JSON.stringify(env));
    return 'saved';
  } catch {
    return 'failed';
  }
}

/**
 * Forget the bill -- but only the one this ref belongs to, when a ref is
 * given. A charge answered after the next bill was started (a slow network,
 * a second tab) must not throw that new one away.
 */
export function clearTillDraft(storage: Store | null, scope: DraftScope, clientRef?: string): void {
  if (!storage) return;
  try {
    if (clientRef !== undefined) {
      const stored = readTillDraft(storage, scope);
      if (stored && stored.ticket.clientRef !== clientRef) return;
    }
    storage.removeItem(tillDraftKey(scope));
  } catch {
    /* nothing to be done */
  }
}

// --- The mode ---------------------------------------------------------------------

/** Charging (a tap adds to the bill) or editing the menu (a tap opens the dish). */
export type TillMode = 'charge' | 'edit';

export const TILL_MODE_KEY = 'shiftplanner.store.menuMode';

/** The browser's sessionStorage (this tab's), or null where even reaching it throws. */
export function tabStorage(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The tab's mode; charging when it has none, or one that does not read. */
export function readTillMode(storage: Pick<Storage, 'getItem'> | null): TillMode {
  try {
    return storage?.getItem(TILL_MODE_KEY) === 'edit' ? 'edit' : 'charge';
  } catch {
    return 'charge';
  }
}

export function saveTillMode(storage: Pick<Storage, 'setItem'> | null, mode: TillMode): void {
  try {
    storage?.setItem(TILL_MODE_KEY, mode);
  } catch {
    /* the mode is kept in memory only */
  }
}

// --- Which modes an account has ------------------------------------------------
//
// Charging is `store.charge` and editing the menu is `menu.edit`
// (lib/access.ts): the manager has both; an employee and a shop account (the
// till's tablet) only charge (Max, 28-sep-2026). An account with one mode
// gets no switch between modes at all -- a tab strip of one is a label that
// looks like a control -- and one with neither reads the menu and does
// nothing else.

/** The modes an account has, in the order the switch lists them. */
export function tillModes(canCharge: boolean, canEdit: boolean): TillMode[] {
  const modes: TillMode[] = [];
  if (canCharge) modes.push('charge');
  if (canEdit) modes.push('edit');
  return modes;
}

/**
 * The mode the screen opens in: the tab's (`readTillMode`), when the account
 * has it -- so an "Edit menu" left in this tab by a manager signed in before
 * is not an employee's way into it -- else the first it has, and with none,
 * null: the menu to read.
 */
export function tillModeFor(saved: TillMode, modes: readonly TillMode[]): TillMode | null {
  return modes.includes(saved) ? saved : (modes[0] ?? null);
}
