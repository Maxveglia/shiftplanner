// One series of takings as columns: a day each, or a weekday each.
//
// Drawn as the back office's monthly bars are (components/backoffice/
// MonthlyBars.tsx), so the product's charts read as one family: flex children
// rather than SVG, a 2 px gap of surface between neighbours, columns capped
// at 24 px with a 4 px rounded top and a square foot on one hairline
// baseline. No y-axis and no gridlines: the tallest column carries its value,
// which states the scale, and every other value is a hover, a tap or an
// arrow key away -- and in the table beside it (ChartFrame).
//
// Reading it:
// - the pointer: the whole column under it is the target, gap included, not
//   the painted pixels -- a 3 px bar is not something to aim at;
// - a tap on a phone reads the column tapped, and stays until the next;
// - the keyboard: the chart is ONE tab stop; the arrows walk the columns, Page
//   Up / Page Down a week, Home / End the ends (lib/store/chart.ts). What is
//   read is shown in the tooltip and said aloud in a polite live region.
//
// Too many days for the width (a quarter on a phone) and the chart scrolls
// inside its own box -- never the page -- opened on the newest day.

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { edgeAlign, peakIndex, stepIndex } from '../../lib/store/chart';

export interface Column {
  key: string;
  value: number;
  /** Under the axis, or null for none (the axis labels some columns only). */
  tick: string | null;
  /** The column in words, for its tooltip and for a screen reader: "Sat, Sep 26". */
  label: string;
}

interface ColumnChartProps {
  columns: Column[];
  color: string;
  /** The value to the cent, for the tooltip and the live region. */
  format: (value: number) => string;
  /** The value short, for the label on the tallest column. */
  formatShort: (value: number) => string;
  /** What the chart is and how to read it with keys. */
  ariaLabel: string;
  /** The narrowest a column may get before the chart scrolls instead. */
  minColumnPx?: number;
}

const ALIGN = {
  start: 'translateX(0)',
  center: 'translateX(-50%)',
  end: 'translateX(-100%)',
} as const;

const EDGE = '24px';

/** A mask that fades out whichever sides of the scroll box have more beyond them. */
function fade(before: boolean, after: boolean): CSSProperties | undefined {
  if (!before && !after) return undefined;
  const mask = `linear-gradient(to right, ${before ? 'transparent' : '#000'} 0, #000 ${EDGE}, #000 calc(100% - ${EDGE}), ${after ? 'transparent' : '#000'} 100%)`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

export function ColumnChart({ columns, color, format, formatShort, ariaLabel, minColumnPx = 5 }: ColumnChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const count = columns.length;
  const max = Math.max(0, ...columns.map((c) => c.value));
  const peak = peakIndex(columns.map((c) => c.value));
  const shown = active !== null && active < count ? active : null;

  // Which sides have more chart beyond them, for the fade that says so: a
  // bar or a label cut by the edge of the box reads as broken, one fading
  // out reads as "there is more this way".
  const [more, setMore] = useState({ before: false, after: false });
  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    const before = el.scrollLeft > 1;
    const after = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore((m) => (m.before === before && m.after === after ? m : { before, after }));
  };

  // Opened on the present: a scrolled chart starts at its right-hand end.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
    measure();
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps

  // A phone turned on its side can make a scrolled chart fit, or not.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => measure());
    watch.observe(el);
    return () => watch.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const indexAt = (clientX: number): number | null => {
    const el = plot.current;
    if (!el || count === 0) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const i = Math.floor(((clientX - rect.left) / rect.width) * count);
    return Math.min(count - 1, Math.max(0, i));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    // A finger moving is a scroll of the page or of the chart, not a reading.
    if (e.pointerType === 'mouse') setActive(indexAt(e.clientX));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') setActive(indexAt(e.clientX));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = stepIndex(shown, e.key, count);
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    // Keep what is read in view when the chart scrolls.
    const el = scroller.current;
    const slot = plot.current?.children[next] as HTMLElement | undefined;
    if (el && slot && el.scrollWidth > el.clientWidth) {
      const left = slot.offsetLeft;
      if (left < el.scrollLeft || left + slot.offsetWidth > el.scrollLeft + el.clientWidth) {
        el.scrollLeft = left - el.clientWidth / 2;
      }
    }
  };

  const pct = (value: number) => (max > 0 ? (value / max) * 100 : 0);
  // A label sits centred on its column while the columns are wide enough to
  // hold one (a week); on a crowded axis the ones at the ends hang inward
  // instead, so they never run off the chart.
  const labelAlign = (i: number) => (count > 10 ? edgeAlign(i, count) : 'center');
  const at = (i: number) => `${((i + 0.5) / Math.max(1, count)) * 100}%`;

  return (
    <div>
      <div
        ref={scroller}
        onScroll={measure}
        className="overflow-x-auto overscroll-x-contain"
        style={fade(more.before, more.after)}
      >
        <div style={{ minWidth: count * minColumnPx }}>
          {/* Top padding: room for the peak's label, and for the tooltip. */}
          <div className="relative pt-12">
            {shown !== null && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-lg border border-white/10 bg-gray-200 px-2 py-1 shadow-lg"
                style={{ left: at(shown), transform: ALIGN[edgeAlign(shown, count)] }}
              >
                {/* The value leads; what it is the value of follows. */}
                <p className="text-xs font-semibold tabular-nums text-gray-900">{format(columns[shown].value)}</p>
                <p className="text-[11px] text-gray-500">{columns[shown].label}</p>
              </div>
            )}

            <div
              ref={plot}
              role="group"
              tabIndex={0}
              aria-label={ariaLabel}
              onPointerMove={onPointerMove}
              onPointerDown={onPointerDown}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse') setActive(null);
              }}
              onKeyDown={onKeyDown}
              onBlur={() => setActive(null)}
              // An inset ring, not an outline: the scroll box around the chart
              // would cut an outline's sides off.
              className="flex h-32 items-end gap-[2px] rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-300"
            >
              {columns.map((column, i) => {
                const height = pct(column.value);
                return (
                  <div
                    key={column.key}
                    className={[
                      'relative flex h-full flex-1 items-end justify-center rounded-t-[4px]',
                      // The column being read is lit behind, a hairline band
                      // the full height: the eye finds the day even at 0.
                      i === shown ? 'bg-white/[0.06]' : '',
                    ].join(' ')}
                  >
                    {column.value > 0 && (
                      <div
                        className="w-full max-w-[24px] rounded-t-[4px] transition-[filter] duration-150 motion-reduce:transition-none"
                        style={{
                          height: `${height}%`,
                          backgroundColor: color,
                          filter: i === shown ? 'brightness(1.25)' : undefined,
                        }}
                      />
                    )}
                    {i === peak && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute whitespace-nowrap text-[10px] font-semibold tabular-nums text-gray-700"
                        style={{
                          bottom: `calc(${height}% + 2px)`,
                          ...(labelAlign(i) === 'start'
                            ? { left: 0 }
                            : labelAlign(i) === 'end'
                              ? { right: 0 }
                              : { left: '50%', transform: 'translateX(-50%)' }),
                        }}
                      >
                        {formatShort(column.value)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="h-px w-full bg-white/15" aria-hidden="true" />

            <div className="relative mt-1 h-4" aria-hidden="true">
              {columns.map((column, i) =>
                column.tick ? (
                  <span
                    key={column.key}
                    className="absolute top-0 whitespace-nowrap text-[10px] tabular-nums text-gray-500"
                    style={{ left: at(i), transform: ALIGN[labelAlign(i)] }}
                  >
                    {column.tick}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Always on the page, so what is put in it is announced. */}
      <p aria-live="polite" className="sr-only">
        {shown !== null ? `${columns[shown].label}: ${format(columns[shown].value)}` : ''}
      </p>
    </div>
  );
}
