import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '../../api/inventory';
import {
  addManual,
  afterSaved,
  buildCodeIndex,
  canUndo,
  dismissPending,
  emptySession,
  hasContent,
  remove,
  resolveKnown,
  resolvePending,
  restoreRemoved,
  scan,
  setQuantity,
  totals,
  undo,
  undoable,
  withoutMissing,
  type ReceiveSession,
} from './receiveSession';

function product(id: string, over: Partial<InventoryItem> = {}): InventoryItem {
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
    barcodes: [],
    received_since_count: 0,
    received_between_counts: null,
    last_received_at: null,
    sold_since_count: 0,
    sold_between_counts: null,
    ...over,
  };
}

function code(key: string, units = 1, label: string | null = null) {
  return { id: `b-${key}`, code: key, key, units_per_scan: units, label };
}

// A can of cola sold singly (its EAN) and by the case (the case's own code).
const COLA = product('cola', {
  barcodes: [code('08410188012345'), code('18410188012342', 24, 'caja de 24')],
});
const WATER = product('water', { barcodes: [code('00036000291452', 6, 'pack de 6')] });
const OLD = product('old', { archived_at: '2026-09-01T10:00:00Z', barcodes: [code('SHELF-9')] });
const INDEX = buildCodeIndex([COLA, WATER, OLD]);

const line = (s: ReceiveSession, itemId: string) => s.lines.find((l) => l.itemId === itemId);

describe('buildCodeIndex', () => {
  it('indexes every barcode by the key the server sent', () => {
    expect(INDEX.get('18410188012342')).toEqual({
      itemId: 'cola',
      unitsPerScan: 24,
      label: 'caja de 24',
      archived: false,
    });
    expect(INDEX.get('SHELF-9')?.archived).toBe(true);
    expect(INDEX.size).toBe(4);
  });
});

describe('scan', () => {
  it('adds units_per_scan of the product', () => {
    const s = scan(emptySession(), INDEX, '18410188012342');
    expect(s.lines).toEqual([{ itemId: 'cola', quantity: 24, touched: 1 }]);
    expect(s.last).toMatchObject({ kind: 'added', itemId: 'cola', quantity: 24, label: 'caja de 24' });
  });

  it('finds the code however it was spelled (UPC-A, EAN-13, spaces, CR)', () => {
    let s = scan(emptySession(), INDEX, '036000291452');
    s = scan(s, INDEX, '0036000291452');
    s = scan(s, INDEX, ' 8410188012345\r\n');
    expect(line(s, 'water')?.quantity).toBe(12);
    expect(line(s, 'cola')?.quantity).toBe(1);
  });

  it('multiplies by the multiplier', () => {
    const s = scan(emptySession(), INDEX, '18410188012342', 5);
    expect(line(s, 'cola')?.quantity).toBe(120);
    expect(s.last).toMatchObject({ kind: 'added', quantity: 120, unitsPerScan: 24, multiplier: 5 });
  });

  it('adds onto the line of the same product, whichever of its codes', () => {
    let s = scan(emptySession(), INDEX, '18410188012342');
    s = scan(s, INDEX, '8410188012345');
    expect(s.lines).toHaveLength(1);
    expect(line(s, 'cola')?.quantity).toBe(25);
  });

  it('keeps the lines in the order they were last scanned, newest first', () => {
    let s = scan(emptySession(), INDEX, '8410188012345'); // cola
    s = scan(s, INDEX, '036000291452'); // water
    expect(s.lines.map((l) => l.itemId)).toEqual(['water', 'cola']);
    s = scan(s, INDEX, '8410188012345'); // cola again
    expect(s.lines.map((l) => l.itemId)).toEqual(['cola', 'water']);
  });

  it('does nothing with a code that is not there', () => {
    const s0 = emptySession();
    expect(scan(s0, INDEX, '  \r\n')).toBe(s0);
  });

  it('treats a bad multiplier as 1', () => {
    expect(line(scan(emptySession(), INDEX, '8410188012345', 0), 'cola')?.quantity).toBe(1);
    expect(line(scan(emptySession(), INDEX, '8410188012345', NaN), 'cola')?.quantity).toBe(1);
  });
});

describe('a code nobody knows', () => {
  it('waits, with every scan of it counted, while known codes keep adding', () => {
    let s = scan(emptySession(), INDEX, ' 4006381333931\r');
    expect(s.last).toEqual({ kind: 'unknown', seq: 1, code: '4006381333931' });
    s = scan(s, INDEX, '8410188012345');
    s = scan(s, INDEX, '04006381333931', 3); // the same code, spelled as an EAN-13 with a zero
    // Two scans (that is what the manager is told), worth 4 once resolved.
    expect(s.pending).toEqual([
      { code: '4006381333931', key: '04006381333931', scans: 2, times: 4, archivedItemId: null },
    ]);
    expect(line(s, 'cola')?.quantity).toBe(1);
    expect(s.lines).toHaveLength(1);
  });

  it('queues different unknown codes in the order they came', () => {
    let s = scan(emptySession(), INDEX, 'AAA');
    s = scan(s, INDEX, 'BBB');
    expect(s.pending.map((p) => p.code)).toEqual(['AAA', 'BBB']);
  });

  it('adds its scans, with their multipliers, once resolved', () => {
    let s = scan(emptySession(), INDEX, 'NEW-1', 2);
    s = scan(s, INDEX, 'NEW-1');
    s = resolvePending(s, 'NEW-1', { itemId: 'water', unitsPerScan: 6, label: 'pack de 6' });
    expect(s.pending).toEqual([]);
    expect(line(s, 'water')?.quantity).toBe(18); // 3 scans x 6
    expect(s.last).toMatchObject({ kind: 'added', itemId: 'water', quantity: 18, multiplier: 3 });
  });

  it('is remembered once resolved, before the product list catches up', () => {
    let s = scan(emptySession(), INDEX, 'NEW-1');
    s = resolvePending(s, 'NEW-1', { itemId: 'brand-new', unitsPerScan: 12 });
    s = scan(s, INDEX, 'NEW-1');
    expect(s.pending).toEqual([]);
    expect(line(s, 'brand-new')?.quantity).toBe(24);
  });

  it('is dropped, scans and all, when ignored', () => {
    let s = scan(emptySession(), INDEX, 'JUNK', 4);
    s = dismissPending(s, 'JUNK');
    expect(s.pending).toEqual([]);
    expect(hasContent(s)).toBe(false);
    // And asked about again if it comes back.
    expect(scan(s, INDEX, 'JUNK').pending).toHaveLength(1);
  });

  it('ignores resolving or dismissing a code that is not waiting', () => {
    const s = emptySession();
    expect(resolvePending(s, 'X', { itemId: 'cola', unitsPerScan: 1 })).toBe(s);
    expect(dismissPending(s, 'X')).toBe(s);
  });
});

describe('an archived product', () => {
  it('resolves its code but waits, marked archived', () => {
    const s = scan(emptySession(), INDEX, 'SHELF-9', 2);
    expect(s.lines).toEqual([]);
    expect(s.last).toEqual({ kind: 'archived', seq: 1, code: 'SHELF-9', itemId: 'old' });
    expect(s.pending).toEqual([
      { code: 'SHELF-9', key: 'SHELF-9', scans: 1, times: 2, archivedItemId: 'old' },
    ]);
  });

  it('adds once brought back, and its codes add straight away after that', () => {
    let s = scan(emptySession(), INDEX, 'SHELF-9', 2);
    s = resolvePending(s, 'SHELF-9', { itemId: 'old', unitsPerScan: 1 });
    expect(line(s, 'old')?.quantity).toBe(2);
    expect(s.revived).toEqual(['old']);
    s = scan(s, INDEX, 'SHELF-9');
    expect(line(s, 'old')?.quantity).toBe(3);
    expect(s.pending).toEqual([]);
  });
});

describe('undo', () => {
  it('takes back the last SCAN, not the top line', () => {
    let s = scan(emptySession(), INDEX, '18410188012342'); // cola +24
    s = scan(s, INDEX, '036000291452'); // water +6
    s = scan(s, INDEX, '8410188012345'); // cola +1, cola on top
    s = undo(s);
    expect(line(s, 'cola')?.quantity).toBe(24);
    // Cola goes back to where its previous scan had put it: under water.
    expect(s.lines.map((l) => l.itemId)).toEqual(['water', 'cola']);
    expect(s.last).toMatchObject({ kind: 'undone', itemId: 'cola', quantity: 1 });
    s = undo(s); // water -6: its line goes
    expect(s.lines.map((l) => l.itemId)).toEqual(['cola']);
    s = undo(s); // cola -24
    expect(s.lines).toEqual([]);
    expect(canUndo(s)).toBe(false);
    expect(undo(s)).toBe(s);
  });

  it('takes a multiplied scan back whole', () => {
    let s = scan(emptySession(), INDEX, '8410188012345');
    s = scan(s, INDEX, '18410188012342', 3);
    s = undo(s);
    expect(line(s, 'cola')?.quantity).toBe(1);
  });

  it('does not undo scans a typed quantity replaced', () => {
    let s = scan(emptySession(), INDEX, '036000291452'); // water 6
    s = scan(s, INDEX, '18410188012342'); // cola 24
    s = setQuantity(s, 'cola', 30);
    expect(line(s, 'cola')?.quantity).toBe(30);
    s = undo(s); // the last undoable scan is water's
    expect(line(s, 'water')).toBeUndefined();
    expect(line(s, 'cola')?.quantity).toBe(30);
    expect(canUndo(s)).toBe(false);
  });

  it('undoes a resolved code as one scan', () => {
    let s = scan(emptySession(), INDEX, 'NEW', 2);
    s = resolvePending(s, 'NEW', { itemId: 'water', unitsPerScan: 6 });
    s = undo(s);
    expect(s.lines).toEqual([]);
  });
});

describe('editing the list', () => {
  it('replaces a quantity only with a positive number', () => {
    const s = scan(emptySession(), INDEX, '8410188012345');
    expect(line(setQuantity(s, 'cola', 12.5), 'cola')?.quantity).toBe(12.5);
    expect(setQuantity(s, 'cola', 0)).toBe(s);
    expect(setQuantity(s, 'cola', -3)).toBe(s);
    expect(setQuantity(s, 'cola', NaN)).toBe(s);
    expect(setQuantity(s, 'nope', 3)).toBe(s);
  });

  it('removes a line with its scans, and puts it back where it was', () => {
    let s = scan(emptySession(), INDEX, '8410188012345'); // cola
    s = scan(s, INDEX, '036000291452'); // water
    s = remove(s, 'cola');
    expect(s.lines.map((l) => l.itemId)).toEqual(['water']);
    expect(s.scans.map((r) => r.itemId)).toEqual(['water']);
    expect(s.last).toMatchObject({ kind: 'removed', itemId: 'cola' });
    s = restoreRemoved(s);
    expect(s.lines.map((l) => l.itemId)).toEqual(['water', 'cola']);
    expect(s.scans.map((r) => r.itemId)).toEqual(['cola', 'water']);
    expect(s.removed).toBeNull();
  });

  it('adds a product by hand as a line of 1, or brings it to the top', () => {
    let s = addManual(emptySession(), 'lemons');
    expect(s.lines).toEqual([{ itemId: 'lemons', quantity: 1, touched: 1 }]);
    expect(canUndo(s)).toBe(false); // undo is for scans
    s = scan(s, INDEX, '036000291452');
    s = setQuantity(s, 'lemons', 4);
    s = addManual(s, 'lemons');
    expect(s.lines.map((l) => [l.itemId, l.quantity])).toEqual([
      ['lemons', 4],
      ['water', 6],
    ]);
    expect(s.last).toMatchObject({ kind: 'manual', itemId: 'lemons' });
  });

  it('adds decimals without float noise', () => {
    const idx = buildCodeIndex([product('ham', { barcodes: [code('HAM', 0.1)] })]);
    let s = emptySession();
    for (let i = 0; i < 3; i++) s = scan(s, idx, 'HAM');
    expect(line(s, 'ham')?.quantity).toBe(0.3);
    expect(line(undo(s), 'ham')?.quantity).toBe(0.2);
  });

  it('counts products, and adds them up only when they share a unit', () => {
    let s = scan(emptySession(), INDEX, '18410188012342'); // cola 24
    s = scan(s, INDEX, '036000291452'); // water 6
    const cans = () => 'latas';
    expect(totals(s, cans)).toEqual({ products: 2, total: { quantity: 30, unit: 'latas' } });
    // " Latas" and "latas" are one unit, written as the top line writes it.
    expect(totals(s, (id) => (id === 'water' ? ' Latas' : 'latas')).total).toEqual({ quantity: 30, unit: 'Latas' });
    // Cans plus bottles is not a number.
    expect(totals(s, (id) => (id === 'cola' ? 'latas' : 'botellas'))).toEqual({ products: 2, total: null });
    // No unit at all is a unit of its own.
    expect(totals(s, () => null).total).toEqual({ quantity: 30, unit: null });
    expect(totals(s, (id) => (id === 'cola' ? null : 'kg')).total).toBeNull();
    expect(totals(emptySession(), cans)).toEqual({ products: 0, total: null });
  });

  it('has content with lines or with codes waiting', () => {
    expect(hasContent(emptySession())).toBe(false);
    expect(hasContent(scan(emptySession(), INDEX, 'UNKNOWN'))).toBe(true);
    expect(hasContent(scan(emptySession(), INDEX, '8410188012345'))).toBe(true);
  });
});

describe('withoutMissing', () => {
  it('drops what belongs to products that are gone', () => {
    let s = scan(emptySession(), INDEX, '8410188012345');
    s = scan(s, INDEX, '036000291452');
    s = scan(s, INDEX, 'SHELF-9');
    s = remove(s, 'cola');
    const kept = withoutMissing(s, (id) => id === 'water');
    expect(kept.lines.map((l) => l.itemId)).toEqual(['water']);
    expect(kept.scans.map((r) => r.itemId)).toEqual(['water']);
    expect(kept.removed).toBeNull();
    // The archived product's code now waits as a code nobody knows.
    expect(kept.pending).toEqual([
      { code: 'SHELF-9', key: 'SHELF-9', scans: 1, times: 1, archivedItemId: null },
    ]);
  });
});

describe('resolveKnown', () => {
  it('resolves on its own a waiting code the product list now knows', () => {
    let s = scan(emptySession(), INDEX, 'NEW-1', 2);
    s = scan(s, INDEX, 'OTHER');
    const later = buildCodeIndex([COLA, product('lemons', { barcodes: [code('NEW-1', 6)] })]);
    s = resolveKnown(s, later);
    expect(line(s, 'lemons')?.quantity).toBe(12);
    expect(s.pending.map((p) => p.key)).toEqual(['OTHER']);
    expect(s.last).toMatchObject({ kind: 'added', itemId: 'lemons', quantity: 12 });
  });

  it('resolves a code of an archived product once it is brought back', () => {
    let s = scan(emptySession(), INDEX, 'SHELF-9');
    expect(resolveKnown(s, INDEX)).toBe(s); // still archived: it waits
    const back = buildCodeIndex([{ ...OLD, archived_at: null }]);
    s = resolveKnown(s, back);
    expect(line(s, 'old')?.quantity).toBe(1);
    expect(s.pending).toEqual([]);
  });

  it('is the same session when nothing waiting is known', () => {
    const s = scan(emptySession(), INDEX, 'NOBODY');
    expect(resolveKnown(s, INDEX)).toBe(s);
  });
});

describe('afterSaved', () => {
  it('leaves nothing when the entry took everything', () => {
    let s = scan(emptySession(), INDEX, '18410188012342');
    s = scan(s, INDEX, '036000291452');
    s = { ...s, clientRef: 'ref-1' };
    const rest = afterSaved(s, [
      { item_id: 'cola', quantity: 24 },
      { item_id: 'water', quantity: 6 },
    ]);
    expect(hasContent(rest)).toBe(false);
    expect(rest.clientRef).toBeNull();
  });

  it('keeps what an earlier attempt\'s entry did not have, under no ref yet', () => {
    // The first save reached the server with cola 24; its answer was lost.
    // Then another case of cola and a pack of water were scanned, and the
    // retry with the same ref got back the entry as first saved.
    let s = scan(emptySession(), INDEX, '18410188012342');
    s = scan(s, INDEX, '18410188012342');
    s = scan(s, INDEX, '036000291452');
    s = { ...s, clientRef: 'ref-1' };
    const rest = afterSaved(s, [{ item_id: 'cola', quantity: 24 }]);
    expect(rest.lines.map((l) => [l.itemId, l.quantity])).toEqual([
      ['water', 6],
      ['cola', 24],
    ]);
    expect(rest.clientRef).toBeNull();
    // Water's scan is still its own to undo; cola's are in the saved entry.
    expect(rest.scans.map((r) => r.itemId)).toEqual(['water']);
  });

  it('keeps the codes still waiting, which were never in the entry', () => {
    let s = scan(emptySession(), INDEX, '8410188012345');
    s = scan(s, INDEX, 'MYSTERY', 3);
    const rest = afterSaved(s, [{ item_id: 'cola', quantity: 1 }]);
    expect(rest.lines).toEqual([]);
    expect(rest.pending).toHaveLength(1);
    expect(hasContent(rest)).toBe(true);
  });

  it('drops what the entry had more of than the session', () => {
    const s = scan(emptySession(), INDEX, '8410188012345');
    expect(afterSaved(s, [{ item_id: 'cola', quantity: 5 }]).lines).toEqual([]);
  });
});

describe('undoable', () => {
  it('is the last scan while it is the last thing that happened', () => {
    let s = scan(emptySession(), INDEX, '18410188012342');
    expect(undoable(s)).toMatchObject({ itemId: 'cola', quantity: 24 });
    s = scan(s, INDEX, 'UNKNOWN');
    expect(undoable(s)).toBeNull(); // the last thing was a code nobody knows
    s = undo(scan(s, INDEX, '036000291452'));
    expect(undoable(s)).toBeNull(); // the last thing was an undo
    expect(undoable(emptySession())).toBeNull();
  });

  it('is gone once the line is typed over', () => {
    const s = setQuantity(scan(emptySession(), INDEX, '8410188012345'), 'cola', 3);
    expect(undoable(s)).toBeNull();
  });
});
