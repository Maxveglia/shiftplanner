import { describe, expect, it } from 'vitest';
import { archivedCodeOptions, existingChoice, unknownCodeOptions } from './unknownCode';

const entry = (itemId: string) => ({ itemId, unitsPerScan: 12, label: 'caja', archived: false });

describe('existingChoice', () => {
  it('saves the code on the product for whoever may change products', () => {
    expect(existingChoice(undefined, 'agua', true)).toEqual({ kind: 'save' });
  });

  it('adds to this delivery only, without saving the code, for anybody else', () => {
    // An employee or the shop's tablet: the code is not theirs to save.
    expect(existingChoice(undefined, 'agua', false)).toEqual({ kind: 'local' });
  });

  it('saves nothing when the list already has the code on that product', () => {
    for (const canSave of [true, false]) {
      expect(existingChoice(entry('agua'), 'agua', canSave)).toEqual({
        kind: 'known',
        unitsPerScan: 12,
        label: 'caja',
      });
    }
  });

  it('says whose it is when another product has it, whoever is receiving', () => {
    for (const canSave of [true, false]) {
      expect(existingChoice(entry('cola'), 'agua', canSave)).toEqual({ kind: 'taken', itemId: 'cola' });
    }
  });
});

describe('what the cards offer', () => {
  it('offers the manager everything there was', () => {
    expect(unknownCodeOptions(true)).toEqual({ newProduct: true, saveCode: true });
    expect(archivedCodeOptions(true)).toEqual({ revive: true });
  });

  it('offers anybody else no new product, no saved code and no restoring', () => {
    expect(unknownCodeOptions(false)).toEqual({ newProduct: false, saveCode: false });
    expect(archivedCodeOptions(false)).toEqual({ revive: false });
  });
});
