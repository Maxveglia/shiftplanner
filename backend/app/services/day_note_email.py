from __future__ import annotations

"""The email a reader gets when the manager sends a day's notes.

Plain text and in Spanish, for the same reasons as `rota_email`: it is read on
a phone, and the server writes it for somebody who is not here to be asked
which language they read.
"""

from datetime import date
from typing import List

from app.services.mailer import Message

_DAYS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
_MONTHS = (
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)


def spoken_date(day: date) -> str:
    """"jueves 24 de septiembre de 2026"."""
    return "%s %d de %s de %d" % (
        _DAYS[day.weekday()],
        day.day,
        _MONTHS[day.month - 1],
        day.year,
    )


def compose(
    note_date: date,
    body: str,
    recipients: List[str],
    org_name: str,
    app_base_url: str,
) -> List[Message]:
    when = spoken_date(note_date)
    subject = "Notas del %s" % when
    if org_name:
        subject = "%s · %s" % (org_name, subject)
    lines = ["Notas del %s" % when, "", body, ""]
    if app_base_url:
        lines += ["Todas las notas: %s" % app_base_url.rstrip("/"), ""]
    lines.append(
        "Te llega porque el responsable de %s te ha dado acceso a sus notas del día."
        % (org_name or "este negocio")
    )
    text = "\n".join(lines)
    return [Message(to=email, subject=subject, text=text) for email in recipients]
