import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  formatQuantity,
  useDeleteInventoryReceipt,
  useInventoryReceipt,
  useInventoryReceipts,
  type InventoryReceipt,
} from '../../api/inventory';
import { queryKeys } from '../../api/keys';
import { useCan } from '../../auth/useCan';
import { getErrorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { PageHeader } from '../DashboardLayout';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Modal } from '../../components/Modal';
import { SquarePhoto } from '../../components/photo/SquarePhoto';
import { Spinner, StateMessage } from '../../components/StateMessage';
import { Table, TBody, TD, TH, THead, TR } from '../../components/Table';
import { groupByCategory } from './InventoryStockPage';

// The deliveries received, and each one's lines. The same shape as the counts
// (InventoryCountsPage), because a manager reads them the same way: what came,
// when, and from whom.

export function InventoryReceiptsPage() {
  const t = useT();
  const navigate = useNavigate();
  const receipts = useInventoryReceipts();

  return (
    <div>
      <PageHeader
        title={t('inventory.receipts.title')}
        description={t('inventory.receipts.description')}
        actions={
          <Button onClick={() => navigate('/inventory/receive')}>{t('inventory.stock.receive')}</Button>
        }
      />
      <Card>
        {receipts.isLoading ? (
          <Spinner />
        ) : receipts.isError ? (
          <StateMessage
            tone="error"
            title={t('inventory.receipts.loadError')}
            description={getErrorMessage(receipts.error)}
          />
        ) : (receipts.data?.length ?? 0) === 0 ? (
          <StateMessage title={t('inventory.receipts.empty')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('inventory.receipts.col.date')}</TH>
                <TH>{t('inventory.receipts.col.supplier')}</TH>
                <TH>{t('inventory.receipts.col.products')}</TH>
                <TH>{t('inventory.receipts.col.note')}</TH>
              </TR>
            </THead>
            <TBody>
              {receipts.data!.map((r) => (
                <TR key={r.id} onClick={() => navigate(`/inventory/receipts/${r.id}`)}>
                  <TD className="font-medium text-gray-900">
                    {/* A real link as well as the clickable row: the row's
                        click is for the mouse, the link for the keyboard and
                        for opening in a new tab. */}
                    <Link
                      to={`/inventory/receipts/${r.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                    >
                      {formatDateTime(r.received_at)}
                    </Link>
                  </TD>
                  <TD>{r.supplier ?? '—'}</TD>
                  {/* Products, not units: one delivery mixes bottles with
                      kilos, and their sum would mean nothing. */}
                  <TD className="tabular-nums">{r.line_count}</TD>
                  <TD className="text-gray-500">{r.note ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

export function InventoryReceiptDetailPage() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  // The receipt being deleted, as it was on the screen. While its DELETE is
  // on the way the page stops watching the receipt and shows this copy: the
  // delete invalidates every inventory query, a watched one is refetched at
  // once, and this one would come back a 404 -- retried, and shown behind
  // the dialog before the page moved on.
  const [deleting, setDeleting] = useState<InventoryReceipt | null>(null);
  const receipt = useInventoryReceipt(deleting ? undefined : id);
  const remove = useDeleteInventoryReceipt();
  // Deleting a delivery is the manager's (lib/access.ts): without it, no button.
  const canDelete = useCan()('inventory.records.delete');
  const [confirming, setConfirming] = useState(false);
  const shown = deleting ?? receipt.data;

  const described = shown
    ? [shown.supplier, shown.note].filter((s): s is string => Boolean(s)).join(' · ')
    : '';

  const confirmDelete = () => {
    if (!id || !receipt.data || deleting) return;
    setDeleting(receipt.data);
    remove.mutate(id, {
      onSuccess: () => {
        // Out of the cache as well, so nothing shows it again from memory.
        qc.removeQueries({ queryKey: queryKeys.inventoryReceipt(id), exact: true });
        navigate('/inventory/receipts', { replace: true });
      },
      // Still there: watch it again (it is in the cache, so nothing blinks).
      onError: () => setDeleting(null),
    });
  };

  return (
    <div>
      <Link to="/inventory/receipts" className="text-sm text-brand-700 hover:underline">
        {t('inventory.receipts.back')}
      </Link>
      {!deleting && receipt.isLoading ? (
        <Spinner />
      ) : !deleting && receipt.isError ? (
        <div className="mt-4">
          <StateMessage
            tone="error"
            title={t('inventory.receipts.loadError')}
            description={getErrorMessage(receipt.error)}
          />
        </div>
      ) : shown ? (
        <div className="mt-3">
          <PageHeader
            title={t('inventory.receipts.detailTitle', {
              date: formatDateTime(shown.received_at),
            })}
            description={described || undefined}
            actions={
              canDelete ? (
                <Button variant="secondary" onClick={() => setConfirming(true)}>
                  {t('inventory.receipts.delete')}
                </Button>
              ) : undefined
            }
          />
          <Card>
            <Table>
              <THead>
                <TR>
                  <TH>{t('inventory.receipts.col.product')}</TH>
                  <TH>{t('inventory.receipts.col.quantity')}</TH>
                </TR>
              </THead>
              {groupByCategory(shown.lines).map(([category, lines]) => (
                <TBody key={category ?? ''}>
                  <tr>
                    <td
                      colSpan={2}
                      className="bg-gray-50/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"
                    >
                      {category ?? t('inventory.stock.uncategorised')}
                    </td>
                  </tr>
                  {lines.map((line) => (
                    <TR key={line.item_id}>
                      <TD className="font-medium text-gray-900">
                        {/* The product's photo as it is now; its initials
                            when it has none, or the server does not say. */}
                        <div className="flex items-center gap-3">
                          <SquarePhoto
                            name={line.item_name}
                            url={line.photo_url}
                            size="row"
                            alt=""
                          />
                          <span className="min-w-0 break-words">{line.item_name}</span>
                        </div>
                      </TD>
                      <TD className="tabular-nums">
                        {formatQuantity(line.quantity)}
                        {line.unit && <span className="ml-1 text-gray-400">{line.unit}</span>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              ))}
            </Table>
          </Card>
        </div>
      ) : null}

      <Modal
        open={confirming && canDelete}
        onClose={() => setConfirming(false)}
        title={t('inventory.receipts.deleteTitle')}
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('inventory.receipts.deleteCancel')}
            </Button>
            <Button
              variant="danger"
              disabled={remove.isPending || deleting !== null}
              onClick={confirmDelete}
            >
              {t('inventory.receipts.deleteConfirm')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-700">{t('inventory.receipts.deleteBody')}</p>
        {remove.isError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {getErrorMessage(remove.error)}
          </p>
        )}
      </Modal>
    </div>
  );
}
