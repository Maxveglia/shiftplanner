import {
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type TdHTMLAttributes,
} from 'react';
import { arrivalWindow, rowDelays } from '../lib/motion/componentsMotion';
import { useReducedMotion } from '../lib/motion/useReducedMotion';

// On the glass the table is drawn in light, not in fills: a faint band for the
// header, hairlines between rows, and no background of its own, so the card
// it sits in (and the stage through the card) is its ground.
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl">
      <table className="min-w-full divide-y divide-white/[0.08] text-sm">
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-white/[0.03]">{children}</thead>;
}

/** One row's entrance; `.m-rows > tr` in motion-components.css lasts this. */
const ROW_IN_MS = 380;

/**
 * The rows arrive one after another the first time there are any -- which is
 * when the data comes in, not when the empty table mounts -- and then never
 * again. After the arrival the class comes off, so a row that is added,
 * sorted into a new place or dragged (the Employees page moves its rows with
 * a transform) just sits where it belongs instead of arriving a second time.
 * The waits are capped (rowDelays), so the fortieth person does not queue.
 */
export function TBody({ children }: { children: ReactNode }) {
  const body = useRef<HTMLTableSectionElement>(null);
  const reduced = useReducedMotion();
  const started = useRef(false);
  const [arrived, setArrived] = useState(false);

  useLayoutEffect(() => {
    if (started.current || arrived) return;
    const el = body.current;
    if (!el || el.rows.length === 0) return;
    started.current = true;
    if (reduced) {
      setArrived(true);
      return;
    }
    // Before paint, so no row shows a frame without its wait.
    const rows = Array.from(el.rows);
    const delays = rowDelays(rows.map((r) => r.getBoundingClientRect().height));
    rows.forEach((r, i) => r.style.setProperty('--d', `${delays[i]}ms`));
    // Not cleared on unmount: StrictMode unmounts and remounts once in
    // development and would cancel it for good; a late setState on an
    // unmounted component is a no-op.
    window.setTimeout(() => setArrived(true), arrivalWindow(delays, ROW_IN_MS));
  });

  return (
    <tbody
      ref={body}
      className={['divide-y divide-white/[0.06]', arrived ? '' : 'm-rows'].join(' ')}
    >
      {children}
    </tbody>
  );
}

// TR and TD pass the rest of their props through to the element. The Employees
// page needs pointer handlers and a transform on a row, and a cell that spans
// the table, and neither is worth a second set of table primitives — but the
// styling still has to come from one place, or the drawer row would drift out
// of step with the rows it sits under.
interface TRProps extends HTMLAttributes<HTMLTableRowElement> {
  children: ReactNode;
}

export function TR({ children, onClick, className = '', ...rest }: TRProps) {
  return (
    <tr
      onClick={onClick}
      className={[
        onClick
          ? 'cursor-pointer transition-colors duration-150 hover:bg-white/[0.035] motion-reduce:transition-none'
          : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function TH({ children }: { children: ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
      {children}
    </th>
  );
}

interface TDProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode;
}

export function TD({ children, className = '', ...rest }: TDProps) {
  return (
    <td className={['px-4 py-3 text-gray-700', className].join(' ')} {...rest}>
      {children}
    </td>
  );
}
