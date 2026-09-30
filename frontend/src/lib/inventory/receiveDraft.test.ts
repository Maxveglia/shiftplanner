import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '../../api/inventory';
import {
  clearReceiveDraft,
  newClientRef,
  readReceiveDraft,
  receiveDraftKey,
  RECEIVE_DRAFT_VERSION,
  saveReceiveDraft,
} from './receiveDraft';
import { buildCodeIndex, emptySession, remove, scan, undo, type ReceiveSession } from './receiveSession';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

/** A storage that throws on every call, like Safari's private mode used to. */
const refusing = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

function product(id: string, key: string, units = 1): InventoryItem {
  return {
    id,
    name: id,
    unit: null,
    category: null,
    min_quantity: null,
    archived_at: null,
    last_quantity: null,
    last_counted_at: null,
    previous_quantity: null,
    previous_counted_at: null,
    barcodes: [{ id: `b-${id}`, code: key, key, units_per_scan: units, label: null }],
    received_since_count: 0,
    received_between_counts: null,
    last_received_at: null,
    sold_since_count: 0,
    sold_between_counts: null,
  };
}

const INDEX = buildCodeIndex([product('cola', 'COLA', 24), product('water', 'WATER', 6)]);
const all = () => true;
const ME = { orgId: 'org-1', userId: 'user-1' };
const OTHER_ORG = { orgId: 'org-2', userId: 'user-1' };
const NOBODY = { orgId: 'org-3', userId: 'user-1' };
const COLLEAGUE = { orgId: 'org-1', userId: 'user-2' };
const NOW = new Date('2026-09-24T09:30:00Z');

function truck(): ReceiveSession {
  let s = emptySession();
  for (let i = 0; i < 40; i++) s = scan(s, INDEX, i % 3 === 0 ? 'WATER' : 'COLA');
  return scan(s, INDEX, 'MYSTERY', 2);
}

describe('saveReceiveDraft / readReceiveDraft', () => {
  it('brings forty scans back after the tab is killed', () => {
    const storage = memoryStorage();
    const s = truck();
    expect(saveReceiveDraft(storage, ME, s, NOW)).toBe('saved');
    const back = readReceiveDraft(storage, ME, all)!;
    expect(back.savedAt).toBe(NOW.toISOString());
    expect(back.dropped).toBe(0);
    expect(back.session.lines).toEqual(s.lines);
    expect(back.session.scans).toEqual(s.scans);
    expect(back.session.pending).toEqual(s.pending);
    expect(back.session.seq).toBe(s.seq);
    // A restored page does not replay the last beep.
    expect(back.session.last).toBeNull();
  });

  it('keeps undo working across the restore', () => {
    const storage = memoryStorage();
    let s = scan(emptySession(), INDEX, 'COLA');
    s = scan(s, INDEX, 'WATER');
    saveReceiveDraft(storage, ME, s, NOW);
    const back = undo(readReceiveDraft(storage, ME, all)!.session);
    expect(back.lines.map((l) => l.itemId)).toEqual(['cola']);
  });

  it('keeps one draft per workspace and person', () => {
    const storage = memoryStorage();
    saveReceiveDraft(storage, ME, scan(emptySession(), INDEX, 'COLA'), NOW);
    saveReceiveDraft(storage, OTHER_ORG, scan(emptySession(), INDEX, 'WATER'), NOW);
    expect(storage.data.has(receiveDraftKey(ME))).toBe(true);
    expect(receiveDraftKey(ME)).toBe('shiftplanner.inventory.receiveDraft.org-1.user-1');
    expect(readReceiveDraft(storage, OTHER_ORG, all)!.session.lines[0].itemId).toBe('water');
    expect(readReceiveDraft(storage, NOBODY, all)).toBeNull();
    // A colleague on the same tablet does not pick up mine.
    expect(readReceiveDraft(storage, COLLEAGUE, all)).toBeNull();
  });

  it('keeps the save ref, so a retry after a killed tab is the same save', () => {
    const storage = memoryStorage();
    const s = { ...scan(emptySession(), INDEX, 'COLA'), clientRef: '3f2b8c4e-1d2a-4b5c-9e6f-7a8b9c0d1e2f' };
    saveReceiveDraft(storage, ME, s, NOW);
    expect(readReceiveDraft(storage, ME, all)!.session.clientRef).toBe(s.clientRef);
    saveReceiveDraft(storage, ME, scan(emptySession(), INDEX, 'COLA'), NOW);
    expect(readReceiveDraft(storage, ME, all)!.session.clientRef).toBeNull();
  });

  it('removes the draft once nothing is left in the session', () => {
    const storage = memoryStorage();
    const s = scan(emptySession(), INDEX, 'COLA');
    saveReceiveDraft(storage, ME, s, NOW);
    expect(saveReceiveDraft(storage, ME, remove(s, 'cola'), NOW)).toBe('cleared');
    expect(storage.data.size).toBe(0);
  });

  it('drops the lines of products that no longer exist, and says how many', () => {
    const storage = memoryStorage();
    let s = scan(emptySession(), INDEX, 'COLA');
    s = scan(s, INDEX, 'WATER');
    saveReceiveDraft(storage, ME, s, NOW);
    const back = readReceiveDraft(storage, ME, (id) => id === 'water')!;
    expect(back.session.lines.map((l) => l.itemId)).toEqual(['water']);
    expect(back.session.scans.every((r) => r.itemId === 'water')).toBe(true);
    expect(back.dropped).toBe(1);
  });

  it('restores nothing when every product of it is gone', () => {
    const storage = memoryStorage();
    saveReceiveDraft(storage, ME, scan(emptySession(), INDEX, 'COLA'), NOW);
    expect(readReceiveDraft(storage, ME, () => false)).toBeNull();
  });

  it('still restores the codes waiting, with no product to drop', () => {
    const storage = memoryStorage();
    saveReceiveDraft(storage, ME, scan(emptySession(), INDEX, 'MYSTERY', 3), NOW);
    const back = readReceiveDraft(storage, ME, () => false)!;
    expect(back.session.pending).toEqual([
      { code: 'MYSTERY', key: 'MYSTERY', scans: 1, times: 3, archivedItemId: null },
    ]);
  });

  it('throws away drafts of another version, half-written or not JSON', () => {
    const storage = memoryStorage();
    const key = receiveDraftKey(ME);
    storage.setItem(key, '{"version":1,"lines":[');
    expect(readReceiveDraft(storage, ME, all)).toBeNull();
    storage.setItem(key, JSON.stringify({ version: RECEIVE_DRAFT_VERSION + 1, savedAt: 'x', lines: [] }));
    expect(readReceiveDraft(storage, ME, all)).toBeNull();
    storage.setItem(key, 'null');
    expect(readReceiveDraft(storage, ME, all)).toBeNull();
  });

  it('skips malformed entries and keeps the good ones', () => {
    const storage = memoryStorage();
    storage.setItem(
      receiveDraftKey(ME),
      JSON.stringify({
        version: RECEIVE_DRAFT_VERSION,
        savedAt: NOW.toISOString(),
        lines: [
          { itemId: 'cola', quantity: 24, touched: 3 },
          { itemId: 'water', quantity: 'six', touched: 2 },
          { itemId: '', quantity: 1, touched: 1 },
          { itemId: 'ice', quantity: 0, touched: 4 },
          null,
        ],
        scans: [{ seq: 3, itemId: 'cola', quantity: 24, prevTouched: null }, { seq: 'x' }],
        pending: [
          { code: 'A', key: 'A', scans: 0, times: 1, archivedItemId: null },
          { code: 'B', key: 'B', scans: 1, archivedItemId: null }, // a version-1 entry
        ],
        seq: 1,
      }),
    );
    const back = readReceiveDraft(storage, ME, all)!;
    expect(back.session.lines).toEqual([{ itemId: 'cola', quantity: 24, touched: 3 }]);
    expect(back.session.scans).toHaveLength(1);
    expect(back.session.pending).toEqual([]);
    // The counter carries on past what was stored, whatever `seq` said.
    expect(back.session.seq).toBe(3);
    expect(scan(back.session, INDEX, 'WATER').lines[0].itemId).toBe('water');
  });

  it('never throws where storage is refused or missing', () => {
    const s = scan(emptySession(), INDEX, 'COLA');
    expect(saveReceiveDraft(refusing, ME, s, NOW)).toBe('failed');
    expect(saveReceiveDraft(null, ME, s, NOW)).toBe('failed');
    expect(readReceiveDraft(refusing, ME, all)).toBeNull();
    expect(readReceiveDraft(null, ME, all)).toBeNull();
    expect(() => clearReceiveDraft(refusing, ME)).not.toThrow();
    expect(() => clearReceiveDraft(null, ME)).not.toThrow();
  });

  it('clears on demand', () => {
    const storage = memoryStorage();
    saveReceiveDraft(storage, ME, scan(emptySession(), INDEX, 'COLA'), NOW);
    clearReceiveDraft(storage, ME);
    expect(readReceiveDraft(storage, ME, all)).toBeNull();
  });
});

describe('newClientRef', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('uses the browser\'s randomUUID where there is one', () => {
    expect(newClientRef({ randomUUID: () => '11111111-2222-4333-8444-555555555555' })).toBe(
      '11111111-2222-4333-8444-555555555555',
    );
  });

  it('builds a v4 UUID from random bytes without randomUUID (plain http)', () => {
    const ref = newClientRef({
      getRandomValues: <T extends ArrayBufferView | null>(a: T) => {
        (a as unknown as Uint8Array).fill(0xff);
        return a;
      },
    });
    expect(ref).toMatch(UUID);
    expect(ref).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('still makes one with no crypto at all, and never the same twice', () => {
    const a = newClientRef(undefined);
    const b = newClientRef({});
    expect(a).toMatch(UUID);
    expect(b).toMatch(UUID);
    expect(a).not.toBe(b);
    expect(newClientRef()).toMatch(UUID);
  });
});
