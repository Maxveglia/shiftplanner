// A delivery being received: what has been scanned so far, before it is saved
// as an entry.
//
// Every function here takes a session and returns the next one, never
// touching the old; the page keeps the current one and draws it. Nothing in
// here knows about React, the network or the clock, so a truck's worth of
// scans can be played through it in a test.
//
// The rules the manager relies on while their hands are full of boxes:
//
// - A scan is looked up by its KEY (barcodeKey), in an index built from the
//   keys the server sent, and adds `units_per_scan x multiplier` of that
//   product: a case's code adds 24 cans, the multiplier says there were five
//   such cases.
// - A code nobody knows is not dropped. It waits ("pending"), with every scan
//   of it counted, and when the manager says what it is those scans are
//   added then, with the multiplier each had. Known codes keep adding while
//   it waits.
// - A code of an ARCHIVED product also waits: the manager decides whether to
//   bring the product back first.
// - Undo takes back the last SCAN, wherever its line now sits -- not the top
//   line, which after a few scans of other things is somebody else.
// - A quantity typed over a line is the truth for that line: the scans before
//   it can no longer be undone one by one (they are in the number typed).
// - Lines are in the order they were last scanned, the newest on top, where
//   a phone's screen shows it.
// - A session has one `clientRef`, given to it the first time it is saved and
//   sent with the POST: a save whose answer never came back (no signal by the
//   truck, a tab killed) is retried with the same ref, and the server hands
//   back the entry it already has instead of adding the stock twice. What the
//   entry the server returns does not cover stays, as a new session.

import type { InventoryItem } from '../../api/inventory';
import { barcodeKey, cleanCode } from './barcodeKey';

/** What one code means. */
export interface CodeEntry {
  itemId: string;
  unitsPerScan: number;
  label: string | null;
  archived: boolean;
}

export type CodeIndex = ReadonlyMap<string, CodeEntry>;

export interface ReceiveLine {
  itemId: string;
  /** In the product's own unit. */
  quantity: number;
  /** When it was last scanned or touched, on the session's own counter. */
  touched: number;
}

/** One scan that added to a line, kept so it can be taken back. */
export interface ScanRecord {
  seq: number;
  itemId: string;
  quantity: number;
  /** The line's `touched` before this scan; null when this scan created the line. */
  prevTouched: number | null;
}

/** A code scanned that does not add to anything yet. */
export interface PendingCode {
  /** As it was read, cleaned (shown back to the manager). */
  code: string;
  key: string;
  /** How many times it was scanned: what the manager is told. */
  scans: number;
  /** Those scans with their multipliers: 3 scans at x2 is 6. What is added. */
  times: number;
  /** When the code is known but its product is archived; null when unknown. */
  archivedItemId: string | null;
}

/** What the last thing done was, for the sound, the highlight and the announcement. */
export type ReceiveEvent =
  | {
      kind: 'added';
      seq: number;
      itemId: string;
      quantity: number;
      unitsPerScan: number;
      multiplier: number;
      label: string | null;
    }
  | { kind: 'unknown'; seq: number; code: string }
  | { kind: 'archived'; seq: number; code: string; itemId: string }
  | { kind: 'undone'; seq: number; itemId: string; quantity: number }
  | { kind: 'manual'; seq: number; itemId: string }
  | { kind: 'removed'; seq: number; itemId: string };

export interface ReceiveSession {
  /** Newest scan first. */
  lines: ReceiveLine[];
  /** Oldest first; undo takes the last. */
  scans: ScanRecord[];
  /** Oldest first; the page asks about the first. */
  pending: PendingCode[];
  /**
   * Codes the manager resolved in this session. The server has them too, but
   * the product list takes a moment to come back with them, and a second
   * scan of the same box in that moment must not ask again.
   */
  learned: Record<string, CodeEntry>;
  /** Archived products brought back in this session, for the same reason. */
  revived: string[];
  /** The last line taken off, so a slip of the thumb can be put back. */
  removed: { line: ReceiveLine; scans: ScanRecord[] } | null;
  seq: number;
  last: ReceiveEvent | null;
  /** Sent with the POST (see the header); null until the first attempt to save. */
  clientRef: string | null;
}

export function emptySession(): ReceiveSession {
  return {
    lines: [],
    scans: [],
    pending: [],
    learned: {},
    revived: [],
    removed: null,
    seq: 0,
    last: null,
    clientRef: null,
  };
}

/** Code key -> what it means, from the keys the server computed for every barcode. */
export function buildCodeIndex(items: readonly InventoryItem[]): Map<string, CodeEntry> {
  const index = new Map<string, CodeEntry>();
  for (const item of items) {
    for (const b of item.barcodes ?? []) {
      index.set(b.key, {
        itemId: item.id,
        unitsPerScan: b.units_per_scan,
        label: b.label,
        archived: item.archived_at !== null,
      });
    }
  }
  return index;
}

// numeric(12,3) on the server; floats added here would print 0.1 + 0.2.
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sortLines(lines: ReceiveLine[]): ReceiveLine[] {
  return [...lines].sort((a, b) => b.touched - a.touched);
}

function validMultiplier(multiplier: number): number {
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

/** Add `quantity` of a product as one scan. */
function addScan(s: ReceiveSession, itemId: string, quantity: number): ReceiveSession {
  const seq = s.seq + 1;
  const existing = s.lines.find((l) => l.itemId === itemId);
  const lines = existing
    ? s.lines.map((l) =>
        l.itemId === itemId ? { ...l, quantity: round3(l.quantity + quantity), touched: seq } : l,
      )
    : [...s.lines, { itemId, quantity: round3(quantity), touched: seq }];
  return {
    ...s,
    seq,
    lines: sortLines(lines),
    scans: [...s.scans, { seq, itemId, quantity, prevTouched: existing ? existing.touched : null }],
  };
}

/**
 * One scan of `code`, worth `multiplier` of whatever the code is worth.
 * Returns the same session, untouched, when there is no code in it.
 */
export function scan(
  s: ReceiveSession,
  index: CodeIndex,
  code: string,
  multiplier = 1,
): ReceiveSession {
  const key = barcodeKey(code);
  if (key === null) return s;
  const times = validMultiplier(multiplier);
  const entry = s.learned[key] ?? index.get(key);
  const archived = entry !== undefined && entry.archived && !s.revived.includes(entry.itemId);

  if (entry === undefined || archived) {
    const seq = s.seq + 1;
    const shown = cleanCode(code);
    const waiting = s.pending.find((p) => p.key === key);
    const pending = waiting
      ? s.pending.map((p) =>
          p.key === key ? { ...p, scans: p.scans + 1, times: p.times + times } : p,
        )
      : [
          ...s.pending,
          { code: shown, key, scans: 1, times, archivedItemId: archived ? entry!.itemId : null },
        ];
    return {
      ...s,
      seq,
      pending,
      last: archived
        ? { kind: 'archived', seq, code: shown, itemId: entry!.itemId }
        : { kind: 'unknown', seq, code: shown },
    };
  }

  const quantity = round3(entry.unitsPerScan * times);
  const next = addScan(s, entry.itemId, quantity);
  return {
    ...next,
    last: {
      kind: 'added',
      seq: next.seq,
      itemId: entry.itemId,
      quantity,
      unitsPerScan: entry.unitsPerScan,
      multiplier: times,
      label: entry.label,
    },
  };
}

/**
 * The manager said what a waiting code is -- one of their products, a new
 * one, or the archived one brought back. Its scans are added now, and the
 * code is remembered for the rest of the session.
 */
export function resolvePending(
  s: ReceiveSession,
  key: string,
  meaning: { itemId: string; unitsPerScan: number; label?: string | null },
): ReceiveSession {
  const waiting = s.pending.find((p) => p.key === key);
  if (!waiting) return s;
  const entry: CodeEntry = {
    itemId: meaning.itemId,
    unitsPerScan: meaning.unitsPerScan,
    label: meaning.label ?? null,
    archived: false,
  };
  const quantity = round3(meaning.unitsPerScan * waiting.times);
  const base: ReceiveSession = {
    ...s,
    pending: s.pending.filter((p) => p.key !== key),
    learned: { ...s.learned, [key]: entry },
    revived:
      waiting.archivedItemId !== null && !s.revived.includes(waiting.archivedItemId)
        ? [...s.revived, waiting.archivedItemId]
        : s.revived,
  };
  const next = addScan(base, meaning.itemId, quantity);
  return {
    ...next,
    last: {
      kind: 'added',
      seq: next.seq,
      itemId: meaning.itemId,
      quantity,
      unitsPerScan: meaning.unitsPerScan,
      multiplier: waiting.times,
      label: entry.label,
    },
  };
}

/**
 * The waiting codes the product list now knows -- the list came back with
 * a code resolved elsewhere, or added from the Stock screen, or a product
 * brought back from the archive -- resolved on their own. The same session
 * when there are none.
 */
export function resolveKnown(s: ReceiveSession, index: CodeIndex): ReceiveSession {
  let next = s;
  for (const p of s.pending) {
    const entry = s.learned[p.key] ?? index.get(p.key);
    if (!entry) continue;
    if (entry.archived && !s.revived.includes(entry.itemId)) continue;
    next = resolvePending(next, p.key, entry);
  }
  return next;
}

/**
 * What is left once an entry with these lines is saved: each product less
 * what the entry took (it may be an earlier attempt's entry, holding less
 * than the session has now), and the codes still waiting, which were never
 * in it. A new session, with no ref of its own yet.
 */
export function afterSaved(
  s: ReceiveSession,
  saved: readonly { item_id: string; quantity: number }[],
): ReceiveSession {
  const took = new Map<string, number>();
  for (const l of saved) took.set(l.item_id, (took.get(l.item_id) ?? 0) + l.quantity);
  const lines = s.lines
    .map((l) => ({ ...l, quantity: round3(l.quantity - (took.get(l.itemId) ?? 0)) }))
    .filter((l) => l.quantity > 0);
  return {
    ...s,
    lines,
    // A product the entry took part of keeps the rest as a plain number: its
    // scans are in the saved entry now, not undoable here.
    scans: s.scans.filter((r) => !took.has(r.itemId)),
    removed: null,
    last: null,
    clientRef: null,
  };
}

/** Forget a waiting code and its scans. */
export function dismissPending(s: ReceiveSession, key: string): ReceiveSession {
  if (!s.pending.some((p) => p.key === key)) return s;
  return { ...s, pending: s.pending.filter((p) => p.key !== key) };
}

/**
 * A quantity typed over a line. Only a positive number replaces it (the page
 * says what is wrong with anything else); the scans already in it stop being
 * undoable one by one.
 */
export function setQuantity(s: ReceiveSession, itemId: string, quantity: number): ReceiveSession {
  if (!Number.isFinite(quantity) || quantity <= 0) return s;
  if (!s.lines.some((l) => l.itemId === itemId)) return s;
  return {
    ...s,
    lines: s.lines.map((l) => (l.itemId === itemId ? { ...l, quantity: round3(quantity) } : l)),
    scans: s.scans.filter((r) => r.itemId !== itemId),
  };
}

/** Take a line off, with its scans; `restoreRemoved` puts it back. */
export function remove(s: ReceiveSession, itemId: string): ReceiveSession {
  const line = s.lines.find((l) => l.itemId === itemId);
  if (!line) return s;
  const seq = s.seq + 1;
  return {
    ...s,
    seq,
    lines: s.lines.filter((l) => l.itemId !== itemId),
    scans: s.scans.filter((r) => r.itemId !== itemId),
    removed: { line, scans: s.scans.filter((r) => r.itemId === itemId) },
    last: { kind: 'removed', seq, itemId },
  };
}

/** Put back the line last taken off, where it was, with its scans. */
export function restoreRemoved(s: ReceiveSession): ReceiveSession {
  if (!s.removed) return s;
  const { line, scans } = s.removed;
  if (s.lines.some((l) => l.itemId === line.itemId)) return { ...s, removed: null };
  return {
    ...s,
    removed: null,
    lines: sortLines([...s.lines, line]),
    scans: [...s.scans, ...scans].sort((a, b) => a.seq - b.seq),
    last: null,
  };
}

/**
 * A product added by hand, for what has no code: a line of 1 to type over.
 * A product already in the list just comes to the top, as it is.
 */
export function addManual(s: ReceiveSession, itemId: string): ReceiveSession {
  const seq = s.seq + 1;
  const existing = s.lines.some((l) => l.itemId === itemId);
  const lines = existing
    ? s.lines.map((l) => (l.itemId === itemId ? { ...l, touched: seq } : l))
    : [...s.lines, { itemId, quantity: 1, touched: seq }];
  return { ...s, seq, lines: sortLines(lines), last: { kind: 'manual', seq, itemId } };
}

/**
 * The scan that "Undo" would take back, only while it is the last thing that
 * happened: after anything else, an undo button would be undoing something
 * the manager is no longer looking at.
 */
export function undoable(s: ReceiveSession): ScanRecord | null {
  const record = s.scans[s.scans.length - 1];
  if (!record || s.last?.kind !== 'added' || s.last.seq !== record.seq) return null;
  return record;
}

/** Take back the last scan. The same session when there is none. */
export function undo(s: ReceiveSession): ReceiveSession {
  const record = s.scans[s.scans.length - 1];
  if (!record) return s;
  const seq = s.seq + 1;
  const line = s.lines.find((l) => l.itemId === record.itemId);
  const left = line ? round3(line.quantity - record.quantity) : 0;
  const lines =
    !line || record.prevTouched === null || left <= 0
      ? s.lines.filter((l) => l.itemId !== record.itemId)
      : s.lines.map((l) =>
          l.itemId === record.itemId ? { ...l, quantity: left, touched: record.prevTouched! } : l,
        );
  return {
    ...s,
    seq,
    lines: sortLines(lines),
    scans: s.scans.slice(0, -1),
    last: { kind: 'undone', seq, itemId: record.itemId, quantity: record.quantity },
  };
}

export function canUndo(s: ReceiveSession): boolean {
  return s.scans.length > 0;
}

/** Whether there is anything worth keeping: lines, or codes still waiting. */
export function hasContent(s: ReceiveSession): boolean {
  return s.lines.length > 0 || s.pending.length > 0;
}

/**
 * How many products, and -- only when every line is in the same unit -- how
 * much in all. Bottles plus kilos is not a number anybody can use, so a mixed
 * delivery gets no total rather than a meaningless one. A product with no
 * unit counts as "units", its own unit, like any other.
 */
export function totals(
  s: ReceiveSession,
  unitOf: (itemId: string) => string | null,
): { products: number; total: { quantity: number; unit: string | null } | null } {
  if (s.lines.length === 0) return { products: 0, total: null };
  const norm = (u: string | null) => (u ?? '').trim().toLocaleLowerCase();
  const first = unitOf(s.lines[0].itemId);
  const same = s.lines.every((l) => norm(unitOf(l.itemId)) === norm(first));
  return {
    products: s.lines.length,
    total: same
      ? { quantity: round3(s.lines.reduce((sum, l) => sum + l.quantity, 0)), unit: first?.trim() || null }
      : null,
  };
}

/**
 * The session without the products that no longer exist (a draft restored
 * after a product was deleted). A waiting code of a product that is gone
 * becomes a code nobody knows.
 */
export function withoutMissing(s: ReceiveSession, exists: (itemId: string) => boolean): ReceiveSession {
  const removed = s.removed && exists(s.removed.line.itemId) ? s.removed : null;
  return {
    ...s,
    lines: s.lines.filter((l) => exists(l.itemId)),
    scans: s.scans.filter((r) => exists(r.itemId)),
    pending: s.pending.map((p) =>
      p.archivedItemId !== null && !exists(p.archivedItemId) ? { ...p, archivedItemId: null } : p,
    ),
    learned: Object.fromEntries(Object.entries(s.learned).filter(([, e]) => exists(e.itemId))),
    revived: s.revived.filter(exists),
    removed,
    last: s.last && 'itemId' in s.last && !exists(s.last.itemId) ? null : s.last,
  };
}
