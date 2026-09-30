import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  consumptionBreakdown,
  formatQuantity,
  isBelowMinimum,
  onHand,
  parsePositiveQuantity,
  parseQuantity,
  useAddInventoryBarcode,
  useCreateInventoryItem,
  useCreateInventorySupplier,
  useDeleteInventoryBarcode,
  useInventoryItems,
  useInventorySuppliers,
  useRemoveInventoryItemPhoto,
  useSetInventoryItemPhoto,
  useUpdateInventoryItem,
  type InventoryBarcode,
  type InventoryBarcodeInput,
  type InventoryItem,
  type InventorySupplier,
} from '../../api/inventory';
import { getErrorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { barcodeKey, cleanCode } from '../../lib/inventory/barcodeKey';
import { saveItemWithPhoto } from '../../lib/inventory/itemPhoto';
import { onHandLine } from '../../lib/inventory/onHandLine';
import { cleanPhone, MAX_SUPPLIER_NAME, MAX_SUPPLIER_PHONE, sortSuppliers, supplierProblem } from '../../lib/inventory/suppliers';
import { APP_LOCALE } from '../../lib/locale';
import { itemToEdit, useOrderAlert } from '../../components/inventory/orderAlertContext';
import { useCan } from '../../auth/useCan';
import type { PhotoDraft } from '../../lib/photo/photo';
import { CameraScanner } from '../../components/inventory/CameraScanner';
import { PhotoField } from '../../components/photo/PhotoField';
import { SquarePhoto } from '../../components/photo/SquarePhoto';
import { PageHeader } from '../DashboardLayout';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FIELD_SKIN, fieldTone, Input } from '../../components/Input';
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import { useLastShown } from '../../components/motion/useDialogMotion';
import { Spinner, StateMessage } from '../../components/StateMessage';
import { Table, TBody, TD, TH, THead, TR } from '../../components/Table';

/** Products grouped under their category, uncategorised last. */
export function groupByCategory<T extends { category: string | null }>(
  rows: T[],
): [string | null, T[]][] {
  const groups = new Map<string | null, T[]>();
  for (const row of rows) {
    const list = groups.get(row.category) ?? [];
    list.push(row);
    groups.set(row.category, list);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b);
  });
}

function quantityWithUnit(quantity: number | null, unit: string | null): string {
  if (quantity === null) return '—';
  return unit ? `${formatQuantity(quantity)} ${unit}` : formatQuantity(quantity);
}

export function InventoryStockPage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const orders = useOrderAlert();
  // Adding, editing, archiving and restoring products are the manager's
  // (lib/access.ts): without the permission none of it is drawn, and the
  // stock is a list to read, count and receive against.
  const allow = useCan();
  const canProducts = allow('inventory.products');
  const [showArchived, setShowArchived] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);
  const [query, setQuery] = useState('');
  const items = useInventoryItems(showArchived);
  const update = useUpdateInventoryItem();
  // null = closed, 'new' = adding, an item = editing that one.
  const [editing, setEditing] = useState<InventoryItem | 'new' | null>(null);
  // The dialog stays mounted while it leaves, showing what it was about
  // (`shownEditing`), and each opening gets a fresh one (`openings` as its
  // key): its fields start from what is being edited, not from whatever was
  // typed into the last one.
  const shownEditing = useLastShown(editing);
  const [openings, setOpenings] = useState(0);
  const edit = (what: InventoryItem | 'new') => {
    setEditing(what);
    setOpenings((n) => n + 1);
  };

  const all = items.data ?? [];
  const active = all.filter((i) => i.archived_at === null);
  const lowCount = active.filter(isBelowMinimum).length;

  // Each list that arrives fresh (not the cache shown while it is fetched
  // again) tells the notice what has been restocked: closed today and low
  // no more, it is forgotten, so falling below again brings the notice back.
  const { sawStock } = orders;
  const fresh = items.isSuccess && !items.isFetching;
  useEffect(() => {
    if (fresh && items.data) sawStock(items.data);
  }, [fresh, items.data, sawStock]);

  // Sent here by the low-stock notice to give a product its supplier: its
  // form opens as soon as the list has it, and the request is taken out of
  // the history so Back or a reload does not open it again.
  // Without the permission to edit products the request is only cleared.
  const wanted = itemToEdit(location.state);
  useEffect(() => {
    if (!wanted || !items.data) return;
    const found = items.data.find((i) => i.id === wanted);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    if (found && canProducts) edit(found);
    // `edit` is a fresh function every render; what matters is the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, items.data]);
  const lastCountedAt = active
    .map((i) => i.last_counted_at)
    .filter((d): d is string => d !== null)
    .sort()
    .pop();
  const lastReceivedAt = active
    .map((i) => i.last_received_at)
    .filter((d): d is string => d !== null)
    .sort()
    .pop();

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return all.filter(
      (i) =>
        (!needle ||
          i.name.toLocaleLowerCase().includes(needle) ||
          (i.category ?? '').toLocaleLowerCase().includes(needle)) &&
        (!onlyLow || isBelowMinimum(i)),
    );
  }, [all, query, onlyLow]);

  const categories = useMemo(
    () =>
      [...new Set(all.map((i) => i.category).filter((c): c is string => c !== null))].sort(),
    [all],
  );

  return (
    <div>
      <PageHeader
        title={t('inventory.stock.title')}
        description={t('inventory.stock.description')}
        actions={
          <div className="flex flex-wrap gap-2">
            {/* What is below its minimum, to order whenever the manager
                wants, not only when the notice opens by itself. Said with
                how many, so it is not a colour that says it. */}
            {lowCount > 0 && (
              <Button
                variant="secondary"
                aria-label={t('orders.stockButtonLabel', { count: lowCount })}
                onClick={() => orders.open({ kind: 'manual' })}
              >
                {t('orders.stockButton')}
                <span
                  aria-hidden="true"
                  className="rounded-full bg-red-100 px-1.5 text-xs font-semibold tabular-nums text-red-800 ring-1 ring-inset ring-red-200/60"
                >
                  {lowCount}
                </span>
              </Button>
            )}
            {canProducts && (
              <Button variant="secondary" onClick={() => edit('new')}>
                {t('inventory.stock.add')}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => navigate('/inventory/count')}
              disabled={active.length === 0}
            >
              {t('inventory.stock.count')}
            </Button>
            {/* Every delivery is a receipt, and there are more deliveries
                than counts: this is the one reached for most. */}
            <Button onClick={() => navigate('/inventory/receive')}>{t('inventory.stock.receive')}</Button>
          </div>
        }
      />

      {items.isLoading ? (
        <Spinner />
      ) : items.isError ? (
        <StateMessage
          tone="error"
          title={t('inventory.stock.loadError')}
          description={getErrorMessage(items.error)}
        />
      ) : all.length === 0 && !showArchived ? (
        <Card>
          {/* Only whoever may add products is told to add one; anybody else,
              what is true for them: the manager has not added any yet. */}
          <StateMessage
            title={t('inventory.stock.empty.title')}
            description={t(canProducts ? 'inventory.stock.empty.description' : 'inventory.stock.empty.readOnly')}
          />
          {canProducts && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => edit('new')}>{t('inventory.stock.add')}</Button>
            </div>
          )}
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-white/[0.05] px-3 py-1 text-gray-700 ring-1 ring-inset ring-white/10">
              {t('inventory.stock.summary.products', { count: active.length })}
            </span>
            {lowCount > 0 && (
              <span className="rounded-full bg-red-50 px-3 py-1 font-medium text-red-700 ring-1 ring-inset ring-red-400/30">
                {t('inventory.stock.summary.low', { count: lowCount })}
              </span>
            )}
            {/* Only when there is one: never having counted is not something
                to point out -- the figures keep themselves without it. */}
            {lastCountedAt && (
              <span className="rounded-full bg-white/[0.05] px-3 py-1 text-gray-500 ring-1 ring-inset ring-white/10">
                {t('inventory.stock.summary.lastCount', { date: formatDate(lastCountedAt) })}
              </span>
            )}
            {lastReceivedAt && (
              <span className="rounded-full bg-surface px-3 py-1 text-gray-500 ring-1 ring-gray-200">
                {t('inventory.stock.summary.lastReceipt', { date: formatDate(lastReceivedAt) })}
              </span>
            )}
          </div>

          <Card>
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('inventory.stock.search')}
                aria-label={t('inventory.stock.search')}
                className={`w-full max-w-xs rounded-xl px-3.5 py-2 ${FIELD_SKIN} ${fieldTone(false)}`}
              />
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={onlyLow}
                  onChange={(e) => setOnlyLow(e.target.checked)}
                />
                {t('inventory.stock.onlyLow')}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
                {t('inventory.stock.showArchived')}
              </label>
            </div>

            {shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">{t('inventory.stock.noMatch')}</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{t('inventory.stock.col.product')}</TH>
                    <TH>{t('inventory.stock.col.onHand')}</TH>
                    <TH>{t('inventory.stock.col.consumption')}</TH>
                    <TH>{t('inventory.stock.col.minimum')}</TH>
                    <TH>{t('inventory.stock.col.status')}</TH>
                    {canProducts && <TH>{''}</TH>}
                  </TR>
                </THead>
                {groupByCategory(shown).map(([category, rows]) => (
                  <TBody key={category ?? ''}>
                    <tr>
                      <td
                        colSpan={canProducts ? 6 : 5}
                        className="bg-white/[0.03] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"
                      >
                        {category ?? t('inventory.stock.uncategorised')}
                      </td>
                    </tr>
                    {rows.map((item) => (
                      <StockRow
                        key={item.id}
                        item={item}
                        actions={canProducts}
                        onEdit={() => edit(item)}
                        onRestore={() => update.mutate({ id: item.id, archived: false })}
                      />
                    ))}
                  </TBody>
                ))}
              </Table>
            )}
            {update.isError && (
              <p className="mt-3 text-sm text-red-600">{getErrorMessage(update.error)}</p>
            )}
          </Card>
        </>
      )}

      {shownEditing !== null && canProducts && (
        <ItemModal
          key={openings}
          open={editing !== null}
          // The product as the list has it now, not as it was when the
          // dialog opened: its barcodes change while it is open.
          item={
            shownEditing === 'new' ? null : (all.find((i) => i.id === shownEditing.id) ?? shownEditing)
          }
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function StockRow({
  item,
  actions,
  onEdit,
  onRestore,
}: {
  item: InventoryItem;
  /** Edit and Restore: drawn only for whoever may change products. */
  actions: boolean;
  onEdit: () => void;
  onRestore: () => void;
}) {
  const t = useT();
  const now = onHand(item);
  const went = consumptionBreakdown(item);
  const archived = item.archived_at !== null;
  const low = isBelowMinimum(item);
  const negative = now < 0;
  const whereFrom = onHandLine(item, t);
  return (
    <TR className={archived ? 'opacity-60' : ''}>
      {/* The photo first, so the eye finds the bottle before it reads the
          label; a product without one shows its initials in the same box,
          so every row is as tall with a photo as without. */}
      <TD className="min-w-[12rem] font-medium text-gray-900">
        <div className="flex items-center gap-3">
          <SquarePhoto
            name={item.name}
            url={item.photo_url}
            size="row"
            alt=""
          />
          <span className="min-w-0 break-words">{item.name}</span>
        </div>
      </TD>
      {/* The figures do not wrap: on a phone the table scrolls sideways in
          its card (Table's overflow-x-auto) instead of breaking "21 sept
          2026" over three lines. */}
      <TD className="whitespace-nowrap tabular-nums">
        <span className={['font-medium', negative ? 'text-amber-800' : 'text-gray-900'].join(' ')}>
          {quantityWithUnit(now, item.unit)}
        </span>
        {/* Where the number comes from, once it is not just the count. */}
        {whereFrom && <span className="block text-xs text-gray-500">{whereFrom}</span>}
        {/* More sold than came in: the figure is shown as it is, and what it
            means is said in words. It may wrap: it is a sentence, not a
            figure. */}
        {negative && (
          <span className="block max-w-[16rem] whitespace-normal text-xs font-medium text-amber-800">
            {t('inventory.stock.onHand.negative')}
          </span>
        )}
        {item.last_counted_at && (
          <span className="block text-xs text-gray-400">
            {t('inventory.stock.onHand.countedOn', { date: formatDate(item.last_counted_at) })}
          </span>
        )}
      </TD>
      <TD className="whitespace-nowrap tabular-nums">
        {went === null ? (
          <span className="text-gray-400">—</span>
        ) : went.total < 0 ? (
          // More on the shelf than could be there: said in words, not only
          // in amber -- it is a delivery nobody entered, or a miscount.
          <span className="font-medium text-amber-800">
            {t('inventory.stock.consumption.more', { quantity: quantityWithUnit(went.surplus, item.unit) })}
          </span>
        ) : (
          <span className="text-gray-700">{quantityWithUnit(went.total, item.unit)}</span>
        )}
        {/* Of what went, what the sales between the counts took by their
            recipes, and what they do not explain; or, when the count found
            more than the sales should have left, by how much. */}
        {went !== null && went.bySales > 0 && (
          <span className="block text-xs text-gray-500">
            {[
              t('inventory.stock.consumption.bySales', { quantity: quantityWithUnit(went.bySales, item.unit) }),
              went.unexplained > 0
                ? t('inventory.stock.consumption.unexplained', {
                    quantity: quantityWithUnit(went.unexplained, item.unit),
                  })
                : null,
              went.surplus > 0 && went.total >= 0
                ? t('inventory.stock.consumption.more', { quantity: quantityWithUnit(went.surplus, item.unit) })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
        {went !== null && item.previous_counted_at && item.last_counted_at && (
          <span className="block text-xs text-gray-400">
            {t('inventory.stock.consumption.between', {
              from: formatDate(item.previous_counted_at),
              to: formatDate(item.last_counted_at),
            })}
          </span>
        )}
      </TD>
      <TD className="tabular-nums text-gray-600">
        {item.min_quantity === null ? '—' : formatQuantity(item.min_quantity)}
      </TD>
      <TD>
        {archived ? (
          <Badge tone="gray">{t('inventory.stock.status.archived')}</Badge>
        ) : negative ? (
          <Badge tone="amber">{t('inventory.stock.status.negative')}</Badge>
        ) : low ? (
          <Badge tone="red">{t('inventory.stock.status.low')}</Badge>
        ) : (
          <Badge tone="green">{t('inventory.stock.status.ok')}</Badge>
        )}
      </TD>
      {actions && (
        <TD className="text-right">
          {archived ? (
            <Button size="sm" variant="ghost" onClick={onRestore}>
              {t('inventory.stock.restore')}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onEdit}>
              {t('inventory.stock.edit')}
            </Button>
          )}
        </TD>
      )}
    </TR>
  );
}

/** The select's value for "Add supplier…": no supplier's id can be it. */
const NEW_SUPPLIER = '__new__';

/**
 * The product's supplier -- one of the business's, none, or a new one typed
 * in place -- and its usual order, with its unit beside it. Inside the
 * product's form, so Enter in the new supplier's fields adds the supplier
 * rather than saving the product.
 */
function SupplierFields({
  choice,
  onChoice,
  options,
  loadError,
  newName,
  onNewName,
  newPhone,
  onNewPhone,
  problem,
  addError,
  adding,
  onAdd,
  unit,
  orderQuantity,
  onOrderQuantity,
  orderQuantityInvalid,
  canAddSupplier,
}: {
  choice: string;
  onChoice: (value: string) => void;
  options: InventorySupplier[];
  loadError: string | null;
  newName: string;
  onNewName: (v: string) => void;
  newPhone: string;
  onNewPhone: (v: string) => void;
  problem: ReturnType<typeof supplierProblem>;
  addError: string | null;
  adding: boolean;
  onAdd: () => void;
  unit: string | null;
  orderQuantity: string;
  onOrderQuantity: (v: string) => void;
  orderQuantityInvalid: boolean;
  /** "Add supplier…": only for whoever may add suppliers. */
  canAddSupplier: boolean;
}) {
  const t = useT();
  const id = useId();
  const enterAdds = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onAdd();
    }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id={`${id}-supplier`}
          label={t('orders.item.supplier')}
          value={choice}
          onChange={(e) => onChoice(e.target.value)}
          className="w-full"
        >
          <option value="">{t('orders.item.noSupplier')}</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {canAddSupplier && <option value={NEW_SUPPLIER}>{t('orders.item.newSupplier')}</option>}
        </Select>
        <div>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input
                id={`${id}-order`}
                label={t('orders.item.orderQuantity')}
                value={orderQuantity}
                onChange={(e) => onOrderQuantity(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                maxLength={16}
                error={orderQuantityInvalid ? ' ' : undefined}
                aria-describedby={`${id}-order-help${unit ? ` ${id}-order-unit` : ''}`}
                className="w-full text-right tabular-nums"
              />
            </div>
            {unit && (
              <span id={`${id}-order-unit`} className="max-w-[6rem] truncate pb-2.5 text-sm text-gray-500">
                {unit}
              </span>
            )}
          </div>
          <p
            id={`${id}-order-help`}
            className={['mt-1 text-xs', orderQuantityInvalid ? 'font-medium text-red-300' : 'text-gray-500'].join(' ')}
          >
            {t(orderQuantityInvalid ? 'orders.item.orderQuantityInvalid' : 'orders.item.orderQuantityHelp')}
          </p>
        </div>
      </div>
      {loadError && (
        <p role="alert" className="text-sm text-red-300">
          {t('orders.item.suppliersError', { reason: loadError })}
        </p>
      )}
      {choice === NEW_SUPPLIER && canAddSupplier && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <Input
            id={`${id}-new-name`}
            label={t('suppliers.form.name')}
            value={newName}
            onChange={(e) => onNewName(e.target.value)}
            onKeyDown={enterAdds}
            placeholder={t('suppliers.form.namePlaceholder')}
            maxLength={MAX_SUPPLIER_NAME}
            autoComplete="off"
            autoFocus
            error={problem && problem.startsWith('name') ? t(`suppliers.form.problem.${problem}`) : undefined}
          />
          <div>
            <Input
              id={`${id}-new-phone`}
              label={t('suppliers.form.phone')}
              type="tel"
              inputMode="tel"
              value={newPhone}
              onChange={(e) => onNewPhone(e.target.value)}
              onKeyDown={enterAdds}
              placeholder={t('suppliers.form.phonePlaceholder')}
              maxLength={MAX_SUPPLIER_PHONE}
              autoComplete="off"
              aria-describedby={`${id}-new-phone-help`}
              error={problem === 'phone_invalid' ? t('suppliers.form.problem.phone_invalid') : undefined}
            />
            <p id={`${id}-new-phone-help`} className="mt-1 text-xs text-gray-500">
              {t('suppliers.form.phoneHelp')}
            </p>
          </div>
          {addError && (
            <p role="alert" className="text-sm font-medium text-red-300">
              {addError}
            </p>
          )}
          <Button type="button" variant="secondary" className="min-h-11" onClick={onAdd} disabled={adding}>
            {t('orders.item.addSupplier')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A barcode as the dialog lists it: the server's, or one waiting for the product's POST. */
interface ShownBarcode {
  id: string;
  code: string;
  key: string;
  units_per_scan: number;
  label: string | null;
}

function ItemModal({
  open,
  item,
  categories,
  onClose,
}: {
  open: boolean;
  item: InventoryItem | null;
  categories: string[];
  onClose: () => void;
}) {
  const t = useT();
  const create = useCreateInventoryItem();
  const update = useUpdateInventoryItem();
  const addBarcode = useAddInventoryBarcode();
  const deleteBarcode = useDeleteInventoryBarcode();
  const putPhoto = useSetInventoryItemPhoto();
  const removePhoto = useRemoveInventoryItemPhoto();
  // The photo as it will be saved (lib/photo/photo.ts), and whether a picked
  // one is still being reduced: Save waits for it.
  const [photo, setPhoto] = useState<PhotoDraft>({ kind: 'keep' });
  const [preparing, setPreparing] = useState(false);
  // The product this dialog created when its photo then failed. From then on
  // it is the product being edited: Save updates it and sends the photo
  // again, and never creates a second one; its codes are its own now.
  const [created, setCreated] = useState<InventoryItem | null>(null);
  const current = item ?? created;
  // A ref as well as the state: a second Enter can arrive before the
  // disabled Save has reached the screen.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // What went wrong with the last Save or Archive; `itemSaved` when the
  // product is saved and only its photo is not.
  const [failure, setFailure] = useState<{ error: unknown; itemSaved: boolean } | null>(null);
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [minimum, setMinimum] = useState(
    item?.min_quantity === null || item?.min_quantity === undefined
      ? ''
      : String(item.min_quantity),
  );
  const minimumValue = parseQuantity(minimum);
  const minimumInvalid = minimum.trim() !== '' && minimumValue === null;
  // Only when adding it: what is already on the shelf, so a product brought
  // in with stock needs no count to start from its figure. Kept by the server
  // as a delivery made with the product. Empty or 0 is none.
  const [initial, setInitial] = useState('');
  const initialZero = parseQuantity(initial) === 0;
  const initialValue = initial.trim() === '' || initialZero ? null : parsePositiveQuantity(initial);
  const initialInvalid = !item && initial.trim() !== '' && !initialZero && initialValue === null;

  // --- Who it is ordered from, and how much at a time -----------------------
  //
  // Read by the low-stock notice (components/inventory/OrderAlert.tsx): the
  // supplier its order goes to, and the quantity each line starts at. A
  // supplier can be added from here without leaving the form: "Add
  // supplier…" opens its two fields in place, and "Add supplier" -- or Save,
  // if it was left typed -- creates it and chooses it.
  const suppliers = useInventorySuppliers();
  const createSupplier = useCreateInventorySupplier();
  const canAddSupplier = useCan()('inventory.suppliers');
  const [supplierChoice, setSupplierChoice] = useState(item?.supplier?.id ?? '');
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [newSupplierTried, setNewSupplierTried] = useState(false);
  const addingSupplier = supplierChoice === NEW_SUPPLIER;
  // The list as the server has it, plus the product's own supplier while the
  // list has not loaded (so the select shows it rather than "No supplier").
  const supplierOptions = useMemo(() => {
    const list: InventorySupplier[] = [...(suppliers.data ?? [])];
    const own = item?.supplier;
    if (own && !list.some((s) => s.id === own.id)) list.push(own);
    return sortSuppliers(list, APP_LOCALE);
  }, [suppliers.data, item?.supplier]);
  const newSupplierProblem = supplierProblem(newSupplierName, newSupplierPhone, suppliers.data ?? []);
  const newSupplierShown = newSupplierTried || newSupplierProblem === 'name_taken' ? newSupplierProblem : null;

  const [orderQuantity, setOrderQuantity] = useState(
    item?.order_quantity !== null && item?.order_quantity !== undefined ? formatQuantity(item.order_quantity) : '',
  );
  const orderQuantityValue = orderQuantity.trim() === '' ? null : parsePositiveQuantity(orderQuantity);
  const orderQuantityInvalid = orderQuantity.trim() !== '' && orderQuantityValue === null;

  /**
   * The supplier the product is saved with: the one chosen, or the one typed
   * under "Add supplier…", created first. Throws what the server said when
   * that is refused, so the save stops there with the reason.
   */
  const supplierToSave = async (): Promise<string | null> => {
    if (!addingSupplier) return supplierChoice || null;
    const created = await createSupplier.mutateAsync({
      name: newSupplierName.trim(),
      phone: cleanPhone(newSupplierPhone),
    });
    setSupplierChoice(created.id);
    setNewSupplierName('');
    setNewSupplierPhone('');
    setNewSupplierTried(false);
    return created.id;
  };

  const addSupplier = () => {
    setNewSupplierTried(true);
    if (newSupplierProblem || createSupplier.isPending) return;
    void supplierToSave().catch(() => {
      // Said under the fields (createSupplier.error).
    });
  };

  // --- Barcodes ---------------------------------------------------------
  //
  // A product that exists gets each code saved the moment it is added (and
  // taken off the moment it is removed): the list of codes is not part of
  // what "Save" saves. A new product has no id to hang them on yet, so its
  // codes wait here and go in the same POST as the product.
  const [newBarcodes, setNewBarcodes] = useState<InventoryBarcodeInput[]>([]);
  // Added and removed while the dialog is open, until the product list comes
  // back with them.
  const [added, setAdded] = useState<InventoryBarcode[]>([]);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const [codeText, setCodeTextState] = useState('');
  // The code field as it is now, for the answer to a POST sent from an
  // earlier render: it decides whether a failed code can be put back.
  const codeNow = useRef('');
  const setCodeText = (v: string) => {
    codeNow.current = v;
    setCodeTextState(v);
  };
  const [unitsText, setUnitsText] = useState('1');
  const [labelText, setLabelText] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  // Whether a code's POST is on its way. A ref, not addBarcode.isPending:
  // that reaches React a render later, and a scanner gun types the next code
  // and presses Enter within milliseconds.
  const sending = useRef(false);

  const shownBarcodes: ShownBarcode[] = current
    ? [
        ...current.barcodes,
        ...added.filter((a) => !current.barcodes.some((b) => b.id === a.id)),
      ].filter((b) => !removedIds.has(b.id))
    : newBarcodes.map((b, i) => ({
        id: `new-${i}`,
        code: b.code,
        key: barcodeKey(b.code) ?? b.code,
        units_per_scan: b.units_per_scan ?? 1,
        label: b.label ?? null,
      }));

  /** The code typed in the add row, checked. `input` is null when nothing is typed. */
  const readTypedCode = ():
    | { ok: true; input: InventoryBarcodeInput | null }
    | { ok: false; message: string } => {
    const code = cleanCode(codeText);
    if (!code) return { ok: true, input: null };
    const key = barcodeKey(code);
    if (key === null || code.length > 64) {
      return { ok: false, message: t('inventory.item.barcodes.invalid') };
    }
    const units = parseQuantity(unitsText);
    if (units === null || units <= 0 || units > 100000) {
      return { ok: false, message: t('inventory.item.barcodes.unitsInvalid') };
    }
    if (shownBarcodes.some((b) => b.key === key)) {
      return { ok: false, message: t('inventory.item.barcodes.duplicate') };
    }
    return { ok: true, input: { code, units_per_scan: units, label: labelText.trim() || null } };
  };

  const clearTypedCode = () => {
    setCodeText('');
    setUnitsText('1');
    setLabelText('');
    setCodeError(null);
  };

  /**
   * Saves one code of a product that exists, then runs `then`.
   *
   * The fields are emptied the moment the POST goes, not when its answer
   * comes: a gun that scans the next code meanwhile types it into an empty
   * field, not onto the end of this one, where the two together would have
   * been saved as one code that is neither. If the POST fails, what was sent
   * goes back into the fields with the reason -- unless something new was
   * typed there since, which is kept, and the message names the code that
   * failed instead.
   */
  const sendCode = (input: InventoryBarcodeInput, then?: () => void) => {
    if (!current) return;
    const sent = { code: codeText, units: unitsText, label: labelText };
    sending.current = true;
    clearTypedCode();
    addBarcode.mutate(
      { itemId: current.id, ...input },
      {
        // A 200 -- the code was this product's already, say a retry of a
        // POST whose answer was lost -- is the same success as a 201.
        onSuccess: (b) => {
          setAdded((prev) => (prev.some((a) => a.id === b.id) ? prev : [...prev, b]));
          then?.();
        },
        onError: (err) => {
          const reason = getErrorMessage(err);
          if (codeNow.current.trim() === '') {
            setCodeText(sent.code);
            setUnitsText(sent.units);
            setLabelText(sent.label);
            setCodeError(reason);
          } else {
            setCodeError(t('inventory.item.barcodes.notAdded', { code: input.code, reason }));
          }
        },
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  };

  const addCode = () => {
    // One code at a time: a second Enter while the first is on its way (a
    // double press, or the gun's next scan) sends nothing, and what it typed
    // stays in the field for when the first is back.
    if (sending.current) return;
    const typed = readTypedCode();
    if (!typed.ok) {
      setCodeError(typed.message);
      return;
    }
    if (!typed.input) return;
    setCodeError(null);
    if (current) {
      sendCode(typed.input);
    } else {
      setNewBarcodes((prev) => [...prev, typed.input!]);
      clearTypedCode();
    }
  };

  const removeCode = (b: ShownBarcode) => {
    if (current) {
      deleteBarcode.mutate(
        { itemId: current.id, barcodeId: b.id },
        { onSuccess: () => setRemovedIds((prev) => new Set(prev).add(b.id)) },
      );
    } else {
      setNewBarcodes((prev) => prev.filter((_, i) => `new-${i}` !== b.id));
    }
  };

  const busy = saving || update.isPending || addBarcode.isPending || createSupplier.isPending;

  /**
   * The product, then its photo (lib/inventory/itemPhoto.ts). Both saved:
   * the dialog closes. The product saved and its photo not: it stays open
   * with the photo still picked and says so -- and a product it has just
   * created becomes the one it edits, its codes with it, so the fields and
   * the codes waiting for the POST are emptied: they are on the product now.
   */
  const saveWithPhoto = async (save: () => Promise<InventoryItem>) => {
    savingRef.current = true;
    setSaving(true);
    setFailure(null);
    const outcome = await saveItemWithPhoto({
      save,
      photo,
      put: (id, blob) => putPhoto.mutateAsync({ id, photo: blob }),
      remove: (id) => removePhoto.mutateAsync(id),
    });
    savingRef.current = false;
    setSaving(false);
    if (outcome.kind === 'saved') {
      onClose();
      return;
    }
    if (outcome.kind === 'photoFailed' && !current) {
      setCreated(outcome.item);
      setNewBarcodes([]);
      clearTypedCode();
    }
    setFailure({ error: outcome.error, itemSaved: outcome.kind === 'photoFailed' });
  };

  const failureText = failure
    ? failure.itemSaved
      ? t('inventory.photo.savedWithout', { reason: getErrorMessage(failure.error) })
      : getErrorMessage(failure.error)
    : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Save is disabled while a code is on its way, but Enter in a field of
    // the form can get here before that disabled reaches the button.
    if (sending.current || savingRef.current) return;
    if (!name.trim() || minimumInvalid || orderQuantityInvalid || initialInvalid || preparing) return;
    // A supplier half typed under "Add supplier…" is added with the product,
    // or the fields say what is wrong with it.
    if (addingSupplier) {
      setNewSupplierTried(true);
      if (newSupplierProblem) return;
    }
    // A code typed and not yet added is not thrown away by "Save": it is
    // added with the rest, or the dialog says what is wrong with it.
    const typed = readTypedCode();
    if (!typed.ok) {
      setCodeError(typed.message);
      return;
    }
    const payload = {
      name: name.trim(),
      unit: unit.trim() || null,
      category: category.trim() || null,
      min_quantity: minimumValue,
      order_quantity: orderQuantityValue,
    };
    if (current) {
      const save = () =>
        void saveWithPhoto(async () =>
          update.mutateAsync({ id: current.id, ...payload, supplier_id: await supplierToSave() }),
        );
      // The typed code is saved first, the way "Add code" saves it: into the
      // list and out of the field. So if the product's own save then fails,
      // the next Save does not find the code both typed and on the product
      // and refuse it as "already has that code".
      if (typed.input) sendCode(typed.input, save);
      else save();
    } else {
      const barcodes = typed.input ? [...newBarcodes, typed.input] : newBarcodes;
      const stock =
        initialValue !== null ? { initial_quantity: initialValue, initial_note: t('inventory.item.initialNote') } : {};
      void saveWithPhoto(async () => {
        const withSupplier = { ...payload, ...stock, supplier_id: await supplierToSave() };
        return create.mutateAsync(barcodes.length > 0 ? { ...withSupplier, barcodes } : withSupplier);
      });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={current ? t('inventory.item.editTitle') : t('inventory.item.addTitle')}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          {/* In the footer, which does not scroll: at the end of the form,
              under the photo, it sat below the fold on a phone, and Save
              looked like it had done nothing. */}
          {failureText && (
            <p role="alert" className="w-full text-sm text-red-600">
              {failureText}
            </p>
          )}
          <div>
            {/* `current`, not `item`: a product created here whose photo then
                failed is being edited now, and can be archived like any other. */}
            {current && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setFailure(null);
                  update.mutate(
                    { id: current.id, archived: true },
                    { onSuccess: onClose, onError: (error) => setFailure({ error, itemSaved: false }) },
                  );
                }}
              >
                {t('inventory.item.archive')}
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose}>
              {t('inventory.item.cancel')}
            </Button>
            <Button
              type="submit"
              form="inventory-item-form"
              disabled={busy || preparing || !name.trim() || minimumInvalid || orderQuantityInvalid || initialInvalid}
            >
              {t('inventory.item.save')}
            </Button>
          </div>
        </div>
      }
    >
      <form id="inventory-item-form" onSubmit={onSubmit} className="space-y-4">
        <Input
          label={t('inventory.item.name')}
          name="inventory-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('inventory.item.namePlaceholder')}
          maxLength={200}
          autoFocus
          required
        />
        <PhotoField
          messages="inventory.photo"
          name={name}
          current={current?.photo_url ?? null}
          value={photo}
          onChange={setPhoto}
          onPreparing={setPreparing}
          disabled={busy}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t('inventory.item.unit')}
            name="inventory-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder={t('inventory.item.unitPlaceholder')}
            maxLength={64}
          />
          <Input
            label={t('inventory.item.category')}
            name="inventory-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={t('inventory.item.categoryPlaceholder')}
            list="inventory-categories"
            maxLength={200}
          />
          <datalist id="inventory-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        {/* `current`, as the title: a product created here whose photo then
            failed is being edited, and its stock went in with it. */}
        {!current && (
          <div>
            <Input
              label={t('inventory.item.initial')}
              name="inventory-initial"
              value={initial}
              onChange={(e) => setInitial(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              error={initialInvalid ? ' ' : undefined}
              aria-describedby="inventory-initial-help"
            />
            <p
              id="inventory-initial-help"
              className={['mt-1 text-xs', initialInvalid ? 'font-medium text-red-300' : 'text-gray-500'].join(' ')}
            >
              {t(initialInvalid ? 'inventory.item.initialInvalid' : 'inventory.item.initialHelp', {
                unit: unit.trim() || t('inventory.item.initialUnits'),
              })}
            </p>
          </div>
        )}
        <div>
          <Input
            label={t('inventory.item.minimum')}
            name="inventory-minimum"
            value={minimum}
            onChange={(e) => setMinimum(e.target.value)}
            inputMode="decimal"
            error={minimumInvalid ? ' ' : undefined}
          />
          <p className="mt-1 text-xs text-gray-500">{t('inventory.item.minimumHelp')}</p>
        </div>
        <SupplierFields
          choice={supplierChoice}
          onChoice={(v) => {
            setSupplierChoice(v);
            createSupplier.reset();
          }}
          options={supplierOptions}
          loadError={suppliers.isError ? getErrorMessage(suppliers.error) : null}
          newName={newSupplierName}
          onNewName={setNewSupplierName}
          newPhone={newSupplierPhone}
          onNewPhone={setNewSupplierPhone}
          problem={newSupplierShown}
          addError={createSupplier.isError ? getErrorMessage(createSupplier.error) : null}
          adding={createSupplier.isPending}
          onAdd={addSupplier}
          unit={unit.trim() || null}
          orderQuantity={orderQuantity}
          onOrderQuantity={setOrderQuantity}
          orderQuantityInvalid={orderQuantityInvalid}
          canAddSupplier={canAddSupplier}
        />
        {current && <p className="text-xs text-gray-500">{t('inventory.item.archiveHelp')}</p>}
      </form>

      {/* Outside the form on purpose: Enter in these fields adds a code
          (it is what a scanner gun presses after typing one), and inside the
          form it would save and close the product instead. */}
      <BarcodesSection
        barcodes={shownBarcodes}
        unit={unit.trim() || null}
        codeText={codeText}
        onCodeText={(v) => {
          setCodeText(v);
          setCodeError(null);
        }}
        unitsText={unitsText}
        onUnitsText={(v) => {
          setUnitsText(v);
          setCodeError(null);
        }}
        labelText={labelText}
        onLabelText={setLabelText}
        onAdd={addCode}
        onRemove={removeCode}
        adding={addBarcode.isPending}
        removing={deleteBarcode.isPending}
        // A failed add is in codeError (sendCode puts it there), so it goes
        // when the field is edited, like the other messages about the field.
        error={codeError ?? (deleteBarcode.isError ? getErrorMessage(deleteBarcode.error) : null)}
      />
    </Modal>
  );
}

function BarcodesSection({
  barcodes,
  unit,
  codeText,
  onCodeText,
  unitsText,
  onUnitsText,
  labelText,
  onLabelText,
  onAdd,
  onRemove,
  adding,
  removing,
  error,
}: {
  barcodes: ShownBarcode[];
  unit: string | null;
  codeText: string;
  onCodeText: (v: string) => void;
  unitsText: string;
  onUnitsText: (v: string) => void;
  labelText: string;
  onLabelText: (v: string) => void;
  onAdd: () => void;
  onRemove: (b: ShownBarcode) => void;
  adding: boolean;
  removing: boolean;
  error: string | null;
}) {
  const t = useT();
  const id = useId();
  const [camera, setCamera] = useState(false);
  const enterAdds = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onAdd();
    }
  };
  return (
    <section aria-labelledby={`${id}-title`} className="mt-5 space-y-3 border-t border-gray-100 pt-4">
      <div>
        <h3 id={`${id}-title`} className="text-sm font-medium text-gray-900">
          {t('inventory.item.barcodes.title')}
        </h3>
        <p className="mt-0.5 text-xs text-gray-500">{t('inventory.item.barcodes.help')}</p>
      </div>

      {barcodes.length === 0 ? (
        <p className="text-sm text-gray-500">{t('inventory.item.barcodes.none')}</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {barcodes.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-1 pl-3 pr-1">
              <div className="min-w-0 flex-1">
                <p className="break-all font-mono text-sm text-gray-900">{b.code}</p>
                <p className="text-xs text-gray-500">
                  {t(b.units_per_scan === 1 ? 'inventory.item.barcodes.worth.one' : 'inventory.item.barcodes.worth.other', {
                    count: formatQuantity(b.units_per_scan),
                    unit: unit ?? t('inventory.receive.unitFallback'),
                  })}
                  {b.label ? ` · ${b.label}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(b)}
                disabled={removing}
                aria-label={t('inventory.item.barcodes.remove', { code: b.code })}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-5 w-5">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 rounded-md bg-gray-50 p-3">
        <div>
          <label htmlFor={`${id}-code`} className="text-sm font-medium text-gray-700">
            {t('inventory.item.barcodes.code')}
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id={`${id}-code`}
              value={codeText}
              onChange={(e) => onCodeText(e.target.value)}
              onKeyDown={enterAdds}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="done"
              maxLength={128}
              placeholder={t('inventory.item.barcodes.codePlaceholder')}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className="m-field min-h-11 min-w-0 flex-1 rounded-md border border-gray-300 bg-surface px-3 py-2 font-mono text-base text-gray-900 placeholder:font-sans placeholder:text-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-200"
            />
            <button
              type="button"
              onClick={() => setCamera((o) => !o)}
              aria-expanded={camera}
              aria-label={t('inventory.item.barcodes.camera')}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-surface text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
                <path
                  fillRule="evenodd"
                  d="M1 8a2 2 0 012-2h.93a2 2 0 001.66-.89l.82-1.22A2 2 0 018.07 3h3.86a2 2 0 011.66.89l.82 1.22A2 2 0 0016.07 6H17a2 2 0 012 2v7a2 2 0 01-2 2H3a2 2 0 01-2-2V8zm13.5 3a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM10 14a3 3 0 100-6 3 3 0 000 6z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
        {camera && (
          <CameraScanner
            once
            onCode={(code) => onCodeText(cleanCode(code))}
            onClose={() => setCamera(false)}
          />
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${id}-units`} className="text-sm font-medium text-gray-700">
              {t('inventory.item.barcodes.units')}
            </label>
            <input
              id={`${id}-units`}
              value={unitsText}
              onChange={(e) => onUnitsText(e.target.value)}
              onKeyDown={enterAdds}
              inputMode="decimal"
              autoComplete="off"
              className="m-field mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-surface px-3 py-2 text-right text-base tabular-nums focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-200"
            />
          </div>
          <div>
            <label htmlFor={`${id}-label`} className="text-sm font-medium text-gray-700">
              {t('inventory.item.barcodes.label')}
            </label>
            <input
              id={`${id}-label`}
              value={labelText}
              onChange={(e) => onLabelText(e.target.value)}
              onKeyDown={enterAdds}
              maxLength={64}
              autoComplete="off"
              placeholder={t('inventory.receive.pending.labelPlaceholder')}
              className="m-field mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-surface px-3 py-2 text-base placeholder:text-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-200"
            />
          </div>
        </div>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <Button type="button" variant="secondary" className="min-h-11" onClick={onAdd} disabled={adding || !codeText.trim()}>
          {t('inventory.item.barcodes.add')}
        </Button>
      </div>
    </section>
  );
}
