from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas import limits


class ShiftIn(BaseModel):
    """One shift as the manager's draft holds it, ready to be published."""

    employee_id: uuid.UUID
    start_at: datetime
    end_at: datetime
    shift_template_id: Optional[uuid.UUID] = None
    unpaid_break_minutes: int = 0
    # 'ai' when the generator placed it, 'manual' when the manager did.
    source: str = Field(default="manual", max_length=limits.CODE)
    is_overtime: bool = False
    is_premium: bool = False
    computed_cost: Optional[float] = None


class PublishIn(BaseModel):
    """Publish the schedule for a window.

    The window is explicit and the operation is a REPLACE: every shift that
    STARTS inside it is dropped and these take their place. That way what the
    team sees is exactly what the manager last approved -- a shift removed from
    the draft disappears for the employee too, instead of lingering -- while an
    overnight shift from the period before, which merely runs into this one,
    is left alone.
    """

    period_start: datetime
    period_end: datetime
    # One element here is one row inserted, so the list IS the write. Without a
    # ceiling a single request is a table filled, which is why this one is not
    # merely a sanity check: 50 people x 31 days x 3 shifts a day = 4,650,
    # rounded to 5,000. A site running split shifts uses two of those three;
    # nothing legitimate uses all of them every day of a month.
    shifts: List[ShiftIn] = Field(max_length=limits.SHIFTS)


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_id: uuid.UUID
    start_at: datetime
    end_at: datetime
    shift_template_id: Optional[uuid.UUID] = None
    unpaid_break_minutes: int = 0
    status: str
    source: str
    is_overtime: bool = False
    is_premium: bool = False
    published_at: Optional[datetime] = None


class PublishOut(BaseModel):
    published: int
    replaced: int
    published_at: datetime

    # Who was told. `notified` counts messages HANDED TO the mail provider, not
    # messages read -- the send happens after this response and only the
    # provider knows the rest.
    #
    # `unreachable` is the one a manager acts on: people whose shifts changed
    # and who will not hear it from us, because they have no login, no address
    # on it, or turned the email off. It is also whoever changed when no mail
    # provider is configured at all, which is the honest answer rather than a
    # silent zero -- a manager who believes the team was told and was not is
    # worse off than one who knows to pick up a phone.
    notified: int = 0
    unreachable: int = 0

    # Shifts the publish REFUSED, because the person has approved time off
    # covering them. They are dropped rather than rejected: a manager who
    # signed the holiday off last week must not be stopped from publishing the
    # month over a shift they can no longer see the point of -- but they are
    # told, because those hours are now uncovered.
    skipped_on_leave: int = 0

    # Whether there is a mail provider at all. Without it `unreachable` is
    # everybody who changed, and the reason is not the one the other counts
    # imply: nobody is missing a login or has switched anything off, the
    # channel is simply not plugged in yet. A screen that cannot tell those
    # apart sends a manager looking for a fault in their roster.
    mail_configured: bool = False


class DraftOut(BaseModel):
    """What PUT /schedule/draft did: how many shifts it holds now, and when."""

    saved: int
    replaced: int
    saved_at: datetime


class ShiftMarkOut(BaseModel):
    """One shift, reduced to the two things a calendar needs to colour a day.

    Deliberately NOT a day summary. Which local day a shift belongs to is
    decided in the browser (`fromAssignmentOut` in lib/schedule/persist), from
    the instant and the viewer's own clock, and this organization has no
    timezone of its own on record -- so a server that grouped these into days
    would have to invent one, and would become a second answer to "what day is
    this shift on". The day a rota is read by and the day a dot is drawn on
    must be the same day.

    Two fields because that is all it takes: 365 coloured squares from a
    year's shifts costs a few tens of kilobytes here, against megabytes of
    full assignments.
    """

    start_at: datetime
    status: str


class TeammateShiftOut(BaseModel):
    """One shift on a day, as a COLLEAGUE may see it.

    The shape is the whole privacy decision, so it is worth reading as a list
    of what is missing. There is no cost, no contract, no weekly hours, no
    employee code, no absence and no reason for one. An employee opening their
    own shift is answering "who am I on with?", and everything above answers a
    different question that belongs to the manager.

    Two of those omissions are not merely tidiness. Weekly hours carry the
    "short of contract" warning, which is a conversation between one person and
    their manager; and an absence can be of a type the org marked
    ``is_health_data``, which exists precisely so it does not travel.

    What cannot be filtered out downstream is what was never sent.
    """

    model_config = ConfigDict(from_attributes=True)

    employee_id: uuid.UUID
    employee_name: str
    start_at: datetime
    end_at: datetime
    unpaid_break_minutes: int = 0
    #: Which row is the reader's own, so the grid can mark it.
    is_self: bool = False
