from __future__ import annotations

"""Who is on the roster, and what number they are.

Two different notions of "ID", deliberately kept apart:

* ``employee.id`` (UUID) -- the stable identity. Contracts, absences, ledger
  movements and shifts all reference this. It NEVER changes, so history stays
  correct even when people leave.
* ``display_number`` -- the 1..N position a manager sees. Always contiguous:
  delete someone and the rest close the gap automatically. It is derived at
  read time and stored nowhere.

``external_id`` is the human-facing code (EMP-001). It is auto-assigned on
create, but a manager may always type their own.

Removal is a mark on the row (``deleted_at``), not the row's disappearance, so
that it can be undone. ``LIVE`` and ``live_ids`` below are the ONLY place that
rule is written down; every read in the product goes through one of them. A
query that spells the condition out for itself is a query that can be written
without it, and a removed employee showing up in a rota or in a back-office
count is worse than the awkward button this replaced.
"""

import re
from typing import List, Optional
from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.employee import Employee

CODE_RE = re.compile(r"^EMP-(\d+)$")

# "This person is still on the roster." Added to the organization filter, never
# instead of it: tenant isolation and removal are two independent conditions and
# collapsing them into one expression is how one of them goes missing.
LIVE = Employee.deleted_at.is_(None)


def live_ids(org_id: UUID) -> Select:
    """Sub-select of the ids of everyone still on this org's roster.

    For the tables that hang off an employee -- absences, published shifts. A
    hard delete used to take their rows with it (ON DELETE CASCADE), so hiding
    them behind this is what keeps a soft delete looking like the delete it
    replaced, instead of leaving a removed person standing in next week's rota.
    """
    return select(Employee.id).where(Employee.org_id == org_id).where(LIVE)


def next_external_id(db: Session, org_id: UUID) -> str:
    """Lowest unused EMP-### code for the org, so gaps get reused.

    Deliberately NOT filtered by ``LIVE`` -- the one read in this module that
    is not. A removed employee keeps its row and therefore keeps its code, and
    ``uq_employee_org_external`` still applies to it: handing EMP-003 to a new
    hire because its holder was removed would fail on insert, and would make
    the removal impossible to undo even if it did not. A code is released only
    when the row is really gone.
    """
    rows = db.execute(
        select(Employee.external_id).where(Employee.org_id == org_id)
    ).scalars()
    used = set()
    for code in rows:
        match = CODE_RE.match(code or "")
        if match:
            used.add(int(match.group(1)))
    n = 1
    while n in used:
        n += 1
    return "EMP-%03d" % n


def roster_ordered(db: Session, org_id: UUID) -> List[Employee]:
    """The org roster in stable display order (oldest first).

    Removed people are not on it, which is what keeps ``display_number``
    contiguous: the numbers are positions in THIS list, so dropping somebody
    out of it closes the gap exactly as erasing the row used to.
    """
    return list(
        db.execute(
            select(Employee)
            .where(Employee.org_id == org_id)
            .where(LIVE)
            .order_by(Employee.created_at.asc(), Employee.id.asc())
        ).scalars()
    )


def names_by_id(db: Session, org_id: UUID) -> dict:
    """Every name this org has on file, keyed by the id it belongs to.

    Read for ONE purpose: ``services/id_alias.py`` needs to know what the
    people in a planning context are called in order to keep those names off
    the wire. Nothing displays this.

    Deliberately NOT filtered by ``LIVE``, and the second read in the product
    that is not. A planning context is composed in the browser and can outlive
    a removal by minutes -- a job sitting in the queue by much more -- so a
    roster that forgets somebody the moment they are removed is a roster that
    lets their name through on exactly the request that still mentions them.
    Masking a name nobody asked about costs nothing; missing one is the bug.
    """
    rows = db.execute(
        select(Employee.id, Employee.full_name).where(Employee.org_id == org_id)
    ).all()
    return {str(row[0]): row[1] for row in rows if row[1]}


def display_numbers(db: Session, org_id: UUID) -> dict:
    """Map employee id -> contiguous 1..N position."""
    return {e.id: i + 1 for i, e in enumerate(roster_ordered(db, org_id))}


def resolve_external_id(
    db: Session, org_id: UUID, requested: Optional[str]
) -> str:
    """Use the manager's code when given, otherwise assign the next one."""
    code = (requested or "").strip()
    return code if code else next_external_id(db, org_id)
