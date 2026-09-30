from __future__ import annotations

from decimal import Decimal
from typing import List, Tuple
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.vacation_ledger import VacationLedger


def get_ledger(
    db: Session, org_id: UUID, employee_id: UUID
) -> List[VacationLedger]:
    return list(
        db.execute(
            select(VacationLedger)
            .where(VacationLedger.org_id == org_id)
            .where(VacationLedger.employee_id == employee_id)
            .order_by(
                VacationLedger.effective_date.asc(),
                VacationLedger.created_at.asc(),
            )
        ).scalars()
    )


def compute_balance(
    db: Session, org_id: UUID, employee_id: UUID
) -> Tuple[float, List[VacationLedger]]:
    """Balance is simply the signed sum of every ledger movement.

    Consumption / expiration movements are stored as NEGATIVE day amounts so
    that a plain SUM yields the current balance.
    """
    ledger = get_ledger(db, org_id, employee_id)
    total = sum((row.days for row in ledger), Decimal("0"))
    return float(total), ledger
