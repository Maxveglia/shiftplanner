import { APP_CURRENCY, APP_LOCALE, APP_TIME_FORMAT } from './locale';
import { translate } from './i18n/core';
import type {
  AbsenceStatus,
  AbsenceTypeOut,
  EmploymentStatus,
  EmploymentType,
  MovementType,
  Plan,
  ShiftTemplateOut,
  SubscriptionStatus,
} from '../types';

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  // Accept both YYYY-MM-DD and ISO datetimes.
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(APP_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(APP_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * An amount in the product's currency (APP_CURRENCY), written the way the
 * chosen language writes one: "€1,250.50" in English, "1250,50 €" in Spanish.
 * To the cent, or in whole units with `whole` -- a month's payroll, where the
 * cents are noise -- rounded, not cut.
 */
export function formatMoney(
  value: number | null | undefined,
  { whole = false }: { whole?: boolean } = {},
): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(APP_LOCALE, {
    style: 'currency',
    currency: APP_CURRENCY,
    // The bare symbol, never a country prefix ("US$", as es-ES wrote the
    // dollar): the product prices in one currency, so it is noise on every
    // amount.
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: whole ? 0 : undefined,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(value);
}

/**
 * Minutes from midnight as the VALUE of an `<input type="time">`, e.g. 1380 ->
 * "23:00". Zero-padded 24-hour, always, in every language.
 *
 * Not a thing to show a person. The time input only accepts "HH:MM" -- hand it
 * anything else and the browser silently shows an empty box -- so this is a
 * machine format that happens to be readable, and it is named for the input it
 * feeds. `formatTime` is the one for a sentence or a label.
 */
export function formatClockValue(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Minutes from midnight as a person reads a clock in their language: "5:00 PM"
 * in English, "17:00" in Spanish.
 *
 * THE BUG THIS FIXES. The calendar grid has always written English times with
 * AM and PM, and so has the brief the interview composes -- the dictionary is
 * built for exactly that ("1p" in English, "13" in Spanish). Everything that
 * went through the old `formatClock` did not: the change summary, the assumed
 * and declared rules, and the whole employee app. One shift therefore read
 * "5:00 PM" in the calendar and "17:00 – 01:00" in the list underneath it, in
 * the same language, on the same screen. A clock is a convention of the
 * language, like a month name, so there is one function for it and the locale
 * decides.
 *
 * Minutes past midnight fold back into the day, and whether a range crosses
 * into the next one is the caller's to say (see `formatShiftRange`), because
 * only the caller knows there was a range.
 */
export function formatTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const d = new Date(2000, 0, 1, Math.floor(m / 60), m % 60);
  return d.toLocaleTimeString(APP_LOCALE, APP_TIME_FORMAT);
}

/**
 * A number written the way the chosen language writes one: "37.5" in English,
 * "37,5" in Spanish.
 *
 * Here because the decimal mark was a literal comma in three places -- the
 * hours column of the interview's roster table, its placeholder, and the
 * sentence that table composes -- so an English manager picked a 37.5-hour
 * contract, was shown "37,5 h", and then watched the assistant repeat it back
 * as something they had said. A separator belongs to the language, not to the
 * number, which makes it the same kind of thing as a month name.
 *
 * No grouping separator: these are hours and contract lengths, never amounts
 * big enough to need one, and adding it would rewrite "1200h" on screens that
 * have always said that.
 */
export function formatDecimal(value: number): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value);
}

/** "8h" when whole, "7.5h" otherwise -- "7,5h" in Spanish. Never "7.50h". */
export function formatHours(value: number): string {
  return `${formatDecimal(Math.round(value * 10) / 10)}h`;
}

/**
 * A shift's span. An overnight shift is marked so nobody reads "22:00 – 06:00"
 * as a six-hour morning.
 */
export function formatShiftRange(startMin: number, endMin: number): string {
  const overnight = endMin > 1440;
  return `${formatTime(startMin)} – ${formatTime(endMin)}${overnight ? ' +1' : ''}`;
}

/**
 * Exact hourly amount, stated to the cent: "30,00 €" ("€30.00" in English),
 * even when whole. Never a multiplier.
 */
export function formatRate(value: number): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: 'currency',
    currency: APP_CURRENCY,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// ---- Enum labels ----------------------------------------------------------
//
// Two exports per enum, and the pair matters:
//
//   *Keys   the wire value -> dictionary key map. Iterate this when you need
//           every option of an enum (a filter dropdown, a status picker).
//   *Label  the value -> written word function. Call this to show one.
//
// They used to be one `Record<Status, string>` of English words. Splitting them
// is what lets a <select> list every status AND have every option translated,
// without the caller knowing there is a dictionary underneath.

export const employmentStatusKeys: Record<EmploymentStatus, string> = {
  active: 'labels.employmentStatus.active',
  onboarding: 'labels.employmentStatus.onboarding',
  on_leave: 'labels.employmentStatus.on_leave',
  resigned: 'labels.employmentStatus.resigned',
};

export const employmentStatusLabel = (v: EmploymentStatus): string =>
  translate(employmentStatusKeys[v] ?? v);

export const employmentTypeKeys: Record<EmploymentType, string> = {
  exempt_salaried: 'labels.employmentType.exempt_salaried',
  non_exempt_hourly: 'labels.employmentType.non_exempt_hourly',
  non_exempt_salaried: 'labels.employmentType.non_exempt_salaried',
};

export const employmentTypeLabel = (v: EmploymentType): string =>
  translate(employmentTypeKeys[v] ?? v);

export const absenceStatusKeys: Record<AbsenceStatus, string> = {
  requested: 'labels.absenceStatus.requested',
  approved: 'labels.absenceStatus.approved',
  rejected: 'labels.absenceStatus.rejected',
  cancelled: 'labels.absenceStatus.cancelled',
};

export const absenceStatusLabel = (v: AbsenceStatus): string =>
  translate(absenceStatusKeys[v] ?? v);

export const movementTypeKeys: Record<MovementType, string> = {
  accrual: 'labels.movementType.accrual',
  consumption: 'labels.movementType.consumption',
  adjustment: 'labels.movementType.adjustment',
  carryover: 'labels.movementType.carryover',
  expiration: 'labels.movementType.expiration',
};

export const movementTypeLabel = (v: MovementType): string =>
  translate(movementTypeKeys[v] ?? v);

// ---- Seeded rows ----------------------------------------------------------
//
// Absence types and shift templates are ROWS, not enums: a manager adds them,
// renames them and deletes them, and what he writes is his own words -- shown
// back exactly as typed, in every language, forever.
//
// But every org is created with a handful of rows WE seed, and those were plain
// English literals in the database. So a Spanish calendar showed "Evening" and
// "Night" from a seeded template beside "Tarde-noche" and "Noche" from a
// synthesised shift: the same hours, written in two languages, on one screen.
//
// The fix is the enum pattern above. The row carries a stable code the server
// never translates -- `code` for absence types, `seed_key` for shift templates
// -- and the dictionary turns that code into a word. No code, no translation:
// the row's own `name` is the answer, which is what a customer's row always is.
//
// THE NAME CHECK, and why it is not the antipattern it looks like.
//
// A seeded row is only translated while its name is still the exact literal
// `backend/app/services/seeding.py` wrote. Once a manager renames "Vacation" to
// "Días de playa" he has said what it should be called, and his word beats our
// dictionary -- so the row goes back to being shown verbatim.
//
// That comparison is against a BACKEND CONSTANT that is never translated and
// never localised: it asks "is this row still untouched since we created it?",
// which happens to be answerable by looking at the name. It is NOT a branch on
// visible text -- nothing here reads what the user currently sees to decide
// anything, and the moment a row stops matching we stop deciding and just print
// it.

interface Seeded {
  /** Exactly what the backend seeder wrote. Never shown, never translated. */
  seededName: string;
  key: string;
}

const seededAbsenceTypes: Record<string, Seeded> = {
  VAC: { seededName: 'Vacation', key: 'labels.absenceType.VAC' },
  PERS: { seededName: 'Personal', key: 'labels.absenceType.PERS' },
  SICK: { seededName: 'Sick', key: 'labels.absenceType.SICK' },
  UNPAID: { seededName: 'Unpaid', key: 'labels.absenceType.UNPAID' },
};

const seededShiftTemplates: Record<string, Seeded> = {
  morning: { seededName: 'Morning', key: 'labels.shiftTemplate.morning' },
  evening: { seededName: 'Evening', key: 'labels.shiftTemplate.evening' },
  night: { seededName: 'Night', key: 'labels.shiftTemplate.night' },
};

function seededLabel(
  table: Record<string, Seeded>,
  code: string | null | undefined,
  name: string,
): string {
  const seeded = code ? table[code] : undefined;
  return seeded && seeded.seededName === name ? translate(seeded.key) : name;
}

/** The name of an absence type, in the manager's language when it is one of ours. */
export const absenceTypeLabel = (
  type: Pick<AbsenceTypeOut, 'code' | 'name'>,
): string => seededLabel(seededAbsenceTypes, type.code, type.name);

/** The name of a shift template, in the manager's language when it is one of ours. */
export const shiftTemplateLabel = (
  template: Pick<ShiftTemplateOut, 'seed_key' | 'name'>,
): string => seededLabel(seededShiftTemplates, template.seed_key, template.name);

/**
 * Why a day appeared on somebody's holiday ledger.
 *
 * Mostly the manager's own words, typed into an adjustment. One line is ours:
 * approving a request writes "Absence approved" into the row, in English, from
 * `backend/app/services/absences.py`.
 *
 * So this is the seeded-row rule again -- is this still exactly the sentence we
 * wrote? -- with the literal doing the job the `code` does for an absence type,
 * because a ledger row has no code. The moment it does not match, it is a
 * person's own words and goes on screen untouched.
 */
const SEEDED_LEDGER_REASONS: Record<string, string> = {
  'Absence approved': 'labels.ledgerReason.absenceApproved',
};

export const ledgerReasonLabel = (reason: string | null | undefined): string => {
  if (!reason) return '';
  const key = SEEDED_LEDGER_REASONS[reason.trim()];
  return key ? translate(key) : reason;
};

// ---- Verticals ------------------------------------------------------------
//
// The industries a business can say it is. A closed list on the server, whose
// labels there are English constants -- so this is the enum pattern above and
// not the seeded-row one: the CODE is the identity and the word comes from the
// dictionary, always, because no manager ever renamed "Bar / pub".
//
// A code the dictionary does not carry falls back to the server's own label
// rather than to the raw code. Adding a vertical in Python must not put
// `labels.vertical.foodtruck` on somebody's screen while the dictionary catches
// up; an English word among Spanish ones is a smaller wrong than a key.

const verticalKeys: Record<string, string> = {
  bar: 'labels.vertical.bar',
  restaurant: 'labels.vertical.restaurant',
  cafe: 'labels.vertical.cafe',
  retail: 'labels.vertical.retail',
  grocery: 'labels.vertical.grocery',
  clinic: 'labels.vertical.clinic',
  hotel: 'labels.vertical.hotel',
  gym: 'labels.vertical.gym',
  office: 'labels.vertical.office',
  other: 'labels.vertical.other',
};

export const verticalLabel = (vertical: { code: string; label: string }): string => {
  const key = verticalKeys[vertical.code];
  return key ? translate(key) : vertical.label;
};

// ---- Labour rules ---------------------------------------------------------
//
// Global reference data: three bodies of rules, twenty-one rules between them,
// the same for every customer. Every word of it that a manager reads comes from
// the dictionary (lib/i18n/messages/labour), keyed by the codes the server
// sends -- the enum pattern again, and for the third time the server's own
// string is the fallback for a code this bundle has never seen.
//
// Worth saying plainly because the content is unusual: this is Spanish labour
// law, and it was being explained to Spanish businesses in English.

/** The name of a body of rules: "Cataluña — hostelería (convenio 2025-2028)". */
export const jurisdictionLabel = (
  profile: { jurisdiction_code: string; name: string },
): string => {
  const key = `labels.jurisdiction.${profile.jurisdiction_code}`;
  const text = translate(key);
  return text === key ? profile.name : text;
};

/** What a rule is about, in three or four words: "descanso entre turnos". */
export const ruleTypeLabel = (ruleType: string): string => {
  const key = `labels.ruleType.${ruleType}`;
  const text = translate(key);
  // The raw code with its underscores opened out. Readable, in a fashion, and
  // it was what every language saw until now.
  return text === key ? ruleType.replace(/_/g, ' ') : text;
};

/**
 * The unit a threshold is counted in, ready to sit after the figure.
 *
 * "n/a" is a rule that states a prohibition rather than a number -- night
 * workers may not work overtime -- and it has no unit to write. Empty rather
 * than "n/a", which is not a unit and not a word either.
 */
export const ruleUnitLabel = (unit: string): string => {
  if (!unit || unit === 'n/a') return '';
  const key = `labels.ruleUnit.${unit}`;
  const text = translate(key);
  return text === key ? unit : text;
};

/**
 * Why a rule says what it says: the article it comes from and what it means
 * for a rota. Null when neither the dictionary nor the server has one.
 */
export const laborNote = (
  jurisdictionCode: string,
  rule: { rule_type: string; notes?: string | null },
): string | null => {
  const key = `labels.laborNote.${jurisdictionCode}.${rule.rule_type}`;
  const text = translate(key);
  return text === key ? rule.notes?.trim() || null : text;
};

/**
 * What a business of this kind typically does, offered for the manager to
 * accept or ignore. Named by its key, the same enum pattern as a vertical.
 *
 * Each key is unique across all the verticals, which is a rule the server has
 * to keep for this to work: two different sentences filed under one key is one
 * of them lost. A key the dictionary does not carry falls back to the server's
 * English, for the reason given above.
 */
export const suggestionLabel = (s: { key: string; label: string }): string => {
  const key = `labels.suggestion.${s.key}`;
  const text = translate(key);
  return text === key ? s.label : text;
};

// ---- Back office ----------------------------------------------------------

export const planKeys: Record<Plan, string> = {
  trial: 'labels.plan.trial',
  starter: 'labels.plan.starter',
  growth: 'labels.plan.growth',
  scale: 'labels.plan.scale',
};

export const planLabel = (v: Plan): string => translate(planKeys[v] ?? v);

export const subscriptionStatusKeys: Record<SubscriptionStatus, string> = {
  trialing: 'labels.subscriptionStatus.trialing',
  active: 'labels.subscriptionStatus.active',
  past_due: 'labels.subscriptionStatus.past_due',
  canceled: 'labels.subscriptionStatus.canceled',
};

export const subscriptionStatusLabel = (v: SubscriptionStatus): string =>
  translate(subscriptionStatusKeys[v] ?? v);

export const subscriptionStatusTone: Record<
  SubscriptionStatus,
  'green' | 'blue' | 'amber' | 'gray'
> = {
  trialing: 'blue',
  active: 'green',
  past_due: 'amber',
  canceled: 'gray',
};
