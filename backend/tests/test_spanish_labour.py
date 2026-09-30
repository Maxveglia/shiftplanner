"""Spain, as rules rather than as constants.

The product was seeded with three American jurisdictions and its intake was
written to the FLSA: eleven hours of rest, forty hours a week, time and a half
past them. A bar in Barcelona breaks none of those and breaks Spanish law
three times over, so what these tests pin is not "Spain exists" but that the
figures a rota is built to now come from the rules table -- and that a
jurisdiction with nothing seeded still behaves exactly as it always did.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from tests.test_business_profile import (  # noqa: F401 - fixtures by name
    _auth,
    _signup,
    client,
    skip_no_db,
)
from app.seeds.labor import (
    _es_ct_comercio_rules,
    _es_ct_hosteleria_rules,
    _es_rules,
)
from app.services.intake import ScheduleBrief, brief_to_spec
from app.services.labour_floor import LabourFloor


def _by_type(rules):
    return {r.rule_type: r for r in rules}


def test_spain_states_the_three_rules_an_american_rota_has_never_heard_of():
    rules = _by_type(_es_rules())
    assert rules["daily_rest_between_shifts"].threshold == Decimal("12")
    assert rules["weekly_rest_hours"].threshold == Decimal("36")
    assert rules["night_work_daily_average_max"].threshold == Decimal("8")
    # And the one that is not a number: no statutory overtime premium.
    assert "no_statutory_overtime_premium" in rules
    assert rules["annual_overtime_cap"].threshold == Decimal("80")


def test_the_in_shift_break_is_deliberately_not_seeded():
    """Art. 34.4 is real and is kept off the calendar on purpose.

    The owner's call, and worth a test rather than a comment: staff take those
    fifteen minutes as the shift runs, and putting them in the rota would cut
    every shift in two for a rest nobody schedules.
    """
    assert "meal_break_after" not in _by_type(_es_rules())


def test_the_agreement_improves_on_the_statute_and_never_worsens_it():
    statute = _by_type(_es_rules())
    agreement = _by_type(_es_ct_hosteleria_rules())
    assert agreement["annual_leave_days"].threshold > statute["annual_leave_days"].threshold
    assert agreement["night_premium"].threshold == Decimal("25")
    assert agreement["annual_ordinary_hours"].threshold == Decimal("1783")


def test_a_spanish_spec_carries_the_spanish_figures():
    spec = brief_to_spec(
        ScheduleBrief(),
        LabourFloor(
            min_rest_hours=12,
            max_daily_hours=9,
            weekly_rest_hours=36,
            night_average_max=8,
            night_window=(22.0, 6.0),
            annual_overtime_cap=80,
        ),
    )
    assert spec["minRestHours"] == 12
    assert spec["maxDailyHours"] == 9
    assert spec["weeklyRestHours"] == 36
    assert spec["nightAverageMax"] == 8
    assert spec["nightWindow"] == {"startHour": 22.0, "endHour": 6.0}
    assert spec["overtimeMultiplier"] is None
    labels = " ".join(r["label"] for r in spec["rules"])
    assert "12 h minimum rest" in labels
    assert "FLSA" not in labels


def test_a_jurisdiction_with_nothing_seeded_is_exactly_as_it_was():
    """The regression that matters: every existing customer is American."""
    spec = brief_to_spec(ScheduleBrief())
    assert spec["minRestHours"] == 11
    assert spec["maxDailyHours"] is None
    assert spec["weeklyRestHours"] is None
    assert spec["nightAverageMax"] is None
    assert any("FLSA" in r["label"] for r in spec["rules"])


def test_the_brief_still_outranks_the_law_and_is_told_so_by_the_validator():
    """A manager who asks for ten hours of rest gets ten.

    Not twelve silently: the product's job is to show them the rule, not to
    rewrite what they asked for behind their back. The validator is what says
    the figure breaks the statute.
    """
    spec = brief_to_spec(
        ScheduleBrief(min_rest_hours=10), LabourFloor(min_rest_hours=12)
    )
    assert spec["minRestHours"] == 10


@pytest.mark.parametrize(
    "rules,expected",
    [(_es_rules(), None), ([], None)],
    ids=["spain-has-no-statutory-premium", "unseeded-jurisdiction"],
)
def test_nobody_invents_an_overtime_premium(rules, expected):
    floor = LabourFloor()
    assert floor.overtime_multiplier is expected


def test_nothing_american_is_offered_any_more():
    """The product serves one city, and the seed says so.

    Three American jurisdictions were seeded before this product had a
    customer. Offering a manager in Barcelona a choice between California and
    Arizona is not neutrality -- it is three wrong answers and no right one.
    """
    import inspect

    from app.seeds import labor

    source = inspect.getsource(labor)
    # The CODES, not the word: the Spanish rules explain themselves by
    # contrast ("there is no 1.5x by law -- that is the FLSA"), and that
    # sentence is the most useful one in the file.
    for gone in ('jurisdiction_code="US', "_us_fed_rules", "_us_ca_rules", "_us_az_rules"):
        assert gone not in source, "%s is still seeded" % gone
    assert [n for n in dir(labor) if n.startswith("_us_")] == []


def test_retail_states_what_it_does_not_know():
    """A shop's numbers come from its branch agreement, and we do not hold them.

    The temptation is to borrow the metal-goods agreement's 1,768 hours and
    call it retail. That would look like knowledge and quietly decide overtime
    for a bookshop, so the fields are seeded EMPTY with a note saying where
    the real figure lives.
    """
    rules = {r.rule_type: r for r in _es_ct_comercio_rules()}
    for rule_type in ("annual_ordinary_hours", "minimum_wage", "night_premium"):
        assert rules[rule_type].threshold is None
        assert rules[rule_type].notes


@skip_no_db
def test_a_spanish_business_can_change_its_night_premium(client):
    """The one-character bug that froze a whole market's pay settings.

    Signup writes an overtime multiplier of 1 -- correct here, since art. 35.1
    ET only says an extra hour is never worth LESS than an ordinary one -- and
    `PayPolicyUpdate` demanded 1.5, which is the FLSA's. The client sends the
    three premiums together, so EVERY save was refused: nobody in Spain could
    move their nocturnidad, and the screen went on showing the number they had
    typed.
    """
    token = _signup(client)

    resp = client.put(
        "/api/v1/org/pay-policy",
        headers=_auth(token),
        json={
            "night_differential_pct": 30,
            "weekend_premium_pct": 10,
            # Unchanged, and the reason the whole save used to bounce.
            "overtime_multiplier": 1,
        },
    )

    assert resp.status_code == 200, resp.text
    assert float(resp.json()["night_differential_pct"]) == 30.0
    # And it is stored, not just echoed.
    again = client.get("/api/v1/org/pay-policy", headers=_auth(token)).json()
    assert float(again["night_differential_pct"]) == 30.0
    assert float(again["overtime_multiplier"]) == 1.0


@skip_no_db
def test_an_extra_hour_may_never_be_worth_less_than_an_ordinary_one(client):
    """Art. 35.1 ET. The floor moved from 1.5 to 1; it did not disappear."""
    token = _signup(client)

    resp = client.put(
        "/api/v1/org/pay-policy",
        headers=_auth(token),
        json={
            "night_differential_pct": 25,
            "weekend_premium_pct": 0,
            "overtime_multiplier": 0.8,
        },
    )

    assert resp.status_code == 422, resp.text


@skip_no_db
def test_a_new_business_starts_under_the_law_of_the_city_it_is_in(client):
    """Signup used to file every business under the FLSA."""
    token = _signup(client)
    me = client.get("/api/v1/auth/me", headers=_auth(token)).json()
    assert me["org_jurisdiction"] == "ES-CT-HOSTELERIA"

    policy = client.get("/api/v1/org/pay-policy", headers=_auth(token)).json()
    # The premiums that come with the country, not the ones that came with the
    # country this product was written in.
    assert float(policy["night_differential_pct"]) == 25.0
    assert float(policy["weekend_premium_pct"]) == 0.0
    assert float(policy["overtime_multiplier"]) == 1.0
