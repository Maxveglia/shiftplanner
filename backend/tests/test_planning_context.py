"""What the model that ARRANGES the calendar is told about a business.

No database, no network, no model call: this is the block of text and the rules
that decide what goes in it.

The distinction under test throughout is the one that justifies the function
existing at all. ``model_context`` feeds the call that EXTRACTS requirements
from a brief, where background is a hazard -- anything it licenses is a
requirement nobody stated. ``planning_context`` feeds the call that arranges
shifts against requirements already fixed and independently validated, where
the same material is exactly what decides between several legal rotas.

What must NOT differ is the honesty: an inferred vertical is withheld from both,
and a manager who switched learning off gets neither.
"""

import uuid

import pytest

from app.models.business_profile import BusinessProfile
from app.models.learned_hint import LearnedHint
from app.services import business_profile as bp


def _profile(**kw) -> BusinessProfile:
    p = BusinessProfile(org_id=uuid.uuid4())
    p.vertical = kw.get("vertical")
    p.vertical_source = kw.get("vertical_source", "declared")
    p.house_notes = kw.get("house_notes")
    p.learning_enabled = kw.get("learning_enabled", True)
    p.objective = kw.get("objective")
    p.weekend_days = kw.get("weekend_days")
    p.research_notes = kw.get("research_notes")
    p.location = kw.get("location")
    return p


def _hint(key: str, value: dict, **kw) -> LearnedHint:
    h = LearnedHint(org_id=uuid.uuid4())
    h.key = key
    h.value = value
    h.evidence_days = kw.get("evidence_days", bp.MIN_EVIDENCE)
    h.contradictions = kw.get("contradictions", 0)
    h.rejected = kw.get("rejected", False)
    return h


class TestSilence:
    def test_says_nothing_about_a_business_we_know_nothing_about(self):
        assert bp.planning_context(_profile(), hints=[]) == ""

    def test_says_nothing_when_there_is_no_profile_at_all(self):
        assert bp.planning_context(None, hints=[]) == ""

    def test_respects_a_manager_who_switched_learning_off(self):
        # The same flag `model_context` respects. A manager who turned this off
        # turned it off everywhere, not only on the call they happened to know
        # about.
        profile = _profile(
            vertical="bar", objective="fair", learning_enabled=False
        )
        assert bp.planning_context(profile, [_hint("min_staff", {"staff": 4})]) == ""


class TestHonesty:
    def test_withholds_a_vertical_we_merely_guessed(self):
        guessed = _profile(vertical="bar", vertical_source="inferred")
        assert "bar" not in bp.planning_context(guessed, hints=[])

    def test_states_a_vertical_the_manager_declared(self):
        declared = _profile(vertical="bar", vertical_source="declared")
        assert "bar" in bp.planning_context(declared, hints=[])

    def test_never_lets_a_preference_read_as_a_rule(self):
        # The whole safety argument for this block is that it cannot create a
        # requirement. If the text ever stops saying so, that argument is gone
        # and nobody would notice from the outside.
        text = bp.planning_context(_profile(vertical="bar"), hints=[])
        assert "PREFERENCES, not rules" in text
        assert "discarded" in text


class TestWhatItCarries:
    def test_carries_what_the_manager_wrote_about_their_business(self):
        profile = _profile(house_notes="Los sabados vienen los del mercado")
        assert "Los sabados vienen los del mercado" in bp.planning_context(
            profile, hints=[]
        )

    @pytest.mark.parametrize("objective", sorted(bp.OBJECTIVES))
    def test_every_objective_has_something_to_say(self, objective):
        # An objective with no sentence behind it would be silently ignored by
        # the planner while the manager believes they chose something.
        text = bp.planning_context(_profile(objective=objective), hints=[])
        assert text != ""
        assert bp.OBJECTIVE_CONTEXT[objective][:20] in text

    def test_names_a_weekend_that_is_not_saturday_and_sunday(self):
        # A business that works Thursday to Saturday has its own weekend, and a
        # planner told nothing assumes ours.
        profile = _profile(weekend_days=[1, 2])
        text = bp.planning_context(profile, hints=[])
        assert "Monday" in text and "Tuesday" in text

    def test_carries_what_the_manager_keeps_correcting(self):
        believed = _hint("min_staff", {"staff": 4})
        text = bp.planning_context(_profile(), [believed])
        assert "repeatedly corrected us" in text

    def test_leaves_out_a_hint_without_enough_evidence(self):
        # One bad Friday is not a belief about a business, and the planner must
        # not be told it is.
        thin = _hint("min_staff", {"staff": 4}, evidence_days=1)
        assert bp.planning_context(_profile(), [thin]) == ""

    def test_leaves_out_a_hint_the_manager_rejected(self):
        refused = _hint("min_staff", {"staff": 4}, rejected=True)
        assert bp.planning_context(_profile(), [refused]) == ""


class TestResearchIsNotTestimony:
    """What we looked up must never read as what the manager told us.

    This is `vertical_source` again, arriving through a different door. A
    summary a model wrote after searching the web is plausible, specific and
    completely unverified, and the one thing that keeps it honest is that it is
    labelled -- so these tests are the label.
    """

    def test_says_out_loud_that_the_research_is_ours(self):
        profile = _profile(research_notes="August is the busy month around here")
        text = bp.planning_context(profile, hints=[])
        assert "August is the busy month around here" in text
        assert "WE looked up" in text
        assert "may be wrong" in text

    def test_the_manager_outranks_the_research(self):
        # Both present and disagreeing is the case that matters: without a rule
        # the model picks whichever it read last.
        profile = _profile(
            house_notes="Cerramos en agosto",
            research_notes="August is the busy month around here",
        )
        text = bp.planning_context(profile, hints=[])
        assert "The manager describes it: Cerramos en agosto" in text
        assert "what the manager said outranks" in text

    def test_research_alone_is_enough_to_say_something(self):
        # An account whose manager has told us nothing still benefits, and the
        # block must not come back empty just because the human half is blank.
        profile = _profile(research_notes="Beach bars here run late in summer")
        assert bp.planning_context(profile, hints=[]) != ""

    def test_a_manager_who_switched_learning_off_gets_no_research_either(self):
        profile = _profile(
            research_notes="Beach bars here run late in summer",
            learning_enabled=False,
        )
        assert bp.planning_context(profile, hints=[]) == ""


class TestLocation:
    def test_tells_the_planner_where_the_business_is(self):
        # Not to apply law -- that is `jurisdiction_code`, and we hold rules for
        # three places. This is so a rota knows that a beach town has a season
        # and that people here eat at ten.
        text = bp.planning_context(_profile(location="Valencia"), hints=[])
        assert "It is in Valencia." in text

    def test_location_alone_is_enough_to_say_something(self):
        assert bp.planning_context(_profile(location="Valencia"), hints=[]) != ""

    def test_says_nothing_about_a_blank_location(self):
        assert bp.planning_context(_profile(location="   "), hints=[]) == ""
