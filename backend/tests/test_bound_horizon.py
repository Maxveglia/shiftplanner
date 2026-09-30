from __future__ import annotations

"""How many months a brief plans is the SENTENCE's to say, not the model's.

"Hazlo para octubre" came back from the intake as three months (19-sep-2026):
October, November and December planned and paid for. `bound_horizon` cuts a
span the sentence cannot account for back to the one month it named -- and
since then ONE month is the default and a longer span has to be said in the
brief. Most of these tests are about when it must NOT cut, because a wrong cut
drops months the manager asked for. Pure functions: no database, no network.
"""

import pytest

from app.services.intake import bound_horizon

THE_BRIEF = (
    "Tengo un bar en barcelona que abre lunes, martes, miércoles, jueves, viernes "
    "de 17:00 a 03:00, y sábado, domingo de 17:00 a 04:00. Somos 6 personas en "
    "total, y el mínimo necesario trabajando al mismo tiempo es 2. El equipo está "
    "formado por max con 40 horas, enzo con 40 horas, Alberto con 40 horas, Arnau "
    "con 40 horas, luka con 20 horas y diego con 16 horas. hazlo para octubre."
)


def test_the_brief_that_started_it_plans_october_only():
    assert bound_horizon("2026-10:3", THE_BRIEF) == "2026-10"


@pytest.mark.parametrize(
    "text",
    [
        "Turnos para octubre, abrimos desde las 17:00 hasta las 03:00.",
        "The rota for October, open from 5pm until 3am.",
        "El horari d'octubre, obrim de 17:00 a 03:00.",
    ],
)
def test_opening_hours_are_not_a_range_of_months(text):
    """"Desde/hasta/from/until" are in every brief because of the hours."""
    assert bound_horizon("2026-10:2", text) == "2026-10"


@pytest.mark.parametrize(
    "text",
    [
        "Hazlo para octubre y noviembre.",
        "Los próximos tres meses empezando en octubre.",
        "El último trimestre, empezando en octubre.",
        "Desde octubre hasta diciembre.",
        "A partir de octubre.",
        "From October onwards, six people.",
        "Octubre durante 8 semanas.",
        "Octubre y lo que queda de año.",
        "Para octubre, que es temporada alta.",
        "Octubre hasta Navidad.",
    ],
)
def test_anything_that_could_mean_a_length_is_left_alone(text):
    assert bound_horizon("2026-10:3", text) == "2026-10:3"


def test_a_month_the_model_did_not_start_from_is_still_one_month():
    """Which month is not settled here, but how many is: one."""
    assert bound_horizon("2026-11:2", "hazlo para octubre") == "2026-11"


@pytest.mark.parametrize(
    "text",
    [
        "Haz el calendario.",
        "Somos 6 personas y el mínimo trabajando a la vez es 2.",
        "Make the rota, open 5pm until 3am.",
        "Hazlo para el mes que viene.",
    ],
)
def test_a_brief_that_names_no_length_plans_one_month(text):
    """Naming no month at all used to leave the span to the model."""
    assert bound_horizon("2026-10:3", text) == "2026-10"


def test_a_bare_count_nobody_asked_for_becomes_one():
    assert bound_horizon("3", "Haz el calendario.") == "1"


def test_a_bare_count_that_was_asked_for_stays():
    assert bound_horizon("3", "Los próximos tres meses.") == "3"


@pytest.mark.parametrize("horizon", [None, "", "1", "2026-10", "rubbish"])
def test_what_is_not_a_span_passes_through(horizon):
    assert bound_horizon(horizon, "hazlo para octubre") == horizon


def test_mayoria_is_not_may():
    """Whole words only: "mayoría" must not read as a second month."""
    assert bound_horizon("2026-10:3", "Octubre, la mayoría de noches 2 personas.") == "2026-10"
