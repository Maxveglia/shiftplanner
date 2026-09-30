// Can this person work this day, and under what limits?
//
// SINGLE SOURCE OF TRUTH: the generator calls this to DECIDE, and the grid
// calls it to EXPLAIN. They can never disagree, so whenever the schedule
// leaves someone out the manager sees exactly the same reason the AI used.
//
// Everything here is read from what is recorded on the employee: status,
// hire date, contract validity window, contracted hours, and absences.

import { APP_LOCALE } from '../locale';
import { translate } from '../i18n/core';
import { absenceTypeLabel, employmentStatusLabel } from '../format';
import type { AbsenceOut, AbsenceTypeOut, EmployeeOut } from '../../types';

export type Availability =
  | {
      ok: true;
      /** Hard cap on hours for this day (onboarding ramp-up), else null. */
      maxHoursToday: number | null;
      /** Onboarding staff are kept off night shifts. */
      nightsAllowed: boolean;
      /** Soft warning shown on the row, e.g. a pending time-off request. */
      note: string | null;
      /**
       * Whether that warning is a time-off request awaiting approval.
       *
       * The generator penalises those days so it schedules around a holiday
       * somebody has asked for but nobody has answered yet. It used to detect
       * them with `note.includes('requested')` -- reading a sentence written
       * for a human. Translated into Spanish that test stopped matching and the
       * penalty vanished with no error: the same team, the same week, a
       * different calendar depending on the interface language.
       */
      pendingAbsence: boolean;
    }
  | {
      ok: false;
      /**
       * WHY they cannot work, as a value rather than as a sentence.
       *
       * The grid used to pick the colour of the "unavailable" block by reading
       * `reason` and matching it against English text ("Resigned",
       * anything starting with "Contract"). That worked exactly until the
       * product was translated, and then failed silently -- every block amber,
       * no error anywhere. The reason is for the human; this is for the code,
       * and the two can now be translated independently.
       */
      kind: BlockedKind;
      reason: string;
    };

/**
 * Administrative (`resigned`, `not_started`, `contract`) reads as settled fact;
 * `on_leave` and `absence` are this-day-only and read as a warning.
 */
export type BlockedKind =
  | 'resigned'
  | 'on_leave'
  | 'not_started'
  | 'contract'
  | 'absence';

/** Onboarding employees ramp up: shorter days, no nights, never alone at night. */
export const ONBOARDING_MAX_HOURS = 6;

function dayBounds(dateKey: string): [Date, Date] {
  const [y, m, d] = dateKey.split('-').map(Number);
  return [new Date(y, m - 1, d, 0, 0, 0), new Date(y, m - 1, d, 23, 59, 59)];
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function fmt(value: string): string {
  const d = parseDate(value);
  return d
    ? d.toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric' })
    : value;
}

export function availability(
  employee: EmployeeOut,
  absences: AbsenceOut[],
  absenceTypes: AbsenceTypeOut[],
  dateKey: string,
): Availability {
  const [dayStart, dayEnd] = dayBounds(dateKey);

  // 1. Employment status recorded on the employee.
  if (employee.employment_status === 'resigned') {
    return { ok: false, kind: 'resigned', reason: employmentStatusLabel('resigned') };
  }
  if (employee.employment_status === 'on_leave') {
    return { ok: false, kind: 'on_leave', reason: employmentStatusLabel('on_leave') };
  }

  // 2. Not yet started.
  const hire = parseDate(employee.hire_date);
  if (hire && hire > dayEnd) {
    return {
      ok: false,
      kind: 'not_started',
      reason: translate('roster.availability.startsOn', {
        date: fmt(employee.hire_date),
      }),
    };
  }

  // 3. Contract must exist and cover this day (contract duration).
  const contract = employee.current_contract;
  if (!contract) {
    return {
      ok: false,
      kind: 'contract',
      reason: translate('roster.availability.noContract'),
    };
  }
  const from = parseDate(contract.valid_from);
  if (from && from > dayEnd) {
    return {
      ok: false,
      kind: 'contract',
      reason: translate('roster.availability.contractStarts', {
        date: fmt(contract.valid_from),
      }),
    };
  }
  if (contract.valid_to) {
    const to = parseDate(contract.valid_to);
    if (to && to < dayStart) {
      return {
        ok: false,
        kind: 'contract',
        reason: translate('roster.availability.contractEnded', {
          date: fmt(contract.valid_to),
        }),
      };
    }
  }

  // 4. Absences. Approved blocks outright; requested is only a warning, so a
  //    pending holiday request does not silently vanish from the manager's view.
  const typeName = (id: string) => {
    const type = absenceTypes.find((t) => t.id === id);
    // The reason is shown to the manager, so a type we seeded reads in his
    // language and one he created reads in his own words.
    return type ? absenceTypeLabel(type) : translate('roster.availability.timeOff');
  };
  let pending: string | null = null;
  for (const a of absences) {
    if (a.employee_id !== employee.id) continue;
    if (a.status !== 'approved' && a.status !== 'requested') continue;
    if (new Date(a.start_at) > dayEnd || new Date(a.end_at) < dayStart) continue;
    if (a.status === 'approved') {
      return { ok: false, kind: 'absence', reason: typeName(a.absence_type_id) };
    }
    pending = translate('roster.availability.requested', {
      type: typeName(a.absence_type_id),
    });
  }

  // 5. Onboarding ramp-up.
  const onboarding = employee.employment_status === 'onboarding';
  return {
    ok: true,
    maxHoursToday: onboarding ? ONBOARDING_MAX_HOURS : null,
    nightsAllowed: !onboarding,
    note: pending ?? (onboarding ? employmentStatusLabel('onboarding') : null),
    pendingAbsence: pending !== null,
  };
}

/** Contracted weekly minimum, or 0 when the contract does not set one. */
export function contractedMinHours(employee: EmployeeOut): number {
  const min = employee.current_contract?.min_hours_per_week;
  return min == null ? 0 : Number(min);
}
