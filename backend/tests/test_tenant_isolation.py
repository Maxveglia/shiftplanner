from __future__ import annotations

"""Tenant isolation: the double barrier, checked from both sides.

This product keeps every customer's staff, contracts, sick leave and rota in
ONE database. What keeps them apart is two independent things, and they fail
differently, so they are checked separately here.

THE FIRST BARRIER is the application: every tenant query carries an explicit
``org_id`` filter taken from the token, never from the request. If it broke,
one customer would be handed another's rows through a perfectly normal-looking
API call -- the classic IDOR. The tests under ``TestTheApiBorder`` try exactly
that: org A holding a real id belonging to org B, on every family of resource
the API exposes, read AND write.

THE SECOND BARRIER is Postgres row-level security. The runtime connects as
``app_user``, a ``NOSUPERUSER NOBYPASSRLS`` role, and every table of customer
data carries a ``FORCE``d ``org_isolation`` policy comparing its ``org_id``
against ``current_setting('app.current_org_id', true)::uuid``. If the first
barrier broke, this one would still return nothing. The tests under
``TestTheDatabaseBorder`` bypass the API entirely and talk to Postgres as
``app_user``, because a second barrier nobody exercises is a second barrier
nobody knows is there.

THE CASE WORTH THE MOST is neither: it is that the second barrier FAILS CLOSED.
``current_setting(..., true)`` returns NULL when the variable was never set, so
a connection with no org context compares every row against NULL and sees zero
of them. The alternative spelling of that policy -- one that treats "no
context" as "no restriction" -- would pass every other test in this file and
hand the whole table to any code path that forgot to set the org. So it is
pinned on its own: no context, zero rows, not all rows.

WHY THE FIXTURES BUILD TWO WHOLE ORGANISATIONS. Isolation is not a property of
an endpoint, it is a property of a pair. A single org with a made-up UUID
proves only that random ids are not found. Two orgs with the SAME SHAPE of data
-- both with an employee, a contract, time off, a login, a template, a
published shift, a draft, a profile, a queued generation -- mean every 404 in
here is a 404 about a row that genuinely exists, one tenant over.

Run with a DB:
    createdb shiftplanner   # or docker compose up db
    alembic upgrade head
    pytest tests/test_tenant_isolation.py
"""

import re
import uuid
from dataclasses import dataclass
from typing import List, Optional, Tuple

import pytest

from tests.menu_photo_samples import JPEG, PNG

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


DB_AVAILABLE = _db_available()

skip_no_db = pytest.mark.skipif(
    not DB_AVAILABLE,
    reason=(
        "No Postgres reachable. Start Postgres, run `alembic upgrade head`, "
        "then re-run. See module docstring."
    ),
)


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


def _signup(client, org_name: str):
    email = "owner+%s@example.com" % uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": org_name,
            "email": email,
            "password": "s3cret-pass",
            "full_name": "Owner " + org_name,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


# --- Two furnished organisations ---------------------------------------------
# Windows far enough out that nothing else in the suite is planning them, and
# far enough apart from each other that a draft and a publication never meet on
# the overlap constraint.
PUBLISHED_FROM = "2027-03-01T00:00:00Z"
PUBLISHED_TO = "2027-04-01T00:00:00Z"
PUBLISHED_SHIFT = ("2027-03-02T09:00:00Z", "2027-03-02T17:00:00Z")
# The one day that shift falls on. `/schedule/day-team` refuses a window wider
# than 26 hours -- an employee is shown their colleagues for A DAY, and asking
# for a year of it is the scrape that cap exists to refuse. This file asked for
# the whole month, which passed until the cap landed in main: two branches that
# never touched the same line, so nothing went red until both were merged.
PUBLISHED_DAY = ("2027-03-02T00:00:00Z", "2027-03-03T00:00:00Z")
DRAFT_FROM = "2027-05-01T00:00:00Z"
DRAFT_TO = "2027-06-01T00:00:00Z"
DRAFT_SHIFT = ("2027-05-04T09:00:00Z", "2027-05-04T17:00:00Z")
# A third window, used only by tests that need to attempt a write of their own
# without disturbing the two above.
SPARE_FROM = "2027-08-01T00:00:00Z"
SPARE_TO = "2027-09-01T00:00:00Z"
SPARE_SHIFT = ("2027-08-03T09:00:00Z", "2027-08-03T17:00:00Z")

# Where each business says its day ends and which days it calls its weekend.
# Deliberately different: these two settings are the whole of what an employee
# is allowed to read about their employer, and a test that compares an answer
# against a value both orgs share is a test with no wrong answer to catch.
SHAPES = {
    "A": (240, [5, 6]),   # day rolls over at 04:00, weekend Sat+Sun
    "B": (360, [0]),      # day rolls over at 06:00, weekend Monday
}

# One day both sold on, and what each took beyond the dish: different, so a
# total that added the neighbour's in is a total that comes out wrong.
STORE_DAY = "2026-09-01"
SALE_TAKINGS = {"A": 100, "B": 7000}


@dataclass
class Tenant:
    """One organisation and an id from every family of data it owns.

    Every field here is something the OTHER organisation must not be able to
    read, change or delete, so each one is an argument to a test below.
    """

    label: str
    token: str
    org_id: str
    org_name: str
    login_email: str
    employee_id: str
    employee_name: str
    contract_id: str
    absence_id: str
    absence_type_id: str
    shift_template_id: str
    published_shift_id: str
    draft_shift_id: str
    generation_job_id: str
    house_notes: str
    staff_email: str
    hint_key: str
    day_boundary_min: int
    weekend_days: List[int]
    menu_section_id: str
    menu_dish_id: str
    menu_dish_name: str
    menu_photo_url: str
    store_sale_id: str


def _furnish(client, label: str) -> Tenant:
    """Create an organisation with one of everything the API can address.

    Built through the API rather than with INSERTs so the rows are exactly the
    ones a real customer would have -- including the per-org seeding of absence
    types and shift templates, which is itself a thing that could leak.
    """
    token = _signup(client, "Isolation %s" % label)
    head = _auth(token)
    me = client.get("/api/v1/auth/me", headers=head)
    assert me.status_code == 200, me.text
    me = me.json()

    employee_name = "Person of %s" % label
    emp = client.post(
        "/api/v1/employees",
        headers=head,
        json={
            "external_id": "E-%s" % label,
            "full_name": employee_name,
            "email": None,
            "employment_status": "active",
            "hire_date": "2025-01-01",
        },
    )
    assert emp.status_code == 201, emp.text
    employee_id = emp.json()["id"]

    contract = client.post(
        "/api/v1/employees/%s/contracts" % employee_id,
        headers=head,
        json={
            "employment_type": "non_exempt_hourly",
            "hourly_rate": 12.5,
            "min_hours_per_week": 40.0,
            "pay_period": "monthly",
            "valid_from": "2025-01-01",
        },
    )
    assert contract.status_code == 201, contract.text
    contract_id = contract.json()["id"]

    types = client.get("/api/v1/absence-types", headers=head)
    assert types.status_code == 200, types.text
    absence_type_id = next(t["id"] for t in types.json() if t["code"] == "VAC")

    absence = client.post(
        "/api/v1/absences",
        headers=head,
        json={
            "employee_id": employee_id,
            "absence_type_id": absence_type_id,
            "start_at": "2027-02-01T08:00:00Z",
            "end_at": "2027-02-03T08:00:00Z",
            "note": "Time off at %s" % label,
        },
    )
    assert absence.status_code == 201, absence.text
    absence_id = absence.json()["id"]

    # A login for that employee. This one is worth having because the endpoints
    # behind it run on the SUPERUSER session (email uniqueness is a pre-tenant
    # question), so RLS is not standing behind them -- see routers/accounts.py.
    staff_email = "staff+%s@example.com" % uuid.uuid4().hex[:8]
    account = client.post(
        "/api/v1/employees/%s/account" % employee_id,
        headers=head,
        json={"email": staff_email, "password": "another-s3cret"},
    )
    assert account.status_code == 201, account.text

    template = client.post(
        "/api/v1/shift-templates",
        headers=head,
        json={
            "name": "House shift %s" % label,
            "start_time": "09:00",
            "end_time": "17:00",
            "unpaid_break_minutes": 30,
            "color": "#c0ffee",
            "is_night": False,
            "is_weekend_premium": False,
        },
    )
    assert template.status_code == 201, template.text
    shift_template_id = template.json()["id"]

    published = client.post(
        "/api/v1/schedule/publish",
        headers=head,
        json={
            "period_start": PUBLISHED_FROM,
            "period_end": PUBLISHED_TO,
            "shifts": [
                {
                    "employee_id": employee_id,
                    "start_at": PUBLISHED_SHIFT[0],
                    "end_at": PUBLISHED_SHIFT[1],
                    "shift_template_id": shift_template_id,
                }
            ],
        },
    )
    assert published.status_code == 200, published.text
    rows = client.get(
        "/api/v1/schedule/assignments?from=%s&to=%s" % (PUBLISHED_FROM, PUBLISHED_TO),
        headers=head,
    )
    assert rows.status_code == 200, rows.text
    published_shift_id = rows.json()[0]["id"]

    draft = client.put(
        "/api/v1/schedule/draft",
        headers=head,
        json={
            "period_start": DRAFT_FROM,
            "period_end": DRAFT_TO,
            "shifts": [
                {
                    "employee_id": employee_id,
                    "start_at": DRAFT_SHIFT[0],
                    "end_at": DRAFT_SHIFT[1],
                    "shift_template_id": shift_template_id,
                }
            ],
        },
    )
    assert draft.status_code == 200, draft.text
    drafted = client.get(
        "/api/v1/schedule/draft?from=%s&to=%s" % (DRAFT_FROM, DRAFT_TO), headers=head
    )
    assert drafted.status_code == 200, drafted.text
    draft_shift_id = drafted.json()[0]["id"]

    house_notes = "Trade secret of %s: %s" % (label, uuid.uuid4().hex)
    # The business shape differs between the two organisations on purpose: it
    # is what an EMPLOYEE's own screens read, and two orgs sharing a default
    # would make "the right answer" and "the neighbour's answer" the same
    # value. A difference is what makes that read checkable at all.
    day_boundary_min, weekend_days = SHAPES[label]
    profile = client.put(
        "/api/v1/profile",
        headers=head,
        json={
            "house_notes": house_notes,
            "day_boundary_min": day_boundary_min,
            "weekend_days": weekend_days,
        },
    )
    assert profile.status_code == 200, profile.text

    # One learned hint, under a key that belongs to THIS org and no other.
    # Hints are addressed by key rather than by id, so a key that existed in
    # both organisations would be found in the caller's own row whether the
    # filter was there or not -- the endpoint would answer 200 either way and
    # the test would be about nothing. A key only the neighbour has is the only
    # shape of this question that has a wrong answer available.
    hint_key = _insert_learned_hint(me["org_id"], label)

    # A generation, written directly rather than enqueued: the endpoint refuses
    # a second job while one is in flight, and this row exists to be READ by
    # the wrong customer, not to be planned.
    #
    # `done` and not `queued`, which matters more than it looks. TestClient
    # runs the app's lifespan, which starts the generation workers, and they
    # poll `generation_job` every couple of seconds for anything queued --
    # including rows planted by a test. A queued row here is a row a worker
    # claims mid-test, and with an API key present (which is the case in CI,
    # and not on this machine) that is a real call to the model, bought by a
    # test that never wanted one. A terminal status is invisible to the claim
    # query, so there is no race to lose.
    job_id = _insert_generation_job(me["org_id"], label)

    # The menu: the one thing an EMPLOYEE of the business reads whole, so the
    # neighbour's has to be a menu that exists, with a dish in it by a name
    # only this org uses.
    section = client.post(
        "/api/v1/menu/sections", headers=head, json={"name": "Carta %s" % label}
    )
    assert section.status_code == 201, section.text
    menu_section_id = section.json()["id"]
    menu_dish_name = "Plato de la casa %s" % label
    dish = client.post(
        "/api/v1/menu/dishes",
        headers=head,
        json={"section_id": menu_section_id, "name": menu_dish_name, "price": 9.5},
    )
    assert dish.status_code == 201, dish.text
    menu_dish_id = dish.json()["id"]
    # With a photo: its address is given out only with the menu, so the
    # neighbour's menu must never carry it.
    photo = client.put(
        "/api/v1/menu/dishes/%s/photo" % menu_dish_id,
        headers={**head, "Content-Type": "image/jpeg"},
        content=JPEG,
    )
    assert photo.status_code == 200, photo.text
    menu_photo_url = photo.json()["photo_url"]

    # A sale of that dish and a free line, on a day both orgs sold on: what a
    # business takes is the manager's alone, and the neighbour's statistics
    # for the same day must not add it up.
    sale = client.post(
        "/api/v1/store/sales",
        headers=head,
        json={
            "sold_on": STORE_DAY,
            "client_ref": str(uuid.uuid4()),
            "lines": [
                {
                    "dish_id": menu_dish_id,
                    "name": menu_dish_name,
                    "unit_price": 9.5,
                    "quantity": 2,
                },
                {
                    "name": "Caja %s" % label,
                    "unit_price": SALE_TAKINGS[label],
                    "quantity": 1,
                },
            ],
        },
    )
    assert sale.status_code == 201, sale.text
    store_sale_id = sale.json()["id"]

    return Tenant(
        label=label,
        token=token,
        org_id=me["org_id"],
        org_name=me["org_name"],
        login_email=me["email"],
        employee_id=employee_id,
        employee_name=employee_name,
        contract_id=contract_id,
        absence_id=absence_id,
        absence_type_id=absence_type_id,
        shift_template_id=shift_template_id,
        published_shift_id=published_shift_id,
        draft_shift_id=draft_shift_id,
        generation_job_id=job_id,
        house_notes=house_notes,
        staff_email=staff_email,
        hint_key=hint_key,
        day_boundary_min=day_boundary_min,
        weekend_days=weekend_days,
        menu_section_id=menu_section_id,
        menu_dish_id=menu_dish_id,
        menu_dish_name=menu_dish_name,
        menu_photo_url=menu_photo_url,
        store_sale_id=store_sale_id,
    )


def _insert_generation_job(org_id: str, label: str) -> str:
    from sqlalchemy import text

    from app.db import AdminSessionLocal

    job_id = str(uuid.uuid4())
    db = AdminSessionLocal()
    try:
        db.execute(
            text(
                "INSERT INTO generation_job "
                "(id, org_id, status, effort, months, context, employees, "
                " templates, finished_at) "
                "VALUES (:id, :org, 'done', 'low', '[]'::jsonb, :ctx, "
                "'[]'::jsonb, '[]'::jsonb, now())"
            ),
            {"id": job_id, "org": org_id, "ctx": "Brief of %s" % label},
        )
        db.commit()
    finally:
        db.close()
    return job_id


def _insert_learned_hint(org_id: str, label: str) -> str:
    """One inferred belief about this business, under a key only it has.

    Written directly because the only way to grow a hint through the API is to
    generate a calendar and correct it, which needs a model. The row is what
    matters here, not how it got there.
    """
    from sqlalchemy import text

    from app.db import AdminSessionLocal

    # A key `hint_label` does not recognise falls through to being printed as
    # itself, which is exactly what is wanted: this is a marker, not a claim
    # anybody reads.
    key = "closing_staff_delta:%s" % label
    db = AdminSessionLocal()
    try:
        db.execute(
            text(
                # CAST(...) rather than `:value::jsonb`: to SQLAlchemy's
                # `text()` the two colons of the shorthand look like the start
                # of another bind parameter.
                "INSERT INTO learned_hint (org_id, key, value, evidence_days) "
                "VALUES (:org, :key, CAST(:value AS jsonb), 5)"
            ),
            {"org": org_id, "key": key, "value": '{"delta": 2}'},
        )
        db.commit()
    finally:
        db.close()
    return key


@pytest.fixture(scope="module")
def tenants(client) -> Tuple[Tenant, Tenant]:
    """Two organisations, built once for the whole module.

    Module-scoped because signing up hashes a password and furnishing an org is
    a dozen round trips, and nothing below leaves a mark: every cross-tenant
    write these tests attempt is a write that must be REFUSED, so the pair is
    in the same state at the end of the module as at the start.
    """
    if not DB_AVAILABLE:
        pytest.skip("no database")
    return _furnish(client, "A"), _furnish(client, "B")


@skip_no_db
class TestTheApiBorder:
    """Org A, holding a real id of org B's, asking the API for it.

    Every assertion is the same shape: the answer is 404 or 403, and B's data
    is not in the body. A 200 here would be the headline of the day.
    """

    def test_the_two_orgs_really_are_two(self, tenants):
        a, b = tenants
        # Without this the rest of the class could be passing for the dullest
        # reason there is -- both tokens pointing at the same organisation.
        assert a.org_id != b.org_id
        assert a.employee_id != b.employee_id

    def test_a_foreign_employee_is_neither_listed_nor_addressable(self, tenants):
        a, b = tenants
        listing = self.get(a, "/api/v1/employees")
        assert listing.status_code == 200
        names = {e["full_name"] for e in listing.json()}
        ids = {e["id"] for e in listing.json()}
        assert b.employee_id not in ids
        assert b.employee_name not in names

        assert self.get(a, "/api/v1/employees/%s" % b.employee_id).status_code == 404

    def test_a_foreign_employee_cannot_be_edited_or_removed(self, tenants):
        a, b = tenants
        assert (
            self.patch(
                a, "/api/v1/employees/%s" % b.employee_id, {"full_name": "Renamed by A"}
            ).status_code
            == 404
        )
        assert self.delete(a, "/api/v1/employees/%s" % b.employee_id).status_code == 404
        assert (
            self.post(a, "/api/v1/employees/%s/restore" % b.employee_id).status_code
            == 404
        )
        # And B's own view of B is untouched by all of that.
        mine = self.get(b, "/api/v1/employees/%s" % b.employee_id)
        assert mine.status_code == 200
        assert mine.json()["full_name"] == b.employee_name

    def test_a_foreign_employees_contracts_are_out_of_reach(self, tenants):
        a, b = tenants
        # Pay is in here: rate, salary, contracted hours.
        assert (
            self.get(a, "/api/v1/employees/%s/contracts" % b.employee_id).status_code
            == 404
        )
        assert (
            self.post(
                a,
                "/api/v1/employees/%s/contracts" % b.employee_id,
                {
                    "employment_type": "non_exempt_hourly",
                    "hourly_rate": 1.0,
                    "min_hours_per_week": 1.0,
                    "pay_period": "monthly",
                    "valid_from": "2026-01-01",
                },
            ).status_code
            == 404
        )
        assert (
            self.patch(
                a,
                "/api/v1/employees/%s/contracts/current/hours" % b.employee_id,
                {"hours_per_week": 1.0},
            ).status_code
            == 404
        )
        # B's own contract is exactly as B left it. The list holds more than
        # one row -- adding somebody to the roster opens a contract for them at
        # zero hours -- so this names the one that was written rather than
        # counting them.
        still = self.get(b, "/api/v1/employees/%s/contracts" % b.employee_id)
        assert still.status_code == 200
        mine = {c["id"]: c for c in still.json()}
        assert b.contract_id in mine
        assert mine[b.contract_id]["min_hours_per_week"] == 40.0
        assert mine[b.contract_id]["hourly_rate"] == 12.5

    def test_a_foreign_employees_holiday_balance_is_out_of_reach(self, tenants):
        a, b = tenants
        assert (
            self.get(
                a, "/api/v1/employees/%s/vacation-balance" % b.employee_id
            ).status_code
            == 404
        )

    def test_a_foreign_employees_login_is_out_of_reach(self, tenants):
        a, b = tenants
        # The sharpest of these, because the three endpoints behind it run on
        # the superuser session: RLS is NOT the safety net here, the explicit
        # org filter in routers/accounts.py is the whole of it.
        read = self.get(a, "/api/v1/employees/%s/account" % b.employee_id)
        assert read.status_code == 404
        assert b.staff_email not in read.text

        assert (
            self.post(
                a,
                "/api/v1/employees/%s/account" % b.employee_id,
                {"email": "hijack+%s@example.com" % uuid.uuid4().hex[:8],
                 "password": "hijacked-pass"},
            ).status_code
            == 404
        )
        assert (
            self.delete(a, "/api/v1/employees/%s/account" % b.employee_id).status_code
            == 404
        )
        # B's employee can still log in, which is the thing the DELETE above
        # would have taken away.
        assert self.get(b, "/api/v1/employees/%s/account" % b.employee_id).status_code == 200

    def test_absence_types_are_this_orgs_own_copies(self, tenants):
        a, b = tenants
        mine = self.get(a, "/api/v1/absence-types")
        assert mine.status_code == 200
        assert b.absence_type_id not in {t["id"] for t in mine.json()}
        # They are seeded per org and carry the same four codes, so a leak here
        # would look like a normal listing. The ids are what tells them apart.
        assert (
            self.put(
                a,
                "/api/v1/absence-types/%s" % b.absence_type_id,
                {"is_recoverable": True},
            ).status_code
            == 404
        )

    def test_time_off_does_not_cross_the_border(self, tenants):
        a, b = tenants
        listing = self.get(a, "/api/v1/absences")
        assert listing.status_code == 200
        assert b.absence_id not in {x["id"] for x in listing.json()}

        # Approving is a write with a side effect -- it posts to the holiday
        # ledger and clears shifts -- so doing it to a stranger is worse than
        # reading one.
        assert (
            self.post(a, "/api/v1/absences/%s/approve" % b.absence_id).status_code == 404
        )
        # Sick leave is health data; naming a foreign employee must not book it.
        assert (
            self.post(
                a,
                "/api/v1/absences",
                {
                    "employee_id": b.employee_id,
                    "absence_type_id": a.absence_type_id,
                    "start_at": "2027-02-10T08:00:00Z",
                    "end_at": "2027-02-11T08:00:00Z",
                    "note": "not mine to book",
                },
            ).status_code
            == 404
        )
        # And a foreign absence TYPE on one's own employee is refused too: the
        # type carries the recoverable flag, which changes how hours are
        # counted back.
        assert (
            self.post(
                a,
                "/api/v1/absences",
                {
                    "employee_id": a.employee_id,
                    "absence_type_id": b.absence_type_id,
                    "start_at": "2027-02-10T08:00:00Z",
                    "end_at": "2027-02-11T08:00:00Z",
                    "note": "borrowed type",
                },
            ).status_code
            == 404
        )

    def test_shift_templates_are_this_orgs_own(self, tenants):
        a, b = tenants
        mine = self.get(a, "/api/v1/shift-templates")
        assert mine.status_code == 200
        assert b.shift_template_id not in {t["id"] for t in mine.json()}
        assert ("House shift B" in mine.text) is False

    def test_a_shift_cannot_be_drafted_or_published_for_a_foreign_person(
        self, tenants
    ):
        a, b = tenants
        payload = {
            "period_start": SPARE_FROM,
            "period_end": SPARE_TO,
            "shifts": [
                {
                    "employee_id": b.employee_id,
                    "start_at": SPARE_SHIFT[0],
                    "end_at": SPARE_SHIFT[1],
                }
            ],
        }
        drafted = self.put(a, "/api/v1/schedule/draft", payload)
        assert drafted.status_code == 422
        assert drafted.json()["detail"]["code"] == "unknown_employee"

        published = self.post(a, "/api/v1/schedule/publish", payload)
        assert published.status_code == 422
        assert published.json()["detail"]["code"] == "unknown_employee"

    def test_a_shift_cannot_borrow_a_foreign_template(self, tenants):
        a, b = tenants
        # The shift is A's own employee in A's own window; only the template id
        # comes from B. Nothing of B's would come BACK in the response -- the
        # payload only ever echoes the id -- so what this refuses is the row
        # being written with a foreign key into another customer's table. See
        # the comment in services/schedule.py::validate_shifts for why that
        # matters even though nothing leaks.
        payload = {
            "period_start": SPARE_FROM,
            "period_end": SPARE_TO,
            "shifts": [
                {
                    "employee_id": a.employee_id,
                    "start_at": SPARE_SHIFT[0],
                    "end_at": SPARE_SHIFT[1],
                    "shift_template_id": b.shift_template_id,
                }
            ],
        }
        drafted = self.put(a, "/api/v1/schedule/draft", payload)
        assert drafted.status_code == 422
        assert drafted.json()["detail"]["code"] == "unknown_shift_template"

        published = self.post(a, "/api/v1/schedule/publish", payload)
        assert published.status_code == 422
        assert published.json()["detail"]["code"] == "unknown_shift_template"

        # Nothing was written by either attempt.
        left = self.get(
            a, "/api/v1/schedule/draft?from=%s&to=%s" % (SPARE_FROM, SPARE_TO)
        )
        assert left.status_code == 200
        assert left.json() == []

    def test_the_rota_stops_at_the_border(self, tenants):
        a, b = tenants
        # Both orgs published into the SAME window, so an unfiltered read here
        # returns two rows instead of one -- which is the failure this catches.
        published = self.get(
            a,
            "/api/v1/schedule/assignments?from=%s&to=%s"
            % (PUBLISHED_FROM, PUBLISHED_TO),
        )
        assert published.status_code == 200
        ids = {row["id"] for row in published.json()}
        assert b.published_shift_id not in ids
        assert ids == {a.published_shift_id}

        drafted = self.get(
            a, "/api/v1/schedule/draft?from=%s&to=%s" % (DRAFT_FROM, DRAFT_TO)
        )
        assert drafted.status_code == 200
        assert {row["id"] for row in drafted.json()} == {a.draft_shift_id}

        # The year grid reads marks, not rows, so it could leak the EXISTENCE
        # of another customer's month without ever naming a shift.
        marks = self.get(
            a, "/api/v1/schedule/marks?from=%s&to=%s" % (PUBLISHED_FROM, PUBLISHED_TO)
        )
        assert marks.status_code == 200
        assert len(marks.json()) == 1

    def test_a_foreign_generation_is_not_readable(self, tenants):
        a, b = tenants
        # The brief is in here: what the business does, how it staffs, what it
        # told the model. Both orgs have a queued job, so "latest" is a real
        # question with two possible wrong answers.
        direct = self.get(a, "/api/v1/schedule/generate/jobs/%s" % b.generation_job_id)
        assert direct.status_code == 404
        assert "Brief of B" not in direct.text

        # "The last calendar this account asked for" is a query with no id in
        # it at all, so a missing org filter would answer with whichever
        # customer happened to ask most recently.
        latest = self.get(a, "/api/v1/schedule/generate/jobs/latest")
        assert latest.status_code == 200
        assert latest.json()["job_id"] == a.generation_job_id

    def test_the_business_profile_is_this_orgs_own(self, tenants):
        a, b = tenants
        mine = self.get(a, "/api/v1/profile")
        assert mine.status_code == 200
        assert a.house_notes in mine.text
        assert b.house_notes not in mine.text
        # The beliefs hanging off the profile come with it, so they are part of
        # the same answer and part of the same border.
        assert {h["key"] for h in mine.json()["hints"]} == {a.hint_key}
        assert b.hint_key not in mine.text

        # Writing one's own does not reach into the other's.
        assert (
            self.put(a, "/api/v1/profile", {"house_notes": a.house_notes}).status_code
            == 200
        )
        theirs = self.get(b, "/api/v1/profile")
        assert theirs.status_code == 200
        assert theirs.json()["house_notes"] == b.house_notes

    def test_a_foreign_belief_can_be_neither_read_nor_overruled(self, tenants):
        a, b = tenants
        # Hints are addressed by KEY, not by id, and the key is the only thing
        # the endpoint is given -- so this is the one family where the org
        # filter is ALL there is between two customers at the application
        # level, with no "not found" to fall back on.
        #
        # Each org owns a key the other does not have. Asking for B's key with
        # A's token must be a 404 BECAUSE OF THE BORDER: without the filter in
        # routers/business_profile.py the same query finds B's row, rejects
        # B's belief, and answers 200 with B's profile attached.
        overruled = self.put(
            a, "/api/v1/profile/hints/%s" % b.hint_key, {"rejected": True}
        )
        assert overruled.status_code == 404
        assert overruled.json()["detail"]["code"] == "hint_not_found"

        # The control that makes the 404 above mean something: the very same
        # request, from the org that owns the key, works. So "not found" is the
        # border talking and not a key nobody has.
        mine = self.put(a, "/api/v1/profile/hints/%s" % a.hint_key, {"rejected": True})
        assert mine.status_code == 200, mine.text
        assert {h["key"] for h in mine.json()["hints"]} == {a.hint_key}

        # B's belief is exactly as B left it -- not rejected.
        theirs = self.get(b, "/api/v1/profile")
        assert theirs.status_code == 200
        beliefs = {h["key"]: h for h in theirs.json()["hints"]}
        assert set(beliefs) == {b.hint_key}
        assert beliefs[b.hint_key]["rejected"] is False

        # And put A's own belief back, so the pair is as it was found.
        assert (
            self.put(
                a, "/api/v1/profile/hints/%s" % a.hint_key, {"rejected": False}
            ).status_code
            == 200
        )

    def test_the_pay_policy_is_this_orgs_own(self, tenants):
        a, b = tenants
        # No id is addressable here -- the org comes from the token -- so what
        # this pins is that the token, and not some shared row, is what decides.
        # These are the rates a business pays its staff; writing one's own must
        # not move the neighbour's.
        before = self.get(b, "/api/v1/org/pay-policy")
        assert before.status_code == 200

        written = self.put(
            a,
            "/api/v1/org/pay-policy",
            {
                "night_differential_pct": 11.0,
                "weekend_premium_pct": 22.0,
                "overtime_multiplier": 1.75,
            },
        )
        assert written.status_code == 200, written.text
        assert float(written.json()["night_differential_pct"]) == 11.0

        after = self.get(b, "/api/v1/org/pay-policy")
        assert after.status_code == 200
        assert after.json() == before.json()

    def test_the_working_year_counts_only_this_orgs_people(self, tenants):
        a, b = tenants
        # Both orgs have exactly one person with one published shift in the
        # same month. A leak here shows up as a second name on the payroll
        # screen, which is also how it would first be noticed in production.
        year = self.get(
            a, "/api/v1/workday?from=%s&to=%s" % (PUBLISHED_FROM, PUBLISHED_TO)
        )
        assert year.status_code == 200
        assert {e["employee_id"] for e in year.json()["employees"]} == {a.employee_id}

        balances = self.get(
            a, "/api/v1/workday/balances?from=%s&to=%s" % (PUBLISHED_FROM, PUBLISHED_TO)
        )
        assert balances.status_code == 200
        assert b.employee_name not in balances.text

    def test_the_signed_in_user_only_ever_answers_for_themselves(self, tenants):
        a, b = tenants
        # /me takes no id at all, which is the point: there is no request shape
        # that names somebody else. What is checked is that the answer follows
        # the token.
        for tenant in (a, b):
            me = self.get(tenant, "/api/v1/auth/me")
            assert me.status_code == 200
            assert me.json()["org_id"] == tenant.org_id
            assert me.json()["org_name"] == tenant.org_name

    def test_a_token_of_one_org_is_not_a_token_of_the_other(self, tenants):
        a, b = tenants
        # The employee logins were created inside each org. Signing in as B's
        # employee must produce a session of B, never of A -- the org travels
        # with the account, not with the request.
        token = self._staff_token(b)
        me = self._client.get("/api/v1/auth/me", headers=_auth(token))
        assert me.status_code == 200
        assert me.json()["org_id"] == b.org_id
        assert me.json()["employee_id"] == b.employee_id

        roster = self._client.get("/api/v1/employees", headers=_auth(token))
        # An employee is not a manager, so the roster is refused outright --
        # and if it were ever opened, it would be B's roster.
        assert roster.status_code in (403, 200)
        if roster.status_code == 200:
            assert a.employee_id not in {e["id"] for e in roster.json()}

    def test_the_employees_own_screens_answer_for_their_own_employer(self, tenants):
        a, b = tenants
        # The /me family takes no id at all -- everything is derived from the
        # token -- so there is no cross-tenant REQUEST to make here. What is
        # checked instead is that the derivation lands in the right org, which
        # is the same property said from the other end.
        head = _auth(self._staff_token(b))

        profile = self._client.get("/api/v1/me/profile", headers=head)
        assert profile.status_code == 200, profile.text
        assert profile.json()["id"] == b.employee_id
        assert profile.json()["full_name"] == b.employee_name
        assert a.employee_name not in profile.text

        # The two settings an employee is allowed to read about their employer.
        # Asserted by VALUE, not by status: the two orgs were furnished with
        # different ones precisely so that "B's answer" and "somebody else's
        # answer" are distinguishable here. A 200 on its own would stay green
        # while this screen told B's staff when A's day ends.
        shape = self._client.get("/api/v1/me/business", headers=head)
        assert shape.status_code == 200, shape.text
        assert shape.json()["day_boundary_min"] == b.day_boundary_min
        assert shape.json()["weekend_days"] == b.weekend_days
        assert shape.json()["day_boundary_min"] != a.day_boundary_min

        # The rota-email switch is per person. Flipped and read back, then put
        # back, so what is checked is this employee's own row and not a default
        # that would read the same whoever answered.
        notifications = self._client.get("/api/v1/me/notifications", headers=head)
        assert notifications.status_code == 200, notifications.text
        was = notifications.json()["notify_by_email"]

        flipped = self._client.patch(
            "/api/v1/me/notifications", headers=head, json={"notify_by_email": not was}
        )
        assert flipped.status_code == 200, flipped.text
        assert flipped.json()["notify_by_email"] is (not was)
        assert (
            self._client.get("/api/v1/me/notifications", headers=head).json()[
                "notify_by_email"
            ]
            is (not was)
        )

        # A's employee did not move. Same endpoint, same absence of an id in
        # the request, different person -- which is the whole property.
        other = _auth(self._staff_token(a))
        assert (
            self._client.get("/api/v1/me/notifications", headers=other).json()[
                "notify_by_email"
            ]
            is was
        )
        assert (
            self._client.get("/api/v1/me/profile", headers=other).json()["id"]
            == a.employee_id
        )

        restored = self._client.patch(
            "/api/v1/me/notifications", headers=head, json={"notify_by_email": was}
        )
        assert restored.status_code == 200

    def test_a_teammate_list_never_reaches_over_the_border(self, tenants):
        a, b = tenants
        # /schedule/day-team is the ONE place an employee is shown somebody
        # other than themselves, which makes it the one employee-facing read
        # where a missing org filter would put a stranger's name on a screen.
        # Both orgs published a shift in the same window and at the same hour,
        # so "who am I on with" is a question with a wrong answer available.
        head = _auth(self._staff_token(b))
        team = self._client.get(
            "/api/v1/schedule/day-team?from=%s&to=%s" % PUBLISHED_DAY,
            headers=head,
        )
        assert team.status_code == 200, team.text
        assert {row["employee_id"] for row in team.json()} <= {b.employee_id}
        assert a.employee_name not in team.text

    def test_a_foreign_menu_is_neither_read_nor_changed(self, tenants):
        a, b = tenants
        # Read by the manager AND by the employee: `GET /menu` is the one
        # route of the menu an employee can call, so it is the one where a
        # missing org filter would reach the most phones.
        for token in (a.token, self._staff_token(a)):
            menu = self._client.get("/api/v1/menu", headers=_auth(token))
            assert menu.status_code == 200, menu.text
            assert b.menu_dish_name not in menu.text
            assert b.menu_section_id not in menu.text
            assert b.menu_photo_url not in menu.text
            assert a.menu_dish_name in menu.text
            assert a.menu_photo_url in menu.text

        assert (
            self.patch(
                a, "/api/v1/menu/sections/%s" % b.menu_section_id, {"name": "Mine"}
            ).status_code
            == 404
        )
        assert (
            self.patch(
                a, "/api/v1/menu/dishes/%s" % b.menu_dish_id, {"name": "Mine"}
            ).status_code
            == 404
        )
        # Moving one's own dish into the neighbour's section.
        assert (
            self.patch(
                a,
                "/api/v1/menu/dishes/%s" % a.menu_dish_id,
                {"section_id": b.menu_section_id},
            ).status_code
            == 404
        )
        assert (
            self.post(
                a,
                "/api/v1/menu/dishes",
                {"section_id": b.menu_section_id, "name": "Planted by A"},
            ).status_code
            == 404
        )
        assert (
            self.put(
                a,
                "/api/v1/menu/sections/%s/dishes/order" % b.menu_section_id,
                {"ids": [b.menu_dish_id]},
            ).status_code
            == 404
        )
        assert (
            self.put(
                a, "/api/v1/menu/sections/order", {"ids": [b.menu_section_id]}
            ).status_code
            == 422
        )
        # A photo on the neighbour's dish, or theirs taken off.
        planted = self._client.put(
            "/api/v1/menu/dishes/%s/photo" % b.menu_dish_id,
            headers={**_auth(a.token), "Content-Type": "image/png"},
            content=PNG,
        )
        assert planted.status_code == 404
        assert (
            self.delete(a, "/api/v1/menu/dishes/%s/photo" % b.menu_dish_id).status_code
            == 404
        )
        assert self.delete(a, "/api/v1/menu/dishes/%s" % b.menu_dish_id).status_code == 404
        assert (
            self.delete(a, "/api/v1/menu/sections/%s" % b.menu_section_id).status_code
            == 404
        )

        # And B's menu is as B left it.
        theirs = self.get(b, "/api/v1/menu").json()
        assert [s["id"] for s in theirs["sections"]] == [b.menu_section_id]
        assert [d["name"] for d in theirs["sections"][0]["dishes"]] == [
            b.menu_dish_name
        ]
        assert theirs["sections"][0]["dishes"][0]["photo_url"] == b.menu_photo_url
        assert self._client.get(b.menu_photo_url).content == JPEG
        mine = self.get(a, "/api/v1/menu").json()
        assert mine["sections"][0]["dishes"][0]["section_id"] == a.menu_section_id

    def test_a_foreign_sale_is_neither_read_nor_voided_nor_counted(self, tenants):
        a, b = tenants
        mine = self.get(a, "/api/v1/store/sales")
        assert mine.status_code == 200, mine.text
        assert [s["id"] for s in mine.json()] == [a.store_sale_id]
        assert self.get(a, "/api/v1/store/sales/%s" % b.store_sale_id).status_code == 404
        voided = self.post(
            a, "/api/v1/store/sales/%s/void" % b.store_sale_id, {"reason": "Planted by A"}
        )
        assert voided.status_code == 404, voided.text

        stats = self.get(
            a, "/api/v1/store/stats?from=%s&to=%s" % (STORE_DAY, STORE_DAY)
        ).json()
        assert stats["total"] == 19 + SALE_TAKINGS["A"]
        assert b.menu_dish_name not in str(stats["top_dishes"])
        assert b.menu_dish_id not in str(stats["top_dishes"])

        # A line may not name the neighbour's dish, even by its real id.
        planted = self.post(
            a,
            "/api/v1/store/sales",
            {
                "sold_on": STORE_DAY,
                "client_ref": str(uuid.uuid4()),
                "lines": [
                    {
                        "dish_id": b.menu_dish_id,
                        "name": "Planted by A",
                        "unit_price": 1,
                        "quantity": 1,
                    }
                ],
            },
        )
        assert planted.status_code == 422, planted.text

        # And B's sale is as B left it, not voided.
        theirs = self.get(b, "/api/v1/store/sales/%s" % b.store_sale_id)
        assert theirs.status_code == 200
        assert theirs.json()["total"] == 19 + SALE_TAKINGS["B"]
        assert theirs.json()["voided_at"] is None
        assert theirs.json()["void_reason"] is None

    def _staff_token(self, tenant: Tenant) -> str:
        signed_in = self.raw_post(
            "/api/v1/auth/login",
            {"email": tenant.staff_email, "password": "another-s3cret"},
        )
        assert signed_in.status_code == 200, signed_in.text
        return signed_in.json()["access_token"]

    # --- plumbing ------------------------------------------------------------
    # Four one-liners rather than four verbs spelt out at every call site: this
    # class makes about sixty requests and the assertion is the interesting
    # half of each line.

    _client = None

    @pytest.fixture(autouse=True)
    def _bind(self, client):
        type(self)._client = client

    def get(self, tenant: Tenant, path: str):
        return self._client.get(path, headers=_auth(tenant.token))

    def post(self, tenant: Tenant, path: str, body: Optional[dict] = None):
        return self._client.post(path, headers=_auth(tenant.token), json=body or {})

    def put(self, tenant: Tenant, path: str, body: dict):
        return self._client.put(path, headers=_auth(tenant.token), json=body)

    def patch(self, tenant: Tenant, path: str, body: dict):
        return self._client.patch(path, headers=_auth(tenant.token), json=body)

    def delete(self, tenant: Tenant, path: str):
        return self._client.delete(path, headers=_auth(tenant.token))

    def raw_post(self, path: str, body: dict):
        return self._client.post(path, json=body)


# --- The database barrier -----------------------------------------------------


def _tenant_tables() -> List[Tuple[str, str]]:
    """Every table holding one customer's data, read out of the schema itself.

    READ rather than listed, on purpose. A hand-written list is a list somebody
    forgets to add to, and the table that gets forgotten is by definition the
    one nobody was thinking about. Anything in ``public`` with an ``org_id``
    column is customer data and must be fenced; ``organization`` is the same
    thing keyed on ``id``.
    """
    from sqlalchemy import text

    from app.db import admin_engine

    with admin_engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.relname,
                       CASE WHEN c.relname = 'organization' THEN 'id'
                            ELSE 'org_id' END AS key
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relkind = 'r'
                  AND (c.relname = 'organization'
                       OR EXISTS (SELECT 1 FROM information_schema.columns col
                                  WHERE col.table_schema = 'public'
                                    AND col.table_name = c.relname
                                    AND col.column_name = 'org_id'))
                ORDER BY 1
                """
            )
        ).all()
    return [(r[0], r[1]) for r in rows]


# The tables both organisations are guaranteed to have rows in after
# ``_furnish``. Used wherever a test needs "zero" to be a meaningful answer:
# zero rows out of zero rows proves nothing at all.
FURNISHED_TABLES = (
    "organization",
    "user_account",
    "employee",
    "contract",
    "shift_template",
    "absence_type",
    "absence",
    "assignment",
    "business_profile",
    "generation_job",
    "menu_section",
    "menu_dish",
    "menu_dish_photo",
    "store_sale",
    "store_sale_line",
)


def _as_app_user(org_id: Optional[str], sql: str, params: Optional[dict] = None):
    """Run one statement on the RUNTIME role, with or without an org context.

    ``org_id=None`` is the interesting case: it is a connection that never
    called ``set_current_org``, which is what a code path that forgot to would
    look like from down here.
    """
    from sqlalchemy import text

    from app.db import app_engine

    with app_engine.connect() as conn:
        with conn.begin():
            # Same call the app makes (db.py::set_current_org): transaction
            # local, so it cannot outlive this block and contaminate the pool.
            if org_id is not None:
                conn.execute(
                    text("SELECT set_config('app.current_org_id', :org, true)"),
                    {"org": str(org_id)},
                )
            return conn.execute(text(sql), params or {})


def _as_fresh_app_user(sql: str, params: Optional[dict] = None):
    """Run one statement on a BRAND NEW runtime connection, no org context.

    A connection of its own, from a pool that keeps none, because the two
    spellings of "no context" behave differently and only one of them is
    reachable through ``app_engine``:

      * a connection that has never had ``app.current_org_id`` set reports it
        as NULL, so ``org_id = NULL::uuid`` is NULL, no row qualifies, and the
        query returns EMPTY;
      * a connection that has had it set inside an earlier transaction gets it
        back as the empty string when that transaction ends -- Postgres' reset
        value for a custom GUC that did not exist at session start -- and
        ``''::uuid`` REFUSES TO CAST, so the query errors out.

    Both are closed. Neither returns another customer's rows. This helper
    exists so the first one can be tested on its own, since it is the one that
    a policy rewritten to be "helpful" about a missing context would break.
    """
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    from app.config import settings

    engine = create_engine(
        settings.app_database_url, poolclass=NullPool, future=True
    )
    try:
        with engine.connect() as conn:
            return conn.execute(text(sql), params or {}).scalar()
    finally:
        engine.dispose()


def _count_as_app_user(org_id: Optional[str], table: str, where: str = "TRUE",
                       params: Optional[dict] = None) -> int:
    return _as_app_user(
        org_id, "SELECT count(*) FROM %s WHERE %s" % (table, where), params
    ).scalar()


def _count_as_admin(table: str, where: str = "TRUE",
                    params: Optional[dict] = None) -> int:
    from sqlalchemy import text

    from app.db import admin_engine

    with admin_engine.connect() as conn:
        return conn.execute(
            text("SELECT count(*) FROM %s WHERE %s" % (table, where)), params or {}
        ).scalar()


@skip_no_db
class TestTheDatabaseBorder:
    """The second barrier, with the application taken out of the picture.

    These talk to Postgres as ``app_user`` directly. If every ``org_id ==``
    in the codebase were deleted tomorrow, these are the tests that would still
    be true -- and the reason the first barrier is allowed to be the only thing
    a reviewer reads.
    """

    def test_these_tests_are_not_quietly_running_as_a_superuser(self, tenants):
        # Without this the whole class could be green for the worst possible
        # reason: APP_DATABASE_URL pointed at the postgres superuser, which
        # bypasses RLS entirely and would make every count below come back
        # showing everything -- except that the counts are of B's rows under
        # A's context, so they would come back showing MORE, not less. Said out
        # loud anyway, because an environment variable is easy to get wrong.
        who = _as_app_user(None, "SELECT current_user").scalar()
        assert who == "app_user", "expected the restricted runtime role, got %r" % who

        role = _as_app_user(
            None,
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
        ).one()
        # NOSUPERUSER is what makes FORCE ROW LEVEL SECURITY apply at all, and
        # NOBYPASSRLS is what stops the role from turning it off for itself.
        assert role[0] is False
        assert role[1] is False

    def test_every_table_of_customer_data_is_fenced(self, tenants):
        from sqlalchemy import text

        from app.db import admin_engine

        tables = _tenant_tables()
        # A sanity floor: if the query above returned nothing, the loop below
        # would pass by doing nothing at all.
        assert len(tables) >= 9, tables

        with admin_engine.connect() as conn:
            for table, key in tables:
                state = conn.execute(
                    text(
                        "SELECT relrowsecurity, relforcerowsecurity FROM pg_class c "
                        "JOIN pg_namespace n ON n.oid = c.relnamespace "
                        "WHERE n.nspname = 'public' AND c.relname = :t"
                    ),
                    {"t": table},
                ).one()
                assert state[0] is True, "%s has no row-level security" % table
                # FORCE matters because the migrations run as the table owner:
                # without it a policy is silently skipped for that role, and
                # "the policy exists" would stop meaning "the policy applies".
                assert state[1] is True, "%s does not FORCE row-level security" % table

                policies = conn.execute(
                    text(
                        "SELECT qual, with_check FROM pg_policies "
                        "WHERE schemaname = 'public' AND tablename = :t"
                    ),
                    {"t": table},
                ).all()
                assert policies, "%s has no policy" % table
                for qual, with_check in policies:
                    # Both halves: USING decides what can be READ, WITH CHECK
                    # what can be WRITTEN. A policy with only the first would
                    # let one customer insert a row into another's account.
                    assert "app.current_org_id" in (qual or ""), table
                    assert "app.current_org_id" in (with_check or ""), table
                    # And the column on the LEFT of the comparison is the
                    # tenant key. Spelt as a match on "<key> =" rather than as
                    # "key in qual", because the setting is called
                    # app.current_org_id: both 'org_id' AND 'id' are substrings
                    # of a name the line above already guarantees is present,
                    # so a plain containment check passes no matter which
                    # column the policy actually compares. A policy reading
                    # `employee_id = current_setting('app.current_org_id')`
                    # -- nonsense that would match nothing, or worse, one that
                    # compared some other org-shaped column -- would sail
                    # through it. This is the assertion that has to look at the
                    # left-hand side.
                    assert re.search(r"\b%s\s*=" % re.escape(key), qual or ""), (
                        "%s: policy does not compare %s (qual: %s)"
                        % (table, key, qual)
                    )
                    assert re.search(
                        r"\b%s\s*=" % re.escape(key), with_check or ""
                    ), "%s: WITH CHECK does not compare %s" % (table, key)

    def test_without_an_org_context_the_runtime_role_sees_nothing(self, tenants):
        """The one that would still catch a policy rewritten to fail OPEN.

        ``current_setting('app.current_org_id', true)`` is NULL on a connection
        that never set it, ``org_id = NULL`` is NULL, which is not true, so no
        row qualifies and the answer is EMPTY. Spelt as a test of its own
        because the tempting "helpful" version of that policy -- treat a
        missing context as no restriction -- passes every other check in this
        file and hands the entire table to any code path that forgets to set
        the org. That is the difference between a barrier that fails closed and
        one that fails open, and nothing else in the suite can tell them apart.
        """
        for table, _key in _tenant_tables():
            seen = _as_fresh_app_user("SELECT count(*) FROM %s" % table)
            assert seen == 0, "%s is readable with no org context" % table

        # And the zeros above are real zeros: the rows are there in their
        # thousands, the restricted role simply cannot see one of them.
        for table in FURNISHED_TABLES:
            assert _count_as_admin(table) > 0, table

    def test_a_reused_connection_with_no_org_context_refuses_outright(
        self, tenants
    ):
        """The other half of "no context", and the one the runtime would hit.

        The pool hands connections back out. A connection that carried an org
        earlier does NOT come back with the setting undefined: Postgres resets a
        custom GUC to the empty string, and ``''::uuid`` will not cast. So the
        query raises instead of returning nothing.

        That is a 500, not a leak, and the distinction is the whole point of
        pinning it: the two spellings of "nobody set the org" give two
        different answers, and BOTH of them are refusals. A future migration
        that "fixed" the noisy one by making the policy tolerate an empty
        context would turn this into the quiet failure that hands over the
        table.
        """
        from sqlalchemy import text
        from sqlalchemy.exc import DataError

        from app.db import app_engine

        a, _b = tenants
        with app_engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text("SELECT set_config('app.current_org_id', :org, true)"),
                    {"org": a.org_id},
                )
                assert conn.execute(text("SELECT count(*) FROM employee")).scalar() > 0
            # Transaction over, setting reset to '' rather than to undefined.
            assert (
                conn.execute(
                    text("SELECT current_setting('app.current_org_id', true)")
                ).scalar()
                == ""
            )
            with pytest.raises(DataError) as refused:
                conn.execute(text("SELECT count(*) FROM employee"))
            assert "uuid" in str(refused.value).lower()

    def test_with_org_a_in_context_not_one_row_of_b_is_visible(self, tenants):
        a, b = tenants
        for table, key in _tenant_tables():
            where = "%s = :org" % key
            mine = _count_as_app_user(a.org_id, table, where, {"org": a.org_id})
            theirs = _count_as_app_user(a.org_id, table, where, {"org": b.org_id})
            assert theirs == 0, "%s leaks rows of another org" % table
            # The same query under B's own context finds them, so the zero
            # above is the policy talking and not an empty table.
            assert (
                _count_as_app_user(b.org_id, table, where, {"org": b.org_id})
                == _count_as_admin(table, where, {"org": b.org_id})
            ), table
            if table in FURNISHED_TABLES:
                assert mine > 0, table

    def test_the_runtime_role_cannot_write_into_another_org(self, tenants):
        from sqlalchemy.exc import ProgrammingError

        a, b = tenants

        # WITH CHECK: an INSERT carrying somebody else's org_id is refused by
        # the database, not merely filtered out of later reads.
        with pytest.raises(ProgrammingError) as insert_refused:
            _as_app_user(
                a.org_id,
                "INSERT INTO employee (org_id, full_name, employment_status, "
                "hire_date) VALUES (:org, 'Planted by A', 'active', DATE '2025-01-01')",
                {"org": b.org_id},
            )
        assert "row-level security" in str(insert_refused.value).lower()

        # UPDATE and DELETE do not raise: the rows simply are not there to be
        # found, which is the same answer said more quietly. rowcount is the
        # only way to hear it.
        updated = _as_app_user(
            a.org_id,
            "UPDATE employee SET full_name = 'Renamed by A' WHERE id = :emp",
            {"emp": b.employee_id},
        )
        assert updated.rowcount == 0

        deleted = _as_app_user(
            a.org_id, "DELETE FROM assignment WHERE org_id = :org", {"org": b.org_id}
        )
        assert deleted.rowcount == 0

        # Nothing moved.
        assert (
            _count_as_admin("employee", "id = :e AND full_name = :n",
                            {"e": b.employee_id, "n": b.employee_name})
            == 1
        )
        assert _count_as_admin("assignment", "org_id = :o", {"o": b.org_id}) > 0

    def test_the_runtime_role_cannot_hand_its_own_row_to_another_org(self, tenants):
        from sqlalchemy.exc import ProgrammingError

        a, b = tenants
        # The other direction of the same write, and the loudest of the three.
        # A owns this row, so USING finds it and the UPDATE has something to
        # act on; WITH CHECK is then evaluated against the row as it WOULD BE,
        # which belongs to B, and refuses. A tenant cannot push its own data
        # over the border any more than it can pull somebody else's back.
        with pytest.raises(ProgrammingError) as refused:
            _as_app_user(
                a.org_id,
                "UPDATE employee SET org_id = :other WHERE id = :emp",
                {"other": b.org_id, "emp": a.employee_id},
            )
        assert "row-level security" in str(refused.value).lower()
        assert (
            _count_as_admin("employee", "id = :e AND org_id = :o",
                            {"e": a.employee_id, "o": a.org_id})
            == 1
        )

    def test_the_doorbell_table_is_out_of_the_runtime_roles_reach(self, tenants):
        from sqlalchemy.exc import ProgrammingError

        # `login_attempt` has no org_id and therefore no policy: it is the
        # pre-tenant rate limiter, written and read only on the superuser
        # session. What keeps the runtime role out is having no privilege at
        # all, which migration 0023 states with an explicit REVOKE rather than
        # leaving to the absence of a GRANT. This is that REVOKE, checked --
        # a table the tenant API cannot reach is a table a bug in it cannot
        # turn into a list of which addresses have accounts.
        #
        # NOTE for whoever reads this next: `platform_admin` is NOT yet in this
        # state in a database initialised by infra/initdb/01-app-role.sql --
        # its ALTER DEFAULT PRIVILEGES hands app_user every table Alembic
        # creates, and 0003 relied on writing no GRANT. That is a real gap,
        # already written down in 0023's docstring, and it is somebody's own
        # change rather than an assertion to make here.
        with pytest.raises(ProgrammingError) as refused:
            _as_app_user(None, "SELECT count(*) FROM login_attempt")
        assert "permission denied" in str(refused.value).lower()


# --- Things that were already true, kept ---------------------------------------


@skip_no_db
def test_per_org_seeding_present(client):
    token = _signup(client, "Seed Co")
    at = client.get("/api/v1/absence-types", headers=_auth(token))
    assert at.status_code == 200
    codes = {a["code"] for a in at.json()}
    assert {"VAC", "PERS", "SICK", "UNPAID"}.issubset(codes)

    st = client.get("/api/v1/shift-templates", headers=_auth(token))
    assert st.status_code == 200
    names = {t["name"] for t in st.json()}
    assert {"Morning", "Evening", "Night"}.issubset(names)
    # The seed key is what the client translates; the name it ships with is only
    # the fallback. If a seeded template ever went out without one, the calendar
    # would silently go back to showing "Evening" in a Spanish interface.
    seed_keys = {t["seed_key"] for t in st.json()}
    assert {"morning", "evening", "night"}.issubset(seed_keys)


@skip_no_db
def test_me_requires_auth(client):
    unauth = client.get("/api/v1/auth/me")
    assert unauth.status_code in (401, 403)
