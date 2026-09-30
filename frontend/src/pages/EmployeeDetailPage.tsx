import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useEmployee, useSetBaseHours } from '../api/employees';
import { useCreateContract, useEmployeeContracts } from '../api/contracts';
import { toPayPolicy, usePayPolicy } from '../api/payPolicy';
import { useBusinessProfile } from '../api/profile';
import { useLaborProfiles } from '../api/laborProfiles';
import { useAuth } from '../auth/useAuth';
import { useVacationBalance } from '../api/vacation';
import { useBalances } from '../api/workday';
import { getErrorMessage } from '../lib/api';
import {
  employmentStatusLabel,
  employmentTypeKeys,
  employmentTypeLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  ledgerReasonLabel,
  movementTypeLabel,
} from '../lib/format';
import { useT } from '../lib/i18n';
import type {
  ContractCreate,
  ContractOut,
  EmploymentType,
  PayPeriod,
} from '../types';
import { payPeriodKeys, payPeriodLabel } from '../lib/schedule/payPeriod';
import { DEFAULT_PAY_POLICY, type PayPolicy } from '../lib/schedule/payroll';
import { nightPremiumFloor } from '../lib/schedule/jurisdiction';
import { describePremiums } from '../lib/roster/reconcile';
import { TeamAccessCard } from '../components/TeamAccessCard';
import { Button } from '../components/Button';
import { FIELD_SKIN, fieldTone, Input } from '../components/Input';
import { Select } from '../components/Select';
import { Card } from '../components/Card';
import { HoursBalanceCard } from '../components/employee/HoursBalanceCard';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Spinner, StateMessage } from '../components/StateMessage';
import { Table, TBody, TD, TH, THead, TR } from '../components/Table';
import { statusTone } from './EmployeesPage';

const emptyContract: ContractCreate = {
  employment_type: 'non_exempt_hourly',
  base_annual_salary: null,
  hourly_rate: null,
  min_hours_per_week: 0,
  max_hours_per_week: null,
  complementary_pct: null,
  night_premium_pct: null,
  weekend_premium_pct: null,
  overtime_multiplier: null,
  night_premium_basis: null,
  pay_period: 'monthly',
  valid_from: new Date().toISOString().slice(0, 10),
};

/** Whether a contract sets any premium of its own rather than the business's. */
function hasOwnPremiums(
  c: Pick<
    ContractCreate,
    'night_premium_pct' | 'weekend_premium_pct' | 'overtime_multiplier' | 'night_premium_basis'
  > | null,
): boolean {
  return (
    c != null &&
    (c.night_premium_pct != null ||
      c.weekend_premium_pct != null ||
      c.overtime_multiplier != null ||
      c.night_premium_basis != null)
  );
}

/**
 * A new version's form, with this person's own premiums already in it.
 *
 * The rest of the form starts empty, as it always has. The premiums do not,
 * because they are the one thing a manager would not think to re-enter: a
 * contract that stops paying Juan's nights for a reason recorded months ago
 * must not start paying them again because somebody changed his hourly rate.
 */
function newVersionForm(current: ContractOut | null): ContractCreate {
  return {
    ...emptyContract,
    night_premium_pct: current?.night_premium_pct ?? null,
    weekend_premium_pct: current?.weekend_premium_pct ?? null,
    overtime_multiplier: current?.overtime_multiplier ?? null,
    night_premium_basis: current?.night_premium_basis ?? null,
  };
}

export function EmployeeDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const employee = useEmployee(id);
  const contracts = useEmployeeContracts(id);
  const balance = useVacationBalance(id);
  // The whole roster's hours, filtered to this person. One request rather than
  // a per-employee endpoint: the server reads the year once to answer it, and
  // the roster list has usually asked for it already -- so opening a file from
  // that list is a cache hit rather than a second read of the same year.
  const balances = useBalances();
  const myBalance = useMemo(
    () => balances.data?.employees.find((b) => b.employee_id === id) ?? null,
    [balances.data, id],
  );
  const balanceMonths = useMemo(
    () =>
      balances.data
        ? {
            month: formatDate(balances.data.month_start),
            quarter: formatDate(balances.data.quarter_start),
            year: formatDate(balances.data.year_start),
          }
        : null,
    [balances.data],
  );
  const createContract = useCreateContract(id ?? '');

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ContractCreate>(emptyContract);
  const [premiumsOpen, setPremiumsOpen] = useState(false);

  // What an empty premium field inherits, and the floor it is judged against.
  // The business's figures are shown as the placeholder so an empty field
  // reads as the number it stands for rather than as nothing.
  const payPolicy = usePayPolicy();
  const business: PayPolicy = payPolicy.data
    ? toPayPolicy(payPolicy.data)
    : DEFAULT_PAY_POLICY;
  const { user } = useAuth();
  const businessProfile = useBusinessProfile();
  const laborProfiles = useLaborProfiles();
  const jurisdiction =
    businessProfile.data?.jurisdiction_code ?? user?.org_jurisdiction ?? null;
  const floor = jurisdiction
    ? nightPremiumFloor(laborProfiles.data ?? [], jurisdiction)
    : null;

  const effectiveNight = form.night_premium_pct ?? business.nightDifferentialPct;
  // Below the agreement -- or at zero where there is no agreement to be below
  // -- is where the one lawful reason (art. 36.2 ET) is worth asking about.
  // An exempt salaried person's pay does not move with their hours, so their
  // nights are not priced and there is nothing to explain.
  const nightLow =
    form.employment_type !== 'exempt_salaried' &&
    (floor != null ? effectiveNight < floor : effectiveNight === 0);
  const nightWarning =
    nightLow && floor != null && form.night_premium_basis === null;

  const openForm = () => {
    const current = employee.data?.current_contract ?? null;
    setForm(newVersionForm(current));
    setPremiumsOpen(hasOwnPremiums(current));
    setOpen(true);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // A reason for a low night premium is only kept while the premium IS low:
    // raised back to the agreement's, the tick box is hidden and would
    // otherwise go on saying something about a contract that no longer needs
    // it said.
    const body: ContractCreate = {
      ...form,
      night_premium_basis: nightLow ? form.night_premium_basis : null,
    };
    createContract.mutate(body, {
      onSuccess: () => {
        setOpen(false);
        setForm(emptyContract);
      },
    });
  };

  if (employee.isLoading) return <Spinner />;
  if (employee.isError || !employee.data) {
    return (
      <StateMessage
        tone="error"
        title={t('people.employee.loadError')}
        description={getErrorMessage(employee.error)}
      />
    );
  }

  const emp = employee.data;

  return (
    <div>
      <div className="mb-6">
        <Link to="/employees" className="rounded text-sm font-medium text-brand-300 underline-offset-4 hover:text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300">
          ← {t('people.employee.back')}
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{emp.full_name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {emp.external_id} · {emp.email ?? t('people.employee.noEmail')}
          </p>
        </div>
        <Button onClick={openForm}>
          {t('people.employee.addContract')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title={t('people.employee.details')}>
          <dl className="space-y-3 text-sm">
            <Field label={t('people.employee.field.status')}>
              {/* The roster's colour for the same word: this said every
                  situation in blue, so "active" was green on the list and
                  blue on the file. */}
              <Badge tone={statusTone[emp.employment_status]}>
                {employmentStatusLabel(emp.employment_status)}
              </Badge>
            </Field>
            <Field label={t('people.employee.field.hireDate')}>
              {formatDate(emp.hire_date)}
            </Field>
            <Field label={t('people.employee.field.currentContract')}>
              {emp.current_contract
                ? employmentTypeLabel(emp.current_contract.employment_type)
                : t('people.employee.noContract')}
            </Field>
            <Field label={t('people.employee.field.weeklyHours')}>
              {emp.current_contract ? (
                <WeeklyHours
                  employeeId={emp.id}
                  hours={emp.current_contract.min_hours_per_week}
                />
              ) : (
                '—'
              )}
            </Field>
            <Field label={t('people.employee.field.paid')}>
              {emp.current_contract
                ? payPeriodLabel(emp.current_contract.pay_period)
                : '—'}
            </Field>
            <Field label={t('people.employee.field.created')}>
              {formatDateTime(emp.created_at)}
            </Field>
          </dl>
        </Card>

        {/* Where this person stands against their contract. Next to the
            details rather than at the bottom: "is she short of hours?" is a
            question about the person, and this is the page about the person. */}
        <HoursBalanceCard
          balances={myBalance}
          months={balanceMonths}
          isLoading={balances.isLoading}
          isError={balances.isError}
        />

        <Card
          title={t('people.employee.vacation.title')}
          className="lg:col-span-3"
          actions={
            balance.data ? (
              <span className="text-sm font-semibold text-gray-900">
                {balance.data.balance_days === 1
                  ? t('people.employee.vacation.days.one', {
                      count: balance.data.balance_days,
                    })
                  : t('people.employee.vacation.days.other', {
                      count: balance.data.balance_days,
                    })}
              </span>
            ) : null
          }
        >
          {balance.isLoading ? (
            <Spinner />
          ) : balance.isError ? (
            <StateMessage
              tone="error"
              title={t('people.employee.vacation.loadError')}
              description={getErrorMessage(balance.error)}
            />
          ) : (balance.data?.ledger.length ?? 0) === 0 ? (
            <StateMessage
              title={t('people.employee.vacation.empty.title')}
              description={t('people.employee.vacation.empty.description')}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('people.employee.vacation.col.date')}</TH>
                  <TH>{t('people.employee.vacation.col.movement')}</TH>
                  <TH>{t('people.employee.vacation.col.days')}</TH>
                  <TH>{t('people.employee.vacation.col.reason')}</TH>
                </TR>
              </THead>
              <TBody>
                {balance.data!.ledger.map((m) => (
                  <TR key={m.id}>
                    <TD>{formatDate(m.effective_date)}</TD>
                    <TD>{movementTypeLabel(m.movement_type)}</TD>
                    <TD
                      className={
                        m.days < 0 ? 'text-red-300' : 'text-green-700'
                      }
                    >
                      {m.days > 0 ? `+${m.days}` : m.days}
                    </TD>
                    <TD>{ledgerReasonLabel(m.reason)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <TeamAccessCard employee={emp} />
      </div>

      <div className="mt-6">
        <Card title={t('people.employee.contracts.title')}>
          {contracts.isLoading ? (
            <Spinner />
          ) : contracts.isError ? (
            <StateMessage
              tone="error"
              title={t('people.employee.contracts.loadError')}
              description={getErrorMessage(contracts.error)}
            />
          ) : (contracts.data?.length ?? 0) === 0 ? (
            <StateMessage
              title={t('people.employee.contracts.empty.title')}
              description={t('people.employee.contracts.empty.description')}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('people.employee.contracts.col.type')}</TH>
                  <TH>{t('people.employee.contracts.col.validFrom')}</TH>
                  <TH>{t('people.employee.contracts.col.validTo')}</TH>
                  <TH>{t('people.employee.contracts.col.salary')}</TH>
                  <TH>{t('people.employee.contracts.col.hourly')}</TH>
                  <TH>{t('people.employee.contracts.col.hours')}</TH>
                  <TH>{t('people.employee.contracts.col.complementary')}</TH>
                  <TH>{t('people.employee.contracts.col.paid')}</TH>
                  <TH>{t('people.employee.contracts.col.premiums')}</TH>
                  <TH>{t('people.employee.contracts.col.state')}</TH>
                </TR>
              </THead>
              <TBody>
                {contracts.data!.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium text-gray-900">
                      {employmentTypeLabel(c.employment_type)}
                    </TD>
                    <TD>{formatDate(c.valid_from)}</TD>
                    <TD>{c.valid_to ? formatDate(c.valid_to) : '—'}</TD>
                    <TD>{formatMoney(c.base_annual_salary)}</TD>
                    <TD>{formatMoney(c.hourly_rate)}</TD>
                    <TD>
                      {c.min_hours_per_week}
                      {' / '}
                      {c.max_hours_per_week ?? '∞'}
                    </TD>
                    <TD>
                      {c.complementary_pct == null
                        ? t('people.employee.contracts.noPact')
                        : `${Math.round(c.complementary_pct * 100)}%`}
                    </TD>
                    <TD>{payPeriodLabel(c.pay_period)}</TD>
                    <TD>
                      {hasOwnPremiums(c)
                        ? describePremiums({
                            nightPremiumPct: numOrNull(c.night_premium_pct),
                            weekendPremiumPct: numOrNull(c.weekend_premium_pct),
                            overtimeMultiplier: numOrNull(c.overtime_multiplier),
                            nightPremiumBasis: c.night_premium_basis ?? null,
                          }).join(', ')
                        : t('people.employee.contracts.premiumsInherited')}
                    </TD>
                    <TD>
                      {c.valid_to === null ? (
                        <Badge tone="green">
                          {t('people.employee.contracts.open')}
                        </Badge>
                      ) : (
                        <Badge tone="gray">
                          {t('people.employee.contracts.closed')}
                        </Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('people.employee.form.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('people.action.cancel')}
            </Button>
            <Button
              type="submit"
              form="contract-form"
              disabled={createContract.isPending}
            >
              {createContract.isPending
                ? t('people.action.saving')
                : t('people.action.create')}
            </Button>
          </>
        }
      >
        <form id="contract-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <p className="rounded-xl border border-brand-400/20 bg-brand-50 px-3 py-2 text-xs text-brand-800">
            {t('people.employee.form.versioningNote')}
          </p>
          <Select
            label={t('people.employee.form.employmentType')}
            value={form.employment_type}
            onChange={(e) =>
              setForm({
                ...form,
                employment_type: e.target.value as EmploymentType,
              })
            }
          >
            {(Object.keys(employmentTypeKeys) as EmploymentType[]).map((t) => (
              <option key={t} value={t}>
                {employmentTypeLabel(t)}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('people.employee.form.baseSalary')}
              type="number"
              step="0.01"
              min="0"
              value={form.base_annual_salary ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  base_annual_salary:
                    e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
            <Input
              label={t('people.employee.form.hourlyRate')}
              type="number"
              step="0.01"
              min="0"
              value={form.hourly_rate ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  hourly_rate:
                    e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('people.employee.form.minHours')}
              type="number"
              step="0.5"
              min="0"
              required
              value={form.min_hours_per_week}
              onChange={(e) =>
                setForm({
                  ...form,
                  min_hours_per_week: Number(e.target.value),
                })
              }
            />
            <Input
              label={t('people.employee.form.maxHours')}
              type="number"
              step="0.5"
              min="0"
              value={form.max_hours_per_week ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  max_hours_per_week:
                    e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </div>
          {/* The pact, entered as the percentage it is written as. Empty is
              NOT zero and the hint says so: on a part-time contract, hours
              above the agreement can only be required where a pact covers
              them (art. 12.5 ET), so leaving this blank is a statement about
              the contract rather than a blank field. */}
          <div className="grid grid-cols-2 gap-4">
            <div>
            <Input
              label={t('people.employee.form.complementaryPct')}
              type="number"
              step="1"
              min="0"
              max="60"
              value={
                form.complementary_pct == null
                  ? ''
                  : Math.round(form.complementary_pct * 100)
              }
              onChange={(e) =>
                setForm({
                  ...form,
                  complementary_pct:
                    e.target.value === '' ? null : Number(e.target.value) / 100,
                })
              }
            />
            <p className="mt-1 text-xs text-gray-500">
              {t('people.employee.form.complementaryPct.hint')}
            </p>
            </div>
          </div>
          {/* The person's own premiums. Folded away by default because most
              people are paid what the business pays; open when this contract
              already differs, so a figure that matters is never hidden. EMPTY
              MEANS INHERIT, and the placeholder says what that inherits --
              which is why 0 has to be typed: it is a different answer. */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02]">
            <button
              type="button"
              aria-expanded={premiumsOpen}
              onClick={() => setPremiumsOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
            >
              {t('people.employee.form.premiums')}
              <span className="text-gray-500">{premiumsOpen ? '−' : '+'}</span>
            </button>
            {premiumsOpen && (
              <div className="flex flex-col gap-3 border-t border-white/[0.08] px-3 py-3">
                <p className="text-xs text-gray-500">
                  {t('people.employee.form.premiums.hint')}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <Input
                    label={t('people.employee.form.premiums.night')}
                    type="number"
                    step="1"
                    min="0"
                    max="200"
                    placeholder={t('people.employee.form.premiums.inheritPct', {
                      value: business.nightDifferentialPct,
                    })}
                    value={form.night_premium_pct ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        night_premium_pct:
                          e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                  <Input
                    label={t('people.employee.form.premiums.weekend')}
                    type="number"
                    step="1"
                    min="0"
                    max="200"
                    placeholder={t('people.employee.form.premiums.inheritPct', {
                      value: business.weekendPremiumPct,
                    })}
                    value={form.weekend_premium_pct ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        weekend_premium_pct:
                          e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                  <Input
                    label={t('people.employee.form.premiums.overtime')}
                    type="number"
                    step="0.05"
                    min="1"
                    max="5"
                    placeholder={t('people.employee.form.premiums.inheritMult', {
                      value: business.overtimeMultiplier,
                    })}
                    value={form.overtime_multiplier ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        overtime_multiplier:
                          e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </div>
                {nightLow && (
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded"
                      checked={form.night_premium_basis === 'included_in_salary'}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          night_premium_basis: e.target.checked
                            ? 'included_in_salary'
                            : null,
                        })
                      }
                    />
                    {t('people.employee.form.premiums.includedInSalary')}
                  </label>
                )}
                {nightWarning && (
                  <p className="rounded-xl border border-amber-200/60 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {t('people.employee.form.premiums.belowFloor', {
                      pct: floor!,
                    })}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label={t('people.employee.form.paid')}
              value={form.pay_period}
              onChange={(e) =>
                setForm({ ...form, pay_period: e.target.value as PayPeriod })
              }
            >
              {(Object.keys(payPeriodKeys) as PayPeriod[]).map((p) => (
                <option key={p} value={p}>
                  {payPeriodLabel(p)}
                </option>
              ))}
            </Select>
            <Input
              label={t('people.employee.form.validFrom')}
              type="date"
              required
              value={form.valid_from}
              onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
            />
          </div>
          <p className="text-xs text-gray-500">
            {t('people.employee.form.payPeriodNote')}
          </p>
          {createContract.isError && (
            <p className="text-sm text-red-600">
              {getErrorMessage(createContract.error)}
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}

/**
 * The hours a person is contracted for, changed on their own file.
 *
 * The manual lever beside the calendar's: a brief can say "four on 40 and two
 * on 20", and this is how one of them becomes 30 without a new contract being
 * drawn up. It is deliberately NOT in the roster list -- every row there is a
 * link to this page, so the click that opened the box navigated away from it.
 *
 * Saved on blur or Enter, put back on Escape. The write goes straight to the
 * open contract and changes nothing else about it; a new contract, with a new
 * rate or a new type, is still the button at the top of the page.
 */
function WeeklyHours({
  employeeId,
  hours,
}: {
  employeeId: string;
  hours: number;
}) {
  const t = useT();
  const set = useSetBaseHours();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(hours);

  const commit = () => {
    if (draft === null) return;
    const value = Number(draft);
    setDraft(null);
    if (!Number.isFinite(value) || value <= 0 || value === hours) return;
    set.mutate({ employeeId, hours: value });
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <input
        type="number"
        inputMode="decimal"
        min={1}
        max={168}
        step={0.5}
        value={shown}
        aria-label={t('people.employee.hours.label')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(null);
        }}
        disabled={set.isPending}
        className={[
          FIELD_SKIN,
          fieldTone(set.isError),
          'w-24 rounded-lg px-2 py-1 text-right tabular-nums',
        ].join(' ')}
      />
      {set.isError && (
        <span className="text-xs font-normal text-red-300">
          {getErrorMessage(set.error)}
        </span>
      )}
    </span>
  );
}

// Decimal columns can arrive as strings; null stays null (it means inherit).
function numOrNull(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-gray-900">{children}</dd>
    </div>
  );
}
