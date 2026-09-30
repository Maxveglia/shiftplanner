from __future__ import annotations

"""How many people may work a split day -- not whether anybody may.

"Se permiten turnos partidos" used to be a boolean, and the generator read
that boolean as "anyone, as often as it likes": every employee could be handed
two shifts on the same day. That is not what a manager means when they mention
the possibility once. The product owner stated the rule in one sentence: "que
exista lo del turno partido no significa que todos tengan que tener su turno
partido. Si el manager comenta una cantidad, se aplica para la cantidad que él
diga. Si no dice una cantidad, se aplica solamente para uno."

So the spec carries a COUNT, `splitShiftPeople`, and these tests pin the three
readings that count has to survive: a number the manager gave, the silence that
means one, and the refusal that means zero.
"""

import pytest

from app.services.intake import MAX_SPLIT_SHIFT_PEOPLE, ScheduleBrief, brief_to_spec


def spec_for(**fields) -> dict:
    return brief_to_spec(ScheduleBrief.model_validate(fields))


def split_rule_labels(spec: dict) -> list:
    return [r["label"] for r in spec["rules"] if r["kind"] == "split_shifts"]


# --- The owner's rule --------------------------------------------------------


def test_permission_without_a_number_means_exactly_one_person():
    """The rule the whole change exists for.

    A brief that says split shifts are possible has permitted ONE double day,
    not a payroll of them. Reading this as "everybody" is what let the
    generator build a calendar the manager never asked for.
    """
    spec = spec_for(split_shifts_allowed=True)
    assert spec["splitShiftPeople"] == 1


def test_a_stated_number_is_the_number_the_manager_said():
    """"Dos personas pueden hacer turno partido" is two people. Not one, not all."""
    spec = spec_for(split_shifts_allowed=True, split_shift_people=2)
    assert spec["splitShiftPeople"] == 2


def test_no_split_shifts_means_nobody():
    """Silence about split shifts is a refusal, not an invitation.

    A brief that never mentions them must not buy anyone a double day, and the
    old boolean has to agree, or a client still reading it enables what the
    manager never allowed.
    """
    spec = spec_for()
    assert spec["splitShiftPeople"] == 0
    assert spec["allowSplitShifts"] is False
    assert split_rule_labels(spec) == []

    explicit_no = spec_for(split_shifts_allowed=False)
    assert explicit_no["splitShiftPeople"] == 0
    assert explicit_no["allowSplitShifts"] is False


# --- What the manager reads back --------------------------------------------


def test_the_rule_shown_to_the_manager_names_the_count():
    """The confirmation screen is where a wrong reading gets caught.

    "Split shifts allowed" told the manager nothing about how many of their
    people it applied to -- and the honest answer used to be "all of them".
    """
    assert split_rule_labels(spec_for(split_shifts_allowed=True, split_shift_people=2)) == [
        "Split shifts allowed for 2 people a day"
    ]
    assert split_rule_labels(spec_for(split_shifts_allowed=True)) == [
        "Split shifts allowed for 1 person a day"
    ]


# --- A number that cannot be trusted ----------------------------------------


def test_an_enormous_count_is_capped_never_passed_through():
    """999 people on split shifts is a bad extraction, not a staffing decision.

    Capping keeps a hallucinated number from becoming a calendar in which
    everyone works twice a day.
    """
    spec = spec_for(split_shifts_allowed=True, split_shift_people=999)
    assert spec["splitShiftPeople"] == MAX_SPLIT_SHIFT_PEOPLE
    assert MAX_SPLIT_SHIFT_PEOPLE == 50


@pytest.mark.parametrize("garbage", [0, -3])
def test_a_count_below_one_falls_back_to_the_permission_it_came_with(garbage):
    """Zero and negatives are extraction noise, not a smaller permission.

    The model is told to answer null when the brief states no number, so a 0
    means the reading failed, not that the manager forbade what they had just
    permitted. Falling back to the yes/no answer lands on one person -- exactly
    where a brief with no number lands.
    """
    assert spec_for(split_shifts_allowed=True, split_shift_people=garbage)[
        "splitShiftPeople"
    ] == 1
    assert spec_for(split_shifts_allowed=False, split_shift_people=garbage)[
        "splitShiftPeople"
    ] == 0


def test_a_count_without_the_flag_still_permits_split_shifts():
    """A number IS permission, even when the flag disagrees.

    The count and the flag come back from two different concurrent calls, so a
    false or null flag beside a real count is far more likely to be the
    schedule call never having seen the sentence than a manager who described
    how many people work split days while forbidding them. Reading the count as
    "not allowed" would silently drop a requirement the brief spelled out.
    """
    assert spec_for(split_shift_people=2)["splitShiftPeople"] == 2
    assert spec_for(split_shift_people=2)["allowSplitShifts"] is True
    assert spec_for(split_shifts_allowed=False, split_shift_people=2)[
        "splitShiftPeople"
    ] == 2


# --- The bridge to the old client -------------------------------------------


@pytest.mark.parametrize(
    "fields",
    [
        {},
        {"split_shifts_allowed": False},
        {"split_shifts_allowed": True},
        {"split_shifts_allowed": True, "split_shift_people": 3},
        {"split_shift_people": 4},
        {"split_shifts_allowed": True, "split_shift_people": 999},
        {"split_shifts_allowed": True, "split_shift_people": 0},
    ],
)
def test_the_old_boolean_never_disagrees_with_the_new_count(fields):
    """`allowSplitShifts` is a view of the count while the frontend migrates.

    If the two can ever disagree, a client on the old field either enables
    doubles nobody allowed or hides ones the manager asked for.
    """
    spec = spec_for(**fields)
    assert spec["allowSplitShifts"] == (spec["splitShiftPeople"] > 0)


def test_the_count_reaches_the_spec_without_disturbing_anything_else():
    """A brief about split shifts is not a brief about coverage or hours."""
    spec = spec_for(split_shifts_allowed=True, split_shift_people=2, min_staff=2)
    assert spec["minStaff"] == 2
    assert spec["coverage"] == []
    assert spec["busyWeekdays"] == []
