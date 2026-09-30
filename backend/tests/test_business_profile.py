from __future__ import annotations

"""The adaptive layer, and the four ways it is stopped from inventing things.

These tests are mostly about what the feature must NOT do. Personalisation
that quietly adds staff a manager never asked for is worse than no
personalisation, so the interesting assertions here are negative ones: the
brief is never overwritten, a stereotype never acts on its own, one bad
afternoon never becomes a rule, and nothing about a person is ever learned.

The pure-logic tests need no database. The evidence and endpoint tests do, and
skip themselves with a clear reason when Postgres is not reachable -- same
convention as ``test_tenant_isolation``.
"""

import uuid
from datetime import date, timedelta

import pytest

from app.services import business_profile as bp
from app.services.intake import ScheduleBrief, brief_to_spec, unstated_fields
from app.models.business_profile import BusinessProfile
from app.models.learned_hint import LearnedHint


def _hint(key: str, value: dict, evidence: int = bp.MIN_EVIDENCE, **kw) -> LearnedHint:
    """A hint object with no session behind it -- enough for the pure logic."""
    return LearnedHint(
        org_id=uuid.uuid4(),
        key=key,
        value=value,
        evidence_days=evidence,
        contradictions=kw.get("contradictions", 0),
        rejected=kw.get("rejected", False),
    )


# --- What may be learned at all --------------------------------------------


@pytest.mark.parametrize(
    "op",
    [
        {"op": "day_off", "employee": "Ana", "weekday": 5},
        {"op": "add_shift", "employee": "Marcus", "date": "2026-09-04",
         "start": "09:00", "end": "17:00"},
        {"op": "swap", "employee": "Ana", "employee_b": "Marcus",
         "date": "2026-09-04"},
        {"op": "remove_shifts", "employee": "Ana", "weekday": 1},
        {"op": "move_shift", "employee": "Ana", "date": "2026-09-04",
         "start": "10:00"},
        {"op": "add_employee", "name": "Ana", "count": 1},
        {"op": "rename_employee", "employee": "#2", "name": "Ana"},
        {"op": "set_employee_terms", "employee": "Ana", "hourly_rate": 18.0},
        {"op": "set_employee_status", "employee": "Ana", "status": "on_leave"},
    ],
)
def test_operations_about_people_teach_nothing(op):
    """A preference about a business must not become a file on its staff.

    Every one of these says something about a PERSON. None of them is written
    down, so no learned hint can ever be traced back to who took a Friday off.
    """
    assert bp._hint_from_op(op) is None


def test_a_one_off_date_is_not_a_pattern():
    """"Six people on the 24th" is about Christmas Eve, not about the business."""
    assert (
        bp._hint_from_op(
            {"op": "add_coverage", "date": "2026-12-24", "start": "18:00",
             "end": "23:00", "staff": 3}
        )
        is None
    )


def test_a_weekday_window_is_a_pattern():
    derived = bp._hint_from_op(
        {"op": "add_coverage", "weekday": 5, "start": "20:00", "end": "23:00",
         "staff": 2}
    )
    assert derived is not None
    key, value, _label = derived
    assert key == "busy_window:5:1200-1380"
    assert value == {"extra": 2, "weekday": 5, "startMin": 1200, "endMin": 1380}


def test_the_same_correction_always_produces_the_same_key():
    """Sharing a key IS the mechanism by which evidence accumulates."""
    op = {"op": "add_coverage", "weekday": 5, "start": "20:00", "end": "23:00",
          "staff": 1}
    assert bp._hint_from_op(op)[0] == bp._hint_from_op(dict(op))[0]


# --- When a belief is allowed to act ---------------------------------------


def test_one_correction_is_not_a_belief():
    assert not bp.is_active(_hint("min_staff", {"staff": 3}, evidence=1))
    assert not bp.is_active(_hint("min_staff", {"staff": 3}, evidence=2))
    assert bp.is_active(_hint("min_staff", {"staff": 3}, evidence=3))


def test_a_contradicted_belief_stops_acting():
    hint = _hint("min_staff", {"staff": 3}, evidence=10,
                 contradictions=bp.MAX_CONTRADICTIONS)
    assert not bp.is_active(hint)


def test_rejection_outranks_any_amount_of_evidence():
    hint = _hint("min_staff", {"staff": 3}, evidence=99, rejected=True)
    assert not bp.is_active(hint)


# --- The brief always wins -------------------------------------------------


def _spec(**over) -> dict:
    """A spec as brief_to_spec would return it, for the fields under test."""
    base = {
        "openMin": 8 * 60,
        "closeMin": 22 * 60,
        "minStaff": 2,
        "coverage": [],
        "closedWeekdays": [],
        "maxHoursPerWeek": 40,
        "rules": [],
    }
    base.update(over)
    return base


def test_a_hint_never_touches_a_field_the_brief_stated():
    """The one line that keeps this from being bias: only silent fields.

    The manager said two people. We believe four. Four is not applied, and it
    is not even mentioned as applied -- their sentence is the answer.
    """
    spec = _spec(minStaff=2)
    applied = bp.apply_hints(
        spec, unstated=[], hints=[_hint("min_staff", {"staff": 4})]
    )
    assert applied == []
    assert spec["minStaff"] == 2
    assert spec["rules"] == []


def test_a_hint_fills_a_field_the_brief_left_silent():
    spec = _spec(minStaff=2)
    applied = bp.apply_hints(
        spec, unstated=["min_staff"], hints=[_hint("min_staff", {"staff": 4})]
    )
    assert spec["minStaff"] == 4
    assert [a["field"] for a in applied] == ["minStaff"]
    assert applied[0]["evidence"] == bp.MIN_EVIDENCE
    # Everything applied is visible in the spec the manager reads back.
    assert [r["origin"] for r in spec["rules"]] == ["profile"]


def test_a_learned_floor_never_cuts_cover():
    """A wrong guess that understaffs a shift is worse than one that costs an hour."""
    spec = _spec(minStaff=3)
    applied = bp.apply_hints(
        spec, unstated=["min_staff"], hints=[_hint("min_staff", {"staff": 1})]
    )
    assert spec["minStaff"] == 3
    assert applied == []


def test_a_learned_window_stays_out_of_one_the_brief_claimed():
    """The brief spoke about Friday evening. We do not add to it."""
    stated = {
        "weekdays": [5],
        "dates": [],
        "startMin": 18 * 60,
        "endMin": 23 * 60,
        "staff": 3,
        "exact": True,
    }
    spec = _spec(coverage=[stated])
    applied = bp.apply_hints(
        spec,
        unstated=["coverage"],
        hints=[
            _hint(
                "busy_window:5:1200-1380",
                {"extra": 2, "weekday": 5, "startMin": 1200, "endMin": 1380},
            )
        ],
    )
    assert applied == []
    assert spec["coverage"] == [stated]


def test_a_learned_window_applies_where_the_brief_was_silent():
    spec = _spec(minStaff=2)
    bp.apply_hints(
        spec,
        unstated=["coverage"],
        hints=[
            _hint(
                "busy_window:5:1200-1380",
                {"extra": 2, "weekday": 5, "startMin": 1200, "endMin": 1380},
            )
        ],
    )
    assert spec["coverage"] == [
        {
            "weekdays": [5],
            "dates": [],
            "startMin": 1200,
            "endMin": 1380,
            "staff": 4,
            # Never exact: a learned window may add people, never cap them.
            "exact": False,
        }
    ]


def test_hints_can_only_write_whitelisted_fields():
    """Pay, contract hours and legal rest are unreachable from here.

    Not by convention -- by running every hint kind we know how to derive and
    checking what actually moved.
    """
    spec = _spec()
    before = dict(spec)
    bp.apply_hints(
        spec,
        unstated=[
            "min_staff", "opening_hours", "coverage", "closures",
            "max_weekly_hours", "min_rest", "shift_length", "horizon",
        ],
        hints=[
            _hint("min_staff", {"staff": 4}),
            _hint("opening_hours", {"openMin": 600, "closeMin": 1440}),
            _hint("max_weekly_hours", {"hours": 32}),
            _hint("closed_weekday:0", {"closed": True, "weekday": 0}),
            _hint("peak:720-900", {"staff": 5, "startMin": 720, "endMin": 900}),
        ],
    )
    changed = {k for k in spec if k != "rules" and spec[k] != before.get(k)}
    assert changed <= bp.WRITABLE_FIELDS
    # And the fields nobody may ever infer are absent from the whitelist itself.
    for forbidden in ("minRestHours", "hourlyRate", "annualSalary", "team"):
        assert forbidden not in bp.WRITABLE_FIELDS


def test_an_inactive_hint_changes_nothing():
    spec = _spec()
    applied = bp.apply_hints(
        spec, unstated=["min_staff"], hints=[_hint("min_staff", {"staff": 9}, evidence=1)]
    )
    assert applied == []
    assert spec["minStaff"] == 2


# --- The holes nobody filled ------------------------------------------------


def test_gaps_report_what_a_default_decided():
    silent = ["opening_hours", "min_staff", "coverage"]
    out = bp.gaps(silent, applied=[])
    assert {g["field"] for g in out} == set(silent)
    assert all(g["filledBy"] == "default" for g in out)
    assert all(g["loud"] for g in out)


def test_a_field_a_hint_filled_is_not_a_gap():
    out = bp.gaps(
        ["min_staff", "coverage"],
        applied=[{"key": "min_staff", "field": "minStaff", "label": "", "source":
                  "profile", "evidence": 3}],
    )
    assert [g["field"] for g in out] == ["coverage"]


def test_unstated_fields_names_every_silence():
    silent = unstated_fields(ScheduleBrief())
    assert set(silent) == {
        "opening_hours", "min_staff", "coverage", "closures",
        "shift_length", "max_weekly_hours", "min_rest", "horizon",
    }


def test_a_stated_field_is_not_silent():
    brief = ScheduleBrief(open_time="10:00", close_time="20:00", min_staff=3)
    silent = unstated_fields(brief)
    assert "opening_hours" not in silent
    assert "min_staff" not in silent
    # And the spec built from it is untouched by a contradicting hint.
    spec = brief_to_spec(brief)
    bp.apply_hints(spec, silent, [_hint("min_staff", {"staff": 8})])
    assert spec["minStaff"] == 3


# --- What reaches the model -------------------------------------------------


def _profile(**kw) -> BusinessProfile:
    p = BusinessProfile(org_id=uuid.uuid4())
    p.vertical = kw.get("vertical")
    p.vertical_source = kw.get("vertical_source", "declared")
    p.house_notes = kw.get("house_notes")
    p.learning_enabled = kw.get("learning_enabled", True)
    return p


def test_no_context_when_we_know_nothing():
    assert bp.model_context(_profile(), hints=[]) == ""


def test_no_context_when_the_manager_switched_learning_off():
    profile = _profile(vertical="bar", learning_enabled=False)
    assert bp.model_context(profile, [_hint("min_staff", {"staff": 4})]) == ""


def test_an_inferred_vertical_is_withheld_from_the_model():
    """We are not allowed to feed our own guess back as if it were a fact."""
    guessed = _profile(vertical="bar", vertical_source="inferred")
    assert "bar" not in bp.model_context(guessed, hints=[])

    declared = _profile(vertical="bar", vertical_source="declared")
    assert "bar" in bp.model_context(declared, hints=[])


def test_only_believed_hints_reach_the_model():
    profile = _profile(vertical="bar")
    context = bp.model_context(
        profile,
        [
            _hint("min_staff", {"staff": 4}, evidence=bp.MIN_EVIDENCE),
            _hint("max_weekly_hours", {"hours": 12}, evidence=1),
        ],
    )
    assert "4 people" in context
    assert "12 hours" not in context


def test_the_context_tells_the_model_it_is_not_a_requirement():
    context = bp.model_context(_profile(vertical="bar"), hints=[])
    assert "not instructions" in context
    assert "does not license you to add" in context
    assert "the brief is right" in context


# --- A stereotype never acts on its own -------------------------------------


def test_a_vertical_only_ever_suggests():
    """The bar template proposes; it does not change a single spec field."""
    profile = _profile(vertical="bar")
    silent = ["coverage", "min_staff"]
    suggestions = bp.suggestions_for(profile, silent)
    assert suggestions and all(s["source"] == "template" for s in suggestions)

    spec = _spec()
    before = dict(spec)
    bp.apply_hints(spec, silent, hints=[])
    assert spec == before


def test_a_guessed_vertical_suggests_nothing():
    profile = _profile(vertical="bar", vertical_source="inferred")
    assert bp.suggestions_for(profile, ["coverage"]) == []


def test_suggestions_stay_out_of_a_field_the_brief_stated():
    profile = _profile(vertical="bar")
    assert bp.suggestions_for(profile, unstated=[]) == []


def test_every_vertical_is_well_formed():
    for code, vertical in bp.VERTICALS.items():
        assert vertical.code == code
        assert vertical.label and vertical.context
        for s in vertical.suggestions:
            assert {"key", "label", "field", "shape", "value"} <= set(s)


# --- Evidence over time (needs a database) ----------------------------------


def _db_available() -> bool:
    try:
        from sqlalchemy import text

        from app.db import app_engine

        with app_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


DB_AVAILABLE = _db_available()

skip_no_db = pytest.mark.skipif(
    not DB_AVAILABLE,
    reason="No Postgres reachable. Start it and run `alembic upgrade head`.",
)


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


def _signup(client) -> str:
    email = "owner+%s@example.com" % uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Profile Co %s" % uuid.uuid4().hex[:6],
            "email": email,
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


def _org_session(token: str):
    """A tenant session bound to the org in this token."""
    from app.db import AppSessionLocal, set_current_org
    from app.security import decode_access_token

    org_id = uuid.UUID(str(decode_access_token(token)["org_id"]))
    db = AppSessionLocal()
    set_current_org(db, org_id)
    return db, org_id


def _commit(db, org_id) -> None:
    """Commit, then re-arm the tenant context.

    ``set_current_org`` uses ``SET LOCAL``, so the org is scoped to the
    transaction and a commit clears it. Reading afterwards without re-arming
    makes the RLS policy compare against an empty string, which is a type error
    rather than an empty result -- worth reproducing here, since it is exactly
    what a ``db.commit()`` inside a request handler would do.
    """
    from app.db import set_current_org

    db.commit()
    set_current_org(db, org_id)


COVER = {"op": "add_coverage", "weekday": 5, "start": "20:00", "end": "23:00",
         "staff": 1}


@skip_no_db
def test_one_bad_afternoon_is_not_a_standing_rule(client):
    """Five clicks on one Friday is one day of evidence, not five."""
    token = _signup(client)
    db, org_id = _org_session(token)
    try:
        today = date(2026, 9, 3)
        for _ in range(5):
            bp.observe(db, org_id, [COVER], today=today)
        _commit(db, org_id)
        hints = bp.hints_for(db, org_id)
        assert len(hints) == 1
        assert hints[0].evidence_days == 1
        assert not bp.is_active(hints[0])
    finally:
        db.close()


@skip_no_db
def test_the_same_correction_on_three_days_becomes_a_belief(client):
    token = _signup(client)
    db, org_id = _org_session(token)
    try:
        start = date(2026, 9, 3)
        for offset in range(bp.MIN_EVIDENCE):
            bp.observe(db, org_id, [COVER], today=start + timedelta(days=offset))
        _commit(db, org_id)
        hint = bp.hints_for(db, org_id)[0]
        assert hint.evidence_days == bp.MIN_EVIDENCE
        assert bp.is_active(hint)
    finally:
        db.close()


@skip_no_db
def test_a_business_that_changed_can_teach_us_the_new_number(client):
    """Contradicted enough, the old belief is replaced and starts earning again."""
    token = _signup(client)
    db, org_id = _org_session(token)
    try:
        start = date(2026, 9, 3)
        for offset in range(bp.MIN_EVIDENCE):
            bp.observe(db, org_id, [COVER], today=start + timedelta(days=offset))
        _commit(db, org_id)
        assert bp.is_active(bp.hints_for(db, org_id)[0])

        changed = {**COVER, "staff": 3}
        for offset in range(bp.MAX_CONTRADICTIONS):
            bp.observe(db, org_id, [changed], today=start + timedelta(days=10 + offset))
        _commit(db, org_id)

        hint = bp.hints_for(db, org_id)[0]
        assert hint.value["extra"] == 3
        # The new number has to earn its own evidence; it does not inherit.
        assert hint.evidence_days == 1
        assert not bp.is_active(hint)
    finally:
        db.close()


@skip_no_db
def test_one_plan_may_repeat_the_same_correction(client):
    """"One more on Friday evening, and one more on Friday evening."

    A single refine plan can carry the same claim twice. Both land in one
    ``observe`` call, before anything is committed, so the row created by the
    first has to be visible to the second -- the session does not autoflush,
    and without an explicit flush this raised a unique violation and the
    manager got a 500 for a calendar that had already been corrected.
    """
    token = _signup(client)
    db, org_id = _org_session(token)
    try:
        bp.observe(db, org_id, [COVER, COVER, COVER], today=date(2026, 9, 3))
        _commit(db, org_id)
        hints = bp.hints_for(db, org_id)
        assert len(hints) == 1
        assert hints[0].evidence_days == 1
    finally:
        db.close()


@skip_no_db
def test_nothing_about_a_person_is_ever_written_down(client):
    token = _signup(client)
    db, org_id = _org_session(token)
    try:
        from sqlalchemy import select

        from app.models.refine_observation import RefineObservation

        bp.observe(
            db,
            org_id,
            [
                {"op": "day_off", "employee": "Ana", "weekday": 5},
                {"op": "set_employee_terms", "employee": "Ana", "hourly_rate": 22.5},
                {"op": "add_shift", "employee": "Marcus", "date": "2026-09-04",
                 "start": "09:00", "end": "17:00"},
            ],
        )
        _commit(db, org_id)
        rows = list(
            db.execute(
                select(RefineObservation).where(RefineObservation.org_id == org_id)
            ).scalars()
        )
        assert rows == []
        assert bp.hints_for(db, org_id) == []
    finally:
        db.close()


# --- The endpoints ----------------------------------------------------------


@skip_no_db
def test_a_new_account_believes_nothing(client):
    token = _signup(client)
    resp = client.get("/api/v1/profile", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["vertical"] is None
    assert body["hints"] == []
    assert body["learning_enabled"] is True
    assert {v["code"] for v in body["verticals"]} == set(bp.VERTICALS)


@skip_no_db
def test_declaring_a_vertical_marks_it_as_declared(client):
    token = _signup(client)
    resp = client.put(
        "/api/v1/profile", headers=_auth(token), json={"vertical": "bar"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["vertical"] == "bar"
    assert resp.json()["vertical_source"] == "declared"


@skip_no_db
def test_an_unknown_vertical_is_refused(client):
    token = _signup(client)
    resp = client.put(
        "/api/v1/profile", headers=_auth(token), json={"vertical": "submarine"}
    )
    assert resp.status_code == 422


@skip_no_db
def test_the_manager_can_reject_a_belief(client):
    token = _signup(client)
    db, org_id = _org_session(token)
    try:
        start = date(2026, 9, 3)
        for offset in range(bp.MIN_EVIDENCE):
            bp.observe(db, org_id, [COVER], today=start + timedelta(days=offset))
        _commit(db, org_id)
        key = bp.hints_for(db, org_id)[0].key
    finally:
        db.close()

    listed = client.get("/api/v1/profile", headers=_auth(token)).json()
    assert [h["active"] for h in listed["hints"]] == [True]

    resp = client.put(
        "/api/v1/profile/hints/%s" % key, headers=_auth(token),
        json={"rejected": True},
    )
    assert resp.status_code == 200, resp.text
    hint = resp.json()["hints"][0]
    assert hint["rejected"] is True
    assert hint["active"] is False
    # The evidence is kept, so the manager can still see what we had thought.
    assert hint["evidence"] == bp.MIN_EVIDENCE


@skip_no_db
def test_switching_learning_off_stops_observations_being_recorded(client):
    token = _signup(client)
    client.put(
        "/api/v1/profile", headers=_auth(token), json={"learning_enabled": False}
    )
    resp = client.post(
        "/api/v1/profile/observations", headers=_auth(token), json={"ops": [COVER]}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"recorded": 0, "learned": []}
    assert client.get("/api/v1/profile", headers=_auth(token)).json()["hints"] == []


@skip_no_db
def test_one_org_never_learns_from_another(client):
    """Beliefs are tenant data like any other -- RLS applies."""
    token_a = _signup(client)
    token_b = _signup(client)

    client.post(
        "/api/v1/profile/observations", headers=_auth(token_b), json={"ops": [COVER]}
    )
    assert client.get("/api/v1/profile", headers=_auth(token_a)).json()["hints"] == []
    assert len(client.get("/api/v1/profile", headers=_auth(token_b)).json()["hints"]) == 1


@skip_no_db
def test_an_employee_cannot_read_what_we_learned(client):
    """The profile is the manager's; a colleague has no business in it."""
    token = _signup(client)
    # A manager token is the only kind signup issues, so the check that matters
    # here is the dependency itself being the manager one.
    from app.routers import business_profile as router_module

    for route in router_module.router.routes:
        deps = [d.call.__name__ for d in route.dependant.dependencies]
        assert "get_current_manager" in deps, route.path
