// The delivery being received, kept in the browser while it is being scanned.
//
// On a phone the browser kills a tab it is not showing -- lock the screen to
// carry a crate in, come back, and the page loads from scratch. Forty scans
// held only in memory would be gone, so every change to the session is
// written here at once and the page reads it back when it opens.
//
// One draft per workspace AND person (a manager of two businesses on one
// phone gets two, and two managers sharing a tablet do not pick up each
// other's), in localStorage, which can refuse: private browsing, storage
// full, a browser that blocks it. A refusal is not something the manager can
// act on mid-delivery, so it is swallowed and the session carries on in
// memory.
//
// The draft also keeps the session's `clientRef`, the id the server
// recognises a retried save by: a tab killed with the save in flight comes
// back holding the same ref, and saving again does not add the stock twice.
//
// Kept free of React and of the DOM (the storage is passed in) so what goes
// wrong can be tested: a draft of another version, a half-written one, and
// lines of products deleted since.

import {
  emptySession,
  hasContent,
  withoutMissing,
  type PendingCode,
  type ReceiveLine,
  type ReceiveSession,
  type ScanRecord,
} from './receiveSession';

/**
 * Bumped when the shape stored changes in a way an old copy cannot be read
 * as. A mismatch throws the stored draft away rather than feeding the page
 * something it was not written for.
 */
export const RECEIVE_DRAFT_VERSION = 2;

/** Whose draft: one per person and workspace. */
export type DraftScope = { orgId: string; userId: string };

/** Where one person's draft in one workspace is kept. */
export function receiveDraftKey(scope: DraftScope): string {
  return `shiftplanner.inventory.receiveDraft.${scope.orgId}.${scope.userId}`;
}

/**
 * A new id for a session's save, as the server wants it (a UUID). Where the
 * browser has no `randomUUID` -- it only exists on https, and a phone on the
 * shop's wifi may reach a dev server over plain http -- one is built from
 * random bytes, and from Math.random as the last resort.
 */
export function newClientRef(
  cryptoApi: Partial<Pick<Crypto, 'randomUUID' | 'getRandomValues'>> | undefined = globalThis.crypto,
): string {
  try {
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  } catch {
    /* fall through */
  }
  const bytes = new Uint8Array(16);
  try {
    if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
    else throw new Error('no crypto');
  } catch {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// What is kept: what was scanned and what is waiting. Not what the session
// learned (the server has it by now) nor the last event (a restored page
// does not beep or flash for a scan made an hour ago).
interface Envelope {
  version: number;
  savedAt: string;
  lines: ReceiveLine[];
  scans: ScanRecord[];
  pending: PendingCode[];
  seq: number;
  clientRef: string | null;
}

export interface RestoredDraft {
  session: ReceiveSession;
  /** When it was last written. */
  savedAt: string;
  /** Lines left out because their product no longer exists. */
  dropped: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The browser's localStorage, or null where even reaching it throws. */
export function browserStorage(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Write the session, or remove the draft when there is nothing left in it
 * (so an entry saved or emptied does not come back next time).
 */
export function saveReceiveDraft(
  storage: Store | null,
  scope: DraftScope,
  session: ReceiveSession,
  now: Date = new Date(),
): 'saved' | 'cleared' | 'failed' {
  if (!storage) return 'failed';
  try {
    if (!hasContent(session)) {
      storage.removeItem(receiveDraftKey(scope));
      return 'cleared';
    }
    const env: Envelope = {
      version: RECEIVE_DRAFT_VERSION,
      savedAt: now.toISOString(),
      lines: session.lines,
      scans: session.scans,
      pending: session.pending,
      seq: session.seq,
      clientRef: session.clientRef,
    };
    storage.setItem(receiveDraftKey(scope), JSON.stringify(env));
    return 'saved';
  } catch {
    return 'failed';
  }
}

export function clearReceiveDraft(storage: Store | null, scope: DraftScope): void {
  try {
    storage?.removeItem(receiveDraftKey(scope));
  } catch {
    /* nothing to do: it will be overwritten or cleared next time */
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v !== '';

function readLine(v: unknown): ReceiveLine | null {
  const o = v as Partial<ReceiveLine> | null;
  return o && isStr(o.itemId) && isNum(o.quantity) && o.quantity > 0 && isNum(o.touched)
    ? { itemId: o.itemId, quantity: o.quantity, touched: o.touched }
    : null;
}

function readScan(v: unknown): ScanRecord | null {
  const o = v as Partial<ScanRecord> | null;
  return o &&
    isNum(o.seq) &&
    isStr(o.itemId) &&
    isNum(o.quantity) &&
    (o.prevTouched === null || isNum(o.prevTouched))
    ? { seq: o.seq, itemId: o.itemId, quantity: o.quantity, prevTouched: o.prevTouched }
    : null;
}

function readPending(v: unknown): PendingCode | null {
  const o = v as Partial<PendingCode> | null;
  return o &&
    isStr(o.code) &&
    isStr(o.key) &&
    isNum(o.scans) &&
    o.scans > 0 &&
    isNum(o.times) &&
    o.times > 0 &&
    (o.archivedItemId === null || isStr(o.archivedItemId))
    ? { code: o.code, key: o.key, scans: o.scans, times: o.times, archivedItemId: o.archivedItemId }
    : null;
}

function readList<T>(v: unknown, read: (x: unknown) => T | null): T[] {
  return Array.isArray(v) ? v.map(read).filter((x): x is T => x !== null) : [];
}

/**
 * The draft of this workspace, if there is one worth restoring, without the
 * lines of products that no longer exist (`exists` answers by id).
 */
export function readReceiveDraft(
  storage: Store | null,
  scope: DraftScope,
  exists: (itemId: string) => boolean,
): RestoredDraft | null {
  let text: string | null = null;
  try {
    text = storage?.getItem(receiveDraftKey(scope)) ?? null;
  } catch {
    return null;
  }
  if (!text) return null;
  let env: Partial<Envelope>;
  try {
    env = JSON.parse(text) as Partial<Envelope>;
  } catch {
    return null;
  }
  if (!env || env.version !== RECEIVE_DRAFT_VERSION || !isStr(env.savedAt)) return null;

  const lines = readList(env.lines, readLine);
  const scans = readList(env.scans, readScan);
  const pending = readList(env.pending, readPending);
  // The counter carries on past everything stored, so a new scan never sorts
  // under an old one.
  const seq = Math.max(
    isNum(env.seq) ? env.seq : 0,
    ...lines.map((l) => l.touched),
    ...scans.map((r) => r.seq),
  );
  const stored: ReceiveSession = {
    ...emptySession(),
    lines: [...lines].sort((a, b) => b.touched - a.touched),
    scans: [...scans].sort((a, b) => a.seq - b.seq),
    pending,
    seq,
    clientRef: isStr(env.clientRef) ? env.clientRef : null,
  };
  const session = withoutMissing(stored, exists);
  if (!hasContent(session)) return null;
  return { session, savedAt: env.savedAt, dropped: stored.lines.length - session.lines.length };
}
