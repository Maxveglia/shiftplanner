from __future__ import annotations

"""The working year, as the API hands it over.

The field names are English, like every other schema here; the product speaks
two languages and both of them live in `frontend/src/lib/i18n`. Read against
art. 34 ET they are, one for one:

    week_hours             horas de la semana
    annual_hours_to_date   horas acumuladas en el año
    deviation_vs_average   desviación respecto al promedio contratado
    recovery_hours         horas de recuperación
    irregular_hours        horas de distribución irregular (art. 34.2)
    overtime_hours         horas extraordinarias (art. 35)
    complementary_hours    horas complementarias (art. 12.5)
    compensated_hours      horas extra ya compensadas con descanso
    errors                 errores, con fecha y regla incumplida
"""

import uuid
from datetime import date
from typing import Dict, List, Optional

from pydantic import BaseModel


class WorkdayErrorOut(BaseModel):
    """One rule broken, on one date.

    ``detail`` carries numbers and never a sentence, for the reason the
    validator gives on the client: a server that emits English either ships
    untranslated text to a Spanish manager or tempts somebody into branching on
    it. The UI holds the wording, in both languages, keyed by ``rule``.
    """

    rule: str
    day: date
    employee_id: uuid.UUID
    detail: Dict[str, float] = {}


class RecoveryCreditOut(BaseModel):
    """Hours worked back, and the day off they answer."""

    week: date
    day_off: date
    hours: float


class WeekReportOut(BaseModel):
    """One employee, one week, measured against the working year."""

    employee_id: uuid.UUID
    employee_name: str
    week_start: date
    week_hours: float
    annual_hours_to_date: float
    deviation_vs_average: float
    #: The contracted week this row was judged against. Sent because it is the
    #: line art. 35.1 draws, it is a DIFFERENT line for each person, and a
    #: column of extra hours with no sight of it cannot be checked by the
    #: manager reading it.
    contracted_weekly: float = 0.0
    #: Whether this contract is part-time, which is what decides whether the
    #: excess is extraordinary or complementary. The client needs it to pick a
    #: word, not to do arithmetic.
    part_time: bool = False
    #: This contract's own share of the 80-hour year (art. 35.2). None where
    #: no cap is seeded, or on a part-time contract, which has no overtime.
    overtime_cap: Optional[float] = None
    recovery_hours: float
    #: Ordinary hours moved here under art. 34.2 -- early, not extra.
    irregular_hours: float = 0.0
    #: Horas extraordinarias (art. 35). Full-time contracts only.
    overtime_hours: float = 0.0
    #: Horas complementarias (art. 12.5). Part-time contracts only.
    complementary_hours: float = 0.0
    #: Extra hours already answered by rest within four months (art. 35.1).
    #: Still extra hours; they just no longer count towards the cap.
    compensated_hours: float = 0.0
    errors: List[WorkdayErrorOut] = []
    recovery_credits: List[RecoveryCreditOut] = []


class FindingOut(BaseModel):
    """One rule broken, however many times it was broken.

    GROUPED, because the ungrouped version was unreadable. A part-timer working
    above their contract every week produced the same finding on every row --
    the screenshot that prompted this had it twenty-six times down one column --
    and twenty-six copies of one sentence do not tell the manager anything the
    first copy did not.

    ``day`` is the FIRST time it happened, because that is the date that decides
    whether something has to be fixed retroactively. ``detail`` is the most
    recent set of numbers, because these findings accumulate: "2 h above the
    contract" after two weeks is the figure that matters, not the 1 h of the
    first. ``count`` is how many weeks carry it.
    """

    rule: str
    day: date
    detail: Dict[str, float] = {}
    count: int = 1


class EmployeeWorkdayOut(BaseModel):
    """One person's whole period, on one line.

    WHY THIS EXISTS. The working-year view was a table of WEEKS -- five rows per
    person, seven columns, most of them dashes -- under a heading that said
    "annual". With four employees that is twenty rows to answer a question about
    four people, and the manager's verdict was that it could not be understood.

    So the server now says once, per person, what the weeks used to say five
    times, and the weekly detail is what you get if you ask for one person. The
    figures are the same figures; what changes is that the summary is computed
    where the law is, rather than added up in a component.

    THE BALANCE IS AGAINST THE CONTRACT OVER THIS PERIOD, and that is the part
    worth stating. The old column measured each week against the annual PACE --
    1,783 h / 52 = 34.3 h a week -- so somebody who worked 36.5 hours was told
    they were "20.9 h behind", which is true and unreadable. Measured against
    what their contract asks for over the period on screen, it reads without a
    footnote: 150.5 of 171 hours, so 20.5 short. It is also the same arithmetic
    the roster's balance column and the planner's projection use, so the three
    screens finally agree about the same person.
    """

    employee_id: uuid.UUID
    employee_name: str
    #: Their contracted week -- the line art. 35.1 draws for this person.
    contracted_weekly: float
    #: Whether this contract is part-time, which decides what its excess is
    #: CALLED: never "extraordinary" here (art. 12.4.c ET).
    part_time: bool
    #: Hours on the rota over the weeks being reported.
    period_hours: float
    #: What the contract asks for over the same weeks.
    period_expected: float
    #: period_hours - period_expected. Positive is over, negative is short.
    period_deviation: float
    #: What the contract asks for over the part of the period NOBODY HAS
    #: WRITTEN yet -- from `period_measured_to` to `period_end`.
    #:
    #: Reported beside the deviation and never inside it. The period is
    #: rounded out to whole weeks so that the hours and the obligation cover
    #: the same days, and the week it rounds into is usually one nobody has
    #: planned: asked about November, this view measured to the 6th of
    #: December and called the five unplanned days a 28.6-hour shortfall,
    #: while the balance column said 0 h about the same person one click away.
    #: Same figure, different sentence: work still to hand out, not work
    #: somebody failed to do.
    period_pending: float = 0.0
    recovery_hours: float
    #: Ordinary hours moved into this period under art. 34.2.
    irregular_hours: float
    #: Horas extraordinarias (art. 35). Full-time contracts only.
    overtime_hours: float
    #: Horas complementarias (art. 12.5). Part-time contracts only.
    complementary_hours: float
    #: Extra hours already answered by rest within four months (art. 35.1).
    compensated_hours: float
    #: This contract's own share of the 80-hour year, or None on a part-time
    #: contract, which has no overtime to cap.
    overtime_cap: Optional[float] = None
    findings: List[FindingOut] = []


class WorkdayOut(BaseModel):
    """The whole answer for a period.

    ``regime`` is what makes the rest of it readable. Under ``annual_average``
    a week above the contract is not a breach and the deviation is the number
    that matters; under ``weekly_ceiling`` -- every jurisdiction where nobody
    has stated otherwise -- the old weekly reading still applies and these rows
    are informational. Sending it means the client never has to guess which
    body of law produced the figures it is drawing.
    """

    regime: str
    #: The contracted week being averaged over the year, where one is stated.
    weekly_average_hours: Optional[float] = None
    #: Hours of effective work a full year is, where an agreement fixes one.
    annual_hours: Optional[float] = None
    #: Share of the year that may be moved around (art. 34.2: 0.10).
    irregular_pct: Optional[float] = None
    #: Days of notice owed before a shift (art. 34.2: 5).
    irregular_notice_days: Optional[float] = None
    #: Extra hours a full-time year may hold (art. 35.2: 80), before the
    #: proportional reduction each contract's own row carries.
    annual_overtime_cap: Optional[float] = None
    #: Months within which rest still answers an extra hour (art. 35.1: 4).
    overtime_compensation_months: Optional[float] = None
    #: Whether a part-time contract may work extra hours here at all. False in
    #: Spain (art. 12.4.c), and the reason a part-timer's rows carry
    #: complementary hours rather than overtime.
    part_time_overtime_allowed: bool = True
    #: The first day this business published a rota for, or None. Nothing
    #: before it is judged against anybody: there was no record to judge.
    cycle_start: Optional[date] = None
    #: Where the year being averaged begins.
    year_start: date
    #: The span the summary figures cover: whole weeks, from the start of the
    #: first reported week to the end of the last. Sent because `period_hours`
    #: and `period_expected` are measured over it and a screen that shows a
    #: balance without saying over what is asking to be misread.
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    #: How far the summary figures were ACTUALLY measured (exclusive): where
    #: the rota on screen stops being written, which is rarely the end of the
    #: last whole week. Sent so a heading can say "al 1 dic 2026" instead of
    #: "al 6 dic 2026" and mean it, and so that `period_expected` and
    #: `period_pending` can be read as the two halves they are.
    period_measured_to: Optional[date] = None
    #: One line per person: what the weeks below add up to. The summary the
    #: view is built from.
    employees: List[EmployeeWorkdayOut] = []
    #: The weekly detail, for the person the manager opens up.
    weeks: List[WeekReportOut] = []


class BalanceOut(BaseModel):
    """Where somebody stands over one stretch: worked, owed, and the gap.

    Every figure here counts PUBLISHED hours only. The balance settles when
    the manager publishes, so that it is a fixed thing to plan against rather
    than a number that slides away as they drag shifts around.
    """

    worked: float
    expected: float
    deviation: float
    #: PUBLISHED hours for the WHOLE stretch, worked or still to come.
    planned: float
    #: What the contract adds up to over the MEASURED part of the stretch --
    #: from `start` to `horizon`, the end of the progress bar the roster draws.
    total: float
    #: What the contract will ask for over the rest of the stretch: `horizon`
    #: to its end, the part nobody has written a rota for yet. Sent SEPARATELY
    #: from `total` rather than added to it, so that the three tabs of the
    #: planner's column can each measure their whole stretch without printing
    #: an unplanned November as a shortfall. "Quedan 320 h por planificar" is
    #: a different sentence from "le faltan 320 h", and only one of them is
    #: about the person.
    pending: float = 0.0
    #: The exclusive end of the measured part: where the published rota, today
    #: and the window being edited run out. `total` stops here, `pending`
    #: starts here. Sent so a screen can say what it has actually counted.
    horizon: Optional[date] = None
    #: PUBLISHED hours over the whole stretch, `start` to its end, past the
    #: horizon too. What the planner's column prints as "X" in "X of Y hours",
    #: with `total + pending` as the "Y": the two cover the same days.
    planned_stretch: float = 0.0
    #: Published hours inside the window being edited, when one was asked for.
    #: The client subtracts these when projecting a draft: publishing REPLACES
    #: the rota for those dates, so adding the draft without taking these out
    #: counts every shift that was already there twice.
    published_in_window: float = 0.0
    #: False while the stretch is still running, so the client can say
    #: "so far" rather than passing a position off as a verdict.
    complete: bool
    #: The day this stretch actually starts counting from -- the latest of the
    #: stretch, the contract and the first published rota. Sent so a screen can
    #: say "desde el 1 sep" instead of implying a January nobody worked in.
    start: Optional[date] = None


class EmployeeBalancesOut(BaseModel):
    """One person's month, quarter and year, as the roster shows them."""

    employee_id: uuid.UUID
    employee_name: str
    contracted_weekly: float
    month: BalanceOut
    quarter: BalanceOut
    year: BalanceOut


class BalancesOut(BaseModel):
    """The whole roster, plus which stretches these are."""

    #: The day the figures are measured up to.
    on: date
    month_start: date
    quarter_start: date
    year_start: date
    #: The first day this business published a rota for, or None if it never
    #: has. Nothing before it is counted against anybody -- it is where the
    #: cycle opens, and it runs from there to the 31st of December.
    cycle_start: Optional[date] = None
    employees: List[EmployeeBalancesOut] = []
