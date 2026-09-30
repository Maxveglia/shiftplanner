"""The working year: what somebody has actually worked against what they owe.

WHY THIS EXISTS. Every hours check this product had before was a check on a
WEEK. `validate.ts` compares each week against a ceiling, the generator
accumulates per week, the day grid prints "40h/sem" beside a name. That is the
right shape for the FLSA, where the week is the unit the law reasons in.

It is the wrong shape for Spain. Art. 34.1 ET makes the contracted week an
ANNUAL AVERAGE: forty hours a week, measured over the year. A 45-hour week is
lawful if a 35-hour week answers it, and calling the first one a breach -- which
is what this product did until now -- tells a Barcelona manager their legal rota
is illegal. The unit of judgement has to be the year, so something had to hold
the year, and nothing did.

WHOSE WEEK IS THE MEASURE. Art. 35.1 ET defines an extra hour as one worked
"sobre la duracion maxima de la jornada ordinaria" -- and that maximum is the
one in THIS PERSON'S CONTRACT, not the statutory forty and not the 1,783 hours
the convenio sets for a full-time year. Reading the statutory figure as though
it were everybody's contract is how somebody on twenty hours a week could work
thirty-five every week of the year and generate no extra hour anywhere in this
product: their excess was measured against a full-timer's year.

So the contract is the line, and it is a DIFFERENT line for each person. The
year is still what the average is taken over (art. 34.1), but a 20-hour
contract averages twenty.

WHAT STILL IS NOT AN EXTRA HOUR. Two things, and only these two, because they
are the two the law names:

  - Hours worked back against a day off that was granted as recoverable. The
    employee is repaying time already enjoyed, so they are ORDINARY.
  - Hours the employer moved under the irregular distribution of art. 34.2 --
    a tenth of the year, no more, AND no more than the year actually gives
    back. Those are ordinary hours worked early, and a short week answers them.
    Past that tenth, or past what the year returned, there is nothing left to
    call them but extraordinary.

TWO QUESTIONS, NOT ONE, AND THE HIGHER ANSWER WINS. This is the part that is
easy to get half right, and this module has now been wrong in both directions.

    the week    was this week above the contracted week?
    the year    has this person worked more hours than their year holds?

They come apart because the two figures are not the same shape. The convenio's
year is 1,783 hours; 40 hours times 52 weeks is 2,080. The 297 hours between
them are the holidays and the public days the annual figure already excludes.
So a full-timer can work forty hours in forty-nine weeks, never exceed their
contracted week once, and finish 177 hours above the year they signed for --
invisible to the week. And a part-timer can work half again their contract
every single week while their year is still far out of reach -- invisible to
the year, which is how this module shipped.

The running total of extra hours is the HIGHER of the two readings, never the
sum: they are two views of the same hours.

WHAT A PART-TIMER'S EXCESS IS CALLED. Not overtime: art. 12.4.c ET forbids
extra hours on a part-time contract outright, save for the force majeure of
art. 35.3. What they work above their contract are HORAS COMPLEMENTARIAS, they
need a written pact to be owed at all, and they carry their own ceilings
(art. 12.5). Calling them overtime would name an unlawful thing after a lawful
one, so this module does not.

WHAT IT REFUSES TO DO.

It does not read the database, or the clock. Every input arrives as a value.
Without Postgres this repository skips 93 tests and still reports green, so a
module that needs a database to be tested is a module that silently stops being
tested; this one can be exercised from a dataclass and a list.

It does not repair anything, for the reason `validate.ts` gives: deciding what
to do about a breach depends on which breach it is, and mixing that in here
would make the check itself unverifiable.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Collection, Dict, FrozenSet, List, Optional, Sequence, Tuple

# How a week is keyed. Monday-anchored, which is what the rest of the product
# does (`startOfWeek` in frontend/src/lib/schedule/generate.ts) -- two anchors
# would put two different "week totals" on one screen.
#
# IT USED TO BE SUNDAY, inherited from the FLSA overtime week this began life
# as, and that was not a formatting preference. The weekly rest (36 unbroken
# hours, art. 37.1 ET) is the longest gap INSIDE one week, so a Sunday cut
# sliced the weekend in two and judged the smaller half: Monday-to-Friday
# work, which rests 64 hours, was read as 33 and reported as a breach that was
# not there.


def week_start(day: date) -> date:
    """The Monday on or before ``day``."""
    # date.weekday() is already Monday=0..Sunday=6.
    return day - timedelta(days=day.weekday())


@dataclass(frozen=True)
class WorkedShift:
    """One shift, reduced to what the working year cares about.

    ``published_at`` is the moment the team could first read this shift, and it
    is None while it is still a draft. A draft owes nobody notice yet, which is
    why the notice rule below skips it rather than reporting every unpublished
    shift as short notice.
    """

    employee_id: str
    day: date
    hours: float
    published_at: Optional[datetime] = None


@dataclass(frozen=True)
class RecoverableDay:
    """A day off that was granted on the understanding it would be worked back.

    ``hours`` is what was excused, not the length of a standard day: half a day
    off owes half a day back.
    """

    employee_id: str
    day: date
    hours: float


@dataclass(frozen=True)
class AbsenceDay:
    """One calendar day somebody was approved to be away.

    A day, not a range, because the obligation is priced by calendar day and a
    range would have to be expanded here anyway -- and expanding it at the
    edge, where the database row is, is what keeps this module free of the
    question "which timezone was that range stored in?".

    ``recoverable`` is the only thing the pace cares about. Leave that is
    worked back still owes its hours; leave that is not owes nothing, and that
    is what stops a fortnight in August reading as a fortnight of shortfall.
    """

    employee_id: str
    day: date
    #: Whether these hours are owed back later (a "recoverable" absence type).
    recoverable: bool = False


def excused_days(
    absences: Sequence[AbsenceDay], employee_id: str
) -> FrozenSet[date]:
    """The days this person owes no hours for at all.

    Approved, and NOT recoverable. A set, so that two absences recorded over
    the same day -- a half day of leave logged twice, a correction left
    standing -- discount it once. See `contract_pace_hours` for why that
    matters beyond tidiness: the additivity the three balance tabs rest on
    only holds if a day can be excused at most once.
    """
    return frozenset(
        a.day
        for a in absences
        if a.employee_id == employee_id and not a.recoverable
    )


@dataclass(frozen=True)
class RecoveryCredit:
    """One stretch of hours worked back, and the day off it answers.

    This is the link art. 34 asks for when a day off is granted as recoverable:
    five hours excused in March and five hours worked in April are the same
    five hours, and saying so is what stops them being counted a second time as
    overtime.
    """

    #: The week the hours were worked in.
    week: date
    #: The day off being repaid.
    day_off: date
    hours: float


@dataclass(frozen=True)
class WorkdayLimits:
    """The figures this business is judged against, all of them optional.

    Optional is the whole design. A missing figure leaves the corresponding
    check unrun, which is how a jurisdiction nobody has seeded behaves exactly
    as it did before this module existed -- the same contract
    `services/labour_floor.py` makes.
    """

    #: The contracted week as an annual average (Spain: 40).
    weekly_average_hours: Optional[float] = None
    #: Hours of effective work a full year is, where an agreement fixes one.
    annual_hours: Optional[float] = None
    #: Share of the annual hours that may be distributed irregularly (0.10).
    irregular_pct: Optional[float] = None
    #: Days of notice owed before a shift (5).
    irregular_notice_days: Optional[float] = None
    #: Ordinary hours one person may work in one day (9).
    max_daily_hours: Optional[float] = None
    #: Hours between the end of one shift and the start of the next (12).
    min_rest_hours: Optional[float] = None

    # --- What happens to the hours above the contract (art. 35, art. 12.5) ---

    #: Extra hours one person may work in a year (art. 35.2: 80). Reduced in
    #: proportion for a contract whose year is shorter than the general one,
    #: which is what that article says in its second sentence.
    annual_overtime_cap: Optional[float] = None
    #: Months within which an extra hour compensated by rest stops counting
    #: towards that cap (art. 35.1 and 35.2: 4).
    overtime_compensation_months: Optional[float] = None
    #: Whether a part-time contract may work extra hours at all. False is
    #: Spain (art. 12.4.c), and it is what turns an excess into complementary
    #: hours instead of overtime.
    part_time_overtime_allowed: bool = True
    #: Least contracted week from which complementary hours may be agreed at
    #: all (art. 12.5.a: 10 hours, in annual terms).
    complementary_min_weekly: Optional[float] = None
    #: Share of the contracted hours that may be agreed as complementary
    #: (art. 12.5.c: 0.30).
    complementary_pct_max: Optional[float] = None
    #: The ceiling a convenio colectivo may raise that share to (0.60). Read
    #: only to judge a PACT that claims more than the statute allows.
    complementary_pct_max_by_agreement: Optional[float] = None
    #: Voluntary complementary hours, on top of the agreed ones, offered under
    #: art. 12.5.g -- open-ended contracts only (0.15, or 0.30 by convenio).
    voluntary_complementary_pct: Optional[float] = None
    #: Days of notice owed before a complementary hour (art. 12.5.d: 3).
    complementary_notice_days: Optional[float] = None


@dataclass(frozen=True)
class ContractTerms:
    """One person's agreement, as the hours rules read it.

    Separate from `WorkdayLimits` because they answer different questions and
    come from different places: the limits are the law where the business is
    and are the same for everybody in it, while these are what THIS person
    signed. Overtime is the point where the two meet -- art. 35.1 measures the
    excess against the contract and art. 35.2 caps it by statute -- and keeping
    them apart is what stops one being read as the other, which is the bug this
    whole module was written to undo.
    """

    #: The ordinary week this person agreed to. The line art. 35.1 draws.
    weekly_hours: float
    #: Share of those hours agreed in writing as complementary, or None where
    #: no pact exists. None is not zero: without a pact the employer may not
    #: require a single complementary hour (art. 12.5), so hours above the
    #: contract of somebody who has none are a finding, not a quota.
    complementary_pct: Optional[float] = None
    #: Whether the contract is open-ended, which is the only kind that may be
    #: offered the VOLUNTARY complementary hours of art. 12.5.g.
    open_ended: bool = True


def full_time_share(terms: "ContractTerms", limits: WorkdayLimits) -> Optional[float]:
    """This contract as a fraction of a full-time one. None when unknowable.

    Capped at 1. A contract above the statutory average is not a person owed
    more than a full year -- it is a contract the statute overrides, and
    `period_balance` already reads it that way.
    """
    full = limits.weekly_average_hours
    if full is None or full <= 0 or terms.weekly_hours <= 0:
        return None
    return min(terms.weekly_hours / full, 1.0)


def is_part_time(terms: "ContractTerms", limits: WorkdayLimits) -> bool:
    """Whether this contract is part-time in the sense art. 12 means.

    Part-time is defined by comparison with a full-time worker doing the same
    job (art. 12.1), and the closest thing this product holds to that
    comparison is the statutory full-time week. Where no such figure is seeded
    nothing is part-time, which keeps an unseeded jurisdiction behaving exactly
    as it did before this existed.
    """
    share = full_time_share(terms, limits)
    return share is not None and share < 1.0 - 1e-9


@dataclass(frozen=True)
class WorkdayError:
    """One rule broken, with the date it was broken on.

    ``detail`` carries numbers, never prose, for the reason `validate.ts`
    states: a validator that emits English either ships untranslated text to a
    Spanish manager or tempts somebody into branching on it. This product reads
    in two languages and the UI holds both.
    """

    rule: str
    day: date
    employee_id: str
    detail: Dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class WeekReport:
    """What one employee's one week looks like against the working year."""

    employee_id: str
    week_start: date
    week_hours: float
    annual_hours_to_date: float
    deviation_vs_average: float
    recovery_hours: float
    #: Hours above the contract that art. 34.2 moved here -- ORDINARY hours
    #: worked early, owed back as a short week. Reported separately from the
    #: extraordinary ones because the two are answered in different ways and
    #: only one of them is capped.
    irregular_hours: float = 0.0
    #: Horas extraordinarias (art. 35). Full-time contracts only.
    overtime_hours: float = 0.0
    #: Horas complementarias (art. 12.5). Part-time contracts only. The two
    #: are never both non-zero on one row: a contract is one or the other.
    complementary_hours: float = 0.0
    #: Of this week's extra hours, those answered by paid rest within four
    #: months (art. 35.1). They are still extra hours; they just stop counting
    #: towards the 80-hour cap, which is what art. 35.2 says in so many words.
    compensated_hours: float = 0.0
    errors: List[WorkdayError] = field(default_factory=list)
    #: Which day off each recovered hour of this week answers.
    recovery_credits: List["RecoveryCredit"] = field(default_factory=list)


def expected_annual_hours(
    limits: WorkdayLimits, contracted_weekly: float
) -> Optional[float]:
    """What a full year of this contract is, in hours.

    An agreement that fixes the year outright wins: ``annual_hours`` is a
    negotiated figure that already accounts for the public holidays and the
    leave of the sector, and deriving a year from a week cannot know either.
    Only when nobody has fixed one is the week multiplied out, and it is
    multiplied by 52 rather than 52.18 because a contract is spoken in whole
    weeks and the fortnight of leave is not worked.

    BUT THE AGREED YEAR IS A FULL-TIME YEAR. The convenio's 1,783 hours
    describe somebody on the full week; half a contract is half of it. Handing
    the whole figure back for a 20-hour contract -- which this function did
    until now -- is what made a part-timer's year unreachable, and an excess
    measured against an unreachable year is an excess that never arrives. So
    the agreed year is taken in the contract's own proportion.
    """
    if limits.annual_hours is not None:
        share = full_time_share(
            ContractTerms(weekly_hours=contracted_weekly), limits
        )
        if share is None:
            return limits.annual_hours
        return limits.annual_hours * share
    if contracted_weekly > 0:
        return contracted_weekly * 52
    return None


@dataclass(frozen=True)
class HourSplit:
    """One week's hours above the contract, told apart by what the law calls them.

    Four names, because Spanish law gives the same arithmetic four different
    consequences and a single "extra hours" figure would hide three of them:

      ``recovery``       ordinary. Time off already enjoyed, being repaid.
      ``irregular``      ordinary. Moved under art. 34.2, answered by a short
                         week later, and capped at a tenth of the year.
      ``overtime``       extraordinary (art. 35). Capped at 80 a year, and
                         only lawful on a full-time contract.
      ``complementary``  horas complementarias (art. 12.5). What a part-timer's
                         excess is, needing a written pact and its own ceiling.

    They sum to the excess they were split from. Nothing is counted twice and
    nothing is dropped, which is the property `report` relies on when it adds
    a year up.
    """

    recovery: float = 0.0
    irregular: float = 0.0
    overtime: float = 0.0
    complementary: float = 0.0

    @property
    def total(self) -> float:
        return self.recovery + self.irregular + self.overtime + self.complementary

    @property
    def ordinary(self) -> float:
        """The hours above the contract that are still ordinary hours."""
        return self.recovery + self.irregular


def classify_week(
    excess: float,
    recovery_owed: float,
    irregular_room: float,
    part_time: bool,
) -> HourSplit:
    """Split one week's hours above the contract into what the law calls them.

    ``excess`` is hours worked beyond THIS PERSON'S contracted week -- art.
    35.1's "duracion maxima de la jornada ordinaria", which is the contract's
    figure and not the statute's. ``recovery_owed`` and ``irregular_room`` are
    what is left of each allowance at the start of this week.

    The ORDER is the rule, and it runs from the hours that cost the employee
    least to the hours that cost them most:

      1. Recovery first. Those hours were already granted as time off; calling
         them extra would charge the employee twice for one day.
      2. Then the irregular distribution, while a tenth of the year remains.
         Art. 34.2 lets the employer move that much around, and moved hours are
         ordinary hours worked early -- which is the whole reason a 45-hour
         week is lawful here.
      3. Whatever is left has no lawful name but the extraordinary one. On a
         part-time contract it cannot even have that (art. 12.4.c), so it is
         complementary instead.

    Reversing 2 and 3 would spend the irregular allowance on hours that were
    going to be ordinary anyway and report overtime that was never worked.
    """
    left = max(excess, 0.0)
    if left <= 0:
        return HourSplit()

    recovery = min(max(recovery_owed, 0.0), left)
    left -= recovery

    irregular = min(max(irregular_room, 0.0), left)
    left -= irregular

    if part_time:
        return HourSplit(recovery=recovery, irregular=irregular, complementary=left)
    return HourSplit(recovery=recovery, irregular=irregular, overtime=left)


def add_months(day: date, months: int) -> date:
    """``day`` plus whole calendar months, clamped to the end of the month.

    Calendar months rather than a fixed number of days because art. 35.1 says
    months: overtime worked on 31 January is compensable until 31 May, and
    counting 122 days would land on a different date every time.
    """
    month = day.month - 1 + months
    year = day.year + month // 12
    month = month % 12 + 1
    # The 31st of a month the target does not have falls back to its last day.
    for dom in range(day.day, 0, -1):
        try:
            return date(year, month, dom)
        except ValueError:
            continue
    raise ValueError("unreachable")


def compensation_schedule(
    overtime_by_week: Sequence[Tuple[date, float]],
    shortfall_by_week: Sequence[Tuple[date, float]],
    months: Optional[float],
) -> Dict[date, float]:
    """Which extra hours were answered by rest, and so stop counting.

    Art. 35.1: absent an agreement to pay them, extra hours are understood to
    be compensated with equivalent paid rest within the FOUR MONTHS following
    the day they were worked. Art. 35.2 then says the compensated ones do not
    count towards the 80-hour cap. So a bar that works somebody four long weeks
    in August and four short ones in September has not eaten into the cap at
    all, and reporting that it has would make the cap fire on rotas that never
    breached it.

    The pairing is FIFO and forward-only, for the reason the article gives:
    rest BEFORE the hours were worked compensates nothing -- it was just a
    quiet week. Returns hours keyed by the week the OVERTIME was worked in,
    because that is the week whose figure changes.

    Nothing is stored. Like `recovery_schedule`, this is recomputed from the
    rota every time, so there is never a second ledger to disagree with it.
    """
    if months is None:
        return {}

    rest = [[w, h] for w, h in sorted(shortfall_by_week) if h > 0]
    out: Dict[date, float] = {}

    for week, hours in sorted(overtime_by_week):
        left = max(hours, 0.0)
        if left <= 0:
            continue
        deadline = add_months(week, int(months))
        for entry in rest:
            if left <= 0:
                break
            if entry[1] <= 0:
                continue
            # Rest in the weeks AFTER the hours, and before the deadline.
            if entry[0] < week or entry[0] > deadline:
                continue
            take = min(entry[1], left)
            entry[1] -= take
            left -= take
            out[week] = out.get(week, 0.0) + take
    return out


def overtime_cap(
    limits: WorkdayLimits,
    terms: ContractTerms,
    cycle_fraction: float = 1.0,
) -> Optional[float]:
    """The year's ceiling on extra hours for THIS contract (art. 35.2).

    Eighty a year, "reducido en la misma proporcion" for somebody whose
    contracted year is shorter than the general one -- so a contract at half
    the full-time week carries forty, not eighty. Without that proportion the
    cap would be most generous exactly where the law is strictest.

    ``cycle_fraction`` is the share of a year the reference period actually
    covers, and it reduces the cap by the same article for the same reason: a
    business whose first rota went up in September is judged over four months,
    and four months of a year do not hold a whole year of extra hours. It is
    1.0 for a full year, which is every year after the first.
    """
    if limits.annual_overtime_cap is None:
        return None
    share = full_time_share(terms, limits)
    if share is None:
        share = 1.0
    return limits.annual_overtime_cap * share * max(cycle_fraction, 0.0)


def complementary_allowance(
    terms: ContractTerms, limits: WorkdayLimits, expected_year: Optional[float]
) -> Optional[float]:
    """Hours a year this part-time contract may be asked to work on top.

    None where the question cannot be answered -- no pact, or no year to take a
    share of -- and None is NOT zero: it means "this product does not know what
    was agreed", which `complementary_errors` reports as its own finding rather
    than silently treating every hour as unlawful.

    The voluntary hours of art. 12.5.g are added only for an open-ended
    contract, because that is the only kind they may be offered on.
    """
    if terms.complementary_pct is None or expected_year is None:
        return None
    pct = terms.complementary_pct
    if terms.open_ended and limits.voluntary_complementary_pct is not None:
        pct += limits.voluntary_complementary_pct
    return expected_year * pct


def recovery_schedule(
    recoverable: Sequence[RecoverableDay], excess_by_week: Sequence[Tuple[date, float]]
) -> List[RecoveryCredit]:
    """Charge each week's excess hours against the oldest unpaid day off.

    Returns the PAIRINGS, not a total: which day off each recovered hour
    answers. A bare sum would be enough to colour a column and not enough to
    settle the only argument this ever has to settle -- an employee asking
    which of their days off they are working back this week, and being owed a
    date rather than a number.

    FIFO, and deliberately so: the day off granted in March is the one being
    worked back in April. Pairing the newest instead would leave the oldest
    debt open forever while the employee kept repaying it.

    Nothing is stored anywhere. The pairing is recomputed from the days off and
    the hours worked every time it is asked for, because a ledger of recovery
    would be a second account of the same facts, and the day the two disagree
    is the day somebody is told they still owe hours they already worked.
    """
    owed = [
        [d.day, d.hours]
        for d in sorted((d for d in recoverable if d.hours > 0), key=lambda d: d.day)
    ]
    out: List[RecoveryCredit] = []

    for week, excess in sorted(excess_by_week):
        left = max(excess, 0.0)
        for entry in owed:
            if left <= 0:
                break
            if entry[1] <= 0:
                continue
            # A day off cannot be worked back before it was granted.
            if entry[0] > week + timedelta(days=6):
                continue
            take = min(entry[1], left)
            entry[1] -= take
            left -= take
            out.append(
                RecoveryCredit(week=week, day_off=entry[0], hours=round(take, 2))
            )
    return out


def recovery_by_week(credits: Sequence[RecoveryCredit]) -> Dict[date, float]:
    """The pairings collapsed to one number per week, for the columns."""
    out: Dict[date, float] = {}
    for credit in credits:
        out[credit.week] = out.get(credit.week, 0.0) + credit.hours
    return out


def notice_errors(
    shifts: Sequence[WorkedShift], limits: WorkdayLimits
) -> List[WorkdayError]:
    """Shifts the team was told about too late.

    Only PUBLISHED shifts are judged. A draft is the manager thinking, and
    reporting it as short notice would fire the warning on every shift the
    moment it was placed -- loudest exactly when it is least true, and the
    manager would learn to ignore it before the one that mattered arrived.
    """
    required = limits.irregular_notice_days
    if required is None:
        return []

    out: List[WorkdayError] = []
    for shift in shifts:
        if shift.published_at is None:
            continue
        told = shift.published_at.date()
        days = (shift.day - told).days
        if days < required:
            out.append(
                WorkdayError(
                    rule="short_notice",
                    day=shift.day,
                    employee_id=shift.employee_id,
                    detail={"days": float(days), "required": float(required)},
                )
            )
    return out


def irregular_excess_error(
    employee_id: str,
    moved_hours: float,
    expected_year: Optional[float],
    limits: WorkdayLimits,
    on: date,
) -> Optional[WorkdayError]:
    """Whether more of the year has been moved around than may be.

    ``moved_hours`` is the sum of how far each week sits from the contracted
    week, counted in one direction only: a week ABOVE the average is the
    employer moving hours into it. The short weeks are not added to the same
    total, because they are what the long weeks are answered by -- counting
    both would charge the same displacement twice.
    """
    if limits.irregular_pct is None or expected_year is None:
        return None
    allowed = expected_year * limits.irregular_pct
    if moved_hours <= allowed:
        return None
    return WorkdayError(
        rule="irregular_share_exceeded",
        day=on,
        employee_id=employee_id,
        detail={
            "moved": round(moved_hours, 2),
            "allowed": round(allowed, 2),
            "pct": limits.irregular_pct,
        },
    )


def overtime_cap_error(
    employee_id: str,
    counted_overtime: float,
    limits: WorkdayLimits,
    terms: ContractTerms,
    on: date,
    cycle_fraction: float = 1.0,
) -> Optional[WorkdayError]:
    """Whether the year's 80 extra hours have been used up (art. 35.2).

    ``counted_overtime`` is the year's overtime MINUS what was compensated
    with rest inside four months, because those hours expressly do not count
    towards the cap. Feeding the gross figure in would fire this on a rota that
    balanced itself perfectly, and a limit that cries wolf is a limit a manager
    learns to click past.
    """
    cap = overtime_cap(limits, terms, cycle_fraction)
    if cap is None or counted_overtime <= cap:
        return None
    return WorkdayError(
        rule="overtime_cap_exceeded",
        day=on,
        employee_id=employee_id,
        detail={"worked": round(counted_overtime, 2), "cap": round(cap, 2)},
    )


def complementary_errors(
    employee_id: str,
    worked_complementary: float,
    expected_year: Optional[float],
    limits: WorkdayLimits,
    terms: ContractTerms,
    on: date,
) -> List[WorkdayError]:
    """What a part-timer's hours above their contract run into (art. 12.5).

    Three separate findings, because they have three separate answers and
    collapsing them into "too many hours" would tell the manager to fix the
    rota when what needs fixing is the contract:

      ``complementary_without_pact``   there is no written pact, so not one of
                                       these hours could lawfully be required.
                                       Sign one, or take the hours off the rota.
      ``complementary_contract_too_short``  the contract is under ten hours a
                                       week, so no pact is possible at all
                                       (art. 12.5.a). Only raising the contract
                                       fixes this one.
      ``complementary_cap_exceeded``   there is a pact and the hours have run
                                       past what it may cover.

    A part-timer's excess is never reported as overtime, however large: art.
    12.4.c forbids extra hours on these contracts, so naming them that would
    put a lawful-sounding label on something that is not.
    """
    out: List[WorkdayError] = []
    if worked_complementary <= 0:
        return out

    minimum = limits.complementary_min_weekly
    if minimum is not None and terms.weekly_hours < minimum:
        out.append(
            WorkdayError(
                rule="complementary_contract_too_short",
                day=on,
                employee_id=employee_id,
                detail={
                    "weekly": round(terms.weekly_hours, 2),
                    "required": float(minimum),
                    "hours": round(worked_complementary, 2),
                },
            )
        )
        return out

    allowed = complementary_allowance(terms, limits, expected_year)
    if allowed is None:
        out.append(
            WorkdayError(
                rule="complementary_without_pact",
                day=on,
                employee_id=employee_id,
                detail={"hours": round(worked_complementary, 2)},
            )
        )
        return out

    if worked_complementary > allowed:
        out.append(
            WorkdayError(
                rule="complementary_cap_exceeded",
                day=on,
                employee_id=employee_id,
                detail={
                    "worked": round(worked_complementary, 2),
                    "allowed": round(allowed, 2),
                },
            )
        )
    return out


def pact_errors(
    employee_id: str, limits: WorkdayLimits, terms: ContractTerms, on: date
) -> List[WorkdayError]:
    """Whether the pact itself claims more than the law allows it to.

    A finding about the CONTRACT rather than about the rota, and it is reported
    even in a week nobody worked an extra minute: a pact for 70% of the hours
    is void above 60% (art. 12.5.c) whether or not anybody has called on it
    yet, and the manager would rather hear that now than the first time they do.
    """
    out: List[WorkdayError] = []
    if terms.complementary_pct is None:
        return out
    ceiling = (
        limits.complementary_pct_max_by_agreement
        if limits.complementary_pct_max_by_agreement is not None
        else limits.complementary_pct_max
    )
    if ceiling is not None and terms.complementary_pct > ceiling + 1e-9:
        out.append(
            WorkdayError(
                rule="complementary_pact_above_statute",
                day=on,
                employee_id=employee_id,
                # As percentages, which is how art. 12.5 says them and how
                # the manager signed them. The fractions are the storage
                # format, not the sentence.
                detail={
                    "agreed": round(terms.complementary_pct * 100, 1),
                    "allowed": round(ceiling * 100, 1),
                },
            )
        )
    return out


def _terms(contract) -> ContractTerms:
    """Accept a contract or the bare weekly figure that used to be passed.

    A number is read as a contract with no complementary pact, which is what a
    number always meant here. Keeping the door open is not sentiment: every
    caller that does not care about part-time rules -- and most of the tests --
    says "40" and means it.
    """
    if isinstance(contract, ContractTerms):
        return contract
    return ContractTerms(weekly_hours=float(contract or 0))


def report(
    employee_id: str,
    contract,
    shifts: Sequence[WorkedShift],
    recoverable: Sequence[RecoverableDay],
    limits: WorkdayLimits,
    weeks: Sequence[date],
    year_start: date,
    excused_weeks: Sequence[date] = (),
    year_end: Optional[date] = None,
    unworked_days: Collection[date] = (),
) -> List[WeekReport]:
    """The working year for one person, one row per week in ``weeks``.

    ``contract`` is a `ContractTerms`, or the bare contracted week where the
    part-time rules do not matter to the caller. It is the line every figure
    below is drawn against: art. 35.1 measures an extra hour against the
    ordinary day THIS CONTRACT fixes, so a 20-hour contract is judged at
    twenty. Reading the statutory 40 here instead -- which this function did
    until now -- is what let a part-timer work half as much again as their
    contract, every week of the year, and generate nothing to report.

    ``shifts`` is the WHOLE year, not just the weeks being reported: an annual
    average cannot be computed from a window, and the caller that hands over
    four weeks of a year gets four weeks' worth of an answer that claims to be
    annual. ``weeks`` is what to report ON; the year is what it is measured
    against.

    ``year_start`` is where the count begins, and it is a parameter rather than
    January because the reference period is not always the calendar year -- a
    convenio can set its own, and a contract signed in March has only ten months
    of year to average over. It is also what makes the deviation mean anything:
    measured from the first week of the window instead, somebody four months
    into a year they were running 30 hours behind would read as perfectly on
    pace, because the window cannot see the hole.

    ``year_start`` and ``year_end`` bound the REFERENCE PERIOD, and they are
    what makes a partial cycle judgeable. A business whose first published rota
    went up in September has four months of record, not twelve, so its people
    are owed four months of the contracted year rather than 1,783 hours they
    could not possibly have worked. Counting from January regardless reported
    everybody more than a thousand hours behind -- all of it accrued before
    there was a calendar at all -- and made this view contradict the balance
    column beside it about the same person. ``year_end`` defaults to a year
    after the start.

    ``excused_weeks`` are weeks the person was away -- holiday, sick leave --
    and they are named so their missing hours are NOT read as compensatory
    rest. Art. 35.1 answers an extra hour with time off given in exchange for
    it; a fortnight of annual leave was owed anyway, and letting it cancel
    August's overtime would empty the 80-hour cap of meaning every summer.

    ``unworked_days`` are the individual days of that leave which are not
    worked back, and they do a different job: they come off the PACE, so that
    ``deviation_vs_average`` reads the same way the roster's balance column
    does. The two live side by side because they answer different questions of
    the same absence -- may it excuse overtime (no), and does it owe hours
    (no) -- and collapsing them into one input would silently make the answer
    to one of them the answer to the other.
    """
    terms = _terms(contract)
    mine = [s for s in shifts if s.employee_id == employee_id]
    my_days = [d for d in recoverable if d.employee_id == employee_id]
    excused = set(excused_weeks)

    by_week: Dict[date, float] = {}
    for shift in mine:
        key = week_start(shift.day)
        by_week[key] = by_week.get(key, 0.0) + shift.hours

    # The reference period, and what the contract asks across it. Where the
    # cycle is a whole year this is exactly `expected_annual_hours`; where it
    # is the four months since the first rota, it is four months' worth.
    cycle_end = year_end if year_end is not None else date(
        year_start.year + 1, year_start.month, year_start.day
    )
    cycle_fraction = min(max((cycle_end - year_start).days, 1) / 365.0, 1.0)
    # THE LEGAL CEILING, deliberately, and not the pace: everything downstream
    # of `expected_year` is a statutory allowance -- the irregular tenth of
    # art. 34.2, the complementary share of art. 12.5 -- and those are shares
    # of the 1,783 hours the convenio agreed, never of the 2,086 a contracted
    # week multiplies out to. Reading the pace here would hand a full-timer
    # three hundred extra lawful hours a year.
    expected_year: Optional[float] = agreed_year_hours_between(
        limits, terms.weekly_hours, year_start, cycle_end
    )
    if expected_year is not None and expected_year <= 0:
        expected_year = None

    # THEIR contract, capped by the statute. The same reading `period_balance`
    # makes, and for the same reason: `weekly_average_hours` is the most a week
    # may average and is one figure for the whole business, so using it as what
    # each person is owed tells every part-timer they are behind.
    weekly = terms.weekly_hours
    if limits.weekly_average_hours is not None and weekly > 0:
        weekly = min(weekly, limits.weekly_average_hours)

    part_time = is_part_time(terms, limits)

    # A contract that states no hours states no ordinary day, and art. 35.1
    # measures the excess against the ordinary day. So there is nothing here to
    # call extra -- reporting every hour as extraordinary because the contract
    # is silent would be the loudest possible way of saying "unknown".
    judged = weekly > 0

    # How much each week was pushed ABOVE the contracted week. This is the
    # displacement art. 34.2 caps, and it is why the shortfalls are not added
    # in: a 35-hour week is the answer to a 45-hour one, not a second move.
    excess_by_week = [
        (week, max(hours - weekly, 0.0) if judged else 0.0)
        for week, hours in by_week.items()
    ]
    credits = recovery_schedule(my_days, excess_by_week)
    credited = recovery_by_week(credits)
    credits_by_week: Dict[date, List[RecoveryCredit]] = {}
    for credit in credits:
        credits_by_week.setdefault(credit.week, []).append(credit)

    # The tenth of the year art. 34.2 lets the employer move around. Where no
    # such rule is seeded the room is nil rather than unlimited, which is the
    # strict reading: without a rule permitting the displacement, an hour above
    # the contract is simply an hour above the contract.
    irregular_room = (
        expected_year * limits.irregular_pct
        if limits.irregular_pct is not None and expected_year is not None
        else 0.0
    )

    # AND NO MORE THAN THE YEAR CAN GIVE BACK.
    #
    # Art. 34.2 permits the displacement on one condition: a short week answers
    # the long one, inside the year. Hours the year never gives back were not
    # displaced, they were simply worked, and art. 35 has the only name left
    # for them. So the allowance is cut by whatever the year ends up above its
    # own total.
    #
    # Without this the same Saturday was printed twice -- once as an hour moved
    # under art. 34.2 and again as an extra hour once the annual total was
    # passed -- and the columns added up to more hours than anybody worked.
    #
    # It reads the rota as it stands, which is the only thing that can be read.
    # Mid-year, with the autumn not yet written, nothing says the hours will
    # not be given back and the whole allowance is offered; as the calendar
    # fills in and the year stays high, the allowance closes behind it.
    if expected_year is not None and by_week:
        worked_all = sum(by_week.values())
        above_contract = sum(excess for _, excess in excess_by_week)
        never_returned = max(worked_all - expected_year, 0.0)
        irregular_room = max(min(irregular_room, above_contract - never_returned), 0.0)

    # Every week of the year split once, in order, so each week sees what the
    # weeks before it already spent of the two allowances.
    splits: Dict[date, HourSplit] = {}
    recovery_left = dict(credited)
    room_left = irregular_room
    for week in sorted(by_week):
        excess = max(by_week[week] - weekly, 0.0) if judged else 0.0
        split = classify_week(
            excess=excess,
            recovery_owed=recovery_left.get(week, 0.0),
            irregular_room=room_left,
            part_time=part_time,
        )
        room_left = max(room_left - split.irregular, 0.0)
        splits[week] = split

    # Extra hours answered by paid rest within four months (art. 35.1).
    #
    # Every week of the observed stretch, not just the weeks with shifts in
    # them: a week with no shifts at all is the plainest compensatory rest
    # there is, and reading the shortfall off `by_week` alone -- which holds
    # only the weeks somebody worked -- missed exactly that case. The stretch
    # runs from the first week worked to the last week worked OR reported on,
    # because beyond that there is no rota to call rest: an empty December in
    # a calendar nobody has filled in yet is not time off, it is a blank.
    #
    # The weeks somebody was away are not offered as rest: see ``excused_weeks``.
    shortfall_by_week: List[Tuple[date, float]] = []
    if judged and by_week:
        first = min(by_week)
        last = max(max(by_week), max(weeks) if weeks else min(by_week))
        cursor = first
        while cursor <= last:
            if cursor not in excused:
                shortfall_by_week.append(
                    (cursor, max(weekly - by_week.get(cursor, 0.0), 0.0))
                )
            cursor = cursor + timedelta(days=7)
    compensated = compensation_schedule(
        [(w, sp.overtime + sp.complementary) for w, sp in splits.items()],
        shortfall_by_week,
        limits.overtime_compensation_months,
    )

    notice = notice_errors(mine, limits)
    notice_by_week: Dict[date, List[WorkdayError]] = {}
    for err in notice:
        notice_by_week.setdefault(week_start(err.day), []).append(err)

    # --- The year's own total, which the weekly reading cannot see ---------
    #
    # Two questions have to be asked, not one, and this is the second.
    #
    # The weekly split above asks "was this week above the contracted week?".
    # The year asks "has this person now worked more hours than their year
    # holds?", and the answers come apart because the two figures are not the
    # same shape: the convenio's year is 1,783 hours, while 40 hours times 52
    # weeks is 2,080. The 297 hours between them are the holidays and the
    # public days -- time the year already excludes and the week knows nothing
    # about. So somebody can work forty hours in forty-nine weeks, never exceed
    # their contracted week once, and still finish 185 hours above the year
    # they were contracted for. Asked only week by week, that person's rota
    # came back with nothing on it at all.
    #
    # Asking only the year is the opposite failure, and it is the one this
    # module shipped with: a part-timer worked half again as hard every single
    # week goes unremarked while their (full-time) year is still out of reach.
    #
    # So both. The running total of extra hours is the HIGHER of the two
    # readings, never their sum -- they are two views of the same hours, and
    # adding them would charge the employer twice for one Saturday.
    def _annual_excess(upto: date) -> float:
        if expected_year is None or not judged:
            return 0.0
        worked = sum(h for w, h in by_week.items() if w <= upto)
        return max(worked - expected_year, 0.0)

    first_week = week_start(year_start)

    out: List[WeekReport] = []
    previous_extra = 0.0
    for week in sorted(weeks):
        week_hours = by_week.get(week, 0.0)
        split = splits.get(week, HourSplit())

        # Everything up to and including this week. Sorted so "to date" means
        # what it says however the caller ordered its input.
        to_date = sum(h for w, h in by_week.items() if w <= week)
        # THE PACE, because this is a position and not a ceiling: "am I
        # keeping up with my contract?", asked one week at a time. It is the
        # same function the roster's balance column and the summary above this
        # view use, and it has to be -- one product, one answer about one
        # person, whichever screen is asking.
        expected_so_far = contract_pace_hours(
            limits,
            terms.weekly_hours,
            first_week,
            week + timedelta(days=7),
            unworked_days,
        )

        # What the weeks alone have found, and what the year alone has found.
        weekly_extra = sum(
            sp.overtime + sp.complementary for w, sp in splits.items() if w <= week
        )
        extra_to_date = max(weekly_extra, _annual_excess(week))

        # Reported per week, like the hours beside them. The allowance above
        # already guarantees these are different hours, so the two columns and
        # the recovery beside them add up to the hours actually worked over the
        # contract -- no more and no fewer.
        extra_this_week = max(extra_to_date - previous_extra, 0.0)
        moved_this_week = split.irregular
        previous_extra = extra_to_date

        errors: List[WorkdayError] = list(notice_by_week.get(week, []))
        moved_so_far = sum(
            excess for w, excess in excess_by_week if w <= week
        )
        breach = irregular_excess_error(
            employee_id, moved_so_far, expected_year, limits, week
        )
        if breach is not None:
            errors.append(breach)

        if part_time:
            errors.extend(
                complementary_errors(
                    employee_id,
                    extra_to_date,
                    expected_year,
                    limits,
                    terms,
                    week,
                )
            )
        else:
            # Net of the rest that answered them, which is the figure art. 35.2
            # caps rather than the gross one.
            given_back = sum(
                hours for w, hours in compensated.items() if w <= week
            )
            cap = overtime_cap_error(
                employee_id,
                max(extra_to_date - given_back, 0.0),
                limits,
                terms,
                week,
                cycle_fraction=cycle_fraction,
            )
            if cap is not None:
                errors.append(cap)
        errors.extend(pact_errors(employee_id, limits, terms, week))

        out.append(
            WeekReport(
                employee_id=employee_id,
                week_start=week,
                week_hours=round(week_hours, 2),
                annual_hours_to_date=round(to_date, 2),
                deviation_vs_average=round(to_date - expected_so_far, 2),
                recovery_hours=round(split.recovery, 2),
                irregular_hours=round(moved_this_week, 2),
                overtime_hours=0.0 if part_time else round(extra_this_week, 2),
                complementary_hours=(
                    round(extra_this_week, 2) if part_time else 0.0
                ),
                compensated_hours=round(compensated.get(week, 0.0), 2),
                errors=errors,
                recovery_credits=credits_by_week.get(week, []),
            )
        )
    return out


# --- Balances over a stretch, for the roster ---------------------------------


@dataclass(frozen=True)
class Balance:
    """Where one person stands over one stretch of the year.

    The same three numbers `WeekReport` carries, asked of a month, a quarter or
    a year instead of a week -- because "is Ana short of hours?" is a question
    about a period a payslip recognises, and a row of weeks does not answer it
    at a glance.

    WHAT COUNTS AS WORKED, AND WHY IT IS ONLY THE PUBLISHED ROTA. A draft is
    the manager thinking. Letting it move the balance means the figure the
    manager is planning against changes underneath them as they plan, and two
    managers with two drafts would each see a different answer to a question
    about hours already owed. So the balance is settled by publishing, and the
    draft is reported beside it rather than inside it -- see ``drafted``.
    """

    worked: float
    #: What the contract asks for over the part of the stretch that has passed.
    expected: float
    #: worked - expected. Positive is ahead, negative is behind. THE settled
    #: figure: published hours only.
    deviation: float
    #: Published hours over the WHOLE stretch, worked or still to come.
    #: What `worked` becomes if nothing changes -- which is the question a
    #: manager asks in the middle of a month: is it filled in yet?
    planned: float
    #: What the contract asks for over the part of the stretch that has been
    #: MEASURED -- `start` to `horizon`. The end of the bar.
    total: float
    #: Published hours inside the window being edited, if one was named.
    #: Subtracted by the client when it projects a draft: the draft REPLACES
    #: the published rota for those dates, it does not pile on top of it.
    published_in_window: float
    #: Whether the stretch is over. A closed month is a verdict; the current
    #: one is a position, and the difference matters to whoever reads it.
    complete: bool
    #: Where this stretch actually starts counting from -- see
    #: `effective_start`. Sent so a screen can say "desde el 1 sep" rather
    #: than implying a January nobody worked in this product.
    start: Optional[date] = None
    #: What the contract asks for over the REST of the stretch: `horizon` to
    #: its end, the part nobody has written a rota for yet. Kept apart from
    #: `total` rather than added to it, because an unplanned November is not a
    #: shortfall -- it is a November. Folding it in is how a quarter asked
    #: about in October came back "-416 h" for hours nobody had had the chance
    #: to plan, a figure indistinguishable from a real hole.
    pending: float = 0.0
    #: The exclusive end of the MEASURED part: where the rota, today and the
    #: window being edited run out. `total` stops here and `pending` starts.
    horizon: Optional[date] = None
    #: Published hours over the WHOLE stretch, `start` to its end, the horizon
    #: notwithstanding. The other half of `total + pending`: that is what the
    #: contract asks for over the stretch, this is what the rota holds over
    #: the same days. `planned` stops at the horizon, so a December published
    #: ahead of an empty November is in this and not in that -- and a screen
    #: that says "X of Y hours" needs X and Y to cover the same calendar.
    planned_stretch: float = 0.0


# --- Two obligations, and the reason they are two ----------------------------
#
# There are two different questions a stretch of the calendar can be asked
# about somebody's contract, they have two different answers, and this module
# spent a release answering both with one function. The bug that came out of
# it is on a screenshot: a 40-hour contract, planned at exactly 40 hours every
# week of October, reported as +15 h over. Nobody had worked an extra minute.
#
#   THE PACE -- `contract_pace_hours`. "Am I keeping up with my contract?"
#   The contract says forty hours a week, so a 31-day October asks for
#   40 x 31/7 = 177.14 h. This is what a BALANCE is measured against, on the
#   roster, in the planner's "if you publish" column and in the annual-workday
#   summary. It has to be the figure the generator plans to, or a rota that
#   honours the contract exactly reads as a breach of it.
#
#   THE LEGAL CEILING -- `agreed_year_hours_between`. "How much of my year is
#   left before the law starts calling these hours something else?" The
#   convenio fixes 1,783 hours of EFFECTIVE WORK a year, holidays and public
#   days already taken out, and that figure -- never the pace -- is what feeds
#   the irregular tenth of art. 34.2, the extraordinary hours of art. 35 and
#   the complementary ones of art. 12.5.
#
# THE GAP BETWEEN THEM IS NOT AN ERROR, IT IS THE HOLIDAY. 40 x 365/7 is 2,086
# and the convenio's year is 1,783; the 300 hours between them are the leave
# and the public days somebody does not work. Which means the pace is only
# honest if the days off are taken OUT OF THE PACE when they happen -- see
# ``excused`` below -- rather than smeared over every day of the year in
# advance, which is what reading the annual figure as a pace amounted to. A
# manager plans a month, not a 34.2-hour abstraction of one.
#
# So: two functions, two names, and neither of them may be quietly swapped for
# the other. A balance that used the ceiling libels everybody who works their
# contract; a ceiling that used the pace would hand a full-timer 2,086 lawful
# hours a year and let 300 hours of overtime through unnamed.


def contract_pace_hours(
    limits: WorkdayLimits,
    contracted_weekly: float,
    start: date,
    end: date,
    excused: Collection[date] = (),
) -> float:
    """The RHYTHM: what this contract asks for over `[start, end)`.

    The contracted week, spread over calendar days: ``weekly * days / 7``. A
    week is seven days whichever of them the rota puts the shifts on, so this
    is additive over any way of cutting the stretch up -- month by month adds
    to the quarter, quarter by quarter adds to the year -- which is the
    property the balance column's three tabs rest on.

    Capped by ``weekly_average_hours`` where the law states one: a contract
    that claims 60 hours a week is not somebody owed sixty, it is a contract
    the statute overrides.

    ``excused`` are days this person owes NOTHING for -- approved leave of a
    kind that is not worked back. They are subtracted as whole calendar days
    at ``weekly / 7`` each, because that is how the rest of this function
    prices a day. Counted as a SET, so two absences that overlap discount the
    day once; without that the subtraction stops being additive and the
    invariant `total + pending == the whole stretch` breaks.

    Recoverable leave is deliberately NOT excused: those hours are owed back,
    the recovery circuit in `recovery_schedule` already tracks them, and
    dropping the obligation here would forgive the debt twice.
    """
    days = max((end - start).days, 0)
    if days == 0:
        return 0.0
    weekly = contracted_weekly
    if limits.weekly_average_hours is not None and weekly > 0:
        weekly = min(weekly, limits.weekly_average_hours)
    if weekly <= 0:
        return 0.0
    owed = days - len({d for d in excused if start <= d < end})
    return weekly * (max(owed, 0) / 7.0)


def agreed_year_hours_between(
    limits: WorkdayLimits,
    contracted_weekly: float,
    start: date,
    end: date,
) -> float:
    """The LEGAL CEILING: this contract's share of the agreed year, prorated.

    The convenio's 1,783 hours are the year art. 34.2, art. 35 and art. 12.5
    are measured against, and this is how much of that year a stretch is. Not
    a balance: see the note above this function for why the two are separate,
    and do not reach for this one to answer "is Ana short of hours?".

    Prorated by CALENDAR DAYS, each year counted by its own length so that a
    leap year does not owe 366/365 of an agreement that fixes a year. Where no
    annual figure is fixed anywhere the contracted week is multiplied out
    instead -- the old reading, kept so that a jurisdiction nobody has written
    down behaves exactly as it did before any of this existed.
    """
    days = max((end - start).days, 0)
    if days == 0:
        return 0.0
    # Only an AGREED year replaces the week. `expected_annual_hours` would
    # happily multiply the week out to 52 and hand it back, and spreading that
    # over 365 days quietly shaves a tenth of an hour off every week for no
    # reason -- an unwritten jurisdiction should behave exactly as before.
    if limits.annual_hours is not None:
        year = expected_annual_hours(limits, contracted_weekly)
        if year is not None:
            return year * _share_of_years(start, end)
    weekly = contracted_weekly
    if limits.weekly_average_hours is not None and weekly > 0:
        weekly = min(weekly, limits.weekly_average_hours)
    return weekly * (days / 7.0)


def _share_of_years(start: date, end: date) -> float:
    """How many calendar years `[start, end)` is, each year counted by its own length.

    Dividing by 365 made a whole leap year worth 366/365 of the agreed figure:
    2028 would have owed 1,787.9 hours on a 1,783-hour convenio. The agreement
    fixes a YEAR, so every day is its own year's share of it.
    """
    share = 0.0
    cursor = start
    while cursor < end:
        next_year = date(cursor.year + 1, 1, 1)
        stop = min(end, next_year)
        length = (next_year - date(cursor.year, 1, 1)).days
        share += (stop - cursor).days / length
        cursor = stop
    return share


def effective_start(
    stretch_start: date,
    cycle_start: Optional[date],
    contract_start: Optional[date],
) -> date:
    """Where a stretch actually starts counting: the LATEST of the three.

    A balance can only count time this product could see. Counted from the 1st
    of January regardless, somebody hired in June owes six months they were not
    employed for, and a business that published its first rota in September
    owes eight months that happened before it had a calendar at all -- which is
    how a roster came to show -1,480 h beside four names who owed nothing.

    So: the stretch itself, the day the contract began, and the day the
    business first published a rota. The last of them to arrive is where the
    counting starts, and every one of the three is a real boundary rather than
    a fudge -- before any of them there is no obligation, no employment, or no
    record.
    """
    out = stretch_start
    for candidate in (cycle_start, contract_start):
        if candidate is not None and candidate > out:
            out = candidate
    return out


def quarter_of(day: date) -> int:
    """1-4, on calendar quarters -- which is what an accountant means."""
    return (day.month - 1) // 3 + 1


def quarter_bounds(year: int, quarter: int) -> Tuple[date, date]:
    """First day of the quarter, and the first day after it."""
    first_month = (quarter - 1) * 3 + 1
    start = date(year, first_month, 1)
    end = (
        date(year + 1, 1, 1)
        if first_month + 3 > 12
        else date(year, first_month + 3, 1)
    )
    return start, end


def month_bounds(year: int, month: int) -> Tuple[date, date]:
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def written_through(
    shifts: Sequence[WorkedShift], reach: date, end: date
) -> date:
    """How far the published calendar runs on from ``reach``, without a gap.

    Month by natural month, stopping at the first month that holds no
    published shift at all. That month is where the rota stops being written,
    and everything past it is work nobody has been asked to do yet.

    WHY CONTIGUITY AND NOT "THE LAST PUBLISHED DAY". Because one shift can be
    anywhere. A single New Year's Eve shift published in September -- a
    manager pinning down the one date everybody argues about -- would make the
    last published day the 31st of December, and the year would then be
    measured to the 1st of January with October, November and December counted
    as empty. That is exactly the "-416 h" this module has a test against: a
    figure that is arithmetically perfect, useless, and indistinguishable from
    a real shortfall.

    A month counts as written if it holds ANY published shift. Half a
    published month is a month somebody has worked on, and refusing to count
    it would put the horizon in the middle of a month where no screen draws a
    boundary.

    ``reach`` is where the walk starts, and it is deliberately not the start
    of the stretch. What the caller has already established -- the window
    being edited, today -- is written by definition, and anchoring the walk at
    the start of the stretch instead would lose everything beyond an October
    that is still only a DRAFT: the quarter and the year would both stop at
    the end of the month on the table, and the three tabs of the planner's
    column would once again print one answer three times. So: the calendar is
    written up to ``reach``, and this says how much further it goes.
    """
    days = {s.day for s in shifts if reach <= s.day < end}
    if not days:
        return reach
    out = reach
    cursor = date(reach.year, reach.month, 1)
    while cursor < end:
        month_end = month_bounds(cursor.year, cursor.month)[1]
        if not any(max(cursor, out) <= d < min(month_end, end) for d in days):
            break
        out = min(month_end, end)
        cursor = month_end
    return out


def period_balance(
    shifts: Sequence[WorkedShift],
    employee_id: str,
    contracted_weekly: float,
    limits: WorkdayLimits,
    start: date,
    end: date,
    on: date,
    cycle_start: Optional[date] = None,
    contract_start: Optional[date] = None,
    window: Optional[Tuple[date, date]] = None,
    absences: Sequence[AbsenceDay] = (),
) -> Balance:
    """Hours worked against hours owed, between ``start`` and ``end``.

    ``shifts`` is the PUBLISHED rota and nothing else. The balance is settled
    by publishing -- see `Balance` -- so a draft must not reach this function;
    what the draft would do to the figure is projected by the caller from
    ``planned`` and ``published_in_window``.

    ``on`` is today, and it is what keeps the answer honest mid-period: the
    hours OWED are counted up to it, not to the end of the stretch. Without
    that, everybody is catastrophically behind on the first of the month --
    zero hours worked against a whole month's contract -- and the number that
    was supposed to catch a real shortfall cries wolf every four weeks.

    A stretch that has finished is measured whole, which is what makes a closed
    month a verdict rather than a position.

    ``cycle_start`` and ``contract_start`` move the beginning of the stretch
    forward to the first day there was anything to count: see `effective_start`.

    ``absences`` are the approved days off, of everybody; the ones that belong
    to this person and are not worked back stop owing hours. See
    `contract_pace_hours`.

    ``window`` is the span the manager is editing, when there is one. It does
    two things. The published hours inside it come back separately, because a
    draft REPLACES the published rota for those dates rather than adding to it,
    and a projection that forgets to take the old hours out double-counts every
    shift that was already there. And it caps how far ``planned`` and ``total``
    reach, so a year asked about in September is not charged with the three
    months nobody has written yet -- what is left over comes back as
    ``pending`` rather than as a shortfall.

    A shift belongs to the day it STARTS on, which is what closes the year on
    the 31st of December: a shift that opens at 22:00 on New Year's Eve and
    runs to 04:00 belongs to the year that is ending, in full. The hours are
    not split across the boundary, and the cycle is the tidier for it.
    """
    from_day = effective_start(start, cycle_start, contract_start)
    if from_day >= end:
        # Nothing of this stretch had begun yet: no obligation, no balance.
        return Balance(
            worked=0.0,
            planned=0.0,
            total=0.0,
            expected=0.0,
            deviation=0.0,
            published_in_window=0.0,
            complete=on >= end,
            start=from_day,
            pending=0.0,
            horizon=from_day,
        )

    excused = excused_days(absences, employee_id)

    # Both sides stop at today. A rota is planned ahead, so the stretch holds
    # shifts nobody has worked yet -- counting those as done while counting
    # only the elapsed part of the contract as owed would report somebody as
    # comfortably ahead on the 1st because their whole month is drafted.
    complete = on >= end
    measured_to = end if complete else max(on, from_day)

    mine = [s for s in shifts if s.employee_id == employee_id]

    worked = sum(s.hours for s in mine if from_day <= s.day < measured_to)
    expected = contract_pace_hours(
        limits, contracted_weekly, from_day, measured_to, excused
    )

    # `planned` counts every PUBLISHED shift including the ones still ahead,
    # which is what "has this month been filled in?" asks; `total` is what the
    # contract adds up to over the same span. Their difference is what a draft
    # is judged against.
    #
    # BOTH STOP AT THE HORIZON, AND THE HORIZON IS WHERE THE ROTA STOPS. Asked
    # about the year in September, with October to December not written yet,
    # measuring to the 31st of December charges three empty months against
    # somebody and answers "if I publish this, Aldric ends 416 hours short" --
    # true, useless, and indistinguishable from a real shortfall. The year
    # would read as a disaster until the day it was fully planned, which is the
    # same way the balance column used to lie.
    #
    # So when a window is named, the stretch is measured to the end of what has
    # been planned rather than to its own end. Asked WITHOUT a window -- the
    # roster's progress bar, which exists precisely to show how much of a month
    # is still unstaffed -- the horizon stays the end of the stretch and
    # nothing changes.
    #
    # AND "WHAT HAS BEEN PLANNED" INCLUDES WHAT IS ALREADY PUBLISHED. The
    # horizon used to be the window and today, and nothing else, which meant a
    # November that had been on the noticeboard for a fortnight was invisible
    # the moment the manager opened October: the quarter and the year measured
    # to the 31st of October, printed the same three numbers as the month, and
    # the three tabs of the "if you publish" column became one tab shown thrice.
    # So the published calendar pushes the horizon out too -- as far as it runs
    # WITHOUT A GAP, which is what `written_through` works out and why the
    # answer is not simply the last published day.
    #
    # The rota of the WHOLE business, not of this person: the horizon is a fact
    # about how far the calendar has been written, and somebody who has no
    # shifts in a published November has genuinely worked none of it. Reading
    # it per person would quietly stop measuring exactly the people the column
    # exists to catch.
    horizon = end
    if window is not None:
        reach = max(window[1], on, from_day)
        reach = min(reach, end)
        horizon = min(end, written_through(shifts, reach, end))
        horizon = max(horizon, from_day)
    planned = sum(s.hours for s in mine if from_day <= s.day < horizon)
    planned_stretch = sum(s.hours for s in mine if from_day <= s.day < end)
    total = contract_pace_hours(
        limits, contracted_weekly, from_day, horizon, excused
    )
    # What the rest of the stretch will ask for once somebody writes it. Never
    # folded into `total`: see `Balance.pending`. The two add up to the whole
    # stretch exactly, because `contract_pace_hours` is additive over any cut
    # of the calendar -- which is the invariant the three tabs are built on.
    pending = contract_pace_hours(
        limits, contracted_weekly, horizon, end, excused
    )

    in_window = 0.0
    if window is not None:
        w_from, w_to = window
        in_window = sum(
            s.hours
            for s in mine
            if max(w_from, from_day) <= s.day < min(w_to, horizon)
        )

    return Balance(
        worked=round(worked, 2),
        planned=round(planned, 2),
        total=round(total, 2),
        expected=round(expected, 2),
        deviation=round(worked - expected, 2),
        published_in_window=round(in_window, 2),
        complete=complete,
        start=from_day,
        pending=round(pending, 2),
        horizon=horizon,
        planned_stretch=round(planned_stretch, 2),
    )
