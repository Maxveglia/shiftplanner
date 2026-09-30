// The menu, as the manager writes it: sections, and dishes with a price,
// allergens, a photo and whether they are sold out today. Typed by hand, dish
// by dish. The team reads the same menu on their phones
// (pages/employee/EmployeeMenuPage.tsx) and cannot change it.
//
// Laid out as Casa Demo's till lays out its products, the screen the team
// looks at all day behind the counter: every dish a square tile, the photo to
// its edges with the name and the price over it (components/menu/TillTile.tsx),
// close together in ONE grid, A to Z, with no headings between them
// (lib/menu/till.ts). A row of section chips over the grid narrows it to one
// section -- "All" first, and chosen until another is -- beside the search.
//
// And it is the till: the screen has two modes, chosen by the title and kept
// for the tab (lib/store/tillDraft.ts). "Charge", the one it opens in, is the
// till's: a tap on a tile puts one more of it on the bill -- beside the grid
// on a wide screen, in a sheet from a bar at the foot of a narrow one
// (components/store/TillTicket.tsx) -- and "Charge" records the bill as a sale
// of the day, paid in cash or by card (components/store/ChargeDialog.tsx). A
// sold-out dish, or one without a price, is not added, and its tile says why.
// A bill the menu changed under (a dish deleted, sold out or repriced since it
// was rung up) says so and waits for the manager before it is charged; one
// left more than 12 hours is set aside, with the way to bring it back.
// Nothing is printed and nothing is for the customer: the sale is recorded,
// and voided with its trace if it was wrong, never deleted (decided with Max,
// 27-sep-2026).
//
// "Edit menu" is the menu as it was: a tile is a button that opens the dish
// -- its name, photo, description, price, section, allergens, whether it is
// available, and the way to delete it. "Add dish", by the title and not a tile
// of the grid (the grid is the till's, dish for dish), adds one to the section
// chosen above, or under "All" to the one picked in the dialog. The sections
// themselves are made, renamed and deleted in a dialog of their own
// ("Sections").
//
// "Edit menu" is the manager's alone (`menu.edit`, lib/access.ts). An
// employee and a shop account -- the till's tablet -- have the till and
// nothing else: no switch between modes, no sections, no "Add dish", no dish
// dialog; a tile only ever adds to the bill (Max, 28-sep-2026). An account
// that may not charge either (`store.charge`) reads the menu and does nothing.
//
// There is no ordering by hand: the till orders by name, and so does this.
// The server still keeps each dish's and section's position (and its
// endpoints to change them), which the chips follow for the sections.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { PageHeader } from '../DashboardLayout';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FIELD_SKIN, fieldTone, Input } from '../../components/Input';
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import { Spinner, StateMessage } from '../../components/StateMessage';
import { DishPhotoField } from '../../components/menu/DishPhotoField';
import { SectionTabs, sectionTabId } from '../../components/menu/SectionTabs';
import { TillTile } from '../../components/menu/TillTile';
import { useLastShown } from '../../components/motion/useDialogMotion';
import { nextTabIndex } from '../../components/schedule/calendarMotion';
import { ChargeDialog, itemsText, useTillCharge } from '../../components/store/ChargeDialog';
import {
  StaleNotice,
  TillBar,
  TillSheet,
  TillTicketPanel,
  useTillTicket,
  type LastCharge,
  type StaleActions,
} from '../../components/store/TillTicket';
import { getErrorMessage } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useLanguage, useT } from '../../lib/i18n';
import { APP_LOCALE } from '../../lib/locale';
import {
  useCreateMenuDish,
  useCreateMenuSection,
  useDeleteMenuDish,
  useDeleteMenuSection,
  useMenu,
  useRemoveDishPhoto,
  useRenameMenuSection,
  useSetDishPhoto,
  useUpdateMenuDish,
} from '../../lib/menu/api';
import { ALLERGENS, allergenLabel, sortAllergens } from '../../lib/menu/allergens';
import { photoWrite, type PhotoDraft } from '../../lib/menu/photo';
import { parsePrice, priceForField } from '../../lib/menu/price';
import { activeSection, dishesIn, sectionChips, tillDishes } from '../../lib/menu/till';
import type { MenuDish, MenuSection } from '../../lib/menu/types';
import { countOf, ticketCount, ticketTotalCents, whyNotAddable, type Ticket } from '../../lib/store/ticket';
import { readTillMode, saveTillMode, tabStorage, tillModeFor, tillModes, type TillMode } from '../../lib/store/tillDraft';
import { useCan } from '../../auth/useCan';

const NO_ALLERGENS: ReadonlySet<string> = new Set();

/** The grid's columns: as many tiles of about 170 px as fit -- five beside the sidebar at 1280 px, as on the till. */
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-1.5';

/**
 * Beside the bill (lg and up) the grid has less room, and keeps the till's
 * look by keeping its count rather than its size: four tiles across at
 * 1024 px, five from 1280 px.
 */
const GRID_BESIDE_BILL = `${GRID} lg:grid-cols-4 xl:grid-cols-5`;

/** How long "sold out: it cannot be added" stays in place of the count, after a tap on such a tile. */
const BLOCKED_NOTE_MS = 4000;

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="h-4 w-4">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
      <path d="M4 6h12M8 6V4.5A1 1 0 0 1 9 3.5h2a1 1 0 0 1 1 1V6M6 6l.7 9.1A1.5 1.5 0 0 0 8.2 16.5h3.6a1.5 1.5 0 0 0 1.5-1.4L14 6" />
    </svg>
  );
}

/** What the dish dialog is about: a new dish in a section, or one being edited. */
interface DishForm {
  dish: MenuDish | null;
  sectionId: string;
}

/** How the sections dialog opens: on its list, or straight on a new section (an empty menu). */
type SectionsStart = 'list' | 'new';

/** Which of the narrow screen's sheet is showing: the bill, or the charge. */
type SheetView = 'bill' | 'charge';

export function StoreMenuPage() {
  const t = useT();
  const menu = useMenu();

  // Each dialog stays mounted while it leaves, showing what it was about, and
  // every opening gets a fresh one (the key), as in the stock screen.
  const [openings, setOpenings] = useState(0);
  const [dishForm, setDishForm] = useState<DishForm | null>(null);
  const shownDishForm = useLastShown(dishForm);
  const [sectionsForm, setSectionsForm] = useState<SectionsStart | null>(null);
  const shownSectionsForm = useLastShown(sectionsForm);
  const open = <T,>(set: (v: T) => void, v: T) => {
    set(v);
    setOpenings((n) => n + 1);
  };

  const [chosen, setChosen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const tabsId = useId();
  const gridId = useId();

  const sections = useMemo(() => menu.data?.sections ?? [], [menu.data]);
  // Every section, the empty ones too: a new section is where its first dish goes.
  const chips = useMemo(() => sectionChips(sections, { keepEmpty: true }), [sections]);
  const section = activeSection(chips, chosen);
  const sectionName = chips.find((c) => c.id === section)?.name ?? null;
  // Read while rendering: it follows the chosen language (lib/locale.ts), and
  // so does the order.
  const locale = APP_LOCALE;
  const shown = useMemo(
    () => tillDishes(sections, { section, query, without: NO_ALLERGENS }, locale),
    [sections, section, query, locale],
  );
  const inSection = dishesIn(sections, section);
  const soldOut = inSection.filter((d) => !d.available).length;
  const searching = query.trim() !== '';

  const addDish = () => open(setDishForm, { dish: null, sectionId: section ?? sections[0].id });

  // --- The mode -----------------------------------------------------------------

  // The tab's mode, when this account has it (`tillModeFor`): an "Edit menu"
  // a manager left in this tab is not the next account's way into it.
  const allow = useCan();
  const modes = tillModes(allow('store.charge'), allow('menu.edit'));
  const canEdit = modes.includes('edit');
  const switchable = modes.length > 1;
  const [savedMode, setModeState] = useState<TillMode>(() => readTillMode(tabStorage()));
  const mode = tillModeFor(savedMode, modes);
  const setMode = (next: TillMode) => {
    setModeState(next);
    saveTillMode(tabStorage(), next);
    setBlocked(null);
  };
  const charging = mode === 'charge';
  const editing = mode === 'edit';
  const modeIds = useId();
  const modePanelId = `${modeIds}-panel`;

  // --- The bill -----------------------------------------------------------------

  const till = useTillTicket(menu.data?.sections);
  const { ticket } = till;
  const [lastCharge, setLastCharge] = useState<LastCharge | null>(null);

  // One voice for the bill: what a tap, a step or a charge did, said politely.
  // The same words twice in a row (a second tap on a sold-out dish) are told
  // apart by a trailing space, or they would not be said again.
  const [announcement, setAnnouncement] = useState('');
  const say = (text: string) => setAnnouncement((prev) => (prev === text ? `${text} ` : text));
  const totalOf = (tk: Ticket) => formatMoney(ticketTotalCents(tk) / 100);
  const methodName = (method: LastCharge['method']) => t(method === 'cash' ? 'menu.charge.cash' : 'menu.charge.card');

  // Why the last tile tapped was not added, in place of the count for a while.
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => {
    if (!blocked) return;
    const timer = window.setTimeout(() => setBlocked(null), BLOCKED_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [blocked]);

  const onTap = (dish: MenuDish) => {
    const result = till.add(dish);
    if (!result.ok) {
      // Said by the count's own live line, where it is shown.
      setBlocked(t(`menu.bill.blocked.${result.reason}`, { name: dish.name }));
      return;
    }
    setBlocked(null);
    setLastCharge(null);
    say(t('menu.bill.announce.line', { name: result.line.name, quantity: result.line.quantity, total: totalOf(result.ticket) }));
  };
  const onStep = (key: string, delta: 1 | -1) => {
    const result = till.step(key, delta);
    if (result) say(t('menu.bill.announce.line', { name: result.line.name, quantity: result.line.quantity, total: totalOf(result.ticket) }));
  };
  const onRemove = (key: string) => {
    const result = till.remove(key);
    if (result) say(t('menu.bill.announce.removed', { name: result.line.name, total: totalOf(result.ticket) }));
  };
  const onClear = () => {
    till.clear();
    say(t('menu.bill.cleared'));
  };
  const onUndoClear = () => {
    const back = till.undoClear();
    if (back) say(t('menu.bill.announce.restored', { items: itemsText(t, ticketCount(back)), total: totalOf(back) }));
  };

  // What the menu changed under the bill: the new prices, those lines off, or kept.
  const staleActions: StaleActions = {
    onUpdatePrices: () => say(t('menu.bill.announce.updated', { total: totalOf(till.updatePrices()) })),
    onRemoveStale: () => {
      const { count, ticket: after } = till.removeStale();
      say(t(count === 1 ? 'menu.bill.announce.removedLines.one' : 'menu.bill.announce.removedLines.other', { count, total: totalOf(after) }));
    },
    onKeepStale: () => {
      till.keepStale();
      say(t('menu.bill.announce.kept'));
    },
  };

  // --- Charging it ----------------------------------------------------------------
  //
  // On a wide screen in a dialog of its own; on a narrow one inside the
  // sheet, which turns from the bill into the charge.

  const [chargeOpen, setChargeOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetView | null>(null);
  const shownSheet = useLastShown(sheet);
  const charge = useTillCharge({
    ticket,
    stale: till.stale.pending.length,
    onCharged: (done) => {
      till.startNew(done.clientRef);
      setChargeOpen(false);
      setSheet(null);
      setLastCharge({ saleId: done.saleId, totalCents: done.totalCents, method: done.method, paidWith: done.paidWith });
      const total = formatMoney(done.totalCents / 100);
      say(
        done.paidWith && done.paidWith !== done.method
          ? t(done.paidWith === 'card' ? 'menu.bill.otherMethod.card' : 'menu.bill.otherMethod.cash', { total })
          : t('menu.bill.charged', { total, method: methodName(done.method) }),
      );
    },
    onRenewRef: till.renewRef,
    onCardApproved: till.markCardApproved,
  });
  // The menu as it is now, to check the bill against before it is charged:
  // another manager (or this one, in "Edit menu") may have changed it.
  const openCharge = () => {
    charge.reset();
    void menu.refetch();
    setChargeOpen(true);
  };
  const openSheet = (view: SheetView) => {
    if (view === 'charge') {
      charge.reset();
      void menu.refetch();
    }
    setSheet(view);
  };
  const chargeTop = useRef<HTMLDivElement>(null);

  // Where the narrow screen's bar lines up: this page's column.
  const page = useRef<HTMLDivElement>(null);
  const hasMenu = !menu.isLoading && sections.length > 0;
  const barShown = charging && hasMenu && (ticket.lines.length > 0 || till.setAside !== null || lastCharge !== null);

  return (
    // The bar leaves room of its own height under the grid (TillBar).
    <div ref={page}>
      <PageHeader
        title={t('menu.manage.title')}
        description={
          charging && sections.length > 0
            ? t('menu.charge.description')
            : canEdit
              ? t('menu.manage.description')
              : t('menu.manage.readOnly.description')
        }
        actions={
          sections.length > 0 && (switchable || editing) ? (
            <div className="flex flex-wrap items-center gap-2">
              {switchable && mode !== null && (
                <ModeTabs mode={mode} onChange={setMode} idBase={modeIds} panelId={modePanelId} count={ticketCount(ticket)} />
              )}
              {editing && (
                <>
                  <Button variant="secondary" className="min-h-11" aria-haspopup="dialog" onClick={() => open(setSectionsForm, 'list')}>
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" className="h-4 w-4">
                      <path d="M4 5.5h12M4 10h12M4 14.5h7" />
                    </svg>
                    {t('menu.manage.sections')}
                  </Button>
                  {/* Named for the section it adds to when one is chosen: the
                      dialog opens on it. */}
                  <Button
                    className="min-h-11"
                    aria-haspopup="dialog"
                    aria-label={sectionName !== null ? t('menu.manage.addDishTo', { name: sectionName }) : undefined}
                    onClick={addDish}
                  >
                    <PlusIcon />
                    {t('menu.section.addDish')}
                  </Button>
                </>
              )}
            </div>
          ) : undefined
        }
      />

      {menu.isLoading ? (
        <Spinner />
      ) : menu.isError && !menu.data ? (
        // Only with nothing to show: a background refetch that fails (after
        // a save, say) keeps the menu on screen rather than replacing it.
        <StateMessage tone="error" title={t('menu.manage.loadError')} description={getErrorMessage(menu.error)} />
      ) : sections.length === 0 ? (
        canEdit ? (
          <Card>
            <StateMessage title={t('menu.manage.empty.title')} description={t('menu.manage.empty.description')} />
            <div className="mt-4 flex justify-center">
              <Button className="min-h-11" onClick={() => open(setSectionsForm, 'new')}>
                {t('menu.manage.addSection')}
              </Button>
            </div>
          </Card>
        ) : (
          // Nothing to write it with: who does.
          <Card>
            <StateMessage
              title={t('menu.manage.readOnly.empty.title')}
              description={t('menu.manage.readOnly.empty.description')}
            />
          </Card>
        )
      ) : (
        <div
          // A panel of the switch only where there is one to name it.
          id={switchable ? modePanelId : undefined}
          role={switchable ? 'tabpanel' : undefined}
          aria-labelledby={switchable && mode !== null ? modeTabId(modeIds, mode) : undefined}
          className={charging ? 'lg:flex lg:items-start lg:gap-4' : undefined}
        >
          <div className="min-w-0 lg:flex-1">
            <div className="mb-3 flex flex-wrap items-start gap-x-4 gap-y-3">
              <div className="min-w-0 flex-1 basis-72">
                <SectionTabs chips={chips} value={section} onChange={setChosen} idBase={tabsId} panelId={gridId} />
              </div>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('menu.manage.search')}
                aria-label={t('menu.manage.search')}
                enterKeyHint="search"
                autoComplete="off"
                // 16 px: a smaller field makes iOS zoom the page in on focus.
                // Narrower beside the bill, so the chips keep to one line.
                className={`${FIELD_SKIN} ${fieldTone(false)} min-h-11 w-full min-w-0 rounded-xl px-3.5 py-2 text-base sm:w-64 ${charging ? 'lg:w-52' : ''}`}
              />
            </div>
            <p aria-live="polite" aria-atomic="true" className="mb-3 text-sm tabular-nums text-gray-500">
              {blocked ? (
                <span className="font-medium text-amber-300">{blocked}</span>
              ) : (
                <>
                  {searching
                    ? t('menu.manage.countFiltered', { shown: shown.length, total: inSection.length })
                    : t(inSection.length === 1 ? 'menu.manage.summary.dishes.one' : 'menu.manage.summary.dishes.other', {
                        count: inSection.length,
                      })}
                  {/* Out of the section, not of what the search found: said only without one. */}
                  {!searching && soldOut > 0 && (
                    <>
                      {' · '}
                      <span className="font-medium text-red-300">
                        {t(soldOut === 1 ? 'menu.manage.summary.soldOut.one' : 'menu.manage.summary.soldOut.other', { count: soldOut })}
                      </span>
                    </>
                  )}
                </>
              )}
            </p>

            <div id={gridId} role="tabpanel" aria-labelledby={sectionTabId(tabsId, section)}>
              <ul className={charging ? GRID_BESIDE_BILL : GRID}>
                {shown.map((dish) => (
                  <li key={dish.id} className="min-w-0">
                    {charging ? (
                      <ChargeTile dish={dish} count={countOf(ticket, dish.id)} onTap={() => onTap(dish)} />
                    ) : editing ? (
                      <DishTile dish={dish} onEdit={() => open(setDishForm, { dish, sectionId: dish.section_id })} />
                    ) : (
                      <TillTile dish={dish} size="card" />
                    )}
                  </li>
                ))}
              </ul>
              {!searching && inSection.length === 0 && (
                <p className="text-sm text-gray-500">
                  {section !== null
                    ? t('menu.section.empty')
                    : t(editing ? 'menu.manage.noDishes' : 'menu.manage.readOnly.noDishes')}
                </p>
              )}
              {/* A search that finds nothing says so, and offers the way back. */}
              {searching && shown.length === 0 && inSection.length > 0 && (
                <div className="p-3 text-center">
                  <p className="text-sm font-medium text-gray-800">{t('menu.read.noMatch')}</p>
                  <Button variant="secondary" className="mt-3 min-h-11" onClick={() => setQuery('')}>
                    {t('menu.read.filter.clear')}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {charging && (
            <TillTicketPanel
              className="hidden lg:flex"
              till={till}
              lastCharge={lastCharge}
              onDismissCharge={() => setLastCharge(null)}
              onCharge={openCharge}
              onStep={onStep}
              onRemove={onRemove}
              onClear={onClear}
              onUndoClear={onUndoClear}
              stale={staleActions}
            />
          )}
        </div>
      )}

      {/* What the bill did, said from the page -- or from the sheet or the
          charge while one is open, since a dialog hides the page from a
          screen reader. */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {sheet === null && !chargeOpen ? announcement : ''}
      </p>

      {barShown && (
        <TillBar
          till={till}
          anchor={page}
          lastCharge={lastCharge}
          onDismissCharge={() => setLastCharge(null)}
          onOpen={() => openSheet('bill')}
          onCharge={() => openSheet('charge')}
          onUndoClear={onUndoClear}
        />
      )}
      {shownSheet !== null && (
        <TillSheet
          open={sheet !== null}
          view={shownSheet}
          till={till}
          charge={charge}
          announcement={sheet !== null ? announcement : ''}
          onClose={() => setSheet(null)}
          onView={openSheet}
          onStep={onStep}
          onRemove={onRemove}
          onClear={onClear}
          onUndoClear={onUndoClear}
          stale={staleActions}
        />
      )}
      <ChargeDialog
        open={chargeOpen}
        ctl={charge}
        onClose={() => setChargeOpen(false)}
        topRef={chargeTop}
        before={<StaleNotice stale={till.stale.pending} actions={staleActions} fallbackFocus={chargeTop} />}
        announcement={chargeOpen ? announcement : ''}
      />

      {canEdit && shownSectionsForm !== null && (
        <SectionsModal
          key={`sections-${openings}`}
          open={sectionsForm !== null}
          start={shownSectionsForm}
          sections={sections}
          // A section just made is where its first dish goes: the grid turns
          // to it, with the tile that adds one.
          onCreated={(id) => setChosen(id)}
          onClose={() => setSectionsForm(null)}
        />
      )}
      {canEdit && shownDishForm !== null && (
        <DishModal
          key={`dish-${openings}`}
          open={dishForm !== null}
          dish={shownDishForm.dish}
          sectionId={shownDishForm.sectionId}
          sections={sections}
          onClose={() => setDishForm(null)}
        />
      )}
    </div>
  );
}

// --- The two modes ------------------------------------------------------------------

const MODES: readonly TillMode[] = ['charge', 'edit'];

const modeTabId = (base: string, mode: TillMode) => `${base}-mode-${mode}`;

/**
 * "Charge" and "Edit menu": a tablist in the WAI-ARIA sense, as the section
 * chips are -- the two swap what the screen under them does. Only the chosen
 * one is a Tab stop, ←/→, Home and End move between them (`nextTabIndex`),
 * and the chosen one is told by its weight and fill. "Charge" says how many
 * are on the bill, which waits there while the menu is being edited.
 *
 * Both are always within reach: the strip wraps where the header is narrow,
 * and on a phone -- where the sidebar leaves the page some 70 px -- the two
 * go one over the other, the words small and free to wrap, without their
 * icons, rather than "Edit menu" running out of the column where no finger
 * can reach it.
 */
function ModeTabs({
  mode,
  onChange,
  idBase,
  panelId,
  count,
}: {
  mode: TillMode;
  onChange: (mode: TillMode) => void;
  idBase: string;
  panelId: string;
  count: number;
}) {
  const t = useT();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const active = MODES.indexOf(mode);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const focused = buttons.current.findIndex((b) => b === document.activeElement);
    const next = nextTabIndex(focused >= 0 ? focused : active, e.key, MODES.length);
    if (next === null) return;
    e.preventDefault();
    buttons.current[next]?.focus();
    if (MODES[next] !== mode) onChange(MODES[next]);
  };

  return (
    <div
      role="tablist"
      aria-label={t('menu.mode.label')}
      onKeyDown={onKeyDown}
      className="flex max-w-full flex-wrap gap-1 rounded-xl border border-white/15 bg-white/[0.03] p-1 max-[440px]:flex-col"
    >
      {MODES.map((m, i) => {
        const selected = m === mode;
        return (
          <button
            key={m}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            id={modeTabId(idBase, m)}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) onChange(m);
            }}
            className={[
              'inline-flex min-h-10 min-w-0 items-center gap-2 rounded-lg px-3 text-sm transition-colors motion-reduce:transition-none',
              'max-[440px]:flex-wrap max-[440px]:gap-1 max-[440px]:px-2 max-[440px]:py-1.5 max-[440px]:text-left max-[440px]:text-xs max-[440px]:leading-tight',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300',
              selected ? 'bg-brand-600 font-semibold text-white shadow' : 'font-medium text-gray-700 hover:bg-white/[0.06] hover:text-gray-900',
            ].join(' ')}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4 shrink-0 max-[440px]:hidden">
              {m === 'charge' ? (
                // A till: the screen over the drawer.
                <path d="M5 3.5h10v6H5zM3 12.5h14l-1 4H4zM8 6.5h4" />
              ) : (
                // A pencil.
                <path d="m12.5 4.5 3 3L7 16H4v-3l8.5-8.5ZM11 6l3 3" />
              )}
            </svg>
            <span className="min-w-0 break-words">{t(m === 'charge' ? 'menu.mode.charge' : 'menu.mode.edit')}</span>
            {m === 'charge' && count > 0 && (
              <>
                <span
                  aria-hidden="true"
                  className={[
                    'rounded-full px-1.5 text-xs font-semibold leading-5 tabular-nums',
                    selected ? 'bg-white/20 text-white' : 'bg-brand-600 text-white',
                  ].join(' ')}
                >
                  {count}
                </span>
                <span className="sr-only">, {t('menu.mode.inBill', { count })}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

// --- The tiles --------------------------------------------------------------------

/** A tile that is a button, and its focus ring outside it. */
const TILE_BASE =
  'block w-full rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300';

/** ...and the till's press, for a tile that does something when pressed. */
const TILE_BUTTON = `${TILE_BASE} transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100`;

/**
 * One dish of the grid, in "Edit menu": the till's tile, and a button that
 * opens it. Its name is its content -- "Edit", the name, the price, "sold
 * out" -- so a screen reader hears all of it, as on the tiles of "New sale".
 */
function DishTile({ dish, onEdit }: { dish: MenuDish; onEdit: () => void }) {
  const t = useT();
  return (
    <button type="button" aria-haspopup="dialog" onClick={onEdit} className={TILE_BUTTON}>
      <TillTile dish={dish} size="card" lead={t('menu.dish.edit')} />
    </button>
  );
}

/**
 * One dish of the grid, in "Charge": a tap is one more on the bill, and the
 * corner says how many are on it (×2). A dish that cannot be sold says so on
 * the tile -- "Sold out" (TillTile), or "No price" where the menu would say
 * "Market price", once and at the foot, never over the name printed on the
 * photo -- and a tap on it adds nothing and says why above the grid. It
 * stays a button, marked unavailable rather than disabled, so the keyboard
 * still reaches it and the reason is heard: "Cannot be added, Crispy Wrap,
 * no price".
 */
function ChargeTile({ dish, count, onTap }: { dish: MenuDish; count: number; onTap: () => void }) {
  const t = useT();
  const block = whyNotAddable(dish);
  return (
    <button
      type="button"
      onClick={onTap}
      aria-disabled={block ? true : undefined}
      className={block ? `${TILE_BASE} relative cursor-not-allowed ${block === 'no_price' ? 'opacity-60' : ''}` : `${TILE_BUTTON} relative`}
    >
      <TillTile
        dish={dish}
        size="card"
        lead={t(block ? 'menu.bill.tile.cannot' : 'menu.bill.tile.add')}
        count={count}
        noPriceBadge={block === 'no_price' ? t('menu.bill.tile.noPrice') : undefined}
      />
    </button>
  );
}

/** What the sections dialog shows: the list, a name being written, or a deletion to confirm. */
type SectionsView = { kind: 'list' } | { kind: 'form'; section: MenuSection | null } | { kind: 'delete'; section: MenuSection };

/**
 * The sections, in one dialog: the list with Rename and Delete on each, and
 * "Add section" under it. Renaming, adding and deleting happen in the same
 * dialog -- one Modal whose content changes, never a second one over it --
 * and come back to the list, the focus on the row it left from. Opened on an
 * empty menu it is only the new section's name, and closes once it is saved.
 *
 * What was typed stays in the field when a save fails, with the reason under
 * it; Save is off while one is on its way. Deleting a section with dishes
 * says how many go with it.
 */
function SectionsModal({
  open,
  start,
  sections,
  onCreated,
  onClose,
}: {
  open: boolean;
  start: SectionsStart;
  sections: MenuSection[];
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const create = useCreateMenuSection();
  const rename = useRenameMenuSection();
  const remove = useDeleteMenuSection();
  const [view, setView] = useState<SectionsView>(start === 'new' ? { kind: 'form', section: null } : { kind: 'list' });
  const [name, setName] = useState('');
  const sending = useRef(false);
  const formId = useId();
  const busy = create.isPending || rename.isPending || remove.isPending;
  const error = create.error ?? rename.error ?? remove.error;

  // Where the focus goes back to on the list: the row's button that was
  // pressed, or "Add section" (the row is gone, or it was that button). Found
  // by an id of this dialog's own: the list is new on every return, and the
  // button that had the focus went with the view it was in.
  const focusIds = useId();
  const focusId = (key: string) => `${focusIds}-${key}`;
  const [refocus, setRefocus] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (view.kind !== 'list' || refocus === null) return;
    (document.getElementById(`${focusIds}-${refocus}`) ?? document.getElementById(`${focusIds}-add`))?.focus();
    setRefocus(null);
  }, [view, refocus, focusIds]);

  const go = (next: SectionsView) => {
    create.reset();
    rename.reset();
    remove.reset();
    if (next.kind === 'form') setName(next.section?.name ?? '');
    setView(next);
  };
  const toList = (focusKey: string) => {
    if (start === 'new') {
      onClose();
      return;
    }
    go({ kind: 'list' });
    setRefocus(focusKey);
  };

  // The section as the menu holds it now: a delete says how many dishes it
  // has at this moment, not when the dialog opened.
  const current = view.kind === 'list' ? null : view.section && (sections.find((s) => s.id === view.section?.id) ?? view.section);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (view.kind !== 'form' || !clean || sending.current) return;
    sending.current = true;
    const settled = () => {
      sending.current = false;
    };
    if (view.section) {
      const id = view.section.id;
      rename.mutate({ id, name: clean }, { onSuccess: () => toList(`rename:${id}`), onSettled: settled });
    } else {
      create.mutate(
        { name: clean },
        {
          onSuccess: (made) => {
            onCreated(made.id);
            toList(`rename:${made.id}`);
          },
          onSettled: settled,
        },
      );
    }
  };

  const confirmDelete = () => {
    if (view.kind !== 'delete' || sending.current) return;
    sending.current = true;
    remove.mutate(view.section.id, {
      onSuccess: () => toList('add'),
      onSettled: () => {
        sending.current = false;
      },
    });
  };

  const errorLine = error && (
    <p role="alert" className="mt-3 text-sm text-red-600">
      {getErrorMessage(error)}
    </p>
  );

  let title: string;
  let body: JSX.Element;
  let footer: JSX.Element;
  if (view.kind === 'form') {
    title = view.section ? t('menu.section.form.renameTitle') : t('menu.section.form.addTitle');
    body = (
      <form id={formId} onSubmit={onSubmit} className="space-y-4">
        <Input
          label={t('menu.section.form.name')}
          name="menu-section-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('menu.section.form.namePlaceholder')}
          maxLength={80}
          autoFocus
          required
        />
        {errorLine}
      </form>
    );
    footer = (
      <div key="form" className="flex flex-wrap items-center justify-end gap-3">
        <Button
          variant="secondary"
          className="min-h-11"
          onClick={() => toList(view.section ? `rename:${view.section.id}` : 'add')}
        >
          {t('menu.form.cancel')}
        </Button>
        <Button type="submit" form={formId} className="min-h-11" disabled={busy || !name.trim()}>
          {t('menu.form.save')}
        </Button>
      </div>
    );
  } else if (view.kind === 'delete' && current) {
    const count = current.dishes.length;
    const key = count === 0 ? 'menu.section.deleteBody.none' : count === 1 ? 'menu.section.deleteBody.one' : 'menu.section.deleteBody.other';
    title = t('menu.section.deleteTitle');
    body = (
      <>
        <p className="break-words text-sm text-gray-700">{t(key, { name: current.name, count })}</p>
        {errorLine}
      </>
    );
    footer = (
      <div key="delete" className="flex flex-wrap items-center justify-end gap-3">
        {/* The focus lands here, on the way back rather than on the way on. */}
        <Button variant="secondary" className="min-h-11" autoFocus onClick={() => toList(`delete:${current.id}`)}>
          {t('menu.form.cancel')}
        </Button>
        <Button variant="danger" className="min-h-11" disabled={busy} onClick={confirmDelete}>
          {t('menu.section.deleteConfirm')}
        </Button>
      </div>
    );
  } else {
    title = t('menu.sections.title');
    body =
      sections.length === 0 ? (
        <p className="text-sm text-gray-500">{t('menu.sections.none')}</p>
      ) : (
        <ul className="-my-2 divide-y divide-white/[0.06]">
          {sections.map((s) => {
            const count = s.dishes.length;
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                <div className="min-w-0 flex-1 basis-32">
                  <p className="break-words font-medium text-gray-900">{s.name}</p>
                  <p className="text-xs text-gray-500">
                    {t(count === 1 ? 'menu.section.dishes.one' : 'menu.section.dishes.other', { count })}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    id={focusId(`rename:${s.id}`)}
                    variant="ghost"
                    className="min-h-11"
                    aria-label={t('menu.section.renameLabel', { name: s.name })}
                    onClick={() => go({ kind: 'form', section: s })}
                  >
                    {t('menu.section.rename')}
                  </Button>
                  <Button
                    id={focusId(`delete:${s.id}`)}
                    variant="ghost"
                    className="min-h-11 hover:!bg-red-50 hover:!text-red-300"
                    aria-label={t('menu.section.deleteLabel', { name: s.name })}
                    onClick={() => go({ kind: 'delete', section: s })}
                  >
                    <TrashIcon />
                    {t('menu.section.delete')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      );
    footer = (
      <div key="list" className="flex flex-wrap items-center justify-end gap-3">
        <Button variant="secondary" className="min-h-11" onClick={onClose}>
          {t('menu.form.close')}
        </Button>
        <Button id={focusId('add')} className="min-h-11" onClick={() => go({ kind: 'form', section: null })}>
          <PlusIcon />
          {t('menu.manage.addSection')}
        </Button>
      </div>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={title} footer={footer}>
      {body}
    </Modal>
  );
}

/**
 * Adds a dish or edits one: whether it is available, its name, photo,
 * description, price, section and allergens -- and, for one that exists, the
 * way to delete it, confirmed in the same dialog.
 *
 * "Available" is a field like the rest, saved with Save: switched off, the
 * team sees the dish in grey with "Sold out" on it. It is the first thing in
 * the dialog, because during service it is the reason to open it; and the
 * name field takes the focus only for a new dish -- on a phone that opens the
 * keyboard, over a dish that was opened to be marked sold out.
 *
 * Save writes the dish and then, when it changed, its photo -- two requests,
 * because the photo has its own address and a new dish has none until it is
 * created. If the dish is saved and its photo is not, the dialog stays open
 * with the photo still picked and says so; from then on it holds the saved
 * dish, so Save again sends the photo and never creates the dish twice.
 */
function DishModal({
  open,
  dish,
  sectionId,
  sections,
  onClose,
}: {
  open: boolean;
  dish: MenuDish | null;
  sectionId: string;
  sections: MenuSection[];
  onClose: () => void;
}) {
  const t = useT();
  const { language } = useLanguage();
  const create = useCreateMenuDish();
  const update = useUpdateMenuDish();
  const putPhoto = useSetDishPhoto();
  const removePhoto = useRemoveDishPhoto();
  const removeDish = useDeleteMenuDish();
  const [available, setAvailable] = useState(dish?.available ?? true);
  const [name, setName] = useState(dish?.name ?? '');
  const [description, setDescription] = useState(dish?.description ?? '');
  const [priceText, setPriceText] = useState(() => priceForField(dish?.price ?? null, language === 'es' ? ',' : '.'));
  const [section, setSection] = useState(sectionId);
  const [allergens, setAllergens] = useState<ReadonlySet<string>>(() => new Set(dish?.allergens ?? []));
  const [photo, setPhoto] = useState<PhotoDraft>({ kind: 'keep' });
  const [preparing, setPreparing] = useState(false);
  // The dish as the server has it: the one being edited, or the one this
  // dialog created before its photo failed.
  const [saved, setSaved] = useState<MenuDish | null>(dish);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; dishSaved: boolean } | null>(null);
  // Deleting is asked in this same dialog: the form is kept (hidden) under
  // the question, so "Cancel" comes back to it exactly as it was.
  const [confirming, setConfirming] = useState(false);
  const sending = useRef(false);
  const formId = useId();
  const ids = useId();
  // Back from the question, the focus goes to the button that asked it: the
  // one it was on went with the question's footer.
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasConfirming.current && !confirming) document.getElementById(`${ids}-delete`)?.focus();
    wasConfirming.current = confirming;
  }, [confirming, ids]);

  const price = parsePrice(priceText);
  const priceInvalid = priceText.trim() !== '' && price === null;
  const busy = saving || removeDish.isPending;

  const toggle = (code: string) =>
    setAllergens((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean || priceInvalid || preparing || sending.current) return;
    sending.current = true;
    setSaving(true);
    setFailure(null);
    const payload = {
      name: clean,
      description: description.trim() || null,
      price,
      allergens: sortAllergens([...allergens]),
    };
    let written: MenuDish | null = null;
    try {
      written = saved
        ? // The section only when it changed: sending it moves the dish to the
          // end of that section, which is not what saving a new price means.
          // "Available" only when it changed too: another manager may have
          // marked the dish sold out while this dialog was open.
          await update.mutateAsync({
            id: saved.id,
            ...payload,
            ...(section !== saved.section_id ? { section_id: section } : {}),
            ...(available !== saved.available ? { available } : {}),
          })
        : await create.mutateAsync({ section_id: section, ...payload, available });
      setSaved(written);
      const write = photoWrite(photo, Boolean(written.photo_url));
      if (write?.kind === 'put') await putPhoto.mutateAsync({ id: written.id, photo: write.blob });
      else if (write?.kind === 'delete') await removePhoto.mutateAsync(written.id);
      onClose();
    } catch (error) {
      setFailure({ error, dishSaved: written !== null });
    } finally {
      sending.current = false;
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!saved || sending.current) return;
    sending.current = true;
    removeDish.mutate(saved.id, {
      onSuccess: onClose,
      onSettled: () => {
        sending.current = false;
      },
    });
  };

  const footer = confirming ? (
    <div key="delete" className="flex flex-wrap items-center justify-end gap-3">
      {removeDish.error && (
        <p role="alert" className="w-full text-sm text-red-600 sm:w-auto sm:flex-1">
          {getErrorMessage(removeDish.error)}
        </p>
      )}
      <Button variant="secondary" className="min-h-11" autoFocus onClick={() => setConfirming(false)}>
        {t('menu.form.cancel')}
      </Button>
      <Button variant="danger" className="min-h-11" disabled={busy} onClick={confirmDelete}>
        {t('menu.dish.deleteConfirm')}
      </Button>
    </div>
  ) : (
    <div key="form" className="flex w-full flex-wrap items-center justify-end gap-3">
      {/* In the footer, which does not scroll: at the end of the form it
          sat under the fourteen allergens, below the fold, and Save
          looked like it had done nothing at all. */}
      {failure && (
        <p role="alert" className="w-full text-sm text-red-600">
          {failure.dishSaved
            ? t('menu.photo.savedWithout', { reason: getErrorMessage(failure.error) })
            : getErrorMessage(failure.error)}
        </p>
      )}
      {saved && (
        <Button
          id={`${ids}-delete`}
          variant="ghost"
          className="mr-auto min-h-11 hover:!bg-red-50 hover:!text-red-300"
          disabled={busy}
          onClick={() => {
            removeDish.reset();
            setConfirming(true);
          }}
        >
          <TrashIcon />
          {t('menu.dish.delete')}
        </Button>
      )}
      {/* The two wrap together, never Save alone on a line. */}
      <div className="ml-auto flex items-center gap-3">
        <Button variant="secondary" className="min-h-11" onClick={onClose}>
          {t('menu.form.cancel')}
        </Button>
        <Button type="submit" form={formId} className="min-h-11" disabled={busy || preparing || !name.trim() || priceInvalid}>
          {t('menu.form.save')}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={confirming ? t('menu.dish.deleteTitle') : dish ? t('menu.dish.form.editTitle') : t('menu.dish.form.addTitle')}
      footer={footer}
    >
      {confirming && <p className="break-words text-sm text-gray-700">{t('menu.dish.deleteBody', { name: saved?.name ?? name })}</p>}
      <form id={formId} hidden={confirming} onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        {/* A switch: on is the normal state, and a sold-out dish is the one
            that is off -- the knob's side and the sentence under it say which
            as well as its colour. */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5">
          <button
            type="button"
            role="switch"
            aria-checked={available}
            aria-describedby={`${ids}-available`}
            onClick={() => setAvailable((a) => !a)}
            className="-mx-1 inline-flex min-h-11 items-center gap-3 rounded-lg px-1 text-sm font-medium text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
          >
            <span
              aria-hidden="true"
              className={[
                'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors motion-reduce:transition-none',
                available ? 'border-brand-400/70 bg-brand-100' : 'border-gray-400 bg-white/[0.04]',
              ].join(' ')}
            >
              <span
                className={[
                  'h-4 w-4 rounded-full shadow transition-transform duration-200 motion-reduce:transition-none',
                  available ? 'translate-x-[1.1rem] bg-brand-300' : 'translate-x-[0.2rem] bg-gray-500',
                ].join(' ')}
              />
            </span>
            {t('menu.dish.available')}
          </button>
          <p id={`${ids}-available`} className={['pb-1 text-xs', available ? 'text-gray-500' : 'font-medium text-red-300'].join(' ')}>
            {available ? t('menu.dish.form.availableOn') : t('menu.dish.form.availableOff')}
          </p>
        </div>
        <Input
          label={t('menu.dish.form.name')}
          name="menu-dish-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('menu.dish.form.namePlaceholder')}
          maxLength={120}
          autoFocus={!dish}
          required
        />
        <DishPhotoField
          name={name}
          current={saved?.photo_url ?? null}
          value={photo}
          onChange={setPhoto}
          onPreparing={setPreparing}
          disabled={busy}
        />
        <div className="group/field flex flex-col gap-1">
          <label htmlFor={`${ids}-description`} className="text-sm font-medium text-gray-700 transition-colors duration-200 group-focus-within/field:text-brand-300 motion-reduce:transition-none">
            {t('menu.dish.form.description')}
          </label>
          <textarea
            id={`${ids}-description`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('menu.dish.form.descriptionPlaceholder')}
            maxLength={500}
            rows={3}
            className={`${FIELD_SKIN} ${fieldTone(false)} block w-full resize-y rounded-xl px-3.5 py-2.5`}
          />
        </div>
        {/* grid-cols-1 and not the implicit column: that one grows to the
            select's longest option -- a long section name -- and pushed both
            fields past the dialog's edge on a phone. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <Input
              label={t('menu.dish.form.price')}
              name="menu-dish-price"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              placeholder={t('menu.dish.form.pricePlaceholder')}
              inputMode="decimal"
              autoComplete="off"
              maxLength={12}
              aria-describedby={`${ids}-price-help`}
              // The field turns red; the sentence is the one below, which
              // the field points at in both states.
              error={priceInvalid ? ' ' : undefined}
            />
            <p
              id={`${ids}-price-help`}
              className={['mt-1 text-xs', priceInvalid ? 'font-medium text-red-300' : 'text-gray-500'].join(' ')}
            >
              {priceInvalid ? t('menu.dish.form.priceInvalid') : t('menu.dish.form.priceHelp')}
            </p>
          </div>
          <Select
            label={t('menu.dish.form.section')}
            name="menu-dish-section"
            value={section}
            onChange={(e) => setSection(e.target.value)}
          >
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-gray-700">{t('menu.dish.form.allergens')}</legend>
          <p className="mt-0.5 text-xs text-gray-500">{t('menu.dish.form.allergensHelp')}</p>
          <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
            {ALLERGENS.map((code) => (
              <label
                key={code}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-gray-700 hover:bg-white/[0.05] has-[:checked]:text-gray-900"
              >
                <input
                  type="checkbox"
                  checked={allergens.has(code)}
                  onChange={() => toggle(code)}
                  className="h-4 w-4 shrink-0 accent-brand-500"
                />
                <span className="min-w-0 break-words">{allergenLabel(code)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
