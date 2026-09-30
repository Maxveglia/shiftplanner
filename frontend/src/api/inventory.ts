// The stock: products, the counts taken of them, and the deliveries that
// came in between. Managers only.
//
// A count is a snapshot of the shelf; a delivery (an "entrada") is what a
// truck left; a sale of the shop takes what its recipe says (a Crispy Grande
// is ¾ kg of chicken). What is on the shelf now is the last count, plus what
// came in after it, minus what the sales after it took; what went between two
// counts is the first, plus what came in between, minus the second -- and of
// that, the sales in between explain part. The server sends each product with
// the sums those need (received_since_count, received_between_counts,
// sold_since_count, sold_between_counts), and the arithmetic is done here,
// once, in `onHand` and `consumption`.
//
// A sale is "after" a count by its DAY: each count says the last day whose
// sales it already reflects (counted after closing: that day; before
// opening: the day before), and the server compares the sale's day with it.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { APP_LOCALE } from '../lib/locale';
import { queryKeys } from './keys';

/** One barcode of a product: a bottle's EAN, the case's DUN-14, a shelf label. */
export interface InventoryBarcode {
  id: string;
  /** As it was read or typed, for showing back. */
  code: string;
  /** What scans are matched by (lib/inventory/barcodeKey.ts computes the same). */
  key: string;
  /** How many of the product's units one scan of it is: 24 for a case of 24. */
  units_per_scan: number;
  /** "caja de 24", or null. */
  label: string | null;
}

export interface InventoryBarcodeInput {
  code: string;
  units_per_scan?: number;
  label?: string | null;
}

/**
 * Who a product is ordered from: a name, and the phone its orders go to by
 * WhatsApp, as the manager typed it ("612 34 56 78", "+34 612…"), or null.
 */
export interface InventorySupplier {
  id: string;
  name: string;
  phone: string | null;
}

/** A supplier as Inventory › Suppliers lists it. */
export interface InventorySupplierListed extends InventorySupplier {
  /**
   * How many products (not archived) are bought from it: the ones left
   * without a supplier if it is deleted. Missing from an older server.
   */
  item_count?: number;
}

export interface InventorySupplierInput {
  name?: string;
  phone?: string | null;
}

export interface InventoryItem {
  id: string;
  name: string;
  unit: string | null;
  category: string | null;
  min_quantity: number | null;
  archived_at: string | null;
  last_quantity: number | null;
  last_counted_at: string | null;
  previous_quantity: number | null;
  /** When the count before the last one that included it was taken. */
  previous_counted_at: string | null;
  barcodes: InventoryBarcode[];
  /**
   * Delivered after the last count; if it was never counted, every delivery
   * of it. 0 when nothing came in.
   */
  received_since_count: number;
  /** Delivered between the last two counts; null with fewer than two counts. */
  received_between_counts: number | null;
  last_received_at: string | null;
  /**
   * What the shop's sales after the last count took, by their recipes; if it
   * was never counted, what every sale took. 0 without sales.
   */
  sold_since_count: number;
  /** What the sales between the last two counts took; null with fewer than two counts. */
  sold_between_counts: number | null;
  /**
   * Where its photo is served from ("/api/v1/inventory/photos/<id>"), or null
   * without one. A new photo is a new address. Missing from a server older
   * than the field: read as none.
   */
  photo_url?: string | null;
  /** Who it is ordered from, or null. Missing from a server older than the field: read as none. */
  supplier?: InventorySupplier | null;
  /**
   * How much of it is usually ordered at once, in its unit: what the
   * "order from your supplier" notice starts from. Null when not set;
   * missing from an older server.
   */
  order_quantity?: number | null;
}

export interface InventoryItemInput {
  name?: string;
  unit?: string | null;
  category?: string | null;
  min_quantity?: number | null;
  archived?: boolean;
  /** One of this business's suppliers, or null for none. */
  supplier_id?: string | null;
  order_quantity?: number | null;
}

/**
 * Only when creating: what is already on the shelf. The server keeps it as a
 * delivery made with the product (`initial_note` its note), in the same
 * transaction -- never as a count.
 */
export interface InventoryItemInitialStock {
  initial_quantity?: number;
  initial_note?: string;
}

export interface InventoryCountSummary {
  id: string;
  counted_at: string;
  note: string | null;
  line_count: number;
  /**
   * Counted after closing (the day's sales are already off the shelf) rather
   * than before opening. Missing from a server older than the field.
   */
  after_close?: boolean;
}

export interface InventoryCountLine {
  item_id: string;
  item_name: string;
  unit: string | null;
  category: string | null;
  quantity: number;
  /** The product's photo as it is now, or null; missing from an older server. */
  photo_url?: string | null;
}

export interface InventoryCount {
  id: string;
  counted_at: string;
  note: string | null;
  after_close?: boolean;
  lines: InventoryCountLine[];
}

export interface InventoryCountInput {
  counted_at?: string;
  note?: string | null;
  /**
   * Whether the shelf was counted after closing -- the sales of its day are
   * already off it -- or before opening, when they are still to come. Left
   * out, the server goes by the hour of `counted_at` (before noon: before
   * opening).
   */
  after_close?: boolean;
  lines: { item_id: string; quantity: number }[];
}

export interface InventoryReceiptSummary {
  id: string;
  received_at: string;
  supplier: string | null;
  note: string | null;
  line_count: number;
  total_quantity: number;
}

export interface InventoryReceiptLine {
  item_id: string;
  item_name: string;
  unit: string | null;
  category: string | null;
  quantity: number;
  /** The product's photo as it is now, or null; missing from an older server. */
  photo_url?: string | null;
}

export interface InventoryReceipt {
  id: string;
  received_at: string;
  supplier: string | null;
  note: string | null;
  lines: InventoryReceiptLine[];
}

export interface InventoryReceiptInput {
  /**
   * The scanning session's id (a UUID), the same on every attempt to save
   * it. The server answers a ref it has already saved with that entry, as it
   * was saved (200), instead of saving it again.
   */
  client_ref?: string;
  received_at?: string;
  supplier?: string | null;
  note?: string | null;
  lines: { item_id: string; quantity: number }[];
}

/**
 * What a product created, changed or archived (`archived: true` is a change)
 * makes out of date: every list of the stock -- waited for, so the form
 * closes on the list as it now is -- and the recipes, not waited for. The
 * recipes because the name decides the automatic link ("Agua" on the menu
 * takes 1 of the one product called "Agua"): a product created, renamed or
 * archived makes or breaks it, and Recipes showed the old link for as long
 * as its copy stayed fresh.
 */
export function refreshProductReaders(qc: Pick<QueryClient, 'invalidateQueries'>): Promise<void> {
  void qc.invalidateQueries({ queryKey: queryKeys.recipes });
  return qc.invalidateQueries({ queryKey: queryKeys.inventory });
}

export function useInventoryItems(includeArchived = false, enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventoryItems(includeArchived),
    enabled,
    queryFn: async () => {
      const { data } = await api.get<InventoryItem[]>('/inventory/items', {
        params: includeArchived ? { include_archived: true } : undefined,
      });
      return data;
    },
  });
}

export function useCreateInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    // With its barcodes in the same call: the server creates the product and
    // its codes together or neither (a code another product already has
    // refuses the whole thing), so a scanned box never ends up a product
    // without the code it was created from.
    mutationFn: async (
      payload: InventoryItemInput &
        InventoryItemInitialStock & { name: string; barcodes?: InventoryBarcodeInput[] },
    ) => {
      const { data } = await api.post<InventoryItem>('/inventory/items', payload);
      return data;
    },
    onSuccess: () => refreshProductReaders(qc),
  });
}

export function useUpdateInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: InventoryItemInput & { id: string }) => {
      const { data } = await api.patch<InventoryItem>(
        `/inventory/items/${encodeURIComponent(id)}`,
        payload,
      );
      return data;
    },
    onSuccess: () => refreshProductReaders(qc),
  });
}

/**
 * What a product's photo changes: every list of the stock (the products, and
 * the lines of counts and deliveries, which show it), and the recipes, whose
 * ingredients do.
 */
function refreshPhotoReaders(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.inventory });
  void qc.invalidateQueries({ queryKey: queryKeys.recipes });
}

/**
 * A product's photo, already reduced (lib/photo/shrinkPhoto.ts), sent as the
 * body with its own type, as a dish's is. The server gives it a new address
 * (`photo_url`), so every <img> of the product loads the new photo and no
 * cache serves the old one. Refreshed on a refusal too: the product may have
 * gone meanwhile.
 */
export function useSetInventoryItemPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, photo }: { id: string; photo: Blob }) => {
      await api.put(`/inventory/items/${encodeURIComponent(id)}/photo`, photo, {
        headers: { 'Content-Type': photo.type || 'image/jpeg' },
      });
    },
    onSettled: () => refreshPhotoReaders(qc),
  });
}

/** Takes a product's photo off: from then on it shows its initials. */
export function useRemoveInventoryItemPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/inventory/items/${encodeURIComponent(id)}/photo`);
    },
    onSettled: () => refreshPhotoReaders(qc),
  });
}

// --- Suppliers -------------------------------------------------------------
//
// Every write refreshes the whole inventory prefix: a product carries its
// supplier's name and phone (`supplier`), and a supplier renamed, given a
// phone or deleted changes every product that names it.

export function useInventorySuppliers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventorySuppliers,
    enabled,
    queryFn: async () => {
      const { data } = await api.get<InventorySupplierListed[]>('/inventory/suppliers');
      return data;
    },
  });
}

export function useCreateInventorySupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: InventorySupplierInput & { name: string }) => {
      const { data } = await api.post<InventorySupplier>('/inventory/suppliers', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.inventory }),
  });
}

export function useUpdateInventorySupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: InventorySupplierInput & { id: string }) => {
      const { data } = await api.patch<InventorySupplier>(
        `/inventory/suppliers/${encodeURIComponent(id)}`,
        payload,
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.inventory }),
  });
}

/** The products that had it are left with no supplier; nothing else of them changes. */
export function useDeleteInventorySupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/inventory/suppliers/${encodeURIComponent(id)}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.inventory }),
  });
}

export function useInventoryCounts() {
  return useQuery({
    queryKey: queryKeys.inventoryCounts,
    queryFn: async () => {
      const { data } = await api.get<InventoryCountSummary[]>('/inventory/counts');
      return data;
    },
  });
}

export function useInventoryCount(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.inventoryCount(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await api.get<InventoryCount>(
        `/inventory/counts/${encodeURIComponent(id!)}`,
      );
      return data;
    },
  });
}

export function useCreateInventoryCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: InventoryCountInput) => {
      const { data } = await api.post<InventoryCount>('/inventory/counts', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.inventory }),
  });
}

export function useDeleteInventoryCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/inventory/counts/${encodeURIComponent(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.inventory }),
  });
}

export function useAddInventoryBarcode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, ...payload }: InventoryBarcodeInput & { itemId: string }) => {
      const { data } = await api.post<InventoryBarcode>(
        `/inventory/items/${encodeURIComponent(itemId)}/barcodes`,
        payload,
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.inventory }),
  });
}

export function useDeleteInventoryBarcode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, barcodeId }: { itemId: string; barcodeId: string }) => {
      await api.delete(
        `/inventory/items/${encodeURIComponent(itemId)}/barcodes/${encodeURIComponent(barcodeId)}`,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.inventory }),
  });
}

export function useInventoryReceipts() {
  return useQuery({
    queryKey: queryKeys.inventoryReceipts,
    queryFn: async () => {
      const { data } = await api.get<InventoryReceiptSummary[]>('/inventory/receipts');
      return data;
    },
  });
}

export function useInventoryReceipt(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.inventoryReceipt(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await api.get<InventoryReceipt>(
        `/inventory/receipts/${encodeURIComponent(id!)}`,
      );
      return data;
    },
  });
}

/**
 * `onSaved` runs inside the mutation, the moment the server has the entry --
 * not in a callback passed to `mutate()`, which TanStack skips once the
 * component that called it is gone (the manager went back to Stock with the
 * save in flight) or the mutation was reset. That is where the scanning
 * draft is settled: skipping it would leave the saved scans in the draft, to
 * be saved a second time.
 */
export function useCreateInventoryReceipt(options: { onSaved?: (receipt: InventoryReceipt) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: InventoryReceiptInput) => {
      const { data } = await api.post<InventoryReceipt>('/inventory/receipts', payload);
      options.onSaved?.(data);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.inventory }),
  });
}

export function useDeleteInventoryReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/inventory/receipts/${encodeURIComponent(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.inventory }),
  });
}

// Quantities are numeric(12,3) on the server; adding them as floats here
// would print 20 + 0.1 as 20.100000000000001.
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * What is on the shelf now: what was delivered, minus what the sales took --
 * after the last count, when there is one.
 *
 * Never counted, the shelf started empty: what was delivered minus what was
 * sold, and 0 for a product that has not moved yet. Never "not counted":
 * the Inventario is joined to the Tienda so that stock keeps itself and
 * counts are as few as possible (Max, 28-sep-2026: «que se hagan la menor
 * cantidad de conteos de inventario posibles»). A product added with stock
 * already on the shelf says so when it is created, as a delivery; a count is
 * a correction, never what a figure waits for.
 *
 * It can be below zero: more sold than came in. That is a delivery nobody
 * entered, and it is returned as it is so the screen can say so.
 */
export function onHand(item: InventoryItem): number {
  const received = item.received_since_count ?? 0;
  const sold = item.sold_since_count ?? 0;
  return round3((item.last_quantity ?? 0) + received - sold);
}

/**
 * Where `onHand` comes from, for the line under it: the count (null when
 * there is none), what came in and what the sales took since. Null when the
 * figure is the count and nothing else, or when nothing has moved.
 */
export function onHandBreakdown(
  item: InventoryItem,
): { counted: number | null; received: number; sold: number } | null {
  const received = round3(item.received_since_count ?? 0);
  const sold = round3(item.sold_since_count ?? 0);
  if (received === 0 && sold === 0) return null;
  return { counted: item.last_quantity, received, sold };
}

/**
 * What went between the last two counts: what there was, plus what came in
 * between, minus what was left. Null with fewer than two counts.
 *
 * Negative means the second count found MORE than could be there -- a
 * delivery nobody entered, or a miscount. It is returned as it is, not
 * clamped to 0, so the screen can say so.
 *
 * It replaces the plain difference between the two counts, which read
 * "-24" as 24 sold and "+24" as nothing sold the moment a truck came.
 */
export function consumption(item: InventoryItem): number | null {
  if (item.last_quantity === null || item.previous_quantity === null) return null;
  // Two counts at the same instant (the forms cut to the minute) are one
  // moment, and "used between the 4th and the 4th" is not a figure.
  if (
    item.previous_counted_at !== null &&
    item.last_counted_at !== null &&
    new Date(item.previous_counted_at).getTime() === new Date(item.last_counted_at).getTime()
  ) {
    return null;
  }
  return round3(item.previous_quantity + (item.received_between_counts ?? 0) - item.last_quantity);
}

/**
 * What went between the last two counts, and how much of it the sales in
 * between explain. Null when `consumption` is.
 *
 * - `total`: `consumption`, what really went.
 * - `bySales`: what the sales between the counts took, by their recipes.
 * - `unexplained`: what went that no sale explains -- waste, portions larger
 *   than the recipe, something taken -- when there is any.
 * - `surplus`: the second count found more than the sales should have left:
 *   a delivery nobody entered, a recipe that asks for too much, a miscount.
 *   Without sales it is the "more than expected" of a negative `total`.
 */
export function consumptionBreakdown(
  item: InventoryItem,
): { total: number; bySales: number; unexplained: number; surplus: number } | null {
  const total = consumption(item);
  if (total === null) return null;
  const bySales = round3(item.sold_between_counts ?? 0);
  return {
    total,
    bySales,
    unexplained: round3(Math.max(0, total - bySales)),
    surplus: round3(Math.max(0, bySales - total)),
  };
}

/**
 * Below its minimum by what is on the shelf now, so a delivery takes it off
 * the list -- and a day's sales put it on -- without waiting for any count.
 * A product that has not moved yet has 0: with a minimum, it is low.
 */
export function isBelowMinimum(item: InventoryItem): boolean {
  return item.min_quantity !== null && onHand(item) < item.min_quantity;
}

/** The most a quantity can be (the server's limit, numeric(12,3) below 1e9). */
export const MAX_QUANTITY = 1e9;

/**
 * A quantity a delivery line (or one scan) can carry, as typed: above 0,
 * below MAX_QUANTITY, with at most 3 decimals -- what the server stores.
 * "12,5" or "12.5"; null for anything else, so the field can say so rather
 * than send a number the server rounds or refuses.
 */
export function parsePositiveQuantity(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value > 0 && value < MAX_QUANTITY ? value : null;
}

/**
 * A stock quantity for reading: up to 3 decimals, as the server keeps it
 * (12,125 kg of ham is not 12,13). `formatDecimal` stops at 2 because it is
 * also the payroll's, where 2 is right.
 *
 * Below zero with the minus sign (U+2212), not the hyphen Intl writes for
 * Spanish and English: the figures beside it write "− ventas 30" and
 * "− 0,75 kg", and "-30" next to them reads as a dash. What rounds to 0
 * carries no sign at all ("-0" is a rounding, not a shortage).
 */
export function formatQuantity(value: number): string {
  const text = new Intl.NumberFormat(APP_LOCALE, {
    maximumFractionDigits: 3,
    useGrouping: false,
  }).format(value);
  if (!text.startsWith('-')) return text;
  return /^-0([.,]0*)?$/.test(text) ? text.slice(1) : `−${text.slice(1)}`;
}

/** "12,5" or "12.5" as typed; null when blank or not a number. */
export function parseQuantity(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
