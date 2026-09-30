// Charging the bill: the total, cash or card, and the one press that records
// it as a sale of the day (source 'till', lib/store/ticket.ts).
//
// Cash asks, optionally, what was handed over, and says the change -- or what
// is still missing, which stops the charge until it is corrected or left
// empty. Card is the card reader, confirmed by hand: the reader is not
// connected yet, and the one place it will be is `takeCardPayment` below.
//
// Recorded once, whatever the thumb does: a ref shuts the door before anything
// renders (two taps in one tick would both pass a button disabled only on the
// next render), and the bill's `clientRef` -- stored with the bill before the
// request leaves -- makes a retry return the sale already recorded. A failure
// leaves the bill as it was, the same ref with it, for the next try. The
// answer is checked against what was sent (keptAsSent, as "New sale" does),
// and what differs decides (lib/store/ticket.ts, tillAnswer): a first try
// recorded with its answer lost, then a water added, comes back as the sale
// WITHOUT the water -- the bill stays, takes a new ref, and the dialog says
// so; the same bill recorded as cash and retried as card is recorded all the
// same -- the bill is done, and the note says how to put the method right
// (void it, charge it again), never "charge it again" over a sale that
// stands; one voided since is not a charge, and the bill stays.
//
// Nor is anything charged at a price the manager has not seen: lines the menu
// changed under (deleted, sold out, repriced; TillTicket.tsx) stop the charge
// until they are updated, taken off or kept as they are. A change the screen
// had not heard of yet reaches it as the server's refusal (a dish gone, a
// price moved; lib/store/ticket.ts, menuRefusalKey): the menu is fetched
// again, the lines that changed are marked, and the dialog says what to do.
//
// Nothing here is for the customer's eyes (decided with Max, 27-sep-2026): no
// ticket, no printing, no "pre-bill". The total is large because the manager
// reads it off to the customer, not because the screen is turned round.
//
// The controller (`useTillCharge`) is apart from what it shows, because the
// charge is shown in two places: in its own dialog beside the wide screen's
// bill (ChargeDialog), and inside the narrow screen's sheet, which turns from
// the bill into the charge and back (TillTicket.tsx) -- one dialog with new
// content, never a second one over the first.

import { isAxiosError } from 'axios';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCreateStoreSale, type PaymentMethod, type StoreSale } from '../../api/store';
import { useCan } from '../../auth/useCan';
import { errorCode, getErrorMessage } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { browserStorage } from '../../lib/inventory/receiveDraft';
import { useMenu } from '../../lib/menu/api';
import { isoDay } from '../../lib/store/period';
import { detachMissingDishes } from '../../lib/store/sale';
import {
  cardApproved,
  cashChange,
  chargeProblem,
  menuRefusalAnswered,
  menuRefusalKey,
  ticketCount,
  ticketTotalCents,
  tillAnswer,
  tillPayload,
  type CashCheck,
  type ChargeProblem,
  type Ticket,
} from '../../lib/store/ticket';
import { clearTillDraft } from '../../lib/store/tillDraft';
import { Button } from '../Button';
import { FIELD_SKIN, fieldTone } from '../Input';
import { useOrderAlert } from '../inventory/orderAlertContext';
import { Modal } from '../Modal';
import { PaymentMethodIcon } from './PaymentMethodLabel';
import { useSaleDraftScope } from './SaleFormModal';

// --- The card reader ------------------------------------------------------------

type CardPayment = { approved: true; by: 'hand' } | { approved: false };

/**
 * THE CARD READER -- the one place a card payment is taken.
 *
 * Today no reader is connected: "Card" means the manager has charged the
 * amount on the shop's card reader by hand, and pressing "Confirm charge" is
 * saying it was approved. So this only answers yes, and the sale is recorded.
 *
 * When the SumUp reader is connected, this is where it is asked to charge
 * `amountCents`, with `clientRef` as the reference that ties the payment to
 * the sale, and awaited: approved goes on to record the sale (its payment id
 * would travel with it); declined, cancelled on the reader or timed out comes
 * back `{ approved: false }`, and the bill stays as it is, nothing recorded.
 *
 * It is asked once per bill and amount. An approval is kept with the bill,
 * in the browser too, before the sale's request leaves (ticket.ts,
 * cardApproval; `onCardApproved` below), and a retry of the same bill -- the
 * answer lost, the network down, the tab killed -- goes straight to recording
 * it without coming here. An approval moves with the bill to a new ref
 * (renewTicketRef). What is NOT settled, and has to be before a real reader is
 * wired: a bill changed after its approval (another amount) comes here again
 * for the whole amount -- it should charge the difference, or refund first;
 * and a card approved for a bill the server already had as cash
 * ('other_method') is left to the manager, who voids the cash sale and
 * charges again -- the reader would then take the card a second time. Before
 * any of that (decided with Max, 27-sep-2026): the law on invoicing software
 * (Veri*factu) has to be settled first, since a till that takes cards is one;
 * and no call to SumUp is made from anywhere until then.
 */
async function takeCardPayment(charge: { amountCents: number; clientRef: string }): Promise<CardPayment> {
  void charge;
  return { approved: true, by: 'hand' };
}

// --- The controller ---------------------------------------------------------------

/** A bill charged and recorded. */
export interface Charged {
  saleId: string;
  totalCents: number;
  /** How it is recorded. */
  method: PaymentMethod;
  /** How the manager said it was paid this time, when the sale was recorded the other way. */
  paidWith?: PaymentMethod;
  /** The ref it was charged under: the bill to replace with a new one. */
  clientRef: string;
}

/** A sale the server already had under the bill's ref, which is not this bill. */
export interface KeptEarlier {
  sale: StoreSale;
  /** Voided since: it counts for nothing, and the bill is still to be charged. */
  voided: boolean;
}

export interface TillCharge {
  totalCents: number;
  count: number;
  method: PaymentMethod | null;
  setMethod: (method: PaymentMethod) => void;
  tendered: string;
  setTendered: (text: string) => void;
  cash: CashCheck;
  /** What stops the charge, once a press has tried it. */
  problem: ChargeProblem | null;
  /** Why the last try failed, in words; null when it did not. */
  failure: string | null;
  /** The sale the server already had under the bill's ref, when it is not this bill. */
  keptEarlier: KeptEarlier | null;
  busy: boolean;
  confirm: () => Promise<void>;
  /** A fresh start: nothing chosen, nothing typed, nothing said. For every opening. */
  reset: () => void;
}

export function useTillCharge({
  ticket,
  stale,
  onCharged,
  onRenewRef,
  onCardApproved,
}: {
  ticket: Ticket;
  /** How many lines the menu changed under that the manager has not decided about: they stop the charge. */
  stale: number;
  onCharged: (charged: Charged) => void;
  /** The server answered the bill's ref with an older sale: give the bill a new one. */
  onRenewRef: (sentRef: string) => void;
  /** The card reader approved this amount for the bill: keep it with the bill, at once. */
  onCardApproved: (amountCents: number) => void;
}): TillCharge {
  const t = useT();
  const scope = useSaleDraftScope();
  const storage = useMemo(browserStorage, []);
  const menu = useMenu();
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [tendered, setTendered] = useState('');
  const [tried, setTried] = useState(false);
  const [keptEarlier, setKeptEarlier] = useState<KeptEarlier | null>(null);
  const [declined, setDeclined] = useState(false);
  const [atReader, setAtReader] = useState(false);
  const sending = useRef(false);
  const orders = useOrderAlert();
  // Whoever may not type a sale in by hand charges what the till would
  // (lib/store/ticket.ts, canKeepStale): it changes what a refusal says.
  const heldToTill = !useCan()('store.sales.manual');

  const save = useCreateStoreSale({
    // Inside the mutation, so it runs even when the page is gone by the time
    // the answer comes: a bill charged must not come back as a draft.
    onSaved: (_sale, sent) => {
      if (scope) clearTillDraft(storage, scope, sent.client_ref);
    },
    // Nor one recorded under its ref already, the same lines (another day, or
    // paid the other way): it is charged, however it is recorded.
    onKept: (sale, sent) => {
      const answer = tillAnswer(sent, sale);
      if (scope && (answer === 'same' || answer === 'other_method')) clearTillDraft(storage, scope, sent.client_ref);
    },
    // A product this bill has just left critical: the notice to order it
    // opens over the till once the charge has closed (OrderAlert.tsx).
    onStockAlerts: orders.afterSale,
  });

  // The menu refused the bill and the lines it moved were marked: once every
  // one is decided (prices updated, lines taken off, kept), the refusal is
  // answered and stops being said.
  const staleBefore = useRef(stale);
  useEffect(() => {
    if (menuRefusalAnswered(staleBefore.current, stale, errorCode(save.error), heldToTill)) save.reset();
    staleBefore.current = stale;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale]);

  const totalCents = ticketTotalCents(ticket);

  const reset = () => {
    setMethod(null);
    setTendered('');
    setTried(false);
    setKeptEarlier(null);
    setDeclined(false);
    save.reset();
  };

  const problemNow = () => chargeProblem(ticket, method, tendered, { stale });

  const confirm = async () => {
    if (sending.current) return;
    setTried(true);
    if (problemNow() !== null || method === null) return;
    sending.current = true;
    setKeptEarlier(null);
    setDeclined(false);
    save.reset();
    const known = menu.data ? new Set(menu.data.sections.flatMap((s) => s.dishes.map((d) => d.id))) : null;
    const sent = detachMissingDishes(tillPayload(ticket, isoDay(new Date()), method), known);

    // A retry of a bill whose card was approved already (the answer lost):
    // straight to recording it, not to the reader a second time.
    if (method === 'card' && !cardApproved(ticket)) {
      setAtReader(true);
      let payment: CardPayment;
      try {
        payment = await takeCardPayment({ amountCents: totalCents, clientRef: sent.client_ref });
      } catch {
        payment = { approved: false };
      } finally {
        setAtReader(false);
      }
      if (!payment.approved) {
        setDeclined(true);
        sending.current = false;
        return;
      }
      onCardApproved(totalCents);
    }

    save.mutate(sent, {
      onSuccess: ({ sale, asSent }) => {
        const charged = { saleId: sale.id, totalCents: Math.round(sale.total * 100), clientRef: sent.client_ref };
        if (asSent) {
          onCharged({ ...charged, method });
          return;
        }
        // The server had this ref already, from a try whose answer never came
        // back, and answered with THAT sale.
        const answer = tillAnswer(sent, sale);
        if ((answer === 'same' || answer === 'other_method') && sale.payment_method) {
          // These very lines: charged. Paid the other way, it is recorded as
          // the first try said, and the note says how to put that right --
          // never "confirm again", which would record it twice.
          onCharged({ ...charged, method: sale.payment_method, ...(answer === 'other_method' ? { paidWith: method } : {}) });
          return;
        }
        // Another bill, or this one voided since. The bill stays, under a new
        // ref -- the old one would keep being answered with the old sale --
        // and the manager decides whether this is another sale or the same twice.
        setKeptEarlier({ sale, voided: answer === 'voided' });
        onRenewRef(sent.client_ref);
      },
      onError: (e) => {
        // The menu moved after it was fetched -- a dish left it, a price
        // changed: fetch it again, so the bill is checked against it and the
        // lines that changed are marked (or, a dish gone from the manager's
        // bill, the next press records that line without it).
        if (menuRefusalKey(errorCode(e), heldToTill) !== undefined) void menu.refetch();
      },
      onSettled: () => {
        sending.current = false;
      },
    });
  };

  const error = save.error;
  const menuMoved = error ? menuRefusalKey(errorCode(error), heldToTill) : undefined;
  const failure = declined
    ? t('menu.charge.declined')
    : error
      ? menuMoved !== undefined
        ? t(menuMoved)
        : // No answer at all: the network, not the server. The bill and its
          // ref stay, and a second press cannot record it twice.
          isAxiosError(error) && !error.response
          ? t('menu.charge.offline')
          : getErrorMessage(error)
      : null;

  return {
    totalCents,
    count: ticketCount(ticket),
    method,
    setMethod: (m) => {
      setMethod(m);
      setDeclined(false);
    },
    tendered,
    setTendered,
    cash: cashChange(totalCents, tendered),
    problem: tried ? problemNow() : null,
    failure,
    keptEarlier,
    busy: save.isPending || atReader,
    confirm,
    reset,
  };
}

// --- What it shows ----------------------------------------------------------------

/** "3 items": how many things are on the bill, two Crispy and a water being three. */
export function itemsText(t: ReturnType<typeof useT>, count: number): string {
  return t(count === 1 ? 'menu.bill.items.one' : 'menu.bill.items.other', { count });
}

const METHODS: readonly PaymentMethod[] = ['cash', 'card'];

/**
 * The total, the way of paying and, for cash, what was handed over and the
 * change. `before` goes above it all: what the menu changed under the bill,
 * which has to be answered before it is charged (TillTicket.tsx, StaleNotice).
 */
export function ChargeBody({
  ctl,
  before,
  topRef,
}: {
  ctl: TillCharge;
  before?: ReactNode;
  /** The total's block, where the focus can land once `before` has been answered and is gone. */
  topRef?: RefObject<HTMLDivElement>;
}) {
  const t = useT();
  const ids = useId();
  const total = formatMoney(ctl.totalCents / 100);
  const { cash } = ctl;
  const tenderedBad = cash.invalid || (ctl.problem === 'short' && cash.shortCents !== null);

  return (
    // Off while the charge is on its way: a change of method then would not
    // be the one recorded.
    <fieldset disabled={ctl.busy} className="min-w-0 space-y-5">
      {before}
      <div ref={topRef} tabIndex={-1} className="text-center focus:outline-none">
        <p className="text-sm text-gray-500">{t('menu.charge.toCharge')}</p>
        <p className="mt-0.5 text-4xl font-semibold tabular-nums tracking-tight text-gray-900">{total}</p>
        <p className="mt-1 text-sm text-gray-500">{itemsText(t, ctl.count)}</p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-gray-700">{t('menu.charge.method')}</legend>
        {/* Two big choices, each with its word and its sign, and the radio's
            own dot: which is chosen is never the colour alone. Arrow keys go
            between them, as radios do. */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {METHODS.map((m) => (
            <label
              key={m}
              className={[
                'flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 text-base transition-colors motion-reduce:transition-none',
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-300',
                ctl.method === m
                  ? 'border-brand-400 bg-brand-600/25 font-semibold text-gray-900'
                  : 'border-white/15 bg-white/[0.03] font-medium text-gray-700 hover:border-white/25 hover:bg-white/[0.07]',
              ].join(' ')}
            >
              <input
                type="radio"
                name={`${ids}-method`}
                value={m}
                checked={ctl.method === m}
                onChange={() => ctl.setMethod(m)}
                className="h-4 w-4 shrink-0 accent-brand-500 focus:outline-none"
              />
              <PaymentMethodIcon method={m} className="h-5 w-5" />
              {t(m === 'cash' ? 'menu.charge.cash' : 'menu.charge.card')}
            </label>
          ))}
        </div>
      </fieldset>

      {ctl.method === 'cash' && (
        <div className="space-y-2">
          <div className="group/field flex flex-col gap-1">
            <label
              htmlFor={`${ids}-tendered`}
              className="text-sm font-medium text-gray-700 transition-colors duration-200 group-focus-within/field:text-brand-300 motion-reduce:transition-none"
            >
              {t('menu.charge.tendered')}
            </label>
            <input
              id={`${ids}-tendered`}
              value={ctl.tendered}
              onChange={(e) => ctl.setTendered(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              maxLength={12}
              placeholder="50"
              aria-invalid={tenderedBad || undefined}
              aria-describedby={`${ids}-cash`}
              // 16 px: a smaller field makes iOS zoom the page in on focus.
              className={`${FIELD_SKIN} ${fieldTone(tenderedBad)} min-h-11 w-full rounded-xl px-3.5 py-2 text-base tabular-nums`}
            />
          </div>
          <div id={`${ids}-cash`}>
            {cash.invalid ? (
              <p className="text-sm font-medium text-red-300">{t('menu.charge.tenderedInvalid')}</p>
            ) : cash.shortCents !== null ? (
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-300">
                <WarningIcon />
                {t('menu.charge.short', { missing: formatMoney(cash.shortCents / 100) })}
              </p>
            ) : cash.changeCents !== null ? (
              <p className="flex items-baseline justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                <span className="text-sm text-gray-700">{t('menu.charge.change')}</span>
                <span className="text-2xl font-semibold tabular-nums text-gray-900">{formatMoney(cash.changeCents / 100)}</span>
              </p>
            ) : (
              <p className="text-xs text-gray-500">{t('menu.charge.tenderedHelp')}</p>
            )}
          </div>
        </div>
      )}

      {ctl.method === 'card' && (
        <p className="flex items-start gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-sm text-gray-800">
          <PaymentMethodIcon method="card" className="mt-0.5 h-4 w-4 text-gray-500" />
          <span>{t('menu.charge.cardHelp', { total })}</span>
        </p>
      )}
    </fieldset>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4 shrink-0">
      <path d="M10 3.5 17 16H3L10 3.5ZM10 8.5v3.5M10 14.2v.1" />
    </svg>
  );
}

/**
 * What stops or failed the charge, then the two buttons: in the footer, which
 * does not scroll, so the reason sits beside the button that was pressed.
 */
export function ChargeActions({ ctl, onCancel, cancelLabel }: { ctl: TillCharge; onCancel: () => void; cancelLabel: string }) {
  const t = useT();
  // Handed to the sale's page, so its "Back" returns here.
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  const problem = ctl.problem && ctl.problem !== 'empty' ? t(`menu.charge.problem.${ctl.problem}`) : null;
  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-3">
      {(problem || ctl.failure) && (
        <p role="alert" className="w-full text-sm font-medium text-red-300">
          {problem ?? ctl.failure}
        </p>
      )}
      {ctl.keptEarlier && (
        <p role="alert" className="w-full rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t(ctl.keptEarlier.voided ? 'menu.charge.keptVoided' : 'menu.charge.keptEarlier', {
            total: formatMoney(ctl.keptEarlier.sale.total),
          })}{' '}
          <Link
            to={`/store/sales/${encodeURIComponent(ctl.keptEarlier.sale.id)}`}
            state={{ from: here }}
            className="rounded font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
          >
            {t(ctl.keptEarlier.voided ? 'menu.charge.keptVoidedView' : 'menu.charge.keptEarlierView')}
          </Link>
        </p>
      )}
      <Button variant="secondary" className="min-h-11" onClick={onCancel} disabled={ctl.busy}>
        {cancelLabel}
      </Button>
      <Button className="min-h-11 min-w-[10rem]" onClick={() => void ctl.confirm()} disabled={ctl.busy}>
        {ctl.busy ? t('menu.charge.charging') : t('menu.charge.confirm')}
      </Button>
    </div>
  );
}

/** The charge in a dialog of its own: the wide screen's, beside its bill. */
export function ChargeDialog({
  open,
  ctl,
  onClose,
  before,
  topRef,
  announcement = '',
}: {
  open: boolean;
  ctl: TillCharge;
  onClose: () => void;
  /** Above the charge: what the menu changed under the bill (ChargeBody). */
  before?: ReactNode;
  topRef?: RefObject<HTMLDivElement>;
  /** The page's last words, said from in here while the dialog is open (it hides the page). */
  announcement?: string;
}) {
  const t = useT();
  // Not while it is on its way: the answer would land on a closed dialog, and
  // what it said (a failure, a sale kept earlier) with it.
  const close = () => {
    if (!ctl.busy) onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={t('menu.charge.title')}
      footer={<ChargeActions ctl={ctl} onCancel={close} cancelLabel={t('menu.charge.cancel')} />}
    >
      <ChargeBody ctl={ctl} before={before} topRef={topRef} />
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
    </Modal>
  );
}
