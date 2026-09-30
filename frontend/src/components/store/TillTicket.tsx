// The bill at the till, on the Menu screen in its "Charge" mode: what has been
// rung up, − how many +, what each line comes to, the total, "Clear" and
// "Charge 23,30 €". The sums and the steps are lib/store/ticket.ts; the bill
// survives a reload in the browser (lib/store/tillDraft.ts).
//
// Where it goes depends on the room. On a wide screen (lg, 1024 px and up) it
// is a column to the right of the grid, the grid still four or five tiles
// across, as the till keeps its order beside the products. On a narrow one it
// is a bar at the foot of the window -- "3 · 23,30 €" and "Charge" -- that
// opens the bill in a sheet rising from the bottom; the sheet turns into the
// charge (ChargeDialog.tsx) and back, one dialog with new content.
//
// It is the counter's screen and nothing else (decided with Max, 27-sep-2026):
// no ticket for the customer, no printing, no "pre-bill". Whoever charges --
// the manager, an employee, the till's tablet (`store.charge`, 28-sep-2026).
//
// "Clear" asks nothing and can be taken back until the next product is added,
// as "Start over" in "New sale": a question before every discard is one
// people learn to answer without reading.
//
// The bill is checked against the menu as it is now: a line whose dish was
// deleted, sold out or repriced since it was rung up says so, and the bill
// says it above its lines with the three answers (the new prices, those lines
// off, or keep them) -- the charge waits for one. And a bill left more than 12
// hours is last night's: set aside, said, and brought back with a tap.
//
// On a phone the sidebar leaves the page a sliver, and the bar does not
// spread over the sidebar's foot ("Sign out"): it keeps to the page's side,
// one thing over the other.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import type { PaymentMethod } from '../../api/store';
import { useCan } from '../../auth/useCan';
import { formatMoney } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { browserStorage, newClientRef } from '../../lib/inventory/receiveDraft';
import type { MenuDish, MenuSection } from '../../lib/menu/types';
import { formatInstant } from '../../lib/store/format';
import {
  addToTicket,
  barFrame,
  canKeepStale,
  emptyTicket,
  followOffset,
  lineKey,
  lineTotalCents,
  MAX_TICKET_QUANTITY,
  pendingStale,
  removeLine,
  removeLines,
  renewTicketRef,
  staleId,
  staleLines,
  stepLine,
  ticketCount,
  ticketTotalCents,
  updatePrices,
  withCardApproval,
  type AddResult,
  type BarFrame,
  type LineChange,
  type StaleLine,
  type Ticket,
  type TicketLine,
} from '../../lib/store/ticket';
import { draftExpired, readTillDraft, saveTillDraft } from '../../lib/store/tillDraft';
import {
  dialogKeys,
  useBackdropClose,
  useDialogFocus,
  useInert,
  usePresence,
} from '../motion/useDialogMotion';
import { Button } from '../Button';
import { ChargeActions, ChargeBody, itemsText, type TillCharge } from './ChargeDialog';
import { useSaleDraftScope } from './SaleFormModal';

// --- The bill's state -------------------------------------------------------------

/**
 * A bill taken off the screen that can still be brought back: cleared by the
 * manager ("Clear"), or found in the browser more than 12 hours old
 * (tillDraft.ts) -- last night's, forgotten, set aside rather than shown as
 * the bill to charge, and rather than thrown away without a word.
 */
export interface SetAside {
  ticket: Ticket;
  why: 'cleared' | 'expired';
  /** When it was last changed (ISO), for an expired one; '' when that does not read. */
  savedAt: string;
}

/** What the menu changed under the bill, and the three ways to answer it. */
export interface TillStale {
  /** Every line the menu changed under, decided about or not: each line says so. */
  all: StaleLine[];
  /** Those the manager has not decided about yet: they stop the charge. */
  pending: StaleLine[];
}

export interface TillTicket {
  ticket: Ticket;
  /** The bill cleared or set aside, while it can still be brought back. */
  setAside: SetAside | null;
  stale: TillStale;
  add: (dish: Pick<MenuDish, 'id' | 'name' | 'price' | 'available'>) => AddResult;
  /** The line as it is now, and the bill with it; null when there is no such line. */
  step: (key: string, delta: 1 | -1) => { line: TicketLine; ticket: Ticket } | null;
  /** The line taken off, and the bill without it; null when there was no such line. */
  remove: (key: string) => { line: TicketLine; ticket: Ticket } | null;
  clear: () => void;
  /** The bill set aside, back on screen. */
  undoClear: () => Ticket | null;
  /** An expired bill let go for good. */
  dropSetAside: () => void;
  /** Lines whose dish has a new price, at it. The bill as it is now. */
  updatePrices: () => Ticket;
  /** The lines the menu changed under, off the bill; how many went, and the bill. */
  removeStale: () => { count: number; ticket: Ticket };
  /** The lines the menu changed under, charged as they are. */
  keepStale: () => void;
  /** The card reader approved this amount for the bill: kept with it, in the browser too, at once. */
  markCardApproved: (amountCents: number) => void;
  /** The bill's ref was answered with an older sale: the same bill, a new ref. */
  renewRef: (sentRef: string) => void;
  /** The bill under this ref was charged: a new, empty one. */
  startNew: (sentRef: string) => void;
}

interface TillState {
  scopeKey: string;
  ticket: Ticket;
  setAside: SetAside | null;
  /** When the bill was last changed (ms), for telling one left too long. */
  touchedAt: number;
  /** What the manager chose to keep as it is (staleId): new for every bill. */
  kept: ReadonlySet<string>;
}

const NOTHING_KEPT: ReadonlySet<string> = new Set();

/**
 * This person's bill in this workspace: read from the browser when the page
 * opens, written back at every change, a new one (with a new ref) when it is
 * charged or cleared. Changes go through a ref as well as the state, so two
 * taps in one tick both count.
 *
 * Checked against the menu (`sections`, as last fetched) all the time: lines
 * whose dish was deleted, sold out or repriced since it was rung up are said
 * on the bill and stop the charge until the manager updates them, takes them
 * off, or keeps them as they are (lib/store/ticket.ts, staleLines). A bill
 * found in the browser more than 12 hours old -- at load, or when the tab
 * comes back into view -- is set aside, said, and can be brought back.
 */
export function useTillTicket(sections: readonly MenuSection[] | undefined): TillTicket {
  const scope = useSaleDraftScope();
  const storage = useMemo(browserStorage, []);
  const scopeKey = scope ? `${scope.orgId}.${scope.userId}` : '';
  const load = (): TillState => {
    const stored = scope ? readTillDraft(storage, scope) : null;
    const fresh = { scopeKey, ticket: emptyTicket(newClientRef()), setAside: null, touchedAt: Date.now(), kept: NOTHING_KEPT };
    if (!stored) return fresh;
    if (draftExpired(stored.savedAt)) return { ...fresh, setAside: { ticket: stored.ticket, why: 'expired', savedAt: stored.savedAt } };
    return { ...fresh, ticket: stored.ticket, touchedAt: Date.parse(stored.savedAt) };
  };

  const [state, setState] = useState(load);
  let current = state;
  // Another person or workspace in this tab: their own bill, not this one.
  if (state.scopeKey !== scopeKey) {
    current = load();
    setState(current);
  }
  const live = useRef(current);
  live.current = current;
  const set = (patch: Partial<TillState>) => {
    const ticketChanged = patch.ticket !== undefined && patch.ticket !== live.current.ticket;
    live.current = { ...live.current, ...(ticketChanged ? { touchedAt: Date.now() } : {}), ...patch };
    setState(live.current);
  };

  useEffect(() => {
    if (!scope) return;
    // An expired bill set aside stays in the browser until the manager
    // decides -- brings it back, lets it go, or starts another -- so a reload
    // meanwhile says it again rather than losing it.
    if (current.ticket.lines.length === 0 && current.setAside?.why === 'expired') return;
    saveTillDraft(storage, scope, current.ticket);
  }, [storage, scope, current.ticket, current.setAside]);

  // A tablet left on the till overnight: the page never reloaded, and the
  // bill on it is as old as one read from the browser.
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState !== 'visible') return;
      const { ticket, touchedAt } = live.current;
      if (ticket.lines.length === 0 || !draftExpired(new Date(touchedAt).toISOString())) return;
      set({ ticket: emptyTicket(newClientRef()), setAside: { ticket, why: 'expired', savedAt: new Date(touchedAt).toISOString() }, kept: NOTHING_KEPT });
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
    // Once: `set` reads and writes through the ref, so nothing it holds goes stale.
  }, []);

  const menu = useMemo(
    () => (sections ? new Map(sections.flatMap((s) => s.dishes.map((d) => [d.id, d] as const))) : null),
    [sections],
  );
  const all = useMemo(() => staleLines(current.ticket, menu), [current.ticket, menu]);
  const pending = useMemo(() => pendingStale(all, current.kept), [all, current.kept]);
  const staleNow = () => pendingStale(staleLines(live.current.ticket, menu), live.current.kept);

  const find = (ticket: Ticket, key: string) => ticket.lines.find((l) => lineKey(l) === key) ?? null;

  return {
    ticket: current.ticket,
    setAside: current.setAside,
    stale: { all, pending },
    add: (dish) => {
      const result = addToTicket(live.current.ticket, dish);
      // Something new on the bill: the one set aside is gone for good.
      if (result.ok) set({ ticket: result.ticket, setAside: null });
      return result;
    },
    step: (key, delta) => {
      const ticket = stepLine(live.current.ticket, key, delta);
      if (ticket !== live.current.ticket) set({ ticket });
      const line = find(ticket, key);
      return line && { line, ticket };
    },
    remove: (key) => {
      const line = find(live.current.ticket, key);
      if (!line) return null;
      const ticket = removeLine(live.current.ticket, key);
      set({ ticket });
      return { line, ticket };
    },
    clear: () => {
      const { ticket, setAside } = live.current;
      // A new ref too: whatever the old one recorded (if anything) stays
      // recorded, and the next bill must not be answered with it.
      set({
        ticket: emptyTicket(newClientRef()),
        setAside: ticket.lines.length > 0 ? { ticket, why: 'cleared', savedAt: '' } : setAside,
        kept: NOTHING_KEPT,
      });
    },
    undoClear: () => {
      const { setAside } = live.current;
      if (!setAside) return null;
      // Back as a bill being rung up now: its age starts again.
      set({ ticket: setAside.ticket, setAside: null, touchedAt: Date.now() });
      return setAside.ticket;
    },
    dropSetAside: () => {
      if (live.current.setAside) set({ setAside: null });
    },
    updatePrices: () => {
      const ticket = updatePrices(live.current.ticket, staleNow());
      set({ ticket });
      return ticket;
    },
    removeStale: () => {
      const stale = staleNow();
      const ticket = removeLines(live.current.ticket, stale.map((s) => s.key));
      set({ ticket });
      return { count: stale.length, ticket };
    },
    keepStale: () => {
      set({ kept: new Set([...live.current.kept, ...staleNow().map(staleId)]) });
    },
    markCardApproved: (amountCents) => {
      const ticket = withCardApproval(live.current.ticket, amountCents);
      set({ ticket });
      // Now, not after the next render: the sale's request leaves in this
      // same tick, and a tab killed before the answer must come back knowing.
      if (scope) saveTillDraft(storage, scope, ticket);
    },
    renewRef: (sentRef) => {
      const { ticket } = live.current;
      if (ticket.clientRef === sentRef) set({ ticket: renewTicketRef(ticket, newClientRef()) });
    },
    startNew: (sentRef) => {
      if (live.current.ticket.clientRef === sentRef) set({ ticket: emptyTicket(newClientRef()), setAside: null, kept: NOTHING_KEPT });
    },
  };
}

/** The last bill charged, said until it is dismissed or the next one starts. */
export interface LastCharge {
  saleId: string;
  totalCents: number;
  /** How it is recorded. */
  method: PaymentMethod;
  /**
   * How the manager said it was paid, when that is not how it is recorded:
   * a retry answered with the same bill recorded the other way (ticket.ts,
   * tillAnswer 'other_method'). The note then says how to put it right.
   */
  paidWith?: PaymentMethod;
}

// --- Small parts ------------------------------------------------------------------

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5">
      <path d="M4 6h12M8 6V4.5A1 1 0 0 1 9 3.5h2a1 1 0 0 1 1 1V6M6 6l.7 9.1A1.5 1.5 0 0 0 8.2 16.5h3.6a1.5 1.5 0 0 0 1.5-1.4L14 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4 shrink-0">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  );
}

/** A square a thumb can hit: 44 px, as the rest of the till's. */
const STEP_BUTTON =
  'grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/[0.04] text-lg font-semibold leading-none text-gray-900 transition-colors hover:border-white/25 hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-white/[0.04] motion-reduce:transition-none';

const LINK_BUTTON =
  'min-h-9 shrink-0 rounded-lg px-2 text-sm font-medium text-brand-700 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300';

/**
 * The bill's lines: the name and its price each, then − how many + and what
 * the line comes to, and the button that takes it off. − stops at one (it is
 * marked unavailable, not disabled, so the focus stays on it); taking a line
 * off moves the focus to the line that takes its place, or the one above.
 */
function BillLines({
  ticket,
  stale,
  onStep,
  onRemove,
  emptyFocus,
}: {
  ticket: Ticket;
  /** The lines the menu changed under: each says what, under its price. */
  stale: readonly StaleLine[];
  onStep: (key: string, delta: 1 | -1) => void;
  onRemove: (key: string) => void;
  /** Where the focus goes when the last line is taken off. */
  emptyFocus: RefObject<HTMLElement>;
}) {
  const t = useT();
  const changes = new Map(stale.map((s) => [s.key, s.change]));
  const removers = useRef(new Map<string, HTMLButtonElement>());
  const [refocus, setRefocus] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (refocus === null) return;
    (refocus === '' ? emptyFocus.current : removers.current.get(refocus))?.focus();
    setRefocus(null);
  }, [refocus, emptyFocus]);

  const remove = (key: string) => {
    const at = ticket.lines.findIndex((l) => lineKey(l) === key);
    const next = ticket.lines[at + 1] ?? ticket.lines[at - 1];
    onRemove(key);
    setRefocus(next ? lineKey(next) : '');
  };

  return (
    <ul className="divide-y divide-white/[0.06]">
      {ticket.lines.map((line) => {
        const key = lineKey(line);
        const atLeast = line.quantity <= 1;
        const atMost = line.quantity >= MAX_TICKET_QUANTITY;
        const change = changes.get(key);
        return (
          <li key={key} className="py-2.5">
            <p className="break-words text-sm font-medium leading-snug text-gray-900">{line.name}</p>
            <p className="text-xs tabular-nums text-gray-500">{t('menu.bill.each', { price: formatMoney(line.priceCents / 100) })}</p>
            {change && (
              <p className="mt-0.5 flex items-start gap-1 text-xs font-medium text-amber-300">
                <WarningIcon className="mt-px h-3.5 w-3.5" />
                <span>{lineChangeText(t, change)}</span>
              </p>
            )}
            <div className="mt-1.5 flex items-center gap-1">
              <button
                type="button"
                className={STEP_BUTTON}
                aria-label={t('menu.bill.less', { name: line.name })}
                aria-disabled={atLeast || undefined}
                onClick={() => {
                  if (!atLeast) onStep(key, -1);
                }}
              >
                <span aria-hidden="true">−</span>
              </button>
              <span className="min-w-[2.5ch] text-center text-base font-semibold tabular-nums text-gray-900">{line.quantity}</span>
              <button
                type="button"
                className={STEP_BUTTON}
                aria-label={t('menu.bill.more', { name: line.name })}
                aria-disabled={atMost || undefined}
                onClick={() => {
                  if (!atMost) onStep(key, 1);
                }}
              >
                <span aria-hidden="true">+</span>
              </button>
              <span className="ml-auto whitespace-nowrap pl-2 text-sm font-semibold tabular-nums text-gray-900">
                {formatMoney(lineTotalCents(line) / 100)}
              </span>
              <button
                type="button"
                ref={(el) => {
                  if (el) removers.current.set(key, el);
                  else removers.current.delete(key);
                }}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-red-50 hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300 motion-reduce:transition-none"
                aria-label={t('menu.bill.remove', { name: line.name })}
                onClick={() => remove(key)}
              >
                <TrashIcon />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function WarningIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d="M10 3.5 17 16H3L10 3.5ZM10 8.5v3.5M10 14.2v.1" />
    </svg>
  );
}

/** What a line says under its price when the menu changed under it: "Now 11,00 €". */
function lineChangeText(t: ReturnType<typeof useT>, change: LineChange): string {
  if (change.kind === 'gone') return t('menu.bill.line.gone');
  if (change.kind === 'sold_out') return t('menu.bill.line.soldOut');
  return change.priceCents === null
    ? t('menu.bill.line.noPrice')
    : t('menu.bill.line.price', { price: formatMoney(change.priceCents / 100) });
}

/** The same, with the dish's name, for the notice's list: "Crispy Grande: now 11,00 € (10,00 € on the order)". */
function staleText(t: ReturnType<typeof useT>, s: StaleLine): string {
  const then = formatMoney(s.priceCents / 100);
  if (s.change.kind === 'gone') return t('menu.bill.stale.gone', { name: s.name });
  if (s.change.kind === 'sold_out') return t('menu.bill.stale.soldOut', { name: s.name });
  return s.change.priceCents === null
    ? t('menu.bill.stale.noPrice', { name: s.name, then })
    : t('menu.bill.stale.price', { name: s.name, now: formatMoney(s.change.priceCents / 100), then });
}

/** The three answers to the menu having changed under the bill. */
export interface StaleActions {
  onUpdatePrices: () => void;
  onRemoveStale: () => void;
  onKeepStale: () => void;
}

/**
 * "The menu changed since these were added": the lines and what changed, and
 * the three answers -- the new prices (when there are any to go to), take
 * those lines off, or keep them as they are (not for anybody held to the
 * till, when the till would refuse them: lib/store/ticket.ts, canKeepStale).
 * Said on the bill and in the charge; the charge waits for one of them, so
 * nothing is charged at a price the manager has not seen. After an answer the focus stays in the notice if
 * it is still there (a sold-out line left once the prices are updated), or
 * goes to `fallbackFocus`.
 */
export function StaleNotice({
  stale,
  actions,
  fallbackFocus,
}: {
  stale: readonly StaleLine[];
  actions: StaleActions;
  fallbackFocus: RefObject<HTMLElement>;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const heldToTill = !useCan()('store.sales.manual');
  if (stale.length === 0) return null;
  const canUpdate = stale.some((s) => s.change.kind === 'price' && s.change.priceCents !== null);
  const canKeep = canKeepStale(stale, heldToTill);
  const run = (action: () => void) => () => {
    action();
    requestAnimationFrame(() => (box.current?.isConnected ? box.current : fallbackFocus.current)?.focus());
  };
  return (
    <div
      ref={box}
      tabIndex={-1}
      role="group"
      aria-labelledby={titleId}
      className="mb-2 rounded-xl border border-amber-200/60 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
    >
      <p id={titleId} className="flex items-start gap-1.5 font-semibold">
        <WarningIcon className="mt-0.5 h-4 w-4" />
        <span>{t('menu.bill.stale.title')}</span>
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-6">
        {stale.map((s) => (
          <li key={staleId(s)} className="break-words">
            {staleText(t, s)}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {canUpdate && (
          <Button size="sm" className="min-h-9" onClick={run(actions.onUpdatePrices)}>
            {t('menu.bill.stale.update')}
          </Button>
        )}
        <Button variant="secondary" size="sm" className="min-h-9" onClick={run(actions.onRemoveStale)}>
          {t('menu.bill.stale.remove')}
        </Button>
        {canKeep && (
          <Button variant="ghost" size="sm" className="min-h-9" onClick={run(actions.onKeepStale)}>
            {t('menu.bill.stale.keep')}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * "Order cleared. Undo" while it can be; or, for a bill found more than 12
 * hours old, what it was and when, with the way to bring it back or let it go.
 * `short` is the bar's: a sentence, not the whole story.
 */
function SetAsideNote({
  setAside,
  onUndo,
  onDrop,
  short = false,
}: {
  setAside: SetAside;
  onUndo: () => void;
  onDrop: () => void;
  short?: boolean;
}) {
  const t = useT();
  if (setAside.why === 'cleared') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-700">
        <span>{t('menu.bill.cleared')}</span>
        <button type="button" onClick={onUndo} className={LINK_BUTTON}>
          {t('menu.bill.undo')}
        </button>
      </div>
    );
  }
  const when = formatInstant(setAside.savedAt);
  const text =
    short || !when
      ? t('menu.bill.expiredShort')
      : t('menu.bill.expired', {
          day: when.day,
          time: when.time,
          items: itemsText(t, ticketCount(setAside.ticket)),
          total: formatMoney(ticketTotalCents(setAside.ticket) / 100),
        });
  return (
    <div className="rounded-xl border border-amber-200/60 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <p className="flex items-start gap-1.5">
        <WarningIcon className="mt-0.5 h-4 w-4" />
        <span className="min-w-0 break-words">{text}</span>
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Button size="sm" className="min-h-9" onClick={onUndo}>
          {t('menu.bill.recover')}
        </Button>
        <Button variant="ghost" size="sm" className="min-h-9" onClick={onDrop}>
          {t('menu.bill.discardExpired')}
        </Button>
      </div>
    </div>
  );
}

/** How the charged note is laid out: in the bill's column, in the bar, or in a bar too narrow for one line. */
type NoteLayout = 'column' | 'bar' | 'stacked';

/**
 * "Charged 23,30 € · Cash", with the way to the sale, until dismissed or the
 * next bill starts. On two lines in the bill's column, on one in the bar, and
 * one over the other in a bar too narrow for that. When the bill turned out
 * to be recorded already, paid the other way (`paidWith`), it says so instead,
 * in amber -- "It was already recorded as Cash (23,30 €). If they paid by
 * card, void that sale and charge it again" -- and the link is the way to do it.
 */
function ChargedNote({ charge, onDismiss, layout }: { charge: LastCharge; onDismiss: () => void; layout: NoteLayout }) {
  const t = useT();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  const total = formatMoney(charge.totalCents / 100);
  const mismatch = charge.paidWith !== undefined && charge.paidWith !== charge.method;
  const text = mismatch
    ? t(charge.paidWith === 'card' ? 'menu.bill.otherMethod.card' : 'menu.bill.otherMethod.cash', { total })
    : t('menu.bill.charged', { total, method: t(charge.method === 'cash' ? 'menu.charge.cash' : 'menu.charge.card') });
  const inBar = layout === 'bar';
  const link = (
    <Link
      to={`/store/sales/${encodeURIComponent(charge.saleId)}`}
      state={{ from: here }}
      className={`${LINK_BUTTON} inline-flex items-center ${inBar ? '' : '-ml-2'} ${mismatch ? 'text-amber-900 underline underline-offset-2' : ''}`}
    >
      {t('menu.bill.viewSale')}
    </Link>
  );
  const dismiss = (
    <button
      type="button"
      onClick={onDismiss}
      aria-label={t('menu.bill.dismiss')}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
    >
      <span aria-hidden="true" className="text-lg leading-none">×</span>
    </button>
  );
  const sign = <span className={mismatch ? 'text-amber-300' : 'text-brand-300'}>{mismatch ? <WarningIcon /> : <CheckIcon />}</span>;
  const tone = mismatch ? 'border-amber-200/60 bg-amber-50 text-amber-800' : 'border-brand-400/30 bg-brand-600/15 text-gray-900';

  if (layout === 'stacked') {
    // The sign and the ×, then the words across the whole width, then the link.
    return (
      <div className={`w-full rounded-xl border px-2 pb-1 pt-0.5 text-xs ${tone}`}>
        <div className="flex items-center justify-between">
          {sign}
          {dismiss}
        </div>
        <p className="break-words font-medium tabular-nums">{text}</p>
        <div className="mt-0.5">{link}</div>
      </div>
    );
  }
  return (
    <div
      className={[
        'flex items-start gap-2 text-sm',
        inBar ? `min-w-0 flex-1 items-center ${mismatch ? 'text-amber-800' : 'text-gray-900'}` : `rounded-xl border py-1.5 pl-3 pr-1 ${tone}`,
      ].join(' ')}
    >
      <span className={inBar ? '' : 'mt-2'}>{sign}</span>
      <div className={inBar ? 'flex min-w-0 flex-1 flex-wrap items-center gap-x-2' : 'min-w-0 flex-1 pt-1.5'}>
        <p className={`font-medium tabular-nums ${inBar ? 'min-w-0 flex-1' : ''}`}>{text}</p>
        {link}
      </div>
      {dismiss}
    </div>
  );
}

// --- The wide screen's column ---------------------------------------------------------

/**
 * Keeps `panel` in view while the page scrolls, inside the row it sits in
 * (its parent): lib/store/ticket.ts, followOffset, says why this is not
 * `position: sticky`. A transform, set on the element directly, once a
 * frame at most; nothing while the panel is not shown (narrow screens).
 */
function useFollowScroll(panel: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const el = panel.current;
    const row = el?.parentElement;
    if (!el || !row) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      if (el.offsetParent === null) {
        el.style.transform = '';
        return;
      }
      const offset = followOffset(row.getBoundingClientRect().top, row.offsetHeight, el.offsetHeight);
      el.style.transform = offset > 0 ? `translateY(${offset}px)` : '';
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(row);
    observer?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      el.style.transform = '';
    };
  }, [panel]);
}

/**
 * The bill beside the grid: a region named "Order", its lines scrolling
 * inside it, the total and "Charge" always at its foot. It follows the page
 * down while the grid scrolls, so it is in view whatever tile is.
 */
export function TillTicketPanel({
  till,
  lastCharge,
  onDismissCharge,
  onCharge,
  onStep,
  onRemove,
  onClear,
  onUndoClear,
  stale,
  className = '',
}: {
  till: TillTicket;
  lastCharge: LastCharge | null;
  onDismissCharge: () => void;
  onCharge: () => void;
  onStep: (key: string, delta: 1 | -1) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onUndoClear: () => void;
  stale: StaleActions;
  className?: string;
}) {
  const t = useT();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const section = useRef<HTMLElement>(null);
  useFollowScroll(section);
  const { ticket, setAside } = till;
  const count = ticketCount(ticket);
  const total = formatMoney(ticketTotalCents(ticket) / 100);
  const empty = ticket.lines.length === 0;

  return (
    <section
      ref={section}
      aria-labelledby={headingId}
      className={[
        'm-glass w-full shrink-0 flex-col rounded-2xl border border-white/[0.08] lg:max-h-[calc(100dvh-2rem)] lg:w-[17rem]',
        className,
      ].join(' ')}
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5">
        <div className="min-w-0">
          <h2 id={headingId} ref={heading} tabIndex={-1} className="text-base font-semibold text-gray-900 focus:outline-none">
            {t('menu.bill.title')}
          </h2>
          {!empty && <p className="text-xs tabular-nums text-gray-500">{itemsText(t, count)}</p>}
        </div>
        {!empty && (
          <Button variant="ghost" size="sm" className="min-h-9" aria-label={t('menu.bill.clearLabel')} onClick={onClear}>
            {t('menu.bill.clear')}
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {setAside && empty && <SetAsideNote setAside={setAside} onUndo={onUndoClear} onDrop={till.dropSetAside} />}
        {lastCharge && empty && !setAside && <ChargedNote charge={lastCharge} onDismiss={onDismissCharge} layout="column" />}
        <StaleNotice stale={till.stale.pending} actions={stale} fallbackFocus={heading} />
        {empty ? (
          <p className="py-6 text-center text-sm text-gray-500">{t('menu.bill.empty')}</p>
        ) : (
          <BillLines ticket={ticket} stale={till.stale.all} onStep={onStep} onRemove={onRemove} emptyFocus={heading} />
        )}
      </div>

      <footer className="space-y-2.5 border-t border-white/[0.06] px-3 py-3">
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-gray-700">{t('menu.bill.total')}</span>
          <span className="text-xl font-semibold tabular-nums text-gray-900">{total}</span>
        </p>
        <Button className="min-h-12 w-full text-base" aria-haspopup="dialog" disabled={empty} onClick={onCharge}>
          {empty ? t('menu.bill.chargeEmpty') : t('menu.bill.charge', { total })}
        </Button>
      </footer>
    </section>
  );
}

// --- The narrow screen's bar and sheet ---------------------------------------------------

/**
 * Where the bar sits: under the page's column (`anchor`), measured, since it
 * is fixed to the window and the column is not (lib/store/ticket.ts,
 * barFrame). When the column is a sliver, across the room the page has --
 * the `<main>` beside the sidebar -- and never over the sidebar, whose foot
 * is "Sign out". Measured again when the column or the window changes size.
 */
function useBarFrame(anchor: RefObject<HTMLElement>): BarFrame | null {
  const [frame, setFrame] = useState<BarFrame | null>(null);
  useLayoutEffect(() => {
    const el = anchor.current;
    if (!el) return;
    const room = el.closest('main') ?? document.documentElement;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const a = room.getBoundingClientRect();
      const next = barFrame({ left: r.left, right: r.right }, { left: a.left, right: a.right }, window.innerWidth);
      setFrame((f) => (f && f.left === next.left && f.width === next.width && f.compact === next.compact ? f : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    observer?.observe(room);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [anchor]);
  return frame;
}

/** How tall the bar is, so the page can leave that much room under its last row of tiles. */
function useHeight(el: RefObject<HTMLElement>): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const measure = () => setHeight(Math.ceil(node.getBoundingClientRect().height));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  });
  return height;
}

/**
 * The narrow screen's bar at the foot of the window: "3 · 23,30 €", which
 * opens the bill, and "Charge", which opens it on the charge -- one over the
 * other where the room beside the sidebar is narrow. With nothing on the
 * bill it says what just happened -- the charge, the bill cleared or set
 * aside -- and otherwise is not there at all. Hidden from lg up, where the
 * bill has its column. It leaves, in the page, room of its own height under
 * the grid, so it never covers the last row of tiles.
 */
export function TillBar({
  till,
  anchor,
  lastCharge,
  onDismissCharge,
  onOpen,
  onCharge,
  onUndoClear,
}: {
  till: TillTicket;
  anchor: RefObject<HTMLElement>;
  lastCharge: LastCharge | null;
  onDismissCharge: () => void;
  onOpen: () => void;
  onCharge: () => void;
  onUndoClear: () => void;
}) {
  const t = useT();
  const frame = useBarFrame(anchor);
  const bar = useRef<HTMLDivElement>(null);
  const height = useHeight(bar);
  const { ticket, setAside } = till;
  const count = ticketCount(ticket);
  const total = formatMoney(ticketTotalCents(ticket) / 100);
  const empty = ticket.lines.length === 0;
  if (empty && !setAside && !lastCharge) return null;
  const compact = frame?.compact ?? false;
  const review = till.stale.pending.length > 0;

  let content: ReactNode;
  if (!empty) {
    const open = (
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${t('menu.bill.open', { items: itemsText(t, count), total })}${review ? `. ${t('menu.bill.stale.short')}` : ''}`}
        onClick={onOpen}
        className={[
          'flex min-w-0 items-center rounded-xl text-gray-900 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300',
          compact ? 'min-h-11 w-full flex-wrap justify-center gap-x-1.5 gap-y-0.5 px-1 py-1' : 'min-h-12 flex-1 gap-2 px-3 text-left',
        ].join(' ')}
      >
        <span
          className={[
            'grid shrink-0 place-items-center rounded-full bg-brand-600 font-semibold tabular-nums text-white',
            compact ? 'h-6 min-w-6 px-1 text-xs' : 'h-7 min-w-7 px-1.5 text-sm',
          ].join(' ')}
        >
          {count}
        </span>
        <span className={`font-semibold tabular-nums ${compact ? 'text-sm' : 'truncate text-base'}`}>{total}</span>
        {/* The menu changed under the bill: said here too, before "Charge" meets it. */}
        {review && (
          <span className="text-amber-300">
            <WarningIcon />
          </span>
        )}
        {!compact && (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-gray-500">
            <path d="m5 12.5 5-5 5 5" />
          </svg>
        )}
      </button>
    );
    const charge = (
      <Button className={compact ? 'min-h-11 w-full px-2 text-sm' : 'min-h-12 shrink-0 px-5 text-base'} aria-haspopup="dialog" onClick={onCharge}>
        {t('menu.bill.chargeEmpty')}
      </Button>
    );
    content = compact ? (
      <div className="flex w-full flex-col gap-1">
        {open}
        {charge}
      </div>
    ) : (
      <>
        {open}
        {charge}
      </>
    );
  } else if (setAside) {
    content =
      setAside.why === 'cleared' ? (
        <div className={`flex min-h-12 flex-1 flex-wrap items-center gap-x-2 gap-y-1 px-2 text-sm text-gray-700 ${compact ? 'justify-center py-1 text-center' : 'justify-between'}`}>
          <span>{t('menu.bill.cleared')}</span>
          <button type="button" onClick={onUndoClear} className={LINK_BUTTON}>
            {t('menu.bill.undo')}
          </button>
        </div>
      ) : (
        <div className="w-full">
          <SetAsideNote setAside={setAside} onUndo={onUndoClear} onDrop={till.dropSetAside} short />
        </div>
      );
  } else if (lastCharge) {
    content = compact ? (
      <ChargedNote charge={lastCharge} onDismiss={onDismissCharge} layout="stacked" />
    ) : (
      <div className="flex min-h-12 min-w-0 flex-1 items-center px-2">
        <ChargedNote charge={lastCharge} onDismiss={onDismissCharge} layout="bar" />
      </div>
    );
  }

  const style: CSSProperties = frame ? { left: frame.left, width: frame.width } : { left: 8, right: 8 };
  return (
    <>
      <div aria-hidden="true" className="lg:hidden" style={{ height: height + 16 }} />
      {createPortal(
        <div ref={bar} className="fixed bottom-0 z-30 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden" style={style}>
          <div className={`m-toast-in m-glass-float flex items-center gap-2 rounded-2xl border border-white/10 ${compact ? 'p-1' : 'p-1.5'}`}>
            {content}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** How long the closed sheet stays to play its exit; .m-pop-out lasts 170ms. */
const SHEET_EXIT_MS = 180;

/**
 * The narrow screen's bill, in a sheet rising from the foot of the window: a
 * dialog in every other way, as Modal is -- Escape and the backdrop close it,
 * focus goes in and back to the bar, and Tab goes round inside it. On
 * "Charge" it turns into the charge, and "Back to the order" turns it back.
 */
export function TillSheet({
  open,
  view,
  till,
  charge,
  announcement,
  onClose,
  onView,
  onStep,
  onRemove,
  onClear,
  onUndoClear,
  stale,
}: {
  open: boolean;
  view: 'bill' | 'charge';
  till: TillTicket;
  charge: TillCharge;
  /** The page's last words, said from in here while the sheet is open (it hides the page). */
  announcement: string;
  onClose: () => void;
  onView: (view: 'bill' | 'charge') => void;
  onStep: (key: string, delta: 1 | -1) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onUndoClear: () => void;
  stale: StaleActions;
}) {
  const t = useT();
  const phase = usePresence(open, SHEET_EXIT_MS);
  const closing = phase === 'closing';
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(panel, phase === 'open');
  useInert(root, closing);
  // Not while a charge is on its way, as the charge's own dialog.
  const close = () => {
    if (phase === 'open' && !charge.busy) onClose();
  };
  const backdropClose = useBackdropClose(close, !closing);
  const heading = useRef<HTMLHeadingElement>(null);

  if (phase === 'closed') return null;

  const { ticket } = till;
  const empty = ticket.lines.length === 0;
  const total = formatMoney(ticketTotalCents(ticket) / 100);
  const charging = view === 'charge';

  return createPortal(
    <div
      ref={root}
      aria-hidden={closing ? true : undefined}
      className={['fixed inset-0 z-50 flex items-end justify-center', closing ? 'pointer-events-none' : ''].join(' ')}
      onKeyDown={(e) => {
        if (!closing) dialogKeys(e, panel.current, close);
      }}
    >
      <div
        aria-hidden="true"
        className={['absolute inset-0 bg-[rgb(4_9_8/0.72)]', closing ? 'm-scrim-out' : 'm-scrim-in'].join(' ')}
        {...backdropClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal={closing ? undefined : true}
        aria-labelledby={titleId}
        tabIndex={-1}
        className={[
          'm-glass-float relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-2xl border border-b-0 border-white/10 focus:outline-none',
          closing ? 'm-pop-out' : 'm-pop',
        ].join(' ')}
        style={{ '--origin': '50% 100%' } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} ref={heading} tabIndex={-1} className="text-base font-semibold text-gray-900 focus:outline-none">
              {charging ? t('menu.charge.title') : t('menu.bill.title')}
            </h2>
            {!charging && !empty && <p className="text-xs tabular-nums text-gray-500">{itemsText(t, ticketCount(ticket))}</p>}
          </div>
          <div className="flex items-center gap-1">
            {!charging && !empty && (
              <Button variant="ghost" size="sm" className="min-h-9" aria-label={t('menu.bill.clearLabel')} onClick={onClear}>
                {t('menu.bill.clear')}
              </Button>
            )}
            <button
              type="button"
              onClick={close}
              aria-label={t('common.modal.close')}
              className="grid h-9 w-9 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="m-close-x">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {charging ? (
            <ChargeBody
              ctl={charge}
              before={<StaleNotice stale={till.stale.pending} actions={stale} fallbackFocus={heading} />}
            />
          ) : empty ? (
            <>
              {till.setAside && <SetAsideNote setAside={till.setAside} onUndo={onUndoClear} onDrop={till.dropSetAside} />}
              <p className="py-6 text-center text-sm text-gray-500">{t('menu.bill.empty')}</p>
            </>
          ) : (
            <>
              <StaleNotice stale={till.stale.pending} actions={stale} fallbackFocus={heading} />
              <BillLines ticket={ticket} stale={till.stale.all} onStep={onStep} onRemove={onRemove} emptyFocus={heading} />
            </>
          )}
        </div>

        <footer className="border-t border-white/[0.06] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          {charging ? (
            <ChargeActions ctl={charge} onCancel={() => onView('bill')} cancelLabel={t('menu.charge.back')} />
          ) : (
            <div className="space-y-2.5">
              <p className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-gray-700">{t('menu.bill.total')}</span>
                <span className="text-xl font-semibold tabular-nums text-gray-900">{total}</span>
              </p>
              <Button className="min-h-12 w-full text-base" disabled={empty} onClick={() => onView('charge')}>
                {empty ? t('menu.bill.chargeEmpty') : t('menu.bill.charge', { total })}
              </Button>
            </div>
          )}
        </footer>
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </p>
      </div>
    </div>,
    document.body,
  );
}
