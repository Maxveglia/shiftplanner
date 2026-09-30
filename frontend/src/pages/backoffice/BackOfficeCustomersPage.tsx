import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCustomers } from '../../api/backoffice';
import { getErrorMessage } from '../../lib/api';
import {
  formatDate,
  planLabel,
  subscriptionStatusKeys,
  subscriptionStatusLabel,
  subscriptionStatusTone,
} from '../../lib/format';
import { useT } from '../../lib/i18n';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Spinner, StateMessage } from '../../components/StateMessage';
import { Table, TBody, TD, TH, THead, TR } from '../../components/Table';
import { relativeDays } from '../../components/backoffice/viz';
import { BackOfficeHeader } from './BackOfficeLayout';
import type { SubscriptionStatus } from '../../types';

const PAGE_SIZE = 25;

// Keys, not words: the option is translated at render time so the filter
// follows the language, and the paying/trialing/past-due wording stays the same
// here as it is in the table next to it.
const statusOptions: Array<{
  value: '' | SubscriptionStatus;
  labelKey: string;
}> = [
  { value: '', labelKey: 'backoffice.customers.status.all' },
  { value: 'active', labelKey: subscriptionStatusKeys.active },
  { value: 'trialing', labelKey: subscriptionStatusKeys.trialing },
  { value: 'past_due', labelKey: subscriptionStatusKeys.past_due },
  { value: 'canceled', labelKey: subscriptionStatusKeys.canceled },
];

export function BackOfficeCustomersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | SubscriptionStatus>('');
  const [offset, setOffset] = useState(0);
  const t = useT();

  const customers = useCustomers({
    q: search,
    status,
    limit: PAGE_SIZE,
    offset,
  });

  // Any change to the filters invalidates the page you were on.
  const onSearch = (value: string) => {
    setSearch(value);
    setOffset(0);
  };
  const onStatus = (value: '' | SubscriptionStatus) => {
    setStatus(value);
    setOffset(0);
  };

  const total = customers.data?.total ?? 0;
  const items = customers.data?.items ?? [];
  const from = total === 0 ? 0 : offset + 1;
  const to = offset + items.length;

  return (
    <div>
      <BackOfficeHeader
        title={t('backoffice.customers.title')}
        description={t('backoffice.customers.description')}
      />

      <Card>
        {/* Filters in one row above the table, as one control group. */}
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <Input
              label={t('backoffice.customers.search')}
              placeholder={t('backoffice.customers.search.placeholder')}
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
          <Select
            label={t('backoffice.customers.status')}
            value={status}
            onChange={(e) => onStatus(e.target.value as '' | SubscriptionStatus)}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </Select>
        </div>

        {customers.isLoading ? (
          <Spinner />
        ) : customers.isError ? (
          <StateMessage
            tone="error"
            title={t('backoffice.customers.error')}
            description={getErrorMessage(customers.error)}
          />
        ) : items.length === 0 ? (
          <StateMessage
            title={t('backoffice.customers.empty.title')}
            description={
              search || status
                ? t('backoffice.customers.empty.filtered')
                : t('backoffice.customers.empty.none')
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>{t('backoffice.customers.column.company')}</TH>
                  <TH>{t('backoffice.customers.column.plan')}</TH>
                  <TH>{t('backoffice.customers.column.status')}</TH>
                  <TH>{t('backoffice.customers.column.managers')}</TH>
                  <TH>{t('backoffice.customers.column.employees')}</TH>
                  <TH>{t('backoffice.customers.column.signedUp')}</TH>
                  <TH>{t('backoffice.customers.column.lastActive')}</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((customer) => (
                  <TR
                    key={customer.org_id}
                    onClick={() =>
                      navigate(`/backoffice/customers/${customer.org_id}`)
                    }
                  >
                    <TD className="font-medium text-gray-900">
                      {customer.org_name}
                      {customer.owner_email && (
                        <span className="block text-xs font-normal text-gray-500">
                          {customer.owner_email}
                        </span>
                      )}
                    </TD>
                    <TD>{planLabel(customer.plan)}</TD>
                    <TD>
                      <Badge tone={subscriptionStatusTone[customer.status]}>
                        {subscriptionStatusLabel(customer.status)}
                      </Badge>
                    </TD>
                    <TD className="tabular-nums">{customer.managers}</TD>
                    <TD className="tabular-nums">{customer.employees}</TD>
                    <TD>{formatDate(customer.signed_up_at)}</TD>
                    <TD
                      className={
                        customer.last_active_at ? '' : 'text-gray-500'
                      }
                    >
                      {relativeDays(customer.last_active_at)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
              <span className="tabular-nums">
                {t('backoffice.customers.range', { from, to, total })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  {t('backoffice.customers.previous')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={to >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  {t('backoffice.customers.next')}
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
