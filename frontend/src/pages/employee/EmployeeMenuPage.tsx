// The menu, for the team: read only, on a phone, often mid-service.
//
// Two questions get asked of it at the table: "do you have the croquetas?"
// -- the search, by name or description, accents optional -- and "what is
// there without gluten?" -- the "Without …" filter, which hides every dish
// carrying any allergen ticked. Sold-out dishes stay on the list, dimmed and
// labelled, so the waiter knows not to offer them rather than wondering
// where they went.
//
// The filter is only as good as what the manager marked, and a dish with
// nothing marked is not the same as a dish with nothing in it; the screen
// says so whenever the filter is on.
//
// Laid out as the till lays out its products, so the menu looks the same on
// the phone as behind the counter: one grid of the till's tiles, A to Z with
// no headings between them (lib/menu/till.ts), the photo to the edges with
// the name and the price over it, and the description and the allergens
// under each (components/menu/MenuDishCard.tsx). A row of section chips over
// the grid narrows it to one section; "All" is chosen until another is. Two
// across on a phone, three where there is room; close together side by side,
// as on the till, and further apart down, where the allergens are.

import { useId, useMemo, useState, type CSSProperties } from 'react';
import { Button } from '../../components/Button';
import { FIELD_SKIN, fieldTone } from '../../components/Input';
import { Spinner, StateMessage } from '../../components/StateMessage';
import { MenuDishCard } from '../../components/menu/MenuDishCard';
import { SectionTabs, sectionTabId } from '../../components/menu/SectionTabs';
import { getErrorMessage } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { APP_LOCALE } from '../../lib/locale';
import { useMenu } from '../../lib/menu/api';
import { ALLERGENS, allergenLabel } from '../../lib/menu/allergens';
import { countDishes } from '../../lib/menu/filter';
import { activeSection, dishesIn, sectionChips, tillDishes } from '../../lib/menu/till';

const NO_ALLERGENS: ReadonlySet<string> = new Set();

export function EmployeeMenuPage() {
  const t = useT();
  const menu = useMenu({ live: true });
  const [query, setQuery] = useState('');
  const [without, setWithout] = useState<ReadonlySet<string>>(NO_ALLERGENS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const panelId = useId();
  const tabsId = useId();
  const gridId = useId();

  const sections = useMemo(() => menu.data?.sections ?? [], [menu.data]);
  const chips = useMemo(() => sectionChips(sections), [sections]);
  const section = activeSection(chips, chosen);
  const total = countDishes(sections);
  const inSection = dishesIn(sections, section).length;
  // Read while rendering: it follows the chosen language (lib/locale.ts), and
  // so does the order.
  const locale = APP_LOCALE;
  const shown = useMemo(
    () => tillDishes(sections, { section, query, without }, locale),
    [sections, section, query, without, locale],
  );
  const filtering = query.trim() !== '' || without.size > 0;

  const toggle = (code: string) =>
    setWithout((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  const clear = () => {
    setQuery('');
    setWithout(NO_ALLERGENS);
  };

  const heading = (
    <div className="sc-rise">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">{t('menu.read.title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('menu.read.description')}</p>
    </div>
  );

  if (menu.isLoading) return <Spinner />;
  // Only with nothing to show: a refetch that fails keeps the menu on screen.
  if (menu.isError && !menu.data) {
    return (
      <div className="space-y-5">
        {heading}
        <StateMessage tone="error" title={t('menu.read.loadError')} description={getErrorMessage(menu.error)} />
      </div>
    );
  }
  if (total === 0) {
    return (
      <div className="space-y-5">
        {heading}
        <div className="sc-glass sc-rise rounded-3xl p-2" style={{ '--i': 1 } as CSSProperties}>
          <StateMessage title={t('menu.read.empty.title')} description={t('menu.read.empty.description')} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {heading}

      <div className="sc-glass sc-rise space-y-3 rounded-3xl p-4" style={{ '--i': 1 } as CSSProperties}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('menu.read.search')}
          aria-label={t('menu.read.search')}
          enterKeyHint="search"
          autoComplete="off"
          // 16 px: a smaller field makes iOS zoom the page in on focus.
          className={`${FIELD_SKIN} ${fieldTone(false)} min-h-11 w-full rounded-xl px-3.5 py-2 text-base`}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls={panelId}
            onClick={() => setFiltersOpen((o) => !o)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3.5 text-sm font-medium text-gray-800 transition-colors hover:border-white/25 hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 motion-reduce:transition-none"
          >
            {t('menu.read.filter.button')}
            {without.size > 0 && (
              <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
                <span aria-hidden="true">{without.size}</span>
                <span className="sr-only">{t('menu.read.filter.selected', { count: without.size })}</span>
              </span>
            )}
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={['h-4 w-4 transition-transform duration-200 motion-reduce:transition-none', filtersOpen ? 'rotate-180' : ''].join(' ')}
            >
              <path d="M5 8l5 5 5-5" />
            </svg>
          </button>
          <p aria-live="polite" aria-atomic="true" className="text-sm tabular-nums text-gray-500">
            {filtering
              ? t('menu.read.countFiltered', { shown: shown.length, total: inSection })
              : t(inSection === 1 ? 'menu.read.count.one' : 'menu.read.count.other', { count: inSection })}
          </p>
        </div>

        <fieldset id={panelId} hidden={!filtersOpen}>
          <legend className="mb-2 text-sm font-medium text-gray-700">{t('menu.read.filter.legend')}</legend>
          <div className="flex flex-wrap gap-2">
            {ALLERGENS.map((code) => {
              const on = without.has(code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(code)}
                  className={[
                    'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 motion-reduce:transition-none',
                    // Chosen is told by the tick and the weight too, not
                    // by the colour alone.
                    on
                      ? 'border-brand-400 bg-brand-100 font-semibold text-brand-900'
                      : 'border-white/15 bg-white/[0.03] font-medium text-gray-700 hover:border-white/25 hover:bg-white/[0.07]',
                  ].join(' ')}
                >
                  {on && (
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4 shrink-0">
                      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
                    </svg>
                  )}
                  {t('menu.read.filter.without', { allergen: allergenLabel(code).toLocaleLowerCase(APP_LOCALE) })}
                </button>
              );
            })}
          </div>
        </fieldset>

        {without.size > 0 && (
          <p className="rounded-xl border border-amber-200/60 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t('menu.read.filter.note')}
          </p>
        )}
        {filtering && (
          <Button variant="ghost" className="min-h-11" onClick={clear}>
            {t('menu.read.filter.clear')}
          </Button>
        )}
      </div>

      <div className="sc-glass sc-rise space-y-4 rounded-3xl p-3 sm:p-4" style={{ '--i': 2 } as CSSProperties}>
        {/* One section alone has nothing to choose between. */}
        {chips.length > 1 && (
          <SectionTabs chips={chips} value={section} onChange={setChosen} idBase={tabsId} panelId={gridId} />
        )}
        <div
          id={gridId}
          // Focusable as a tab panel: the cards hold nothing to tab to, and
          // without it Tab from a chip fell out to the page.
          {...(chips.length > 1
            ? { role: 'tabpanel', 'aria-labelledby': sectionTabId(tabsId, section), tabIndex: 0 }
            : {})}
        >
          {shown.length === 0 ? (
            <div className="p-3 text-center">
              <p className="text-sm font-medium text-gray-800">{t('menu.read.noMatch')}</p>
              <Button variant="secondary" className="mt-3 min-h-11" onClick={clear}>
                {t('menu.read.filter.clear')}
              </Button>
            </div>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,9.5rem),1fr))] gap-x-1.5 gap-y-4 sm:gap-y-5">
              {shown.map((dish) => (
                <li key={dish.id} className="min-w-0">
                  <MenuDishCard dish={dish} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
