// The shop's home: the sales of the last days, as a day book -- each day
// with what it came to, the period's total over all of it -- and the button
// that records a new one.
//
// The period's total and count are the server's (GET /store/stats), not the
// list's: the list stops at SALES_PAGE_LIMIT, the statistics add up every
// sale of the period.
//
// A sale comes from the till (Menu: tap the dishes, charge the bill) or is
// typed here, by the manager, dish by dish or as one free line for the whole
// day's cash. Opening one shows its lines (StoreSaleDetailPage), where it can
// be voided -- never deleted: a voided sale stays in this list, struck
// through and marked, and adds nothing to the day or the period.
//
// Typing one here is the manager's (`store.sales.manual`, lib/access.ts): an
// employee and the till's tablet charge from the Menu, and read this list --
// which is all they get here, with no "New sale" (Max, 28-sep-2026).

import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PageHeader } from '../DashboardLayout';
import { isVoided, SALES_PAGE_LIMIT, useStoreSales, useStoreStats, type StoreSale } from '../../api/store';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Spinner, StateMessage } from '../../components/StateMessage';
import { useLastShown } from '../../components/motion/useDialogMotion';
import { PaymentMethodLabel } from '../../components/store/PaymentMethodLabel';
import { PeriodPicker, usePeriod } from '../../components/store/PeriodPicker';
import { SaleFormModal, useSaleDraftScope } from '../../components/store/SaleFormModal';
import { getErrorMessage } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { plural, useT } from '../../lib/i18n';
import { browserStorage } from '../../lib/inventory/receiveDraft';
import { formatDayFull, formatDayHeading } from '../../lib/store/format';
import { groupSalesByDay, periodFigures } from '../../lib/store/group';
import { isoDay, periodRange } from '../../lib/store/period';
import { readSaleDraft } from '../../lib/store/saleDraft';
import { chargedAt } from '../../lib/store/void';
import { useCan } from '../../auth/useCan';

/** How long the "saved" notice stays before it leaves on its own. */
const SAVED_NOTICE_MS = 8000;

function Chevron() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-400">
      <path d="m8 5 5 5-5 5" />
    </svg>
  );
}

export function StoreSalesPage() {
  const t = useT();
  const [days, setDays] = usePeriod();
  // Handed to a sale's page, so its "Back" returns to these days.
  const { search } = useLocation();
  const here = `/store${search}`;
  const today = isoDay(new Date());
  // Two strings, the same all day: the key the list is cached under.
  const { from, to } = periodRange(days);
  const sales = useStoreSales(from, to);
  // Cached under the same key as the Statistics page's: one request for both.
  const stats = useStoreStats(from, to);
  const manual = useCan()('store.sales.manual');

  // --- The form -----------------------------------------------------------------
  //
  // Mounted fresh at every opening (the key), so it reads the draft as it is
  // then, and kept mounted while it leaves so it can play its exit.
  const scope = useSaleDraftScope();
  const storage = useMemo(browserStorage, []);
  const readDraft = () => (scope ? readSaleDraft(storage, scope) !== null : false);
  const [hasDraft, setHasDraft] = useState(readDraft);
  const [opening, setOpening] = useState<number | null>(null);
  const shownOpening = useLastShown(opening);
  const [openings, setOpenings] = useState(0);
  const openForm = () => {
    setOpenings((n) => n + 1);
    setOpening(openings + 1);
  };
  const closeForm = () => {
    setOpening(null);
    setHasDraft(readDraft());
  };

  // --- What was just saved --------------------------------------------------------
  const [saved, setSaved] = useState<StoreSale | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(null), SAVED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const list = sales.data ?? [];
  const groups = useMemo(() => groupSalesByDay(list), [list]);
  const capped = list.length >= SALES_PAGE_LIMIT;
  // A placeholder is the days shown before: not these days' figures.
  const figures = periodFigures(
    stats.data && !stats.isPlaceholderData ? stats.data : null,
    sales.data && !sales.isPlaceholderData ? sales.data : null,
    SALES_PAGE_LIMIT,
  );

  return (
    <div>
      <PageHeader
        title={t('store.sales.title')}
        description={t('store.sales.description')}
        actions={
          manual ? (
            <Button className="min-h-11" onClick={openForm}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="h-4 w-4">
                <path d="M10 4v12M4 10h12" />
              </svg>
              {hasDraft ? t('store.sales.continue') : t('store.sales.new')}
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker value={days} onChange={setDays} />
        {/* A slot of its own width, whatever it holds: the dash and the figure
            go beside the picker, or under it, alike -- the list does not jump
            when the figure comes in. */}
        {sales.data && list.length > 0 && (
          <p className="min-w-[13rem] flex-1 text-right text-sm text-gray-500">
            {figures ? (
              <>
                <span className="font-semibold tabular-nums text-gray-900">{formatMoney(figures.total)}</span>
                {' · '}
                {plural(figures.count, 'store.sales.count.one', 'store.sales.count.other')}
              </>
            ) : (
              // Still adding up: a dash in the figure's place, on the same line.
              <span aria-hidden="true" className="font-semibold text-gray-900">
                —
              </span>
            )}
          </p>
        )}
      </div>

      {sales.isLoading ? (
        <Spinner />
      ) : sales.isError && !sales.data ? (
        <StateMessage tone="error" title={t('store.sales.loadError')} description={getErrorMessage(sales.error)} />
      ) : list.length === 0 ? (
        <Card>
          <StateMessage
            title={t('store.sales.empty.title')}
            description={t(manual ? 'store.sales.empty.description' : 'store.sales.empty.descriptionTill')}
          />
          {manual && (
            <div className="mt-4 flex justify-center">
              <Button className="min-h-11" onClick={openForm}>
                {hasDraft ? t('store.sales.continue') : t('store.sales.new')}
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <div
          className={['transition-opacity duration-200 motion-reduce:transition-none', sales.isPlaceholderData ? 'opacity-50' : ''].join(' ')}
          aria-busy={sales.isPlaceholderData || undefined}
        >
          {capped && (
            <p className="mb-3 rounded-xl border border-amber-200/60 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t('store.sales.capped', { count: SALES_PAGE_LIMIT })}
            </p>
          )}
          <Card>
            <div className="divide-y divide-white/[0.06]">
              {groups.map((group) => (
                <section key={group.date} aria-label={formatDayHeading(group.date)} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-sm font-semibold text-gray-900">{formatDayHeading(group.date)}</h2>
                    <p className="text-sm font-semibold tabular-nums text-gray-900">{formatMoney(group.total)}</p>
                  </div>
                  <ul className="mt-1">
                    {group.sales.map((sale) => {
                      const voided = isVoided(sale);
                      const time = chargedAt(sale);
                      return (
                        <li key={sale.id}>
                          <Link
                            to={`/store/sales/${encodeURIComponent(sale.id)}`}
                            state={{ from: here }}
                            className="-mx-2 flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300 motion-reduce:transition-none"
                          >
                            {/* A voided sale is quieter and struck through, and
                                says "Anulada" in words: the strike alone is
                                not read out, and not every eye takes it in.
                                Quieter by colour, not opacity: gray-400 still
                                clears 4.5:1, a faded gray-500 does not. */}
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-2">
                                <span
                                  className={[
                                    'min-w-0 truncate text-sm',
                                    voided ? 'text-gray-400 line-through' : sale.note ? 'text-gray-800' : 'text-gray-500',
                                  ].join(' ')}
                                >
                                  {sale.note ?? t('store.sales.untitled')}
                                </span>
                                {voided && (
                                  <span className="shrink-0 rounded-full border border-amber-200/60 px-2 py-px text-xs font-medium text-amber-800">
                                    {t('store.sale.voided')}
                                  </span>
                                )}
                              </span>
                              {/* Each dot goes with what follows it, so a
                                  narrow row wraps into "· 13:05", never into a
                                  dot on a line of its own. */}
                              <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
                                <span>{plural(sale.line_count, 'store.sales.lines.one', 'store.sales.lines.other')}</span>
                                {time && (
                                  <span className="whitespace-nowrap tabular-nums">
                                    <span aria-hidden="true">· </span>
                                    {time}
                                  </span>
                                )}
                                {sale.payment_method && (
                                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                    <span aria-hidden="true">·</span>
                                    <PaymentMethodLabel method={sale.payment_method} />
                                  </span>
                                )}
                              </span>
                            </span>
                            <span
                              className={[
                                'shrink-0 text-sm tabular-nums',
                                voided ? 'text-gray-400 line-through' : 'text-gray-700',
                              ].join(' ')}
                            >
                              {formatMoney(sale.total)}
                            </span>
                            <Chevron />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </Card>
        </div>
      )}

      {manual && shownOpening !== null && (
        <SaleFormModal
          key={shownOpening}
          open={opening !== null}
          onClose={closeForm}
          onSaved={(sale) => setSaved(sale)}
        />
      )}

      {/* At the bottom of the screen, where the dialog closed: the sale is in
          the list too, but the list may be scrolled, or the sale dated
          outside the days on show. */}
      {saved && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4">
          <div
            role="status"
            className="m-toast-in m-glass-float pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-white/10 px-4 py-3 text-sm text-gray-800"
          >
            <p className="min-w-0 flex-1">
              {saved.sold_on === today
                ? t('store.sales.saved', { total: formatMoney(saved.total) })
                : t('store.sales.savedOn', { total: formatMoney(saved.total), day: formatDayFull(saved.sold_on) })}
            </p>
            <Link
              to={`/store/sales/${encodeURIComponent(saved.id)}`}
              state={{ from: here }}
              className="shrink-0 rounded-lg px-2 py-1 font-medium text-brand-700 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
            >
              {t('store.sales.view')}
            </Link>
            <button
              type="button"
              onClick={() => setSaved(null)}
              aria-label={t('store.sales.dismiss')}
              className="shrink-0 rounded-lg px-2 py-1 text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
