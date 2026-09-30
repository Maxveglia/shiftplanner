// Natural-language intake -> structured scheduling spec.
//
// ARCHITECTURE NOTE: this is the *deterministic* stand-in for Phase 7, where
// Claude compiles the manager's prompt into the same closed JSON schema. The
// contract is identical either way: text in -> validated rules out -> the
// manager confirms -> the generator runs. The model never assigns shifts
// itself; it only fills in this spec.

import type { ManagerRule, SchedulingSpec } from './types';
import { translate, type Vars } from '../i18n/core';
import { formatTime } from '../format';
import { APP_LOCALE } from '../locale';

export const DEFAULT_SPEC: SchedulingSpec = {
  openMin: 8 * 60,
  closeMin: 22 * 60,
  minStaff: 2,
  peak: null,
  closedWeekdays: [],
  maxHoursPerWeek: 40,
  minRestHours: 11,
  coverage: [],
  dayHours: [],
  closedDates: [],
  shiftLengthHours: null,
  rules: [],
};

const WEEKDAYS: Record<string, number> = {
  domingo: 0, domingos: 0, sunday: 0, sundays: 0,
  lunes: 1, monday: 1, mondays: 1,
  martes: 2, tuesday: 2, tuesdays: 2,
  miercoles: 3, 'miércoles': 3, wednesday: 3, wednesdays: 3,
  jueves: 4, thursday: 4, thursdays: 4,
  viernes: 5, friday: 5, fridays: 5,
  sabado: 6, 'sábado': 6, sabados: 6, 'sábados': 6, saturday: 6, saturdays: 6,
};

/**
 * A weekday's name, 0 = Sunday, in the language the manager chose.
 *
 * Never a hand-written table: `toLocaleDateString` already knows every
 * language's weekday names, and 1 January 2023 was a Sunday, so the index maps
 * straight onto that week. Called per label so a language change is picked up.
 */
export function weekdayName(weekday: number): string {
  const i = ((weekday % 7) + 7) % 7;
  return new Date(2023, 0, 1 + i).toLocaleDateString(APP_LOCALE, {
    weekday: 'long',
  });
}

/**
 * The same name, abbreviated, for places where seven of them sit in a row.
 *
 * Like its sibling above it must be called during a render and never hoisted
 * to a module constant, or it freezes in whichever language loaded first.
 */
export function weekdayShortName(weekday: number): string {
  const i = ((weekday % 7) + 7) % 7;
  return new Date(2023, 0, 1 + i).toLocaleDateString(APP_LOCALE, {
    weekday: 'short',
  });
}

/**
 * Minutes from midnight as a wall clock, written the way the reader's language
 * writes one: "9:00 AM" in English, "9:00" in Spanish.
 *
 * Kept as a name of its own because half this module reads better with it, but
 * it is `formatTime` and nothing else -- there used to be three copies of this
 * arithmetic and one of them had drifted into 24-hour English.
 */
function hhmm(min: number): string {
  return formatTime(min);
}

/** Normalise a bare hour + optional minutes, handling "10 pm" style suffixes. */
function toMinutes(hourRaw: string, minRaw: string | undefined, suffix?: string): number {
  let h = parseInt(hourRaw, 10);
  const m = minRaw ? parseInt(minRaw, 10) : 0;
  const s = (suffix ?? '').toLowerCase();
  if (s.startsWith('p') && h < 12) h += 12;
  if (s.startsWith('a') && h === 12) h = 0;
  return h * 60 + m;
}

let ruleSeq = 0;
/**
 * A rule carries a KEY, not a sentence.
 *
 * `label` is a getter for the same reason the time bands' is: a rule is parsed
 * once, when the brief is read, but its chip is shown again on every render.
 * Resolving the text here would freeze it in whichever language was current
 * when the manager hit "Generate".
 */
function rule(
  kind: ManagerRule['kind'],
  key: string,
  // A thunk when the values themselves are localised -- a clock time or a
  // weekday name has to be built as late as the sentence around it.
  vars: Vars | (() => Vars) | undefined,
  sourceText: string | null,
  origin: ManagerRule['origin'] = 'parsed',
): ManagerRule {
  ruleSeq += 1;
  return {
    id: `r${ruleSeq}`,
    kind,
    sourceText,
    origin,
    get label() {
      return translate(key, typeof vars === 'function' ? vars() : vars);
    },
  };
}

/**
 * Parse a free-text (or transcribed voice) brief into a scheduling spec.
 * Understands Spanish and English phrasings. Anything it cannot parse simply
 * keeps its default, and the UI shows the manager exactly what was understood.
 */
export function parsePrompt(text: string): SchedulingSpec {
  const t = text.toLowerCase();
  // Fresh arrays: spreading DEFAULT_SPEC would share them between calls.
  const spec: SchedulingSpec = {
    ...DEFAULT_SPEC,
    closedWeekdays: [],
    coverage: [],
    dayHours: [],
    closedDates: [],
    rules: [],
  };
  const rules: ManagerRule[] = [];

  // --- Opening hours -------------------------------------------------------
  if (/\b24\s*(h|horas|hours)\b|24\/7/.test(t)) {
    spec.openMin = 0;
    spec.closeMin = 24 * 60;
    rules.push(rule('opening_hours', 'domain.rule.open24', undefined, '24h'));
  } else {
    const m = t.match(
      /(?:abrimos|abierto|abre|horario|open|opening|from|de|desde)\D{0,12}(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?\s*(?:a|al|-|–|hasta|to|till|until)\s*(?:las\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?/i,
    );
    if (m) {
      const start = toMinutes(m[1], m[2], m[3]);
      let end = toMinutes(m[4], m[5], m[6]);
      // "de 10 a 8" on a business brief means ten in the morning to eight at
      // night, so an unqualified end that lands before the start is read as the
      // afternoon first. Only if THAT still lands before the start is it a night -- and
      // the night is measured from the original figure, not from the failed
      // afternoon. Stacking the two used to turn "de 18:00 a 04:00" into 40:00
      // and show a bar its own hours wrong in the live preview, which is the
      // first thing a bar sees.
      if (end <= start && !m[6] && end + 12 * 60 > start) end += 12 * 60;
      if (end <= start) end += 24 * 60;
      if (end - start >= 60 && end - start <= 24 * 60) {
        spec.openMin = start;
        spec.closeMin = end;
        rules.push(
          rule(
            'opening_hours',
            'domain.rule.openHours',
            () => ({ from: hhmm(start), to: hhmm(end) }),
            m[0].trim(),
          ),
        );
      }
    }
  }

  // --- Minimum staffing ----------------------------------------------------
  const minMatch =
    t.match(
      /(?:m[ií]nimo|al menos|minimum|at least|siempre)\D{0,15}(\d{1,2})\s*(?:personas|empleados|people|staff|employees|trabajadores)?/i,
    ) ??
    t.match(
      /(\d{1,2})\s*(?:personas|empleados|people|staff|employees|trabajadores)\D{0,25}(?:por hora|en todo momento|siempre|at all times|per hour|on shift|on the floor)/i,
    );
  if (minMatch) {
    const n = parseInt(minMatch[1], 10);
    if (n >= 1 && n <= 50) {
      spec.minStaff = n;
      rules.push(
        rule('min_staff', 'domain.rule.minStaff', { count: n }, minMatch[0].trim()),
      );
    }
  }

  // --- Peak / rush cover ---------------------------------------------------
  const peak = t.match(
    /(?:refuerzo|pico|punta|hora punta|peak|rush|busy)\D{0,25}(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:a|-|–|hasta|to)\s*(?:las\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\D{0,25}?(\d{1,2})?/i,
  );
  if (peak) {
    const start = toMinutes(peak[1], peak[2], peak[3]);
    let end = toMinutes(peak[4], peak[5], peak[6]);
    if (end <= start) end += 12 * 60;
    const staff = peak[7] ? parseInt(peak[7], 10) : spec.minStaff + 1;
    if (end > start && staff > 0 && staff <= 50) {
      spec.peak = { startMin: start, endMin: end, staff };
      rules.push(
        rule(
          'peak_cover',
          'domain.rule.peakCover',
          () => ({ count: staff, from: hhmm(start), to: hhmm(end) }),
          peak[0].trim(),
        ),
      );
    }
  }

  // --- Closed days ---------------------------------------------------------
  const closedRe =
    /(?:cerramos?|cerrado|closed|no abrimos)\s+(?:los\s+|on\s+|el\s+)?([a-zá-ú]+)(?:\s*(?:y|and|,)\s*(?:los\s+|on\s+)?([a-zá-ú]+))?/gi;
  let cm: RegExpExecArray | null;
  while ((cm = closedRe.exec(t)) !== null) {
    for (const token of [cm[1], cm[2]]) {
      if (!token) continue;
      const day = WEEKDAYS[token];
      if (day !== undefined && !spec.closedWeekdays.includes(day)) {
        spec.closedWeekdays.push(day);
        rules.push(
          rule(
            'closed_day',
            'domain.rule.closedDay',
            () => ({ day: weekdayName(day) }),
            cm[0].trim(),
          ),
        );
      }
    }
  }

  // --- Max weekly hours ----------------------------------------------------
  const maxH = t.match(
    /(?:m[áa]ximo|max|no m[áa]s de|no more than|hasta)\D{0,12}(\d{1,2})\s*(?:horas|hours|h)\b/i,
  );
  if (maxH) {
    const n = parseInt(maxH[1], 10);
    if (n >= 10 && n <= 80) {
      spec.maxHoursPerWeek = n;
      rules.push(
        rule(
          'max_weekly_hours',
          'domain.rule.maxWeeklyHours',
          { count: n },
          maxH[0].trim(),
        ),
      );
    }
  }

  // --- Minimum rest --------------------------------------------------------
  const rest = t.match(/(?:descanso|rest|between shifts)\D{0,20}(\d{1,2})\s*(?:horas|hours|h)\b/i);
  if (rest) {
    const n = parseInt(rest[1], 10);
    if (n >= 6 && n <= 24) {
      spec.minRestHours = n;
      rules.push(
        rule('min_rest', 'domain.rule.minRest', { count: n }, rest[0].trim()),
      );
    }
  }

  // Always surface the invariants that apply whether or not they were typed.
  rules.push(
    rule(
      'min_rest',
      'domain.rule.minRestDefault',
      { count: spec.minRestHours },
      null,
      'default',
    ),
  );
  rules.push(
    rule('max_weekly_hours', 'domain.rule.overtime', undefined, null, 'default'),
  );

  // De-duplicate by label, keeping parsed rules over defaults.
  const seen = new Set<string>();
  spec.rules = rules
    .sort((a, b) => (a.origin === b.origin ? 0 : a.origin === 'parsed' ? -1 : 1))
    .filter((r) => (seen.has(r.label) ? false : (seen.add(r.label), true)));

  return spec;
}

export function describeSpec(spec: SchedulingSpec): string {
  const allDay = spec.openMin === 0 && spec.closeMin >= 24 * 60;
  // Four whole sentences rather than one built from fragments: "closed" lands
  // in a different place in Spanish, and so does the hour range.
  const days = spec.closedWeekdays
    .map((d) => weekdayName(d))
    .join(translate('domain.spec.dayJoin'));
  const key = allDay
    ? days
      ? 'domain.spec.summary24Closed'
      : 'domain.spec.summary24'
    : days
      ? 'domain.spec.summaryHoursClosed'
      : 'domain.spec.summaryHours';
  return translate(key, {
    count: spec.minStaff,
    from: hhmm(spec.openMin),
    to: hhmm(spec.closeMin),
    days,
  });
}

export { hhmm };

/**
 * The spec for a calendar we know nothing about: the team's published rota
 * opened on a browser that never saw the brief. Nobody is required anywhere,
 * so the generator adds nothing and the report shows no gaps -- a gap here
 * would be the default's opinion, not the manager's. The first brief
 * replaces it.
 */
export const NO_REQUIREMENTS_SPEC: SchedulingSpec = {
  ...DEFAULT_SPEC,
  openMin: 0,
  closeMin: 24 * 60,
  minStaff: 0,
};

/**
 * Whether the spec asks for anybody at all. A spec that does not is one the
 * generator must leave alone: nothing to cover, and nothing to top up toward
 * -- contracted hours are a floor the business committed to for a rota it
 * asked for, not a reason to invent one it did not.
 */
export function statesRequirement(spec: SchedulingSpec): boolean {
  return spec.minStaff > 0 || (spec.coverage?.length ?? 0) > 0 || spec.peak !== null;
}
