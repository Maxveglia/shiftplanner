"""The planner reads short ids and writes short ids; nobody else ever sees them.

And the same is now true of the people behind them: a name that is on our
roster does not reach the model, and what comes back still lands on the real
employee, which is how the manager goes on reading a calendar full of names.

No database, no network. The first half is the table itself; the second half
is ``plan_calendar`` using it, with the model stood in for by a fake that
returns whatever ids the test says.
"""

from types import SimpleNamespace

import pytest

from app.services import api_usage
from app.services.id_alias import IdAliases

def _context() -> str:
    """The shape of what `buildPlanContext` sends, cut down to its ids."""
    return (
        "TEAM.\n  %s | Ana\n  %s | Luis\n"
        "SHIFT TEMPLATES.\n  %s | morning | 08:00-14:00" % (A, B, T)
    )


A = "0f8fad5b-d9cb-469f-a165-70867728950e"
B = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
T = "16fd2706-8baf-433b-82eb-8c7fada847da"


def _loaded() -> IdAliases:
    aliases = IdAliases()
    aliases.load([A, B], [T])
    return aliases


def test_people_and_templates_are_numbered_apart():
    aliases = _loaded()
    assert aliases.shorten(_context()) == (
        "TEAM.\n  e1 | Ana\n  e2 | Luis\nSHIFT TEMPLATES.\n  t1 | morning | 08:00-14:00"
    )


def test_the_same_id_gets_the_same_alias_every_time_whatever_its_case():
    aliases = _loaded()
    assert aliases.shorten("again %s" % A.upper()) == "again e1"
    assert len(aliases) == 3


def test_aliases_restore_to_the_real_id_and_inventions_do_not():
    aliases = _loaded()
    assert aliases.employee("e1") == A
    assert aliases.employee(" e2 ") == B
    assert aliases.template("t1") == T
    assert aliases.employee("e9") is None
    assert aliases.employee(None) is None
    assert aliases.employee("") is None


def test_a_template_is_refused_where_a_person_belongs_and_the_other_way_round():
    # One namespace let a model answer `employee_id: "id3"` -- the morning
    # template -- and get a real employee id back: a shift for the wrong
    # person, kept.
    aliases = _loaded()
    assert aliases.employee("t1") is None
    assert aliases.template("e1") is None


def test_an_id_nobody_declared_answers_to_either_kind():
    # A client that sends no lists degrades to no check, not to no calendar.
    aliases = IdAliases()
    aliases.shorten("%s and %s" % (A, T))
    assert aliases.employee("x1") == A
    assert aliases.template("x2") == T


def test_a_model_that_echoes_the_real_uuid_still_lands():
    aliases = _loaded()
    assert aliases.employee(A.upper()) == A
    assert aliases.employee("3f9d1c4e-0000-4000-8000-000000000000") is None, (
        "a real-looking id we never listed is still unknown"
    )


def test_text_without_ids_is_untouched():
    aliases = _loaded()
    assert aliases.shorten("open 9 to 5, closed Sundays") == "open 9 to 5, closed Sundays"


# --- Names ------------------------------------------------------------------

NAMES = {A: "Ana García Pérez", B: "Luis Moreno"}


def _named() -> IdAliases:
    aliases = _loaded()
    aliases.load_names(NAMES)
    return aliases


def test_a_full_name_becomes_the_alias_its_owner_s_id_already_has():
    # The finding this whole change answers: "Ana García Pérez" left the
    # product for a third party on every generation.
    aliases = _named()
    out = aliases.shorten("TEAM.\n  %s | Ana García Pérez | active" % A)
    assert out == "TEAM.\n  e1 | e1 | active"
    assert "Ana" not in out and "Garc" not in out


def test_the_first_name_the_manager_actually_types_is_masked_too():
    # The brief says "Ana", never the name on the contract. A mask that only
    # caught the full name would catch the one spelling nobody writes.
    aliases = _named()
    assert aliases.shorten("Ana abre siempre y Luis cierra") == "e1 abre siempre y e2 cierra"


def test_a_name_written_without_its_accents_is_still_that_name():
    aliases = _named()
    assert aliases.shorten("Garcia libra el jueves") == "e1 libra el jueves"
    assert aliases.shorten("GARCÍA libra el jueves") == "e1 libra el jueves"


def test_a_name_inside_another_word_is_not_a_name():
    # "Ana" inside "semana" is a syllable. Masking it would mangle the brief
    # and teach the model that a week is a person.
    aliases = _named()
    assert aliases.shorten("una semana de mañana") == "una semana de mañana"


def test_two_people_called_ana_stay_two_people():
    # Choosing one of them would be a regular expression deciding which Ana
    # works Fridays. The model is left exactly as informed as it was.
    aliases = IdAliases()
    aliases.load([A, B], [])
    aliases.load_names({A: "Ana García", B: "Ana Moreno"})
    assert aliases.shorten("Ana abre") == "e1 or e2 abre"
    assert aliases.shorten("Ana Moreno abre") == "e2 abre", (
        "said in full, there is no ambiguity to preserve"
    )


def test_a_surname_particle_is_not_a_person():
    aliases = IdAliases()
    aliases.load([A], [])
    aliases.load_names({A: "Juan de la Cruz"})
    assert aliases.shorten("la cocina de la casa") == "la cocina de la casa"
    assert aliases.shorten("Juan de la Cruz abre") == "e1 abre"
    assert aliases.shorten("Cruz abre") == "e1 abre"


def test_a_first_name_the_calendar_needs_as_a_word_is_left_alone():
    # Julio is a man and a month; Domingo is a man and a Sunday. Masking those
    # on their own tells the planner the shop closes on a PERSON, which is a
    # wrong calendar -- worse than the one first name it protects. The full
    # name is still masked, and the plural never matched anyway.
    aliases = IdAliases()
    aliases.load([A, B], [])
    aliases.load_names({A: "Julio Ramírez", B: "Domingo Sanz"})
    assert aliases.shorten("cerramos el domingo de julio") == (
        "cerramos el domingo de julio"
    )
    assert aliases.shorten("Julio Ramírez abre") == "e1 abre"
    assert aliases.shorten("Ramírez abre") == "e1 abre"


def test_somebody_we_were_never_told_about_is_not_masked():
    # Stated so the limit is impossible to forget: this redacts what we know.
    aliases = _named()
    assert "Marta" in aliases.shorten("Marta es la encargada")


def test_somebody_off_the_roster_is_hidden_but_never_becomes_plannable():
    # THE ROSTER WE READ IS THE WHOLE ORGANISATION, removed people included,
    # because a context written yesterday still talks about them. Hiding their
    # name must not re-declare them: Pedro left, the brief still says "Pedro
    # hacía los cierres", and a shift the model writes for him has to be
    # dropped on the way back exactly as it was before names were masked.
    # Kept, it would count as cover in the browser, stop the greedy pass
    # filling those hours, and be discarded at publish -- a month that looked
    # staffed going out with holes in it.
    gone = "9c1f0d2a-1111-4000-8000-000000000001"
    aliases = IdAliases()
    aliases.load([A], [])
    aliases.load_names({A: "Ana García", gone: "Pedro Solís"})

    assert aliases.shorten("Pedro hacía los cierres") == "p1 hacía los cierres"
    assert aliases.employee("p1") is None
    assert aliases.template("p1") is None
    # And the person who IS in the request still answers under her own alias.
    assert aliases.shorten("Ana abre") == "e1 abre"
    assert aliases.employee("e1") == A


def test_a_name_alone_never_manufactures_a_plannable_person():
    aliases = IdAliases()
    aliases.load_names(NAMES)
    assert aliases.shorten("Ana") == "p1"
    assert aliases.employee("p1") is None
    # The promise this module has always made survives: a client that declares
    # no lists still gets a calendar, because a UUID in the TEXT is filed as
    # unknown and restores.
    assert aliases.shorten(A) == "x1"
    assert aliases.employee("x1") == A


def test_one_word_written_small_is_a_noun_and_not_a_person():
    # Sol, Mar, Paz, Luz, Rosa, Alba, Cruz are first names AND ordinary nouns,
    # and the list never ends -- _CALENDAR_WORDS can only ever hold months and
    # weekdays. Masking them turns the brief into a rota about two people who
    # were never mentioned.
    aliases = IdAliases()
    aliases.load([A, B], [])
    aliases.load_names({A: "Sol Vega", B: "Mar Ruiz"})
    assert aliases.shorten("trabaja con sol y mar en la terraza") == (
        "trabaja con sol y mar en la terraza"
    )
    # Capitalised, it is a person again -- which is how the prose we get reads.
    assert aliases.shorten("Sol abre y Mar cierra") == "e1 abre y e2 cierra"
    # And a full name needs no capital to be unmistakable.
    assert aliases.shorten("sol vega abre") == "e1 abre"


def test_a_letter_ndf_will_not_take_apart_is_still_folded():
    # "ø" is a stroke through the letter, not a mark on top of it, so NFD
    # leaves it alone. The pattern matched "Bjørn" and the lookup then missed,
    # and a miss used to hand the name straight back.
    aliases = IdAliases()
    aliases.load([A], [])
    aliases.load_names({A: "Bjorn Larsen"})
    assert aliases.shorten("Bjørn abre el lunes") == "e1 abre el lunes"
    assert aliases.shorten("Bjorn abre el lunes") == "e1 abre el lunes"


# --- Through plan_calendar ---------------------------------------------------

USAGE = SimpleNamespace(
    input_tokens=1, output_tokens=1, cache_creation_input_tokens=0, cache_read_input_tokens=0
)



def _text(content) -> str:
    """What the model reads, whether sent as a string or as text blocks.

    The planner sends blocks so the shared prefix can carry a cache marker;
    the words are what these tests are about, not the envelope.
    """
    if isinstance(content, str):
        return content
    return "\n\n".join(block["text"] for block in content)

class _Stream:
    """The context manager ``messages.stream`` returns, around one finished
    reply. The planner streams because a month takes minutes to write and does
    not fit inside one response deadline."""

    def __init__(self, message):
        self._message = message

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        # The planner iterates the events to keep its own clock on them. A
        # scripted reply has none; what matters is that the loop ends.
        return iter(())

    def get_final_message(self):
        return self._message


class _Model:
    """Returns the shifts the test scripted, and records what it was shown.

    BOTH texts are recorded. A test that only looked at the user message was
    how the manager's preferences -- a paragraph we render out of our own
    database, and the one that names people on purpose -- went out unmasked
    for a while with a privacy test standing over it, green.
    """

    shifts: list = []
    seen: list = []
    systems: list = []

    def __init__(self, *args, **kwargs):
        self.messages = self

    def with_middleware(self, *_middleware):
        """The real client returns a cheap copy that shares the connection
        pool. The planner wraps itself once per generation to count the HTTP
        attempts the SDK retries internally, so a double that cannot do this
        is a double that no longer matches the thing it stands in for."""
        return self

    def stream(self, **kw):
        from app.services.calendar_plan import MonthPlan, ProposedShift

        _Model.seen.append(_text(kw["messages"][0]["content"]))
        _Model.systems.append(_text(kw.get("system", "")))
        plan = MonthPlan(shifts=[ProposedShift(**s) for s in _Model.shifts])
        return _Stream(SimpleNamespace(parsed_output=plan, usage=USAGE))


@pytest.fixture
def model(monkeypatch):
    import anthropic

    _Model.shifts = []
    _Model.seen = []
    _Model.systems = []
    monkeypatch.setattr(anthropic, "Anthropic", _Model)
    return _Model


def test_the_model_is_shown_short_ids_and_never_a_uuid(model):
    from app.services.calendar_plan import plan_calendar

    with api_usage.collect():
        plan_calendar(_context(), ["2026-10"], "key", "", [A, B], [T])
    assert len(model.seen) == 1
    assert A not in model.seen[0] and B not in model.seen[0] and T not in model.seen[0]
    assert "e1 | Ana" in model.seen[0] and "t1 | morning" in model.seen[0]


def test_what_the_model_writes_comes_back_with_the_real_ids(model):
    from app.services.calendar_plan import plan_calendar

    model.shifts = [
        {"employee_id": "e1", "date": "2026-10-05", "start": "08:00", "end": "14:00", "template_id": "t1"},
        {"employee_id": "e2", "date": "2026-10-05", "start": "14:00", "end": "20:00"},
    ]
    with api_usage.collect():
        shifts, failed = plan_calendar(_context(), ["2026-10"], "key", "", [A, B], [T])
    assert failed == []
    assert [(s.employee_id, s.template_id) for s in shifts] == [(A, T), (B, None)]


def test_a_shift_for_someone_never_listed_is_dropped_not_passed_on(model):
    from app.services.calendar_plan import plan_calendar

    model.shifts = [
        {"employee_id": "e9", "date": "2026-10-05", "start": "08:00", "end": "14:00"},
        {"employee_id": "e2", "date": "2026-10-06", "start": "08:00", "end": "14:00", "template_id": "t7"},
    ]
    with api_usage.collect():
        shifts, failed = plan_calendar(_context(), ["2026-10"], "key", "", [A, B], [T])
    assert failed == []
    assert [(s.employee_id, s.template_id) for s in shifts] == [(B, None)], (
        "the invented person is gone; the invented template is merely forgotten"
    )


def test_a_month_where_nobody_could_be_placed_is_reported_as_failed(model):
    # Not an empty success: the client's amber banner says the AI did not
    # arrange this month, instead of a greedy calendar passing for the
    # model's work.
    from app.services.calendar_plan import plan_calendar

    model.shifts = [
        {"employee_id": "e9", "date": "2026-10-05", "start": "08:00", "end": "14:00"},
        {"employee_id": "t1", "date": "2026-10-06", "start": "08:00", "end": "14:00"},
    ]
    with api_usage.collect():
        shifts, failed = plan_calendar(_context(), ["2026-10"], "key", "", [A, B], [T])
    assert shifts == []
    assert failed == ["2026-10"]


def test_a_month_the_model_left_empty_on_purpose_is_not_a_failure(model):
    from app.services.calendar_plan import plan_calendar

    model.shifts = []
    with api_usage.collect():
        shifts, failed = plan_calendar(_context(), ["2026-10"], "key", "", [A, B], [T])
    assert (shifts, failed) == ([], [])


def test_no_real_name_reaches_the_model_and_the_answer_still_lands_on_her(model):
    # THE TWO HALVES OF THE FIX, IN ONE CALL.
    #
    # Out: a context that names Ana twice -- once as the roster row the client
    # used to write, once inside the manager's own sentence -- AND a manager's
    # preferences paragraph that names her a third time, which is the one we
    # compose ourselves. The model is shown none of them. In: the shift it
    # writes for "e1" comes back carrying Ana's real id, which is the only
    # thing the manager's calendar has ever needed to print her name.
    from app.services.calendar_plan import plan_calendar

    context = (
        "TEAM.\n  %s | Ana García Pérez | active\n  %s | Luis Moreno | active\n"
        'WHAT THE MANAGER ASKED FOR: "Ana abre siempre y nunca coincide con Luis."'
        % (A, B)
    )
    # Exactly the shape `business_profile.planning_context` renders, from a
    # rule `triage.py` was told to write with the person's name in it.
    preferences = (
        "Standing rules this manager has told us and confirmed: Luis siempre "
        "cierra; Ana García Pérez no trabaja los domingos."
    )
    model.shifts = [
        {"employee_id": "e1", "date": "2026-10-05", "start": "08:00", "end": "14:00"}
    ]
    with api_usage.collect():
        shifts, failed = plan_calendar(
            context, ["2026-10"], "key", preferences, [A, B], [], NAMES
        )

    sent = model.seen[0]
    # The part of the system prompt that carries DATA. Everything above the
    # heading is a constant we wrote, the same for every customer, and its
    # worked example happens to be called Ana -- a fixed illustration is
    # nobody's employee, and asserting over it would only teach the next
    # person to weaken this test.
    heading = "WHAT THIS MANAGER PREFERS"
    assert heading in model.systems[0]
    system = model.systems[0].split(heading, 1)[1]
    for secret in ("Ana", "Garc", "Pérez", "Luis", "Moreno", A, B):
        assert secret not in sent, "%r reached the model in the context" % secret
        assert secret not in system, (
            "%r reached the model in the SYSTEM prompt -- the preferences are "
            "ours and name people on purpose" % secret
        )
    assert "e1 abre siempre y nunca coincide con e2" in sent, (
        "the preference has to survive the mask or the rota gets worse"
    )
    assert "e2 siempre cierra" in system and "e1 no trabaja los domingos" in system, (
        "a standing rule masked into uselessness is a rule the manager "
        "confirmed and we then ignored"
    )

    assert failed == []
    assert [s.employee_id for s in shifts] == [A]
    assert NAMES[shifts[0].employee_id] == "Ana García Pérez", (
        "what comes back is the id the client joins to the roster to show a name"
    )


def test_without_the_roster_the_planner_behaves_exactly_as_it_did(model):
    # The worker cannot always read the roster (see _employee_names). A job
    # that loses that read is a job that plans, unmasked, rather than no job.
    from app.services.calendar_plan import plan_calendar

    with api_usage.collect():
        plan_calendar("TEAM.\n  %s | Ana | active" % A, ["2026-10"], "key", "", [A], [])
    assert "e1 | Ana | active" in model.seen[0]


def test_the_rule_about_the_manager_s_words_is_stated_once_and_here():
    # The client sends the words; what to do with them is said in the system
    # prompt and nowhere else, so the two cannot drift apart.
    from app.services.calendar_plan import SYSTEM_PROMPT

    assert "the manager's own words" in SYSTEM_PROMPT
    assert "the words win" in SYSTEM_PROMPT


def test_a_period_that_starts_mid_month_is_planned_from_its_first_day():
    # A first calendar asked for on the 22nd covers the 22nd onwards. The
    # context says so in PERIOD; the prompt has to say PERIOD wins over "the
    # month", and must not still ask for every hour of the month covered.
    from app.services.calendar_plan import SYSTEM_PROMPT

    assert "from PERIOD's first day on" in SYSTEM_PROMPT
    assert "on or after the first day of PERIOD" in SYSTEM_PROMPT
    assert "Cover every open hour of the period" in SYSTEM_PROMPT
    assert "Cover every open hour of the month" not in SYSTEM_PROMPT
