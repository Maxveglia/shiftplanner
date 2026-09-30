import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useCustomer,
  useDeleteCustomer,
  useUpdateSubscription,
} from '../../api/backoffice';
import { getErrorMessage } from '../../lib/api';
import {
  employmentStatusLabel,
  formatDate,
  formatDateTime,
  planLabel,
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
import {
  formatCount,
  formatUsd,
  purposeLabel,
  relativeDays,
} from '../../components/backoffice/viz';
import { Metric } from '../../components/backoffice/Metric';
import { BackOfficeHeader } from './BackOfficeLayout';
import type {
  CustomerDetail,
  EmploymentStatus,
  Plan,
  SubscriptionStatus,
} from '../../types';

const plans: Plan[] = ['trial', 'starter', 'growth', 'scale'];
const statuses: SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
];

export function BackOfficeCustomerPage() {
  const { orgId = '' } = useParams();
  const customer = useCustomer(orgId);
  const t = useT();

  if (customer.isLoading) {
    return <Spinner label={t('backoffice.customer.loading')} />;
  }
  if (customer.isError || !customer.data) {
    return (
      <StateMessage
        tone="error"
        title={t('backoffice.customer.error')}
        description={getErrorMessage(customer.error)}
      />
    );
  }

  const data = customer.data;
  // Keys come straight from the server; index the label map defensively so a
  // status this build does not know about still renders as itself.
  const statusEntries = Object.entries(data.employees_by_status);
  // Sorted by cost, biggest first: the question this card answers is "what is
  // this customer spending it on", and the answer is the top line.
  const purposeEntries = Object.entries(data.api_cost.by_purpose_30d).sort(
    (a, b) => b[1] - a[1],
  );
  return (
    <div>
      <Link
        to="/backoffice/customers"
        className="mb-4 inline-block rounded text-sm font-medium text-brand-300 underline-offset-4 hover:text-brand-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
      >
        {t('backoffice.customer.back')}
      </Link>

      <BackOfficeHeader
        title={data.org_name}
        description={t('backoffice.customer.description', {
          date: formatDate(data.signed_up_at),
          jurisdiction: data.jurisdiction_code,
        })}
        actions={
          <Badge tone={subscriptionStatusTone[data.status]}>
            {subscriptionStatusLabel(data.status)} · {planLabel(data.plan)}
          </Badge>
        }
      />

      {/* min-w-0 on both columns: a grid track grows to the widest thing
          in it, and the administrators' table (which scrolls on its own)
          pushed the whole page past a phone's edge. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card title={t('backoffice.customer.size.title')}>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric
                label={t('backoffice.customer.size.managers')}
                value={data.managers}
              />
              <Metric
                label={t('backoffice.customer.size.employees')}
                value={data.employees}
              />
              <Metric
                label={t('backoffice.customer.size.templates')}
                value={data.shift_templates}
              />
              <Metric
                label={t('backoffice.customer.size.absences')}
                value={data.absences_recorded}
              />
            </dl>

            {statusEntries.length > 0 && (
              <div className="mt-5 border-t border-white/[0.06] pt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('backoffice.customer.size.byStatus')}
                </p>
                <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-700">
                  {statusEntries.map(([status, count]) => (
                    <li key={status}>
                      <span className="tabular-nums font-medium text-gray-900">
                        {count}
                      </span>{' '}
                      {employmentStatusLabel(status as EmploymentStatus) ??
                        status}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-5 rounded-xl bg-white/[0.03] p-3 text-xs text-gray-500 ring-1 ring-inset ring-white/[0.06]">
              {t('backoffice.customer.size.note')}
            </p>
          </Card>

          <Card title={t('backoffice.customer.cost.title')}>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric
                label={t('backoffice.customer.cost.usd30d')}
                value={data.api_cost.usd_30d}
                format={formatUsd}
              />
              <Metric
                label={t('backoffice.customer.cost.usdTotal')}
                value={data.api_cost.usd_total}
                format={formatUsd}
              />
              <Metric
                label={t('backoffice.customer.cost.calls30d')}
                value={data.api_cost.calls_30d}
              />
              <Metric
                label={t('backoffice.customer.cost.tokens30d')}
                value={
                  data.api_cost.input_tokens_30d + data.api_cost.output_tokens_30d
                }
              />
            </dl>

            {purposeEntries.length > 0 ? (
              <div className="mt-5 border-t border-white/[0.06] pt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('backoffice.customer.cost.byPurpose')}
                </p>
                <ul className="space-y-1 text-sm text-gray-700">
                  {purposeEntries.map(([purpose, usd]) => (
                    <li key={purpose} className="flex justify-between gap-4">
                      <span>{purposeLabel(purpose)}</span>
                      <span className="tabular-nums font-medium text-gray-900">
                        {formatUsd(usd)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-500">
                {t('backoffice.customer.cost.empty')}
              </p>
            )}

            <p className="mt-5 rounded-xl bg-white/[0.03] p-3 text-xs text-gray-500 ring-1 ring-inset ring-white/[0.06]">
              {t('backoffice.customer.cost.note')}
            </p>
          </Card>

          <Card title={t('backoffice.customer.admins.title')}>
            {data.admins.length === 0 ? (
              <StateMessage
                title={t('backoffice.customer.admins.empty.title')}
                description={t(
                  'backoffice.customer.admins.empty.description',
                )}
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{t('backoffice.customer.admins.column.name')}</TH>
                    <TH>{t('backoffice.customer.admins.column.email')}</TH>
                    <TH>{t('backoffice.customer.admins.column.lastSeen')}</TH>
                    <TH>{t('backoffice.customer.admins.column.state')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.admins.map((admin) => (
                    <TR key={admin.id}>
                      <TD className="font-medium text-gray-900">
                        {admin.full_name}
                      </TD>
                      <TD>
                        <a
                          href={`mailto:${admin.email}`}
                          className="rounded text-brand-300 underline-offset-4 hover:text-brand-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
                        >
                          {admin.email}
                        </a>
                      </TD>
                      <TD className={admin.last_seen_at ? '' : 'text-gray-500'}>
                        {relativeDays(admin.last_seen_at)}
                      </TD>
                      <TD>
                        {admin.is_active ? (
                          <Badge tone="green">
                            {t('backoffice.customer.admins.active')}
                          </Badge>
                        ) : (
                          <Badge tone="gray">
                            {t('backoffice.customer.admins.disabled')}
                          </Badge>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {data.employee_logins > 0 && (
              <p className="mt-4 text-xs text-gray-500">
                {t(
                  data.employee_logins === 1
                    ? 'backoffice.customer.admins.logins.one'
                    : 'backoffice.customer.admins.logins.other',
                  { count: formatCount(data.employee_logins) },
                )}
              </p>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <SubscriptionForm key={data.org_id} customer={data} />

          <Card title={t('backoffice.customer.pulse.title')}>
            <dl className="space-y-3 text-sm">
              <Fact
                label={t('backoffice.customer.pulse.lastSignIn')}
                value={relativeDays(data.last_active_at)}
                detail={
                  data.last_active_at ? formatDateTime(data.last_active_at) : null
                }
              />
              <Fact
                label={t('backoffice.customer.pulse.trialEnds')}
                value={data.trial_ends_at ? formatDate(data.trial_ends_at) : '—'}
              />
              <Fact
                label={t('backoffice.customer.pulse.startedPaying')}
                value={
                  data.activated_at
                    ? formatDate(data.activated_at)
                    : t('backoffice.customer.pulse.never')
                }
              />
              <Fact
                label={t('backoffice.customer.pulse.canceled')}
                value={data.canceled_at ? formatDate(data.canceled_at) : '—'}
              />
            </dl>
          </Card>
        
          <DangerZone key={`danger-${data.org_id}`} customer={data} />
        </div>
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right">
        <span className="font-medium text-gray-900">{value}</span>
        {detail && <span className="block text-xs text-gray-500">{detail}</span>}
      </dd>
    </div>
  );
}

/**
 * The lever that turns an organization into a customer.
 *
 * Until billing is wired to a payment provider this form is the only writer of
 * the subscription table, which is why the headline count on the overview is a
 * deliberate act rather than something inferred from activity.
 */
function SubscriptionForm({ customer }: { customer: CustomerDetail }) {
  const t = useT();
  const update = useUpdateSubscription(customer.org_id);
  const [plan, setPlan] = useState<Plan>(customer.plan);
  const [status, setStatus] = useState<SubscriptionStatus>(customer.status);
  const [seats, setSeats] = useState<string>(
    customer.seats === null ? '' : String(customer.seats),
  );
  const [trialEndsAt, setTrialEndsAt] = useState<string>(
    customer.trial_ends_at ?? '',
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({
      plan,
      status,
      seats: seats.trim() === '' ? null : Number(seats),
      trial_ends_at: trialEndsAt || null,
    });
  };

  // One sentence, one key. `{status}` is deliberately left unfilled so the
  // emphasised word can be wrapped in a span without splitting the sentence
  // into fragments that would have to be reordered per language.
  const [noteBefore, noteAfter = ''] = t(
    'backoffice.customer.subscription.note',
  ).split('{status}');

  return (
    <Card title={t('backoffice.customer.subscription.title')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Select
          label={t('backoffice.customer.subscription.plan')}
          value={plan}
          onChange={(e) => setPlan(e.target.value as Plan)}
        >
          {plans.map((option) => (
            <option key={option} value={option}>
              {planLabel(option)}
            </option>
          ))}
        </Select>

        <Select
          label={t('backoffice.customer.subscription.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
        >
          {statuses.map((option) => (
            <option key={option} value={option}>
              {subscriptionStatusLabel(option)}
            </option>
          ))}
        </Select>

        <Input
          label={t('backoffice.customer.subscription.seats')}
          type="number"
          min={0}
          placeholder={t('backoffice.customer.subscription.seats.placeholder')}
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
        />

        <Input
          label={t('backoffice.customer.subscription.trialEnds')}
          type="date"
          value={trialEndsAt}
          onChange={(e) => setTrialEndsAt(e.target.value)}
        />

        {update.isError && (
          <p className="text-sm text-red-600">{getErrorMessage(update.error)}</p>
        )}
        {update.isSuccess && !update.isPending && (
          <p className="text-sm text-green-700">
            {t('backoffice.customer.subscription.saved')}
          </p>
        )}

        <Button type="submit" disabled={update.isPending}>
          {update.isPending
            ? t('backoffice.customer.subscription.saving')
            : t('backoffice.customer.subscription.save')}
        </Button>

        <p className="text-xs text-gray-500">
          {noteBefore}
          <span className="font-medium">{subscriptionStatusLabel('active')}</span>
          {noteAfter}
        </p>
      </form>
    </Card>
  );
}

/**
 * Removing a customer for good.
 *
 * Kept visually apart from the subscription form above, because they answer
 * different questions. Cancelling a subscription is the reversible move for a
 * customer who stopped paying and might return. This is for the accounts that
 * were never customers at all -- tests, spam, abandoned signups -- which
 * otherwise sit in the metrics forever and make "how many companies are on the
 * platform?" quietly wrong.
 *
 * The name has to be typed back. An "are you sure?" that only needs a click is
 * the one guard everybody clicks through, and the server checks the name too.
 */
function DangerZone({ customer }: { customer: CustomerDetail }) {
  const t = useT();
  const navigate = useNavigate();
  const remove = useDeleteCustomer(customer.org_id);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const matches = typed.trim() === customer.org_name.trim();

  // As above: whole sentences, with the emphasised word left as a placeholder
  // for the component to split on.
  const [warningBefore, warningAfter = ''] = t(
    'backoffice.customer.delete.warning',
    { count: formatCount(customer.employees) },
  ).split('{name}');
  const [altBefore, altAfter = ''] = t(
    'backoffice.customer.delete.alternative',
  ).split('{status}');

  const onConfirm = () => {
    remove.mutate(customer.org_name, {
      onSuccess: () => navigate('/backoffice/customers', { replace: true }),
    });
  };

  return (
    <Card
      title={
        <h2 className="text-base font-semibold text-red-700">
          {t('backoffice.customer.delete.title')}
        </h2>
      }
      className="border-red-200"
    >
      <p className="text-sm text-gray-600">
        {warningBefore}
        <span className="font-medium">{customer.org_name}</span>
        {warningAfter}
      </p>
      <p className="mt-2 text-sm text-gray-500">
        {altBefore}
        <span className="font-medium">{subscriptionStatusLabel('canceled')}</span>
        {altAfter}
      </p>

      {!open ? (
        <Button variant="danger" size="sm" className="mt-4" onClick={() => setOpen(true)}>
          {t('backoffice.customer.delete.open')}
        </Button>
      ) : (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <Input
            label={t('backoffice.customer.delete.confirmLabel', {
              name: customer.org_name,
            })}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={customer.org_name}
            autoFocus
          />
          {remove.isError && (
            <p className="mt-2 text-sm text-red-700">
              {getErrorMessage(remove.error)}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={!matches || remove.isPending}
              onClick={onConfirm}
            >
              {remove.isPending
                ? t('backoffice.customer.delete.deleting')
                : t('backoffice.customer.delete.confirm')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setOpen(false);
                setTyped('');
              }}
            >
              {t('backoffice.customer.delete.cancel')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
