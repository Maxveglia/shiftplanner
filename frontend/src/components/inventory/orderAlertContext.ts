// The way into the "Order from your supplier" notice, from wherever it is
// opened: the inventory on entering it, Stock's "Order" button, and a sale
// saved at the till or by hand. The notice itself lives in the layout
// (OrderAlert.tsx), so it outlives the page that asked for it -- a sale's
// answer can come back after the till has been left.
//
// Apart from the component so the store's screens can reach it without
// importing the notice, and so a screen rendered outside the layout gets a
// way in that does nothing rather than an error.

import { createContext, useContext } from 'react';
import type { InventoryItem } from '../../api/inventory';
import type { StockAlert } from '../../api/store';

/** Why the notice is open, which decides what it lists. */
export type OrderAlertRequest =
  /** Entering the inventory: everything below its minimum. */
  | { kind: 'entry' }
  /** Stock's "Order" button: the same, asked for. */
  | { kind: 'manual' }
  /** A sale that made something critical: that, and the rest of the same suppliers (lib/inventory/orders.ts). */
  | { kind: 'sale'; alerts: StockAlert[] };

export interface OrderAlertApi {
  open: (request: { kind: 'entry' | 'manual' }) => void;
  /**
   * A sale's `stock_alerts`: opens the notice only when one of them became
   * critical with it -- once no other dialog is open (lib/inventory/orders.ts,
   * "After a sale").
   */
  afterSale: (alerts: StockAlert[]) => void;
  /**
   * Stock's list of products, just fetched: what is no longer below its
   * minimum leaves what the notice was closed for today, so that falling
   * below again brings it back.
   */
  sawStock: (items: readonly InventoryItem[]) => void;
}

const NOTHING: OrderAlertApi = { open: () => {}, afterSale: () => {}, sawStock: () => {} };

export const OrderAlertContext = createContext<OrderAlertApi>(NOTHING);

export function useOrderAlert(): OrderAlertApi {
  return useContext(OrderAlertContext);
}

/**
 * What the notice puts in the router's state when it sends the manager
 * somewhere to put something right -- give a product its supplier, a
 * supplier its phone. Arriving in the inventory that way is not "entering"
 * it: the notice they just closed does not open again over the page they
 * were sent to.
 */
export interface FromOrders {
  fromOrders: true;
  /** A product whose form Stock opens on arrival. */
  editItem?: string;
}

export function cameFromOrders(state: unknown): boolean {
  return state !== null && typeof state === 'object' && (state as Record<string, unknown>).fromOrders === true;
}

/** The product Stock is asked to open, from the router's state; null for none. */
export function itemToEdit(state: unknown): string | null {
  if (!cameFromOrders(state)) return null;
  const id = (state as Record<string, unknown>).editItem;
  return typeof id === 'string' && id !== '' ? id : null;
}
