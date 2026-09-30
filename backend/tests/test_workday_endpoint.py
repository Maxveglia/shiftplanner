from __future__ import annotations

"""The working year, end to end: seed -> rules table -> engine -> JSON.

`test_annual_workday` proves the arithmetic without a database. This proves the
wiring: that the figures art. 34 ET needs actually travel from the seeded rules
to the answer a manager's browser receives, and that a business under no such
law is left exactly as it was.

The one case worth stating out loud is the first: a 45-hour week followed by a
35-hour week comes back with NO error. That is the rule this whole branch
exists for, and until now the product reported the 45-hour week as a breach of
a weekly ceiling that Spanish law does not impose.

Needs Postgres, and skips itself when there is none.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.filterwarnings("ignore")


def _db_available() -> bool:
    try:
        from sqlalchemy import text

        from app.db import app_engine

        with app_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


skip_no_db = pytest.mark.skipif(
    not _db_available(),
    reason="No Postgres reachable. Start it and run `alembic upgrade head`.",
)


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


def _signup(client) -> tuple[str, str]:
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Workday Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["access_token"], body["user"]["org_id"]


def _set_jurisdiction(client, token: str, code: str) -> None:
    """Move a business to another body of rules.

    Signup already files a new business under ES-CT-HOSTELERIA -- Barcelona
    hospitality, the one market this product serves -- so the tests that want
    the sector agreement say nothing, and only the ones that want the bare
    statute call this.
    """
    resp = client.put(
        "/api/v1/profile",
        headers=_auth(token),
        json={"jurisdiction_code": code},
    )
    assert resp.status_code == 200, resp.text


def _add_employee(
    client,
    token: str,
    name: str,
    weekly: float = 40,
    complementary_pct: float | None = None,
) -> str:
    created = client.post(
        "/api/v1/employees",
        headers=_auth(token),
        json={
            "external_id": None,
            "full_name": name,
            "email": None,
            "employment_status": "active",
            "hire_date": "2025-01-01",
        },
    )
    assert created.status_code == 201, created.text
    employee_id = created.json()["id"]

    contract = client.post(
        "/api/v1/employees/%s/contracts" % employee_id,
        headers=_auth(token),
        json={
            "employment_type": "non_exempt_hourly",
            "hourly_rate": 12.0,
            "min_hours_per_week": weekly,
            "max_hours_per_week": weekly,
            "complementary_pct": complementary_pct,
            "valid_from": "2025-01-01",
        },
    )
    assert contract.status_code in (200, 201), contract.text
    return employee_id


def _monday(year: int = 2026, month: int = 3, day: int = 2) -> datetime:
    """A Monday well inside the year, so both weeks lie in the same one."""
    return datetime(year, month, day, tzinfo=timezone.utc)


def _shifts_across(employee_id: str, start: datetime, hours_per_day: list) -> list:
    out = []
    for offset, hours in enumerate(hours_per_day):
        at = start + timedelta(days=offset, hours=9)
        out.append(
            {
                "employee_id": employee_id,
                "start_at": at.isoformat(),
                "end_at": (at + timedelta(hours=hours)).isoformat(),
                "computed_cost": 0.0,
            }
        )
    return out


def _publish(client, token: str, start: datetime, end: datetime, shifts: list):
    return client.post(
        "/api/v1/schedule/publish",
        headers=_auth(token),
        json={
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "shifts": shifts,
        },
    )


def _workday(client, token: str, start: datetime, end: datetime):
    resp = client.get(
        "/api/v1/workday",
        headers=_auth(token),
        params={"from": start.isoformat(), "to": end.isoformat()},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@skip_no_db
def test_a_long_week_and_a_short_one_come_back_clean(client):
    """The rule this branch exists for, through the whole stack."""
    token, _ = _signup(client)
    _set_jurisdiction(client, token, "ES")
    employee = _add_employee(client, token, "Ana", weekly=40)

    # Week one: 9 hours a day for five days = 45. Week two: 7 a day = 35.
    week_one = _monday()
    week_two = week_one + timedelta(days=7)
    window_start = week_one - timedelta(days=1)  # the Sunday the week starts on
    window_end = week_two + timedelta(days=7)

    shifts = _shifts_across(employee, week_one, [9] * 5) + _shifts_across(
        employee, week_two, [7] * 5
    )
    assert _publish(
        client, token, window_start, window_end, shifts
    ).status_code == 200

    body = _workday(client, token, window_start, window_end)

    assert body["regime"] == "annual_average"
    assert body["weekly_average_hours"] == 40
    mine = [w for w in body["weeks"] if w["employee_id"] == employee]

    # No week reports a ceiling breach, because there is no ceiling to breach.
    assert all(w["overtime_hours"] == 0 for w in mine)
    hours = sorted(w["week_hours"] for w in mine if w["week_hours"] > 0)
    assert hours == [35, 45]


@skip_no_db
def test_the_spanish_figures_reach_the_client(client):
    """art. 34.2's tenth and five days, out of the rules table and into JSON."""
    token, _ = _signup(client)
    _set_jurisdiction(client, token, "ES")
    start = _monday() - timedelta(days=1)

    body = _workday(client, token, start, start + timedelta(days=7))

    assert body["irregular_pct"] == 0.10
    assert body["irregular_notice_days"] == 5


@skip_no_db
def test_an_agreement_replaces_the_statute_not_the_other_way_round(client):
    """Hospitality states its own annual hours; the chain must prefer them."""
    token, _ = _signup(client)  # hospitality by default
    start = _monday() - timedelta(days=1)

    body = _workday(client, token, start, start + timedelta(days=7))

    assert body["regime"] == "annual_average"
    assert body["annual_hours"] is not None


@skip_no_db
def test_short_notice_is_reported_against_a_published_shift(client):
    """A shift published today, worked tomorrow: art. 34.2 wants five days."""
    token, _ = _signup(client)
    _set_jurisdiction(client, token, "ES")
    employee = _add_employee(client, token, "Bruno", weekly=40)

    # Tomorrow, so the notice is one day however long this test takes to run.
    tomorrow = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) + timedelta(days=1)
    window_start = tomorrow - timedelta(days=7)
    window_end = tomorrow + timedelta(days=7)

    assert _publish(
        client,
        token,
        window_start,
        window_end,
        _shifts_across(employee, tomorrow, [8]),
    ).status_code == 200

    body = _workday(client, token, window_start, window_end)
    rules = [
        error["rule"]
        for week in body["weeks"]
        if week["employee_id"] == employee
        for error in week["errors"]
    ]
    assert "short_notice" in rules


@skip_no_db
def test_the_bare_statute_states_the_average_without_fixing_the_year(client):
    """ES alone says 40 hours a week on average and no annual total.

    The year is a negotiated figure -- it counts the public holidays and the
    leave of a sector -- so the statute does not invent one, and neither do we.
    The engine then multiplies the contract out rather than guessing.

    The counterpart to `test_an_agreement_replaces_the_statute...`: together
    they pin both ends of the chain `labour_floor` walks.
    """
    token, _ = _signup(client)
    _set_jurisdiction(client, token, "ES")
    start = _monday() - timedelta(days=1)

    body = _workday(client, token, start, start + timedelta(days=7))

    assert body["weekly_average_hours"] == 40
    assert body["annual_hours"] is None


@skip_no_db
def test_a_recoverable_day_off_turns_its_hours_into_recovery(client):
    """The whole of rule 3, through the stack: mark, work back, not overtime.

    Without the mark the hours worked back are indistinguishable from extra
    hours -- which is how they used to be classified, wrong for the employee
    (ordinary hours called extraordinary) and wrong for the employer (an annual
    overtime cap that looks breached and was never touched).
    """
    token, _ = _signup(client)
    _set_jurisdiction(client, token, "ES")
    employee = _add_employee(client, token, "Dani", weekly=40)

    # Mark one kind of leave as worked back.
    types = client.get("/api/v1/absence-types", headers=_auth(token)).json()
    assert types, "the org is seeded with absence types"
    target = types[0]
    assert target["is_recoverable"] is False

    updated = client.put(
        "/api/v1/absence-types/%s" % target["id"],
        headers=_auth(token),
        json={"is_recoverable": True},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["is_recoverable"] is True

    # A day off of that kind, then a week that works the hours back.
    week_one = _monday()
    day_off = week_one + timedelta(days=1)
    absence = client.post(
        "/api/v1/absences",
        headers=_auth(token),
        json={
            "employee_id": employee,
            "absence_type_id": target["id"],
            "start_at": day_off.isoformat(),
            "end_at": (day_off + timedelta(days=1)).isoformat(),
        },
    )
    assert absence.status_code == 201, absence.text

    # An absence is born `requested`, and only an approved one is a day off
    # anybody owes hours for. A request the manager never granted must not put
    # somebody in debt, which is why the engine reads only approved rows.
    approved = client.post(
        "/api/v1/absences/%s/approve" % absence.json()["id"],
        headers=_auth(token),
    )
    assert approved.status_code == 200, approved.text

    week_two = week_one + timedelta(days=7)
    window_start = week_one - timedelta(days=1)
    window_end = week_two + timedelta(days=7)
    # Week two runs long: 8 hours over the contracted forty.
    assert _publish(
        client,
        token,
        window_start,
        window_end,
        _shifts_across(employee, week_two, [8, 8, 8, 8, 8, 8]),
    ).status_code == 200

    body = _workday(client, token, window_start, window_end)
    mine = [w for w in body["weeks"] if w["employee_id"] == employee]

    recovered = [w for w in mine if w["recovery_hours"] > 0]
    assert recovered, "the long week works back the day off"
    # And it names WHICH day off, which is what art. 34 asks for.
    assert recovered[0]["recovery_credits"][0]["day_off"] == day_off.date().isoformat()
    # None of it is overtime: the year is nowhere near its total.
    assert all(w["overtime_hours"] == 0 for w in mine)

    # A DAY OFF IS WORTH WHAT THAT DAY OWED, which is a seventh of the
    # contracted week: 40/7 = 5.71 hours, the very figure `contract_pace_hours`
    # charges for one calendar day. Priced at a fifth instead -- one "working
    # day" of 8 hours -- the employee would hand back 8 hours against 5.71
    # hours of debt, and the 2.29 hours of difference would be ordinary hours
    # created out of nothing every time somebody swapped a day.
    assert recovered[0]["recovery_hours"] == pytest.approx(40 / 7, abs=0.01)
    # The week ran 8 hours over the contract. What the day off does not
    # account for is displaced time under art. 34.2, not a second debt.
    assert recovered[0]["irregular_hours"] == pytest.approx(8 - 40 / 7, abs=0.01)


@skip_no_db
def test_the_roster_reads_each_persons_month_quarter_and_year(client):
    """What the Employees table shows beside a name.

    One request for the whole roster, and the three stretches a manager acts
    on: the month, which can still be changed; the quarter, which says whether
    this month is a blip; and the year, which is the one the law measures.
    """
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)

    resp = client.get("/api/v1/workday/balances", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    mine = [e for e in body["employees"] if e["employee_id"] == employee]
    assert len(mine) == 1
    row = mine[0]

    assert row["employee_name"] == "Ana"
    assert row["contracted_weekly"] == 40
    for stretch in ("month", "quarter", "year"):
        # Four figures and a flag, because the bar the roster draws needs two
        # pairs: worked/expected says whether they are keeping up, and
        # planned/total says whether the stretch has been filled in at all.
        assert set(row[stretch]) == {
            "worked",
            "expected",
            "deviation",
            "planned",
            "total",
            # Published hours inside the window being edited, for projecting a
            # draft, and the day this stretch actually starts counting from.
            "published_in_window",
            "complete",
            "start",
            # What the rest of the stretch still asks for, and where the
            # measured part stops. Sent apart from `total` so that an
            # unplanned November reads as work to do rather than as a hole.
            "pending",
            "horizon",
            # Published hours over the whole stretch, past the horizon: the
            # "X" of the planner's "X of Y hours", whose "Y" is total+pending.
            "planned_stretch",
        }

    # The quarter is a calendar one, and the month starts on a first.
    assert body["month_start"].endswith("-01")
    assert body["quarter_start"][5:7] in {"01", "04", "07", "10"}
    assert body["year_start"].endswith("-01-01")


@skip_no_db
def test_the_balances_are_not_readable_by_an_employee(client):
    """Somebody's hours against their contract is the manager's view of them."""
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)

    account = client.post(
        "/api/v1/employees/%s/account" % employee,
        headers=_auth(token),
        json={
            "email": "staff+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
        },
    )
    assert account.status_code == 201, account.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": account.json()["email"], "password": "s3cret-pass"},
    )
    assert login.status_code == 200, login.text

    denied = client.get(
        "/api/v1/workday/balances",
        headers=_auth(login.json()["access_token"]),
    )
    assert denied.status_code == 403


# --- Hours above the contract (art. 35, art. 12.5), end to end ------------
#
# The arithmetic is pinned without a database in `test_overtime_over_contract`.
# What these prove is the wiring the engine cannot: that the contract reaches
# the judgement at all. That is where the bug lived -- every figure the rules
# needed was seeded and correct, and the router handed the engine a statutory
# 40 for everybody, so a 20-hour contract was measured against a full-timer's
# year and came back clean whatever it worked.


@skip_no_db
def test_a_part_timers_hours_above_their_contract_are_seen_at_all(client):
    """Twenty contracted, thirty worked. Ten hours have to appear somewhere.

    Before the contract reached the engine this came back with nothing at all
    on it: not an error, not an hour, not a column -- the excess was compared
    against 1,783 and never arrived.
    """
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Hugo", weekly=20)

    monday = _monday()
    window_start = monday - timedelta(days=1)
    window_end = monday + timedelta(days=7)
    shifts = _shifts_across(employee, monday, [6] * 5)  # 30 hours
    assert _publish(
        client, token, window_start, window_end, shifts
    ).status_code == 200

    body = _workday(client, token, window_start, window_end)
    week = next(w for w in body["weeks"] if w["week_hours"] > 0)

    assert week["contracted_weekly"] == 20
    assert week["part_time"] is True
    assert week["week_hours"] == 30
    # Ten hours above the contract, under one of the two ordinary names or as
    # complementary hours -- but never nowhere, and never as overtime.
    assert week["overtime_hours"] == 0, "art. 12.4.c: not on a part-time contract"
    assert (
        week["irregular_hours"] + week["complementary_hours"] == 10
    ), week


@skip_no_db
def test_a_full_timers_excess_comes_back_as_overtime_with_its_own_cap(client):
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)

    monday = _monday()
    window_start = monday - timedelta(days=1)
    window_end = monday + timedelta(days=7)
    assert _publish(
        client,
        token,
        window_start,
        window_end,
        _shifts_across(employee, monday, [9] * 5),
    ).status_code == 200

    body = _workday(client, token, window_start, window_end)
    week = next(w for w in body["weeks"] if w["week_hours"] > 0)

    assert week["part_time"] is False
    # The statute's figure, sent whole.
    assert body["annual_overtime_cap"] == 80
    # This contract's share of it. Less than 80 here because the cycle opened
    # with the first published rota in March, and art. 35.2 reduces the cap in
    # the same proportion as the reference period -- ten months of a year do
    # not hold a whole year of extra hours.
    assert 0 < week["overtime_cap"] < 80
    assert body["overtime_compensation_months"] == 4
    assert body["part_time_overtime_allowed"] is False


@skip_no_db
def test_the_pact_travels_from_the_contract_to_the_judgement(client):
    """The same rota, judged twice: with a pact signed and without one.

    This is the whole reason `complementary_pct` exists on the contract. The
    hours are identical; what changes is whether they could lawfully have been
    required (art. 12.5 ET), and the only place that is written down is the
    agreement.

    Ten weeks of it, and that is the point rather than an accident of the
    fixture. A 20-hour contract worked at thirty is not immediately working
    complementary hours: art. 34.2 lets the employer move a tenth of the year
    around first, which for this contract is 89 hours. Only once that is spent
    -- nine weeks in -- is there an hour left that needs a pact to exist. So
    this finding is quiet on a busy fortnight and speaks on a standing habit,
    which is the right way round.
    """
    monday = _monday()
    window_start = monday - timedelta(days=1)
    weeks = 10
    window_end = monday + timedelta(days=7 * weeks)

    def findings(pct):
        token, _ = _signup(client)
        employee = _add_employee(
            client, token, "Hugo", weekly=20, complementary_pct=pct
        )
        shifts = []
        for w in range(weeks):
            shifts += _shifts_across(
                employee, monday + timedelta(days=7 * w), [6] * 5
            )
        assert _publish(
            client, token, window_start, window_end, shifts
        ).status_code == 200
        body = _workday(client, token, window_start, window_end)
        return (
            {e["rule"] for w in body["weeks"] for e in w["errors"]},
            sum(w["complementary_hours"] for w in body["weeks"]),
        )

    without, hours_without = findings(None)
    signed, hours_signed = findings(0.30)

    # The hours themselves are the same either way: a pact does not change what
    # anybody worked, only whether it could be asked of them.
    assert hours_without == hours_signed > 0
    assert "complementary_without_pact" in without
    assert "complementary_without_pact" not in signed


@skip_no_db
def test_a_pact_beyond_what_any_convenio_may_grant_is_reported(client):
    """70% is void above 60% (art. 12.5.c), and it is void before anybody works."""
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Hugo", weekly=20, complementary_pct=0.70)

    monday = _monday()
    window_start = monday - timedelta(days=1)
    window_end = monday + timedelta(days=7)
    assert _publish(
        client,
        token,
        window_start,
        window_end,
        _shifts_across(employee, monday, [4] * 5),  # 20 hours: no excess at all
    ).status_code == 200

    body = _workday(client, token, window_start, window_end)
    rules = {e["rule"] for w in body["weeks"] for e in w["errors"]}
    assert "complementary_pact_above_statute" in rules


# --- The balance settles on publish, not on the draft ---------------------
#
# Asked for directly: "que el saldo de horas se descuente al publicar la
# planificación". The reason it matters beyond tidiness is the question it
# makes answerable -- if the draft moved the balance, the figure the manager
# is planning against would slide away from them with every shift they placed,
# and "am I giving her enough hours?" would have a different answer each time
# they dragged one.


def _put_draft(client, token: str, start: datetime, end: datetime, shifts: list):
    return client.put(
        "/api/v1/schedule/draft",
        headers=_auth(token),
        json={
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "shifts": shifts,
        },
    )


def _balances(client, token: str, on: str, window=None, tz=None):
    params = {"on": on}
    if window is not None:
        params["from"], params["to"] = window
    if tz is not None:
        params["tz"] = tz
    resp = client.get(
        "/api/v1/workday/balances", headers=_auth(token), params=params
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@skip_no_db
def test_a_draft_does_not_move_the_balance_and_publishing_does(client):
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)

    monday = _monday()
    window_start = monday - timedelta(days=1)
    window_end = monday + timedelta(days=7)
    on = (monday + timedelta(days=30)).date().isoformat()
    shifts = _shifts_across(employee, monday, [8] * 5)

    def worked_this_year(body):
        row = next(e for e in body["employees"] if e["employee_id"] == employee)
        return row["year"]["worked"]

    assert _put_draft(client, token, window_start, window_end, shifts).status_code in (
        200,
        201,
    )
    assert worked_this_year(_balances(client, token, on)) == 0, (
        "a draft is the manager thinking; it owes nobody anything yet"
    )

    assert _publish(
        client, token, window_start, window_end, shifts
    ).status_code == 200
    assert worked_this_year(_balances(client, token, on)) == 40


@skip_no_db
def test_the_balance_does_not_charge_for_the_months_before_the_first_rota(client):
    """The screenshot, end to end.

    A business publishes its first rota in March. Asked in June, the year must
    not hold January and February against anybody: there was no calendar then,
    so there is nothing to count and nothing to owe.
    """
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)

    march = datetime(2026, 3, 2, tzinfo=timezone.utc)
    assert _publish(
        client,
        token,
        march - timedelta(days=1),
        march + timedelta(days=7),
        _shifts_across(employee, march, [8] * 5),
    ).status_code == 200

    body = _balances(client, token, "2026-06-01")
    row = next(e for e in body["employees"] if e["employee_id"] == employee)

    # The first published day is the day of the first shift, not the 1st of
    # its month: the cycle opens where the calendar does.
    assert body["cycle_start"] == "2026-03-02"
    assert row["year"]["start"] == "2026-03-02"
    # Three months of obligation, not six: 2 March to 1 June is 91 days, and
    # a 40-hour contract asks for forty hours of each of their weeks. Counted
    # from January instead it was 862 hours, for a calendar that did not exist.
    assert row["year"]["expected"] == pytest.approx(40 * 91 / 7, abs=0.01)


@skip_no_db
def test_the_window_hours_travel_so_the_planner_can_project(client):
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)

    monday = _monday()
    window_start = monday - timedelta(days=1)
    window_end = monday + timedelta(days=7)
    assert _publish(
        client,
        token,
        window_start,
        window_end,
        _shifts_across(employee, monday, [8] * 5),
    ).status_code == 200

    # Asked from inside the same month: `month` means the month of `on`, so
    # asking from April about a March window compares two different stretches.
    on = (monday + timedelta(days=20)).date().isoformat()
    window = (window_start.isoformat(), window_end.isoformat())
    row = next(
        e
        for e in _balances(client, token, on, window)["employees"]
        if e["employee_id"] == employee
    )
    assert row["month"]["published_in_window"] == 40

    # No window asked for, nothing to subtract.
    plain = next(
        e
        for e in _balances(client, token, on)["employees"]
        if e["employee_id"] == employee
    )
    assert plain["month"]["published_in_window"] == 0


# --- Which month, quarter and year is the manager being told about? -------


@skip_no_db
def test_the_stretches_follow_the_window_being_edited(client):
    """From a screenshot: "+159 h" for four people who were exactly on track.

    The manager was planning October. The column answered about the
    July-September quarter, because the stretches were anchored on TODAY -- and
    that quarter ends the day the cycle opens, so it asked for no hours at all.
    With nothing to measure against, the projection came out as the draft's own
    hours and read as a 159-hour surplus.

    The stretches have to be the ones the WINDOW falls in. Today still decides
    what counts as worked; it does not decide which month is being asked about.
    """
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Aldric", weekly=40)

    # Publish something in a month, then ask about a window three months later.
    march = datetime(2026, 3, 2, tzinfo=timezone.utc)
    assert _publish(
        client,
        token,
        march - timedelta(days=1),
        march + timedelta(days=7),
        _shifts_across(employee, march, [8] * 5),
    ).status_code == 200

    june_window = (
        datetime(2026, 6, 1, tzinfo=timezone.utc).isoformat(),
        datetime(2026, 7, 1, tzinfo=timezone.utc).isoformat(),
    )
    body = _balances(client, token, "2026-03-20", june_window)

    # June, and June's quarter -- not March's.
    assert body["month_start"] == "2026-06-01"
    assert body["quarter_start"] == "2026-04-01"

    row = next(e for e in body["employees"] if e["employee_id"] == employee)
    # And the stretch asks for hours, so the column has something to measure
    # the draft against rather than printing its raw total.
    assert row["month"]["total"] > 0
    assert row["quarter"]["total"] > 0


@skip_no_db
def test_without_a_window_the_stretches_are_still_todays(client):
    """The roster asks with no window and must keep getting today's month."""
    token, _ = _signup(client)
    _add_employee(client, token, "Ana", weekly=40)
    body = _balances(client, token, "2026-06-15")
    assert body["month_start"] == "2026-06-01"
    assert body["quarter_start"] == "2026-04-01"


# --- One line per person, because twenty rows answered nothing -----------
#
# The working-year view was a table of WEEKS under a heading that said annual:
# five rows per person, seven columns, most of them dashes, and the same
# finding repeated on every row. The manager's verdict was "no se entiende".
#
# So the server now says once, per person, what the weeks said five times. The
# figures are the same figures -- these tests exist to keep them the same.


@skip_no_db
def test_the_summary_is_exactly_what_the_weeks_add_up_to(client):
    """The property that makes two views of one thing safe.

    A summary computed beside the detail is a summary that will one day
    disagree with it. Both come off the same rows; this is what says so.
    """
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Aldric", weekly=40)

    monday = _monday()
    window_start = monday - timedelta(days=1)
    window_end = monday + timedelta(days=21)
    shifts = []
    for week in range(3):
        shifts += _shifts_across(
            employee, monday + timedelta(days=7 * week), [9, 8, 8, 7, 9]
        )
    assert _publish(
        client, token, window_start, window_end, shifts
    ).status_code == 200

    body = _workday(client, token, window_start, window_end)
    row = next(e for e in body["employees"] if e["employee_id"] == employee)
    weeks = [w for w in body["weeks"] if w["employee_id"] == employee]

    assert round(row["period_hours"], 2) == round(
        sum(w["week_hours"] for w in weeks), 2
    )
    for field in (
        "recovery_hours",
        "irregular_hours",
        "overtime_hours",
        "complementary_hours",
        "compensated_hours",
    ):
        assert round(row[field], 2) == round(
            sum(w[field] for w in weeks), 2
        ), field


@skip_no_db
def test_the_balance_is_against_the_contract_over_the_period(client):
    """Not against the annual pace, which is what nobody could read.

    A week of 36.5 hours reported as "20.9 h behind" is true -- 1,783 hours a
    year is 34.3 a week -- and unreadable. Against what the contract asks for
    over the weeks on screen it needs no footnote.
    """
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)

    monday = _monday()
    # From the Monday, one day past the week: the period rounds out into the
    # week AFTER, which is the one nobody has written. (It used to start on
    # the Sunday before, back when a week did.)
    window_start = monday
    window_end = monday + timedelta(days=8)
    assert _publish(
        client,
        token,
        window_start,
        window_end,
        _shifts_across(employee, monday, [8] * 5),
    ).status_code == 200

    body = _workday(client, token, window_start, window_end)
    row = next(e for e in body["employees"] if e["employee_id"] == employee)

    assert row["contracted_weekly"] == 40
    assert row["period_hours"] == 40
    # ONE PRODUCT, ONE ANSWER. This is the same figure the planner's balance
    # column shows for the same person: the contracted week spread over the
    # days that have actually been written. The window runs from the 2nd of
    # March to the 10th and the rota stops there, so it is eight days of a
    # 40-hour contract.
    assert body["period_measured_to"] == "2026-03-10"
    assert row["period_expected"] == pytest.approx(40 * 8 / 7, abs=0.01)
    # And emphatically NOT the convenio's year prorated by days, which is the
    # reading that made this view disagree with the column beside it.
    assert row["period_expected"] != pytest.approx(1783 * 8 / 365, abs=0.01)
    assert round(row["period_deviation"], 2) == round(
        row["period_hours"] - row["period_expected"], 2
    )

    # The second week is on screen only because the period is rounded out to
    # whole weeks. Nobody has written it, so it is work still to plan -- and
    # the two halves add up to the whole period, which is the same invariant
    # `total + pending` keeps in the balance column.
    assert row["period_pending"] == pytest.approx(40 * 6 / 7, abs=0.01)
    assert row["period_expected"] + row["period_pending"] == pytest.approx(
        40 * 14 / 7, abs=0.01
    )

    # The span the figures cover is whole weeks, and it is stated.
    assert body["period_start"] is not None
    assert body["period_end"] is not None


@skip_no_db
def test_the_same_finding_five_weeks_running_is_one_entry(client):
    """Grouped, with the count -- the screenshot had it twenty-six times.

    The first date is kept because it decides whether anything has to be put
    right retroactively; the numbers are the latest, because these findings
    accumulate.
    """
    token, _ = _signup(client)
    # A part-timer well above their contract, with no pact: a finding that
    # recurs every single week once the irregular allowance is spent.
    employee = _add_employee(client, token, "hugo", weekly=20)

    start = datetime(2026, 1, 5, tzinfo=timezone.utc)
    end = datetime(2026, 5, 1, tzinfo=timezone.utc)
    shifts = []
    day = start
    while day < end:
        if day.weekday() < 5:
            shifts += _shifts_across(employee, day, [7])
        day += timedelta(days=1)
    assert _publish(client, token, start, end, shifts).status_code == 200

    april = datetime(2026, 4, 1, tzinfo=timezone.utc)
    body = _workday(client, token, april, end)
    row = next(e for e in body["employees"] if e["employee_id"] == employee)
    weeks = [w for w in body["weeks"] if w["employee_id"] == employee]

    by_rule = {f["rule"]: f for f in row["findings"]}
    assert "complementary_without_pact" in by_rule
    # One entry, and it says how many weeks carry it.
    assert by_rule["complementary_without_pact"]["count"] == len(weeks)
    # Fewer entries than the raw errors they came from.
    raw = sum(len(w["errors"]) for w in weeks)
    assert len(row["findings"]) < raw

    # And a part-timer's excess is never overtime, so there is no cap to show.
    assert row["part_time"] is True
    assert row["overtime_hours"] == 0
    assert row["complementary_hours"] > 0
    assert row["overtime_cap"] is None


@skip_no_db
def test_a_full_timer_carries_their_own_share_of_the_cap(client):
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)
    monday = _monday()
    assert _publish(
        client,
        token,
        monday - timedelta(days=1),
        monday + timedelta(days=7),
        _shifts_across(employee, monday, [8] * 5),
    ).status_code == 200

    body = _workday(client, token, monday - timedelta(days=1), monday + timedelta(days=7))
    row = next(e for e in body["employees"] if e["employee_id"] == employee)
    assert row["part_time"] is False
    assert row["overtime_cap"] is not None and row["overtime_cap"] > 0


# --- Checked by hand against the convenio, 19-sep-2026 -----------------------
#
# Barcelona hospitality: 1,783 hours a year for a full week, prorated by day.
# October is 31/365 of it: 151.43 h for forty hours, 75.72 h for twenty.


@skip_no_db
def test_a_window_sent_from_madrid_is_read_on_madrids_calendar(client):
    """Midnight on 1 October in Madrid is 22:00 on 30 September in UTC.

    Read as a UTC date that window began in September, so the column showed a
    manager in Spain planning October their September and their July-September
    quarter. The browser now sends its own offset, and this is what the server
    must make of it.
    """
    token, _ = _signup(client)
    _add_employee(client, token, "Ana", weekly=40)
    body = _balances(
        client,
        token,
        "2026-09-19",
        ("2026-10-01T00:00:00+02:00", "2026-11-01T00:00:00+01:00"),
    )
    assert body["month_start"] == "2026-10-01"
    assert body["quarter_start"] == "2026-10-01"


@skip_no_db
def test_with_nothing_published_the_year_starts_where_the_draft_does(client):
    """The bar from 19 September: contracts typed in that day, nothing published.

    The year used to count from the contracts -- 19 September -- and charged
    every full-timer the 58.6 hours of 19-30 September, which an October draft
    can never cover. Publishing that draft would make 1 October the first
    published day, so "if you publish" has to count from there.
    """
    token, _ = _signup(client)
    created = client.post(
        "/api/v1/employees",
        headers=_auth(token),
        json={
            "external_id": None,
            "full_name": "max",
            "email": None,
            "employment_status": "active",
            "hire_date": "2026-09-19",
        },
    )
    assert created.status_code == 201, created.text
    employee = created.json()["id"]
    contract = client.post(
        "/api/v1/employees/%s/contracts" % employee,
        headers=_auth(token),
        json={
            "employment_type": "non_exempt_hourly",
            "hourly_rate": 12.0,
            "min_hours_per_week": 40,
            "max_hours_per_week": None,
            "valid_from": "2026-09-19",
        },
    )
    assert contract.status_code in (200, 201), contract.text

    body = _balances(
        client,
        token,
        "2026-09-19",
        ("2026-10-01T00:00:00+02:00", "2026-11-01T00:00:00+01:00"),
    )
    row = next(e for e in body["employees"] if e["employee_id"] == employee)
    for stretch in ("month", "quarter", "year"):
        assert row[stretch]["start"] == "2026-10-01", (stretch, row[stretch])
        # October at the contracted week: 40 x 31/7 = 177.14. NOT the 151.43
        # that 1,783 prorated by calendar days gives. That figure is the LEGAL
        # CEILING for the year -- it already has the holidays taken out of it
        # -- and charging a month with its share is what told four people who
        # had been planned exactly their contract that they were over it.
        assert row[stretch]["total"] == pytest.approx(40 * 31 / 7, abs=0.01)


# --- Which DAY a shift belongs to, when the business is not in UTC --------


@skip_no_db
def test_an_evening_shift_belongs_to_the_day_it_was_worked_on(client):
    """The 31st of October in Phoenix, and why `tz` had to exist.

    Shifts are stored as instants and Postgres hands them back in UTC. An
    18:00-02:00 shift in Phoenix (UTC-7, no daylight saving) is 01:00-09:00
    UTC, so its UTC date is the 1st of November: October comes back a shift
    short and November a shift long, and neither figure can be reconciled
    against anything the manager can see on their own screen. The browser has
    always grouped the draft by the LOCAL day, so the two sides of
    `planned - published_in_window + draft` were being cut on different days.

    Naming the zone puts both sides on the same calendar. Saying nothing keeps
    the old UTC reading, because every caller that has not said where it is
    still gets exactly what it got before.
    """
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)

    # 18:00 on the 31st of October, Phoenix time, running to 02:00.
    start = datetime(2026, 10, 31, 18, 0, tzinfo=timezone(timedelta(hours=-7)))
    assert _publish(
        client,
        token,
        datetime(2026, 10, 25, tzinfo=timezone.utc),
        datetime(2026, 11, 8, tzinfo=timezone.utc),
        [
            {
                "employee_id": employee,
                "start_at": start.isoformat(),
                "end_at": (start + timedelta(hours=8)).isoformat(),
                "computed_cost": 0.0,
            }
        ],
    ).status_code == 200

    october = ("2026-10-01T00:00:00-07:00", "2026-11-01T00:00:00-07:00")
    november = ("2026-11-01T00:00:00-07:00", "2026-12-01T00:00:00-07:00")

    def month_hours(window, tz=None):
        body = _balances(client, token, "2026-12-01", window, tz=tz)
        row = next(e for e in body["employees"] if e["employee_id"] == employee)
        return row["month"]["worked"]

    # Told where the business is: the shift is October's, which is when
    # everybody who worked it thinks they worked it.
    assert month_hours(october, tz="America/Phoenix") == 8.0
    assert month_hours(november, tz="America/Phoenix") == 0.0

    # Not told: the day is the UTC one, exactly as before -- the 1st of
    # November. This is the behaviour being preserved, not the one being
    # recommended.
    assert month_hours(october) == 0.0
    assert month_hours(november) == 8.0


@skip_no_db
def test_a_timezone_nobody_can_read_is_refused_by_name(client):
    """422 with a code, like every other unreadable parameter here."""
    token, _ = _signup(client)
    resp = client.get(
        "/api/v1/workday/balances",
        headers=_auth(token),
        params={"on": "2026-10-01", "tz": "Mars/Olympus_Mons"},
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "bad_date"


@skip_no_db
def test_approved_leave_stops_owing_hours(client):
    """The holiday comes off the pace when it is TAKEN, not all year long.

    The balance asks for the contracted week spread over calendar days, which
    for a 40-hour contract is 177 hours in October. The convenio's 1,783 is
    lower than twelve of those because it already has the leave taken out of
    it -- and taking it out in advance, a little every day, is what made an
    October of exactly-contracted weeks read as hours over.

    So the leave is subtracted where it happens: a week off in October is a
    week of October nobody owes anything for.
    """
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)

    october = (
        datetime(2026, 10, 1, tzinfo=timezone.utc).isoformat(),
        datetime(2026, 11, 1, tzinfo=timezone.utc).isoformat(),
    )

    def october_total():
        body = _balances(client, token, "2026-11-15", october)
        row = next(e for e in body["employees"] if e["employee_id"] == employee)
        return row["month"]["total"]

    before = october_total()
    assert before == pytest.approx(40 * 31 / 7, abs=0.01)

    types = client.get("/api/v1/absence-types", headers=_auth(token))
    assert types.status_code == 200, types.text
    holiday = types.json()[0]["id"]
    created = client.post(
        "/api/v1/absences",
        headers=_auth(token),
        json={
            "employee_id": employee,
            "absence_type_id": holiday,
            "start_at": "2026-10-05T00:00:00+00:00",
            "end_at": "2026-10-10T00:00:00+00:00",
        },
    )
    assert created.status_code == 201, created.text

    # A REQUEST nobody has answered changes nothing: the day is still owed
    # until somebody grants it.
    assert october_total() == pytest.approx(before, abs=0.01)

    approved = client.post(
        "/api/v1/absences/%s/approve" % created.json()["id"],
        headers=_auth(token),
    )
    assert approved.status_code == 200, approved.text

    # Five days off, at a seventh of the contracted week each.
    assert october_total() == pytest.approx(before - 5 * 40 / 7, abs=0.01)


@skip_no_db
def test_leave_recorded_with_real_times_keeps_its_last_day(client):
    """The shape the absence form actually produces, and the day it used to eat.

    `AbsencesPage` is two `datetime-local` inputs, so leave arrives as
    "5 October 09:00 to 9 October 17:00" rather than midnight to midnight.
    Counting the days by subtracting the ends gives four, and the 9th goes on
    owing its hours -- somebody comes back from a week off a day short, for
    ever, and nothing on any screen says why.

    An absence TOUCHES five calendar days there. The rule is the half-open one
    it is stored under: the last day is the day `end_at` falls in, unless
    `end_at` is midnight, which reaches into no part of the day it names.
    """
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)

    october = (
        datetime(2026, 10, 1, tzinfo=timezone.utc).isoformat(),
        datetime(2026, 11, 1, tzinfo=timezone.utc).isoformat(),
    )

    def october_total():
        body = _balances(client, token, "2026-11-15", october)
        row = next(e for e in body["employees"] if e["employee_id"] == employee)
        return row["month"]["total"]

    before = october_total()

    types = client.get("/api/v1/absence-types", headers=_auth(token))
    holiday = types.json()[0]["id"]
    created = client.post(
        "/api/v1/absences",
        headers=_auth(token),
        json={
            "employee_id": employee,
            "absence_type_id": holiday,
            "start_at": "2026-10-05T09:00:00+00:00",
            "end_at": "2026-10-09T17:00:00+00:00",
        },
    )
    assert created.status_code == 201, created.text
    approved = client.post(
        "/api/v1/absences/%s/approve" % created.json()["id"],
        headers=_auth(token),
    )
    assert approved.status_code == 200, approved.text

    # Five days -- the 5th to the 9th inclusive -- not the four that
    # subtracting 5 Oct 09:00 from 9 Oct 17:00 gives.
    assert october_total() == pytest.approx(before - 5 * 40 / 7, abs=0.01)


@skip_no_db
def test_both_screens_cut_the_day_in_the_same_place(client):
    """`/workday` takes the same `tz` as `/workday/balances`, and must.

    A shift that opens at 23:00 on a Saturday in Madrid is 21:00 UTC on the
    Saturday in winter -- but at 23:00 in JUNE, Madrid is two hours ahead, so
    the same shift is 21:00 UTC and still Saturday. The case that bites is the
    one below: 23:00 local in summer is 21:00 UTC, and 01:00 local is 23:00
    UTC of the day before. Whichever way it falls, the two endpoints have to
    fall the same way -- one of them reading UTC while the other reads Madrid
    is two answers about one Saturday, which is the disagreement this whole
    module exists to stop.
    """
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)

    # 01:00 on MONDAY 5 October, Madrid (UTC+2 in October until the 25th):
    # 23:00 UTC on the Sunday. Local says Monday, UTC says Sunday -- and since
    # a week starts on Monday, those are two different weeks. (Saturday and
    # Sunday used to be the pair that split; they share a week now.)
    start = datetime(2026, 10, 5, 1, 0, tzinfo=timezone(timedelta(hours=2)))
    assert _publish(
        client,
        token,
        datetime(2026, 9, 27, tzinfo=timezone.utc),
        datetime(2026, 10, 11, tzinfo=timezone.utc),
        [
            {
                "employee_id": employee,
                "start_at": start.isoformat(),
                "end_at": (start + timedelta(hours=6)).isoformat(),
                "computed_cost": 0.0,
            }
        ],
    ).status_code == 200

    def week_of_the_shift(tz=None):
        params = {
            "from": datetime(2026, 9, 27, tzinfo=timezone.utc).isoformat(),
            "to": datetime(2026, 10, 11, tzinfo=timezone.utc).isoformat(),
        }
        if tz is not None:
            params["tz"] = tz
        resp = client.get(
            "/api/v1/workday", headers=_auth(token), params=params
        )
        assert resp.status_code == 200, resp.text
        rows = [
            w
            for w in resp.json()["weeks"]
            if w["employee_id"] == employee and w["week_hours"] > 0
        ]
        assert len(rows) == 1, rows
        return rows[0]["week_start"]

    # Weeks are Monday-anchored. Told where the business is, the shift is
    # Monday the 5th and opens its own week.
    assert week_of_the_shift(tz="Europe/Madrid") == "2026-10-05"
    # Not told: it is Sunday the 4th in UTC, so it closes the week before --
    # the behaviour being preserved, not the one being recommended.
    assert week_of_the_shift() == "2026-09-28"


@skip_no_db
def test_the_working_year_refuses_an_unreadable_timezone_too(client):
    token, _ = _signup(client)
    resp = client.get(
        "/api/v1/workday",
        headers=_auth(token),
        params={
            "from": datetime(2026, 10, 1, tzinfo=timezone.utc).isoformat(),
            "to": datetime(2026, 10, 8, tzinfo=timezone.utc).isoformat(),
            "tz": "Mars/Olympus_Mons",
        },
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "bad_date"


# --- The two screens, about the same person, one click apart --------------
#
# This is the invariant the whole balance rewrite exists to protect, and it is
# the one that kept being broken in a new place: the "SI PUBLICAS" column and
# the "Jornada anual" tab describe one person over one window, and they have
# to agree. Every regression in this file arrived as "the column says 0 h and
# the tab says -28.6 h", with two pieces of arithmetic that were each defensible
# on their own.


def body_measured_to(client, token, start, end) -> str:
    """How far `/workday` says it actually measured, as the JSON has it."""
    return _workday(client, token, start, end)["period_measured_to"]


def _november_window():
    """November 2026, which opens on a Sunday and so is five whole weeks wide.

    That is what makes it the case worth testing: rounding it out to weeks
    reaches the 6th of December, five days nobody has written.
    """
    return (
        datetime(2026, 11, 1, tzinfo=timezone.utc),
        datetime(2026, 12, 1, tzinfo=timezone.utc),
    )


@skip_no_db
def test_the_summary_and_the_balance_column_agree_about_one_person(client):
    """Same person, same window, same zone: the same number, both ways.

    `/workday` reports `period_hours - period_expected`; `/workday/balances`
    reports `planned - total`. They are computed by different code over
    different spans -- whole weeks against a calendar month -- and if they ever
    disagree it is because there are two arithmetics in the product again.
    """
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)

    window_start, window_end = _november_window()
    # A published November: both endpoints read the same rota, so the two
    # readings are directly comparable.
    shifts = []
    for week in range(4):
        shifts += _shifts_across(
            employee,
            datetime(2026, 11, 2, tzinfo=timezone.utc) + timedelta(days=7 * week),
            [8] * 5,
        )
    assert _publish(
        client, token, window_start, window_end, shifts
    ).status_code == 200

    summary = next(
        e
        for e in _workday(client, token, window_start, window_end)["employees"]
        if e["employee_id"] == employee
    )
    column = next(
        e
        for e in _balances(
            client,
            token,
            "2026-11-15",
            (window_start.isoformat(), window_end.isoformat()),
        )["employees"]
        if e["employee_id"] == employee
    )["month"]

    assert summary["period_deviation"] == pytest.approx(
        column["planned"] - column["total"], abs=0.01
    )
    # And they charge the same contract over the same days, which is the
    # reason the line above holds rather than a coincidence of this rota:
    # same start (the cycle opens on the same day for both), same horizon.
    assert summary["period_expected"] == pytest.approx(column["total"], abs=0.01)
    assert body_measured_to(client, token, window_start, window_end) == (
        column["horizon"]
    )
    # Their `pending` figures are deliberately NOT compared: the column is
    # asked about a calendar month and this view about whole weeks, so they
    # have different amounts of unwritten calendar left over. What must match
    # is the part they both measure, which is what the three lines above say.


@skip_no_db
def test_a_drafted_november_reads_level_and_says_what_is_left(client):
    """The screenshot: "0 h" in the column and "-28,6 h" in the tab.

    October published, November drafted to exactly the contract. The tab
    rounded November out to the 6th of December, charged 35 days of contract
    -- 200 hours -- against 171.43 hours of a perfectly planned November, and
    called the five unwritten days of December a shortfall.

    They are not a shortfall. They are December.
    """
    token, _ = _signup(client)
    employee = _add_employee(client, token, "Ana", weekly=40)

    # October, published, so the cycle opens before the window.
    assert _publish(
        client,
        token,
        datetime(2026, 10, 1, tzinfo=timezone.utc),
        datetime(2026, 11, 1, tzinfo=timezone.utc),
        _shifts_across(
            employee, datetime(2026, 10, 5, tzinfo=timezone.utc), [8] * 5
        )
        # The LAST WEEK of October is written too, and that is not padding.
        # November 2026 opens on a Sunday, so a period rounded out to whole
        # Monday weeks reaches back to the 26th of October -- and days inside
        # the period that nobody wrote read as a shortfall, which is the very
        # thing this test is about. Written to the contract, they weigh
        # nothing.
        + _shifts_across(
            employee, datetime(2026, 10, 26, tzinfo=timezone.utc), [40 / 7] * 6
        ),
    ).status_code == 200

    # November, drafted, at exactly the contracted week: a seventh of it on
    # every one of the thirty days, which is 40 hours every seven days however
    # the month is cut. 171.43 hours, the whole of November's obligation.
    window_start, window_end = _november_window()
    drafted = _shifts_across(
        employee, window_start, [40 / 7] * 30
    )
    saved = _put_draft(client, token, window_start, window_end, drafted)
    assert saved.status_code in (200, 201), saved.text

    body = _workday(client, token, window_start, window_end)
    row = next(e for e in body["employees"] if e["employee_id"] == employee)

    # The period on screen runs from the 26th of October to the 7th of
    # December -- whole weeks, so that hours and obligation cover the same
    # days -- but it is only MEASURED to the 1st, where the draft stops.
    assert body["period_start"] == "2026-10-26"
    assert body["period_end"] == "2026-12-07"
    assert body["period_measured_to"] == "2026-12-01"

    # Thirty-six days at the contracted week, every one of them written.
    assert row["period_expected"] == pytest.approx(40 * 36 / 7, abs=0.01)
    assert row["period_deviation"] == pytest.approx(0.0, abs=0.05)
    # And the six days of December that nobody has written are named as such:
    # work still to plan, not hours somebody is short of.
    assert row["period_pending"] == pytest.approx(40 * 6 / 7, abs=0.01)
    assert row["period_pending"] == pytest.approx(34.29, abs=0.01)
