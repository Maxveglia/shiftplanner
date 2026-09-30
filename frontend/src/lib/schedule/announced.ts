// What is new to THIS reader since the last time they looked.
//
// The server already knows when every published shift was announced, and keeps
// that date through a republish that did not change the shift (see
// `_replace_window`). So "has this person seen this shift before?" is a
// comparison between that date and the last time this person opened the app --
// no new endpoint, no new column, no notification needed for the app itself to
// stop hiding a change.
//
// WHY A SINGLE WATERMARK and not a list of shifts seen. A set of ids is exact
// and grows forever on a device that is never cleared; a single "latest
// announcement I have looked at" is one short string and is wrong in only one
// direction. It can MISS a badge -- open October, whose rota was published
// this morning, and a November shift published the same morning counts as
// seen -- and it can never invent one. A badge that fails to appear costs a
// glance; a badge that appears on a shift nobody touched teaches the reader to
// ignore badges, which is worse and permanent.
//
// WHY NOTHING IS BADGED ON A FIRST VISIT. With no watermark stored, every
// shift is technically new. Marking all of them would make the first screen a
// wall of badges that says nothing about anything, so the first visit only
// records where the reader starts.
//
// Storage is per employee on purpose: a phone passed between two people at the
// bar must not show one of them the other's watermark.

import type { Assignment } from './types';

const PREFIX = 'sp.seen.';

/**
 * The little of `Storage` this module uses, so the rule below can be tested.
 *
 * The test runner here is deliberately DOM-free (see `vitest.config.ts`), and
 * the one rule worth proving -- a watermark never moves backward -- is about
 * this module's logic and not about the browser's storage. So the store is a
 * parameter with a browser default rather than a global reached for directly.
 */
type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

function browserStore(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    // No `window` at all, a private window, blocked site data, a thumbnail
    // capture. Every caller below treats null as "first visit".
    return null;
  }
}

/** The most recent announcement among these shifts, or null if none is published. */
export function latestAnnouncement(assignments: Assignment[]): string | null {
  let latest: string | null = null;
  for (const a of assignments) {
    if (!a.publishedAt) continue;
    if (latest === null || a.publishedAt > latest) latest = a.publishedAt;
  }
  return latest;
}

/**
 * The ids of shifts announced after ``lastSeen``.
 *
 * ``lastSeen`` of null means this reader has no watermark yet, which is a
 * first visit: nothing is new, because nothing is old either.
 *
 * ISO-8601 instants from the same server compare correctly as strings: they
 * are fixed-width, zero-padded and all in UTC, which is the one case where
 * lexicographic order and chronological order are the same thing.
 */
export function newSince(
  assignments: Assignment[],
  lastSeen: string | null,
): Set<string> {
  if (lastSeen === null) return new Set();
  const out = new Set<string>();
  for (const a of assignments) {
    if (a.publishedAt && a.publishedAt > lastSeen) out.add(a.id);
  }
  return out;
}

/** This reader's watermark, or null when there is none or storage is unavailable. */
export function readLastSeen(
  employeeId: string,
  store: KeyValueStore | null = browserStore(),
): string | null {
  if (store === null) return null;
  try {
    return store.getItem(PREFIX + employeeId);
  } catch {
    // Behaving as a first visit is the right answer here: no badges rather
    // than wrong ones.
    return null;
  }
}

/**
 * Move this reader's watermark forward. Never backward.
 *
 * Backward is the case that matters: somebody browses to November, sees what
 * changed there, then steps back to October. October's latest announcement is
 * older, and storing it would re-badge November's changes on the next visit --
 * a badge on a shift the reader has already read, which is the one failure
 * this module is built to avoid.
 */
export function rememberSeen(
  employeeId: string,
  announcement: string | null,
  store: KeyValueStore | null = browserStore(),
): void {
  if (announcement === null || store === null) return;
  try {
    const current = store.getItem(PREFIX + employeeId);
    if (current !== null && current >= announcement) return;
    store.setItem(PREFIX + employeeId, announcement);
  } catch {
    // Storage is a convenience here; the screen is correct without it.
  }
}
