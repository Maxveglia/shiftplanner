"""Reading the day notes, and adding them up.

What this file defends, in the order it could go wrong:

1. The arithmetic lies: a stretch past midnight counted as two, one note taken
   for a habit, a closed day diluting "usually", last winter in this summer.
2. A person leaks: a name reaches the model, or an event about somebody (or
   about their health, pay or leave) is kept.
3. It costs money it should not: a call with learning off, with no key, for a
   text already read, one per autosave -- or a reading kept for a text that
   changed meanwhile.
4. The API breaks its contract: `pending`, a reading of an older text shown or
   counted as current, the cascade, the manager-only summary, one business
   seeing another's.

The first half needs nothing -- the model is a fake, there is no network in
this file -- and the second half needs Postgres and skips itself without it.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.config import settings
from app.models.business_profile import BusinessProfile
from app.services import api_usage
from app.services import business_profile as bp
from app.services import day_insights as di
from app.services.day_insights import DayReading

pytestmark = pytest.mark.filterwarnings("ignore")

ANA = "11111111-1111-1111-1111-111111111111"
LUIS = "22222222-2222-2222-2222-222222222222"
NAMES = {ANA: "Ana Ruiz", LUIS: "Luis Domingo Ferrer"}

FRIDAY = date(2026, 9, 18)
TODAY = date(2026, 9, 24)  # a Thursday


def _span(a, b):
    return {"start": a, "end": b}


class FakeTimer:
    """`threading.Timer`'s shape, fired by hand -- or at once, on `start`."""

    def __init__(self, interval, function, args=(), immediate=False):
        self.interval = interval
        self.function = function
        self.args = args
        self.immediate = immediate
        self.daemon = False
        self.started = False
        self.cancelled = False

    def start(self):
        self.started = True
        if self.immediate:
            self.fire()

    def cancel(self):
        self.cancelled = True

    def fire(self):
        if self.started and not self.cancelled:
            self.function(*self.args)


class Timers:
    """A timer factory that remembers every timer it made."""

    def __init__(self, immediate):
        self.immediate = immediate
        self.made = []

    def __call__(self, interval, function, args=()):
        timer = FakeTimer(interval, function, args, self.immediate)
        self.made.append(timer)
        return timer

    def live(self):
        return [t for t in self.made if t.started and not t.cancelled]


@pytest.fixture(autouse=True)
def timers(monkeypatch):
    """No test waits the quiet period: a save is read as soon as it is armed,
    unless a test swaps in a `Timers(immediate=False)` to watch the arming."""
    made = Timers(immediate=True)
    monkeypatch.setattr(di, "_new_timer", made)
    yield made
    with di._timers_lock:
        di._timers.clear()


def _row(day, **kw):
    """Anything shaped like a DayNoteInsight is enough for `aggregate`."""
    base = dict(
        note_date=day,
        revenue=None,
        customers=None,
        closed=False,
        busy=[],
        quiet=[],
        short_staffed=[],
        over_staffed=[],
        events=[],
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _reading(**kw):
    base = dict(
        revenue=None,
        customers=None,
        closed=False,
        busy=[],
        quiet=[],
        short_staffed=[],
        over_staffed=[],
        events=[],
    )
    base.update(kw)
    return DayReading(**base)


# --- 1. the arithmetic ------------------------------------------------------------


@pytest.mark.parametrize(
    "text,expected",
    [
        ("22:00-01:00", _span("22:00", "01:00")),
        ("9-12", _span("09:00", "12:00")),
        ("13.30 - 16.00", _span("13:30", "16:00")),
        ("22h a 1h", None),  # not the shape asked for; dropped, not guessed
        ("24:00-02:00", _span("00:00", "02:00")),
        ("25:00-02:00", None),
        ("12:61-13:00", None),
        ("12:00-12:00", None),  # a whole day is never what "busy" meant
        ("por la noche", None),
        ("", None),
    ],
)
def test_a_stretch_is_two_clock_times_or_nothing(text, expected):
    assert di.parse_span(text) == expected


def test_a_stretch_past_midnight_is_one_run_of_half_hours():
    assert di.slots_of(_span("22:00", "01:00")) == {44, 45, 46, 47, 0, 1}
    # Widened to whole half-hours: 22:15 counts the one from 22:00.
    assert di.slots_of(_span("22:15", "23:00")) == {44, 45}
    assert di.slots_of(_span("12:00", "12:00")) == set()


def test_half_hours_join_back_across_midnight_and_list_from_the_morning():
    slots = {26, 27, 28, 29} | {44, 45, 46, 47, 0, 1}
    got = [(s.start, s.end) for s in di.join_slots(slots)]
    assert got == [("13:00", "15:00"), ("22:00", "01:00")]
    # A run that ends exactly at midnight, and one that starts there.
    assert [(s.start, s.end) for s in di.join_slots({46, 47})] == [("23:00", "00:00")]
    assert [(s.start, s.end) for s in di.join_slots({0, 1, 2})] == [("00:00", "01:30")]
    # All day is one stretch, not forty-eight.
    assert len(di.join_slots(set(range(48)))) == 1


def test_usually_busy_is_half_the_notes_and_agrees_across_midnight():
    # Four Fridays that write the same night three ways, and one that says
    # nothing about hours. "23 a 1", "0 a 2" and "22 a 00:30" share 23:00-01:00.
    rows = [
        _row(FRIDAY, busy=[_span("23:00", "01:00")]),
        _row(FRIDAY - timedelta(days=7), busy=[_span("00:00", "02:00")]),
        _row(FRIDAY - timedelta(days=14), busy=[_span("22:00", "00:30")]),
        _row(FRIDAY - timedelta(days=21)),
    ]
    friday = di.aggregate(rows, TODAY).weekdays[4]
    assert friday.notes == 4
    assert [s.out() for s in friday.busy] == [_span("23:00", "01:00")]
    # "At least this often": the thinnest half-hour of the run.
    assert friday.busy[0].times == 2


def test_one_note_is_never_a_habit():
    rows = [_row(FRIDAY, busy=[_span("22:00", "01:00")], short_staffed=[_span("23:00", "00:00")])]
    friday = di.aggregate(rows, TODAY).weekdays[4]
    assert friday.busy == [] and friday.short_staffed == []


def test_a_closed_day_counts_as_a_note_but_not_against_usually():
    open_nights = [
        _row(FRIDAY - timedelta(days=7 * i), busy=[_span("22:00", "00:00")])
        for i in range(2)
    ]
    shut = [_row(FRIDAY - timedelta(days=7 * i), closed=True) for i in range(2, 5)]
    friday = di.aggregate(open_nights + shut, TODAY).weekdays[4]
    assert friday.notes == 5 and friday.closed == 3
    # Two of two OPEN Fridays: that is "usually", three holidays or not.
    assert [s.out() for s in friday.busy] == [_span("22:00", "00:00")]


def test_short_staffed_twice_is_a_pattern_even_when_not_usual():
    rows = [
        _row(FRIDAY - timedelta(days=7 * i), short_staffed=[_span("23:00", "00:00")] if i < 2 else [])
        for i in range(8)
    ]
    friday = di.aggregate(rows, TODAY).weekdays[4]
    assert [s.out() for s in friday.short_staffed] == [_span("23:00", "00:00")]
    assert friday.short_staffed[0].times == 2


def test_busy_and_quiet_at_once_goes_to_the_majority_or_to_neither():
    rows = [
        _row(FRIDAY, busy=[_span("22:00", "23:00")], quiet=[_span("20:00", "21:00")]),
        _row(FRIDAY - timedelta(days=7), busy=[_span("22:00", "23:00")], quiet=[_span("20:00", "21:00")]),
        _row(FRIDAY - timedelta(days=14), quiet=[_span("22:00", "23:00")]),
        _row(FRIDAY - timedelta(days=21), quiet=[_span("22:00", "23:00")], busy=[_span("20:00", "21:00")]),
    ]
    friday = di.aggregate(rows, TODAY).weekdays[4]
    # 22:00-23:00 is busy twice and quiet twice: a tie says nothing.
    assert friday.busy == []
    # 20:00-21:00 is quiet three times and busy once.
    assert [s.out() for s in friday.quiet] == [_span("20:00", "21:00")]


def test_averages_only_count_notes_that_give_a_figure():
    rows = [
        _row(FRIDAY, revenue=Decimal("2000.00"), customers=150),
        _row(FRIDAY - timedelta(days=7), revenue=Decimal("2800.00")),
        _row(FRIDAY - timedelta(days=14)),
        _row(FRIDAY - timedelta(days=21), closed=True, revenue=Decimal("0")),
    ]
    friday = di.aggregate(rows, TODAY).weekdays[4]
    assert friday.avg_revenue == 2400.0 and friday.revenue_notes == 2
    assert friday.avg_customers == 150.0 and friday.customer_notes == 1


def test_the_window_is_twelve_weeks_up_to_today():
    rows = [
        _row(TODAY),
        _row(TODAY - timedelta(days=83)),
        _row(TODAY - timedelta(days=84)),  # the thirteenth week
        _row(TODAY + timedelta(days=1)),  # a note written ahead of the day
    ]
    agg = di.aggregate(rows, TODAY)
    assert agg.notes_read == 2
    assert agg.since == TODAY - timedelta(days=83) and agg.until == TODAY
    assert [w.weekday for w in agg.weekdays] == list(range(7))


def test_recent_events_are_the_last_thirty_days_newest_first_at_most_eight():
    rows = [
        _row(TODAY - timedelta(days=i), events=["evento %d-a" % i, "evento %d-b" % i])
        for i in range(0, 40, 3)
    ]
    agg = di.aggregate(rows, TODAY)
    assert len(agg.recent_events) == di.MAX_RECENT_EVENTS
    assert agg.recent_events[0] == (TODAY, "evento 0-a")
    dates = [d for d, _ in agg.recent_events]
    assert dates == sorted(dates, reverse=True)
    assert all(d >= TODAY - timedelta(days=29) for d in dates)


def test_the_summary_in_words():
    rows = [
        _row(FRIDAY - timedelta(days=7 * i), revenue=Decimal(str(2000 + 400 * i)),
             busy=[_span("22:00", "01:00")], short_staffed=[_span("23:00", "00:00")] if i < 2 else [])
        for i in range(3)
    ] + [_row(FRIDAY, events=["partido del Barça"])]
    lines = di.prose(di.aggregate(rows, TODAY))
    assert lines[0] == (
        "Fridays (4 notes): takings average 2,400 (3 with a figure); usually busy "
        "22:00-01:00 (3 of 4); short-staffed 23:00-00:00 (twice)."
    )
    assert lines[-1] == (
        "What moved demand on recent days, in the manager's words: Fri 18 Sep: partido del Barça."
    )


def test_a_weekday_with_nothing_countable_is_not_mentioned():
    assert di.prose(di.aggregate([_row(FRIDAY), _row(FRIDAY - timedelta(days=7))], TODAY)) == []


# --- 2. what comes back is about the business, never about a person ---------------


def test_events_that_name_someone_or_something_private_are_dropped():
    reading = _reading(
        events=[
            "Partido del Barça",
            "Ana Ruiz llegó tarde",  # a name, as written
            "ana se fue antes",  # the same name in lower case: masked on the way out? no. Dropped here.
            "e1 cerró solo",  # an alias
            "p2 muy lento",
            "Luis de baja",  # a name AND leave
            "Lluvia toda la tarde",
            "Cambio de sueldo en septiembre",  # pay
            "Terraza cerrada por obras en la calle",
            "  partido del barça ",  # the same event twice
            "Domingo de mercadillo",  # a weekday, not Luis Domingo
            "Fiesta privada",
            "Concierto en la plaza",
        ]
    )
    facts = di.clean(reading, NAMES)
    assert facts.events == [
        "Partido del Barça",
        "Lluvia toda la tarde",
        "Terraza cerrada por obras en la calle",
        "Domingo de mercadillo",
        "Fiesta privada",
    ]


def test_a_long_event_is_cut_after_it_is_judged():
    long_tail = "Mucha gente por la feria del barrio y el concierto de la plaza, " * 3 + "Ana"
    facts = di.clean(_reading(events=[long_tail, "x" * 200]), NAMES)
    # The name was past the cut: the whole event goes, not just the tail.
    assert len(facts.events) == 1
    assert len(facts.events[0]) == di.MAX_EVENT_CHARS and facts.events[0].endswith("…")


def test_stretches_and_figures_are_validated_not_trusted():
    facts = di.clean(
        _reading(
            revenue=-50,
            customers=-3,
            busy=["22:00-01:00", "hasta el cierre", "22:00-01:00", "19:00-19:00"],
            quiet=["16-18"],
        ),
        NAMES,
    )
    assert facts.revenue is None and facts.customers is None
    assert facts.busy == [_span("22:00", "01:00")]
    assert facts.quiet == [_span("16:00", "18:00")]
    assert di.clean(_reading(revenue=2e7), NAMES).revenue is None
    assert di.clean(_reading(revenue=2400.456), NAMES).revenue == Decimal("2400.46")


def test_a_reading_of_another_text_is_shown_only_while_its_replacement_is_coming():
    now = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)
    row = SimpleNamespace(
        source_hash=di.body_hash("Caja 2.400."),
        revenue=Decimal("2400.00"),
        customers=None,
        closed=False,
        busy=[],
        quiet=[],
        short_staffed=[],
        over_staffed=[],
        events=[],
    )
    just_saved = now - timedelta(seconds=5)
    # The reading of this very text.
    assert di.insight_for("Caja 2.400.", just_saved, row, True, now)["pending"] is False
    # Edited, and a new reading is on its way: the old one, flagged.
    edited = di.insight_for("Caja 1.200.", just_saved, row, True, now)
    assert edited["pending"] is True and edited["revenue"] == 2400.0
    # Edited, and nothing is coming (no key, learning off, over budget) or it
    # never came: not shown at all.
    assert di.insight_for("Caja 1.200.", just_saved, row, False, now) is None
    assert di.insight_for("Caja 1.200.", now - timedelta(hours=1), row, True, now) is None
    # Never read, and nothing coming.
    assert di.insight_for("Caja 1.200.", just_saved, None, False, now) is None


class FakeClient:
    """Stands in for the SDK. Records what it was sent, answers `reading`."""

    def __init__(self, reading=None, on_call=None, fail=None):
        self.sent = []
        self.reading = reading if reading is not None else _reading(busy=["22:00-01:00"])
        self.on_call = on_call
        self.fail = fail
        self.messages = self

    def parse(self, **kw):
        self.sent.append(kw)
        if self.on_call is not None:
            self.on_call()
        if self.fail is not None:
            raise self.fail
        return SimpleNamespace(
            parsed_output=self.reading,
            usage=SimpleNamespace(input_tokens=300, output_tokens=60),
        )

    def text(self):
        return "\n".join(kw["messages"][0]["content"] for kw in self.sent)


def test_the_note_leaves_with_every_name_masked(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(di, "_client", lambda key: fake)
    got = di.read_note(
        "Ana Ruiz cerró con Luis. Mucha gente de 22 a 1, el domingo hay mercadillo.",
        FRIDAY,
        NAMES,
        "test-key",
    )
    assert got is not None
    sent = fake.text()
    for real in ("Ana", "Ruiz", "Luis", ANA, LUIS):
        assert real not in sent
    assert "Mucha gente de 22 a 1" in sent and "domingo" in sent
    assert "2026-09-18 (Friday)" in sent
    [kw] = fake.sent
    assert kw["model"] == "claude-haiku-4-5"
    assert kw["output_format"] is DayReading
    assert "thinking" not in kw


def test_a_failure_is_none_and_the_call_is_metered(monkeypatch):
    monkeypatch.setattr(di, "_client", lambda key: FakeClient(fail=RuntimeError("down")))
    assert di.read_note("x", FRIDAY, NAMES, "test-key") is None

    monkeypatch.setattr(di, "_client", lambda key: FakeClient())
    with api_usage.collect() as ledger:
        di.read_note("x", FRIDAY, NAMES, "test-key")
    assert [(e.purpose, e.model, e.input_tokens) for e in ledger.entries] == [
        ("day_notes.read", "claude-haiku-4-5", 300)
    ]
    # No key, or nothing written: nothing is asked.
    monkeypatch.setattr(di, "_client", lambda key: pytest.fail("must not be called"))
    assert di.read_note("x", FRIDAY, NAMES, "") is None
    assert di.read_note("   ", FRIDAY, NAMES, "test-key") is None


# --- 3. where it sits in the prompts -------------------------------------------------


FACTS = ["Fridays (4 notes): usually busy 22:00-01:00 (3 of 4)."]


def _profile(**kw):
    profile = BusinessProfile(org_id=uuid.uuid4())
    profile.learning_enabled = True
    for k, v in kw.items():
        setattr(profile, k, v)
    return profile


def test_planning_context_puts_the_notes_below_the_manager_and_above_the_rest():
    profile = _profile(house_notes="Terraza en verano.", research_notes="Los bares llenan en agosto.")
    text = bp.planning_context(profile, [], ["Los viernes hacen falta tres."], FACTS)
    said = text.index("The manager describes it")
    notes = text.index("DAY NOTES")
    noticed = text.index("What the planner has NOTICED")
    looked = text.index("What WE looked up")
    assert said < notes < noticed < looked
    assert "- " + FACTS[0] in text
    assert "nobody has checked our reading" in text
    assert "what the manager said outranks what their day notes add up to" in text


def test_without_facts_the_context_is_what_it_was():
    profile = _profile(house_notes="Terraza en verano.")
    assert "DAY NOTES" not in bp.planning_context(profile, [])
    assert bp.planning_context(profile, [], (), []) == bp.planning_context(profile, [])
    assert bp.model_context(profile, [], []) == bp.model_context(profile, [])


def test_the_facts_alone_are_enough_to_say_something_and_learning_off_says_nothing():
    assert "DAY NOTES" in bp.planning_context(_profile(), [], (), FACTS)
    off = _profile(learning_enabled=False)
    assert bp.planning_context(off, [], (), FACTS) == ""
    assert bp.model_context(off, [], FACTS) == ""


def test_the_intake_is_told_what_the_notes_are_for():
    text = bp.model_context(_profile(research_notes="Algo de internet."), [], FACTS)
    assert text.index("DAY NOTES") < text.index("What WE looked up")
    assert "only to resolve what the brief says vaguely" in text
    assert "NOT a requirement" in text


# --- 4. against the database -----------------------------------------------------------


from tests.test_day_notes import _put, _staff  # noqa: E402
from tests.test_draft_on_the_server import (  # noqa: E402,F401 - fixtures by name
    _add,
    _auth,
    _signup,
    client,
    skip_no_db,
)
from tests.test_hand_edits import _as_tenant  # noqa: E402


@pytest.fixture
def key_on(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key-never-sent")


def _use(monkeypatch, fake):
    monkeypatch.setattr(di, "_client", lambda key: fake)


def _no_model(monkeypatch):
    def refuse(key):
        raise AssertionError("the model must not be called")

    monkeypatch.setattr(di, "_client", refuse)


def _rows(org_id):
    from sqlalchemy import select

    from app.models.day_note import DayNoteInsight

    def read(db):
        # Plain values: the session is gone by the time the test looks.
        return [
            SimpleNamespace(**{c.key: getattr(r, c.key) for c in DayNoteInsight.__table__.columns})
            for r in db.execute(select(DayNoteInsight)).scalars()
        ]

    return _as_tenant(org_id, read)


def _set_body(org_id, day, body):
    from sqlalchemy import update

    from app.models.day_note import DayNote

    def work(db):
        db.execute(
            update(DayNote)
            .where(DayNote.org_id == org_id)
            .where(DayNote.note_date == day)
            .values(body=body)
        )

    _as_tenant(org_id, work)


def _last(weekday: int) -> date:
    today = di.business_today()
    return today - timedelta(days=(today.weekday() - weekday) % 7)


NIGHT = "Mucha gente de 22 a 1, caja 2.400. Faltó uno en barra de 23 a 0. Partido del Barça."
NIGHT_READING = _reading(
    revenue=2400,
    busy=["22:00-01:00"],
    short_staffed=["23:00-00:00"],
    events=["Partido del Barça"],
)


@skip_no_db
class TestRefresh:
    def test_saving_reads_the_note_once_and_names_nobody(self, client, monkeypatch, key_on):
        token, org_id = _signup(client)
        _add(client, token, "Ana Ruiz")
        fake = FakeClient(NIGHT_READING)
        _use(monkeypatch, fake)
        day = _last(4)
        res = _put(client, token, day.isoformat(), "Ana Ruiz cerró. " + NIGHT)
        assert res.status_code == 200, res.text
        # The reading goes in the background; the response says it is coming.
        assert res.json()["insight"]["pending"] is True

        assert len(fake.sent) == 1
        assert "Ana" not in fake.text() and "Ruiz" not in fake.text()
        [row] = _rows(org_id)
        assert row.revenue == Decimal("2400.00")
        assert row.busy == [_span("22:00", "01:00")]
        assert row.events == ["Partido del Barça"]
        assert row.model == "claude-haiku-4-5"

        # Metered for this business, under its own purpose.
        from sqlalchemy import select

        from app.models.api_usage import ApiUsage

        purposes = _as_tenant(org_id, lambda db: list(db.execute(select(ApiUsage.purpose)).scalars()))
        assert purposes == ["day_notes.read"]

        # The same words again: nothing to read, nothing asked.
        _no_model(monkeypatch)
        again = _put(client, token, day.isoformat(), "Ana Ruiz cerró. " + NIGHT, send=True)
        assert again.json()["insight"]["pending"] is False
        di.refresh(uuid.UUID(org_id), day)

    def test_an_edited_note_is_read_again_and_its_reading_replaced(
        self, client, monkeypatch, key_on
    ):
        token, org_id = _signup(client)
        day = _last(5).isoformat()
        _use(monkeypatch, FakeClient(NIGHT_READING))
        _put(client, token, day, NIGHT)
        quiet = FakeClient(_reading(quiet=["19:00-23:00"], events=["Lluvia"]))
        _use(monkeypatch, quiet)
        res = _put(client, token, day, "Llovió, vacío de 19 a 23.")
        assert res.json()["insight"]["pending"] is True
        assert len(quiet.sent) == 1
        [row] = _rows(org_id)
        assert row.revenue is None and row.busy == []
        assert row.quiet == [_span("19:00", "23:00")] and row.events == ["Lluvia"]
        assert row.source_hash == di.body_hash("Llovió, vacío de 19 a 23.")

    def test_three_saves_in_a_row_are_one_reading_of_the_last_text(
        self, client, monkeypatch, key_on
    ):
        watched = Timers(immediate=False)
        monkeypatch.setattr(di, "_new_timer", watched)
        fake = FakeClient(NIGHT_READING)
        _use(monkeypatch, fake)
        token, org_id = _signup(client)
        day = _last(4).isoformat()
        for body in ("Mucha gente", "Mucha gente de 22 a 1", NIGHT):
            assert _put(client, token, day, body).json()["insight"]["pending"] is True

        # Three saves armed three timers; each one cancelled the one before.
        assert len(watched.made) == 3
        [live] = watched.live()
        assert live is watched.made[-1]
        assert live.interval == di.QUIET_SECONDS and live.daemon is True
        assert fake.sent == [], "nothing is read while the manager is still writing"

        live.fire()
        assert len(fake.sent) == 1
        assert NIGHT in fake.text()
        [row] = _rows(org_id)
        assert row.source_hash == di.body_hash(NIGHT)
        # A timer that had already started when it was superseded reads nothing.
        watched.made[0].cancelled = False
        watched.made[0].fire()
        assert len(fake.sent) == 1

    def test_the_real_timer_reads_once_after_the_quiet_period(self, client, monkeypatch, key_on):
        import threading
        import time

        monkeypatch.setattr(di, "_new_timer", threading.Timer)
        monkeypatch.setattr(di, "QUIET_SECONDS", 1.0)
        fake = FakeClient(NIGHT_READING)
        _use(monkeypatch, fake)
        token, org_id = _signup(client)
        day = _last(4).isoformat()
        for body in ("Mucha gente", NIGHT):
            _put(client, token, day, body)
        assert fake.sent == []

        deadline = time.monotonic() + 10
        while not _rows(org_id) and time.monotonic() < deadline:
            time.sleep(0.05)
        time.sleep(0.2)
        assert len(fake.sent) == 1 and NIGHT in fake.text()
        assert (str(org_id), _last(4)) not in di._timers

    def test_learning_off_means_no_call(self, client, monkeypatch, key_on):
        token, org_id = _signup(client)
        off = client.put("/api/v1/profile", headers=_auth(token), json={"learning_enabled": False})
        assert off.status_code == 200, off.text
        _no_model(monkeypatch)
        res = _put(client, token, _last(4).isoformat(), NIGHT)
        assert res.json()["insight"] is None
        di.refresh(uuid.UUID(org_id), _last(4))
        assert _rows(org_id) == []

    def test_no_key_means_no_call(self, client, monkeypatch):
        monkeypatch.setattr(settings, "anthropic_api_key", "")
        token, org_id = _signup(client)
        _no_model(monkeypatch)
        res = _put(client, token, _last(4).isoformat(), NIGHT)
        assert res.json()["insight"] is None
        di.refresh(uuid.UUID(org_id), _last(4))
        assert _rows(org_id) == []

    def test_a_reading_of_a_text_that_changed_meanwhile_is_thrown_away(
        self, client, monkeypatch, key_on
    ):
        token, org_id = _signup(client)
        day = _last(4)
        monkeypatch.setattr(di, "refresh", lambda *a: None)  # save without reading
        _put(client, token, day.isoformat(), NIGHT)
        monkeypatch.setattr(di, "refresh", _real_refresh)

        # The manager edits the note while the model is reading it.
        fake = FakeClient(
            NIGHT_READING,
            on_call=lambda: _set_body(uuid.UUID(org_id), day, "Al final vino poca gente."),
        )
        _use(monkeypatch, fake)
        di.refresh(uuid.UUID(org_id), day)
        assert len(fake.sent) == 1
        assert _rows(org_id) == []

    def test_a_model_that_breaks_leaves_the_note_saved_and_unread(self, client, monkeypatch, key_on):
        token, org_id = _signup(client)
        _use(monkeypatch, FakeClient(fail=RuntimeError("the provider is having a bad day")))
        res = _put(client, token, _last(4).isoformat(), NIGHT)
        assert res.status_code == 200
        assert _rows(org_id) == []


@skip_no_db
class TestApi:
    def test_pending_then_read_then_stale(self, client, monkeypatch, key_on):
        token, org_id = _signup(client)
        day = _last(4).isoformat()
        monkeypatch.setattr(di, "refresh", lambda *a: None)

        # Saved, not read yet: an empty insight that says it is coming.
        saved = _put(client, token, day, NIGHT).json()
        assert saved["insight"] == {
            "revenue": None,
            "customers": None,
            "closed": False,
            "busy": [],
            "quiet": [],
            "short_staffed": [],
            "over_staffed": [],
            "events": [],
            "pending": True,
        }
        listed = client.get("/api/v1/day-notes", headers=_auth(token)).json()
        assert listed[0]["insight"]["pending"] is True

        # Read.
        monkeypatch.setattr(di, "refresh", _real_refresh)
        _use(monkeypatch, FakeClient(NIGHT_READING))
        di.refresh(uuid.UUID(org_id), _last(4))
        got = client.get("/api/v1/day-notes/%s" % day, headers=_auth(token)).json()["insight"]
        assert got["pending"] is False
        assert got["revenue"] == 2400.0
        assert got["busy"] == [_span("22:00", "01:00")]
        assert got["events"] == ["Partido del Barça"]

        # Edited: the old reading is still shown, flagged as being re-read.
        monkeypatch.setattr(di, "refresh", lambda *a: None)
        edited = _put(client, token, day, "Poca gente.").json()["insight"]
        assert edited["pending"] is True and edited["revenue"] == 2400.0

        # A reading that never lands stops being "pending" -- the screen
        # would otherwise poll for ever -- and the old reading goes with it:
        # it is about a text the note no longer says.
        monkeypatch.setattr(di, "PENDING_WINDOW", timedelta(0))
        stale = client.get("/api/v1/day-notes", headers=_auth(token)).json()[0]["insight"]
        assert stale is None

    def test_an_edit_nobody_will_read_is_neither_shown_nor_counted(
        self, client, monkeypatch, key_on
    ):
        from app.services import assistant_tools as tools

        token, org_id = _signup(client)
        org = uuid.UUID(org_id)
        day = _last(4).isoformat()
        _use(monkeypatch, FakeClient(NIGHT_READING))
        _put(client, token, day, NIGHT)
        assert _as_tenant(org, lambda db: di.summary(db, org))["notes_read"] == 1

        # The key goes (or the budget, or learning): the edit cannot be read.
        monkeypatch.setattr(settings, "anthropic_api_key", "")
        edited = _put(client, token, day, "Al final poca gente, caja 1.200.").json()
        assert edited["insight"] is None
        listed = client.get("/api/v1/day-notes", headers=_auth(token)).json()
        assert listed[0]["insight"] is None
        assert len(_rows(org_id)) == 1, "the row is kept; it is just not about this text"

        # And nothing counts it: not the screen's summary, not the planner,
        # not the assistant.
        summary = client.get("/api/v1/day-notes/insights", headers=_auth(token)).json()
        assert summary["notes_read"] == 0
        assert summary["by_weekday"][4]["avg_revenue"] is None
        assert summary["recent_events"] == []
        assert _as_tenant(org, lambda db: di.context_lines(db, org)) == []
        ctx = tools.ToolContext(org_id=org, people=None)
        said = _as_tenant(org, lambda db: tools.get_day_notes_insights(db, ctx, {}))
        assert "No day notes have been read" in said

        # Put the words back and the reading is about them again.
        _put(client, token, day, NIGHT)
        assert _as_tenant(org, lambda db: di.summary(db, org))["notes_read"] == 1

    def test_learning_off_hides_a_reading_of_an_older_text(self, client, monkeypatch, key_on):
        token, org_id = _signup(client)
        day = _last(4).isoformat()
        _use(monkeypatch, FakeClient(NIGHT_READING))
        _put(client, token, day, NIGHT)
        client.put("/api/v1/profile", headers=_auth(token), json={"learning_enabled": False})
        # Unedited: still the manager's to look at.
        got = client.get("/api/v1/day-notes/%s" % day, headers=_auth(token)).json()
        assert got["insight"]["revenue"] == 2400.0
        # Edited with learning off: not read, so not shown.
        _no_model(monkeypatch)
        assert _put(client, token, day, "Poca gente.").json()["insight"] is None

    def test_deleting_the_note_takes_its_reading(self, client, monkeypatch, key_on):
        token, org_id = _signup(client)
        _use(monkeypatch, FakeClient(NIGHT_READING))
        _put(client, token, _last(4).isoformat(), NIGHT)
        assert len(_rows(org_id)) == 1
        assert client.delete("/api/v1/day-notes/%s" % _last(4).isoformat(), headers=_auth(token)).status_code == 204
        assert _rows(org_id) == []

    def test_the_summary_adds_the_fridays_up(self, client, monkeypatch, key_on):
        token, org_id = _signup(client)
        _use(monkeypatch, FakeClient(NIGHT_READING))
        for weeks in (0, 1):
            day = _last(4) - timedelta(days=7 * weeks)
            assert _put(client, token, day.isoformat(), NIGHT + " (%d)" % weeks).status_code == 200

        res = client.get("/api/v1/day-notes/insights", headers=_auth(token))
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["notes_read"] == 2 and body["learning_enabled"] is True
        assert body["since"] == (_last(4) - timedelta(days=7)).isoformat()
        assert [w["weekday"] for w in body["by_weekday"]] == list(range(7))
        friday = body["by_weekday"][4]
        assert friday["notes"] == 2 and friday["avg_revenue"] == 2400.0
        assert friday["revenue_notes"] == 2 and friday["closed"] == 0
        assert friday["busy"] == [_span("22:00", "01:00")]
        assert friday["short_staffed"] == [_span("23:00", "00:00")]
        assert body["by_weekday"][0]["notes"] == 0
        assert body["recent_events"][0] == {"date": _last(4).isoformat(), "text": "Partido del Barça"}

        # And the planner is told, in words.
        lines = _as_tenant(uuid.UUID(org_id), lambda db: di.context_lines(db, uuid.UUID(org_id)))
        assert any(line.startswith("Fridays (2 notes): takings average 2,400") for line in lines)

        # Learning off: still shown to the manager, no longer told to a model.
        client.put("/api/v1/profile", headers=_auth(token), json={"learning_enabled": False})
        body = client.get("/api/v1/day-notes/insights", headers=_auth(token)).json()
        assert body["learning_enabled"] is False and body["notes_read"] == 2
        assert _as_tenant(uuid.UUID(org_id), lambda db: di.context_lines(db, uuid.UUID(org_id))) == []

    def test_only_a_manager_reads_the_summary_and_the_feed_carries_no_reading(
        self, client, monkeypatch, key_on
    ):
        manager, org_id = _signup(client)
        staff, staff_email = _staff(client, manager)
        client.put("/api/v1/day-notes/readers", json={"emails": [staff_email]}, headers=_auth(manager))
        _use(monkeypatch, FakeClient(NIGHT_READING))
        _put(client, manager, _last(4).isoformat(), NIGHT)

        assert client.get("/api/v1/day-notes/insights", headers=_auth(staff)).status_code == 403
        feed = client.get("/api/v1/day-notes/feed", headers=_auth(staff)).json()
        assert feed["can_read"] is True
        assert [n["insight"] for n in feed["notes"]] == [None]
        mine = client.get("/api/v1/day-notes/feed", headers=_auth(manager)).json()
        assert [n["insight"] for n in mine["notes"]] == [None]

    def test_another_business_sees_none_of_it(self, client, monkeypatch, key_on):
        mine, my_org = _signup(client)
        theirs, their_org = _signup(client)
        _use(monkeypatch, FakeClient(NIGHT_READING))
        _put(client, mine, _last(4).isoformat(), NIGHT)
        assert len(_rows(my_org)) == 1

        body = client.get("/api/v1/day-notes/insights", headers=_auth(theirs)).json()
        assert body["notes_read"] == 0 and body["recent_events"] == []
        assert _rows(their_org) == []
        assert _as_tenant(uuid.UUID(their_org), lambda db: di.context_lines(db, uuid.UUID(their_org))) == []

    def test_the_table_is_behind_row_level_security(self):
        from sqlalchemy import text

        from app.db import AdminSessionLocal

        db = AdminSessionLocal()
        try:
            row = db.execute(
                text(
                    "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                    "WHERE relname = 'day_note_insight'"
                )
            ).one()
        finally:
            db.close()
        assert row[0] and row[1]


_real_refresh = di.refresh


@skip_no_db
def test_the_assistant_reads_the_summary_in_words(client, monkeypatch, key_on):
    from app.services import assistant_tools as tools

    token, org_id = _signup(client)
    _use(monkeypatch, FakeClient(NIGHT_READING))
    for weeks in (0, 1):
        _put(client, token, (_last(4) - timedelta(days=7 * weeks)).isoformat(), NIGHT + str(weeks))
    ctx = tools.ToolContext(org_id=uuid.UUID(org_id), people=None)
    text = _as_tenant(uuid.UUID(org_id), lambda db: tools.get_day_notes_insights(db, ctx, {}))
    assert "Fridays (2 notes)" in text and "nobody has checked" in text

    client.put("/api/v1/profile", headers=_auth(token), json={"learning_enabled": False})
    text = _as_tenant(uuid.UUID(org_id), lambda db: tools.get_day_notes_insights(db, ctx, {}))
    assert "switched learning off" in text
