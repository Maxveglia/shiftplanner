// The suppliers of a business, as Inventory › Suppliers and the product form
// write them: a name, unique in the business whatever its capitals, and the
// phone their orders go to by WhatsApp -- kept as the manager typed it, and
// checked the way the server checks it: 7 to 15 digits, with spaces, dashes,
// brackets and one "+" in front allowed around them, and nothing else.

import type { InventoryItem, InventorySupplier } from '../../api/inventory';

/** The server's bounds (inventory_supplier). */
export const MAX_SUPPLIER_NAME = 120;
export const MAX_SUPPLIER_PHONE = 40;

/** What is wrong with a phone as typed, or null when it is fine -- or empty, which is no phone. */
export function phoneProblem(text: string): 'invalid' | null {
  const phone = text.trim();
  if (phone === '') return null;
  // ASCII digits, spaces, dashes and brackets, after one "+" at the start:
  // the server's shape (routers/inventory_suppliers.py), no more and no less.
  if (phone.length > MAX_SUPPLIER_PHONE || !/^\+?[0-9 ()-]+$/.test(phone)) return 'invalid';
  const digits = phone.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15 ? null : 'invalid';
}

/** The phone as it is sent: trimmed, or null for none. */
export function cleanPhone(text: string): string | null {
  const phone = text.trim();
  return phone === '' ? null : phone;
}

/**
 * What is wrong with a supplier as typed, or null. `others` are the business's
 * suppliers, the one being edited among them (`exceptId`), to say "already
 * there" before the server does.
 */
export function supplierProblem(
  name: string,
  phone: string,
  others: readonly InventorySupplier[],
  exceptId: string | null = null,
): 'name_missing' | 'name_long' | 'name_taken' | 'phone_invalid' | null {
  const clean = name.trim();
  if (clean === '') return 'name_missing';
  if (clean.length > MAX_SUPPLIER_NAME) return 'name_long';
  const key = clean.toLocaleLowerCase();
  if (others.some((s) => s.id !== exceptId && s.name.trim().toLocaleLowerCase() === key)) return 'name_taken';
  return phoneProblem(phone) ? 'phone_invalid' : null;
}

/** How many products (not archived) each supplier has, by its id. */
export function productsBySupplier(items: readonly InventoryItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const id = item.supplier?.id;
    if (!id || item.archived_at !== null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** A to Z by name, as every list of them is shown. */
export function sortSuppliers<T extends { name: string }>(list: readonly T[], locale?: string): T[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }));
}
