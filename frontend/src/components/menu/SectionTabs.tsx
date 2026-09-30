// The row of section chips over the till's grid: "All" first, then each
// section in the manager's order. Choosing one narrows the grid to its
// dishes (lib/menu/till.ts); "All" is the whole menu, A to Z.
//
// A tablist, in the WAI-ARIA sense and not only in looks, as ViewTabs is: the
// chips swap what the grid under them shows, so the row says what it is, the
// chosen chip says so (`aria-selected`) and names the grid, only the chosen
// one is a Tab stop, and ←/→, Home and End move along the row
// (`nextTabIndex`, tested with the calendar's tabs). Selection follows focus:
// the grid is already on the page, and showing another costs nothing.
//
// The chosen chip is told by its weight and a tick as well as by its fill.
// The chips wrap onto a second line rather than scroll sideways: a section
// out of sight is a section nobody picks.

import { useRef, type KeyboardEvent } from 'react';
import { useT } from '../../lib/i18n';
import type { SectionChip } from '../../lib/menu/till';
import { nextTabIndex } from '../schedule/calendarMotion';

/** The id of a chip's tab, so the grid can be labelled by the chosen one. */
export const sectionTabId = (base: string, section: string | null) => `${base}-tab-${section ?? 'all'}`;

export function SectionTabs({
  chips,
  value,
  onChange,
  idBase,
  panelId,
  size = 'md',
}: {
  chips: readonly SectionChip[];
  /** The chosen section, or null for "All". */
  value: string | null;
  onChange: (section: string | null) => void;
  /** Prefix for the tabs' ids (see sectionTabId). */
  idBase: string;
  /** The grid the chips narrow. */
  panelId: string;
  /** `sm` inside "New sale", where the dialog has less room to spare. */
  size?: 'md' | 'sm';
}) {
  const t = useT();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs: { id: string | null; name: string }[] = [{ id: null, name: t('menu.till.all') }, ...chips];
  const active = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === value),
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const focused = buttons.current.findIndex((b) => b === document.activeElement);
    const next = nextTabIndex(focused >= 0 ? focused : active, e.key, tabs.length);
    if (next === null) return;
    e.preventDefault();
    buttons.current[next]?.focus();
    if (tabs[next].id !== value) onChange(tabs[next].id);
  };

  return (
    <div role="tablist" aria-label={t('menu.till.sections')} onKeyDown={onKeyDown} className="flex min-w-0 flex-wrap gap-1.5">
      {tabs.map((tab, i) => {
        const selected = i === active;
        return (
          <button
            key={tab.id ?? ''}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            id={sectionTabId(idBase, tab.id)}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) onChange(tab.id);
            }}
            className={[
              'inline-flex max-w-full items-center gap-1.5 rounded-full border text-sm transition-colors [overflow-wrap:anywhere]',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 motion-reduce:transition-none',
              size === 'sm' ? 'min-h-9 px-3' : 'min-h-11 px-3.5',
              selected
                ? 'border-brand-400 bg-brand-600 font-semibold text-white'
                : 'border-white/15 bg-white/[0.03] font-medium text-gray-700 hover:border-white/25 hover:bg-white/[0.07] hover:text-gray-900',
            ].join(' ')}
          >
            {selected && (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4 shrink-0">
                <path d="M4.5 10.5l3.5 3.5 7.5-8" />
              </svg>
            )}
            <span className="min-w-0">{tab.name}</span>
          </button>
        );
      })}
    </div>
  );
}
