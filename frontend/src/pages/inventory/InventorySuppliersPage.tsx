// Inventory › Suppliers: who each product is ordered from. A name and the
// phone the orders go to by WhatsApp -- the low-stock notice
// (components/inventory/OrderAlert.tsx) writes one message per supplier and
// opens WhatsApp on that number with it. Without a phone the notice copies the
// order instead.
//
// Added, edited and deleted here; chosen in each product's form (Stock).
// Deleting one leaves its products without a supplier, and the confirmation
// says how many.
//
// A list, not a table: two short lines and two buttons each, which a phone
// shows whole without scrolling sideways.

import { useState, type FormEvent } from 'react';
import {
  useCreateInventorySupplier,
  useDeleteInventorySupplier,
  useInventoryItems,
  useInventorySuppliers,
  useUpdateInventorySupplier,
  type InventorySupplier,
  type InventorySupplierListed,
} from '../../api/inventory';
import { getErrorMessage } from '../../lib/api';
import { plural, useT } from '../../lib/i18n';
import { cleanPhone, MAX_SUPPLIER_NAME, MAX_SUPPLIER_PHONE, productsBySupplier, sortSuppliers, supplierProblem } from '../../lib/inventory/suppliers';
import { APP_LOCALE } from '../../lib/locale';
import { useCan } from '../../auth/useCan';
import { PageHeader } from '../DashboardLayout';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Input } from '../../components/Input';
import { Modal } from '../../components/Modal';
import { useLastShown } from '../../components/motion/useDialogMotion';
import { Spinner, StateMessage } from '../../components/StateMessage';

export function InventorySuppliersPage() {
  const t = useT();
  // Adding, editing and deleting suppliers are the manager's (lib/access.ts).
  // Without the permission the list is still here, phones and all -- it is
  // who the orders go to -- and nothing in it can be changed.
  const canEdit = useCan()('inventory.suppliers');
  const suppliers = useInventorySuppliers();
  // For how many products each has, when the server does not say.
  const items = useInventoryItems(false);
  const counts = productsBySupplier(items.data ?? []);
  const countOf = (s: InventorySupplierListed) => s.item_count ?? counts.get(s.id) ?? 0;

  // Each dialog stays mounted while it leaves, showing what it was about, and
  // every opening gets a fresh one (the key), as on Stock.
  const [editing, setEditing] = useState<InventorySupplierListed | 'new' | null>(null);
  const shownEditing = useLastShown(editing);
  const [deleting, setDeleting] = useState<InventorySupplierListed | null>(null);
  const shownDeleting = useLastShown(deleting);
  const [openings, setOpenings] = useState(0);
  const openForm = (what: InventorySupplierListed | 'new') => {
    setEditing(what);
    setOpenings((n) => n + 1);
  };
  const openDelete = (what: InventorySupplierListed) => {
    setDeleting(what);
    setOpenings((n) => n + 1);
  };

  const list = sortSuppliers(suppliers.data ?? [], APP_LOCALE);

  return (
    <div>
      <PageHeader
        title={t('suppliers.title')}
        description={t('suppliers.description')}
        actions={
          canEdit && list.length > 0 ? (
            <Button className="min-h-11" onClick={() => openForm('new')}>
              {t('suppliers.add')}
            </Button>
          ) : undefined
        }
      />

      {suppliers.isLoading ? (
        <Spinner />
      ) : suppliers.isError ? (
        <StateMessage tone="error" title={t('suppliers.loadError')} description={getErrorMessage(suppliers.error)} />
      ) : list.length === 0 ? (
        <Card>
          <StateMessage
            title={t('suppliers.empty.title')}
            description={t(canEdit ? 'suppliers.empty.description' : 'suppliers.empty.readOnly')}
          />
          {canEdit && (
            <div className="mt-4 flex justify-center">
              <Button className="min-h-11" onClick={() => openForm('new')}>
                {t('suppliers.add')}
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          {!canEdit && <p className="mb-3 text-xs text-gray-500">{t('suppliers.readOnly')}</p>}
          <ul className="divide-y divide-white/[0.06]">
            {list.map((s) => {
              const count = countOf(s);
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="break-words text-sm font-medium text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-500">
                      <span className="tabular-nums">{s.phone ?? t('suppliers.noPhone')}</span>
                      {' · '}
                      {count === 0
                        ? t('suppliers.products.none')
                        : plural(count, 'suppliers.products.one', 'suppliers.products.other')}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="secondary"
                        className="min-h-11"
                        aria-label={t('suppliers.editLabel', { name: s.name })}
                        onClick={() => openForm(s)}
                      >
                        {t('suppliers.edit')}
                      </Button>
                      <Button
                        variant="ghost"
                        className="min-h-11"
                        aria-label={t('suppliers.removeLabel', { name: s.name })}
                        onClick={() => openDelete(s)}
                      >
                        {t('suppliers.remove')}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {shownEditing !== null && canEdit && (
        <SupplierModal
          key={`form-${openings}`}
          open={editing !== null}
          supplier={shownEditing === 'new' ? null : shownEditing}
          others={suppliers.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      {shownDeleting !== null && canEdit && (
        <DeleteSupplierModal
          key={`delete-${openings}`}
          open={deleting !== null}
          supplier={shownDeleting}
          products={countOf(shownDeleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/**
 * A supplier's name and WhatsApp phone, checked as the server checks them
 * (lib/inventory/suppliers.ts). A name already taken says so as it is typed;
 * the rest, on Save. (The product form adds one of its own, inline.)
 */
function SupplierModal({
  open,
  supplier,
  others,
  onClose,
}: {
  open: boolean;
  supplier: InventorySupplier | null;
  others: readonly InventorySupplier[];
  onClose: () => void;
}) {
  const t = useT();
  const create = useCreateInventorySupplier();
  const update = useUpdateInventorySupplier();
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [tried, setTried] = useState(false);
  const problem = supplierProblem(name, phone, others, supplier?.id ?? null);
  const shown = tried ? problem : problem === 'name_taken' || problem === 'name_long' ? problem : null;
  const busy = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const formId = `supplier-form-${supplier?.id ?? 'new'}`;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (problem || busy) return;
    const payload = { name: name.trim(), phone: cleanPhone(phone) };
    if (supplier) update.mutate({ id: supplier.id, ...payload }, { onSuccess: onClose });
    else create.mutate(payload, { onSuccess: onClose });
  };

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t(supplier ? 'suppliers.form.editTitle' : 'suppliers.form.addTitle')}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-3">
          {error && (
            <p role="alert" className="w-full text-sm text-red-300">
              {getErrorMessage(error)}
            </p>
          )}
          <Button variant="secondary" className="min-h-11" onClick={close} disabled={busy}>
            {t('suppliers.form.cancel')}
          </Button>
          <Button type="submit" form={formId} className="min-h-11" disabled={busy}>
            {busy ? t('suppliers.form.saving') : t('suppliers.form.save')}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4">
        <Input
          label={t('suppliers.form.name')}
          name="supplier-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('suppliers.form.namePlaceholder')}
          maxLength={MAX_SUPPLIER_NAME}
          autoComplete="off"
          autoFocus
          required
          error={shown && shown.startsWith('name') ? t(`suppliers.form.problem.${shown}`) : undefined}
        />
        <div>
          <Input
            label={t('suppliers.form.phone')}
            name="supplier-phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('suppliers.form.phonePlaceholder')}
            maxLength={MAX_SUPPLIER_PHONE}
            aria-describedby="supplier-phone-help"
            error={shown === 'phone_invalid' ? t('suppliers.form.problem.phone_invalid') : undefined}
          />
          <p id="supplier-phone-help" className="mt-1 text-xs text-gray-500">
            {t('suppliers.form.phoneHelp')}
          </p>
        </div>
      </form>
    </Modal>
  );
}

function DeleteSupplierModal({
  open,
  supplier,
  products,
  onClose,
}: {
  open: boolean;
  supplier: InventorySupplier;
  products: number;
  onClose: () => void;
}) {
  const t = useT();
  const remove = useDeleteInventorySupplier();
  const close = () => {
    if (!remove.isPending) onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={t('suppliers.delete.title', { name: supplier.name })}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-3">
          {remove.isError && (
            <p role="alert" className="w-full text-sm text-red-300">
              {getErrorMessage(remove.error)}
            </p>
          )}
          <Button variant="secondary" className="min-h-11" onClick={close} disabled={remove.isPending}>
            {t('suppliers.delete.cancel')}
          </Button>
          <Button
            variant="danger"
            className="min-h-11"
            disabled={remove.isPending}
            onClick={() => remove.mutate(supplier.id, { onSuccess: onClose })}
          >
            {remove.isPending ? t('suppliers.delete.deleting') : t('suppliers.delete.confirm')}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-gray-800">
        {products === 0
          ? t('suppliers.delete.none')
          : plural(products, 'suppliers.delete.one', 'suppliers.delete.other')}
      </p>
    </Modal>
  );
}
