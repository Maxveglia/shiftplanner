// A code the receive screen does not know, put against a product that
// exists: what happens depends on the code and on who is receiving.
//
// Saving the code on the product is editing the product (lib/access.ts,
// `inventory.products`): the manager's. Anybody else receiving -- an
// employee, the shop's tablet -- can still say which product those boxes
// are, and they are added to THIS delivery only: the session learns the code
// (receiveSession's `learned`, kept in the draft), so the next scans of it in
// the same delivery add to that product too, and nothing is written on the
// product. The next delivery asks again, until the manager saves the code.

import type { CodeEntry } from './receiveSession';

export type ExistingChoice =
  /** The product list already has this code on this product: nothing to save. */
  | { kind: 'known'; unitsPerScan: number; label: string | null }
  /** Another product has the code: say whose, add nothing. */
  | { kind: 'taken'; itemId: string }
  /** Save the code on the product, then add what was scanned. */
  | { kind: 'save' }
  /** Add what was scanned to this delivery only; the code is not saved. */
  | { kind: 'local' };

export function existingChoice(
  known: CodeEntry | undefined,
  chosenId: string,
  canSaveCode: boolean,
): ExistingChoice {
  if (known && known.itemId === chosenId) {
    return { kind: 'known', unitsPerScan: known.unitsPerScan, label: known.label };
  }
  if (known) return { kind: 'taken', itemId: known.itemId };
  return canSaveCode ? { kind: 'save' } : { kind: 'local' };
}

/**
 * What the card offers for a code nobody knows: a product that exists always
 * (when there is one); a new product, and saving the code, only to whoever
 * may change products. An archived product's code is brought back only by
 * them too: anybody else is told to ask.
 */
export function unknownCodeOptions(canProducts: boolean): { newProduct: boolean; saveCode: boolean } {
  return { newProduct: canProducts, saveCode: canProducts };
}

export function archivedCodeOptions(canProducts: boolean): { revive: boolean } {
  return { revive: canProducts };
}
