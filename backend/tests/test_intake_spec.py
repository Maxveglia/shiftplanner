"""The brief -> spec translation, which is where a manager's words either
survive or get quietly dropped.

These are pure conversion tests: no database, no network, no model call. They
pin the promise the intake makes -- that anything the schema CAN hold reaches
the scheduler as an enforceable rule, and that whatever it cannot hold is
visible in `notes` rather than silently discarded.
"""

from __future__ import annotations

from app.services.intake import ScheduleBrief, brief_to_spec


def spec_for(**fields) -> dict:
    return brief_to_spec(ScheduleBrief.model_validate(fields))


def kinds(spec: dict) -> list:
    return [r["kind"] for r in spec["rules"]]


def test_a_weekday_scoped_requirement_survives_as_a_rule():
    """'Four people on Saturdays' used to have nowhere to go but `notes`."""
    spec = spec_for(
        min_staff=2,
        coverage=[{"weekdays": ["saturday"], "staff": 4}],
    )
    assert spec["coverage"] == [
        {
            "weekdays": [6],
            "dates": [],
            "startMin": None,
            "endMin": None,
            "staff": 4,
            # A rule with no `exact` is a floor: it may raise cover, never cut it.
            "exact": False,
        }
    ]
    assert spec["minStaff"] == 2
    assert "peak_cover" in kinds(spec)


def test_two_busy_windows_are_two_rules():
    """The old single `peak` field could only keep one of these."""
    spec = spec_for(
        min_staff=2,
        coverage=[
            {"start_time": "12:00", "end_time": "15:00", "staff": 3},
            {"start_time": "19:00", "end_time": "23:00", "staff": 4},
        ],
    )
    assert [(c["startMin"], c["endMin"], c["staff"]) for c in spec["coverage"]] == [
        (720, 900, 3),
        (1140, 1380, 4),
    ]


def test_an_unscoped_requirement_raises_the_flat_minimum_instead_of_duplicating():
    """A rule with no weekday, date or window IS the flat minimum."""
    spec = spec_for(min_staff=2, coverage=[{"staff": 3}])
    assert spec["minStaff"] == 3
    assert spec["coverage"] == []


def test_a_weekday_can_have_its_own_opening_hours():
    spec = spec_for(
        open_time="08:00",
        close_time="22:00",
        day_hours=[
            {"weekdays": ["sunday"], "open_time": "10:00", "close_time": "14:00"}
        ],
    )
    assert spec["openMin"] == 480 and spec["closeMin"] == 1320
    assert spec["dayHours"] == [{"weekday": 0, "openMin": 600, "closeMin": 840}]
    assert "day_hours" in kinds(spec)


def test_a_one_off_closure_is_a_date_not_a_weekday():
    spec = spec_for(closed_weekdays=["sunday"], closed_dates=["2026-01-01"])
    assert spec["closedWeekdays"] == [0]
    assert spec["closedDates"] == ["2026-01-01"]


def test_shift_length_is_kept_only_within_a_workable_range():
    assert spec_for(shift_length_hours=6)["shiftLengthHours"] == 6
    # A 30-minute or 20-hour shift is not something the generator can build.
    assert spec_for(shift_length_hours=0.5)["shiftLengthHours"] is None
    assert spec_for(shift_length_hours=20)["shiftLengthHours"] is None


def test_garbage_in_a_rule_drops_that_rule_and_keeps_the_rest():
    spec = spec_for(
        coverage=[
            {"weekdays": ["funday"], "start_time": "25:99", "staff": 3},
            {"weekdays": ["monday"], "staff": 4},
            {"weekdays": ["tuesday"], "staff": 999},
        ]
    )
    # The first rule loses its unparseable window and its unknown weekday,
    # leaving it unscoped -- so it raises the floor rather than vanishing.
    assert spec["minStaff"] == 3
    # Out-of-range headcount is dropped; the valid rule survives.
    assert spec["coverage"] == [
        {
            "weekdays": [1],
            "dates": [],
            "startMin": None,
            "endMin": None,
            "staff": 4,
            # A rule with no `exact` is a floor: it may raise cover, never cut it.
            "exact": False,
        }
    ]


def test_what_the_schema_cannot_hold_stays_visible():
    """Per-person preferences are still out of scope -- but not silent."""
    spec = spec_for(notes=["Ana prefiere turnos de mañana"])
    assert spec["notes"] == ["Ana prefiere turnos de mañana"]


def test_an_empty_brief_falls_back_to_the_documented_defaults():
    spec = spec_for()
    assert spec["openMin"] == 480 and spec["closeMin"] == 1320
    assert spec["minStaff"] == 2
    assert spec["coverage"] == [] and spec["dayHours"] == []
    assert spec["closedDates"] == [] and spec["shiftLengthHours"] is None


def test_the_roster_is_not_part_of_the_scheduling_schema():
    """The two halves are asked for separately, and must stay separate.

    Combined, they sat at the API's structured-output complexity limit: the
    call was accepted or rejected depending on what else the schema carried,
    and a rejected intake fell back to the local regex parser without saying
    so. Putting `team` back on `ScheduleFields` reopens that.
    """
    from app.services.intake import ScheduleFields, TeamFields

    assert "team" not in ScheduleFields.model_json_schema()["properties"]
    assert "team" in TeamFields.model_json_schema()["properties"]
    # The recombined brief still exposes both to every existing caller.
    assert {"team", "coverage"} <= set(ScheduleBrief.model_fields)
