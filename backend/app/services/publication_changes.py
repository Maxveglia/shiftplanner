from __future__ import annotations

"""What changed for each person when a rota was published.

Publishing replaces a window wholesale (`_replace_window`), so the raw facts
are two lists: what was on the noticeboard before, and what is on it now. That
is enough to say "the rota changed" and not nearly enough to tell somebody
anything useful. The difference between

    "El horario de octubre ha cambiado"
    "El martes 7 entras a las 12:00 en vez de a las 17:00"

is the whole value of sending a message at all: the first one is noise by the
second month, and the second one is the reason nobody turns up five hours late.

So this module turns the two lists into per-person, per-day changes, and it is
a PURE function of them -- no session, no models, no I/O -- because it is the
one piece the email, the PDF and the push notification all need, and because
the pairing rules below are exactly the kind of thing that deserves tests
rather than trust.

WHAT COUNTS AS THE SAME SHIFT is not this module's opinion: it is
``_shift_identity`` in `schedule.py`, the same rule that decides whether a
shift keeps its art. 34.2 notice. Person, start, end, unpaid break. Two shifts
that match on all four are the same shift and nothing happened to them, even
if the row was deleted and reinserted -- which, under delete-then-insert, it
always was.

PAIRING, and why it is per day. A shift whose hours moved shows up here as one
removal and one addition. Reported as two facts it reads like the person lost a
shift and gained another, which is alarming and false; paired, it reads as a
change, which is what it is. Shifts are paired only WITHIN the same person and
the same business day, in time order. A shift moved to a different day is left
as two facts on purpose -- "Tuesday is off" and "Wednesday you start at 12:00"
is how the person will actually plan their week, and inventing an arrow between
two days would say less, not more.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from uuid import UUID

from app.services.business_time import business_day


@dataclass(frozen=True)
class ShiftFact:
    """One shift, reduced to what an announcement has to say about it."""

    employee_id: UUID
    start_at: datetime
    end_at: datetime
    unpaid_break_minutes: int

    @property
    def identity(self) -> tuple:
        """The same four things `_shift_identity` compares. See the module docstring."""
        return (
            str(self.employee_id),
            self.start_at,
            self.end_at,
            self.unpaid_break_minutes,
        )


@dataclass(frozen=True)
class DayChange:
    """What happened to one person on one day.

    ``before`` and ``after`` are never both None. Both set means the shift
    moved; only ``after`` means it was added; only ``before`` means it is gone.
    """

    day: date
    before: Optional[ShiftFact]
    after: Optional[ShiftFact]

    @property
    def kind(self) -> str:
        if self.before is None:
            return "added"
        if self.after is None:
            return "removed"
        return "moved"


@dataclass(frozen=True)
class EmployeeChanges:
    """Everything one person needs to be told about this publication."""

    employee_id: UUID
    days: List[DayChange]


@dataclass(frozen=True)
class PublicationChanges:
    """The whole publication, per person.

    ``first_publication`` means nothing was on the noticeboard for this window
    before. It is not the same as "everything is an addition", even though the
    changes look identical: the message owed is different. The first time, the
    person is being handed their rota; every time after, they are being told
    what moved, and being handed the whole month again would bury it.
    """

    first_publication: bool
    employees: List[EmployeeChanges]

    @property
    def is_empty(self) -> bool:
        return not self.employees


def _bucket(facts: Iterable[ShiftFact]) -> Dict[Tuple[UUID, date], List[ShiftFact]]:
    out: Dict[Tuple[UUID, date], List[ShiftFact]] = {}
    for fact in facts:
        out.setdefault((fact.employee_id, business_day(fact.start_at)), []).append(fact)
    return out


def changes_between(
    before: Sequence[ShiftFact],
    after: Sequence[ShiftFact],
) -> PublicationChanges:
    """Per-person changes between two states of one window's rota.

    ``before`` is what was PUBLISHED in the window (drafts were never announced,
    so they are not a "before" anybody can have read). ``after`` is what is
    being published now.
    """
    # Identical shifts cancel first, so that a day where one of three shifts
    # moved reports one change and not three.
    #
    # COUNTED, not set-subtracted. A person can hold two genuinely identical
    # shifts on one day -- the same split shift entered twice by hand -- and
    # losing one of them is a change that a set difference would hide. The
    # intersection of the two counters is how many of each survive untouched;
    # everything beyond that budget, on either side, is news.
    survivors = Counter(f.identity for f in before) & Counter(
        f.identity for f in after
    )

    def _news(facts: Sequence[ShiftFact]) -> List[ShiftFact]:
        budget = Counter(survivors)
        out: List[ShiftFact] = []
        for fact in facts:
            if budget[fact.identity] > 0:
                budget[fact.identity] -= 1
                continue
            out.append(fact)
        return out

    removed = _news(before)
    added = _news(after)

    removed_by_day = _bucket(removed)
    added_by_day = _bucket(added)

    per_employee: Dict[UUID, List[DayChange]] = {}
    for key in sorted(
        set(removed_by_day) | set(added_by_day), key=lambda k: (str(k[0]), k[1])
    ):
        employee_id, day = key
        outs = sorted(removed_by_day.get(key, []), key=lambda f: f.start_at)
        ins = sorted(added_by_day.get(key, []), key=lambda f: f.start_at)
        for index in range(max(len(outs), len(ins))):
            per_employee.setdefault(employee_id, []).append(
                DayChange(
                    day=day,
                    before=outs[index] if index < len(outs) else None,
                    after=ins[index] if index < len(ins) else None,
                )
            )

    employees = [
        EmployeeChanges(
            employee_id=employee_id,
            days=sorted(days, key=lambda c: (c.day, (c.after or c.before).start_at)),
        )
        for employee_id, days in per_employee.items()
    ]
    employees.sort(key=lambda e: str(e.employee_id))

    return PublicationChanges(
        first_publication=not before,
        employees=employees,
    )
