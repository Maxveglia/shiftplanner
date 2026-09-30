import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useWorkspaceApps } from '../../auth/useWorkspaceApps';
import { useCan } from '../../auth/useCan';
import {
  formatQuantity,
  useDeleteInventoryCount,
  useInventoryCount,
  useInventoryCounts,
  type InventoryCount,
} from '../../api/inventory';
import { queryKeys } from '../../api/keys';
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

export function InventoryCountsPage() {
  const t = useT();
  const navigate = useNavigate();
  const counts = useInventoryCounts();
  // Before opening or after closing matters only where there are sales.
  const sells = useWorkspaceApps().includes('store');

  return (
    <div>
      <PageHeader
        title={t('inventory.history.title')}
        description={t('inventory.history.description')}
        actions={
          <Button onClick={() => navigate('/inventory/count')}>{t('inventory.stock.count')}</Button>
        }
      />
      <Card>
        {counts.isLoading ? (
          <Spinner />
        ) : counts.isError ? (
          <StateMessage
            tone="error"
            title={t('inventory.history.loadError')}
            description={getErrorMessage(counts.error)}
          />
        ) : (counts.data?.length ?? 0) === 0 ? (
          <StateMessage title={t('inventory.history.empty')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('inventory.history.col.date')}</TH>
                <TH>{t('inventory.history.col.products')}</TH>
                <TH>{t('inventory.history.col.note')}</TH>
              </TR>
            </THead>
            <TBody>
              {counts.data!.map((c) => (
                <TR key={c.id} onClick={() => navigate(`/inventory/counts/${c.id}`)}>
                  <TD className="font-medium text-gray-900">
                    {formatDateTime(c.counted_at)}
                    {sells && c.after_close !== undefined && (
                      <span className="block text-xs font-normal text-gray-500">
                        {t(c.after_close ? 'inventory.count.moment.after_close' : 'inventory.count.moment.before_open')}
                      </span>
                    )}
                  </TD>
                  <TD className="tabular-nums">{c.line_count}</TD>
                  <TD className="text-gray-500">{c.note ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

export function InventoryCountDetailPage() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  // As in InventoryReceiptDetailPage: while the DELETE is on the way the
  // page shows the copy it had instead of watching the count, which the
  // delete's invalidation would refetch into a 404 behind the dialog.
  const [deleting, setDeleting] = useState<InventoryCount | null>(null);
  const count = useInventoryCount(deleting ? undefined : id);
  const remove = useDeleteInventoryCount();
  // Deleting a count is the manager's (lib/access.ts): without it, no button.
  const canDelete = useCan()('inventory.records.delete');
  const [confirming, setConfirming] = useState(false);
  const shown = deleting ?? count.data;

  const confirmDelete = () => {
    if (!id || !count.data || deleting) return;
    setDeleting(count.data);
    remove.mutate(id, {
      onSuccess: () => {
        qc.removeQueries({ queryKey: queryKeys.inventoryCount(id), exact: true });
        navigate('/inventory/counts', { replace: true });
      },
      onError: () => setDeleting(null),
    });
  };

  return (
    <div>
      <Link to="/inventory/counts" className="rounded text-sm font-medium text-brand-300 underline-offset-4 hover:text-brand-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300">
        {t('inventory.history.back')}
      </Link>
      {!deleting && count.isLoading ? (
        <Spinner />
      ) : !deleting && count.isError ? (
        <div className="mt-4">
          <StateMessage
            tone="error"
            title={t('inventory.history.loadError')}
            description={getErrorMessage(count.error)}
          />
        </div>
      ) : shown ? (
        <div className="mt-3">
          <PageHeader
            title={t('inventory.history.detailTitle', {
              date: formatDateTime(shown.counted_at),
            })}
            description={shown.note ?? undefined}
            actions={
              canDelete ? (
                <Button variant="secondary" onClick={() => setConfirming(true)}>
                  {t('inventory.history.delete')}
                </Button>
              ) : undefined
            }
          />
          <Card>
            <Table>
              <THead>
                <TR>
                  <TH>{t('inventory.history.col.product')}</TH>
                  <TH>{t('inventory.history.col.quantity')}</TH>
                </TR>
              </THead>
              {groupByCategory(shown.lines).map(([category, lines]) => (
                <TBody key={category ?? ''}>
                  <tr>
                    <td
                      colSpan={2}
                      className="bg-white/[0.03] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"
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
        title={t('inventory.history.deleteTitle')}
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('inventory.history.deleteCancel')}
            </Button>
            <Button
              variant="danger"
              disabled={remove.isPending || deleting !== null}
              onClick={confirmDelete}
            >
              {t('inventory.history.deleteConfirm')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-700">{t('inventory.history.deleteBody')}</p>
        {remove.isError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {getErrorMessage(remove.error)}
          </p>
        )}
      </Modal>
    </div>
  );
}
