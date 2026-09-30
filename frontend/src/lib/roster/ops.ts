// Managing the TEAM by talking to it.
//
// The brief builds the roster the first time (see reconcile.ts). After that the
// manager keeps talking: "hire two more", "employee 3 is called Ana", "Marcus
// left". Those sentences come back from Claude as operations from the closed
// list below, and this module applies them through the same employee/contract
// API the Employees page uses — so the calendar, hours & pay and time-off all
// read the same people, whichever way they were created.
//
// Same discipline as the calendar refinements: the model emits an operation, it
// is validated here, and only then does anything get written.

import { api } from '../api';
import type {
  AbsenceTypeOut,
  ContractOut,
  EmployeeOut,
  EmploymentStatus,
  EmploymentType,
} from '../../types';
import { absenceBounds, toAbsenceKind, type AbsenceKind } from './absenceKind';
import { employmentStatusLabel, formatDate } from '../format';
import { translate } from '../i18n/core';
import { contractBody } from './apply';
import {
  carriedTerms,
  describePremiums,
  nextPlaceholderName,
  nightBasis,
  type ContractDraft,
} from './reconcile';

/** Terms a sentence can state. An unstated field stays null and is not touched. */
export interface TermsPatch {
  employmentType: EmploymentType | null;
  minHoursPerWeek: number | null;
  maxHoursPerWeek: number | null;
  hourlyRate: number | null;
  annualSalary: number | null;
  /**
   * This person's own premiums. Null = not said, so the contract's value
   * stands. 0 on a percentage is SAID: "a Juan no le pago la nocturnidad".
   */
  nightPremiumPct: number | null;
  weekendPremiumPct: number | null;
  overtimeMultiplier: number | null;
  /** True/false when the sentence says whether the night is in the salary. */
  nightIncludedInSalary: boolean | null;
  /**
   * "Juan cobra los pluses como todos": drop all three of his own figures and
   * the reason on file, so he inherits the business's again. A separate flag
   * because null already means "not said" and cannot also mean "inherit".
   */
  premiumsFollowBusiness: boolean;
}

export type RosterOp =
  /** Add people. `name` null = an unnamed headcount, created as placeholders. */
  | {
      op: 'add_employee';
      name: string | null;
      count: number;
      terms: TermsPatch;
      status: EmploymentStatus | null;
      startsOn: string | null;
    }
  /** Give a placeholder (or anyone) their real name. */
  | { op: 'rename_employee'; employee: string; name: string }
  /** Open a new contract version with the stated terms merged onto the current one. */
  | { op: 'set_employee_terms'; employee: string; terms: TermsPatch }
  /** Move someone between active / onboarding / on leave / resigned. */
  | { op: 'set_employee_status'; employee: string; status: EmploymentStatus }
  /**
   * Time off with a REASON, recorded against the person.
   *
   * The difference from the calendar's `day_off` is not the days it empties --
   * both empty the same days -- it is where the fact lives afterwards. A day
   * off is an instruction about this draft and dies with it; an absence is
   * something that happened to somebody, so it survives every rebuild, it is
   * there when the manager opens next month, and it carries whether those
   * hours are paid.
   *
   * `typeId` is resolved before this op is built (see `absenceKind.ts`), so by
   * the time it is applied the question of what kind of leave this is has an
   * answer -- from the sentence, or from the manager.
   */
  | {
      op: 'add_absence';
      employee: string;
      from: string;
      to: string;
      typeId: string;
      kind: AbsenceKind;
    }

export const ROSTER_OPS = [
  'add_employee',
  'rename_employee',
  'set_employee_terms',
  'set_employee_status',
  'add_absence',
] as const;

export function isRosterOp(op: unknown): boolean {
  return typeof op === 'string' && (ROSTER_OPS as readonly string[]).includes(op);
}

const VALID_TYPES: EmploymentType[] = [
  'exempt_salaried',
  'non_exempt_hourly',
  'non_exempt_salaried',
];
const VALID_STATUS: EmploymentStatus[] = [
  'active',
  'onboarding',
  'on_leave',
  'resigned',
];

/** Keep a positive number; drop zero, negatives and garbage to null. */
function pos(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Keep a number at or above zero; drop negatives and garbage to null.
 *
 * Not `pos`: a premium of 0 is the whole point of "no le pago la
 * nocturnidad", and reading it as unstated would leave Juan on the
 * business's 25% -- the sentence would appear to work and change nothing.
 */
function nonNeg(v: unknown): number | null {
  // Numbers and numeric strings only: `Number(false)` is 0, and a stray
  // boolean must not become "pays no night premium".
  if (typeof v !== 'number' && (typeof v !== 'string' || v.trim() === ''))
    return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function atMost(n: number | null, max: number): number | null {
  return n !== null && n <= max ? n : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function termsFrom(raw: Record<string, unknown>): TermsPatch {
  const t = raw.employment_type;
  const overtime = nonNeg(raw.overtime_multiplier);
  return {
    employmentType:
      typeof t === 'string' && (VALID_TYPES as string[]).includes(t)
        ? (t as EmploymentType)
        : null,
    minHoursPerWeek: pos(raw.min_hours_per_week),
    maxHoursPerWeek: pos(raw.max_hours_per_week),
    hourlyRate: pos(raw.hourly_rate),
    annualSalary: pos(raw.annual_salary),
    // Out of the server's range is dropped here rather than sent: a refused
    // contract loses the whole sentence, a dropped figure only itself.
    nightPremiumPct: atMost(nonNeg(raw.night_premium_pct), 200),
    weekendPremiumPct: atMost(nonNeg(raw.weekend_premium_pct), 200),
    // An extra hour is never paid under an ordinary one (art. 35.1 ET), and
    // the server refuses a multiplier below 1.
    overtimeMultiplier:
      overtime !== null && overtime >= 1 ? atMost(overtime, 5) : null,
    nightIncludedInSalary: bool(raw.night_included_in_salary),
    premiumsFollowBusiness: raw.premiums_follow_business === true,
  };
}

function statesTerms(t: TermsPatch): boolean {
  return (
    t.employmentType !== null ||
    t.minHoursPerWeek !== null ||
    t.maxHoursPerWeek !== null ||
    t.hourlyRate !== null ||
    t.annualSalary !== null ||
    t.nightPremiumPct !== null ||
    t.weekendPremiumPct !== null ||
    t.overtimeMultiplier !== null ||
    t.nightIncludedInSalary !== null ||
    t.premiumsFollowBusiness
  );
}

/**
 * Narrow one raw operation from the model into a RosterOp, or null when it is
 * missing what it needs. Same contract as toEditOp for the calendar ops.
 */
export function toRosterOp(raw: Record<string, unknown>): RosterOp | null {
  const op = String(raw.op ?? '');
  const str = (k: string) => {
    const v = raw[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };

  switch (op) {
    case 'add_employee': {
      const rawCount = pos(raw.count) ?? 1;
      const name = str('name') ?? null;
      const status = str('status');
      return {
        op,
        name,
        // A named person is one row; only an unnamed headcount can be > 1.
        count: name ? 1 : Math.max(1, Math.min(Math.round(rawCount), 50)),
        terms: termsFrom(raw),
        status:
          status && (VALID_STATUS as string[]).includes(status)
            ? (status as EmploymentStatus)
            : null,
        startsOn: /^\d{4}-\d{2}-\d{2}$/.test(str('starts_on') ?? '')
          ? str('starts_on')!
          : null,
      };
    }
    case 'rename_employee':
      return str('employee') && str('name')
        ? { op, employee: str('employee')!, name: str('name')! }
        : null;
    case 'set_employee_terms': {
      const terms = termsFrom(raw);
      return str('employee') && statesTerms(terms)
        ? { op, employee: str('employee')!, terms }
        : null;
    }
    case 'set_employee_status': {
      const status = str('status');
      return str('employee') && status && (VALID_STATUS as string[]).includes(status)
        ? { op, employee: str('employee')!, status: status as EmploymentStatus }
        : null;
    }
    // Not buildable here, and deliberately: an absence needs the org's own
    // absence type, which this function has never been given and must not
    // guess. `toAbsenceRequest` reads it instead, and the caller settles the
    // kind -- from the sentence or from the manager -- before there is an
    // operation to apply.
    case 'add_absence':
      return null;
    default:
      return null;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An add_absence as the model stated it, before the kind of leave is settled.
 *
 * Separate from `toRosterOp` because it is missing the one thing that makes it
 * writable. Everything else about the request is known here -- who, and which
 * days -- so the manager is asked one question about one thing, with the rest
 * already read.
 */
export interface AbsenceRequest {
  employee: string;
  /** First day off, "YYYY-MM-DD". */
  from: string;
  /** Last day off, included. Equal to `from` for a single day. */
  to: string;
  kind: AbsenceKind;
}

/**
 * Read an absence out of a raw operation, or null when it says too little.
 *
 * NOT clipped to the calendar on screen. An absence is something that happened
 * to a person, not an edit to this draft: a manager who says in September that
 * Ana is away in December is telling us a fact, and dropping it because
 * December is not on screen would lose it silently.
 */
export function toAbsenceRequest(raw: Record<string, unknown>): AbsenceRequest | null {
  if (String(raw.op ?? '') !== 'add_absence') return null;
  const str = (k: string) => {
    const v = raw[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const employee = str('employee');
  const from = str('date');
  if (!employee || !from || !ISO_DATE.test(from)) return null;
  const rawTo = str('date_to');
  const to = rawTo && ISO_DATE.test(rawTo) ? rawTo : from;
  // Said backwards, read as meant -- the same rule the calendar ranges follow.
  return {
    employee,
    from: to < from ? to : from,
    to: to < from ? from : to,
    kind: toAbsenceKind(raw.absence_kind),
  };
}

/**
 * The writable operation, once the kind of leave has an answer.
 *
 * The only place a `RosterOp` of this kind is built, from either source — the
 * sentence that settled it, or the manager who was asked. One constructor
 * means the two paths cannot drift into recording the same absence
 * differently.
 */
export function absenceOp(
  request: AbsenceRequest,
  type: AbsenceTypeOut,
): RosterOp {
  return {
    op: 'add_absence',
    employee: request.employee,
    from: request.from,
    to: request.to,
    typeId: type.id,
    kind: request.kind,
  };
}

/**
 * Resolve a reference to someone on the roster.
 *
 * Deliberately more forgiving than an exact match: dictation mangles names, and
 * "#3" / "employee 3" is how a manager refers to a placeholder they have not
 * named yet. Returns null when nothing matches, so the caller can say so
 * instead of editing the wrong person.
 */
function resolve(ref: string, roster: EmployeeOut[]): EmployeeOut | null {
  const q = ref.trim().toLowerCase();
  if (!q) return null;
  const byNumber = /^(?:#|employee\s+|empleado\s+)?(\d+)$/.exec(q);
  if (byNumber) {
    const n = parseInt(byNumber[1], 10);
    const hit = roster.find((e) => (e.display_number ?? 0) === n);
    if (hit) return hit;
  }
  return (
    roster.find((e) => e.full_name.toLowerCase() === q) ??
    roster.find((e) => e.external_id.toLowerCase() === q) ??
    roster.find((e) => e.full_name.toLowerCase().startsWith(q)) ??
    roster.find((e) => e.full_name.toLowerCase().includes(q)) ??
    null
  );
}

/**
 * The terms to write: what the sentence states, over what the contract says.
 *
 * Exported for the tests: the fields a sentence does NOT mention are the ones
 * that went missing before, and only this function can prove they survive.
 */
export function mergeTerms(
  current: ContractOut | null,
  patch: TermsPatch,
): ContractDraft {
  const employmentType =
    patch.employmentType ??
    current?.employment_type ??
    (patch.annualSalary !== null ? 'exempt_salaried' : 'non_exempt_hourly');
  const minHoursPerWeek =
    patch.minHoursPerWeek ??
    (current ? Number(current.min_hours_per_week) : employmentType === 'exempt_salaried' ? 40 : 0);
  const carried = carriedTerms(current);
  const premiums = patch.premiumsFollowBusiness
    ? {
        nightPremiumPct: null,
        weekendPremiumPct: null,
        overtimeMultiplier: null,
        nightPremiumBasis: null,
      }
    : {
        nightPremiumPct: patch.nightPremiumPct ?? carried.nightPremiumPct,
        weekendPremiumPct: patch.weekendPremiumPct ?? carried.weekendPremiumPct,
        overtimeMultiplier: patch.overtimeMultiplier ?? carried.overtimeMultiplier,
        nightPremiumBasis: nightBasis(
          patch.nightIncludedInSalary,
          carried.nightPremiumBasis,
        ),
      };
  return {
    employmentType,
    minHoursPerWeek,
    maxHoursPerWeek: patch.maxHoursPerWeek ?? current?.max_hours_per_week ?? null,
    hourlyRate: patch.hourlyRate ?? current?.hourly_rate ?? null,
    annualSalary: patch.annualSalary ?? current?.base_annual_salary ?? null,
    complementaryPct: carried.complementaryPct,
    payPeriod: carried.payPeriod,
    ...premiums,
  };
}

/**
 * What a sentence said about the person's premiums, in the manager's words.
 *
 * The confirmation line is the only place the manager sees how "no le pago la
 * nocturnidad" was understood, so it names the premium rather than saying
 * "terms updated" -- a misread 0 has to be visible before payroll is.
 */
export function describePremiumPatch(patch: TermsPatch): string[] {
  if (patch.premiumsFollowBusiness)
    return [translate('roster.plan.terms.premiumsFollowBusiness')];
  return describePremiums({
    nightPremiumPct: patch.nightPremiumPct,
    weekendPremiumPct: patch.weekendPremiumPct,
    overtimeMultiplier: patch.overtimeMultiplier,
    nightPremiumBasis: patch.nightIncludedInSalary ? 'included_in_salary' : null,
  });
}

/** Operation name -> dictionary key, for the "could not save" line. */
const OP_LABEL_KEYS: Record<RosterOp['op'], string> = {
  add_employee: 'roster.ops.op.addEmployee',
  rename_employee: 'roster.ops.op.renameEmployee',
  set_employee_terms: 'roster.ops.op.setEmployeeTerms',
  set_employee_status: 'roster.ops.op.setEmployeeStatus',
  add_absence: 'roster.ops.op.addAbsence',
};

export interface RosterOutcome {
  applied: string[];
  skipped: string[];
  /** True when anything was written, so the caller knows to refetch and rebuild. */
  changed: boolean;
}

/**
 * Write the operations, in order, against the live roster.
 *
 * `roster` is mutated locally as we go — a person added by operation 1 has to be
 * findable by operation 2 ("hire Ana, she works part-time") without a round trip
 * through the query cache.
 */
export async function applyRosterOps(
  ops: RosterOp[],
  roster: EmployeeOut[],
  today: string,
): Promise<RosterOutcome> {
  const applied: string[] = [];
  const skipped: string[] = [];
  // A working copy so later operations see earlier ones.
  const live = [...roster];
  let changed = false;

  for (const op of ops) {
    try {
      switch (op.op) {
        case 'add_employee': {
          for (let i = 0; i < op.count; i += 1) {
            const name = op.name ?? nextPlaceholderName(live);
            const hireDate = op.startsOn ?? today;
            const status: EmploymentStatus =
              op.status ?? (hireDate > today ? 'onboarding' : 'active');
            const { data: emp } = await api.post<EmployeeOut>('/employees', {
              external_id: null,
              full_name: name,
              email: null,
              employment_status: status,
              hire_date: hireDate,
            });
            // Always, even when the sentence states no terms. `availability()`
            // refuses anyone without a contract on every day, so "add Ana"
            // used to put someone on the roster who could never be given a
            // shift -- and the calendar just came back without her, saying
            // nothing. mergeTerms over an empty patch is the weakest contract
            // that can be true: hourly, no weekly minimum, no rate.
            await api.post(
              `/employees/${emp.id}/contracts`,
              contractBody(mergeTerms(null, op.terms), hireDate),
            );
            live.push(emp);
            applied.push(translate('roster.ops.added', { name }));
            changed = true;
          }
          break;
        }

        case 'rename_employee': {
          const emp = resolve(op.employee, live);
          if (!emp) {
            skipped.push(
              translate('roster.ops.noMatch', { ref: op.employee }),
            );
            break;
          }
          await api.patch(`/employees/${emp.id}`, { full_name: op.name });
          applied.push(
            translate('roster.ops.renamed', {
              from: emp.full_name,
              to: op.name,
            }),
          );
          emp.full_name = op.name;
          changed = true;
          break;
        }

        case 'set_employee_terms': {
          const emp = resolve(op.employee, live);
          if (!emp) {
            skipped.push(
              translate('roster.ops.noMatch', { ref: op.employee }),
            );
            break;
          }
          // A new version valid from today: history is never rewritten.
          await api.post(
            `/employees/${emp.id}/contracts`,
            contractBody(mergeTerms(emp.current_contract, op.terms), today),
          );
          const premiums = describePremiumPatch(op.terms);
          applied.push(
            premiums.length
              ? translate('roster.ops.termsUpdatedWith', {
                  name: emp.full_name,
                  terms: premiums.join(', '),
                })
              : translate('roster.ops.termsUpdated', { name: emp.full_name }),
          );
          changed = true;
          break;
        }

        case 'set_employee_status': {
          const emp = resolve(op.employee, live);
          if (!emp) {
            skipped.push(
              translate('roster.ops.noMatch', { ref: op.employee }),
            );
            break;
          }
          if (emp.employment_status === op.status) {
            skipped.push(
              translate('roster.ops.statusAlready', {
                name: emp.full_name,
                status: employmentStatusLabel(op.status),
              }),
            );
            break;
          }
          await api.patch(`/employees/${emp.id}`, { employment_status: op.status });
          applied.push(
            translate('roster.ops.statusChanged', {
              name: emp.full_name,
              status: employmentStatusLabel(op.status),
            }),
          );
          emp.employment_status = op.status;
          changed = true;
          break;
        }

        case 'add_absence': {
          const emp = resolve(op.employee, live);
          if (!emp) {
            skipped.push(
              translate('roster.ops.noMatch', { ref: op.employee }),
            );
            break;
          }
          const [startAt, endAt] = absenceBounds(op.from, op.to);
          const { data: absence } = await api.post<{ id: string }>('/absences', {
            employee_id: emp.id,
            absence_type_id: op.typeId,
            start_at: startAt,
            end_at: endAt,
            note: null,
          });
          // CREATED AND APPROVED IN ONE GESTURE. A manager saying "Juanito is
          // ill that week" is not requesting time off, they are telling us
          // what happened -- and only an APPROVED absence keeps somebody off
          // the rota (`availability()` treats a requested one as a warning).
          // Left at "requested" the sentence would appear to work, the row
          // would be in Time off, and Juanito would still be on the calendar.
          //
          // Approving is also what posts the holiday-balance movement, so a
          // week of vacation comes off the balance exactly as it does when the
          // manager approves it by hand on the Time off page.
          await api.post(`/absences/${absence.id}/approve`);
          applied.push(
            translate(
              op.from === op.to
                ? 'roster.ops.absenceAdded.one'
                : 'roster.ops.absenceAdded.range',
              {
                name: emp.full_name,
                from: formatDate(op.from),
                to: formatDate(op.to),
              },
            ),
          );
          changed = true;
          break;
        }
      }
    } catch {
      // One rejected write must not abandon the rest of the sentence.
      skipped.push(
        translate('roster.ops.saveFailed', {
          op: translate(OP_LABEL_KEYS[op.op]),
        }),
      );
    }
  }

  return { applied, skipped, changed };
}
