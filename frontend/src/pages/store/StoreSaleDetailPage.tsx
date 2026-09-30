// One sale: its day, its note, how it was paid and where it came from, its
// lines as they were charged, and what it came to.
//
// A sale is never deleted and never edited: the only thing to do here is VOID
// it -- charged twice, the wrong amount. A voided sale stays, here and in the
// list, and says when, by whom and why; it no longer counts in any figure.
// There is no undoing it: a sale voided by mistake is charged again.
//
// Voiding is `store.sales.void` (lib/access.ts), which the employee and the
// till's tablet have as well as the manager: whoever charged it twice at the
// counter puts it right there (Max, 28-sep-2026).

import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PageHeader } from '../DashboardLayout';
import { useWorkspaceApps } from '../../auth/useWorkspaceApps';
import { useCan } from '../../auth/useCan';
import { isVoided, MAX_VOID_REASON, useStoreSale, useVoidStoreSale } from '../../api/store';
import { formatQuantity } from '../../api/inventory';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FIELD_SKIN, fieldTone } from '../../components/Input';
import { Modal } from '../../components/Modal';
import { Spinner, StateMessage } from '../../components/StateMessage';
import { PaymentMethodLabel } from '../../components/store/PaymentMethodLabel';
import { errorCode, getErrorMessage } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { formatDayFull } from '../../lib/store/format';
import { chargedAt, recordedBySentence, voidedSentence } from '../../lib/store/void';

/** Where "Back" goes: the list as it was left (its period), or its plain form. */
function backTo(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/store') ? from : '/store';
}

/** A fact about the sale in a small pill: "Efectivo", "Cuenta · 13:05". */
const FACT = 'inline-flex min-h-7 items-center rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-0.5 text-xs text-gray-700';

export function StoreSaleDetailPage() {
  const t = useT();
  const location = useLocation();
  const back = backTo(location.state);
  const { id } = useParams<{ id: string }>();
  const sale = useStoreSale(id);
  const voidSale = useVoidStoreSale();
  const canVoid = useCan()('store.sales.void');
  const [confirming, setConfirming] = useState(false);
  // With the inventory, a sale took its recipes' ingredients off the stock,
  // and voiding it gives them back: the dialog says so.
  const hasInventory = useWorkspaceApps().includes('inventory');
  const [reason, setReason] = useState('');
  const ids = useId();
  const formId = `${ids}-void`;

  const shown = sale.data;
  const voided = shown ? isVoided(shown) : false;
  const tillTime = shown ? chargedAt(shown) : null;
  // "Cobrada por Tablet barra": who saved it, now that more than the manager
  // charges (an employee, the till's tablet).
  const recordedBy = shown ? recordedBySentence(shown) : null;

  // Voided from here, focus goes to what now says so: the button that opened
  // the dialog is gone with the dialog, and focus dropped on the page would
  // start the next Tab from the top.
  const notice = useRef<HTMLDivElement>(null);
  const [justVoided, setJustVoided] = useState(false);
  // Voided by someone else first (409): said, in the server's words, over
  // what their void says -- the manager pressed "Void" and has to be told why
  // it was not theirs.
  const [alreadyVoided, setAlreadyVoided] = useState<string | null>(null);
  useEffect(() => {
    if (justVoided && voided) notice.current?.focus();
  }, [justVoided, voided]);

  const openConfirm = () => {
    voidSale.reset();
    setReason('');
    setConfirming(true);
  };

  const confirmVoid = () => {
    if (!id || !shown || voided || voidSale.isPending) return;
    voidSale.mutate(
      { id, reason },
      {
        onSuccess: () => {
          setConfirming(false);
          setJustVoided(true);
        },
        onError: (error) => {
          // Voided meanwhile -- another tab, another manager. The sale is
          // refetched (useVoidStoreSale) and says by whom; nothing is left to
          // confirm, so the dialog goes.
          if (errorCode(error) === 'store_sale_already_voided') {
            setConfirming(false);
            setJustVoided(true);
            setAlreadyVoided(getErrorMessage(error));
          }
        },
      },
    );
  };

  return (
    <div>
      <Link
        to={back}
        className="inline-flex min-h-11 items-center gap-1 text-sm text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
      >
        <span aria-hidden="true">←</span>
        {t('store.sale.back')}
      </Link>
      {sale.isLoading ? (
        <Spinner />
      ) : sale.isError && !shown ? (
        <div className="mt-4">
          <StateMessage tone="error" title={t('store.sale.loadError')} description={getErrorMessage(sale.error)} />
        </div>
      ) : shown ? (
        <div className="mt-2">
          <PageHeader
            title={t('store.sale.title', { day: formatDayFull(shown.sold_on) })}
            description={shown.note ?? undefined}
            actions={
              voided || !canVoid ? undefined : (
                <Button variant="secondary" className="min-h-11" onClick={openConfirm}>
                  {t('store.sale.void')}
                </Button>
              )
            }
          />

          {voided && (
            <div
              ref={notice}
              tabIndex={-1}
              className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0">
                <circle cx="10" cy="10" r="7" />
                <path d="m5.2 14.8 9.6-9.6" />
              </svg>
              <div className="min-w-0 space-y-0.5">
                {alreadyVoided && <p className="font-semibold">{alreadyVoided}</p>}
                <p className="font-semibold">{voidedSentence(shown)}</p>
                {shown.void_reason && (
                  <p className="break-words">{t('store.sale.voidedReason', { reason: shown.void_reason })}</p>
                )}
                <p>{t('store.sale.voidedNote')}</p>
              </div>
            </div>
          )}

          {/* How it was paid and where it came from, in a word each. Their
              names are for screen readers; on screen the words say enough. */}
          <dl className="mb-4 flex flex-wrap items-center gap-2">
            {shown.payment_method && (
              <div className="contents">
                <dt className="sr-only">{t('store.sale.payment')}</dt>
                <dd className={FACT}>
                  <PaymentMethodLabel method={shown.payment_method} />
                </dd>
              </div>
            )}
            <div className="contents">
              <dt className="sr-only">{t('store.sale.source')}</dt>
              <dd className={FACT}>
                {shown.source === 'till'
                  ? tillTime
                    ? t('store.source.tillAt', { time: tillTime })
                    : t('store.source.till')
                  : t('store.source.manual')}
              </dd>
            </div>
            {recordedBy && (
              <div className="contents">
                <dt className="sr-only">{t('store.sale.by')}</dt>
                <dd className={`${FACT} break-words`}>{recordedBy}</dd>
              </div>
            )}
          </dl>

          <Card>
            {/* A list and not a four-column table: on a phone the name gets
                the width, and the "2 × 6,50 €" under it says the rest. A
                voided sale's lines are left as they were: they are what was
                voided, and the notice above and the struck total say so. */}
            <ul className="divide-y divide-white/[0.06]">
              {shown.lines.map((line) => (
                <li key={line.id} className="flex items-start justify-between gap-4 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-gray-900">{line.name}</p>
                    <p className="text-xs tabular-nums text-gray-500">
                      {t('store.sale.line', { quantity: formatQuantity(line.quantity), price: formatMoney(line.unit_price) })}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-medium tabular-nums text-gray-900">{formatMoney(line.amount)}</p>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-white/15 pt-3">
              <p className="text-sm font-semibold text-gray-900">
                {t('store.sale.total')}
                {voided && (
                  <span className="ml-2 rounded-full border border-amber-200/60 px-2 py-0.5 text-xs font-medium text-amber-800">
                    {t('store.sale.voided')}
                  </span>
                )}
              </p>
              <p className={['text-xl font-semibold tabular-nums', voided ? 'text-gray-400 line-through' : 'text-gray-900'].join(' ')}>
                {formatMoney(shown.total)}
              </p>
            </div>
          </Card>
        </div>
      ) : null}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('store.sale.voidTitle')}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="secondary" className="min-h-11" onClick={() => setConfirming(false)}>
              {t('store.sale.voidCancel')}
            </Button>
            <Button type="submit" form={formId} variant="danger" className="min-h-11" disabled={voidSale.isPending || voided}>
              {voidSale.isPending ? t('store.sale.voiding') : t('store.sale.voidConfirm')}
            </Button>
          </div>
        }
      >
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            confirmVoid();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <p className="text-sm text-gray-700">
              {shown ? t('store.sale.voidBody', { day: formatDayFull(shown.sold_on), total: formatMoney(shown.total) }) : null}
            </p>
            {hasInventory && <p className="text-sm text-gray-700">{t('store.sale.voidStock')}</p>}
          </div>
          <div className="group/field flex flex-col gap-1">
            <label
              htmlFor={`${ids}-reason`}
              className="text-sm font-medium text-gray-700 transition-colors duration-200 group-focus-within/field:text-brand-300 motion-reduce:transition-none"
            >
              {t('store.sale.voidReason')}
            </label>
            <input
              id={`${ids}-reason`}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('store.sale.voidReasonPlaceholder')}
              maxLength={MAX_VOID_REASON}
              autoComplete="off"
              aria-describedby={`${ids}-reason-hint`}
              className={`${FIELD_SKIN} ${fieldTone(false)} block w-full rounded-xl px-3.5 py-2.5`}
            />
            <p id={`${ids}-reason-hint`} className="text-xs text-gray-500">
              {t('store.sale.voidReasonHint', { count: MAX_VOID_REASON })}
            </p>
          </div>
          {voidSale.isError && errorCode(voidSale.error) !== 'store_sale_already_voided' && (
            <p role="alert" className="text-sm text-red-600">
              {getErrorMessage(voidSale.error)}
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}
