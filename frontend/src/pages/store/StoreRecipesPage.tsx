// Recipes: what each product of the menu takes from the inventory when it is
// sold. The one place where that is set -- Sales and Menu know nothing of it
// (Max, 27-sep-2026: "lo que representa cada producto no se ve en Ventas ni
// en Menú").
//
// The menu, section by section, each product saying whether it has a recipe
// and what it is ("0,75 kg Pollo · 0,1 kg Cebolla", "1 Crispy Grande + 1
// Patatas"). Every product of the menu shows its face wherever the screen
// names it -- its photo on the menu, its initials without one (Max,
// 28-sep-2026: "que en esta pantalla también salgan los logos de cada
// producto") --, as every ingredient shows its photo in the inventory. Its dialog sets two lists: Ingredients -- products of the
// inventory, each in its own unit, typed as a kitchen says it ("3/4", "1/2",
// "0,75", "1") -- and Includes -- other products of the menu inside this one,
// as a combo is, whose ingredients it inherits. Under both, as they are typed,
// what one sale takes in all.
//
// Above the list, "Try a sale": pick what is sold and see what would come off
// the stock and how each ingredient would stand after, with what is below its
// minimum or below zero said in words. Nothing is saved: it is the arithmetic
// the server will do with the sale (lib/store/recipes.ts), done first.
//
// A recipe changes only what NEW sales take; every sale keeps what it took
// when it was saved. The dialog says so.
//
// A product with no recipe that is called the same as one product of the
// inventory takes 1 of it per sale, with nothing set up ("Agua" and "Agua":
// the automatic link, services/recipes.py). Its row says so -- "Automatic: 1
// × Agua (same name)" -- and counts as taking from the stock; its dialog says
// that a recipe of its own replaces the link, and -- a recipe of its own
// emptied -- that the link comes back ("Left without a recipe, it will take 1
// × Agua"). Called the same as several, it has no link, and its row says
// which. "Try a sale" goes by the same rule.
//
// Setting a recipe is the manager's (`store.recipes.edit`, lib/access.ts). An
// employee and the till's tablet read the same list, with no button on its
// rows and no dialog, and can still "Try a sale": it saves nothing (Max,
// 28-sep-2026).

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../DashboardLayout';
import { useWorkspaceApps } from '../../auth/useWorkspaceApps';
import { useCan } from '../../auth/useCan';
import { formatQuantity, onHand, useInventoryItems, type InventoryItem } from '../../api/inventory';
import {
  autoMatches,
  ingredientLabels,
  linkWhenEmptied,
  recipeBook,
  recipeStatus,
  takesFromStock,
  useRecipes,
  useSaveRecipe,
  type IngredientLabel,
  type RecipeDish,
  type RecipeSection,
  type RecipeStatus,
} from '../../api/recipes';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FIELD_SKIN, fieldTone, Input } from '../../components/Input';
import { Modal } from '../../components/Modal';
import { SquarePhoto } from '../../components/photo/SquarePhoto';
import { Select } from '../../components/Select';
import { Spinner, StateMessage } from '../../components/StateMessage';
import { Table, TBody, TD, TH, THead, TR } from '../../components/Table';
import { useLastShown } from '../../components/motion/useDialogMotion';
import { getErrorMessage } from '../../lib/api';
import { plural, useT, type TFunction } from '../../lib/i18n';
import {
  COMPONENT_QUANTITY_CEILING,
  expandDish,
  expandSale,
  includeBlock,
  isFraction,
  ITEM_QUANTITY_CEILING,
  MAX_RECIPE_COMPONENTS,
  MAX_RECIPE_DEPTH,
  MAX_RECIPE_ITEMS,
  nothingToInclude,
  parseRecipeQuantity,
  trialView,
  withRecipe,
  type RecipeBook,
  type RecipeParts,
} from '../../lib/store/recipes';
import { parseSaleQuantity } from '../../lib/store/sale';
import { groupByCategory } from '../inventory/InventoryStockPage';

/** A square control a thumb can hit: 44 px, as the menu's are. */
const ICON_BUTTON =
  'grid h-11 w-11 shrink-0 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-red-50 hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-5 w-5">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** What is known of an ingredient to show it: its name, its unit, whether it is archived, its photo. */
type ItemLabel = IngredientLabel;

/** "0,75 kg Pollo", or "2 Pan" for a product counted in plain units. */
function amountOf(quantity: number, label: ItemLabel | undefined, t: TFunction): string {
  const name = label?.name ?? t('recipes.unknownItem');
  return label?.unit ? `${formatQuantity(quantity)} ${label.unit} ${name}` : `${formatQuantity(quantity)} ${name}`;
}

/** "0,75 kg", or "2" without a unit. */
function withUnit(quantity: number, unit: string | null | undefined): string {
  return unit ? `${formatQuantity(quantity)} ${unit}` : formatQuantity(quantity);
}

/**
 * A product's recipe in a line: the products it includes ("1 Crispy Grande +
 * 1 Patatas"), then its own ingredients ("0,05 kg Salsa · 0,01 kg Sal").
 */
function recipeSummary(dish: RecipeDish, t: TFunction): string {
  const included = dish.components.map((c) => `${formatQuantity(c.quantity)} ${c.name}`).join(' + ');
  const own = dish.items
    .map((i) => {
      const text = amountOf(i.quantity, i, t);
      return i.archived ? `${text} (${t('recipes.archived')})` : text;
    })
    .join(' · ');
  return [included, own].filter(Boolean).join(' · ');
}

/** The status of a product, in words and in a colour that is never alone. */
const STATUS_BADGE: Record<RecipeStatus, { tone: 'green' | 'blue' | 'amber' | 'gray'; key: string }> = {
  recipe: { tone: 'green', key: 'recipes.status.with' },
  auto: { tone: 'blue', key: 'recipes.status.auto' },
  ambiguous: { tone: 'amber', key: 'recipes.status.ambiguous' },
  none: { tone: 'gray', key: 'recipes.status.without' },
};

/** A product as the pickers list it: its name, and what it takes when that is nothing or only the link. */
function dishOption(dish: RecipeDish, t: TFunction): string {
  const status = recipeStatus(dish);
  if (status === 'recipe') return dish.name;
  return `${dish.name} (${t(status === 'auto' ? 'recipes.auto.tag' : 'recipes.noRecipeTag')})`;
}

/** "Several products of the inventory are called this (Cola, COLA)…", or the same without the names. */
/** Each product of the menu's photo, by its id. */
function photosOf(sections: readonly RecipeSection[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const section of sections) for (const d of section.dishes) out.set(d.dish_id, d.photo_url);
  return out;
}

function ambiguousText(dish: RecipeDish, stock: readonly InventoryItem[], t: TFunction, key: 'recipes.auto.ambiguous' | 'recipes.edit.autoAmbiguous'): string {
  const names = autoMatches(dish, stock);
  return names.length > 0 ? t(key, { names: names.join(', ') }) : t(`${key}Unnamed`);
}

/**
 * Every name, unit and photo this screen may have to show for an ingredient:
 * the recipes' own (which include archived products) and, fresher, the
 * inventory's (api/recipes.ts, with tests).
 */
function useItemLabels(sections: readonly RecipeSection[], stock: readonly InventoryItem[]) {
  return useMemo(() => ingredientLabels(sections, stock), [sections, stock]);
}

export function StoreRecipesPage() {
  const t = useT();
  // A recipe is made of products of the inventory: without that app there is
  // nothing to make one of.
  const hasInventory = useWorkspaceApps().includes('inventory');
  if (!hasInventory) {
    return (
      <div>
        <PageHeader title={t('recipes.title')} description={t('recipes.description')} />
        <Card>
          <StateMessage title={t('recipes.noInventory.title')} description={t('recipes.noInventory.description')} />
        </Card>
      </div>
    );
  }
  return <RecipesScreen />;
}

function RecipesScreen() {
  const t = useT();
  const navigate = useNavigate();
  const recipes = useRecipes();
  // Archived ones too: a recipe can still hold one, and a sale still takes it.
  const stock = useInventoryItems(true);
  const sections = useMemo(() => recipes.data ?? [], [recipes.data]);
  const stockItems = useMemo(() => stock.data ?? [], [stock.data]);
  const book = useMemo(() => recipeBook(sections), [sections]);
  const labels = useItemLabels(sections, stockItems);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const allow = useCan();
  const canEdit = allow('store.recipes.edit');
  const canWriteMenu = allow('menu.edit');

  // The dialog stays mounted while it leaves, and every opening gets a fresh
  // one (the key), as the menu's dialogs do.
  const [editing, setEditing] = useState<RecipeDish | null>(null);
  const shownEditing = useLastShown(editing);
  const [openings, setOpenings] = useState(0);
  const edit = (dish: RecipeDish) => {
    setEditing(dish);
    setOpenings((n) => n + 1);
  };

  const total = sections.reduce((n, s) => n + s.dishes.length, 0);
  // Taking from the stock is what counts: a recipe, or the automatic link.
  const done = sections.reduce((n, s) => n + s.dishes.filter(takesFromStock).length, 0);
  // A section with nothing in it (an empty one of the menu, or every product
  // already taking from the stock under the filter) is not shown at all.
  const shown = sections
    .map((s) => (onlyMissing ? { ...s, dishes: s.dishes.filter((d) => !takesFromStock(d)) } : s))
    .filter((s) => s.dishes.length > 0);

  return (
    <div>
      <PageHeader
        title={t('recipes.title')}
        description={t(canEdit ? 'recipes.description' : 'recipes.descriptionReadOnly')}
      />

      {recipes.isLoading ? (
        <Spinner />
      ) : recipes.isError && !recipes.data ? (
        <StateMessage tone="error" title={t('recipes.loadError')} description={getErrorMessage(recipes.error)} />
      ) : total === 0 ? (
        <Card>
          <StateMessage
            title={t('recipes.empty.title')}
            description={t(canWriteMenu ? 'recipes.empty.description' : 'recipes.empty.descriptionReadOnly')}
          />
          {/* To write the menu: nothing to go there for without that. */}
          {canWriteMenu && (
            <div className="mt-4 flex justify-center">
              <Button className="min-h-11" onClick={() => navigate('/store/menu')}>
                {t('recipes.empty.action')}
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-white/[0.05] px-3 py-1 text-gray-700 ring-1 ring-inset ring-white/10">
              {t(total === 1 ? 'recipes.summary.one' : 'recipes.summary.other', { done, total })}
            </span>
          </div>

          <SaleTrial sections={sections} book={book} labels={labels} stock={stock} />

          <div className="mb-4 mt-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">{t('recipes.list.title')}</h2>
            <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={onlyMissing}
                onChange={(e) => setOnlyMissing(e.target.checked)}
                className="h-4 w-4 accent-brand-500"
              />
              {t('recipes.list.onlyMissing')}
            </label>
          </div>

          {shown.length === 0 ? (
            <Card>
              <StateMessage title={t('recipes.list.allDone')} />
            </Card>
          ) : (
            <div className="space-y-5">
              {shown.map((section) => (
                <SectionCard key={section.id} section={section} stock={stockItems} onEdit={canEdit ? edit : undefined} />
              ))}
            </div>
          )}
        </>
      )}

      {canEdit && shownEditing !== null && (
        <RecipeModal
          key={openings}
          open={editing !== null}
          dish={shownEditing}
          sections={sections}
          book={book}
          labels={labels}
          stock={stock}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SectionCard({
  section,
  stock,
  onEdit,
}: {
  section: RecipeSection;
  stock: readonly InventoryItem[];
  /** Opens the product's recipe; without it (read only) the rows have no button. */
  onEdit?: (dish: RecipeDish) => void;
}) {
  const t = useT();
  const headingId = useId();
  const actionOf = (dish: RecipeDish) => t(dish.has_recipe ? 'recipes.row.edit' : 'recipes.row.add');
  /** What selling it takes, in a line: its recipe, the link, or why nothing. */
  const lineOf = (dish: RecipeDish) => {
    switch (recipeStatus(dish)) {
      case 'recipe':
        return recipeSummary(dish, t);
      case 'auto':
        return t('recipes.auto.summary', { name: dish.auto_item!.name });
      case 'ambiguous':
        return ambiguousText(dish, stock, t, 'recipes.auto.ambiguous');
      default:
        return t('recipes.row.nothing');
    }
  };
  return (
    <Card aria-labelledby={headingId}>
      <h3 id={headingId} className="break-words text-base font-semibold text-gray-900">
        {section.name}
      </h3>
      <ul className="mt-3 divide-y divide-white/[0.06]">
        {section.dishes.map((dish) => (
          <li key={dish.dish_id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              {/* The photo beside the words, and above the button with them
                  on a phone. Decoration: the name is right there. */}
              <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
                <SquarePhoto name={dish.name} url={dish.photo_url} size="thumb" alt="" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="break-words text-sm font-medium text-gray-900">{dish.name}</p>
                    {/* Said in words, not only in colour. */}
                    <Badge tone={STATUS_BADGE[recipeStatus(dish)].tone}>{t(STATUS_BADGE[recipeStatus(dish)].key)}</Badge>
                  </div>
                  <p
                    className={[
                      'mt-0.5 break-words text-xs',
                      recipeStatus(dish) === 'ambiguous' ? 'text-amber-800' : 'text-gray-500',
                    ].join(' ')}
                  >
                    {lineOf(dish)}
                  </p>
                </div>
              </div>
              {/* The name starts with the words on the button, so "Edit
                  recipe" said to a voice control finds it (WCAG 2.5.3);
                  the product after it tells one row's from another's. */}
              {onEdit && (
                <Button
                  variant="secondary"
                  className="min-h-11"
                  aria-label={t('recipes.row.editLabel', { action: actionOf(dish), name: dish.name })}
                  onClick={() => onEdit(dish)}
                >
                  {actionOf(dish)}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// --- The recipe of one product ----------------------------------------------------

/** A line of the dialog: an ingredient or an included product, and its quantity as typed. */
interface Line {
  id: string;
  text: string;
}

/**
 * One product's recipe: its ingredients and the products it includes, each
 * with a quantity, and under them what one sale takes in all. Save replaces
 * the whole recipe; a product with both lists empty has none.
 */
function RecipeModal({
  open,
  dish,
  sections,
  book,
  labels,
  stock,
  onClose,
}: {
  open: boolean;
  dish: RecipeDish;
  sections: readonly RecipeSection[];
  book: RecipeBook;
  labels: ReadonlyMap<string, ItemLabel>;
  stock: ReturnType<typeof useInventoryItems>;
  onClose: () => void;
}) {
  const t = useT();
  const save = useSaveRecipe();
  const formId = useId();
  const ids = useId();
  const [items, setItems] = useState<Line[]>(() =>
    dish.items.map((i) => ({ id: i.item_id, text: formatQuantity(i.quantity) })),
  );
  const [components, setComponents] = useState<Line[]>(() =>
    dish.components.map((c) => ({ id: c.dish_id, text: formatQuantity(c.quantity) })),
  );
  const [pickItem, setPickItem] = useState('');
  const [pickDish, setPickDish] = useState('');
  const [tried, setTried] = useState(false);
  const sending = useRef(false);
  // While the recipe is on its way it stays open -- Escape, the cross, the
  // backdrop and Cancel do nothing -- so a refusal has somewhere to be read:
  // closed, it would be lost with the dialog. The request has its timeout
  // (lib/api.ts), so this cannot hold it open for good.
  const close = () => {
    if (!save.isPending && !sending.current) onClose();
  };

  // Where the focus goes after a line is added (its quantity) or removed
  // (the picker of its list): the element it was on is gone.
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  const dishNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const section of sections) for (const d of section.dishes) names.set(d.dish_id, d.name);
    for (const c of dish.components) if (!names.has(c.dish_id)) names.set(c.dish_id, c.name);
    return names;
  }, [sections, dish]);
  const dishPhotos = useMemo(() => photosOf(sections), [sections]);

  const readItems = items.map((line) => ({ ...line, value: parseRecipeQuantity(line.text, ITEM_QUANTITY_CEILING) }));
  const readComponents = components.map((line) => ({
    ...line,
    value: parseRecipeQuantity(line.text, COMPONENT_QUANTITY_CEILING),
  }));
  const anyInvalid = [...readItems, ...readComponents].some((line) => line.value === null);
  const draft: RecipeParts = {
    items: readItems.filter((l) => l.value !== null).map((l) => ({ item_id: l.id, quantity: l.value! })),
    components: readComponents.filter((l) => l.value !== null).map((l) => ({ dish_id: l.id, quantity: l.value! })),
  };
  // What one sale takes, the recipe as it is typed and every other product's
  // as it is saved. Emptied, a product called the same as one product of the
  // inventory goes (back) to the automatic link: saving "no recipe" is what
  // brings the link back -- also for one that had a recipe of its own, which
  // the preview then says in words (`name_match`).
  const draftEmpty = draft.items.length === 0 && draft.components.length === 0 && !anyInvalid;
  const emptied = linkWhenEmptied(dish, draftEmpty);
  const linked = emptied?.item ?? null;
  const perSale = expandDish(
    withRecipe(book, dish.dish_id, linked ? { items: [{ item_id: linked.item_id, quantity: 1 }], components: [] } : draft),
    dish.dish_id,
  );

  // What can be added: products of the inventory that are not archived and
  // not in the recipe yet; products of the menu that are not this one, not in
  // it yet, do not contain it (that would make it contain itself), and would
  // not make a chain of products inside products deeper than the server takes.
  const stockItems = stock.data ?? [];
  const picked = pickItem ? stockItems.find((i) => i.id === pickItem) : undefined;
  const itemChoices = groupByCategory(
    stockItems.filter((i) => i.archived_at === null && !items.some((l) => l.id === i.id)),
  );
  const included = components.map((l) => l.id);
  const dishChoices = sections
    .map((s) => ({
      ...s,
      dishes: s.dishes.filter((d) => includeBlock(book, dish.dish_id, included, d.dish_id) === null),
    }))
    .filter((s) => s.dishes.length > 0);
  // Said apart: a menu with nothing else on it, or all of it in already, is
  // not a rule of recipes getting in the way.
  const noDishes = nothingToInclude(
    book,
    dish.dish_id,
    included,
    sections.flatMap((s) => s.dishes.map((d) => d.dish_id)),
  );

  const addItem = () => {
    if (!pickItem || items.length >= MAX_RECIPE_ITEMS || items.some((l) => l.id === pickItem)) return;
    setItems((prev) => [...prev, { id: pickItem, text: '' }]);
    setFocusId(`${ids}-item-${pickItem}`);
    setPickItem('');
  };
  const addComponent = () => {
    if (!pickDish || components.length >= MAX_RECIPE_COMPONENTS || components.some((l) => l.id === pickDish)) return;
    setComponents((prev) => [...prev, { id: pickDish, text: '1' }]);
    setFocusId(`${ids}-dish-${pickDish}`);
    setPickDish('');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (anyInvalid || sending.current) return;
    sending.current = true;
    save.mutate(
      { dishId: dish.dish_id, items: [...draft.items], components: [...draft.components] },
      {
        onSuccess: onClose,
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  };

  /** The line under a quantity: what is wrong with it, or what a fraction came to. */
  const hintFor = (line: { text: string; value: number | null }, unit: string | null, ceiling: number) => {
    if (line.value === null) {
      if (!tried && line.text.trim() === '') return null;
      // A quantity, only too much of it for one unit.
      if (parseRecipeQuantity(line.text) !== null) {
        return { bad: true, text: t('recipes.edit.quantityTooBig', { max: formatQuantity(ceiling) }) };
      }
      return { bad: true, text: t('recipes.edit.quantityInvalid') };
    }
    if (isFraction(line.text)) return { bad: false, text: `= ${withUnit(line.value, unit)}` };
    return null;
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('recipes.edit.title', { name: dish.name })}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {/* In the footer, which does not scroll, so a refusal is seen. */}
          {save.isError && (
            <p role="alert" className="w-full text-sm text-red-600 sm:w-auto sm:flex-1">
              {getErrorMessage(save.error)}
            </p>
          )}
          {tried && anyInvalid && (
            <p role="alert" className="w-full text-sm text-red-600 sm:w-auto sm:flex-1">
              {t('recipes.edit.fixQuantities')}
            </p>
          )}
          <Button variant="secondary" className="min-h-11" disabled={save.isPending} onClick={close}>
            {t('recipes.edit.cancel')}
          </Button>
          <Button type="submit" form={formId} className="min-h-11" disabled={save.isPending}>
            {save.isPending ? t('recipes.edit.saving') : t('recipes.edit.save')}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="space-y-5">
        <p className="text-xs text-gray-500">{t('recipes.edit.onlyNewSales')}</p>
        {/* The automatic link, and that a recipe of its own replaces it; or
            why it has none. */}
        {dish.auto_item && (
          <p className="rounded-xl border border-sky-400/25 bg-sky-400/[0.08] px-3 py-2 text-sm text-gray-800">
            {t('recipes.edit.auto', { item: dish.auto_item.name })}
          </p>
        )}
        {dish.auto_ambiguous && (
          <p className="rounded-xl border border-amber-200/60 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {ambiguousText(dish, stock.data ?? [], t, 'recipes.edit.autoAmbiguous')}
          </p>
        )}

        {/* --- Ingredients --- */}
        <section aria-labelledby={`${ids}-items-title`}>
          <h3 id={`${ids}-items-title`} className="text-sm font-semibold text-gray-900">
            {t('recipes.edit.items')}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">{t('recipes.edit.itemsHelp')}</p>
          {items.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">{t('recipes.edit.noItems')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-white/[0.06]">
              {readItems.map((line) => {
                const label = labels.get(line.id);
                const name = label?.name ?? t('recipes.unknownItem');
                return (
                  <QuantityLine
                    key={line.id}
                    inputId={`${ids}-item-${line.id}`}
                    name={name}
                    photo={{ url: label?.photo_url, alt: '' }}
                    note={label?.archived ? t('recipes.archived') : null}
                    unit={label?.unit ?? null}
                    text={line.text}
                    hint={hintFor(line, label?.unit ?? null, ITEM_QUANTITY_CEILING)}
                    removeLabel={t('recipes.edit.remove', { name })}
                    onText={(text) =>
                      setItems((prev) => prev.map((l) => (l.id === line.id ? { ...l, text } : l)))
                    }
                    onRemove={() => {
                      setItems((prev) => prev.filter((l) => l.id !== line.id));
                      setFocusId(`${ids}-pick-item`);
                    }}
                  />
                );
              })}
            </ul>
          )}
          {stock.isLoading ? (
            <Spinner />
          ) : stock.isError ? (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {t('recipes.edit.stockError', { reason: getErrorMessage(stock.error) })}
            </p>
          ) : items.length >= MAX_RECIPE_ITEMS ? (
            <p className="mt-2 text-xs text-gray-500">{t('recipes.edit.maxItems', { count: MAX_RECIPE_ITEMS })}</p>
          ) : itemChoices.length === 0 ? (
            <p className="mt-2 text-xs text-gray-500">
              {t(items.length === 0 ? 'recipes.edit.noStock' : 'recipes.edit.allItemsIn')}
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              {/* The product picked, by its face: an <option> cannot show a
                  photo. Its place is kept empty until one is picked, so
                  picking moves nothing. */}
              <SquarePhoto
                name={picked?.name ?? ''}
                url={picked?.photo_url}
                size="row"
                alt=""
                className="mb-0.5"
              />
              <div className="min-w-0 flex-1 basis-40">
                <Select
                  id={`${ids}-pick-item`}
                  label={t('recipes.edit.addItem')}
                  value={pickItem}
                  onChange={(e) => setPickItem(e.target.value)}
                  className="w-full"
                >
                  <option value="">{t('recipes.edit.pickItem')}</option>
                  {itemChoices.map(([category, list]) => (
                    <optgroup key={category ?? ''} label={category ?? t('inventory.stock.uncategorised')}>
                      {list.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.unit ? `${i.name} (${i.unit})` : i.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
              <Button type="button" variant="secondary" className="min-h-11" disabled={!pickItem} onClick={addItem}>
                {t('recipes.edit.add')}
              </Button>
            </div>
          )}
        </section>

        {/* --- Included products --- */}
        <section aria-labelledby={`${ids}-dishes-title`}>
          <h3 id={`${ids}-dishes-title`} className="text-sm font-semibold text-gray-900">
            {t('recipes.edit.components')}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">{t('recipes.edit.componentsHelp')}</p>
          {components.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">{t('recipes.edit.noComponents')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-white/[0.06]">
              {readComponents.map((line) => {
                const name = dishNames.get(line.id) ?? t('recipes.unknownDish');
                return (
                  <QuantityLine
                    key={line.id}
                    inputId={`${ids}-dish-${line.id}`}
                    name={name}
                    photo={{ url: dishPhotos.get(line.id), alt: '' }}
                    note={null}
                    unit={null}
                    text={line.text}
                    hint={hintFor(line, null, COMPONENT_QUANTITY_CEILING)}
                    removeLabel={t('recipes.edit.remove', { name })}
                    onText={(text) =>
                      setComponents((prev) => prev.map((l) => (l.id === line.id ? { ...l, text } : l)))
                    }
                    onRemove={() => {
                      setComponents((prev) => prev.filter((l) => l.id !== line.id));
                      setFocusId(`${ids}-pick-dish`);
                    }}
                  />
                );
              })}
            </ul>
          )}
          {components.length >= MAX_RECIPE_COMPONENTS ? (
            <p className="mt-2 text-xs text-gray-500">
              {t('recipes.edit.maxComponents', { count: MAX_RECIPE_COMPONENTS })}
            </p>
          ) : dishChoices.length === 0 ? (
            <p className="mt-2 text-xs text-gray-500">
              {noDishes === 'no_others'
                ? t('recipes.edit.noOtherDishes')
                : noDishes === 'all_in'
                  ? t('recipes.edit.allDishesIn')
                  : t('recipes.edit.noDishes', { max: MAX_RECIPE_DEPTH })}
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              {/* As the ingredient's: the product picked, by its face. */}
              <SquarePhoto
                name={pickDish ? (dishNames.get(pickDish) ?? '') : ''}
                url={pickDish ? dishPhotos.get(pickDish) : null}
                size="row"
                alt=""
                className="mb-0.5"
              />
              <div className="min-w-0 flex-1 basis-48">
                <Select
                  id={`${ids}-pick-dish`}
                  label={t('recipes.edit.addComponent')}
                  value={pickDish}
                  onChange={(e) => setPickDish(e.target.value)}
                  className="w-full"
                >
                  <option value="">{t('recipes.edit.pickDish')}</option>
                  {dishChoices.map((s) => (
                    <optgroup key={s.id} label={s.name}>
                      {s.dishes.map((d) => (
                        <option key={d.dish_id} value={d.dish_id}>
                          {dishOption(d, t)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
              <Button type="button" variant="secondary" className="min-h-11" disabled={!pickDish} onClick={addComponent}>
                {t('recipes.edit.add')}
              </Button>
            </div>
          )}
        </section>

        {/* --- What one sale takes, live --- */}
        <section
          aria-labelledby={`${ids}-total-title`}
          className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
        >
          <h3 id={`${ids}-total-title`} className="text-sm font-semibold text-gray-900">
            {t('recipes.edit.perSale')}
          </h3>
          {perSale.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">{t('recipes.edit.perSaleNothing', { name: dish.name })}</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm tabular-nums text-gray-700">
              {perSale.map((c) => (
                <li key={c.item_id} className="break-words">
                  {amountOf(c.quantity, labels.get(c.item_id), t)}
                </li>
              ))}
            </ul>
          )}
          {/* Emptying a recipe of its own switches the link on: said in
              words, and read out as it happens -- taking the last line out
              is what does it, with the focus elsewhere. */}
          <p
            role="status"
            className={
              emptied?.news
                ? 'mt-2 rounded-lg border border-sky-400/25 bg-sky-400/[0.08] px-2.5 py-1.5 text-xs text-gray-800'
                : 'sr-only'
            }
          >
            {emptied?.news ? t('recipes.edit.relink', { item: emptied.item.name }) : ''}
          </p>
          {anyInvalid && <p className="mt-1 text-xs text-gray-500">{t('recipes.edit.perSalePartial')}</p>}
        </section>
      </form>
    </Modal>
  );
}

/** A line of a recipe: its name, its quantity, its unit, and the cross that takes it out. */
function QuantityLine({
  inputId,
  name,
  photo,
  note,
  unit,
  text,
  hint,
  removeLabel,
  onText,
  onRemove,
}: {
  inputId: string;
  name: string;
  /** An ingredient's photo in the inventory, or an included product's on the menu. */
  photo?: { url: string | null | undefined; alt: string };
  note: string | null;
  unit: string | null;
  text: string;
  hint: { bad: boolean; text: string } | null;
  removeLabel: string;
  onText: (text: string) => void;
  onRemove: () => void;
}) {
  const hintId = `${inputId}-hint`;
  const unitId = `${inputId}-unit`;
  // The field is named by the product; its unit ("kg") is its description,
  // with what is wrong with it or what a fraction came to after it.
  const describedBy = [unit ? unitId : null, hint ? hintId : null].filter(Boolean).join(' ');
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* The photo and the name wrap together, above the quantity on a
            phone; the photo beside the label, not in it, so the field is
            not named after the product twice. */}
        <div className={['flex min-w-0 flex-1 items-center gap-3', photo ? 'basis-44' : 'basis-32'].join(' ')}>
          {photo && <SquarePhoto name={name} url={photo.url} size="row" alt={photo.alt} />}
          <label htmlFor={inputId} className="min-w-0 flex-1 break-words text-sm text-gray-900">
            {name}
            {note && <span className="ml-1 text-xs text-amber-800">({note})</span>}
          </label>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* No numeric keyboard: "3/4" needs the slash. */}
          <input
            id={inputId}
            value={text}
            onChange={(e) => onText(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
            aria-invalid={hint?.bad || undefined}
            aria-describedby={describedBy || undefined}
            className={`${FIELD_SKIN} ${fieldTone(Boolean(hint?.bad))} min-h-11 w-24 rounded-xl px-3 py-2 text-right tabular-nums`}
          />
          <span id={unit ? unitId : undefined} className="w-16 truncate text-xs text-gray-500">
            {unit ?? ''}
          </span>
          <button type="button" className={ICON_BUTTON} aria-label={removeLabel} onClick={onRemove}>
            <CrossIcon />
          </button>
        </div>
      </div>
      {hint && (
        <p id={hintId} className={['mt-1 text-xs', hint.bad ? 'font-medium text-red-300' : 'text-gray-500'].join(' ')}>
          {hint.text}
        </p>
      )}
    </li>
  );
}

// --- Try a sale ------------------------------------------------------------------------

/**
 * Pick one or more products and how many, and see what the sale would take
 * from the stock and how each ingredient would stand after. Nothing is sent.
 */
function SaleTrial({
  sections,
  book,
  labels,
  stock,
}: {
  sections: readonly RecipeSection[];
  book: RecipeBook;
  labels: ReadonlyMap<string, ItemLabel>;
  stock: ReturnType<typeof useInventoryItems>;
}) {
  const t = useT();
  const ids = useId();
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState('');
  const [pickText, setPickText] = useState('1');
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  const names = useMemo(() => {
    const out = new Map<string, string>();
    for (const section of sections) for (const d of section.dishes) out.set(d.dish_id, d.name);
    return out;
  }, [sections]);
  const photos = useMemo(() => photosOf(sections), [sections]);

  const pickQuantity = parseSaleQuantity(pickText);
  const pickBad = pickText.trim() !== '' && pickQuantity === null;

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!pick || pickQuantity === null) return;
    setLines((prev) => {
      const at = prev.findIndex((l) => l.id === pick);
      if (at < 0) return [...prev, { id: pick, text: formatQuantity(pickQuantity) }];
      // The same product again is more of it, not a second line.
      const sum = Math.round(((parseSaleQuantity(prev[at].text) ?? 0) + pickQuantity) * 1000) / 1000;
      return prev.map((l, i) => (i === at ? { ...l, text: formatQuantity(sum) } : l));
    });
    setPick('');
    setPickText('1');
  };

  const read = lines.map((l) => ({ ...l, value: parseSaleQuantity(l.text) }));
  const valid = read.filter((l) => l.value !== null).map((l) => ({ dish_id: l.id, quantity: l.value! }));
  const consumed = expandSale(book, valid);
  // Only the stock as loaded says how it would be left: before it arrives, or
  // if it fails, every ingredient would read as 0 and "go below zero".
  const view = trialView(consumed, {
    data: stock.data
      ? new Map(stock.data.map((i) => [i.id, { now: onHand(i), min_quantity: i.min_quantity }]))
      : undefined,
    isError: stock.isError,
  });
  const rows =
    view.state === 'rows'
      ? [...view.rows].sort((a, b) =>
          (labels.get(a.item_id)?.name ?? '').localeCompare(labels.get(b.item_id)?.name ?? ''),
        )
      : [];
  const low = view.state === 'rows' ? view.low : 0;
  const negative = view.state === 'rows' ? view.negative : 0;
  // What the table says, first, in a sentence: how many would go below the
  // minimum or below zero. Empty until there is a table.
  const summary =
    rows.length > 0
      ? [
          plural(rows.length, 'recipes.try.summary.items.one', 'recipes.try.summary.items.other'),
          low > 0 ? plural(low, 'recipes.try.summary.low.one', 'recipes.try.summary.low.other') : null,
          negative > 0
            ? plural(negative, 'recipes.try.summary.negative.one', 'recipes.try.summary.negative.other')
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : '';
  // Products in the sale that take nothing: no recipe, or one of products without one.
  const takingNothing = read.filter((l) => l.value !== null && expandDish(book, l.id).length === 0);

  return (
    <Card aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="text-lg font-semibold text-gray-900">
        {t('recipes.try.title')}
      </h2>
      <p className="mt-0.5 text-sm text-gray-500">{t('recipes.try.description')}</p>
      {/* What "now" is: the sale is tried as one of today, after the last
          count, so it comes off the figure Stock shows. */}
      <p className="mt-1 text-xs text-gray-500">{t('recipes.try.asToday')}</p>

      <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
        {/* The product picked, by its face: an <option> cannot show a photo. */}
        <SquarePhoto
          name={pick ? (names.get(pick) ?? '') : ''}
          url={pick ? photos.get(pick) : null}
          size="row"
          alt=""
          className="mb-0.5"
        />
        <div className="min-w-0 flex-1 basis-56">
          <Select
            id={`${ids}-pick`}
            label={t('recipes.try.product')}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="w-full"
          >
            <option value="">{t('recipes.try.pick')}</option>
            {sections
              .filter((s) => s.dishes.length > 0)
              .map((s) => (
                <optgroup key={s.id} label={s.name}>
                  {s.dishes.map((d) => (
                    <option key={d.dish_id} value={d.dish_id}>
                      {dishOption(d, t)}
                    </option>
                  ))}
                </optgroup>
              ))}
          </Select>
        </div>
        <div className="w-24">
          <Input
            id={`${ids}-quantity`}
            label={t('recipes.try.quantity')}
            value={pickText}
            onChange={(e) => setPickText(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            maxLength={12}
            // Red, and pointing at the sentence under the row, which is too
            // long for a field this narrow to carry under itself.
            error={pickBad ? ' ' : undefined}
            aria-describedby={pickBad ? `${ids}-quantity-error` : undefined}
            className="min-h-11 text-right tabular-nums"
          />
        </div>
        <Button type="submit" className="min-h-11" disabled={!pick || pickQuantity === null}>
          {t('recipes.try.add')}
        </Button>
      </form>
      {pickBad && (
        <p id={`${ids}-quantity-error`} className="mt-1 text-xs font-medium text-red-300">
          {t('recipes.try.quantityInvalid')}
        </p>
      )}

      {lines.length > 0 && (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">{t('recipes.try.sold')}</h3>
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setLines([]);
                setFocusId(`${ids}-pick`);
              }}
            >
              {t('recipes.try.clear')}
            </Button>
          </div>
          <ul className="divide-y divide-white/[0.06]">
            {read.map((line) => {
              const name = names.get(line.id) ?? t('recipes.unknownDish');
              const bad = line.value === null;
              const inputId = `${ids}-line-${line.id}`;
              return (
                <li key={line.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {/* The photo beside the label, not in it, as in a recipe's lines. */}
                    <div className="flex min-w-0 flex-1 basis-44 items-center gap-3">
                      <SquarePhoto name={name} url={photos.get(line.id)} size="row" alt="" />
                      <label htmlFor={inputId} className="min-w-0 flex-1 break-words text-sm text-gray-900">
                        {name}
                      </label>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <input
                        id={inputId}
                        value={line.text}
                        onChange={(e) =>
                          setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, text: e.target.value } : l)))
                        }
                        inputMode="decimal"
                        autoComplete="off"
                        maxLength={12}
                        aria-invalid={bad || undefined}
                        aria-describedby={bad ? `${inputId}-hint` : undefined}
                        className={`${FIELD_SKIN} ${fieldTone(bad)} min-h-11 w-24 rounded-xl px-3 py-2 text-right tabular-nums`}
                      />
                      <button
                        type="button"
                        className={ICON_BUTTON}
                        aria-label={t('recipes.edit.remove', { name })}
                        onClick={() => {
                          setLines((prev) => prev.filter((l) => l.id !== line.id));
                          setFocusId(`${ids}-pick`);
                        }}
                      >
                        <CrossIcon />
                      </button>
                    </div>
                  </div>
                  {bad && (
                    <p id={`${inputId}-hint`} className="mt-1 text-xs font-medium text-red-300">
                      {t('recipes.try.quantityInvalid')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {takingNothing.length > 0 && (
            <p className="mt-3 text-xs text-gray-500">
              {t(takingNothing.length === 1 ? 'recipes.try.takesNothing.one' : 'recipes.try.takesNothing.other', {
                names: takingNothing.map((l) => names.get(l.id) ?? t('recipes.unknownDish')).join(', '),
              })}
            </p>
          )}
        </>
      )}

      {/* Out of the block above so its sentence is on the page from the
          start: a live region is read out when it changes, and one that
          arrives with its words already in is not, on most screen readers.
          Empty, and with no gap, until there is a table to sum up. */}
      <div className={lines.length > 0 ? 'mt-5' : undefined}>
        {lines.length > 0 && <h3 className="text-sm font-semibold text-gray-900">{t('recipes.try.result')}</h3>}
        <p aria-live="polite" aria-atomic="true" className={summary ? 'mt-1 text-sm text-gray-700' : undefined}>
          {summary}
        </p>
        {lines.length === 0 ? null : view.state === 'loading' ? (
          <Spinner />
        ) : view.state === 'error' ? (
          <div className="mt-2">
            <StateMessage tone="error" title={t('recipes.try.stockError')} description={getErrorMessage(stock.error)} />
          </div>
        ) : view.state === 'nothing' ? (
          <p className="mt-1 text-sm text-gray-500">{t('recipes.try.nothing')}</p>
        ) : (
          <div className="mt-2">
            <Table>
              <THead>
                <TR>
                  <TH>{t('recipes.try.col.item')}</TH>
                  <TH>{t('recipes.try.col.take')}</TH>
                  <TH>{t('recipes.try.col.now')}</TH>
                  <TH>{t('recipes.try.col.after')}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => {
                  const label = labels.get(row.item_id);
                  return (
                    <TR key={row.item_id}>
                      {/* How it would stand is said here, in the first
                          column, in words: on a phone the table scrolls and
                          "Would be left" starts off the screen. */}
                      <TD className="min-w-[11rem] font-medium text-gray-900">
                        <div className="flex items-start gap-3">
                          <SquarePhoto
                            name={label?.name ?? ''}
                            url={label?.photo_url}
                            size="row"
                            alt=""
                          />
                          <div className="min-w-0">
                            {label?.name ?? t('recipes.unknownItem')}
                            {label?.archived && (
                              <span className="ml-1 text-xs font-normal text-gray-500">({t('recipes.archived')})</span>
                            )}
                            {row.status === 'negative' && (
                              <span className="mt-1 block">
                                <Badge tone="red">{t('recipes.try.status.negative')}</Badge>
                              </span>
                            )}
                            {row.status === 'low' && (
                              <span className="mt-1 block">
                                <Badge tone="amber">
                                  {t('recipes.try.status.low', { min: withUnit(row.min_quantity ?? 0, label?.unit) })}
                                </Badge>
                              </span>
                            )}
                          </div>
                        </div>
                      </TD>
                      <TD className="whitespace-nowrap tabular-nums">− {withUnit(row.take, label?.unit)}</TD>
                      <TD className="whitespace-nowrap tabular-nums">{withUnit(row.now, label?.unit)}</TD>
                      <TD className="whitespace-nowrap tabular-nums">
                        <span
                          className={[
                            'font-medium',
                            row.status === 'negative'
                              ? 'text-red-700'
                              : row.status === 'low'
                                ? 'text-amber-800'
                                : 'text-gray-900',
                          ].join(' ')}
                        >
                          {withUnit(row.after, label?.unit)}
                        </span>
                        {/* The colour's words are in the first column. */}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            {negative > 0 && <p className="mt-2 text-xs text-gray-500">{t('recipes.try.negativeHelp')}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}
