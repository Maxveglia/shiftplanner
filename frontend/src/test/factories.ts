// Builders for the domain objects the tests need.
//
// Every factory starts from a plausible, WORKING default and takes overrides,
// so each test states only the one thing it is about. A test that spells out
// all fourteen fields of an EmployeeOut hides its own point: the reader cannot
// tell which of them is load-bearing. Here `employee({ employment_status:
// 'resigned' })` says exactly what the case is.
//
// The defaults are deliberately the boring, permissive case — an active
// hourly employee, hired long ago, on an open-ended contract — so anything a
// test asserts about a refusal comes from the override and nowhere else.

import type {
  AbsenceOut,
  AbsenceTypeOut,
  ContractOut,
  EmployeeOut,
  ShiftTemplateOut,
  TeamMemberSpec,
} from '../types';
import { DEFAULT_SPEC } from '../lib/schedule/spec';
import type { DayRef, SchedulingSpec } from '../lib/schedule/types';

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function contract(over: Partial<ContractOut> = {}): ContractOut {
  return {
    id: nextId('contract'),
    employee_id: 'emp',
    employment_type: 'non_exempt_hourly',
    base_annual_salary: null,
    hourly_rate: 20,
    min_hours_per_week: 0,
    max_hours_per_week: null,
    // No complementary-hours pact by default, which is what a contract this
    // product has never asked about actually has.
    complementary_pct: null,
    // Every premium inherited from the business, which is what a contract
    // written before per-person premiums existed has.
    night_premium_pct: null,
    weekend_premium_pct: null,
    overtime_multiplier: null,
    night_premium_basis: null,
    pay_period: 'weekly',
    valid_from: '2020-01-01',
    valid_to: null,
    created_at: '2020-01-01T00:00:00Z',
    ...over,
  };
}

export function employee(over: Partial<EmployeeOut> = {}): EmployeeOut {
  const id = over.id ?? nextId('emp');
  return {
    id,
    org_id: 'org',
    external_id: id.toUpperCase(),
    full_name: 'Ana Ruiz',
    email: null,
    employment_status: 'active',
    hire_date: '2020-01-01',
    // `current_contract` is spread AFTER this default, so a test asking for
    // `{ current_contract: null }` really does get a contract-less person —
    // which is the shape the reconcile bug produced in production.
    current_contract: contract({ employee_id: id }),
    created_at: '2020-01-01T00:00:00Z',
    ...over,
  };
}

export function template(over: Partial<ShiftTemplateOut> = {}): ShiftTemplateOut {
  return {
    id: nextId('tpl'),
    org_id: 'org',
    name: 'Day',
    // A template the manager wrote: no seed key, so its name is shown verbatim.
    // Pass { seed_key: 'night', name: 'Night' } to get one of ours.
    seed_key: null,
    start_time: '09:00',
    end_time: '17:00',
    unpaid_break_minutes: 30,
    color: '#2563EB',
    is_night: false,
    is_weekend_premium: false,
    ...over,
  };
}

export function absenceType(over: Partial<AbsenceTypeOut> = {}): AbsenceTypeOut {
  return {
    id: nextId('atype'),
    org_id: 'org',
    name: 'Vacation',
    code: 'VAC',
    is_paid: true,
    consumes_balance: true,
    requires_approval: true,
    is_health_data: false,
    ...over,
  };
}

export function absence(over: Partial<AbsenceOut> = {}): AbsenceOut {
  return {
    id: nextId('abs'),
    org_id: 'org',
    employee_id: 'emp',
    absence_type_id: 'atype',
    // Local wall-clock strings, never a `Z` suffix: `availability` compares
    // these against a day built in local time, so a UTC instant would move the
    // absence by the machine's offset and make the test depend on where it runs.
    start_at: '2026-03-10T00:00:00',
    end_at: '2026-03-10T23:59:00',
    status: 'approved',
    note: null,
    created_at: '2026-03-01T00:00:00Z',
    ...over,
  };
}

/** A team line as the intake extracts it. Nothing stated unless overridden. */
export function member(over: Partial<TeamMemberSpec> = {}): TeamMemberSpec {
  return {
    name: null,
    count: 1,
    employmentType: null,
    minHoursPerWeek: null,
    maxHoursPerWeek: null,
    hourlyRate: null,
    annualSalary: null,
    nightPremiumPct: null,
    weekendPremiumPct: null,
    overtimeMultiplier: null,
    nightIncludedInSalary: null,
    status: null,
    startsOn: null,
    ...over,
  };
}

export function spec(over: Partial<SchedulingSpec> = {}): SchedulingSpec {
  return {
    ...DEFAULT_SPEC,
    // Fresh arrays: DEFAULT_SPEC is a module constant and spreading it shares
    // them, so one test pushing a rule would leak into the next.
    openMin: 9 * 60,
    closeMin: 17 * 60,
    minStaff: 1,
    closedWeekdays: [],
    coverage: [],
    dayHours: [],
    closedDates: [],
    rules: [],
    ...over,
  };
}

/** `count` consecutive days from `startKey` (YYYY-MM-DD), weekday included. */
export function days(startKey: string, count: number): DayRef[] {
  const [y, m, d] = startKey.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const dt = new Date(y, m - 1, d + i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
      dt.getDate(),
    ).padStart(2, '0')}`;
    return { date: key, weekday: dt.getDay(), label: key };
  });
}

/** A single day, for the many rules that only need one to be evaluated. */
export function day(dateKey: string): DayRef {
  return days(dateKey, 1)[0];
}
