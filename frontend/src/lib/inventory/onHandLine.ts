// The line under the figure on hand in Stock: where it comes from, once it is
// not just the count.
//
// Each piece names its source and then the number -- "conteo 10 + entradas 48
// − ventas 30" -- rather than the number and then a word about it ("10 − 1
// vendida"): the number is kilos, bottles or boxes, and a word after it has to
// agree with a unit the screen does not know ("1 vendida" of a product counted
// in kg). A name before it agrees with nothing.

import { formatQuantity, onHandBreakdown, type InventoryItem } from '../../api/inventory';
import type { TFunction } from '../i18n';

/**
 * "conteo 10 + entradas 48 − ventas 30", or, never counted, "entradas 48 −
 * ventas 30" -- a figure that needs no count says nothing about counting.
 * Null when there is nothing to explain.
 */
export function onHandLine(item: InventoryItem, t: TFunction): string | null {
  const parts = onHandBreakdown(item);
  if (!parts) return null;
  const pieces: string[] = [];
  const counted = parts.counted !== null;
  if (counted) pieces.push(t('inventory.stock.onHand.counted', { quantity: formatQuantity(parts.counted!) }));
  if (parts.received > 0) {
    const key = counted ? 'inventory.stock.onHand.plusReceived' : 'inventory.stock.onHand.received';
    pieces.push(t(key, { quantity: formatQuantity(parts.received) }));
  }
  if (parts.sold > 0) {
    pieces.push(t('inventory.stock.onHand.sold', { quantity: formatQuantity(parts.sold) }));
  }
  return pieces.join(' ');
}
