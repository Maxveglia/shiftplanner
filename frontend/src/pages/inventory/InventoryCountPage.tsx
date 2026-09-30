import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceApps } from '../../auth/useWorkspaceApps';
import { useCan } from '../../auth/useCan';
import {
  formatQuantity,
  onHand,
  parseQuantity,
  useCreateInventoryCount,
  useInventoryItems,
  type InventoryItem,
} from '../../api/inventory';
import { getErrorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useT, type TFunction } from '../../lib/i18n';
import {
  COUNT_MOMENTS,
  countStamp,
  defaultCountMoment,
  instantOfLocalInput,
  localInputOf,
  momentDay,
  msToNextMinute,
  type CountMoment,
} from '../../lib/inventory/countMoment';
import { PageHeader } from '../DashboardLayout';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FIELD_SKIN, fieldTone, Input } from '../../components/Input';
import { SquarePhoto } from '../../components/photo/SquarePhoto';
import { Spinner, StateMessage } from '../../components/StateMessage';
import { groupByCategory } from './InventoryStockPage';

/**
 * The hint beside a product while counting: what the last count found, or --
 * once a delivery came in or a sale took some after it, or when those are all
 * there is -- what should be there now, which is the number the count is
 * checked against.
 */
function countHint(item: InventoryItem, t: TFunction): string | null {
  const received = item.received_since_count ?? 0;
  const sold = item.sold_since_count ?? 0;
  if (received > 0 || sold > 0) {
    return t('inventory.count.expected', { quantity: formatQuantity(onHand(item)) });
  }
  if (item.last_quantity !== null) {
    return t('inventory.count.last', { quantity: formatQuantity(item.last_quantity) });
  }
  return null;
}

/** Now, as a datetime-local input wants it: local time, no seconds. */
function nowLocalInput(): string {
  return localInputOf(new Date());
}

export function InventoryCountPage() {
  const t = useT();
  const navigate = useNavigate();
  const items = useInventoryItems();
  const save = useCreateInventoryCount();
  const [countedAt, setCountedAt] = useState(nowLocalInput);
  // Untouched, the count is dated when it is saved, to the second (see
  // `countStamp`), and until then the field keeps showing now: it moves on
  // with every minute, and at once when the page comes back from the
  // background -- a phone locked halfway round the shop has slept through its
  // timers. What it shows, and the moment and the day worked out from it, is
  // what is saved; the page opened at 11:58 and saved at 12:03 is a count at
  // 12:03.
  const [countedAtTouched, setCountedAtTouched] = useState(false);
  useEffect(() => {
    if (countedAtTouched) return;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(refresh, msToNextMinute(new Date()));
    };
    const refresh = () => {
      window.clearTimeout(timer);
      setCountedAt(nowLocalInput());
      schedule();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [countedAtTouched]);
  const [note, setNote] = useState('');
  // Before opening or after closing: which of the day's sales the count
  // already reflects. Until the manager picks one it follows the hour of
  // "Counted on" in the shop (Madrid's, as the server reads it: see
  // lib/inventory/countMoment.ts), and it is only asked where there are sales
  // to speak of.
  const sells = useWorkspaceApps().includes('store');
  // "Add products on Stock" is advice only whoever may add them can follow.
  const canProducts = useCan()('inventory.products');
  const [pickedMoment, setPickedMoment] = useState<CountMoment | null>(null);
  const shownInstant = instantOfLocalInput(countedAt);
  const moment = pickedMoment ?? defaultCountMoment(shownInstant ?? new Date());
  const [query, setQuery] = useState('');
  // What was typed, per product, exactly as typed ("12,5" included).
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [triedToSave, setTriedToSave] = useState(false);

  const all = items.data ?? [];
  const filled = Object.entries(typed).filter(([, v]) => v.trim() !== '');
  const invalid = new Set(filled.filter(([, v]) => parseQuantity(v) === null).map(([id]) => id));
  const dirty = filled.length > 0 && !save.isSuccess;

  // A closed tab or a reload with quantities written down would lose a walk
  // round the whole shop.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return all;
    return all.filter(
      (i) =>
        i.name.toLocaleLowerCase().includes(needle) ||
        (i.category ?? '').toLocaleLowerCase().includes(needle),
    );
  }, [all, query]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTriedToSave(true);
    if (filled.length === 0 || invalid.size > 0) return;
    const stamp = countStamp({ field: countedAt, touched: countedAtTouched, picked: pickedMoment, now: new Date() });
    // Emptied by hand: the field is required, and the browser says so first.
    if (stamp === null) return;
    if (!countedAtTouched) setCountedAt(localInputOf(stamp.at));
    save.mutate(
      {
        counted_at: stamp.at.toISOString(),
        note: note.trim() || null,
        ...(sells ? { after_close: stamp.moment === 'after_close' } : {}),
        lines: filled.map(([item_id, v]) => ({ item_id, quantity: parseQuantity(v)! })),
      },
      {
        onSuccess: () => {
          navigate('/inventory');
          window.scrollTo(0, 0);
        },
      },
    );
  };

  const onCancel = () => {
    if (dirty && !window.confirm(t('inventory.count.leave'))) return;
    navigate('/inventory');
  };

  if (items.isLoading) return <Spinner />;
  if (items.isError) {
    return (
      <StateMessage
        tone="error"
        title={t('inventory.stock.loadError')}
        description={getErrorMessage(items.error)}
      />
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <PageHeader title={t('inventory.count.title')} description={t('inventory.count.description')} />

      {all.length === 0 ? (
        <StateMessage title={t(canProducts ? 'inventory.count.noProducts' : 'inventory.count.noProductsReadOnly')} />
      ) : (
        <>
          <Card className="mb-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                type="datetime-local"
                label={t('inventory.count.when')}
                name="counted-at"
                value={countedAt}
                onChange={(e) => {
                  setCountedAt(e.target.value);
                  setCountedAtTouched(true);
                }}
                required
              />
              <Input
                label={t('inventory.count.note')}
                name="count-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('inventory.count.notePlaceholder')}
                maxLength={2000}
              />
            </div>
            {sells && (
              <CountMomentPicker
                value={moment}
                day={shownInstant ? momentDay(shownInstant, moment) : null}
                onChange={setPickedMoment}
              />
            )}
          </Card>

          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('inventory.count.search')}
                aria-label={t('inventory.count.search')}
                className={`w-full max-w-xs rounded-xl px-3.5 py-2 ${FIELD_SKIN} ${fieldTone(false)}`}
              />
              <p className="text-sm tabular-nums text-gray-500">
                {t('inventory.count.progress', { done: filled.length, total: all.length })}
              </p>
            </div>

            <div className="space-y-5">
              {groupByCategory(shown).map(([category, rows]) => (
                <section key={category ?? ''}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {category ?? t('inventory.stock.uncategorised')}
                  </h3>
                  <ul className="divide-y divide-white/[0.06]">
                    {rows.map((item) => {
                      const bad = invalid.has(item.id);
                      const hint = countHint(item, t);
                      return (
                        <li key={item.id} className="flex items-center gap-3 py-2">
                          {/* Beside the label, not in it: inside, its alt
                              would become part of the field's name, and the
                              field would be read as the product twice. */}
                          <SquarePhoto
                            name={item.name}
                            url={item.photo_url}
                            size="row"
                            alt=""
                          />
                          <label htmlFor={`qty-${item.id}`} className="min-w-0 flex-1">
                            {/* Two lines before it is cut: with the photo
                                beside it, one line of a phone leaves "Estrella
                                D…". */}
                            <span className="line-clamp-2 break-words text-sm font-medium text-gray-900">
                              {item.name}
                            </span>
                            {hint && <span className="block text-xs text-gray-400">{hint}</span>}
                          </label>
                          <input
                            id={`qty-${item.id}`}
                            inputMode="decimal"
                            autoComplete="off"
                            value={typed[item.id] ?? ''}
                            onChange={(e) =>
                              setTyped((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                            aria-invalid={bad}
                            className={[
                              'w-24 shrink-0 rounded-xl px-3 py-2 text-right tabular-nums',
                              FIELD_SKIN,
                              fieldTone(bad),
                            ].join(' ')}
                          />
                          <span className="w-12 shrink-0 truncate text-xs text-gray-500 sm:w-20">{item.unit ?? ''}</span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </Card>

          {/* Floats over the list as it scrolls: the glass of the page's
              panels, near-opaque so the rows passing under stay out of it. */}
          <div className="sticky bottom-3 z-10 mt-4 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-white/10 bg-[rgb(11_21_18/0.94)] px-4 py-3 shadow-[0_-12px_40px_-24px_rgb(0_0_0/0.9)]">
            {triedToSave && invalid.size > 0 && (
              <p className="mr-auto text-sm text-red-600">{t('inventory.count.invalid')}</p>
            )}
            {triedToSave && filled.length === 0 && (
              <p className="mr-auto text-sm text-red-600">{t('inventory.count.nothing')}</p>
            )}
            {save.isError && (
              <p className="mr-auto text-sm text-red-600">{getErrorMessage(save.error)}</p>
            )}
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t('inventory.count.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('inventory.count.saving') : t('inventory.count.save')}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

/**
 * Before opening / after closing, as the shop's period picker is drawn: two
 * radio buttons dressed as one control, so the keyboard of a radio group
 * comes with it. Under it, in words, what the choice does to that day's sales.
 */
function CountMomentPicker({
  value,
  day,
  onChange,
}: {
  value: CountMoment;
  day: string | null;
  onChange: (moment: CountMoment) => void;
}) {
  const t = useT();
  const name = useId();
  const helpId = useId();
  return (
    <fieldset className="mt-4" aria-describedby={day ? helpId : undefined}>
      <legend className="text-sm font-medium text-gray-700">{t('inventory.count.moment.legend')}</legend>
      <div className="mt-1 inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {COUNT_MOMENTS.map((moment) => (
          <label key={moment} className="relative">
            <input
              type="radio"
              name={name}
              value={moment}
              checked={value === moment}
              onChange={() => onChange(moment)}
              className="peer sr-only"
            />
            <span
              className={[
                'flex min-h-11 cursor-pointer items-center rounded-lg px-3.5 text-sm transition-colors motion-reduce:transition-none',
                'text-gray-500 hover:bg-white/[0.05] hover:text-gray-900',
                'peer-checked:bg-white/[0.09] peer-checked:font-semibold peer-checked:text-gray-900 peer-checked:ring-1 peer-checked:ring-inset peer-checked:ring-white/20',
                'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-300',
              ].join(' ')}
            >
              {t(`inventory.count.moment.${moment}`)}
            </span>
          </label>
        ))}
      </div>
      {day && (
        <p id={helpId} className="mt-2 text-xs text-gray-500">
          {t(`inventory.count.moment.${value}.help`, { day: formatDate(day) })}
        </p>
      )}
    </fieldset>
  );
}
