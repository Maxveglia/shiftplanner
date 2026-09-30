from __future__ import annotations

"""WHICH period the calendar covers, and the one field it has to fit in.

"El horario debe cubrir solamente el mes de octubre" came back under the
heading NOTED, BUT NOT YET ENFORCEABLE: the intake had understood the sentence
perfectly, had nowhere to put it, printed it back as prose, and built a
calendar for a different period. `horizon_months` counted months forward and
could not say WHICH one, so October's rules were applied to whatever week the
manager happened to be looking at.

The obvious fix -- a second field for the start -- was written, and the API
refused the schema: 400 Schema is too complex, which takes the intake down
entirely rather than degrading it. Measured against the real API, thirteen
top-level fields is accepted and fourteen is not. So the field that already
owned "when" learned a small grammar instead of gaining a neighbour:

    "3"          the next three months
    "2026-10"    only that month
    "2026-10:2"  two months from it

These pin the grammar, both what it accepts and what it refuses. Pure
conversion tests -- no database, no network, no model call.
"""

from app.services.intake import ScheduleBrief, brief_to_spec


def spec_for(**fields) -> dict:
    return brief_to_spec(ScheduleBrief.model_validate(fields))


def horizon_rule(spec: dict) -> str | None:
    rules = [r for r in spec["rules"] if r["kind"] == "horizon"]
    return rules[0]["label"] if rules else None


def test_a_bare_count_is_months_forward():
    spec = spec_for(horizon="3")
    assert (spec["horizonMonths"], spec["horizonStart"]) == (3, None)
    assert horizon_rule(spec) == "Covers the next 3 months"


def test_a_named_month_covers_that_month():
    """The sentence that started this."""
    spec = spec_for(horizon="2026-10")
    assert (spec["horizonMonths"], spec["horizonStart"]) == (1, "2026-10-01")
    assert horizon_rule(spec) == "Covers October 2026"


def test_a_named_month_with_a_length():
    spec = spec_for(horizon="2026-10:2")
    assert (spec["horizonMonths"], spec["horizonStart"]) == (2, "2026-10-01")


def test_a_day_of_the_month_snaps_to_its_month():
    """The calendar spans whole months, so "from the 15th" builds October.

    Refusing it instead would be pedantry the manager pays for: the model
    reaching for a full date is a reasonable reading of "a partir de octubre",
    and the result is the same calendar either way.
    """
    spec = spec_for(horizon="2026-10-15")
    assert (spec["horizonMonths"], spec["horizonStart"]) == (1, "2026-10-01")


def test_prose_is_refused_rather_than_guessed():
    """A period invented here is a calendar for the wrong weeks.

    Harder to notice than no calendar at all, which is why anything outside the
    grammar produces nothing rather than a best effort.
    """
    for value in ("octubre", "next month", "", "  ", "2026", "10-2026", "2026-13"):
        spec = spec_for(horizon=value)
        assert (spec["horizonMonths"], spec["horizonStart"]) == (None, None), value
        assert horizon_rule(spec) is None


def test_the_count_is_capped_at_two_years():
    """Past that the roster the plan assumes has certainly changed."""
    assert spec_for(horizon="99")["horizonMonths"] == 24


def test_zero_months_is_not_a_period():
    spec = spec_for(horizon="0")
    assert (spec["horizonMonths"], spec["horizonStart"]) == (None, None)


def test_a_brief_that_says_nothing_about_when_states_no_horizon():
    spec = spec_for(open_time="09:00", close_time="17:00")
    assert (spec["horizonMonths"], spec["horizonStart"]) == (None, None)
    assert horizon_rule(spec) is None


def test_the_schema_still_fits_in_thirteen_fields():
    """The constraint this whole design exists to respect.

    Not a style rule: the fourteenth field came back from the API as "Schema is
    too complex" and the intake stopped working. Anything added here has to
    take a seat from something else, and this test is where that gets noticed
    before a manager does.
    """
    from app.services.intake import ScheduleFields

    assert len(ScheduleFields.model_json_schema()["properties"]) == 13
