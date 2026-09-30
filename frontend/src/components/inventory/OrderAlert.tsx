// "Order from your supplier": the notice that lists what is below its
// minimum, one group per supplier, and hands each supplier's order to
// WhatsApp written out (Max, 27-sep-2026). What it lists, when it opens by
// itself and what the message says are decided in lib/inventory/orders.ts;
// this draws it.
//
// It opens:
//   - on ENTERING the inventory -- from another app, from the launcher, or a
//     page loaded there -- when something is below its minimum. Closed, it
//     does not come back that day for the same products; one that falls below
//     since brings it back (kept in this browser, per business);
//   - after a SALE, at the till or typed by hand, that left a product
//     critical (nothing left, or half its minimum or less): that product and
//     the others of its supplier that are low, for one order -- once the
//     dialog that recorded the sale has closed (never over it);
//   - from Stock's "Order" button, whenever the manager wants.
//
// Each line starts at the product's usual order and can be changed; a line
// left empty is not ordered. A supplier with a phone gets "Send by WhatsApp"
// (wa.me with the text written: the manager still presses send there); one
// without, "Copy order". Nothing is saved on the server: closing is "not
// now".
//
// It lives in the layout, not in a page: a sale's answer can arrive after the
// till has been left, and the notice is the inventory's, whichever app it
// opens over.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { formatQuantity, parsePositiveQuantity, useInventoryItems } from '../../api/inventory';
import type { StockAlert } from '../../api/store';
import { useAuth } from '../../auth/useAuth';
import { useWorkspaceApps } from '../../auth/useWorkspaceApps';
import { useCan } from '../../auth/useCan';
import { getErrorMessage } from '../../lib/api';
import { plural, useLanguage, useT } from '../../lib/i18n';
import { browserStorage } from '../../lib/inventory/receiveDraft';
import { MODAL_SELECTOR } from '../schedule/calendarKeys';
import {
  AFTER_SALE,
  afterSaleStep,
  copyText,
  forgetRestocked,
  groupBySupplier,
  lowStockLines,
  orderText,
  readDismissal,
  readOrder,
  saleAlertLines,
  saveDismissal,
  shouldOpenOnEntry,
  startingQuantity,
  whatsappLink,
  whatsappNumber,
  withDismissed,
  type OrderGroup,
} from '../../lib/inventory/orders';
import { APP_LOCALE } from '../../lib/locale';
import { isoDay } from '../../lib/store/period';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { FIELD_SKIN, fieldTone } from '../Input';
import { Modal } from '../Modal';
import { useLastShown } from '../motion/useDialogMotion';
import { SquarePhoto } from '../photo/SquarePhoto';
import { Spinner, StateMessage } from '../StateMessage';
import {
  cameFromOrders,
  OrderAlertContext,
  type FromOrders,
  type OrderAlertApi,
  type OrderAlertRequest,
} from './orderAlertContext';

/** Whether a modal dialog holds the page: the form or the charge a sale was recorded in, say. */
function modalOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector(MODAL_SELECTOR) !== null;
}

/** Button looks for a link: the primary's, as Button draws it. */
const LINK_BUTTON =
  'm-press m-btn-glow inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300';

/**
 * The notice and the way into it, for everything under the layout. With
 * `watchEntry` -- the inventory app is the one open -- it checks, once each
 * time the app is entered, whether to open by itself.
 */
export function OrderAlertProvider({ children, watchEntry }: { children: ReactNode; watchEntry: boolean }) {
  const { user } = useAuth();
  const orgId = user?.org_id ?? null;
  const [request, setRequest] = useState<OrderAlertRequest | null>(null);
  const shown = useLastShown(request);
  // Every opening gets a fresh notice (the key): its quantities start from
  // the products', not from what was typed into the last one.
  const [openings, setOpenings] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const api = useMemo<OrderAlertApi>(
    () => ({
      open: (next) => {
        window.clearTimeout(timer.current);
        setRequest(next);
        setOpenings((n) => n + 1);
      },
      // Not over the dialog the sale was recorded in: TanStack closes it only
      // after the lists have come back, which can take seconds. It looks at
      // the page until no modal has been open for a moment (AFTER_SALE).
      afterSale: (alerts: StockAlert[]) => {
        if (!alerts.some((a) => a.became_critical)) return;
        window.clearTimeout(timer.current);
        const start = Date.now();
        let lastModal: number | null = null;
        const look = () => {
          const elapsed = Date.now() - start;
          const busy = modalOpen();
          if (busy) lastModal = elapsed;
          const step = afterSaleStep(elapsed, lastModal, busy);
          if (step === 'wait') {
            timer.current = window.setTimeout(look, AFTER_SALE.everyMs);
          } else if (step === 'open') {
            setRequest({ kind: 'sale', alerts });
            setOpenings((n) => n + 1);
          }
        };
        timer.current = window.setTimeout(look, AFTER_SALE.everyMs);
      },
      sawStock: (items) => {
        if (!orgId) return;
        const low = lowStockLines(items).map((l) => l.item_id);
        forgetRestocked(browserStorage(), orgId, low, isoDay(new Date()));
      },
    }),
    [orgId],
  );

  // Whatever it showed, closed: not again today for those products.
  const close = useCallback(
    (ids: string[]) => {
      if (orgId) {
        const storage = browserStorage();
        saveDismissal(storage, orgId, withDismissed(readDismissal(storage, orgId), ids, isoDay(new Date())));
      }
      setRequest(null);
    },
    [orgId],
  );

  const openOnEntry = useCallback(() => api.open({ kind: 'entry' }), [api]);

  return (
    <OrderAlertContext.Provider value={api}>
      {children}
      {watchEntry && orgId && <LowStockOnEntry orgId={orgId} onOpen={openOnEntry} />}
      {shown !== null && <OrderNotice key={openings} open={request !== null} request={shown} onClose={close} />}
    </OrderAlertContext.Provider>
  );
}

/**
 * Mounted while the inventory app is open, so it mounts once each time the
 * app is entered: it waits for the products -- fetched afresh, not as a cache
 * from before the day's sales left them -- and opens the notice if there is
 * something below its minimum not closed today.
 */
function LowStockOnEntry({ orgId, onOpen }: { orgId: string; onOpen: () => void }) {
  const location = useLocation();
  // Sent here by the notice itself, to put something right: not an entry.
  const [sentByNotice] = useState(() => cameFromOrders(location.state));
  const items = useInventoryItems(false, !sentByNotice);
  const checked = useRef(sentByNotice);
  const ready = items.isSuccess && !items.isFetching;
  useEffect(() => {
    if (checked.current || !ready || !items.data) return;
    checked.current = true;
    const low = lowStockLines(items.data).map((l) => l.item_id);
    const today = isoDay(new Date());
    // What was restocked since it was closed leaves the list first: if it
    // is low again, that is news.
    if (shouldOpenOnEntry(low, forgetRestocked(browserStorage(), orgId, low, today), today)) onOpen();
  }, [ready, items.data, orgId, onOpen]);
  return null;
}

function OrderNotice({
  open,
  request,
  onClose,
}: {
  open: boolean;
  request: OrderAlertRequest;
  onClose: (ids: string[]) => void;
}) {
  const t = useT();
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const hasInventory = useWorkspaceApps().includes('inventory');
  const items = useInventoryItems(false, hasInventory);
  // The two ways to put a line right lead to pages that change things: giving
  // a product its supplier is editing the product, adding a phone is editing
  // the supplier. Each only for whoever may (lib/access.ts); the order itself
  // -- WhatsApp, or copied -- is everybody's.
  const allow = useCan();
  const canAssign = hasInventory && allow('inventory.products');
  const canAddPhone = hasInventory && allow('inventory.suppliers');

  const lines = useMemo(
    () =>
      request.kind === 'sale'
        ? (saleAlertLines(request.alerts, items.data) ?? [])
        : lowStockLines(items.data ?? []),
    [request, items.data],
  );
  // Read while rendering: the order of the names follows the language.
  const locale = APP_LOCALE;
  const groups = useMemo(() => groupBySupplier(lines, locale), [lines, locale]);

  // What was typed, by product; untouched lines show their usual order.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const byId = useMemo(() => new Map(lines.map((l) => [l.item_id, l])), [lines]);
  const textOf = (itemId: string) => {
    const line = byId.get(itemId);
    return typed[itemId] ?? (line ? startingQuantity(line, formatQuantity) : '');
  };

  const ids = lines.map((l) => l.item_id);
  const close = () => onClose(ids);
  // Off to put something right: the notice closes, and the page it goes to
  // knows not to open it again on arrival.
  const leave = (to: string, state: FromOrders) => {
    onClose(ids);
    navigate(to, { state });
  };

  const intro =
    request.kind === 'sale'
      ? (() => {
          const names = request.alerts.filter((a) => a.became_critical).map((a) => a.name);
          return t(names.length === 1 ? 'orders.intro.sale.one' : 'orders.intro.sale.other', { names: names.join(', ') });
        })()
      : plural(lines.length, 'orders.intro.low.one', 'orders.intro.low.other');

  const waiting = request.kind !== 'sale' && items.isLoading;
  const failed = request.kind !== 'sale' && items.isError && !items.data;

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('orders.title')}
      footer={
        <Button variant="secondary" className="min-h-11" onClick={close}>
          {t('orders.later')}
        </Button>
      }
    >
      <div className="space-y-4">
        {waiting ? (
          <Spinner />
        ) : failed ? (
          <StateMessage tone="error" title={t('orders.loadError')} description={getErrorMessage(items.error)} />
        ) : lines.length === 0 ? (
          <p className="text-sm text-gray-700">{t('orders.empty')}</p>
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-900">{intro}</p>
              <p className="text-sm text-gray-600">{t('orders.intro.send')}</p>
              <p className="text-xs text-gray-500">{t('orders.criticalHelp')}</p>
            </div>
            {groups.map((group) => (
              <GroupCard
                key={group.supplier?.id ?? ''}
                group={group}
                business={user?.org_name ?? ''}
                language={language}
                textOf={textOf}
                onText={(itemId, text) => setTyped((prev) => ({ ...prev, [itemId]: text }))}
                canAssign={canAssign}
                canAddPhone={canAddPhone}
                onAssign={(itemId) => leave('/inventory', { fromOrders: true, editItem: itemId })}
                onAddPhone={() => leave('/inventory/suppliers', { fromOrders: true })}
              />
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}

/** "2 kg", or "2" for a product counted in plain units. */
function withUnit(quantity: number | null, unit: string | null): string {
  if (quantity === null) return '—';
  return unit ? `${formatQuantity(quantity)} ${unit}` : formatQuantity(quantity);
}

/**
 * The old way of copying, for a page the Clipboard API refuses: a field off
 * screen, selected, and "copy". Focus goes back where it was: the dialog
 * keeps it.
 */
function copyWithSelection(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand('copy');
  } finally {
    field.remove();
    before?.focus({ preventScroll: true });
  }
}

function GroupCard({
  group,
  business,
  language,
  textOf,
  onText,
  canAssign,
  canAddPhone,
  onAssign,
  onAddPhone,
}: {
  group: OrderGroup;
  business: string;
  language: 'es' | 'en';
  textOf: (itemId: string) => string;
  onText: (itemId: string, text: string) => void;
  /** "Choose a supplier": opens the product's form, so only with `inventory.products`. */
  canAssign: boolean;
  /** "Add their phone": opens Suppliers to edit it, so only with `inventory.suppliers`. */
  canAddPhone: boolean;
  onAssign: (itemId: string) => void;
  onAddPhone: () => void;
}) {
  const t = useT();
  const ids = useId();
  const supplier = group.supplier;
  const name = supplier?.name ?? t('orders.noSupplier');
  const read = readOrder(group.lines, textOf);
  const text = orderText({ supplier: supplier?.name ?? null, business, lines: read.send, language });
  const number = whatsappNumber(supplier?.phone);
  // What stops the order from going: a quantity that is not one, or none at all.
  const blocked = read.invalid > 0 ? 'fix' : read.send.length === 0 ? 'nothing' : null;
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const manual = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (copied === 'failed') manual.current?.select();
  }, [copied]);

  const copy = async () => {
    const ok = await copyText(text, {
      clipboard: typeof navigator !== 'undefined' ? navigator.clipboard : null,
      fallback: copyWithSelection,
    });
    setCopied(ok ? 'yes' : 'failed');
  };

  const reasonId = `${ids}-reason`;
  const headingId = `${ids}-title`;

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 id={headingId} className="break-words text-sm font-semibold text-gray-900">
          {name}
        </h3>
        {supplier?.phone && <p className="text-xs tabular-nums text-gray-500">{supplier.phone}</p>}
      </div>

      <ul className="mt-1 divide-y divide-white/[0.06]">
        {group.lines.map((line) => {
          const value = textOf(line.item_id);
          const bad = value.trim() !== '' && parsePositiveQuantity(value) === null;
          const inputId = `${ids}-q-${line.item_id}`;
          const unitId = `${inputId}-unit`;
          const hintId = `${inputId}-hint`;
          return (
            <li key={line.item_id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex min-w-0 flex-1 basis-44 items-center gap-3">
                  <SquarePhoto name={line.name} url={line.photo_url} size="row" alt="" />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-gray-900">{line.name}</p>
                    <p className="text-xs tabular-nums text-gray-500">
                      {t('orders.line.stock', {
                        onHand: withUnit(line.on_hand, line.unit),
                        min: withUnit(line.min_quantity, line.unit),
                      })}
                    </p>
                    {/* Critical or only low, in words: never the colour alone. */}
                    <span className="mt-1 inline-block">
                      <Badge tone={line.critical ? 'red' : 'amber'}>
                        {t(line.critical ? 'orders.status.critical' : 'orders.status.low')}
                      </Badge>
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Named "Order Pollo": the word shown, then whose. */}
                  <label htmlFor={inputId} className="text-sm text-gray-700">
                    {t('orders.line.quantity')}
                    <span className="sr-only"> {line.name}</span>
                  </label>
                  <input
                    id={inputId}
                    value={value}
                    onChange={(e) => onText(line.item_id, e.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={12}
                    aria-invalid={bad || undefined}
                    aria-describedby={[line.unit ? unitId : null, bad ? hintId : null].filter(Boolean).join(' ') || undefined}
                    // 16 px: a smaller field makes iOS zoom the page in on focus.
                    className={`${FIELD_SKIN} ${fieldTone(bad)} min-h-11 w-20 rounded-xl px-3 py-2 text-right text-base tabular-nums`}
                  />
                  <span id={line.unit ? unitId : undefined} className="w-14 truncate text-xs text-gray-500">
                    {line.unit ?? ''}
                  </span>
                </div>
              </div>
              {bad && (
                <p id={hintId} className="mt-1 text-xs font-medium text-red-300">
                  {t('orders.line.invalid')}
                </p>
              )}
              {/* Named after what it says, then whose (WCAG 2.5.3): it opens
                  the product's form on Stock, where its supplier is chosen. */}
              {supplier === null && canAssign && (
                <button
                  type="button"
                  onClick={() => onAssign(line.item_id)}
                  aria-label={t('orders.line.assignLabel', { name: line.name })}
                  className="mt-1 min-h-11 rounded-lg px-2 text-sm font-medium text-brand-700 underline-offset-2 hover:bg-white/[0.06] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
                >
                  {t('orders.line.assign')}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {supplier !== null && number === null && (
        <p className="mt-2 text-xs text-gray-500">
          {t('orders.noPhone')}{' '}
          {canAddPhone && (
            <Link
              to="/inventory/suppliers"
              state={{ fromOrders: true } satisfies FromOrders}
              onClick={(e) => {
                e.preventDefault();
                onAddPhone();
              }}
              className="rounded font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
            >
              {t('orders.addPhone')}
            </Link>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {number !== null &&
          (blocked ? (
            // Seen to be off: grey and dashed, not the primary's green at
            // half strength, which still read as "press me". Why, just below.
            <Button
              variant="secondary"
              className="min-h-11 disabled:border-dashed disabled:text-gray-500"
              disabled
              aria-describedby={reasonId}
            >
              <ChatIcon />
              {t('orders.whatsapp')}
            </Button>
          ) : (
            // A link, not a button: it opens WhatsApp (the app on a phone),
            // with the message written; the manager still presses send there.
            <a href={whatsappLink(number, text)} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
              <ChatIcon />
              {t('orders.whatsapp')}
              <span className="sr-only"> {t('orders.whatsappTo', { supplier: name })}</span>
            </a>
          ))}
        <Button
          variant={number !== null ? 'ghost' : 'secondary'}
          // Off, it has to look it beside the same button on: dimmer, dashed.
          className="min-h-11 disabled:border-dashed disabled:text-gray-400"
          disabled={blocked !== null}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={() => void copy()}
        >
          {t('orders.copy')}
          {supplier && <span className="sr-only"> {t('orders.copyFor', { supplier: name })}</span>}
        </Button>
      </div>
      {blocked ? (
        <p id={reasonId} className="mt-2 text-xs text-gray-500">
          {t(blocked === 'fix' ? 'orders.group.fix' : 'orders.group.nothing')}
        </p>
      ) : (
        read.blank > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            {plural(read.blank, 'orders.group.blank.one', 'orders.group.blank.other')}
          </p>
        )
      )}
      <p role="status" className={copied === 'yes' ? 'mt-2 text-xs font-medium text-brand-700' : 'sr-only'}>
        {copied === 'yes' ? t('orders.copied') : ''}
      </p>
      {copied === 'failed' && (
        <div className="mt-2 space-y-1">
          <p className="text-xs font-medium text-amber-800">{t('orders.copyFailed')}</p>
          <textarea
            ref={manual}
            readOnly
            value={text}
            rows={Math.min(8, read.send.length + 2)}
            aria-label={t('orders.copyField')}
            className={`${FIELD_SKIN} ${fieldTone(false)} w-full rounded-xl px-3 py-2 font-mono text-xs`}
          />
        </div>
      )}
    </section>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4 shrink-0">
      <path d="M10 3.2c-3.8 0-6.8 2.7-6.8 6 0 1.3.5 2.5 1.3 3.5L3.8 16.4l3.9-1.2c.7.3 1.5.4 2.3.4 3.8 0 6.8-2.7 6.8-6s-3-6.4-6.8-6.4Z" />
    </svg>
  );
}
