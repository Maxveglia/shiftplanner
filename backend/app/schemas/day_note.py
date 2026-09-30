from __future__ import annotations

import re
from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas import limits

# Deliberately loose: one "@", something either side, a dot in the domain. The
# provider is the real judge of an address; this only stops a typo from being
# stored as a reader.
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class DayNoteIn(BaseModel):
    body: str = Field(max_length=limits.NOTES)
    # Email the saved note to every reader, now.
    send: bool = False

    @field_validator("body")
    @classmethod
    def _body(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("body must not be blank")
        return v


class Stretch(BaseModel):
    """A stretch of the business's day. `end <= start` runs past midnight."""

    start: str
    end: str


class DayInsightOut(BaseModel):
    """What the small model understood of ONE note (services/day_insights.py).

    Facts about the business only. `pending` is true while a reading of the
    note as it stands now is on its way: what is shown meanwhile is the reading
    of an earlier version, or nothing.
    """

    revenue: Optional[float] = None
    customers: Optional[int] = None
    closed: bool = False
    busy: List[Stretch] = []
    quiet: List[Stretch] = []
    short_staffed: List[Stretch] = []
    over_staffed: List[Stretch] = []
    events: List[str] = []
    pending: bool = False


class DayNoteOut(BaseModel):
    note_date: date
    body: str
    updated_at: datetime
    sent_at: Optional[datetime] = None
    # Null when the note was never read (learning off, no key) and always in
    # the employees' feed, which is the note and nothing we made of it.
    insight: Optional[DayInsightOut] = None


class DayNoteSaved(DayNoteOut):
    # What happened to the email, when one was asked for. `emailed` counts
    # messages HANDED to the provider, not messages read; with no provider
    # configured it is 0 and `mail_configured` says why.
    emailed: int = 0
    mail_configured: bool = False


class DayNoteReadersIn(BaseModel):
    emails: List[str] = Field(max_length=limits.DAY_NOTE_READERS)

    @field_validator("emails")
    @classmethod
    def _emails(cls, v: List[str]) -> List[str]:
        out: List[str] = []
        for raw in v:
            email = raw.strip().lower()
            if not email:
                continue
            if len(email) > limits.EMAIL or not _EMAIL.match(email):
                raise ValueError("invalid email: %s" % raw.strip()[:80])
            if email not in out:
                out.append(email)
        return out


class DayNoteReaderOut(BaseModel):
    email: str
    # This address is a login in this business, so it reads the notes in the
    # app as well as by email.
    has_login: bool


class DayNoteReadersOut(BaseModel):
    readers: List[DayNoteReaderOut]
    mail_configured: bool


class DayNoteFeed(BaseModel):
    """What a reader sees: the notes, or that they have not been given access."""

    can_read: bool
    notes: List[DayNoteOut]


class WeekdayInsight(BaseModel):
    weekday: int  # 0 = Monday ... 6 = Sunday
    notes: int
    avg_revenue: Optional[float] = None
    revenue_notes: int = 0
    avg_customers: Optional[float] = None
    busy: List[Stretch] = []
    quiet: List[Stretch] = []
    short_staffed: List[Stretch] = []
    over_staffed: List[Stretch] = []
    closed: int = 0


class DatedEvent(BaseModel):
    # "YYYY-MM-DD". A string, not a `date`: a field called `date` annotated
    # `date` is one pydantic resolves against itself.
    date: str
    text: str


class InsightSummary(BaseModel):
    """What the notes of the last twelve weeks add up to, by day of the week.

    Counted, not written by a model -- see `day_insights.aggregate`.
    """

    notes_read: int
    since: Optional[date] = None
    until: Optional[date] = None
    by_weekday: List[WeekdayInsight]
    recent_events: List[DatedEvent]
    learning_enabled: bool
