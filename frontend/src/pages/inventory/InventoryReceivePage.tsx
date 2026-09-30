import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  formatQuantity,
  parsePositiveQuantity,
  useAddInventoryBarcode,
  useCreateInventoryItem,
  useCreateInventoryReceipt,
  useInventoryItems,
  useInventoryReceipts,
  useUpdateInventoryItem,
  type InventoryItem,
  type InventoryReceipt,
} from '../../api/inventory';
import { useAuth } from '../../auth/useAuth';
import { useCan } from '../../auth/useCan';
import { getErrorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { attachKeyboardWedge } from '../../lib/inventory/keyboardWedge';
import {
  addManual,
  afterSaved,
  buildCodeIndex,
  dismissPending,
  emptySession,
  remove,
  resolveKnown,
  resolvePending,
  restoreRemoved,
  scan,
  setQuantity,
  totals,
  undo,
  undoable,
  type CodeIndex,
  type PendingCode,
  type ReceiveEvent,
  type ReceiveLine,
  type ReceiveSession,
} from '../../lib/inventory/receiveSession';
import {
  browserStorage,
  clearReceiveDraft,
  newClientRef,
  readReceiveDraft,
  saveReceiveDraft,
  type DraftScope,
} from '../../lib/inventory/receiveDraft';
import { scanFeedback, unlockScanFeedback } from '../../lib/inventory/scanFeedback';
import { archivedCodeOptions, existingChoice, unknownCodeOptions } from '../../lib/inventory/unknownCode';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Modal } from '../../components/Modal';
import { Spinner, StateMessage } from '../../components/StateMessage';
import { CameraScanner } from '../../components/inventory/CameraScanner';
import { SquarePhoto } from '../../components/photo/SquarePhoto';

// Receiving a delivery: the manager scans every box off the truck -- with a
// scanner gun, or the phone's camera -- and saves it as one entry, which adds
// to the stock.
//
// Full screen, outside the dashboard's layout: this is used standing next to
// a truck with a phone in one hand, and the layout's sidebar takes 256 px of a
// 375 px screen. Built for that phone first:
//
// - No field takes the focus on its own on a touch screen: a focused field
//   opens the on-screen keyboard over half the screen for every box. A
//   scanner gun is heard on the window instead (lib/inventory/keyboardWedge).
//   With a mouse, the code field does take it, and the gun types into it.
// - Every scan answers three ways: a beep (or two low ones for a code it does
//   not know), the line lighting up with what it added, and a sentence for
//   screen readers -- because the manager is looking at the boxes, not at
//   the screen.
// - Nothing is lost when the phone locks and the browser kills the tab: every
//   change is written to a draft at once, and it comes back on its own.
// - A gun fired while a text field has the focus is still a scan, not text:
//   the burst is taken out of the field (keyboardWedge), so a barcode never
//   becomes a product's name or a supplier.
// - One delivery is one entry, however the save goes (see "Saving" below),
//   and after it the manager stays here, on the phone-sized screen, with
//   what was saved and a way to receive the next one.
//
// The rules of the session -- what a scan adds, what undo takes back, what
// waits for an answer -- are in lib/inventory/receiveSession.ts, with tests.

/** How long a scanned line stays lit. */
const FLASH_MS = 1400;

/** The multipliers offered for the next scan: five cases of the same, twelve packs... */
const MULTIPLIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 16, 20, 24, 30, 36, 40, 48, 50, 60, 72, 96, 100];

/** Now, as a datetime-local input wants it: local time, no seconds. */
function nowLocalInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Whether the main pointer is a mouse: there, focusing a field opens no keyboard. */
function hasFinePointer(): boolean {
  try {
    return window.matchMedia('(pointer: fine)').matches;
  } catch {
    return false;
  }
}

/** Whether the main pointer is a finger. */
function hasCoarsePointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function matches(item: InventoryItem, needle: string): boolean {
  return (
    item.name.toLocaleLowerCase().includes(needle) ||
    (item.category ?? '').toLocaleLowerCase().includes(needle)
  );
}

/** The `.one` or `.other` of a key, by count: both languages split at 1. */
function countKey(key: string, count: number): string {
  return `${key}.${count === 1 ? 'one' : 'other'}`;
}

export function InventoryReceivePage() {
  const t = useT();
  const { user } = useAuth();
  // Creating a product, saving a code on one and bringing one back are
  // editing products (lib/access.ts): the manager's. Anybody else receiving
  // says which product a code is for this delivery only (lib/inventory/unknownCode.ts).
  const canProducts = useCan()('inventory.products');
  // One draft per person and workspace; with nobody signed in there is
  // nowhere safe to keep one, and none is kept.
  const scope = useMemo<DraftScope | null>(
    () => (user ? { orgId: user.org_id, userId: user.id } : null),
    [user],
  );
  // Archived products too: their codes still resolve, to offer them back.
  const items = useInventoryItems(true);
  const storage = useMemo(browserStorage, []);
  const finePointer = useMemo(hasFinePointer, []);
  // On a touch screen nothing takes the focus unasked: a focused field opens
  // the keyboard over the list, and a gun fired then types into it.
  const coarsePointer = useMemo(hasCoarsePointer, []);

  // Products created on this screen, until the product list comes back with them.
  const [created, setCreated] = useState<InventoryItem[]>([]);
  const allItems = useMemo(() => {
    const server = items.data ?? [];
    const known = new Set(server.map((i) => i.id));
    return [...server, ...created.filter((c) => !known.has(c.id))];
  }, [items.data, created]);
  const byId = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems]);
  const index = useMemo(() => buildCodeIndex(allItems), [allItems]);
  const indexRef = useRef(index);
  indexRef.current = index;

  // --- The session --------------------------------------------------------
  //
  // Held in a ref as well as in state: a scan is worked out from the session
  // as it is at that instant, and its beep and its highlight from the result
  // -- outside any setState updater, which React may run twice.
  const [session, setSession] = useState<ReceiveSession>(emptySession);
  const sessionRef = useRef(session);
  // The draft is written only once whatever was stored has been read back:
  // before that, the empty session would overwrite it.
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);

  const writeDraft = useCallback(
    (s: ReceiveSession) => {
      if (scope) saveReceiveDraft(storage, scope, s);
    },
    [storage, scope],
  );

  const commit = useCallback(
    (next: ReceiveSession) => {
      if (next === sessionRef.current) return;
      sessionRef.current = next;
      setSession(next);
      if (readyRef.current) writeDraft(next);
    },
    [writeDraft],
  );

  // A draft left from before (the tab was killed, the manager stepped out to
  // Stock) comes back on its own, without the products deleted since.
  const [restored, setRestored] = useState<{ savedAt: string; products: number; dropped: number } | null>(null);
  useEffect(() => {
    if (ready || items.data === undefined) return;
    const draft = scope ? readReceiveDraft(storage, scope, (id) => byId.has(id)) : null;
    if (draft) {
      sessionRef.current = draft.session;
      setSession(draft.session);
      setRestored({ savedAt: draft.savedAt, products: draft.session.lines.length, dropped: draft.dropped });
      // Written back at once, so what was dropped stays dropped.
      writeDraft(draft.session);
    } else if (scope) {
      clearReceiveDraft(storage, scope);
    }
    readyRef.current = true;
    setReady(true);
  }, [ready, items.data, storage, scope, byId, writeDraft]);

  // --- Scanning -----------------------------------------------------------

  const [multiplier, setMultiplier] = useState(1);
  const multiplierRef = useRef(1);
  multiplierRef.current = multiplier;
  const [flash, setFlash] = useState<{ itemId: string; seq: number } | null>(null);
  const [camera, setCamera] = useState(false);
  const scanField = useRef<HTMLInputElement>(null);
  const qtyFields = useRef(new Map<string, HTMLInputElement>());
  // What is being typed over a line's quantity, exactly as typed.
  const [typed, setTyped] = useState<Record<string, string>>({});

  // The save dialog, and the entry just saved. While the dialog is open a
  // scan adds nothing: it would land in an entry that is being closed.
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogOpenRef = useRef(false);
  const [blockedScan, setBlockedScan] = useState(false);
  const [saved, setSaved] = useState<InventoryReceipt | null>(null);
  const savedRef = useRef<InventoryReceipt | null>(null);
  savedRef.current = saved;

  const focusScanField = useCallback(() => {
    if (finePointer) scanField.current?.focus();
  }, [finePointer]);

  useEffect(() => {
    if (ready) focusScanField();
  }, [ready, focusScanField]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(id);
  }, [flash]);

  const clearTyped = (itemId: string) =>
    setTyped((prev) => {
      if (!(itemId in prev)) return prev;
      const { [itemId]: _gone, ...rest } = prev;
      return rest;
    });

  /** What the page does after the session answered: the sound and the light. */
  const react = useCallback((event: ReceiveEvent | null, beep = true) => {
    if (!event) return;
    if (event.kind === 'added') {
      if (beep) scanFeedback('known');
      setFlash({ itemId: event.itemId, seq: event.seq });
      clearTyped(event.itemId);
    } else if (beep && (event.kind === 'unknown' || event.kind === 'archived')) {
      scanFeedback('unknown');
    }
  }, []);

  const onCode = useCallback(
    (code: string) => {
      if (dialogOpenRef.current) {
        // Heard, and said so -- the low beep and a line in the dialog --
        // but not added: never to a session about to be saved and cleared.
        scanFeedback('unknown');
        setBlockedScan(true);
        return;
      }
      // Scanning again after a save is the next delivery.
      if (savedRef.current) setSaved(null);
      const before = sessionRef.current;
      const next = scan(before, indexRef.current, code, multiplierRef.current);
      if (next === before) return;
      commit(next);
      react(next.last);
      // Scanning on is the answer to "you were in the middle of one".
      setRestored(null);
      // The multiplier is for the next scan only.
      if (multiplierRef.current !== 1) {
        multiplierRef.current = 1;
        setMultiplier(1);
      }
    },
    [commit, react],
  );

  // The gun, heard on the window: with no field focused, and as a burst into
  // any text field of the screen -- the dialog's included, where it would
  // otherwise have become the supplier (lib/inventory/keyboardWedge).
  useEffect(() => {
    if (!ready) return;
    return attachKeyboardWedge(window, onCode);
  }, [ready, onCode]);

  // A code waiting for an answer that the product list now knows (resolved
  // on another phone, added on the Stock screen, a product brought back) is
  // resolved on its own when the list comes back.
  useEffect(() => {
    if (!ready) return;
    const next = resolveKnown(sessionRef.current, index);
    if (next === sessionRef.current) return;
    commit(next);
    react(next.last, false);
  }, [ready, index, commit, react]);

  const [code, setCode] = useState('');
  const submitCode = (e?: FormEvent) => {
    e?.preventDefault();
    if (!code.trim()) return;
    onCode(code);
    setCode('');
  };
  const onScanFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Taken already as a gun's burst (keyboardWedge put the field back).
    if (e.defaultPrevented) return;
    // A gun set to end codes with Tab: the code is read, and the focus stays
    // here for the next one instead of wandering off to the next control.
    if (e.key === 'Tab' && !e.shiftKey && code.trim()) {
      e.preventDefault();
      submitCode();
    }
  };

  const doUndo = () => {
    commit(undo(sessionRef.current));
    focusScanField();
  };

  // --- Codes waiting for an answer ---------------------------------------

  const resolve = (pending: PendingCode, itemId: string, unitsPerScan: number, label: string | null) => {
    const next = resolvePending(sessionRef.current, pending.key, { itemId, unitsPerScan, label });
    commit(next);
    react(next.last);
    focusScanField();
  };
  const dismiss = (pending: PendingCode) => {
    commit(dismissPending(sessionRef.current, pending.key));
    focusScanField();
  };

  // --- By hand -----------------------------------------------------------

  const [manualOpen, setManualOpen] = useState(false);
  const addByHand = (itemId: string) => {
    commit(addManual(sessionRef.current, itemId));
    setManualOpen(false);
    setFlash({ itemId, seq: sessionRef.current.seq });
    // With a mouse, straight into its quantity: that is the next thing to do
    // with it. On a touch screen the manager taps it when they are ready.
    if (coarsePointer) return;
    window.requestAnimationFrame(() => {
      const field = qtyFields.current.get(itemId);
      field?.focus();
      field?.select();
    });
  };

  const onTypeQuantity = (itemId: string, text: string) => {
    setTyped((prev) => ({ ...prev, [itemId]: text }));
    const value = parsePositiveQuantity(text);
    if (value !== null) commit(setQuantity(sessionRef.current, itemId, value));
  };
  const onQuantityKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.defaultPrevented) return;
    // Done with this line: back to scanning.
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
      focusScanField();
    }
  };
  const onQuantityBlur = (itemId: string) => {
    const text = typed[itemId];
    if (text !== undefined && parsePositiveQuantity(text) !== null) clearTyped(itemId);
  };

  const removeLine = (itemId: string) => {
    commit(remove(sessionRef.current, itemId));
    clearTyped(itemId);
  };

  // --- Saving -------------------------------------------------------------
  //
  // Three things keep one delivery from becoming two entries:
  // - `sending`, set before anything renders: two taps in the same tick
  //   would otherwise both get past a button that is only disabled on the
  //   next render;
  // - the session's `clientRef`, stored in the draft BEFORE the request
  //   leaves: a save whose answer is lost is retried with the same ref, and
  //   the server hands back the entry it already has;
  // - the draft is settled inside the mutation (`onSaved`), the moment the
  //   server has the entry -- not in a callback of `mutate()`, which does not
  //   run once this screen is gone.
  const sending = useRef(false);
  const settle = useCallback(
    (receipt: InventoryReceipt) => {
      // What the entry did not take stays: a new session, with a new ref.
      const rest = afterSaved(sessionRef.current, receipt.lines);
      sessionRef.current = rest;
      setSession(rest);
      writeDraft(rest);
    },
    [writeDraft],
  );
  const settleRef = useRef(settle);
  settleRef.current = settle;
  const saveReceipt = useCreateInventoryReceipt({ onSaved: (receipt) => settleRef.current(receipt) });
  const busy = saveReceipt.isPending;

  const [receivedAt, setReceivedAt] = useState(nowLocalInput);
  // Untouched, the entry is saved at the moment it is saved, to the second:
  // the field cuts to the minute, and an entry saved in the same minute as a
  // count would otherwise not add to it (entries count after a count, not at).
  const [receivedAtTouched, setReceivedAtTouched] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [note, setNote] = useState('');
  const invalidLines = session.lines.filter((l) => {
    const text = typed[l.itemId];
    return text !== undefined && parsePositiveQuantity(text) === null;
  });
  const sum = totals(session, (id) => byId.get(id)?.unit ?? null);

  const openDialog = (open: boolean) => {
    dialogOpenRef.current = open;
    setDialogOpen(open);
    setBlockedScan(false);
  };
  const openSave = () => {
    if (busy || session.lines.length === 0 || invalidLines.length > 0) return;
    // The camera would go on reading behind the dialog, every read lost.
    setCamera(false);
    if (!receivedAtTouched) setReceivedAt(nowLocalInput());
    saveReceipt.reset();
    openDialog(true);
  };
  const closeSave = () => {
    if (busy) return;
    openDialog(false);
    focusScanField();
  };

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    if (sending.current) return;
    const current = sessionRef.current;
    if (current.lines.length === 0) return;
    sending.current = true;
    const clientRef = current.clientRef ?? newClientRef();
    if (current.clientRef !== clientRef) commit({ ...current, clientRef });
    saveReceipt.mutate(
      {
        client_ref: clientRef,
        received_at: receivedAtTouched ? new Date(receivedAt).toISOString() : new Date().toISOString(),
        supplier: supplier.trim() || null,
        note: note.trim() || null,
        lines: current.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity })),
      },
      {
        onSuccess: (receipt) => {
          // The draft is settled already (settle); what is left is showing
          // what was saved, here, without leaving the full-screen page.
          setSaved(receipt);
          setRestored(null);
          setTyped({});
          setSupplier('');
          setNote('');
          setReceivedAtTouched(false);
          openDialog(false);
          window.scrollTo(0, 0);
        },
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  };

  const discardDraft = () => {
    const empty = emptySession();
    sessionRef.current = empty;
    setSession(empty);
    setTyped({});
    if (scope) clearReceiveDraft(storage, scope);
    setRestored(null);
  };

  // --- Drawing ------------------------------------------------------------

  const nameOf = (itemId: string) => byId.get(itemId)?.name ?? t('inventory.receive.unknownProduct');
  const firstPending = session.pending[0] ?? null;
  const activeItems = allItems.filter((i) => i.archived_at === null);
  const categories = useMemo(
    () => [...new Set(allItems.map((i) => i.category).filter((c): c is string => c !== null))].sort(),
    [allItems],
  );
  const undoRecord = undoable(session);

  return (
    // Any tap wakes the audio for the gun's beeps (iOS keeps it asleep until a gesture).
    <div className="relative" onPointerDown={unlockScanFeedback}>
      {/* Inside the app's layout. On a phone the sidebar steps aside for
          this screen (DashboardLayout), so it is a bar with the way back to
          the stock; from `md` up the sidebar is the way back, and this is
          the page's title like any other, where every other page has it. */}
      <header className="border-b border-white/[0.08] bg-surface/95 md:border-0 md:bg-transparent">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-2 py-1.5 sm:px-4 md:mx-0 md:px-0 md:py-0">
          <Link
            to="/inventory"
            aria-label={t('inventory.receive.backLabel')}
            // Not while an entry is being saved: the save would carry on,
            // but the manager would not see how it ended.
            aria-disabled={busy || undefined}
            onClick={(e) => {
              if (busy) e.preventDefault();
            }}
            className={[
              'inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-brand-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 md:hidden',
              busy ? 'pointer-events-none opacity-50' : '',
            ].join(' ')}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
              <path
                fillRule="evenodd"
                d="M12.8 4.2a.75.75 0 010 1.06L8.06 10l4.74 4.74a.75.75 0 11-1.06 1.06l-5.27-5.27a.75.75 0 010-1.06l5.27-5.27a.75.75 0 011.06 0z"
                clipRule="evenodd"
              />
            </svg>
            {t('inventory.receive.back')}
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900 sm:text-lg md:text-2xl md:tracking-tight">
            {t('inventory.receive.title')}
          </h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 pb-32 pt-4 md:mx-0 md:px-0 md:pt-6">
        {items.data === undefined ? (
          items.isError ? (
            <div className="space-y-3">
              <StateMessage
                tone="error"
                title={t('inventory.stock.loadError')}
                description={getErrorMessage(items.error)}
              />
              <div className="flex justify-center">
                <Button variant="secondary" className="min-h-11" onClick={() => void items.refetch()}>
                  {t('inventory.receive.retry')}
                </Button>
              </div>
            </div>
          ) : (
            <Spinner />
          )
        ) : saved ? (
          <SavedPanel
            receipt={saved}
            restProducts={session.lines.length}
            restPending={session.pending.length}
            onAnother={() => {
              setSaved(null);
              focusScanField();
            }}
          />
        ) : (
          <>
            {/* A reload that failed is not a reason to stop receiving: the
                list already here still resolves every code in it. */}
            {items.isError && (
              <div
                role="status"
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-gray-800"
              >
                <p className="min-w-0 flex-1">{t('inventory.receive.staleError')}</p>
                <Button
                  variant="secondary"
                  className="min-h-11"
                  disabled={items.isFetching}
                  onClick={() => void items.refetch()}
                >
                  {t('inventory.receive.retry')}
                </Button>
              </div>
            )}

            {restored && (
              <RestoredNotice
                savedAt={restored.savedAt}
                products={restored.products}
                pending={session.pending.length}
                dropped={restored.dropped}
                onKeep={() => setRestored(null)}
                onDiscard={discardDraft}
              />
            )}

            {/* --- Where codes come in --------------------------------- */}
            <section
              aria-labelledby="receive-scan-title"
              className="rounded-lg border border-gray-200 bg-surface p-4 shadow-sm"
            >
              <h2 id="receive-scan-title" className="sr-only">
                {t('inventory.receive.scanTitle')}
              </h2>
              <form onSubmit={submitCode}>
                <label htmlFor="receive-code" className="text-sm font-medium text-gray-700">
                  {t('inventory.receive.codeLabel')}
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    ref={scanField}
                    id="receive-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={onScanFieldKey}
                    disabled={!ready}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    enterKeyHint="done"
                    aria-describedby="receive-code-help"
                    className="m-field min-h-11 min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 font-mono text-base text-gray-900 placeholder:font-sans placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-200 disabled:bg-gray-100"
                  />
                  <Button type="submit" variant="secondary" className="min-h-11" disabled={!ready || !code.trim()}>
                    {t('inventory.receive.addCode')}
                  </Button>
                </div>
                <p id="receive-code-help" className="mt-1 text-xs text-gray-500">
                  {t('inventory.receive.codeHelp')}
                </p>
              </form>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="receive-multiplier">
                  {t('inventory.receive.multiplierLabel')}
                </label>
                <select
                  id="receive-multiplier"
                  value={multiplier}
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    multiplierRef.current = m;
                    setMultiplier(m);
                    focusScanField();
                  }}
                  className={[
                    'min-h-11 rounded-md border px-3 text-sm font-semibold tabular-nums focus:outline-none focus:ring-[3px] focus:ring-brand-200',
                    multiplier === 1
                      ? 'border-gray-300 bg-surface text-gray-800'
                      : 'border-brand-500 bg-brand-50 text-brand-800',
                  ].join(' ')}
                >
                  {MULTIPLIERS.map((m) => (
                    <option key={m} value={m}>
                      {t('inventory.receive.times', { count: m })}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant={camera ? 'secondary' : 'primary'}
                  className="min-h-11 flex-1 sm:flex-none"
                  disabled={!ready}
                  onClick={() => setCamera((open) => !open)}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
                    <path
                      fillRule="evenodd"
                      d="M1 8a2 2 0 012-2h.93a2 2 0 001.66-.89l.82-1.22A2 2 0 018.07 3h3.86a2 2 0 011.66.89l.82 1.22A2 2 0 0016.07 6H17a2 2 0 012 2v7a2 2 0 01-2 2H3a2 2 0 01-2-2V8zm13.5 3a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM10 14a3 3 0 100-6 3 3 0 000 6z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {camera ? t('inventory.receive.cameraClose') : t('inventory.receive.camera')}
                </Button>
              </div>
              {multiplier !== 1 && (
                <p className="m-fade mt-2 text-xs font-medium text-brand-800">
                  {t('inventory.receive.multiplierOn', { count: multiplier })}
                </p>
              )}

              {camera && (
                <CameraScanner
                  className="mt-3"
                  onCode={onCode}
                  onClose={() => {
                    setCamera(false);
                    focusScanField();
                  }}
                />
              )}

              <LastScan
                event={session.last}
                nameOf={nameOf}
                units={(id) => byId.get(id)?.unit ?? null}
                total={(id) => session.lines.find((l) => l.itemId === id)?.quantity ?? null}
                undoLabel={
                  undoRecord
                    ? t('inventory.receive.undoWhat', {
                        quantity: formatQuantity(undoRecord.quantity),
                        name: nameOf(undoRecord.itemId),
                      })
                    : null
                }
                hasLines={session.lines.length > 0}
                canRestore={session.removed !== null}
                onUndo={doUndo}
                onRestore={() => commit(restoreRemoved(sessionRef.current))}
              />
            </section>

            {/* --- A code it does not know, or of an archived product -- */}
            {firstPending &&
              (firstPending.archivedItemId !== null && byId.has(firstPending.archivedItemId) ? (
                <ArchivedCard
                  key={firstPending.key}
                  pending={firstPending}
                  item={byId.get(firstPending.archivedItemId)!}
                  unitsPerScan={index.get(firstPending.key)?.unitsPerScan ?? 1}
                  label={index.get(firstPending.key)?.label ?? null}
                  more={session.pending.length - 1}
                  canProducts={canProducts}
                  onResolved={resolve}
                  onIgnore={() => dismiss(firstPending)}
                />
              ) : (
                <UnknownCodeCard
                  key={firstPending.key}
                  pending={firstPending}
                  products={activeItems}
                  categories={categories}
                  index={index}
                  nameOf={nameOf}
                  autoFocus={!coarsePointer}
                  more={session.pending.length - 1}
                  canProducts={canProducts}
                  onCreated={(item) => setCreated((prev) => [...prev, item])}
                  onResolved={resolve}
                  onIgnore={() => dismiss(firstPending)}
                />
              ))}

            {/* --- What has come in ------------------------------------- */}
            <section aria-labelledby="receive-lines-title" className="rounded-lg border border-gray-200 bg-surface shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                <h2 id="receive-lines-title" className="text-sm font-semibold text-gray-900">
                  {t('inventory.receive.linesTitle')}
                </h2>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-11 px-3"
                  aria-expanded={manualOpen}
                  aria-controls="receive-manual"
                  onClick={() => setManualOpen((open) => !open)}
                  disabled={!ready}
                >
                  {t('inventory.receive.manual')}
                </Button>
              </div>
              {manualOpen && (
                <ManualPicker
                  id="receive-manual"
                  products={activeItems}
                  autoFocus={!coarsePointer}
                  canProducts={canProducts}
                  onPick={addByHand}
                  onClose={() => {
                    setManualOpen(false);
                    focusScanField();
                  }}
                />
              )}
              {session.lines.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm font-medium text-gray-700">{t('inventory.receive.empty.title')}</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
                    {t('inventory.receive.empty.description')}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {session.lines.map((line) => (
                    <LineRow
                      key={line.itemId}
                      line={line}
                      item={byId.get(line.itemId)}
                      fallbackName={nameOf(line.itemId)}
                      typed={typed[line.itemId]}
                      flash={flash?.itemId === line.itemId ? flash.seq : null}
                      added={
                        flash?.itemId === line.itemId && session.last?.kind === 'added'
                          ? session.last.quantity
                          : null
                      }
                      fieldRef={(el) => {
                        if (el) qtyFields.current.set(line.itemId, el);
                        else qtyFields.current.delete(line.itemId);
                      }}
                      onType={(text) => onTypeQuantity(line.itemId, text)}
                      onKeyDown={onQuantityKey}
                      onBlur={() => onQuantityBlur(line.itemId)}
                      onRemove={() => removeLine(line.itemId)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      {/* --- Always in reach of the thumb ------------------------------- */}
      {/* On the window itself, not inside the page: while the page arrives
          the layout moves it with a transform, and a transform on an
          ancestor would carry a `fixed` bar along with it, a jump when it
          ends. Clear of the sidebar from `md` up, where there is one, and
          with the layout's column inside it, so what it holds lines up with
          the page above it. */}
      {!saved &&
        createPortal(
          <footer className="m-fade fixed inset-x-0 bottom-0 z-20 border-t border-white/[0.08] bg-surface/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:left-64 md:px-0">
            <div className="mx-auto max-w-6xl md:px-6">
              <div className="mx-auto flex max-w-2xl items-center gap-3 md:mx-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm tabular-nums text-gray-900">
                    <Summary products={sum.products} total={sum.total} />
                  </p>
                  {invalidLines.length > 0 && (
                    <p className="text-xs font-medium text-red-700">{t('inventory.receive.invalidLines')}</p>
                  )}
                </div>
                <Button
                  className="min-h-11 shrink-0"
                  onClick={openSave}
                  disabled={!ready || busy || session.lines.length === 0 || invalidLines.length > 0}
                >
                  {t('inventory.receive.save')}
                </Button>
              </div>
            </div>
          </footer>,
          document.body,
        )}

      <SaveDialog
        open={dialogOpen}
        onClose={closeSave}
        products={sum.products}
        total={sum.total}
        pending={session.pending.length}
        receivedAt={receivedAt}
        onReceivedAt={(v) => {
          setReceivedAt(v);
          setReceivedAtTouched(true);
        }}
        supplier={supplier}
        onSupplier={setSupplier}
        note={note}
        onNote={setNote}
        busy={busy}
        blockedScan={blockedScan}
        error={saveReceipt.isError ? getErrorMessage(saveReceipt.error) : null}
        onSubmit={onSave}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * "12 productos", and "· 30 latas" only when there are several lines, all in
 * the same unit: one line's total is that line, and bottles plus kilos is not
 * a number.
 */
function Summary({
  products,
  total,
}: {
  products: number;
  total: { quantity: number; unit: string | null } | null;
}) {
  const t = useT();
  return (
    <>
      <span className="font-semibold">
        {t(countKey('inventory.receive.summary.products', products), { count: products })}
      </span>
      {total && products > 1 && (
        <>
          {' · '}
          {total.unit
            ? `${formatQuantity(total.quantity)} ${total.unit}`
            : t(countKey('inventory.receive.summary.units', total.quantity), {
                count: formatQuantity(total.quantity),
              })}
        </>
      )}
    </>
  );
}

function RestoredNotice({
  savedAt,
  products,
  pending,
  dropped,
  onKeep,
  onDiscard,
}: {
  savedAt: string;
  products: number;
  pending: number;
  dropped: number;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  return (
    <div role="status" className="m-pop rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-gray-800">
      <p className="font-medium">
        {t(countKey('inventory.receive.restored', products), { date: formatDateTime(savedAt), count: products })}
      </p>
      {pending > 0 && (
        <p className="mt-1 text-gray-600">
          {t(countKey('inventory.receive.restoredPending', pending), { count: pending })}
        </p>
      )}
      {dropped > 0 && (
        <p className="mt-1 text-gray-600">
          {t(countKey('inventory.receive.restoredDropped', dropped), { count: dropped })}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {confirming ? (
          <>
            <span className="w-full text-gray-700">{t('inventory.receive.discardConfirm')}</span>
            <Button variant="danger" className="min-h-11" onClick={onDiscard}>
              {t('inventory.receive.discardYes')}
            </Button>
            <Button variant="secondary" className="min-h-11" onClick={() => setConfirming(false)}>
              {t('inventory.receive.discardNo')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" className="min-h-11" onClick={onKeep}>
              {t('inventory.receive.keep')}
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={() => setConfirming(true)}>
              {t('inventory.receive.discard')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What the last scan did, said in words: seen under the field, and read out
 * by a screen reader. The region is always mounted -- one that appears with
 * its text already inside is often not announced -- and each sentence carries
 * the line's new total, so two scans of the same box are two different
 * sentences and both get read.
 *
 * Undo is offered only right after a scan it would take back, and says which
 * ("Undo +24 Coca-Cola"): after anything else, it would be undoing something
 * the manager is no longer looking at.
 */
function LastScan({
  event,
  nameOf,
  units,
  total,
  undoLabel,
  hasLines,
  canRestore,
  onUndo,
  onRestore,
}: {
  event: ReceiveEvent | null;
  nameOf: (itemId: string) => string;
  units: (itemId: string) => string | null;
  total: (itemId: string) => number | null;
  /** "Deshacer +24 Coca-Cola", when the last thing was a scan; null otherwise. */
  undoLabel: string | null;
  /** Lines already there with no event yet: a draft just restored. */
  hasLines: boolean;
  canRestore: boolean;
  onUndo: () => void;
  onRestore: () => void;
}) {
  const t = useT();
  let icon: 'ok' | 'ask' | 'undo' | null = null;
  let text = '';
  let detail = '';
  if (event) {
    if (event.kind === 'added') {
      icon = 'ok';
      text = t('inventory.receive.announce.added', {
        quantity: formatQuantity(event.quantity),
        name: nameOf(event.itemId),
      });
      const parts: string[] = [];
      if (event.label) {
        parts.push(
          event.multiplier > 1
            ? t('inventory.receive.announce.timesLabel', { count: event.multiplier, label: event.label })
            : event.label,
        );
      } else if (event.multiplier > 1) {
        parts.push(t('inventory.receive.times', { count: event.multiplier }));
      }
      const now = total(event.itemId);
      if (now !== null) {
        // "72 latas en esta entrada", but never "1 latas": a unit is the
        // product's own word, always plural, so the one case leaves it out.
        const unit = units(event.itemId);
        parts.push(
          now === 1
            ? t('inventory.receive.announce.total.one')
            : t('inventory.receive.announce.total.other', {
                quantity: unit ? `${formatQuantity(now)} ${unit}` : formatQuantity(now),
              }),
        );
      }
      detail = parts.join(' · ');
    } else if (event.kind === 'unknown') {
      icon = 'ask';
      text = t('inventory.receive.announce.unknown', { code: event.code });
    } else if (event.kind === 'archived') {
      icon = 'ask';
      text = t('inventory.receive.announce.archived', { name: nameOf(event.itemId) });
    } else if (event.kind === 'undone') {
      icon = 'undo';
      text = t('inventory.receive.announce.undone', {
        quantity: formatQuantity(event.quantity),
        name: nameOf(event.itemId),
      });
    } else if (event.kind === 'manual') {
      icon = 'ok';
      text = t('inventory.receive.announce.manual', { name: nameOf(event.itemId) });
    } else if (event.kind === 'removed') {
      icon = 'undo';
      text = t('inventory.receive.announce.removed', { name: nameOf(event.itemId) });
    }
  }

  const restoreOffered = event?.kind === 'removed' && canRestore;
  return (
    <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
      <div role="status" aria-live="polite" aria-atomic="true" className="min-h-11">
        {event ? (
          <p key={event.seq} className="m-pop flex items-start gap-2 text-sm">
            <EventIcon kind={icon} />
            <span className="min-w-0 break-words">
              <span className="font-semibold text-gray-900">{text}</span>
              {detail && <span className="block text-xs text-gray-500">{detail}</span>}
            </span>
          </p>
        ) : (
          <p className="text-sm text-gray-500">
            {t(hasLines ? 'inventory.receive.announce.ready' : 'inventory.receive.announce.none')}
          </p>
        )}
      </div>
      {restoreOffered ? (
        <Button variant="secondary" className="min-h-11 max-w-full" onClick={onRestore}>
          {t('inventory.receive.restoreLine')}
        </Button>
      ) : (
        undoLabel && (
          <Button variant="secondary" className="min-h-11 max-w-full text-left" onClick={onUndo}>
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4 shrink-0">
              <path
                fillRule="evenodd"
                d="M7.8 3.7a.75.75 0 010 1.06L5.56 7H11.5a5.5 5.5 0 010 11H9a.75.75 0 010-1.5h2.5a4 4 0 000-8H5.56l2.24 2.24a.75.75 0 11-1.06 1.06L3.2 8.28a.75.75 0 010-1.06l3.54-3.53a.75.75 0 011.06 0z"
                clipRule="evenodd"
              />
            </svg>
            <span className="min-w-0 break-words">{undoLabel}</span>
          </Button>
        )
      )}
    </div>
  );
}

/** A shape for each kind of answer, so it reads without its colour. */
function EventIcon({ kind }: { kind: 'ok' | 'ask' | 'undo' | null }) {
  if (kind === 'ok') {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-300">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.86-9.8a.75.75 0 00-1.22-.88l-3.24 4.5-1.6-1.6a.75.75 0 10-1.06 1.06l2.22 2.22a.75.75 0 001.14-.1l3.76-5.2z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (kind === 'ask') {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600">
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.06-1.06 3 3 0 114.24 4.24l-.87.88a1.5 1.5 0 00-.5 1v.25a.75.75 0 01-1.5 0V12a3 3 0 01.94-2.12l.87-.88a1.5 1.5 0 00-2.12-2.06zM10 16a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (kind === 'undo') {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-gray-500">
        <path
          fillRule="evenodd"
          d="M7.8 3.7a.75.75 0 010 1.06L5.56 7H11.5a5.5 5.5 0 010 11H9a.75.75 0 010-1.5h2.5a4 4 0 000-8H5.56l2.24 2.24a.75.75 0 11-1.06 1.06L3.2 8.28a.75.75 0 010-1.06l3.54-3.53a.75.75 0 011.06 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return null;
}

function LineRow({
  line,
  item,
  fallbackName,
  typed,
  flash,
  added,
  fieldRef,
  onType,
  onKeyDown,
  onBlur,
  onRemove,
}: {
  line: ReceiveLine;
  item: InventoryItem | undefined;
  fallbackName: string;
  typed: string | undefined;
  flash: number | null;
  added: number | null;
  fieldRef: (el: HTMLInputElement | null) => void;
  onType: (text: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const id = useId();
  const name = item?.name ?? fallbackName;
  const invalid = typed !== undefined && parsePositiveQuantity(typed) === null;
  return (
    <li
      className={[
        'px-4 py-2 transition-colors duration-700 motion-reduce:transition-none',
        flash !== null ? 'bg-brand-50' : 'bg-surface',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        {/* What came in, at a glance: the photo beside the name, outside the
            label so the quantity field is not named after it twice. */}
        <SquarePhoto
          name={name}
          url={item?.photo_url}
          size="row"
          alt=""
          className="mr-1"
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-qty`} className="block break-words text-sm font-medium text-gray-900">
            {name}
          </label>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
            {item?.category && <span>{item.category}</span>}
            {item?.archived_at && <span>{t('inventory.stock.status.archived')}</span>}
            {/* What the last scan added, in words as well as in the light. */}
            {flash !== null && added !== null && (
              <span key={flash} className="m-pop font-semibold text-brand-800">
                {t('inventory.receive.lineAdded', { quantity: formatQuantity(added) })}
              </span>
            )}
          </p>
        </div>
        <div className="flex w-20 shrink-0 flex-col items-end">
          <input
            ref={fieldRef}
            id={`${id}-qty`}
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            value={typed ?? formatQuantity(line.quantity)}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
            aria-invalid={invalid || undefined}
            aria-describedby={`${id}-unit${invalid ? ` ${id}-err` : ''}`}
            className={[
              'm-field min-h-11 w-full rounded-md border px-2 text-right text-base tabular-nums focus:outline-none focus:ring-[3px]',
              invalid
                ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
                : 'border-gray-300 focus:border-brand-500 focus:ring-brand-200',
            ].join(' ')}
          />
          {/* Under the number rather than beside it, so the product's name
              keeps the width; a long unit ("paquetes de seis") wraps there
              instead of being cut to "paquetes de …". */}
          <span id={`${id}-unit`} className="mt-0.5 max-w-full break-words text-right text-xs leading-tight text-gray-500">
            {item?.unit ?? t('inventory.receive.unitFallback')}
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('inventory.receive.removeLine', { name })}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-5 w-5">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {invalid && (
        <p id={`${id}-err`} className="mt-1 text-xs font-medium text-red-700">
          {t('inventory.receive.invalidQuantity')}
        </p>
      )}
    </li>
  );
}

/** A search over the products, as a list of big buttons. */
function ProductSearch({
  products,
  onPick,
  label,
  autoFocus = false,
}: {
  products: InventoryItem[];
  onPick: (item: InventoryItem) => void;
  label: string;
  autoFocus?: boolean;
}) {
  const t = useT();
  const id = useId();
  const [query, setQuery] = useState('');
  const LIMIT = 8;
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const found = needle ? products.filter((p) => matches(p, needle)) : products;
    return [...found].sort((a, b) => a.name.localeCompare(b.name));
  }, [products, query]);
  return (
    <div>
      <label htmlFor={`${id}-q`} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={`${id}-q`}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={t('inventory.receive.searchPlaceholder')}
        className="m-field mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-200"
      />
      {shown.length === 0 ? (
        <p className="py-3 text-sm text-gray-500">{t('inventory.receive.searchNone')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200 bg-surface">
          {shown.slice(0, LIMIT).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p)}
                // Named by its words alone: the photo's alt ("Photo of …")
                // would otherwise open the name, and the product be said
                // twice.
                aria-labelledby={`${id}-name-${p.id} ${id}-cat-${p.id}`}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 focus-visible:bg-brand-50 focus-visible:outline-none"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <SquarePhoto
                    name={p.name}
                    url={p.photo_url}
                    size="row"
                    alt=""
                  />
                  <span id={`${id}-name-${p.id}`} className="min-w-0 break-words font-medium text-gray-900">
                    {p.name}
                  </span>
                </span>
                <span id={`${id}-cat-${p.id}`} className="shrink-0 text-xs text-gray-500">
                  {p.category ?? ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown.length > LIMIT && (
        <p className="mt-1 text-xs text-gray-500">
          {t(countKey('inventory.receive.searchMore', shown.length - LIMIT), { count: shown.length - LIMIT })}
        </p>
      )}
    </div>
  );
}

function ManualPicker({
  id,
  products,
  autoFocus,
  canProducts,
  onPick,
  onClose,
}: {
  id: string;
  products: InventoryItem[];
  /** Not on a touch screen: see InventoryReceivePage. */
  autoFocus: boolean;
  /** Whether "create it from a code" is advice this person can follow. */
  canProducts: boolean;
  onPick: (itemId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div id={id} className="m-fade border-b border-gray-100 bg-gray-50 px-4 py-3">
      {products.length === 0 ? (
        <p className="text-sm text-gray-600">
          {t(canProducts ? 'inventory.receive.manualNone' : 'inventory.receive.manualNoneReadOnly')}
        </p>
      ) : (
        <ProductSearch
          products={products}
          onPick={(p) => onPick(p.id)}
          label={t('inventory.receive.manualLabel')}
          autoFocus={autoFocus}
        />
      )}
      <div className="mt-2 flex justify-end">
        <Button variant="ghost" className="min-h-11" onClick={onClose}>
          {t('inventory.receive.manualClose')}
        </Button>
      </div>
    </div>
  );
}

/** "How many units is one scan of it" -- 24 for a case of 24. */
function UnitsPerScanField({
  value,
  onChange,
  unit,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  unit: string | null;
  invalid: boolean;
}) {
  const t = useT();
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {t('inventory.receive.unitsPerScan')}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-help`}
          className={[
            'm-field min-h-11 w-24 rounded-md border px-3 text-right text-base tabular-nums focus:outline-none focus:ring-[3px]',
            invalid
              ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
              : 'border-gray-300 focus:border-brand-500 focus:ring-brand-200',
          ].join(' ')}
        />
        <span className="text-sm text-gray-600">{unit ?? t('inventory.receive.unitFallback')}</span>
      </div>
      <p id={`${id}-help`} className={['mt-1 text-xs', invalid ? 'font-medium text-red-700' : 'text-gray-500'].join(' ')}>
        {invalid ? t('inventory.receive.invalidQuantity') : t('inventory.receive.unitsPerScanHelp')}
      </p>
    </div>
  );
}

function PendingShell({
  titleId,
  title,
  children,
  more,
}: {
  titleId: string;
  title: ReactNode;
  children: ReactNode;
  more: number;
}) {
  const t = useT();
  return (
    <section
      aria-labelledby={titleId}
      className="m-pop rounded-lg border-2 border-amber-300 bg-amber-50 p-4"
    >
      <div className="flex items-start gap-2">
        <EventIcon kind="ask" />
        <h2 id={titleId} className="min-w-0 break-words text-sm font-semibold text-gray-900">
          {title}
        </h2>
      </div>
      <div className="mt-3">{children}</div>
      {more > 0 && (
        <p className="mt-3 border-t border-amber-200 pt-2 text-xs text-gray-700">
          {t(countKey('inventory.receive.pending.more', more), { count: more })}
        </p>
      )}
    </section>
  );
}

function UnknownCodeCard({
  pending,
  products,
  categories,
  index,
  nameOf,
  autoFocus,
  more,
  canProducts,
  onCreated,
  onResolved,
  onIgnore,
}: {
  pending: PendingCode;
  products: InventoryItem[];
  categories: string[];
  /** What every code means, as the product list has it now. */
  index: CodeIndex;
  nameOf: (itemId: string) => string;
  /** Whether its fields take the focus when they open: not on a touch screen. */
  autoFocus: boolean;
  more: number;
  /** Whether a new product can be made and the code saved (`inventory.products`). */
  canProducts: boolean;
  onCreated: (item: InventoryItem) => void;
  onResolved: (pending: PendingCode, itemId: string, unitsPerScan: number, label: string | null) => void;
  onIgnore: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const noteId = useId();
  const options = unknownCodeOptions(canProducts);
  const [mode, setMode] = useState<'choose' | 'existing' | 'new'>('choose');
  const [chosen, setChosen] = useState<InventoryItem | null>(null);
  const [units, setUnits] = useState('1');
  const [label, setLabel] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('');
  const addBarcode = useAddInventoryBarcode();
  const createItem = useCreateInventoryItem();
  // Set before the next render: a double tap must not send twice.
  const sending = useRef(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const unitsValue = parsePositiveQuantity(units);
  const unitsInvalid = units.trim() !== '' && (unitsValue === null || unitsValue > 100000);
  const busy = addBarcode.isPending || createItem.isPending;
  const error = localError ?? (addBarcode.error ?? createItem.error ? getErrorMessage(addBarcode.error ?? createItem.error) : null);

  const back = () => {
    addBarcode.reset();
    createItem.reset();
    setLocalError(null);
    setChosen(null);
    setMode('choose');
  };

  const saveExisting = (e: FormEvent) => {
    e.preventDefault();
    if (sending.current || !chosen || unitsValue === null || unitsInvalid) return;
    // The list may know the code by now: no call for what is already so,
    // and a clear answer for a code another product has. Without the right
    // to save codes, what was scanned is added to this delivery only.
    const choice = existingChoice(index.get(pending.key), chosen.id, options.saveCode);
    if (choice.kind === 'known') {
      onResolved(pending, chosen.id, choice.unitsPerScan, choice.label);
      return;
    }
    if (choice.kind === 'taken') {
      setLocalError(t('errors.inventory_barcode_taken', { product: nameOf(choice.itemId) }));
      return;
    }
    if (choice.kind === 'local') {
      setLocalError(null);
      onResolved(pending, chosen.id, unitsValue, null);
      return;
    }
    setLocalError(null);
    sending.current = true;
    // A 200 is fine too: the server says the code was this product's already.
    addBarcode.mutate(
      { itemId: chosen.id, code: pending.code, units_per_scan: unitsValue, label: label.trim() || null },
      {
        onSuccess: (b) => onResolved(pending, chosen.id, b.units_per_scan, b.label),
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  };

  const saveNew = (e: FormEvent) => {
    e.preventDefault();
    if (!options.newProduct) return;
    if (sending.current || !name.trim() || unitsValue === null || unitsInvalid) return;
    setLocalError(null);
    sending.current = true;
    createItem.mutate(
      {
        name: name.trim(),
        unit: unit.trim() || null,
        category: category.trim() || null,
        barcodes: [{ code: pending.code, units_per_scan: unitsValue }],
      },
      {
        onSuccess: (item) => {
          onCreated(item);
          onResolved(pending, item.id, unitsValue, null);
        },
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  };

  // What the manager is told: how many times it was scanned, and what those
  // scans are worth when a multiplier made them more (3 scans at x2: 6).
  const scannedText =
    pending.scans === 1 && pending.times === 1
      ? t('inventory.receive.pending.once')
      : pending.times === pending.scans
        ? t('inventory.receive.pending.scans', { count: pending.scans })
        : t(countKey('inventory.receive.pending.scansTimes', pending.scans), {
            count: pending.scans,
            times: formatQuantity(pending.times),
          });

  return (
    <PendingShell
      titleId={titleId}
      more={more}
      title={
        <>
          {t('inventory.receive.pending.unknown')}{' '}
          <span className="break-all font-mono">{pending.code}</span>
        </>
      }
    >
      <p className="text-sm text-gray-700">{scannedText}</p>

      {/* Said before anything is chosen, and under the choice again: for
          whoever may not save codes, what they say here lasts this delivery. */}
      {!options.saveCode && (
        <p id={noteId} className="mt-2 text-sm text-gray-700">
          {t('inventory.receive.pending.notSaved')}
        </p>
      )}

      {mode === 'choose' && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            className="min-h-11"
            onClick={() => setMode('existing')}
            disabled={products.length === 0}
            aria-describedby={options.saveCode ? undefined : noteId}
          >
            {t(options.saveCode ? 'inventory.receive.pending.existing' : 'inventory.receive.pending.existingHere')}
          </Button>
          {options.newProduct && (
            <Button variant="secondary" className="min-h-11" onClick={() => setMode('new')}>
              {t('inventory.receive.pending.new')}
            </Button>
          )}
          <Button variant="ghost" className="min-h-11" onClick={onIgnore}>
            {t('inventory.receive.pending.ignore')}
          </Button>
        </div>
      )}

      {mode === 'existing' && !chosen && (
        <div className="mt-3 space-y-2">
          <ProductSearch
            products={products}
            onPick={setChosen}
            label={t('inventory.receive.pending.whichProduct')}
            autoFocus={autoFocus}
          />
          <Button variant="ghost" className="min-h-11" onClick={back}>
            {t('inventory.receive.pending.back')}
          </Button>
        </div>
      )}

      {mode === 'existing' && chosen && (
        <form onSubmit={saveExisting} className="mt-3 space-y-3">
          <p className="text-sm text-gray-800">
            {t('inventory.receive.pending.chosen', { name: chosen.name })}{' '}
            <button
              type="button"
              onClick={() => setChosen(null)}
              className="inline-flex min-h-11 items-center px-1 font-medium text-brand-700 underline underline-offset-2"
            >
              {t('inventory.receive.pending.change')}
            </button>
          </p>
          <UnitsPerScanField value={units} onChange={setUnits} unit={chosen.unit} invalid={unitsInvalid} />
          {/* The label is the saved code's: with nothing saved, no label. */}
          {options.saveCode && (
            <Input
              label={t('inventory.receive.pending.label')}
              name="receive-barcode-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('inventory.receive.pending.labelPlaceholder')}
              maxLength={64}
              className="min-h-11 text-base"
            />
          )}
          {error && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              className="min-h-11"
              disabled={busy || unitsValue === null || unitsInvalid}
              aria-describedby={options.saveCode ? undefined : noteId}
            >
              {busy
                ? t('inventory.receive.saving')
                : t(options.saveCode ? 'inventory.receive.pending.saveExisting' : 'inventory.receive.pending.addHere')}
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={back}>
              {t('inventory.receive.pending.back')}
            </Button>
          </div>
        </form>
      )}

      {mode === 'new' && options.newProduct && (
        <form onSubmit={saveNew} className="mt-3 space-y-3">
          <Input
            label={t('inventory.item.name')}
            name="receive-new-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('inventory.item.namePlaceholder')}
            maxLength={200}
            autoFocus={autoFocus}
            required
            className="min-h-11 text-base"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={t('inventory.item.unit')}
              name="receive-new-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder={t('inventory.item.unitPlaceholder')}
              maxLength={64}
              className="min-h-11 text-base"
            />
            <Input
              label={t('inventory.item.category')}
              name="receive-new-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={t('inventory.item.categoryPlaceholder')}
              list="receive-categories"
              maxLength={200}
              className="min-h-11 text-base"
            />
            <datalist id="receive-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <UnitsPerScanField value={units} onChange={setUnits} unit={unit.trim() || null} invalid={unitsInvalid} />
          {error && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              className="min-h-11"
              disabled={busy || !name.trim() || unitsValue === null || unitsInvalid}
            >
              {busy ? t('inventory.receive.saving') : t('inventory.receive.pending.saveNew')}
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={back}>
              {t('inventory.receive.pending.back')}
            </Button>
          </div>
        </form>
      )}
    </PendingShell>
  );
}

function ArchivedCard({
  pending,
  item,
  unitsPerScan,
  label,
  more,
  canProducts,
  onResolved,
  onIgnore,
}: {
  pending: PendingCode;
  item: InventoryItem;
  unitsPerScan: number;
  label: string | null;
  more: number;
  /** Whether the product can be brought back (`inventory.products`). */
  canProducts: boolean;
  onResolved: (pending: PendingCode, itemId: string, unitsPerScan: number, label: string | null) => void;
  onIgnore: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const update = useUpdateInventoryItem();
  const { revive } = archivedCodeOptions(canProducts);
  return (
    <PendingShell
      titleId={titleId}
      more={more}
      title={t('inventory.receive.pending.archived', { name: item.name })}
    >
      {/* Bringing it back is editing the product: anybody else is told who can. */}
      <p className="text-sm text-gray-700">
        {t(revive ? 'inventory.receive.pending.archivedHelp' : 'inventory.receive.pending.archivedAsk', {
          code: pending.code,
        })}
      </p>
      {update.isError && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-700">
          {getErrorMessage(update.error)}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {revive && (
          <Button
            className="min-h-11"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { id: item.id, archived: false },
                { onSuccess: () => onResolved(pending, item.id, unitsPerScan, label) },
              )
            }
          >
            {update.isPending ? t('inventory.receive.saving') : t('inventory.receive.pending.revive')}
          </Button>
        )}
        <Button variant="ghost" className="min-h-11" onClick={onIgnore}>
          {t('inventory.receive.pending.ignore')}
        </Button>
      </div>
    </PendingShell>
  );
}

function SaveDialog({
  open,
  onClose,
  products,
  total,
  pending,
  receivedAt,
  onReceivedAt,
  supplier,
  onSupplier,
  note,
  onNote,
  busy,
  blockedScan,
  error,
  onSubmit,
}: {
  open: boolean;
  /** Ignored by the page while the entry is being saved. */
  onClose: () => void;
  products: number;
  total: { quantity: number; unit: string | null } | null;
  pending: number;
  receivedAt: string;
  onReceivedAt: (v: string) => void;
  supplier: string;
  onSupplier: (v: string) => void;
  note: string;
  onNote: (v: string) => void;
  /** The entry is on its way to the server: nothing here may close or resend it. */
  busy: boolean;
  /** A scan arrived while this was open, and was not added. */
  blockedScan: boolean;
  error: string | null;
  onSubmit: (e: FormEvent) => void;
}) {
  const t = useT();
  // The suppliers of the deliveries before, to pick from instead of typing.
  const receipts = useInventoryReceipts();
  const suppliers = useMemo(
    () =>
      [
        ...new Set(
          (receipts.data ?? []).map((r) => r.supplier?.trim()).filter((s): s is string => Boolean(s)),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [receipts.data],
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('inventory.receive.saveTitle')}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="min-h-11" onClick={onClose} disabled={busy}>
            {t('inventory.receive.saveCancel')}
          </Button>
          <Button type="submit" form="receipt-form" className="min-h-11" disabled={busy || !receivedAt}>
            {busy ? t('inventory.receive.saving') : t('inventory.receive.save')}
          </Button>
        </div>
      }
    >
      <form id="receipt-form" onSubmit={onSubmit} className="space-y-4" aria-busy={busy || undefined}>
        <p className="text-sm tabular-nums text-gray-700">
          <Summary products={products} total={total} />
        </p>
        {pending > 0 && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-gray-800">
            {t(countKey('inventory.receive.savePending', pending), { count: pending })}
          </p>
        )}
        {blockedScan && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-gray-900">
            <EventIcon kind="ask" />
            <span>{t(busy ? 'inventory.receive.scanBlockedBusy' : 'inventory.receive.scanBlocked')}</span>
          </p>
        )}
        <Input
          label={t('inventory.receive.supplier')}
          name="receipt-supplier"
          value={supplier}
          onChange={(e) => onSupplier(e.target.value)}
          placeholder={t('inventory.receive.supplierPlaceholder')}
          list="receipt-suppliers"
          maxLength={200}
          autoComplete="off"
          disabled={busy}
          className="min-h-11 text-base"
        />
        <datalist id="receipt-suppliers">
          {suppliers.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Input
          label={t('inventory.receive.note')}
          name="receipt-note"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder={t('inventory.receive.notePlaceholder')}
          maxLength={2000}
          autoComplete="off"
          disabled={busy}
          className="min-h-11 text-base"
        />
        <Input
          type="datetime-local"
          label={t('inventory.receive.when')}
          name="receipt-received-at"
          value={receivedAt}
          onChange={(e) => onReceivedAt(e.target.value)}
          required
          disabled={busy}
          className="min-h-11 text-base"
        />
        {error && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/** How many of an entry's lines the saved panel lists before "and N more". */
const SAVED_LINES_SHOWN = 6;

/**
 * The entry just saved, on this screen: on a phone the entry's own page sits
 * inside the dashboard, whose sidebar takes most of the width. What was
 * saved, what is still here (codes waiting, anything the entry did not take),
 * the next delivery, and the way to the entry for whoever wants it.
 */
function SavedPanel({
  receipt,
  restProducts,
  restPending,
  onAnother,
}: {
  receipt: InventoryReceipt;
  restProducts: number;
  restPending: number;
  onAnother: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // The dialog has just closed: the eye and the screen reader land here.
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const shown = receipt.lines.slice(0, SAVED_LINES_SHOWN);
  const more = receipt.lines.length - shown.length;
  const rest = restProducts > 0 || restPending > 0;
  return (
    <section
      aria-labelledby={titleId}
      className="m-pop rounded-lg border border-brand-200 bg-surface p-4 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <EventIcon kind="ok" />
        <div className="min-w-0">
          <h2 id={titleId} ref={heading} tabIndex={-1} className="text-base font-semibold text-gray-900 focus:outline-none">
            {t('inventory.receive.saved.title')}
          </h2>
          <p className="mt-0.5 text-sm text-gray-600">
            {t('inventory.receive.saved.when', { date: formatDateTime(receipt.received_at) })}
            {receipt.supplier && <> · {receipt.supplier}</>}
          </p>
          {receipt.note && <p className="mt-0.5 break-words text-sm text-gray-600">{receipt.note}</p>}
        </div>
      </div>

      <p className="mt-3 text-sm font-medium text-gray-900">
        {t(countKey('inventory.receive.summary.products', receipt.lines.length), {
          count: receipt.lines.length,
        })}
      </p>
      <ul className="mt-1 divide-y divide-gray-100 rounded-md border border-gray-100">
        {shown.map((l) => (
          <li key={l.item_id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 break-words text-gray-900">{l.item_name}</span>
            <span className="shrink-0 tabular-nums text-gray-700">
              {formatQuantity(l.quantity)}
              <span className="ml-1 text-xs text-gray-500">{l.unit ?? t('inventory.receive.unitFallback')}</span>
            </span>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="mt-1 text-xs text-gray-500">
          {t(countKey('inventory.receive.saved.more', more), { count: more })}
        </p>
      )}

      {rest && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-gray-800">
          {restProducts > 0 && (
            <p>{t(countKey('inventory.receive.saved.rest', restProducts), { count: restProducts })}</p>
          )}
          {restPending > 0 && (
            <p>{t(countKey('inventory.receive.saved.restPending', restPending), { count: restPending })}</p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button className="min-h-11" onClick={onAnother}>
          {rest ? t('inventory.receive.saved.continue') : t('inventory.receive.saved.another')}
        </Button>
        <Link
          to={`/inventory/receipts/${receipt.id}`}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-gray-300 bg-surface px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
        >
          {t('inventory.receive.saved.view')}
        </Link>
      </div>
      <p className="mt-2 text-xs text-gray-500">{t('inventory.receive.saved.hint')}</p>
    </section>
  );
}
