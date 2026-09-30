// The calendars that must not change when the weights move out of the code.
//
// Pulling the scoring constants into `SchedulingObjective` is only safe if
// `DEFAULT_OBJECTIVE` reproduces the old calendar exactly, and "exactly" has to
// mean something stronger than "the tests still pass": the existing suite
// asserts PROPERTIES (everyone covered, nobody over their ceiling) precisely so
// it survives the swap to a CP-SAT solver, which means it would happily accept
// a different-but-still-valid rota. A refactor that quietly reshuffles who
// works Thursday is not a refactor.
//
// So these scenarios exist to be pinned, byte for byte, against a fixture
// generated before the change. Each one puts a different term of the objective
// under load -- overtime, contract ceilings, the top-up pass, a pending
// absence, split days -- because a weight nothing exercises is a weight the
// comparison cannot vouch for.
//
// Everything carries an EXPLICIT id. The factories draw from a shared counter,
// so a scenario that let one be generated would produce a different fixture
// depending on which tests ran first.
//
// Each scenario now takes the objective to build under, so that the same ten
// briefs can be run against a NAMED profile as well as the default. One set of
// scenarios rather than two: a profile is only worth having if it changes an
// answer, and the only way to see that is to ask both of them the same
// question. See objective.profiles.test.ts, which does exactly that and pins
// what comes back.

import type {
  AbsenceOut,
  AbsenceTypeOut,
  ContractOut,
  EmployeeOut,
  ShiftTemplateOut,
} from '../types';
import { EMPTY_OVERLAY, type ScheduleOverlay } from '../lib/schedule/overlay';
import { generateSchedule } from '../lib/schedule/generate';
import type { PayPolicy } from '../lib/schedule/payroll';
import type {
  Assignment,
  DayRef,
  ScheduleResult,
  SchedulingObjective,
  SchedulingSpec,
} from '../lib/schedule/types';
import { absence, absenceType, contract, days, employee, spec, template } from './factories';

// Monday 2 March to Sunday 8 March 2026: ONE whole week, which is what these
// scenarios are about. It used to start on the Sunday, back when a week did.
const WEEK = days('2026-03-02', 7);
const VACATION = absenceType({ id: 'atype-vac', name: 'Vacation', code: 'VAC' });

function person(id: string, over: Partial<ContractOut> = {}): EmployeeOut {
  return employee({
    id,
    full_name: id,
    current_contract: contract({ id: `contract-${id}`, employee_id: id, ...over }),
  });
}

/** `n` interchangeable hourly people on the same rate. */
function team(n: number, rate = 20): EmployeeOut[] {
  return Array.from({ length: n }, (_, i) => person(`e${i + 1}`, { hourly_rate: rate }));
}

const DAY_TEMPLATE: ShiftTemplateOut = template({
  id: 'tpl-day',
  name: 'Day',
  start_time: '09:00',
  end_time: '17:00',
  unpaid_break_minutes: 30,
});

const LATE_TEMPLATE: ShiftTemplateOut = template({
  id: 'tpl-late',
  name: 'Late',
  start_time: '13:00',
  end_time: '21:00',
  unpaid_break_minutes: 30,
});

// Shifts of DIFFERENT lengths, which is what makes the length-sensitive weights
// decide anything. With one shape in the running, `avoidOvershootingBase` and
// `rewardHoursCovered` have nothing to compare and any value produces the same
// rota -- the fixture stays green while the weight it claims to pin is dead.
const SHORT_TEMPLATE: ShiftTemplateOut = template({
  id: 'tpl-short',
  name: 'Short',
  start_time: '09:00',
  end_time: '13:00',
  unpaid_break_minutes: 0,
});

const MID_TEMPLATE: ShiftTemplateOut = template({
  id: 'tpl-mid',
  name: 'Mid',
  start_time: '09:00',
  end_time: '15:00',
  unpaid_break_minutes: 30,
});


/** A shift the manager already placed, replayed before the generator runs. */
function pin(id: string, employeeId: string, date: string, paidHours: number): Assignment {
  return {
    id,
    employeeId,
    date,
    startMin: 8 * 60,
    endMin: 8 * 60 + (paidHours + 0.5) * 60,
    templateId: 'tpl-pinned',
    templateName: 'Pinned',
    color: '#2563EB',
    isNight: false,
    paidHours,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'manual',
  };
}

/**
 * The part of a result a manager would notice changing.
 *
 * `templateName` and `color` are left out on purpose: the name is translated at
 * build time, so pinning it would make the fixture depend on the language the
 * suite happens to run in rather than on the scheduling decision.
 */
export function canonical(result: ScheduleResult): unknown {
  return {
    assignments: result.assignments.map((a) => ({
      id: a.id,
      employeeId: a.employeeId,
      date: a.date,
      startMin: a.startMin,
      endMin: a.endMin,
      templateId: a.templateId,
      isNight: a.isNight,
      paidHours: a.paidHours,
      overtimeHours: a.overtimeHours,
      extraHours: a.extraHours,
      cost: a.cost,
      source: a.source,
    })),
    gaps: result.gaps,
    totalCost: result.totalCost,
    totalHours: result.totalHours,
    overtimeHours: result.overtimeHours,
    hoursByEmployee: result.hoursByEmployee,
    belowMinimum: result.belowMinimum,
  };
}

/**
 * Everything one brief hands the generator, before the generator runs.
 *
 * Exposed because a `ScheduleResult` is not enough to JUDGE a calendar:
 * `validateSchedule` needs the roster, the absences, the spec and the days to
 * say whether a rota is legal, and none of those survive into the result. The
 * quality bench in rotaQuality reads them from here rather than restating the
 * twelve briefs beside itself -- two copies of "this shop opens at eight" is
 * exactly the drift that makes a bench report a regression that is really just
 * a scenario somebody widened on one side of the repo only.
 */
export interface ScenarioInputs {
  employees: EmployeeOut[];
  templates: ShiftTemplateOut[];
  absences: AbsenceOut[];
  absenceTypes: AbsenceTypeOut[];
  spec: SchedulingSpec;
  days: DayRef[];
  overlay: ScheduleOverlay;
  /**
   * The business's premiums, for the briefs that are about who earns one.
   *
   * Left off everywhere else, which is the generator's "price as it always
   * did" -- no premiums booked, overtime at the spec's multiplier -- so the
   * twelve briefs written before premiums reached the generator are still
   * asking exactly what they asked.
   */
  payPolicy?: PayPolicy;
}

/** A scenario as written below: the overlay is left off unless it has one. */
interface ScenarioBrief {
  name: string;
  inputs: (
    objective?: SchedulingObjective,
  ) => Omit<ScenarioInputs, 'overlay'> & { overlay?: ScheduleOverlay };
}

export interface Scenario {
  name: string;
  /**
   * What this scenario would ask the generator for, under one objective.
   *
   * Built fresh on every call, like `run` always was: the employees and the
   * spec are mutable objects, and a shared one handed to two consumers is a
   * fixture that depends on which of them ran first.
   */
  inputs: (objective?: SchedulingObjective) => ScenarioInputs;
  /**
   * Build this scenario's calendar under one objective.
   *
   * Called with nothing for the default, which is not the same as being called
   * with `DEFAULT_OBJECTIVE`: an absent `spec.objective` is the shape a spec has
   * when it comes off a backend that never heard of objectives, and it is the
   * shape objective.identity pins. Passing the default explicitly would test a
   * path no customer is on.
   */
  run: (objective?: SchedulingObjective) => ScheduleResult;
}

/**
 * The generator, fed one scenario's inputs.
 *
 * Exported so a caller that needs BOTH -- the calendar and the brief it came
 * from, which is every caller that wants to judge the calendar -- can hold one
 * inputs object and use it for both, instead of building a second one that is
 * merely equal to the first.
 */
export function runInputs(i: ScenarioInputs): ScheduleResult {
  return generateSchedule(
    i.employees,
    i.templates,
    i.absences,
    i.absenceTypes,
    i.spec,
    i.days,
    i.overlay,
    i.payPolicy,
  );
}

/**
 * One brief, turned into a scenario whose calendar and whose inputs are the
 * SAME inputs.
 *
 * `run` goes through `inputs` rather than calling the generator with its own
 * copy of the arguments. That is the whole point of the split: the day the two
 * diverge, the bench would be judging a calendar built from something else and
 * every number it prints would be quietly about a different shop.
 */
function toScenario(brief: ScenarioBrief): Scenario {
  const inputs = (objective?: SchedulingObjective): ScenarioInputs => ({
    overlay: EMPTY_OVERLAY,
    ...brief.inputs(objective),
  });
  return {
    name: brief.name,
    inputs,
    run: (objective) => runInputs(inputs(objective)),
  };
}

const BRIEFS: ScenarioBrief[] = [
  {
    // Nothing special: five equals, no templates, a short open day. The
    // baseline the cost, fairness and `resolved` terms alone decide.
    name: 'plain week, five interchangeable people',
    inputs: (objective) => ({
      employees: team(5),
      templates: [],
      absences: [],
      absenceTypes: [VACATION],
      spec: spec({ objective, minStaff: 2 }),
      days: WEEK,
    }),
  },
  {
    // Real templates in the running, so `preferKnownShifts` is worth something
    // in both passes and the synthesised bands have to beat a 6-point bonus.
    name: 'org templates against synthesised bands',
    inputs: (objective) => ({
      employees: team(5),
      templates: [SHORT_TEMPLATE, MID_TEMPLATE, DAY_TEMPLATE, LATE_TEMPLATE],
      absences: [],
      absenceTypes: [VACATION],
      spec: spec({ objective, minStaff: 2, openMin: 9 * 60, closeMin: 21 * 60 }),
      days: WEEK,
    }),
  },
  {
    // Contracts that disagree with each other: this is the top-up pass under
    // load, and the only scenario where `respectContract` has a ceiling to
    // measure against.
    name: 'mixed contract floors and ceilings',
    inputs: (objective) => ({
      employees: [
        person('e1', { hourly_rate: 18, min_hours_per_week: 20 }),
        person('e2', { hourly_rate: 22, min_hours_per_week: 30, max_hours_per_week: 35 }),
        person('e3', { hourly_rate: 20, min_hours_per_week: 0, max_hours_per_week: 12 }),
        person('e4', { hourly_rate: 25, min_hours_per_week: 24 }),
      ],
      templates: [],
      absences: [],
      absenceTypes: [VACATION],
      spec: spec({ objective, minStaff: 2, openMin: 9 * 60, closeMin: 19 * 60 }),
      days: WEEK,
    }),
  },
  {
    // Two people at half the wage of the other two, contracts that let anyone
    // reach sixty hours, and more shop than four people can cover.
    //
    // The wage gap is what gives the overtime weights something to overrule.
    // Cost wants the cheap pair to work every hour; `overtimeAversion` and
    // `respectWeeklyCap` are the only reasons to hand an hour to somebody who
    // costs three times as much. With four similar rates the two weights are
    // indistinguishable from plain fairness -- the least-loaded person is also
    // the one furthest from the overtime line, so both weights pick them and
    // neither is doing any work.
    //
    // Both thresholds bite, and in different places: the FLSA line at 40 for
    // `overtimeAversion`, the brief's stated 45 for `respectWeeklyCap`.
    name: 'a team too small for the week, forced into overtime',
    inputs: (objective) => ({
      employees: [
        person('e1', { hourly_rate: 12, max_hours_per_week: 60 }),
        person('e2', { hourly_rate: 12, max_hours_per_week: 60 }),
        person('e3', { hourly_rate: 40, max_hours_per_week: 60 }),
        person('e4', { hourly_rate: 40, max_hours_per_week: 60 }),
      ],
      templates: [SHORT_TEMPLATE, DAY_TEMPLATE],
      absences: [],
      absenceTypes: [VACATION],
      spec: spec({ objective, minStaff: 2, openMin: 8 * 60, closeMin: 22 * 60, maxHoursPerWeek: 45 }),
      days: WEEK,
    }),
  },
  {
    // Salaried staff cost nothing at the margin, so wage sensitivity drops out
    // and the remaining terms have to break the tie by themselves.
    name: 'salaried and hourly on the same rota',
    inputs: (objective) => ({
      employees: [
        person('e1', { employment_type: 'exempt_salaried', hourly_rate: null, base_annual_salary: 52000 }),
        person('e2', { employment_type: 'exempt_salaried', hourly_rate: null, base_annual_salary: 41600 }),
        person('e3', { hourly_rate: 20 }),
        person('e4', { hourly_rate: 30 }),
      ],
      templates: [],
      absences: [],
      absenceTypes: [VACATION],
      spec: spec({ objective, minStaff: 2, openMin: 9 * 60, closeMin: 21 * 60 }),
      days: WEEK,
    }),
  },
  {
    // One request approved (a hard filter) and one still pending (a 40-point
    // shove). The pair is deliberate: it pins that the two are not the same.
    name: 'one approved absence and one still pending',
    inputs: (objective) => ({
      employees: team(4),
      templates: [],
      absences: [
        absence({
          id: 'abs-approved',
          employee_id: 'e1',
          absence_type_id: 'atype-vac',
          start_at: '2026-03-04T00:00:00',
          end_at: '2026-03-04T23:59:00',
          status: 'approved',
        }),
        absence({
          id: 'abs-pending',
          employee_id: 'e2',
          absence_type_id: 'atype-vac',
          start_at: '2026-03-04T00:00:00',
          end_at: '2026-03-05T23:59:00',
          status: 'requested',
        }),
      ],
      absenceTypes: [VACATION],
      spec: spec({ objective, minStaff: 2 }),
      days: WEEK,
    }),
  },
  {
    // A quiet morning and a heavy evening -- the shape a split day is actually
    // for. One person opens, and comes back for the evening rush with four
    // hours in between.
    //
    // The valley is what makes this work, and it took a wrong version to see
    // why: with flat cover all day, the first uncovered hour is always the one
    // that just ended somebody's shift, and `SPLIT_MIN_GAP` puts it out of
    // reach of the only people left. Nobody can take it, the day aborts, and a
    // scenario meant to exercise split days records none at all.
    name: 'split days, a morning lull and an evening rush',
    inputs: (objective) => ({
      employees: team(3),
      templates: [],
      absences: [],
      absenceTypes: [VACATION],
      spec: spec({
        objective,
        minStaff: 1,
        openMin: 8 * 60,
        closeMin: 22 * 60,
        shiftLengthHours: 4,
        splitShiftPeople: 2,
        allowSplitShifts: true,
        coverage: [
          { weekdays: [], dates: [], startMin: 18 * 60, endMin: 22 * 60, staff: 3 },
        ],
      }),
      days: WEEK,
    }),
  },
  {
    // Three open days a week and three people whose contracts ask for more hours
    // than one person on the floor can absorb: everything above the cover line
    // comes from the TOP-UP pass.
    //
    // Six of the fifteen weights live in that pass, and no scenario above
    // reaches it -- when cover alone already puts everybody past their base, it
    // never runs at all. A fixture that never ran it would vouch for nine
    // weights while claiming to vouch for fifteen.
    //
    // The bases are 13, 17 and 26 rather than round numbers, and the shifts on
    // offer are 4, 5.5 and 7.5 hours. No combination lands exactly, which is
    // the point: `avoidOvershootingBase` can only decide anything when somebody
    // is closer to their base than the shortest shift available, and round
    // numbers hide that case instead of producing it.
    name: 'contracted minimums the coverage cannot fill',
    inputs: (objective) => ({
      employees: [
        person('e1', { hourly_rate: 22, min_hours_per_week: 13 }),
        person('e2', { hourly_rate: 20, min_hours_per_week: 17 }),
        person('e3', { hourly_rate: 18, min_hours_per_week: 26 }),
      ],
      templates: [SHORT_TEMPLATE, MID_TEMPLATE, DAY_TEMPLATE],
      absences: [],
      absenceTypes: [VACATION],
      spec: spec({
        objective,
        minStaff: 1,
        openMin: 9 * 60,
        closeMin: 19 * 60,
        // Shut three days a week, so one person on the floor is all the cover
        // this shop needs and forty hours is all it can hand out -- against
        // sixty hours of contracted minimums.
        closedWeekdays: [0, 2, 4],
      }),
      days: WEEK,
    }),
  },
  {
    // Coverage that moves through the week: a closed Sunday, four on Saturday,
    // and a lunch dip that may cut cover rather than raise it. `resolved`
    // varies hour by hour here, which nothing above makes it do.
    name: 'closed Sunday, busy Saturday, thin lunch',
    inputs: (objective) => ({
      employees: team(5),
      templates: [SHORT_TEMPLATE, MID_TEMPLATE],
      absences: [],
      absenceTypes: [VACATION],
      spec: spec({
        objective,
        minStaff: 2,
        openMin: 9 * 60,
        closeMin: 21 * 60,
        closedWeekdays: [0],
        coverage: [
          { weekdays: [6], dates: [], startMin: null, endMin: null, staff: 4 },
          { weekdays: [], dates: [], startMin: 13 * 60, endMin: 15 * 60, staff: 1, exact: true },
        ],
      }),
      days: WEEK,
    }),
  },
  {
    // Two people who already have most of a week behind them, two who have
    // none, and enough slack that the generator can genuinely leave somebody
    // out. This is the only shape in which the overtime weights decide
    // anything.
    //
    // Everywhere else they are inert, and it took measuring to see why: when
    // cover needs every person every day, the only freedom left is which shift
    // SHAPE each one takes, and no amount of overtime aversion can decline an
    // hour that nobody else is free to take. Slack is the precondition, and
    // pinned hours are what put somebody near the line while slack still
    // exists. It is also the only scenario that replays a manager's own
    // decisions, which nothing else here covers.
    name: 'a half-worked week already pinned, with room to choose',
    inputs: (objective) => ({
      employees: [
        person('e1', { hourly_rate: 12, max_hours_per_week: 60 }),
        person('e2', { hourly_rate: 12, max_hours_per_week: 60 }),
        person('e3', { hourly_rate: 40, max_hours_per_week: 60 }),
        person('e4', { hourly_rate: 40, max_hours_per_week: 60 }),
      ],
      templates: [SHORT_TEMPLATE, DAY_TEMPLATE],
      absences: [],
      absenceTypes: [VACATION],
      spec: spec({ objective, minStaff: 1, openMin: 8 * 60, closeMin: 20 * 60, maxHoursPerWeek: 45 }),
      days: WEEK,
      overlay: {
        ...EMPTY_OVERLAY,
        // The first four days of the week and the first three -- they moved
        // with it when the week moved to Monday, or one of e1's pinned days
        // would have fallen outside the period and this would stop being a
        // HALF-worked week.
        pinned: [
          pin('p1', 'e1', '2026-03-02', 9),
          pin('p2', 'e1', '2026-03-03', 9),
          pin('p3', 'e1', '2026-03-04', 9),
          pin('p4', 'e1', '2026-03-05', 9),
          pin('p5', 'e2', '2026-03-02', 9),
          pin('p6', 'e2', '2026-03-03', 9),
          pin('p7', 'e2', '2026-03-04', 9),
        ],
      },
    }),
  },
  {
    // A wage gap and a full set of house templates, in a shop whose opening
    // hours none of them fits.
    //
    // Added for the named profiles, and the first two scenarios written for a
    // disagreement rather than for a weight. Everything above puts ONE thing
    // under load at a time, which is right for pinning a refactor and wrong for
    // telling two objectives apart: `cheapest` and `familiar` only differ where
    // the cheap answer and the recognisable answer are different answers.
    //
    // 8 to 22 against templates that run 9-13, 9-15, 9-17 and 13-21 is what
    // makes that true. The first and last hours of the day belong to a
    // synthesised band whatever anybody prefers, so the templates have to earn
    // the middle -- and the people who fit them cost between 12 and 30 an hour.
    name: 'house templates and a wage gap',
    inputs: (objective) => ({
      employees: [
        person('e1', { hourly_rate: 12 }),
        person('e2', { hourly_rate: 12 }),
        person('e3', { hourly_rate: 20 }),
        person('e4', { hourly_rate: 20 }),
        person('e5', { hourly_rate: 30 }),
        person('e6', { hourly_rate: 30 }),
      ],
      templates: [SHORT_TEMPLATE, MID_TEMPLATE, DAY_TEMPLATE, LATE_TEMPLATE],
      absences: [],
      absenceTypes: [VACATION],
      spec: spec({ objective, minStaff: 2, openMin: 8 * 60, closeMin: 22 * 60 }),
      days: WEEK,
    }),
  },
  {
    // A pending request standing between the calendar and the cheap option.
    //
    // 'one approved absence and one still pending' above cannot see what
    // `protectPendingTimeOff` is worth: with four people on the same rate, the
    // request wins at 40 and would win at 4, because nothing argues back. Here
    // something does. Ana is 10 an hour and has asked for the Wednesday and
    // Thursday off; the only other two people cost 60, so scheduling around her
    // costs 50 points an hour and the default -- 40, flat, once -- schedules
    // over the request instead.
    //
    // That is not a bug in the default: an unanswered request is not an
    // approved absence, and the calendar says so plainly. It is the exact case
    // a business that runs on goodwill would want to decide differently, which
    // is what `protective` is for.
    name: 'a pending request against a much cheaper alternative',
    inputs: (objective) => ({
      employees: [
        person('e1', { hourly_rate: 10 }),
        person('e2', { hourly_rate: 60 }),
        person('e3', { hourly_rate: 60 }),
      ],
      templates: [],
      absences: [
        absence({
          id: 'abs-cheap-pending',
          employee_id: 'e1',
          absence_type_id: 'atype-vac',
          start_at: '2026-03-04T00:00:00',
          end_at: '2026-03-05T23:59:00',
          status: 'requested',
        }),
      ],
      absenceTypes: [VACATION],
      spec: spec({ objective, minStaff: 2, openMin: 9 * 60, closeMin: 17 * 60 }),
      days: WEEK,
    }),
  },
  {
    // A late bar where the premiums are the whole question.
    //
    // The owner's own example, turned into a shop: the business pays 25% on
    // night hours, and Juan's contract says he gets none of it. Everybody is on
    // the same base rate, so the ONLY thing that makes Juan cheaper is that
    // premium -- and a generator that let the premium into the score would
    // hand him every night it legally could, which is a rota the manager never
    // asked for and Juan would rightly call unfair. Sofia is the same question
    // at the weekend: she alone is paid 10% on Saturday and Sunday, and a
    // score that saw it would keep her off both.
    //
    // The bar is the one in restDays.test.ts, 17:00-03:00 every day, with the
    // Spanish night window and day limits that bar was written under.
    //
    // SIX people, on 20-hour contracts that may stretch to 40, and that is the
    // measured part of the brief. The first version had five people on 28
    // hours -- exactly the 140 person-hours two on the floor all week need --
    // and nothing in it could move: every person worked every hour they had,
    // every shift in a bar that opens at five touches the night, so no weight
    // and no premium had anybody to choose between. A question about WHO gets
    // the unsocial hours needs a rota with room to answer it.
    name: 'a late bar, one person paid no night premium',
    inputs: (objective) => ({
      employees: [
        person('marta', { hourly_rate: 15, min_hours_per_week: 20, max_hours_per_week: 40 }),
        person('juan', {
          hourly_rate: 15,
          min_hours_per_week: 20,
          max_hours_per_week: 40,
          night_premium_pct: 0,
        }),
        person('lucia', { hourly_rate: 15, min_hours_per_week: 20, max_hours_per_week: 40 }),
        person('pablo', { hourly_rate: 15, min_hours_per_week: 20, max_hours_per_week: 40 }),
        person('sofia', {
          hourly_rate: 15,
          min_hours_per_week: 20,
          max_hours_per_week: 40,
          weekend_premium_pct: 10,
        }),
        person('ana', { hourly_rate: 15, min_hours_per_week: 20, max_hours_per_week: 40 }),
      ],
      templates: [],
      absences: [],
      absenceTypes: [VACATION],
      spec: spec({
        objective,
        minStaff: 2,
        openMin: 17 * 60,
        closeMin: 27 * 60,
        maxHoursPerWeek: 40,
        minRestHours: 12,
        maxDailyHours: 9,
        weeklyRestHours: 36,
        nightAverageMax: 8,
        nightWindow: { startHour: 22, endHour: 6 },
        weeklyAverageHours: 40,
      }),
      days: WEEK,
      payPolicy: { nightDifferentialPct: 25, weekendPremiumPct: 0, overtimeMultiplier: 1 },
    }),
  },
  {
    // The same pending request as 'a pending request against a much cheaper
    // alternative', with the alternative dearer still.
    //
    // Added when the wage gap between two people stopped leading the default
    // (`preferCheaperPeople`, in ../lib/schedule/objective). That brief was
    // written so that the default scheduled Ana over her request and
    // `protective` did not; once a wage gap weighed 0.7 of a euro a euro, its
    // 50-an-hour gap was worth 35 points against the request's 40, the default
    // started honouring the request too, and `protective` was left with no
    // calendar of its own -- a sentence in the interface that picked nothing.
    //
    // So here the gap is 80 an hour, worth 56 points. The default still
    // weighs the request against the money and decides the money is too much
    // -- that is what a weight that weighs does -- and a business that picked
    // `protective` still gets the answer it picked. Nothing else differs from
    // the brief it copies, so the two read as one question asked at two
    // prices.
    name: 'a pending request against a far cheaper alternative',
    inputs: (objective) => ({
      employees: [
        person('e1', { hourly_rate: 10 }),
        person('e2', { hourly_rate: 90 }),
        person('e3', { hourly_rate: 90 }),
      ],
      templates: [],
      absences: [
        absence({
          id: 'abs-far-cheaper-pending',
          employee_id: 'e1',
          absence_type_id: 'atype-vac',
          start_at: '2026-03-04T00:00:00',
          end_at: '2026-03-05T23:59:00',
          status: 'requested',
        }),
      ],
      absenceTypes: [VACATION],
      spec: spec({ objective, minStaff: 2, openMin: 9 * 60, closeMin: 17 * 60 }),
      days: WEEK,
    }),
  },
];

export const SCENARIOS: Scenario[] = BRIEFS.map(toScenario);

/** Every scenario, canonicalised, in a stable order. */
export function runAllScenarios(
  objective?: SchedulingObjective,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of SCENARIOS) out[s.name] = canonical(s.run(objective));
  return out;
}
