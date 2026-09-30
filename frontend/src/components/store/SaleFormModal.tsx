// Recording a sale: the day, the dishes (from the menu, or typed free), how
// many of each, and a note. The total adds up as it is typed.
//
// A dish is added from the menu with its name and price as the menu has them
// today, both editable here: the sale keeps what was actually charged, and
// the menu is not touched. A second tap on the same dish is one more of it.
// A free line is anything else -- "Caja del día", 850 €.
//
// The menu is picked from as the till picks: one grid of the till's tiles, A
// to Z (lib/menu/till.ts) -- the photo to the edges, the name and the price
// over it -- close together, with how many are already in the sale (×n) in
// the corner, and a row of section chips over it ("All" first) to narrow it.
//
// Nothing typed is lost: every change is written to a draft in the browser
// (lib/store/saleDraft.ts), so a tab the phone killed, or the dialog closed
// by a stray tap on the backdrop, comes back as it was. Closing is not
// discarding; "Start over" is.
//
// Saved once, whatever the thumb does: a ref shuts the door before anything
// renders (two taps in one tick would both pass a button that is only
// disabled on the next render), and the sale's `clientRef` -- in the draft
// before the request leaves -- makes a retry return the sale already saved.
// That answer is checked against what was sent: a first try saved with its
// answer lost, then a line added, comes back as the sale WITHOUT the line.
// Then the form stays open with the draft, takes a new ref, and says so.

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useCreateStoreSale, type StoreSale } from '../../api/store';
import { errorCode, getErrorMessage } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useLanguage, useT } from '../../lib/i18n';
import { browserStorage, newClientRef, type DraftScope } from '../../lib/inventory/receiveDraft';
import { APP_LOCALE } from '../../lib/locale';
import { useMenu } from '../../lib/menu/api';
import { activeSection, sectionChips, tillDishes } from '../../lib/menu/till';
import type { MenuDish } from '../../lib/menu/types';
import { addDays, FIRST_SALE_DAY, isoDay } from '../../lib/store/period';
import {
  addDish,
  addFreeLine,
  checkLine,
  detachMissingDishes,
  emptySale,
  hasContent,
  MAX_NAME,
  MAX_NOTE,
  parseSaleQuantity,
  toPayload,
  totalCents,
  type SaleDraft,
  type SaleLineDraft,
} from '../../lib/store/sale';
import { clearSaleDraft, readSaleDraft, saveSaleDraft } from '../../lib/store/saleDraft';
import { Button } from '../Button';
import { FIELD_SKIN, fieldTone, Input } from '../Input';
import { useOrderAlert } from '../inventory/orderAlertContext';
import { Modal } from '../Modal';
import { SectionTabs, sectionTabId } from '../menu/SectionTabs';
import { TillTile } from '../menu/TillTile';

const NO_ALLERGEN_FILTER: ReadonlySet<string> = new Set();

/** A square control a thumb can hit: 44 px, as the menu's are. */
const ICON_BUTTON =
  'grid h-11 w-11 shrink-0 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-red-50 hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300 motion-reduce:transition-none';

/** The draft this person keeps in this workspace, or none signed in (then none is kept). */
// eslint-disable-next-line react-refresh/only-export-components
export function useSaleDraftScope(): DraftScope | null {
  const { user } = useAuth();
  const orgId = user?.org_id;
  const userId = user?.id;
  // By the two ids, not the user object, which is replaced whenever the
  // workspace answer changes something about it.
  return useMemo(() => (orgId && userId ? { orgId, userId } : null), [orgId, userId]);
}

export function SaleFormModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (sale: StoreSale) => void;
}) {
  const t = useT();
  const { language } = useLanguage();
  const decimalMark = language === 'es' ? ',' : '.';
  const scope = useSaleDraftScope();
  const storage = useMemo(browserStorage, []);
  const menu = useMenu();
  const ids = useId();

  // The form starts from the draft left behind, if there is one.
  const [start] = useState(() => {
    const stored = scope ? readSaleDraft(storage, scope) : null;
    return stored ?? { draft: emptySale(isoDay(new Date()), newClientRef()), savedAt: null };
  });
  const [draft, setDraft] = useState<SaleDraft>(start.draft);
  const [restored, setRestored] = useState(start.savedAt !== null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Written on every change. An emptied form removes the draft rather than
  // storing an empty one. Never again once the sale is saved: the dialog
  // stays mounted while it leaves, and a late write would bring the saved
  // sale back as a draft.
  const saved = useRef(false);
  useEffect(() => {
    if (scope && !saved.current) saveSaleDraft(storage, scope, draft);
  }, [storage, scope, draft]);

  const seq = useRef(0);
  const newKey = () => `l${Date.now().toString(36)}${(seq.current++).toString(36)}`;
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const nameFields = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => {
    if (focusKey === null) return;
    nameFields.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  const [announcement, setAnnouncement] = useState('');
  const [tried, setTried] = useState(false);
  // The sale the server already had under this form's ref, when it is not
  // what the form holds now (see Saving).
  const [keptEarlier, setKeptEarlier] = useState<StoreSale | null>(null);

  const setLines = (lines: SaleLineDraft[]) => setDraft((d) => ({ ...d, lines }));
  const editLine = (key: string, patch: Partial<SaleLineDraft>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const onAddDish = (dish: MenuDish) => {
    const { lines, key } = addDish(draftRef.current.lines, dish, newKey, decimalMark);
    setLines(lines);
    const quantity = lines.find((l) => l.key === key)?.quantity ?? '1';
    setAnnouncement(t('store.form.added', { name: dish.name, quantity }));
  };
  const onAddFree = () => {
    const { lines, key } = addFreeLine(draftRef.current.lines, newKey);
    setLines(lines);
    setFocusKey(key);
  };
  // Enter on a line's last field: on to the next line's name. False on the
  // last line, which has nowhere to go.
  const focusNextLine = (key: string) => {
    const lines = draftRef.current.lines;
    const next = lines[lines.findIndex((l) => l.key === key) + 1];
    if (next) nameFields.current.get(next.key)?.focus();
    return next !== undefined;
  };
  const removeLine = (line: SaleLineDraft) => {
    setLines(draftRef.current.lines.filter((l) => l.key !== line.key));
    setAnnouncement(t('store.form.removed', { name: line.name.trim() || t('store.form.freeLine') }));
  };
  // Starting over asks nothing and can be taken back, until something new is
  // typed: a question before every discard is one people learn to answer
  // without reading (the same reasoning as UndoBar).
  const [discarded, setDiscarded] = useState<SaleDraft | null>(null);
  const startOver = () => {
    if (hasContent(draftRef.current)) setDiscarded(draftRef.current);
    // A new ref too: whatever the old one saved (if anything) stays saved,
    // and the next sale must not be answered with it.
    setDraft(emptySale(isoDay(new Date()), newClientRef()));
    setRestored(false);
    setTried(false);
    setKeptEarlier(null);
  };
  const undoStartOver = () => {
    if (!discarded) return;
    setDraft(discarded);
    setDiscarded(null);
  };
  useEffect(() => {
    if (discarded && hasContent(draft) && draft.clientRef !== discarded.clientRef) setDiscarded(null);
  }, [draft, discarded]);

  // --- The menu to pick from --------------------------------------------------

  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const chips = useMemo(() => sectionChips(menu.data?.sections ?? []), [menu.data]);
  const section = activeSection(chips, chosen);
  // Read while rendering: it follows the chosen language, and so does the order.
  const locale = APP_LOCALE;
  const matches = useMemo(
    () => tillDishes(menu.data?.sections ?? [], { section, query, without: NO_ALLERGEN_FILTER }, locale),
    [menu.data, section, query, locale],
  );
  const menuEmpty = menu.isSuccess && (menu.data?.sections ?? []).every((s) => s.dishes.length === 0);
  const inSale = (dishId: string) =>
    draft.lines.reduce((n, l) => (l.dishId === dishId ? n + (parseSaleQuantity(l.quantity) ?? 0) : n), 0);

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter in the search is "add that one", never "save the sale".
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (matches.length === 1) {
      onAddDish(matches[0]);
      setQuery('');
    }
  };

  // --- Saving -------------------------------------------------------------------

  const orders = useOrderAlert();
  const save = useCreateStoreSale({
    onSaved: (_sale, sent) => {
      saved.current = true;
      if (scope) clearSaleDraft(storage, scope, sent.client_ref);
    },
    // A product this sale has just left critical: the notice to order it
    // opens once this form has closed (OrderAlert.tsx).
    onStockAlerts: orders.afterSale,
  });
  const sending = useRef(false);
  const busy = save.isPending;
  const check = toPayload(draft);
  const problem = tried && !check.ok ? check.problem : null;
  const total = totalCents(draft.lines) / 100;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (sending.current) return;
    setTried(true);
    const result = toPayload(draftRef.current);
    if (!result.ok) return;
    sending.current = true;
    setKeptEarlier(null);
    const known = menu.data ? new Set(menu.data.sections.flatMap((s) => s.dishes.map((d) => d.id))) : null;
    const sent = detachMissingDishes(result.payload, known);
    save.mutate(sent, {
      onSuccess: ({ sale, asSent }) => {
        if (asSent) {
          onSaved(sale);
          onClose();
          return;
        }
        // The server had this ref already, from a try whose answer never came
        // back, and answered with THAT sale: what was changed since is only
        // here. The draft stays, under a new ref -- the old one would keep
        // being answered with the old sale -- and the manager decides whether
        // this is another sale or the same one twice.
        setKeptEarlier(sale);
        setDraft((d) => (d.clientRef === sent.client_ref ? { ...d, clientRef: newClientRef() } : d));
      },
      onError: (e) => {
        // A dish left the menu after it was fetched: fetch it again, so the
        // next press saves that line as a free one.
        if (errorCode(e) === 'menu_dish_not_found') void menu.refetch();
      },
      onSettled: () => {
        sending.current = false;
      },
    });
  };

  const close = () => {
    if (!busy) onClose();
  };

  const today = isoDay(new Date());
  const formId = `${ids}-form`;
  // Handed to the sale's page, so its "Back" returns to these days.
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('store.form.title')}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          {(problem || save.isError) && (
            <p role="alert" className="w-full text-sm text-red-600">
              {problem
                ? t(`store.form.problem.${problem}`)
                : errorCode(save.error) === 'menu_dish_not_found'
                  ? t('store.form.dishGone')
                  : getErrorMessage(save.error)}
            </p>
          )}
          {keptEarlier && (
            <p role="alert" className="w-full rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t('store.form.keptEarlier', { total: formatMoney(keptEarlier.total) })}{' '}
              <Link
                to={`/store/sales/${encodeURIComponent(keptEarlier.id)}`}
                state={{ from: here }}
                className="rounded font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
              >
                {t('store.form.keptEarlierView')}
              </Link>
            </p>
          )}
          <p className="flex items-baseline gap-2">
            <span className="text-xs text-gray-500">{t('store.form.total')}</span>
            <span className="text-lg font-semibold tabular-nums text-gray-900">{formatMoney(total)}</span>
          </p>
          {/* The two buttons wrap together, never Save alone on a line. */}
          <div className="ml-auto flex items-center gap-3">
            <Button variant="secondary" className="min-h-11" onClick={close} disabled={busy}>
              {t('store.form.close')}
            </Button>
            <Button type="submit" form={formId} className="min-h-11" disabled={busy}>
              {busy ? t('store.form.saving') : t('store.form.save')}
            </Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate>
        {/* Off while the save is on its way: an edit then would be lost with
            the draft the answer clears. */}
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          {discarded && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-700">
              <span role="status">{t('store.form.discarded')}</span>
              <button
                type="button"
                onClick={undoStartOver}
                className="min-h-9 rounded-lg px-2 text-sm font-medium text-brand-700 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
              >
                {t('store.form.undo')}
              </button>
            </div>
          )}
          {restored && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-700">
              <span>{t('store.form.restored')}</span>
              <button
                type="button"
                onClick={startOver}
                className="min-h-9 rounded-lg px-2 text-sm font-medium text-brand-700 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
              >
                {t('store.form.startOver')}
              </button>
            </div>
          )}

          <Input
            type="date"
            label={t('store.form.day')}
            name="store-sale-day"
            value={draft.soldOn}
            min={FIRST_SALE_DAY}
            max={addDays(today, 1)}
            onChange={(e) => setDraft((d) => ({ ...d, soldOn: e.target.value }))}
            error={problem === 'bad_date' ? ' ' : undefined}
            required
          />

          {/* --- From the menu ------------------------------------------------ */}
          <div>
            <label htmlFor={`${ids}-search`} className="text-sm font-medium text-gray-700">
              {t('store.form.fromMenu')}
            </label>
            <input
              id={`${ids}-search`}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder={t('store.form.searchPlaceholder')}
              enterKeyHint="search"
              autoComplete="off"
              // 16 px: a smaller field makes iOS zoom the page in on focus.
              className={`${FIELD_SKIN} ${fieldTone(false)} mt-1 min-h-11 w-full rounded-xl px-3.5 py-2 text-base`}
            />
            {/* Over the grid's scroll, not in it: always in reach. One
                section alone has nothing to choose between. */}
            {chips.length > 1 && (
              <div className="mt-2">
                <SectionTabs chips={chips} value={section} onChange={setChosen} idBase={`${ids}-sections`} panelId={`${ids}-grid`} size="sm" />
              </div>
            )}
            {/* Its own scroll, a few rows high: the lines and the note are
                under it, and forty dishes would push them off the dialog. */}
            <div
              id={`${ids}-grid`}
              {...(chips.length > 1 ? { role: 'tabpanel', 'aria-labelledby': sectionTabId(`${ids}-sections`, section) } : {})}
              className="mt-2 max-h-[min(22rem,48vh)] overflow-y-auto rounded-xl border border-white/[0.08]"
            >
              {menu.isLoading ? (
                <p className="px-3 py-3 text-sm text-gray-500">{t('store.form.menuLoading')}</p>
              ) : menu.isError && !menu.data ? (
                <p className="px-3 py-3 text-sm text-red-300">{t('store.form.menuError')}</p>
              ) : menuEmpty ? (
                <p className="px-3 py-3 text-sm text-gray-500">{t('store.form.menuEmpty')}</p>
              ) : matches.length === 0 ? (
                <p className="px-3 py-3 text-sm text-gray-500">{t('store.form.noMatch')}</p>
              ) : (
                <ul className="grid grid-cols-3 gap-1 p-1.5 sm:grid-cols-4">
                  {matches.map((dish) => (
                    <li key={dish.id} className="min-w-0">
                      <DishTile dish={dish} count={inSale(dish.id)} onAdd={() => onAddDish(dish)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* --- The lines ---------------------------------------------------- */}
          <div>
            <p className="text-sm font-medium text-gray-700">{t('store.form.lines')}</p>
            {draft.lines.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500">{t('store.form.noLines')}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {draft.lines.map((line, i) => (
                  <LineRow
                    key={line.key}
                    line={line}
                    last={i === draft.lines.length - 1}
                    tried={tried}
                    nameRef={(el) => {
                      if (el) nameFields.current.set(line.key, el);
                      else nameFields.current.delete(line.key);
                    }}
                    onChange={(patch) => editLine(line.key, patch)}
                    onRemove={() => removeLine(line)}
                    onNextLine={() => focusNextLine(line.key)}
                  />
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              {/* type="button": inside the form a bare button is a submit, and
                  adding a line would try to save the sale. */}
              <Button type="button" variant="secondary" className="min-h-11" onClick={onAddFree}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="h-4 w-4">
                  <path d="M10 4v12M4 10h12" />
                </svg>
                {t('store.form.addFree')}
              </Button>
              {hasContent(draft) && !restored && (
                <Button type="button" variant="ghost" className="min-h-11" onClick={startOver}>
                  {t('store.form.startOver')}
                </Button>
              )}
            </div>
          </div>

          <div className="group/field flex flex-col gap-1">
            <label htmlFor={`${ids}-note`} className="text-sm font-medium text-gray-700 transition-colors duration-200 group-focus-within/field:text-brand-300 motion-reduce:transition-none">
              {t('store.form.note')}
            </label>
            <textarea
              id={`${ids}-note`}
              value={draft.note}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              placeholder={t('store.form.notePlaceholder')}
              maxLength={MAX_NOTE}
              rows={2}
              className={`${FIELD_SKIN} ${fieldTone(false)} block w-full resize-y rounded-xl px-3.5 py-2.5`}
            />
          </div>
        </fieldset>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </form>
    </Modal>
  );
}

/**
 * One dish of the menu to add to the sale: the till's tile (TillTile.tsx),
 * the photo to its edges with the name and the price over it. How many are
 * in the sale already sits in its corner (×2), in words as well -- not a
 * colour; a sold-out dish can still be added (it was sold before it ran out)
 * and says it is.
 *
 * Its name is its content, not an aria-label: a label would stand in for all
 * of it, and a screen reader would hear "Add Crispy Grande" without the
 * price, the ×2 or the "sold out". So it hears "Add", the name, the price,
 * then the two marks, in that order, from words hidden to the eye; the marks
 * on the photo are for the eye only.
 */
function DishTile({ dish, count, onAdd }: { dish: MenuDish; count: number; onAdd: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onAdd}
      className="block w-full rounded-lg text-left transition-[filter,transform] duration-150 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-300 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <TillTile dish={dish} size="tile" lead={t('store.form.add')} count={count} />
    </button>
  );
}

/**
 * One line of the sale: what it is, its price, how many, and what it comes
 * to. A field is red once it holds something that does not read -- or, after
 * a try to save, when it is still empty -- and one sentence under the line
 * says which.
 *
 * Enter in a field is "next field", never "save the sale": Save is the form's
 * submit, and Enter -- or "Go" on an Android keyboard -- in any field of the
 * form would send a sale still being typed. From the quantity it goes to the
 * next line, and on the last line the keyboard is put away.
 */
function LineRow({
  line,
  last,
  tried,
  nameRef,
  onChange,
  onRemove,
  onNextLine,
}: {
  line: SaleLineDraft;
  last: boolean;
  tried: boolean;
  nameRef: (el: HTMLInputElement | null) => void;
  onChange: (patch: Partial<SaleLineDraft>) => void;
  onRemove: () => void;
  /** Focus the next line's name; false when there is none. */
  onNextLine: () => boolean;
}) {
  const t = useT();
  const ids = useId();
  const priceField = useRef<HTMLInputElement>(null);
  const quantityField = useRef<HTMLInputElement>(null);
  const onEnter = (next: (field: HTMLInputElement) => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    // An Enter that confirms an IME composition is the keyboard's, not ours.
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    next(e.currentTarget);
  };
  const check = checkLine(line);
  const nameBad = tried && !check.nameOk;
  const priceBad = check.price === null && (tried || line.price.trim() !== '');
  const quantityBad = check.quantity === null && (tried || line.quantity.trim() !== '');
  const message = nameBad
    ? t('store.form.line.nameMissing')
    : priceBad
      ? line.price.trim() === ''
        ? t('store.form.line.priceMissing')
        : t('store.form.line.priceInvalid')
      : quantityBad
        ? t('store.form.line.quantityInvalid')
        : null;
  const shownName = line.name.trim() || t('store.form.freeLine');
  const small = 'rounded-lg px-2.5 py-2 text-right tabular-nums';

  return (
    <li className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
      <div className="flex items-center gap-1">
        <label htmlFor={`${ids}-name`} className="sr-only">
          {t('store.form.line.name')}
        </label>
        <input
          ref={nameRef}
          id={`${ids}-name`}
          value={line.name}
          onChange={(e) => onChange({ name: e.target.value })}
          onKeyDown={onEnter(() => priceField.current?.focus())}
          enterKeyHint="next"
          placeholder={t('store.form.line.namePlaceholder')}
          maxLength={MAX_NAME}
          autoComplete="off"
          aria-invalid={nameBad || undefined}
          aria-describedby={message ? `${ids}-msg` : undefined}
          className={`${FIELD_SKIN} ${fieldTone(nameBad)} min-w-0 flex-1 rounded-lg px-2.5 py-2`}
        />
        <button type="button" className={ICON_BUTTON} aria-label={t('store.form.line.remove', { name: shownName })} onClick={onRemove}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5">
            <path d="M4 6h12M8 6V4.5A1 1 0 0 1 9 3.5h2a1 1 0 0 1 1 1V6M6 6l.7 9.1A1.5 1.5 0 0 0 8.2 16.5h3.6a1.5 1.5 0 0 0 1.5-1.4L14 6" />
          </svg>
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <label htmlFor={`${ids}-price`} className="sr-only">
          {t('store.form.line.price', { name: shownName })}
        </label>
        <input
          ref={priceField}
          id={`${ids}-price`}
          value={line.price}
          onChange={(e) => onChange({ price: e.target.value })}
          onKeyDown={onEnter(() => quantityField.current?.focus())}
          enterKeyHint="next"
          placeholder={t('store.form.line.pricePlaceholder')}
          inputMode="decimal"
          autoComplete="off"
          maxLength={12}
          aria-invalid={priceBad || undefined}
          aria-describedby={message ? `${ids}-msg` : undefined}
          className={`${FIELD_SKIN} ${fieldTone(priceBad)} ${small} w-24`}
        />
        <span aria-hidden="true" className="text-gray-500">
          ×
        </span>
        <label htmlFor={`${ids}-qty`} className="sr-only">
          {t('store.form.line.quantity', { name: shownName })}
        </label>
        <input
          ref={quantityField}
          id={`${ids}-qty`}
          value={line.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          onKeyDown={onEnter((field) => {
            if (!onNextLine()) field.blur();
          })}
          enterKeyHint={last ? 'done' : 'next'}
          inputMode="decimal"
          autoComplete="off"
          maxLength={10}
          aria-invalid={quantityBad || undefined}
          aria-describedby={message ? `${ids}-msg` : undefined}
          className={`${FIELD_SKIN} ${fieldTone(quantityBad)} ${small} w-16`}
        />
        <span className="ml-auto whitespace-nowrap font-semibold tabular-nums text-gray-900">
          {check.cents === null ? '—' : formatMoney(check.cents / 100)}
        </span>
      </div>
      {message && (
        <p id={`${ids}-msg`} className="mt-1.5 text-xs font-medium text-red-300">
          {message}
        </p>
      )}
    </li>
  );
}
