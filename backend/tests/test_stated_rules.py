"""Rules the manager states in passing, kept until they confirm them.

The adaptive layer learns from what a manager DOES -- the corrections they
apply, counted over distinct days, because three Fridays in a row might be
three Fridays in a row and not a pattern. It has never learned from what they
SAY. "Laura siempre abre" steered one month's calendar and was then forgotten,
and in November they typed it again.

A sentence is not a coincidence, so it needs no evidence. But it is not
necessarily permanent either -- "Ana libra el viernes" may be this Friday or
every Friday -- and only the manager knows which. So the trade this file
defends is: read it for free (the triage desk is already reading the
sentence), record it, and CHANGE NOTHING until a human says it is a rule.

The three ways this could have gone wrong, one test each:

1. A small model's opinion starts steering rotas on its own.
2. Saying the same thing twice fills the rules screen with near-duplicates.
3. A rejected proposal comes back the next time they phrase it the same way.
"""

from datetime import date
from uuid import uuid4

from app.models.learned_hint import LearnedHint
from app.services import business_profile as bp


class _Session:
    """The thinnest thing that behaves like the session this code uses."""

    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.added = []

    def execute(self, _stmt):
        session = self

        class _Result:
            def scalar_one_or_none(self):
                # The real query filters by org and key; the tests that care
                # about matching set up exactly one row, so returning it is the
                # same answer with none of the SQLAlchemy machinery.
                return session.rows[0] if session.rows else None

        return _Result()

    def add(self, row):
        self.added.append(row)
        self.rows.append(row)

    def flush(self):
        pass


def _stated(text, accepted=False, rejected=False):
    return LearnedHint(
        org_id=uuid4(),
        key=bp.STATED_PREFIX + "abc",
        value={"text": text, "accepted": accepted},
        evidence_days=1,
        rejected=rejected,
    )


def test_a_stated_rule_changes_nothing_until_it_is_confirmed():
    # The whole safety of reading rules out of prose. A small model deciding a
    # sentence sounded permanent must not be able to steer anybody's rota.
    proposal = _stated("Laura siempre abre")
    assert bp.is_active(proposal) is False

    proposal.value = {**proposal.value, "accepted": True}
    assert bp.is_active(proposal) is True


def test_confirming_does_not_wait_for_evidence():
    # An inferred hint needs MIN_EVIDENCE distinct days because it might be a
    # coincidence. A sentence a human typed is not a coincidence -- it is just
    # not necessarily permanent, which is what the confirmation settles.
    confirmed = _stated("Laura siempre abre", accepted=True)
    confirmed.evidence_days = 1
    assert bp.MIN_EVIDENCE > 1
    assert bp.is_active(confirmed) is True


def test_rejection_still_outranks_everything():
    assert bp.is_active(_stated("Laura siempre abre", accepted=True, rejected=True)) is False


def test_the_same_sentence_twice_is_one_proposal():
    # Otherwise the rules screen fills with near-identical lines and stops
    # being something a manager can sweep with their eye.
    db = _Session()
    org = uuid4()
    first = bp.note_stated_rule(db, org, "Laura siempre abre", today=date(2026, 10, 1))
    assert len(db.added) == 1

    second = bp.note_stated_rule(
        db, org, "  laura   SIEMPRE abre  ", today=date(2026, 10, 2)
    )
    assert second == first, "spacing and case must not make a second rule"
    assert len(db.added) == 1


def test_saying_it_again_does_not_un_reject_it():
    # The failure that would make the layer feel like it is not listening.
    rejected = _stated("Laura siempre abre", rejected=True)
    db = _Session([rejected])
    bp.note_stated_rule(db, uuid4(), "Laura siempre abre", today=date(2026, 10, 5))

    assert rejected.rejected is True
    assert db.added == []


def test_an_empty_or_enormous_rule_is_not_recorded():
    db = _Session()
    assert bp.note_stated_rule(db, uuid4(), "   ") is None
    # A "rule" of this length is a paragraph, and a paragraph is not something
    # anybody can confirm at a glance.
    assert bp.note_stated_rule(db, uuid4(), "x" * 301) is None
    assert db.added == []


def test_a_stated_rule_reads_back_as_the_manager_wrote_it():
    # Nothing we could phrase better than they did.
    assert bp.hint_label(_stated("Ana y Luis nunca juntos")) == "Ana y Luis nunca juntos"


def test_the_planner_is_told_which_ones_the_manager_said():
    # Kept apart from what we INFERRED, because the two have different
    # standing: one is their own sentence, the other is a pattern we noticed.
    # Presented alike, something we deduced would carry the authority of
    # something they told us.
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

    text = bp.planning_context(
        _Profile(), [_stated("Laura siempre abre", accepted=True)]
    )
    assert "told us and confirmed" in text
    assert "Laura siempre abre" in text
    assert "repeatedly corrected us" not in text


def test_an_unconfirmed_rule_never_reaches_the_planner():
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

    text = bp.planning_context(_Profile(), [_stated("Laura siempre abre")])
    assert "Laura siempre abre" not in text


def test_the_desk_is_told_what_is_not_a_rule():
    # The prompt is the only thing standing between "read rules from prose" and
    # "file somebody's sick leave as a standing rule about the business".
    from app.services.triage import SYSTEM_PROMPT

    assert "standing_rule" in SYSTEM_PROMPT
    assert "NEVER a rule" in SYSTEM_PROMPT
    assert "leave it null" in SYSTEM_PROMPT
