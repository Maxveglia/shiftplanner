import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '../../api/inventory';
import { cleanPhone, phoneProblem, productsBySupplier, sortSuppliers, supplierProblem } from './suppliers';

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

describe('phoneProblem', () => {
  it('takes a phone as people write one', () => {
    for (const phone of ['612 34 56 78', '+34 612 34 56 78', '(91) 123-45-67', '0034612345678', '1234567', '']) {
      expect(phoneProblem(phone), phone).toBeNull();
    }
  });

  it('refuses letters, dots, a "+" in the middle, and too few or too many digits', () => {
    for (const phone of ['612 ABC 678', '612.34.56.78', '34+612345678', '612\t345678', '123456', '1234567890123456', '1'.repeat(41)]) {
      expect(phoneProblem(phone), phone).toBe('invalid');
    }
  });
});

describe('cleanPhone', () => {
  it('trims, and empty is none', () => {
    expect(cleanPhone('  612 34 56 78 ')).toBe('612 34 56 78');
    expect(cleanPhone('   ')).toBeNull();
  });
});

describe('supplierProblem', () => {
  const others = [
    { id: 'a', name: 'Makro', phone: null },
    { id: 'b', name: 'Coca-Cola', phone: null },
  ];

  it('asks for a name, and not one too long', () => {
    expect(supplierProblem('  ', '', others)).toBe('name_missing');
    expect(supplierProblem('x'.repeat(121), '', others)).toBe('name_long');
  });

  it('says a name is taken whatever its capitals, except by the one being edited', () => {
    expect(supplierProblem(' makro ', '', others)).toBe('name_taken');
    expect(supplierProblem('MAKRO', '', others, 'a')).toBeNull();
  });

  it('checks the phone last', () => {
    expect(supplierProblem('Frutas Paco', 'abc', others)).toBe('phone_invalid');
    expect(supplierProblem('Frutas Paco', '612345678', others)).toBeNull();
  });
});

describe('productsBySupplier', () => {
  it('counts the products of each supplier, archived ones not', () => {
    const makro = { id: 'makro', name: 'Makro', phone: null };
    const counts = productsBySupplier([
      item({ id: '1', supplier: makro }),
      item({ id: '2', supplier: makro }),
      item({ id: '3', supplier: makro, archived_at: '2026-09-01T00:00:00Z' }),
      item({ id: '4', supplier: null }),
      item({ id: '5' }),
    ]);
    expect(counts.get('makro')).toBe(2);
    expect(counts.size).toBe(1);
  });
});

describe('sortSuppliers', () => {
  it('orders A to Z, whatever the capitals and accents', () => {
    expect(sortSuppliers([{ name: 'makro' }, { name: 'Ábaco' }, { name: 'Coca-Cola' }], 'es').map((s) => s.name)).toEqual([
      'Ábaco',
      'Coca-Cola',
      'makro',
    ]);
  });
});
