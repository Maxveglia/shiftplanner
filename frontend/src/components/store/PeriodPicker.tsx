// 7 / 30 / 90 days: the window the sales list and the statistics look at.
//
// Three radio buttons dressed as one segmented control, so the browser gives
// it the keyboard of a radio group for free (Tab lands on the chosen one, the
// arrows move the choice) and a screen reader hears "30 days, selected, 2 of
// 3". The chosen one is told by its weight and its raised, ringed face as
// well as its colour.
//
// The choice lives in the address (?days=7), so going into a sale and back,
// or reloading, keeps it; the default (30) leaves the address clean.

import { useId } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../lib/i18n';
import { DEFAULT_PERIOD, PERIODS, readPeriod, type PeriodDays } from '../../lib/store/period';

// eslint-disable-next-line react-refresh/only-export-components
export function usePeriod(): [PeriodDays, (days: PeriodDays) => void] {
  const [params, setParams] = useSearchParams();
  const days = readPeriod(params.get('days'));
  const set = (next: PeriodDays) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === DEFAULT_PERIOD) out.delete('days');
        else out.set('days', String(next));
        return out;
      },
      // Not a step of its own in the history: Back leaves the page, as the
      // manager expects, rather than walking back through 7, 30, 90.
      { replace: true },
    );
  return [days, set];
}

export function PeriodPicker({ value, onChange }: { value: PeriodDays; onChange: (days: PeriodDays) => void }) {
  const t = useT();
  const name = useId();
  return (
    <fieldset>
      <legend className="sr-only">{t('store.period.legend')}</legend>
      <div className="inline-flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {PERIODS.map((days) => (
          <label key={days} className="relative">
            <input
              type="radio"
              name={name}
              value={days}
              checked={value === days}
              onChange={() => onChange(days)}
              className="peer sr-only"
            />
            <span
              className={[
                'flex min-h-10 cursor-pointer items-center rounded-lg px-3.5 text-sm transition-colors motion-reduce:transition-none',
                'text-gray-500 hover:bg-white/[0.05] hover:text-gray-900',
                'peer-checked:bg-white/[0.09] peer-checked:font-semibold peer-checked:text-gray-900 peer-checked:ring-1 peer-checked:ring-inset peer-checked:ring-white/20',
                'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-300',
              ].join(' ')}
            >
              {t('store.period.days', { count: days })}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
