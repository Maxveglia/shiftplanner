"""Learning from what the manager changes by hand before publishing.

The planner proposes, the manager drags, deletes and reassigns, and publishes.
When they make the same change month after month, that is a rule about their
business nobody wrote down -- and this file defends the ways that listening
could go wrong:

1. Something the manager never did is taken as a correction: the client's
   greedy pass ADDING shifts, a swap read as a cut, a person's leave read as a
   preference, a whole different calendar read as an edited one.
2. One afternoon manufactures a belief: evidence must come from publications
   on different days, and republishing the same month is not new evidence.
3. It acts on its own: every pattern is a proposal, inert until confirmed, and
   a "no" is for ever.
4. It costs the rota: a failure here must never touch `/publish`.

The first half needs nothing; the second half needs Postgres and skips itself
when there is none.
"""

import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.models.learned_hint import LearnedHint
from app.services import business_profile as bp
from app.services import hand_edits as he
from app.services.hand_edits import Shift

pytestmark = pytest.mark.filterwarnings("ignore")

MADRID = ZoneInfo("Europe/Madrid")
ORG = uuid.UUID("00000000-0000-0000-0000-00000000000a")

# Monday 1 February 2027: four clean weeks, no change of clocks.
MONDAY = date(2027, 2, 1)


def _s(emp, day, start, end):
    """A shift from "HH:MM" strings, crossing midnight like the planner writes."""
    a = he._clock(start)
    b = he._clock(end)
    if b <= a:
        b += 24 * 60
    return Shift(emp, day, a, b)


def _week(first: date, *, weeks: int = 1):
    """What the planner proposes: Ana and Bea in the morning, Carla at night.

    Mondays have a second morning person, which is the one the manager keeps
    taking out in the tests below.
    """
    out = []
    for w in range(weeks):
        for i in range(7):
            day = first + timedelta(days=7 * w + i)
            out.append(_s("ana", day, "08:00", "12:00"))
            if day.weekday() == 0:
                out.append(_s("bea", day, "08:00", "12:00"))
            out.append(_s("bea", day, "18:00", "22:00"))
            out.append(_s("carla", day, "22:00", "02:00"))
    return out


def _without(shifts, drop):
    return [s for s in shifts if not drop(s)]


# --- 1. only what the manager took away or changed ------------------------


def test_taking_the_extra_monday_shift_out_is_a_trim():
    proposed = _week(MONDAY, weeks=4)
    published = _without(
        proposed, lambda s: s.employee_id == "bea" and s.start == 8 * 60
    )

    found = he.extract(ORG, proposed, published)

    keys = [p.key for p in found]
    assert keys == ["stated:edit:trim:1:morning"], keys
    assert found[0].value["text"] == (
        "Cada lunes por la mañana basta con la cobertura mínima: sin turnos de más."
    )


def test_a_swap_is_not_a_trim():
    # Bea's Monday morning handed to Dani: the same number of people, so the
    # manager did not say the planner staffs Mondays too heavily.
    proposed = _week(MONDAY, weeks=4)
    published = []
    for s in proposed:
        if s.employee_id == "bea" and s.start == 8 * 60:
            published.append(Shift("dani", s.day, s.start, s.end))
        else:
            published.append(s)

    assert he.extract(ORG, proposed, published) == []


def test_added_shifts_teach_nothing():
    # The greedy pass fills every hole the model left. Those shifts were never
    # the planner's, so there is nothing in them to be corrected on.
    proposed = _week(MONDAY, weeks=4)
    extra = [_s("dani", MONDAY + timedelta(days=i), "12:00", "18:00") for i in range(28)]

    assert he.extract(ORG, proposed, proposed + extra) == []


def test_one_quiet_monday_is_not_a_rule_about_mondays():
    proposed = _week(MONDAY, weeks=4)
    published = _without(
        proposed,
        lambda s: s.employee_id == "bea" and s.start == 8 * 60 and s.day == MONDAY,
    )

    assert he.extract(ORG, proposed, published) == []


def test_moving_friday_evenings_an_hour_earlier_is_a_start():
    proposed = _week(MONDAY, weeks=4)
    published = []
    for s in proposed:
        if s.day.weekday() == 4 and s.employee_id == "bea":
            published.append(Shift("bea", s.day, 17 * 60, 21 * 60))
        else:
            published.append(s)

    found = he.extract(ORG, proposed, published)

    assert [p.key for p in found] == ["stated:edit:start:5:1080-1020"]
    assert found[0].value["text"] == (
        "Cada viernes, el turno que empieza a las 18:00 entra a las 17:00."
    )


def test_a_shift_moved_half_a_day_is_not_a_corrected_start():
    proposed = _week(MONDAY, weeks=4)
    published = []
    for s in proposed:
        if s.day.weekday() == 4 and s.employee_id == "bea":
            published.append(Shift("bea", s.day, 6 * 60, 10 * 60))
        else:
            published.append(s)

    assert all(":start:" not in p.key for p in he.extract(ORG, proposed, published))


def test_keeping_somebody_off_nights_names_them_only_in_the_proposal():
    proposed = _week(MONDAY, weeks=4)
    published = []
    for s in proposed:
        if s.employee_id == "carla":
            # Her nights go to Dani; she keeps a daytime shift.
            published.append(Shift("dani", s.day, s.start, s.end))
            published.append(Shift("carla", s.day, 12 * 60, 16 * 60))
        else:
            published.append(s)

    found = he.extract(ORG, proposed, published, {"carla": "Carla Soler"})

    nights = [p for p in found if ":no_nights:" in p.key]
    assert len(nights) == 1
    assert nights[0].value["text"] == "Carla Soler no hace turnos de noche."
    # The key is what the evidence trail stores: neither the name nor the id.
    assert "carla" not in nights[0].key.lower()
    assert nights[0].key.endswith(he.person_token(ORG, "carla"))


def test_somebody_who_is_simply_not_on_the_rota_was_away_not_kept_off_nights():
    proposed = _week(MONDAY, weeks=4)
    published = []
    for s in proposed:
        if s.employee_id == "carla":
            published.append(Shift("dani", s.day, s.start, s.end))
        else:
            published.append(s)

    found = he.extract(ORG, proposed, published, {"carla": "Carla Soler"})
    assert all(":no_nights:" not in p.key for p in found)


def test_a_calendar_that_was_replaced_rather_than_retouched_teaches_nothing():
    # Every shift an hour later: what a browser in another time zone looks
    # like. Nothing survives untouched, so this is a different calendar and not
    # a retouched one -- and it says nothing, although without the guard it
    # would read as "every start moves an hour" on all seven weekdays.
    proposed = _week(MONDAY, weeks=4)
    published = [Shift(s.employee_id, s.day, s.start + 60, s.end + 60) for s in proposed]

    assert he.extract(ORG, proposed, published) == []


def test_the_bands_are_the_ones_the_calendar_paints():
    # Mirrors frontend/src/lib/schedule/bands.ts, by the midpoint.
    assert he.band(_s("x", MONDAY, "22:00", "06:00")) == "night"
    assert he.band(_s("x", MONDAY, "18:00", "02:00")) == "night"
    assert he.band(_s("x", MONDAY, "07:00", "15:00")) == "morning"
    assert he.band(_s("x", MONDAY, "06:00", "10:00")) == "morning"
    assert he.band(_s("x", MONDAY, "05:00", "08:00")) == "early"
    assert he.band(_s("x", MONDAY, "17:00", "21:00")) == "evening"
    # Math.round on a half goes up, like the client: 08:00-17:00 is 12:30.
    assert he.band(_s("x", MONDAY, "08:00", "17:00")) == "afternoon"


def test_published_instants_are_read_on_the_business_clock():
    # An instant sent in UTC, as the browser sends it, is the Madrid wall
    # clock the planner wrote -- including the end of a night shift.
    start = datetime.combine(MONDAY, time(22, 0), tzinfo=MADRID)
    end = start + timedelta(hours=8)
    utc = ZoneInfo("UTC")
    [shift] = he.published_shifts(
        [("carla", start.astimezone(utc), end.astimezone(utc))]
    )
    assert shift == _s("carla", MONDAY, "22:00", "06:00")


def test_a_day_touched_by_an_absence_is_not_learnable():
    class _Span:
        def __init__(self, lower, upper):
            self.lower, self.upper = lower, upper

    afternoon = datetime.combine(MONDAY, time(15, 0), tzinfo=MADRID)
    spans = [_Span(afternoon, afternoon + timedelta(hours=3))]

    # Her morning that day went for the same reason her afternoon did.
    assert he._touches_absence(_s("ana", MONDAY, "08:00", "12:00"), spans)
    assert not he._touches_absence(
        _s("ana", MONDAY + timedelta(days=1), "08:00", "12:00"), spans
    )


# --- 3. a proposal, never a rule -------------------------------------------


class _Session:
    """The thinnest thing that behaves like the session this code uses."""

    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.added = []

    def execute(self, _stmt):
        session = self

        class _Result:
            def scalar_one_or_none(self):
                return session.rows[0] if session.rows else None

        return _Result()

    def add(self, row):
        self.added.append(row)
        self.rows.append(row)

    def flush(self):
        pass


def _value():
    return {
        "source": "hand_edits",
        "pattern": "trim",
        "weekday": 1,
        "band": "morning",
        "text": "Cada lunes por la mañana basta con la cobertura mínima: sin turnos de más.",
    }


def test_a_pattern_from_retouches_changes_nothing_until_confirmed():
    db = _Session()
    assert bp.propose_from_edits(db, ORG, "stated:edit:trim:1:morning", _value(), 3)

    [hint] = db.added
    assert hint.value["accepted"] is False
    assert bp.is_stated(hint) and bp.is_from_edits(hint)
    assert bp.is_active(hint) is False
    # Once confirmed it is heard as the manager's own rule, and not before.
    assert bp.planning_context(_Profile(), [hint]) == ""
    hint.value = {**hint.value, "accepted": True}
    assert "sin turnos de más" in bp.planning_context(_Profile(), [hint])


def test_seeing_the_pattern_again_is_the_same_proposal():
    db = _Session()
    bp.propose_from_edits(db, ORG, "stated:edit:trim:1:morning", _value(), 3)
    again = bp.propose_from_edits(db, ORG, "stated:edit:trim:1:morning", _value(), 4)

    assert again is False
    assert len(db.added) == 1


def test_a_rejected_pattern_stays_rejected():
    rejected = LearnedHint(
        org_id=ORG,
        key="stated:edit:trim:1:morning",
        value={**_value(), "accepted": False},
        evidence_days=3,
        rejected=True,
    )
    db = _Session([rejected])

    assert bp.propose_from_edits(db, ORG, rejected.key, _value(), 9) is False
    assert rejected.rejected is True
    assert rejected.value["accepted"] is False
    assert db.added == []


def test_only_keys_of_its_own_kind_and_sentences_that_fit_are_written():
    db = _Session()
    assert bp.propose_from_edits(db, ORG, "stated:abc", _value(), 3) is False
    assert bp.propose_from_edits(
        db, ORG, "stated:edit:x", {**_value(), "text": "x" * 301}, 3
    ) is False
    assert db.added == []


class _Profile:
    learning_enabled = True
    vertical = None
    vertical_source = "declared"
    location = None
    house_notes = None
    interview_notes = None
    research_notes = None
    objective = None
    weekend_days = None


# --- 2 and 4. through the real endpoint --------------------------------------


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


def _signup(client) -> tuple:
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Retouch Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Marta",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["access_token"], uuid.UUID(body["user"]["org_id"])


def _add(client, token: str, name: str) -> str:
    resp = client.post(
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
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _as_tenant(org_id, work):
    from app.db import AppSessionLocal, set_current_org

    db = AppSessionLocal()
    try:
        set_current_org(db, org_id)
        out = work(db)
        db.commit()
        return out
    finally:
        db.close()


def _planned(org_id, month: str, shifts: list) -> uuid.UUID:
    """A finished generation job, as the worker would have left it."""
    from app.models.generation_job import GenerationJob, GenerationMonth

    def work(db):
        job = GenerationJob(
            org_id=org_id,
            status="done",
            effort="low",
            months=[month],
            context="snapshot",
            employees=[],
            templates=[],
        )
        db.add(job)
        db.flush()
        db.add(
            GenerationMonth(
                org_id=org_id,
                job_id=job.id,
                month=month,
                status="planned",
                shifts=[
                    {
                        "employeeId": s.employee_id,
                        "date": s.day.isoformat(),
                        "start": he._hhmm(s.start),
                        "end": he._hhmm(s.end),
                    }
                    for s in shifts
                ],
            )
        )
        db.flush()
        return job.id

    return _as_tenant(org_id, work)


def _wire(shifts):
    out = []
    for s in shifts:
        start = datetime.combine(s.day, time.min, tzinfo=MADRID) + timedelta(minutes=s.start)
        end = datetime.combine(s.day, time.min, tzinfo=MADRID) + timedelta(minutes=s.end)
        out.append(
            {
                "employee_id": s.employee_id,
                "start_at": start.isoformat(),
                "end_at": end.isoformat(),
                "source": "ai",
            }
        )
    return out


def _publish(client, token, first: date, days: int, shifts):
    start = datetime.combine(first, time.min, tzinfo=MADRID)
    resp = client.post(
        "/api/v1/schedule/publish",
        headers=_auth(token),
        json={
            "period_start": start.isoformat(),
            "period_end": (start + timedelta(days=days)).isoformat(),
            "shifts": _wire(shifts),
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _team(client, token):
    return {k: _add(client, token, n) for k, n in
            (("ana", "Ana Ruiz"), ("bea", "Bea Pons"), ("carla", "Carla Soler"))}


def _month(ids, first=MONDAY, weeks=4):
    return [
        Shift(ids[s.employee_id], s.day, s.start, s.end)
        for s in _week(first, weeks=weeks)
    ]


def _trimmed(shifts, bea):
    return [s for s in shifts if not (s.employee_id == bea and s.start == 8 * 60)]


def _hints(client, token):
    resp = client.get("/api/v1/profile", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return {h["key"]: h for h in resp.json()["hints"]}


def _observations(org_id):
    from sqlalchemy import select

    from app.models.hand_edit_observation import HandEditObservation

    return _as_tenant(
        org_id,
        lambda db: list(
            db.execute(
                select(HandEditObservation.key, HandEditObservation.observed_on)
                .where(HandEditObservation.org_id == org_id)
            ).all()
        ),
    )


def _on(monkeypatch, day: date):
    monkeypatch.setattr("app.services.hand_edits._today", lambda: day)


TRIM = "stated:edit:trim:1:morning"


@skip_no_db
def test_three_publications_on_three_days_become_one_proposal(client, monkeypatch):
    token, org_id = _signup(client)
    ids = _team(client, token)
    proposal = _month(ids)
    _planned(org_id, "2027-02", proposal)

    # One week at a time, each on its own day: three pieces of evidence.
    for n, today in enumerate((date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 5))):
        _on(monkeypatch, today)
        first = MONDAY + timedelta(days=7 * n)
        week = [s for s in proposal if first <= s.day < first + timedelta(days=7)]
        _publish(client, token, first, 7, _trimmed(week, ids["bea"]))
        if n < 2:
            assert TRIM not in _hints(client, token), "a belief before its evidence"

    hint = _hints(client, token)[TRIM]
    assert hint["stated"] is True
    assert hint["accepted"] is False
    assert hint["active"] is False, "a pattern must never govern on its own"
    assert hint["value"]["source"] == "hand_edits"
    assert len(hint["value"]["text"]) <= 300


@skip_no_db
def test_three_publications_on_one_day_are_one_day_of_evidence(client, monkeypatch):
    token, org_id = _signup(client)
    ids = _team(client, token)
    proposal = _month(ids)
    _planned(org_id, "2027-02", proposal)

    _on(monkeypatch, date(2026, 10, 1))
    for n in range(3):
        first = MONDAY + timedelta(days=7 * n)
        week = [s for s in proposal if first <= s.day < first + timedelta(days=7)]
        _publish(client, token, first, 7, _trimmed(week, ids["bea"]))

    assert TRIM not in _hints(client, token)
    assert {d for k, d in _observations(org_id) if k == TRIM} == {date(2026, 10, 1)}


@skip_no_db
def test_republishing_the_same_month_is_not_new_evidence(client, monkeypatch):
    token, org_id = _signup(client)
    ids = _team(client, token)
    proposal = _month(ids)
    _planned(org_id, "2027-02", proposal)

    for today in (date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 5)):
        _on(monkeypatch, today)
        _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))

    assert TRIM not in _hints(client, token)
    assert [k for k, _ in _observations(org_id)].count(TRIM) == 1


@skip_no_db
def test_what_the_manager_only_added_leaves_no_trace(client, monkeypatch):
    token, org_id = _signup(client)
    ids = _team(client, token)
    dani = _add(client, token, "Dani Vidal")
    proposal = _month(ids)
    _planned(org_id, "2027-02", proposal)
    extra = [Shift(dani, MONDAY + timedelta(days=i), 12 * 60, 16 * 60) for i in range(28)]

    _on(monkeypatch, date(2026, 10, 1))
    _publish(client, token, MONDAY, 28, proposal + extra)

    assert _observations(org_id) == []


@skip_no_db
def test_learning_switched_off_watches_nothing(client, monkeypatch):
    token, org_id = _signup(client)
    ids = _team(client, token)
    off = client.put(
        "/api/v1/profile", headers=_auth(token), json={"learning_enabled": False}
    )
    assert off.status_code == 200, off.text
    proposal = _month(ids)
    _planned(org_id, "2027-02", proposal)

    for n, today in enumerate((date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 5))):
        _on(monkeypatch, today)
        first = MONDAY + timedelta(days=7 * n)
        week = [s for s in proposal if first <= s.day < first + timedelta(days=7)]
        _publish(client, token, first, 7, _trimmed(week, ids["bea"]))

    assert _observations(org_id) == []
    assert TRIM not in _hints(client, token)


@skip_no_db
def test_a_rejected_proposal_is_not_proposed_again(client, monkeypatch):
    token, org_id = _signup(client)
    ids = _team(client, token)
    proposal = _month(ids)
    _planned(org_id, "2027-02", proposal)

    for n, today in enumerate((date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 5))):
        _on(monkeypatch, today)
        first = MONDAY + timedelta(days=7 * n)
        week = [s for s in proposal if first <= s.day < first + timedelta(days=7)]
        _publish(client, token, first, 7, _trimmed(week, ids["bea"]))

    no = client.put(
        "/api/v1/profile/hints/%s" % TRIM,
        headers=_auth(token),
        json={"rejected": True},
    )
    assert no.status_code == 200, no.text

    # A fourth week, and a whole new job with more of the same.
    _on(monkeypatch, date(2026, 10, 9))
    first = MONDAY + timedelta(days=21)
    week = [s for s in proposal if first <= s.day < first + timedelta(days=7)]
    _publish(client, token, first, 7, _trimmed(week, ids["bea"]))
    march = _month(ids, first=date(2027, 3, 1), weeks=3)
    _planned(org_id, "2027-03", march)
    _on(monkeypatch, date(2026, 10, 12))
    _publish(client, token, date(2027, 3, 1), 21, _trimmed(march, ids["bea"]))

    hint = _hints(client, token)[TRIM]
    assert hint["rejected"] is True
    assert hint["accepted"] is False
    assert hint["active"] is False


@skip_no_db
def test_a_learner_that_breaks_does_not_break_the_publish(client, monkeypatch):
    token, org_id = _signup(client)
    ids = _team(client, token)
    proposal = _month(ids)
    _planned(org_id, "2027-02", proposal)

    def explode(*_a, **_k):
        raise RuntimeError("the learner is having a bad day")

    monkeypatch.setattr("app.services.hand_edits.learn_from_publication", explode)

    body = _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))

    assert body["published"] == len(_trimmed(proposal, ids["bea"]))
    got = client.get(
        "/api/v1/schedule/assignments",
        headers=_auth(token),
        params={
            "from": datetime.combine(MONDAY, time.min, tzinfo=MADRID).isoformat(),
            "to": datetime.combine(
                MONDAY + timedelta(days=28), time.min, tzinfo=MADRID
            ).isoformat(),
        },
    )
    assert got.status_code == 200, got.text
    assert len(got.json()) == body["published"]


@skip_no_db
def test_one_business_cannot_read_anothers_evidence(client, monkeypatch):
    from sqlalchemy import select

    from app.models.hand_edit_observation import HandEditObservation

    token, org_id = _signup(client)
    ids = _team(client, token)
    proposal = _month(ids)
    _planned(org_id, "2027-02", proposal)
    _on(monkeypatch, date(2026, 10, 1))
    _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))
    assert _observations(org_id), "the owner sees its own evidence"

    _, other = _signup(client)
    seen = _as_tenant(
        other,
        lambda db: list(db.execute(select(HandEditObservation.key)).scalars()),
    )
    assert seen == []

    # And cannot write into it either.
    def smuggle(db):
        db.add(
            HandEditObservation(
                org_id=org_id,
                key=TRIM,
                job_id=uuid.uuid4(),
                period_start=MONDAY,
                observed_on=date(2026, 10, 2),
            )
        )
        db.flush()

    with pytest.raises(Exception):
        _as_tenant(other, smuggle)
