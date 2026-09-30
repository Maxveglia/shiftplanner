// The shop (Tienda): the sales the manager records -- by hand, or charged from
// the till on the Menu page -- and the statistics the server adds up from
// them. Managers only -- the server answers anybody else with a 403, and the
// team's app has no way to ask.
//
// A sale is a day (no time, no zone: `sold_on`), an optional note, and its
// lines. A line is a dish of the menu, with the name and price it had when it
// was sold copied onto it, or a free line ("Caja del día", 850 €). What a
// line comes to and what the sale comes to are the server's sums; the form
// shows its own running total while it is typed (lib/store/sale.ts), and the
// server's is the one saved.
//
// A sale is never deleted and never edited. One made by mistake is VOIDED
// (`useVoidStoreSale`): it stays, marked with when, by whom and why, and the
// statistics leave it out. A till that records sales is a billing system in
// the eyes of the anti-fraud law, and a record that can be rubbed out is the
// one thing such a system may not have.
//
// Every answer passes through `normalize*` on its way in. Money is a JSON
// number by contract, but a Decimal column serialised by a framework default
// arrives as the string "12.50" -- and "12.50" + "3.00" is "12.503.00". The
// normalisers turn either into a number once, here, so no screen can add two
// strings; and they fill the statistics' calendar, so a chart never meets a
// missing day.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InventorySupplier } from './inventory';
import { api } from '../lib/api';
import { daysBetween } from '../lib/store/period';
import { keptAsSent } from '../lib/store/sale';
import { cleanVoidReason } from '../lib/store/void';
import { queryKeys } from './keys';

/**
 * How a sale was paid. Only a till sale says: a sale typed by hand is a day's
 * figure, not a payment, and has none. 'card' is the card reader, confirmed
 * by hand for now (the reader itself is not connected yet).
 */
export type PaymentMethod = 'cash' | 'card';

/** Where a sale came from: typed on Sales ('manual') or charged on the Menu ('till'). */
export type SaleSource = 'manual' | 'till';

/** What says a sale was voided, the same on the list and on its page. */
export interface SaleVoid {
  /** When it was voided (an instant, ISO), or null: it stands. */
  voided_at: string | null;
  /** Why, as the manager wrote it, or null. */
  void_reason: string | null;
}

/** A sale as the list shows it -- voided ones too, marked. */
export interface StoreSaleSummary extends SaleVoid {
  id: string;
  /** YYYY-MM-DD. */
  sold_on: string;
  note: string | null;
  total: number;
  line_count: number;
  created_at: string;
  payment_method: PaymentMethod | null;
  source: SaleSource;
}

export interface StoreSaleLine {
  id: string;
  /** The dish it was, or null for a free line (or a dish deleted since). */
  dish_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  /** unit_price × quantity, to the cent, as the server worked it out. */
  amount: number;
}

export interface StoreSale extends SaleVoid {
  id: string;
  sold_on: string;
  note: string | null;
  total: number;
  created_at: string;
  payment_method: PaymentMethod | null;
  source: SaleSource;
  /**
   * Who saved it -- charged it at the till, or typed it in -- as their login
   * was named then (a person's name, or a tablet's: "Tablet barra"), kept
   * when that login is deleted; null only for a sale whose login was gone
   * before the server kept the name. Absent from a server a release behind,
   * which did not say: then nothing is said (lib/store/void.ts,
   * recordedBySentence).
   */
  created_by_name?: string | null;
  /**
   * Who voided it, as their account is named now; null for a sale that
   * stands, and for one whose voider's account is gone (it still says when
   * and why).
   */
  voided_by_name: string | null;
  lines: StoreSaleLine[];
}

export interface StoreSaleInput {
  sold_on: string;
  note?: string | null;
  /** Left out for a sale typed by hand; 'cash' or 'card' for one charged at the till. */
  payment_method?: PaymentMethod | null;
  /** 'manual' when left out; 'till' from the Menu's bill. */
  source?: SaleSource;
  /**
   * The form's id for this sale (a UUID), the same on every attempt to save
   * it. The server answers a ref it has already saved with that sale (200)
   * instead of saving it twice -- the double tap, and the save whose answer
   * was lost on the way back.
   */
  client_ref: string;
  lines: { dish_id?: string | null; name: string; unit_price: number; quantity: number }[];
}

export interface StoreStats {
  from: string;
  to: string;
  total: number;
  sales_count: number;
  days_with_sales: number;
  average_per_day: number;
  /** Every day of the window, in order, 0 where nothing was sold. */
  days: { date: string; total: number }[];
  /** Monday (0) to Sunday (6), all seven. */
  by_weekday: { weekday: number; total: number }[];
  /** At most ten, by takings, highest first. */
  top_dishes: { name: string; dish_id: string | null; quantity: number; total: number }[];
}

/**
 * A product of the inventory that a sale just saved has left below its
 * minimum (`POST /store/sales`, `stock_alerts`): only products the sale took
 * something of, as they stand after it.
 *
 * `critical` is how the server calls "very low": nothing left, or half the
 * minimum or less. `became_critical` is that THIS sale took it there -- the
 * one thing the till interrupts the manager for; a product already critical
 * before it is not news at every sale.
 */
export interface StockAlert {
  item_id: string;
  name: string;
  unit: string | null;
  on_hand: number;
  min_quantity: number;
  critical: boolean;
  became_critical: boolean;
  supplier: InventorySupplier | null;
  order_quantity: number | null;
  photo_url: string | null;
}

/** The most sales one list answer carries; the rest are older. */
export const SALES_PAGE_LIMIT = 500;

/** The server's bound on why a sale was voided. */
export const MAX_VOID_REASON = 200;

/** Whether a sale was voided: it is kept, and counts for nothing. */
export function isVoided(sale: SaleVoid): boolean {
  return sale.voided_at !== null;
}

// --- Reading the wire ---------------------------------------------------------

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw {
  return value !== null && typeof value === 'object' ? (value as Raw) : {};
}

/** A number from a JSON number or a numeric string; 0 for anything else. */
export function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Money to the cent, without the float noise a sum of strings would leave. */
function money(value: unknown): number {
  return Math.round(toNumber(value) * 100) / 100;
}

function quantity(value: unknown): number {
  return Math.round(toNumber(value) * 1000) / 1000;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A method this app knows, or none: an unknown one is not shown as cash. */
function paymentMethod(value: unknown): PaymentMethod | null {
  return value === 'cash' || value === 'card' ? value : null;
}

/** 'till' or else 'manual', the column's default, which every older sale is. */
function saleSource(value: unknown): SaleSource {
  return value === 'till' ? 'till' : 'manual';
}

function saleVoid(r: Raw): SaleVoid {
  return { voided_at: textOrNull(r.voided_at), void_reason: textOrNull(r.void_reason) };
}

export function normalizeSaleSummary(raw: unknown): StoreSaleSummary {
  const r = asRecord(raw);
  return {
    id: text(r.id),
    sold_on: text(r.sold_on),
    note: textOrNull(r.note),
    total: money(r.total),
    line_count: Math.max(0, Math.round(toNumber(r.line_count))),
    created_at: text(r.created_at),
    payment_method: paymentMethod(r.payment_method),
    source: saleSource(r.source),
    ...saleVoid(r),
  };
}

export function normalizeSale(raw: unknown): StoreSale {
  const r = asRecord(raw);
  const lines = Array.isArray(r.lines) ? r.lines : [];
  const voided = saleVoid(r);
  return {
    id: text(r.id),
    sold_on: text(r.sold_on),
    note: textOrNull(r.note),
    total: money(r.total),
    created_at: text(r.created_at),
    payment_method: paymentMethod(r.payment_method),
    source: saleSource(r.source),
    // Only when the server said: missing is "not said", not "gone".
    ...('created_by_name' in r ? { created_by_name: textOrNull(r.created_by_name) } : {}),
    ...voided,
    // Who voided a sale that stands is nobody, whatever else came along.
    voided_by_name: voided.voided_at ? textOrNull(r.voided_by_name) : null,
    lines: lines.map((l) => {
      const line = asRecord(l);
      return {
        id: text(line.id),
        dish_id: textOrNull(line.dish_id),
        name: text(line.name),
        unit_price: money(line.unit_price),
        quantity: quantity(line.quantity),
        amount: money(line.amount),
      };
    }),
  };
}

function supplier(value: unknown): InventorySupplier | null {
  if (value === null || typeof value !== 'object') return null;
  const r = value as Raw;
  const id = textOrNull(r.id);
  return id ? { id, name: text(r.name), phone: textOrNull(r.phone) } : null;
}

/**
 * The `stock_alerts` of a sale's answer. Anything that is not a list -- a
 * server older than the field -- is none; an entry without a product is
 * dropped. Quantities as numbers, whichever way they came.
 */
export function normalizeStockAlerts(raw: unknown): StockAlert[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => {
      const r = asRecord(a);
      return {
        item_id: text(r.item_id),
        name: text(r.name),
        unit: textOrNull(r.unit),
        on_hand: quantity(r.on_hand),
        min_quantity: quantity(r.min_quantity),
        critical: r.critical === true,
        became_critical: r.became_critical === true,
        supplier: supplier(r.supplier),
        order_quantity: r.order_quantity === null || r.order_quantity === undefined ? null : quantity(r.order_quantity),
        photo_url: textOrNull(r.photo_url),
      };
    })
    .filter((a) => a.item_id !== '');
}

export function normalizeStats(raw: unknown): StoreStats {
  const r = asRecord(raw);
  const from = text(r.from);
  const to = text(r.to);

  // The calendar is rebuilt from the window rather than trusted as sent: a
  // day missing from the answer is a day with no sales, and a chart whose
  // bars skipped it would put Tuesday where Wednesday is.
  const sent = new Map<string, number>();
  for (const d of Array.isArray(r.days) ? r.days : []) {
    const day = asRecord(d);
    const date = text(day.date);
    sent.set(date, money((sent.get(date) ?? 0) + toNumber(day.total)));
  }
  const calendar = daysBetween(from, to);
  const days = (calendar.length > 0 ? calendar : [...sent.keys()].sort()).map((date) => ({
    date,
    total: sent.get(date) ?? 0,
  }));

  const weekdays = new Array<number>(7).fill(0);
  for (const w of Array.isArray(r.by_weekday) ? r.by_weekday : []) {
    const entry = asRecord(w);
    const weekday = Math.round(toNumber(entry.weekday));
    if (weekday >= 0 && weekday <= 6) weekdays[weekday] = money(weekdays[weekday] + toNumber(entry.total));
  }

  return {
    from,
    to,
    total: money(r.total),
    sales_count: Math.max(0, Math.round(toNumber(r.sales_count))),
    days_with_sales: Math.max(0, Math.round(toNumber(r.days_with_sales))),
    average_per_day: money(r.average_per_day),
    days,
    by_weekday: weekdays.map((total, weekday) => ({ weekday, total })),
    top_dishes: (Array.isArray(r.top_dishes) ? r.top_dishes : []).map((d) => {
      const dish = asRecord(d);
      return {
        name: text(dish.name),
        dish_id: textOrNull(dish.dish_id),
        quantity: quantity(dish.quantity),
        total: money(dish.total),
      };
    }),
  };
}

// --- Hooks ----------------------------------------------------------------------

/**
 * The sales of a window, newest first. Changing the window keeps the last
 * list on screen until the new one arrives, rather than blanking the page
 * into a spinner at every press of 7 / 30 / 90.
 */
export function useStoreSales(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.storeSales(from, to),
    queryFn: async () => {
      const { data } = await api.get<unknown>('/store/sales', { params: { from, to } });
      return (Array.isArray(data) ? data : []).map(normalizeSaleSummary);
    },
    placeholderData: keepPreviousData,
  });
}

export function useStoreSale(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.storeSale(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await api.get<unknown>(`/store/sales/${encodeURIComponent(id!)}`);
      return normalizeSale(data);
    },
  });
}

export function useStoreStats(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.storeStats(from, to),
    queryFn: async () => {
      const { data } = await api.get<unknown>('/store/stats', { params: { from, to } });
      return normalizeStats(data);
    },
    placeholderData: keepPreviousData,
  });
}

/** What a save came back with. */
export interface StoreSaleSaved {
  sale: StoreSale;
  /**
   * Whether `sale` is the sale that was sent. Not when its ref had been saved
   * before -- a first try whose answer was lost -- and the form was changed
   * since: the server answers a ref it knows with the sale it KEPT (200), and
   * the changes are not in it (lib/store/sale.ts, keptAsSent).
   */
  asSent: boolean;
  /** The products this sale left below their minimum (StockAlert); none from an older server. */
  stockAlerts: StockAlert[];
}

/**
 * `onSaved` runs inside the mutation, the moment the server has the sale that
 * was sent -- not in a callback passed to `mutate()`, which TanStack skips
 * once the component that called it is gone (the manager went to Statistics
 * with the save on its way). That is where the form's draft is settled:
 * skipped, the saved sale would come back as a draft the next time the form
 * opened. It does not run for an older sale answered under the same ref
 * (`asSent` false): that draft holds what the server does not have -- or
 * may, in a way only the caller can tell (the till's bill recorded as cash
 * and retried as card is recorded all the same). `onKept` runs, in the same
 * place and for the same reason, for that older sale.
 */
export function useCreateStoreSale(
  options: {
    onSaved?: (sale: StoreSale, sent: StoreSaleInput) => void;
    onKept?: (sale: StoreSale, sent: StoreSaleInput) => void;
    /**
     * The products the sale that was sent left below their minimum, when
     * there are any: where the "order from your supplier" notice is opened
     * from (components/inventory/OrderAlert.tsx). Here and not in a callback
     * to `mutate()` for the reason `onSaved` is: the till may be gone by the
     * time the answer comes, and the notice is not the till's.
     */
    onStockAlerts?: (alerts: StockAlert[]) => void;
  } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: StoreSaleInput): Promise<StoreSaleSaved> => {
      const { data, status } = await api.post<unknown>('/store/sales', payload);
      const sale = normalizeSale(data);
      const stockAlerts = normalizeStockAlerts(asRecord(data).stock_alerts);
      // A 201 is a sale made from this very request. Anything else is one kept
      // earlier under the ref, and only its contents say whether it is this one
      // (a voided one never is: keptAsSent).
      const asSent = status === 201 || keptAsSent(payload, sale);
      if (asSent) options.onSaved?.(sale, payload);
      else options.onKept?.(sale, payload);
      // Only for the sale that was sent: an older one answered under the ref
      // took its stock when it was recorded, not now.
      if (asSent && stockAlerts.length > 0) options.onStockAlerts?.(stockAlerts);
      return { sale, asSent, stockAlerts };
    },
    // Either way the list is refetched: a sale kept by a try whose answer was
    // lost is in it now. And the stock: a sale takes its recipe's ingredients
    // off it, and Stock would otherwise show the shelf from before it.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.store }),
        qc.invalidateQueries({ queryKey: queryKeys.inventory }),
      ]),
  });
}

/**
 * Voids a sale: POST /store/sales/{id}/void with an optional reason. The
 * answer is the sale as it now stands -- voided, with when, by whom and why --
 * and goes straight into its page's cache, so the page shows it at once; the
 * lists, the statistics and the stock are refetched, since a voided sale no
 * longer adds up nor takes its recipe's ingredients off the shelf. A sale
 * already voided (another tab, another manager) is a 409
 * `store_sale_already_voided`: the sale is refetched then too, so the page
 * shows who got there first rather than a button that can only fail again.
 */
export function useVoidStoreSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string | null }): Promise<StoreSale> => {
      const why = cleanVoidReason(reason);
      const { data } = await api.post<unknown>(`/store/sales/${encodeURIComponent(id)}/void`, why ? { reason: why } : {});
      return normalizeSale(data);
    },
    onSuccess: (sale, { id }) => {
      qc.setQueryData(queryKeys.storeSale(id), sale);
      // What it took from the stock goes back: a voided sale no longer counts.
      return Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.store }),
        qc.invalidateQueries({ queryKey: queryKeys.inventory }),
      ]);
    },
    // Voided elsewhere, most likely: the stock of this tab is from before too.
    onError: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.store }),
        qc.invalidateQueries({ queryKey: queryKeys.inventory }),
      ]),
  });
}
