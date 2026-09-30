// Calendar / Hours & pay / Working year: three views of the same period.
//
// A tablist, in the WAI-ARIA sense and not only in looks: it used to be three
// buttons whose state lived in a background colour, so a screen reader heard
// three buttons and no answer to "which one am I on". Now the list says what
// it is, the chosen tab says so (`aria-selected`) and names its panel, only
// the chosen tab is a Tab stop, and the arrow keys move along the row. The
// arithmetic of the arrows is `nextTabIndex`, tested next door.
//
// The chosen tab is marked by a pill that GLIDES to it instead of a colour
// that jumps, measured off the real buttons (indicatorBox), so it fits
// whatever each language makes the labels. It is also marked by weight, which
// a pill without colour would not be.

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { indicatorBox } from '../../lib/motion/kit';
import { nextTabIndex } from './calendarMotion';

export interface ViewTab<V extends string> {
  value: V;
  label: string;
}

/** The ids a tab and its panel share, so the page can label its panels. */
export const tabIdFor = (base: string, value: string) => `${base}-tab-${value}`;
export const panelIdFor = (base: string, value: string) => `${base}-panel-${value}`;

interface ViewTabsProps<V extends string> {
  /** What the row of tabs is, for a screen reader: "View". */
  label: string;
  tabs: ViewTab<V>[];
  value: V;
  onChange: (next: V) => void;
  /** Prefix for the tab and panel ids (see tabIdFor / panelIdFor). */
  idBase: string;
}

interface Pill {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function ViewTabs<V extends string>({
  label,
  tabs,
  value,
  onChange,
  idBase,
}: ViewTabsProps<V>) {
  const list = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<Pill | null>(null);
  // The first placement is not a movement: the pill is simply there. Only a
  // change of tab after that glides.
  const [placed, setPlaced] = useState(false);
  const active = Math.max(
    0,
    tabs.findIndex((tab) => tab.value === value),
  );
  const labels = tabs.map((tab) => tab.label).join('|');

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => {
      const btn = buttons.current[active];
      if (!btn) return;
      const box = el.getBoundingClientRect();
      // Positioned inside the border, so measured from inside it too.
      const next = indicatorBox(btn.getBoundingClientRect(), {
        left: box.left + el.clientLeft,
        top: box.top + el.clientTop,
      });
      setPill((prev) =>
        prev &&
        prev.x === next.x &&
        prev.y === next.y &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next,
      );
    };
    measure();
    // A font arriving late or a language switch changes the labels' widths.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [active, labels]);

  useLayoutEffect(() => {
    if (pill && !placed) {
      // After the first placement has been painted, so that one never glides.
      const id = window.requestAnimationFrame(() => setPlaced(true));
      return () => window.cancelAnimationFrame(id);
    }
  }, [pill, placed]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const focused = buttons.current.findIndex((b) => b === document.activeElement);
    const next = nextTabIndex(focused >= 0 ? focused : active, e.key, tabs.length);
    if (next === null) return;
    // Taken, so the day view's own arrow keys (a day back, a day on) do not
    // fire as well: it listens on the window and skips a handled key.
    e.preventDefault();
    buttons.current[next]?.focus();
    // Selection follows focus: the panels are already on the page, so
    // showing one costs nothing and saves a second key.
    if (tabs[next].value !== value) onChange(tabs[next].value);
  };

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="relative inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5"
    >
      <span
        aria-hidden="true"
        className="cal-tab-pill pointer-events-none absolute left-0 top-0 rounded-md bg-brand-600 shadow-[0_6px_18px_-8px_rgb(68_214_180/0.6),inset_0_1px_0_rgb(255_255_255/0.12)]"
        data-still={placed ? undefined : ''}
        style={
          pill
            ? {
                width: pill.width,
                height: pill.height,
                transform: `translate(${pill.x}px, ${pill.y}px)`,
              }
            : { opacity: 0 }
        }
      />
      {tabs.map((tab, i) => {
        const selected = i === active;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabIdFor(idBase, tab.value)}
            aria-selected={selected}
            aria-controls={panelIdFor(idBase, tab.value)}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) onChange(tab.value);
            }}
            className={[
              'relative z-10 rounded-md px-3 py-1 text-sm transition-colors duration-200',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
              'motion-reduce:transition-none',
              selected
                ? 'font-semibold text-white'
                : 'font-medium text-gray-600 hover:bg-white/[0.05] hover:text-gray-900',
            ].join(' ')}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
