// What the model is told before it is asked to build a month.
//
// Close cousin of `buildRefineContext`, and it shares that function's spec
// summary rather than writing a second one. Three things differ, and all three
// follow from the job being GENERATION rather than adjustment:
//
// 1. **Ids, not "#3".** The refine path lets the model say "the third person"
//    because a human then reads the operation. Here the answer goes straight
//    into a calendar, so it must name an id we can look up, and the id has to
//    be in front of it to be named.
// 2. **No shift listing.** There is nothing planned yet; the month is what we
//    are asking for.
// 3. **Contracted hours are stated.** A rota that ignores what people are
//    contracted for is the single most common way a legal calendar is still a
//    bad one, and the model cannot weigh what it was not told.
// 4. **The law is stated.** Same reason as 3, and it arrived the same way:
//    the statutory limits were added to the spec, enforced by the validator,
//    and never mentioned to the model -- which then wrote rotas that were
//    thrown away and replaced by the deterministic pass. A rule the model is
//    told is a rule it can plan around.
//
// PRIVACY: nothing this builder reads OUT OF THE DATABASE carries a pay rate,
// a salary, a reason for an absence -- OR A NAME. WHO is unavailable, never
// WHY; and who, here, is an id.
//
// NOBODY'S NAME IS WRITTEN INTO THIS TEXT. It used to be: the team listing
// spelled out "Ana Garcia Perez" beside her id, the calendar-as-it-stands
// repeated it on every line, and all of it went to a third party every time a
// month was planned. It bought nothing. The model answers with `employee_id`
// and is told so in its first instruction, so the id is the only handle it
// ever needed; the name was there for a human reader this text does not have.
//
// The manager's own brief is quoted whole below, and the words they typed may
// well name somebody. Those names are masked on the SERVER, which is the only
// side that knows the roster: `backend/app/services/id_alias.py` replaces each
// one with the alias that person's id already gets, so "Laura always opens"
// arrives as "e1 always opens" and stays as usable as it was. Two measures
// rather than one, because a regular expression over somebody's free prose is
// not a thing to rest a promise on -- and because this file can guarantee
// something stronger about the rows it writes itself: it simply never writes
// them.
//
// WHAT DROPPING THE COLUMN COSTS, said out loud. That row was the only place
// a name in the manager's prose could be tied to an id. The server masks the
// names it can, and on purpose it lets a few through -- a first name that is
// also a weekday or a month, one word written in lower case, a nickname -- so
// those now arrive attached to nobody and the sentence they are in cannot be
// acted on. A known gap, accepted: it costs the rare sentence, the fallback is
// the rota the product would have built anyway, and the alternative is
// printing everybody's full name to keep a handful of them resolvable. If it
// has to be closed, the fix is to label the person with their ALIAS here, not
// with their name.
//
// What the manager READS is untouched. Ids go out, ids come back, and the
// client has always turned an id into a name to draw the calendar.

import { availability, contractedMinHours } from './availability';
import { specSummaryLines } from './refine';
import type { Assignment, DayRef, SchedulingSpec } from './types';
import type {
  AbsenceOut,
  AbsenceTypeOut,
  EmployeeOut,
  ShiftTemplateOut,
} from '../../types';

function clock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * A calendar that already exists, and the change asked of it.
 *
 * Present when the manager typed an adjustment; absent on a first build.
 */
export interface PlanRevision {
  /** The rota as it stands, in the period being replanned. */
  current: Assignment[];
  /** What the manager just asked for, in their own words. */
  instruction: string;
  /**
   * What granting it cost, measured -- see `damage.ts`.
   *
   * Kept apart from `instruction` because they are different kinds of thing
   * and the model has to weigh them differently: the instruction is a
   * REQUIREMENT, and the damage is a CONSEQUENCE to repair without undoing it.
   * Folded into one sentence, "Juanito is off that week, 12 hours uncovered"
   * reads as an argument for putting Juanito back.
   */
  damage?: string[];
}

/**
 * How many shifts of the existing calendar to show.
 *
 * A year would run to thousands of lines and crowd out the rules above, which
 * is the failure that matters: a model that loses the constraints writes a
 * beautiful rota nobody can use. Replanning happens a month at a time, so this
 * is generous for the real case and a guard for the wrong one.
 */
const MAX_LISTED_SHIFTS = 400;

/**
 * The brief the calendar planner works from.
 *
 * `days` is the WHOLE horizon, not one block: a model planning March needs to
 * know that April exists and is staffed by the same people, or it treats every
 * month as a fresh start and everybody's pattern resets on the 1st.
 */
export function buildPlanContext(
  employees: EmployeeOut[],
  templates: ShiftTemplateOut[],
  absences: AbsenceOut[],
  absenceTypes: AbsenceTypeOut[],
  spec: SchedulingSpec,
  days: DayRef[],
  jurisdiction: string,
  today: Date = new Date(),
  revision?: PlanRevision,
  brief?: string,
): string {
  const lines: string[] = [
    ...specSummaryLines(spec, days, jurisdiction, today),
    `MINIMUM REST BETWEEN SHIFTS ON DIFFERENT DAYS: ${spec.minRestHours} h`,
  ];

  // THE LAW, TOLD TO THE MODEL RATHER THAN ENFORCED AFTER IT.
  //
  // These are checked by `validateSchedule` whatever is written here, and a
  // month that breaks one is thrown away and rebuilt by the deterministic
  // pass -- which is safe, and is a worse calendar every time. The model was
  // never told about them: it was asked to plan a Barcelona bar under one
  // sentence about rest, so it wrote ten-hour night shifts, had them
  // rejected, and the greedy pass filled the month. Saying the rule up front
  // is the difference between a rota the AI arranged and a rota it failed to.
  if (spec.maxDailyHours) {
    lines.push(
      `MAXIMUM HOURS IN ONE DAY, PER PERSON: ${spec.maxDailyHours} h. This is the law here, not a preference.`,
    );
  }
  if (spec.weeklyRestHours) {
    lines.push(
      `UNBROKEN REST EVERY WEEK, PER PERSON: ${spec.weeklyRestHours} h in one stretch — a day and a half off together, not two half days. Plan somebody's week around it before you fill their shifts. Stagger those days off across the team and put them on the quieter days: if everybody's rest lands on the same day, that day is left to the part-timers, who then work far past their contracts.`,
    );
  }
  if (spec.nightAverageMax && spec.nightWindow) {
    const from = String(spec.nightWindow.startHour).padStart(2, '0');
    const to = String(spec.nightWindow.endHour).padStart(2, '0');
    lines.push(
      `NIGHT WORK: hours between ${from}:00 and ${to}:00 are night work. Anybody whose day has 3 h or more of it is a night worker, and a night worker's shifts may not average more than ${spec.nightAverageMax} h. A bar that closes late needs TWO shorter shifts across the night, not one long one.`,
    );
  }

  const splitCap = Math.max(
    0,
    spec.splitShiftPeople ?? (spec.allowSplitShifts === true ? 1 : 0),
  );
  lines.push(
    splitCap > 0
      ? `SPLIT SHIFTS: allowed, for at most ${splitCap} ${splitCap === 1 ? 'person' : 'people'} per day. A split needs at least 60 minutes between the two halves.`
      : 'SPLIT SHIFTS: not allowed. Nobody works twice in one day.',
  );

  lines.push(
    '',
    'TEAM. Use the id EXACTLY as written; it is what you return as employee_id.',
    'The ids ARE the people: there are no names here, and an id is how the',
    'requirements below refer to somebody as well.',
    'Contracted hours/week is the number each person should get: a range means between those; "up to" is a ceiling only.',
    '  id | status | contracted hours/week | days unavailable',
  );

  for (const e of employees) {
    const min = contractedMinHours(e);
    const max = e.current_contract?.max_hours_per_week;
    // A contract with a minimum and no maximum is stated as that number, not
    // as "at least": "at least 20" read as an invitation, and the model gave
    // 20-hour part-timers a full-timer's week. If the contract really is a
    // floor, the brief said so and the maximum is what the intake left open.
    const contracted =
      min > 0 && max != null && Number(max) !== min
        ? `${min}-${Number(max)}`
        : max != null && min > 0
          ? `${Number(max)}`
          : max != null
            ? `up to ${Number(max)}`
            : min > 0
            ? `${min}`
            : 'unstated';
    const off = days
      .filter((d) => !availability(e, absences, absenceTypes, d.date).ok)
      .map((d) => d.date);
    // A long absence is summarised rather than listed: forty dates would crowd
    // out the instructions, and the model only needs to know the shape of it.
    const offText =
      off.length === 0
        ? 'none'
        : off.length > 8
          ? `${off.length} days, from ${off[0]} to ${off[off.length - 1]}`
          : off.join(', ');
    lines.push(`  ${e.id} | ${e.employment_status} | ${contracted} | ${offText}`);
  }

  if (employees.length === 0) {
    lines.push('  (nobody on the roster — return no shifts)');
  }

  if (templates.length) {
    lines.push(
      '',
      'SHIFT TEMPLATES. Prefer these times; template_id is optional.',
      '  id | name | start-end',
    );
    for (const t of templates) {
      lines.push(`  ${t.id} | ${t.name} | ${t.start_time}-${t.end_time}`);
    }
  } else {
    lines.push(
      '',
      'SHIFT TEMPLATES: none defined. Choose sensible shift times yourself and '
        + 'omit template_id.',
    );
  }

  const closedDays = days.filter((d) => spec.closedWeekdays.includes(d.weekday));
  lines.push(
    '',
    `THE HORIZON runs ${days[0]?.date ?? '?'} to ${days[days.length - 1]?.date ?? '?'}.`,
    closedDays.length
      ? `${closedDays.length} of those days are closed and take no shifts.`
      : 'The business is open every day in it.',
    `Opening hours are ${clock(spec.openMin)}-${clock(spec.closeMin)} unless a weekday above says otherwise.`,
  );

  // The manager's own words, whole. The requirements above are what the
  // intake could fit into a closed schema; everything it could not -- who
  // works with whom, alternating weekends, "Laura always opens" -- is only
  // here. Before this section existed the planner never saw the brief, and a
  // sentence the schema had no field for was read, shown back to the manager
  // as "noted", and ignored.
  //
  // What to DO with these words is not said here: the planner's system prompt
  // says it, once, on the server. Saying it twice in nearly the same words is
  // how the two drift apart.
  const words = brief?.trim();
  const notes = (spec.notes ?? []).map((n) => n.trim()).filter(Boolean);
  if (words) {
    lines.push('', 'WHAT THE MANAGER ASKED FOR, IN THEIR OWN WORDS:', `  "${words}"`);
  }
  if (notes.length > 0) {
    lines.push(
      '',
      words
        ? 'Of that, these points had no field in the requirements above:'
        : 'THE MANAGER SAID THIS, AND IT HAD NO FIELD IN THE REQUIREMENTS ABOVE:',
    );
    for (const n of notes) lines.push(`  - ${n}`);
  }

  if (revision) {
    const sorted = [...revision.current].sort((a, b) =>
      a.date === b.date ? a.startMin - b.startMin : a.date.localeCompare(b.date),
    );
    lines.push('', 'THE CALENDAR AS IT STANDS (date | employee id | start-end):');
    for (const a of sorted.slice(0, MAX_LISTED_SHIFTS)) {
      lines.push(
        `  ${a.date} | ${a.employeeId} | ${clock(a.startMin)}-${clock(a.endMin)}`,
      );
    }
    if (sorted.length > MAX_LISTED_SHIFTS) {
      lines.push(`  (+${sorted.length - MAX_LISTED_SHIFTS} more, not listed)`);
    }
    if (sorted.length === 0) {
      lines.push('  (empty)');
    }

    lines.push(
      '',
      'WHAT THE MANAGER JUST ASKED FOR:',
      `  "${revision.instruction.trim()}"`,
    );

    // The consequence, under its own heading, because it is not a request and
    // must not be read as one. These lines are the REASON this call is being
    // made at all: the deterministic pass already filled what it could, and
    // what is listed here is what it could not.
    if (revision.damage && revision.damage.length > 0) {
      lines.push(...revision.damage);
      lines.push(
        '',
        'That request STANDS -- it is not what you are being asked to reconsider.',
        'Repair the shortfall around it. The contracted hours in the team list',
        "above are the target for each person: somebody below theirs is the",
        'problem to solve, and pushing somebody else below theirs to solve it is',
        'not a solution. If this month genuinely cannot cover an hour without',
        'breaking a rule, leave it uncovered and say nothing -- an uncovered hour',
        'is reported to the manager, a broken rule is thrown away.',
      );
    }

    lines.push(
      '',
      'Rebuild the month with that request satisfied. Change whatever you need',
      'to change to satisfy it and to keep every rule above -- moving other',
      "people's shifts is allowed and expected when that is what it takes.",
      'What you must not do is churn: a shift that has no reason to move should',
      'not move, because the manager has already read this calendar and will',
      'have to read it again.',
    );
  }

  return lines.join('\n');
}
