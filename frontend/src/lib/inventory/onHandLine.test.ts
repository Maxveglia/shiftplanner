import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '../../api/inventory';
import { translateIn, type Language, type Vars } from '../i18n/core';
import { onHandLine } from './onHandLine';

function item(over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'i1',
    name: 'Pollo',
    unit: 'kg',
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

const tIn = (lang: Language) => (key: string, vars?: Vars) => translateIn(lang, key, vars);

describe('onHandLine', () => {
  it('names each source before its number, so nothing agrees with the unit', () => {
    const counted = item({ last_quantity: 10, received_since_count: 48, sold_since_count: 30 });
    expect(onHandLine(counted, tIn('es'))).toBe('conteo 10 + entradas 48 − ventas 30');
    expect(onHandLine(counted, tIn('en'))).toBe('count 10 + deliveries 48 − sales 30');
  });

  it('is the same for exactly one: no "1 vendida" of kilos', () => {
    const one = item({ last_quantity: 10, sold_since_count: 1 });
    expect(onHandLine(one, tIn('es'))).toBe('conteo 10 − ventas 1');
    expect(onHandLine(one, tIn('en'))).toBe('count 10 − sales 1');
  });

  it('never counted, is what came in and what was sold -- with no word about counting', () => {
    const never = item({ received_since_count: 48, sold_since_count: 30 });
    expect(onHandLine(never, tIn('es'))).toBe('entradas 48 − ventas 30');
    expect(onHandLine(never, tIn('en'))).toBe('deliveries 48 − sales 30');
  });

  it('is nothing when the figure is the count alone, or nothing has moved', () => {
    expect(onHandLine(item({ last_quantity: 10 }), tIn('es'))).toBeNull();
    expect(onHandLine(item(), tIn('es'))).toBeNull();
  });
});
