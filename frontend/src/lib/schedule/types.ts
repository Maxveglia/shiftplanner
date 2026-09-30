// Scheduling domain types (frontend prototype, Phase 1).
//
// NOTE: shifts are modelled as INTERVALS (start/end minutes), never as 24
// boolean cells per employee. The 24-hour grid is a *view* over these
// intervals -- the same decision the backend makes with tstzrange.

export interface DayRef {
  /** YYYY-MM-DD in local time. */
  date: string;
  /** 0 = Sunday .. 6 = Saturday */
  weekday: number;
  label: string;
}

export interface Assignment {
  id: string;
  employeeId: string;
  /** Local date the shift STARTS on (YYYY-MM-DD). */
  date: string;
  /** Minutes from midnight of `date`. May exceed 1440 for overnight shifts. */
  startMin: number;
  endMin: number;
  templateId: string;
  templateName: string;
  color: string;
  isNight: boolean;
  /** Paid hours (excludes the unpaid break). */
  paidHours: number;
  /** Hours that fall beyond the weekly overtime threshold. */
  overtimeHours: number;
  /**
   * Hours in this shift that go beyond the employee's CONTRACTED maximum.
   *
   * Distinct from `overtimeHours`, which is the FLSA threshold (40h) and a
   * question of pay. This is a question of the agreement: a 20-hour contract
   * picking up a fourth shift to cover a gap is working extra, at plain rate,
   * long before any overtime applies. The two overlap only above 40h.
   */
  extraHours: number;
  /** Marginal cost in dollars (salaried staff are sunk cost -> 0). */
  cost: number;
  source: 'ai' | 'manual';
  /**
   * When this exact shift was first announced to the team (ISO instant).
   *
   * Absent on anything that has not been published: a shift the generator just
   * proposed, a draft the manager is still moving around. Present on a
   * published one, and it survives a republish that did not change the shift
   * -- see `_replace_window` on the server, which keeps it precisely so that
   * this means "when the person working it was told", not "when the row was
   * last written". That is what makes it usable for telling somebody what is
   * new to them since they last looked.
   */
  publishedAt?: string;
}

/** A hard/soft rule parsed out of the manager's prompt. */
export interface ManagerRule {
  id: string;
  kind:
    | 'opening_hours'
    | 'min_staff'
    | 'peak_cover'
    | 'closed_day'
    | 'closed_date'
    | 'day_hours'
    | 'shift_length'
    | 'max_weekly_hours'
    | 'min_rest'
    | 'horizon';
  label: string;
  /** The fragment of the prompt this came from, for auditability. */
  sourceText: string | null;
  /**
   * Where the rule came from, in descending authority:
   * `parsed` — the manager wrote it in the brief.
   * `profile` — this business taught it to us by correcting past calendars.
   *             Only ever fills something the brief left unsaid, and is shown
   *             as such so it can be taken away.
   * `default` — nobody decided it; a constant did.
   */
  origin: 'default' | 'parsed' | 'profile';
}

/**
 * A standing coverage requirement: `staff` people on shift, optionally scoped
 * to certain weekdays, to specific dates, and to a window inside the open day.
 *
 * This is what lets a brief say things the old single-`peak` model could not:
 * "four on Saturdays", "three at lunch AND three at dinner", "six on the 24th".
 * Requirements stack by maximum -- see `needAt` in ./demand.
 */
export interface CoverageReq {
  /** Weekdays it applies to (0 = Sunday). Empty = every open day. */
  weekdays: number[];
  /** Specific dates (YYYY-MM-DD) it applies to. Empty = not date-scoped. */
  dates: string[];
  /** Window inside the day, in minutes. null/null = the whole open day. */
  startMin: number | null;
  endMin: number | null;
  /** People required on shift while this rule is in force. */
  staff: number;
  /**
   * Does this number REPLACE the staffing level in its window, or only raise it?
   *
   * True is a dip -- "only one over lunch" -- and is the only way to ask for
   * fewer people than the flat minimum. False (the default) is a floor: "at
   * least one at closing" guarantees cover without ever cutting it. The
   * distinction matters in one direction only, and it is the dangerous one:
   * treating a floor as exact would REMOVE staff the brief asked to guarantee.
   */
  exact?: boolean;
}

/** Opening hours that differ from the standing ones on one weekday. */
export interface DayHours {
  weekday: number;
  openMin: number;
  closeMin: number;
}

/**
 * What a GOOD calendar is, as opposed to a legal one.
 *
 * Every number here is a preference with a price. Raise `overtimeAversion` and
 * the generator hands an hour to a more expensive person rather than push
 * anyone past forty; raise `preferCheaperPeople` and it does the opposite. Lower
 * total wins.
 *
 * Nothing here can buy its way past a HARD filter. An approved absence, the
 * minimum rest between shifts, a contract that ended, a day the shop is shut --
 * none of those are scored, so no objective can outbid them. That separation is
 * the point of pulling these numbers out: a weight the manager can move must
 * not be able to move the floor underneath it.
 *
 * Two passes, one object. The generator first fills the hours the business
 * cannot open without, then tops people up towards the hours their contract
 * promised, and the two are asking different questions -- one is spending money
 * to cover a shop, the other is dividing hours already owed. Where a term means
 * the same thing in both it is ONE field; where the same word covers two
 * different trades it is two, because collapsing them would invent a ratio the
 * code has never claimed.
 */
export interface SchedulingObjective {
  // --- Covering an hour nobody is on yet. ---------------------------------

  /**
   * How much the wage bill matters: what buying one more hour costs.
   *
   * Scales cost per hour of the deficit actually resolved, not cost per shift:
   * a cheap person who closes one of four missing hours is not cheap.
   *
   * Priced at the roster's AVERAGE rate, whoever works the hour, so this is
   * what keeps shifts no longer than the gap needs -- it decides how many
   * hours are bought, not who works them. Who is `preferCheaperPeople`.
   */
  wageSensitivity: number;
  /**
   * How much one person's rate above or below the roster's average counts
   * for or against giving them the hour.
   *
   * The half of the wage that picks a PERSON, split out so that it can weigh
   * less than the half that sizes a shift. Equal to `wageSensitivity`, the two
   * add up to each candidate's own bill, which is how the score read before
   * they were separated. Below it, the manager's own terms -- cover, contracts,
   * requests, how hours are shared -- decide between two people before their
   * pay does: "el coste pesa pero no manda".
   */
  preferCheaperPeople: number;
  /**
   * How much the hours somebody already has count AGAINST giving them more.
   *
   * Measured across the whole horizon rather than the week, which is what stops
   * the two cheapest people quietly taking every shift in the month.
   */
  spreadHours: number;
  /**
   * Reluctance to schedule past the hours one person's contract agreed.
   *
   * Allowed, never preferred: anyone with contracted room left is chosen first,
   * and the agreement is stretched only when the alternative is a gap.
   */
  respectContract: number;
  /**
   * Reluctance to pass the weekly maximum the BRIEF set.
   *
   * Distinct from `respectContract`, which is one person's own agreement. This
   * is the ceiling the manager named for everybody, and the two can disagree.
   */
  respectWeeklyCap: number;
  /**
   * Flat penalty for scheduling over a time-off request nobody has answered.
   *
   * A pending request is not an approved one, so it cannot block a shift the
   * way an absence does. Pricing it is the honest middle: the calendar works
   * around it whenever there is any alternative, and says so when there is not.
   */
  protectPendingTimeOff: number;
  /**
   * Pull towards anyone still short of their contracted minimum this week,
   * proportional to how far short they are.
   *
   * Contracted hours are a promise, so they argue against cost here rather than
   * waiting politely for the top-up pass.
   */
  honourContractedMinimum: number;
  /**
   * Bonus for a shift that closes more of the current deficit at once.
   *
   * Two shifts covering one missing hour each spend two people's days; one
   * shift covering both spends one.
   */
  rewardHoursCovered: number;
  /**
   * Bonus for a shift the business actually defined, over a band the generator
   * synthesised to plug a hole.
   *
   * A rota built from the shop's own shifts is one its staff recognise.
   */
  preferKnownShifts: number;

  /**
   * Penalty for taking more of a person's week than the days so far are worth.
   *
   * The generator fills one day at a time and cannot see the days ahead. Left
   * alone it hands out the longest shift that fits, so a week's capacity is
   * spent by Thursday and the shop opens Saturday with whoever still has room
   * -- which was two people, on a day that wanted five.
   *
   * Measured on a real brief (five people, 9-22 Monday to Saturday, busier
   * from 16 to 20): 180 person-hours of demand against 200 of capacity, an
   * even six hours each per day away from a perfect answer, and it finished
   * with six uncovered hours because Monday took eight.
   *
   * A penalty and never a veto: cover is still met if the only way is to
   * overshoot. It just stops being the first choice.
   */
  keepHoursForLaterDays: number;

  // --- Topping people up to the hours their contract promised. ------------

  /** Penalty per hour a shift would carry somebody PAST the base still owed. */
  avoidOvershootingBase: number;
  /**
   * Penalty per hour still missing after the shift.
   *
   * Deliberately weaker than overshooting: hours can be added tomorrow, but
   * hours already worked cannot be handed back.
   */
  avoidStoppingShort: number;
  /**
   * `spreadHours`, in the top-up pass.
   *
   * Weaker than its twin above, and not derived from it. In the coverage pass
   * fairness argues against money; here everybody still in the running is
   * already under their base, so it only breaks ties between them.
   */
  spreadHoursWhenToppingUp: number;
  /** Pull towards whoever has the most hours left to reach their base. */
  urgencyOfRemainingBase: number;
  /**
   * `wageSensitivity`, in the top-up pass.
   *
   * Near zero on purpose: these hours are owed whatever they cost, so price
   * only separates candidates that are otherwise indistinguishable.
   */
  wageSensitivityWhenToppingUp: number;
  /** `preferKnownShifts`, in the top-up pass. */
  preferKnownShiftsWhenToppingUp: number;

  // --- Both passes. -------------------------------------------------------

  /**
   * How much the unsocial hours somebody already has count against giving them
   * more: per night or weekend hour of the shift on offer, times the share of
   * the hours this person has worked so far this period that were night or
   * weekend work.
   *
   * `spreadHours` for the hours nobody would pick. It is what stops the person
   * whose contract pays no night premium -- and so is cheapest at night --
   * from working every night there is; see `beats` in ./generate for why the
   * premium itself never gets into the score to argue the other way.
   */
  spreadUnsocial: number;
  /**
   * Reluctance to cross the weekly overtime threshold.
   *
   * One field for both passes because "how much this business dislikes paying
   * overtime" is a single decision about the business, not two.
   */
  overtimeAversion: number;
}

export interface SchedulingSpec {
  /** Opening minute of the day (0..1440). */
  openMin: number;
  /** Closing minute (may be 1440 = midnight, or > 1440 for after-midnight). */
  closeMin: number;
  /** Minimum employees covering every open hour. */
  minStaff: number;
  peak: { startMin: number; endMin: number; staff: number } | null;
  /** Weekdays the business is closed (0 = Sunday). */
  closedWeekdays: number[];
  maxHoursPerWeek: number;
  minRestHours: number;
  /**
   * What the law where this business is requires, from the rules table on the
   * server (see backend services/labour_floor). All optional: a jurisdiction
   * with nothing seeded leaves them undefined and every reader keeps the
   * default it always had, so no existing customer's calendar changes.
   */
  /** Ordinary hours one person may work in one day. */
  maxDailyHours?: number | null;
  /** Hours of unbroken rest owed every week (Spain: 36 -- a day and a half). */
  weeklyRestHours?: number | null;
  /** Ceiling on the average length of a night worker's day (Spain: 8). */
  nightAverageMax?: number | null;
  /** The window that counts as night work, in hours of the day. */
  nightWindow?: { startHour: number; endHour: number } | null;
  /** Overtime hours one person may work in a year (Spain: 80). */
  annualOvertimeCap?: number | null;
  /**
   * The contracted week read as an ANNUAL AVERAGE rather than a ceiling
   * (Spain: 40, art. 34.1 ET).
   *
   * The presence of this figure is what changes how a long week is judged. A
   * jurisdiction that states it is saying the year is the unit: 45 hours one
   * week and 35 the next is forty a week, and neither is a breach. A
   * jurisdiction that does not leaves the weekly ceiling exactly where it was.
   */
  weeklyAverageHours?: number | null;
  /** Hours of effective work a full year is, where an agreement fixes one. */
  annualHours?: number | null;
  /** Share of the year that may be distributed irregularly (Spain: 0.10). */
  irregularPct?: number | null;
  /** Days of notice owed before a shift (Spain: 5, art. 34.2 ET). */
  irregularNoticeDays?: number | null;
  /**
   * What an overtime hour multiplies the ordinary rate by, where the law sets
   * one. Null is Spain saying there is no statutory premium -- paid as an
   * ordinary hour, or given back as time off -- and is NOT "unknown".
   */
  overtimeMultiplier?: number | null;
  /**
   * Coverage beyond the flat minimum, scoped by weekday/date/window.
   * Optional so a spec persisted before this field existed still loads.
   */
  coverage?: CoverageReq[];
  /** Per-weekday opening hours that override openMin/closeMin. */
  dayHours?: DayHours[];
  /** One-off closures (YYYY-MM-DD), e.g. a public holiday. */
  closedDates?: string[];
  /**
   * Weekdays the brief ranked as BUSIER without saying how many people.
   *
   * It used to ride along unenforced, so the UI could ask for the number once.
   * The server now assumes one more than the floor for those days and reports
   * the assumption, because a question about a calendar nobody can see is
   * answered worse than a calendar that is visibly wrong. So this is no longer
   * the input to a question: it is the sentence behind a coverage rule the
   * manager can see, and it stays in the spec so the UI can say which days the
   * assumption came from.
   */
  busyWeekdays?: number[];
  /** Preferred shift length in hours, when the brief asks for one. */
  shiftLengthHours?: number | null;
  /**
   * May one person work two separate shifts in the same day?
   *
   * Off by default, because a split day is something a manager has to offer
   * rather than something a scheduler should impose. When the brief allows it
   * ("turnos partidos"), it also lifts the real cap on a working week: without
   * it nobody can exceed one shift a day, which tops a week out well below
   * what a full-time contract needs.
   */
  allowSplitShifts?: boolean;
  /**
   * How many people may work a split day, PER DAY. Not whether.
   *
   * `allowSplitShifts` was the wrong shape for what a manager means. "Puede
   * haber gente que haga turnos partidos" permits a split; it does not ask for
   * a rota where everybody works two halves every day, which is what an
   * unlimited flag produced. Allowing something is not requesting it.
   *
   * 0 — nobody. 1 — what a brief that permits splits without a number means.
   * N — what the manager actually said.
   */
  splitShiftPeople?: number;
  /**
   * How many months forward the brief asked the calendar to cover.
   *
   * The horizon used to be the manager's toolbar choice alone, so "cover the
   * next five months" was understood by the intake and then had nowhere to go
   * but `notes`. When the brief says it, the brief wins.
   */
  horizonMonths?: number | null;
  /**
   * The first day to cover, "YYYY-MM-DD", when the brief names WHEN.
   *
   * "Solo el mes de octubre" says nothing about how long and everything about
   * which -- the two are different questions, and only the first had a field.
   * With a start, the calendar moves to it rather than starting wherever the
   * toolbar happened to be pointing.
   */
  horizonStart?: string | null;
  rules: ManagerRule[];
  /** Requirements the intake understood but could not express as rules. */
  notes?: string[];
  /**
   * The minute at which one working day becomes the next.
   *
   * Midnight (0) for a bakery, six in the morning for a bar. It is what makes
   * "we close on Mondays" unambiguous for a business whose Monday ends at four
   * on Tuesday morning, and what lets an employee see "Friday night" for a
   * shift the calendar files under Friday and the clock files under Saturday.
   *
   * NOT a re-indexing of the schedule. A shift already belongs to the day it
   * STARTS on, and the generator only ever starts one inside the opening
   * window, so for the rota itself the boundary is already the opening hour.
   * This is for the questions the rota cannot answer on its own: which working
   * day a wall-clock instant falls in, and -- once the closing shift has a
   * definition -- which shift is the one nobody wants.
   *
   * Optional, defaulting to 0, so a spec from a backend that predates the
   * field behaves exactly as it always has.
   */
  dayBoundaryMin?: number;
  /**
   * The weekdays that carry weekend cover, weekend-premium shifts and weekend
   * pay, as 0 = Sunday.
   *
   * Saturday and Sunday for a shop, Friday and Saturday for a bar, and neither
   * for an office that pays no differential. It was `weekday === 0 || 6`
   * written into four different files, one of which decides what people are
   * paid, so a bar lost the Friday night it staffs hardest and paid a premium
   * for the Sunday it barely opens.
   *
   * Optional, defaulting to `[0, 6]`, which is what those four sites said.
   */
  weekendDays?: number[];
  /**
   * What to optimise for, when more than one legal rota exists.
   *
   * Optional for the same reason `coverage?` is: the spec is built server-side
   * and arrives over the wire, so a backend that predates this field has to
   * keep producing calendars rather than an error. Unset means
   * `DEFAULT_OBJECTIVE` -- see ./objective.
   */
  objective?: SchedulingObjective;
}

export interface CoverageGap {
  date: string;
  hour: number;
  have: number;
  need: number;
}

export interface ScheduleResult {
  assignments: Assignment[];
  gaps: CoverageGap[];
  /** Total marginal cost across the horizon. */
  totalCost: number;
  totalHours: number;
  overtimeHours: number;
  /** Hours assigned per employee id. */
  hoursByEmployee: Record<string, number>;
  /** Employee ids that ended below their contracted minimum. */
  belowMinimum: string[];
}
