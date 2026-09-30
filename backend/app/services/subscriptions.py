from __future__ import annotations

"""Commercial state of an organization: created at signup, edited by the operator.

Kept apart from ``services/seeding`` on purpose. Seeding fills a new tenant
with defaults it can change freely (shift templates, absence types); the
subscription is the one row about a tenant that the tenant must never be able
to write. It is created and updated exclusively through the admin session.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.subscription import Subscription
from app.schemas.backoffice import SubscriptionUpdateIn
from app.schemas.enums import Plan, SubscriptionStatus


def start_trial(
    db: Session, org_id: UUID, *, today: Optional[date] = None
) -> Subscription:
    """Give a brand-new organization its trial. Idempotent.

    Every organization gets a subscription row the moment it exists, even
    though it is not paying yet. Without it, "customers" and "orgs that happen
    to have a subscription row" would be two different populations and every
    count in the back office would depend on which one you asked for.
    """
    existing = db.execute(
        select(Subscription).where(Subscription.org_id == org_id)
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    today = today or datetime.now(timezone.utc).date()
    sub = Subscription(
        org_id=org_id,
        plan=Plan.trial.value,
        status=SubscriptionStatus.trialing.value,
        trial_ends_at=today + timedelta(days=settings.trial_period_days),
    )
    db.add(sub)
    return sub


def apply_update(sub: Subscription, payload: SubscriptionUpdateIn) -> Subscription:
    """Apply an operator's change, stamping the lifecycle timestamps.

    ``activated_at`` is set only on the *first* activation, so a customer who
    lapses and comes back still counts as one conversion in the month they
    first converted. ``canceled_at`` is cleared on reactivation, otherwise a
    won-back customer would keep showing up in the churn series forever.
    """
    now = datetime.now(timezone.utc)
    data = payload.model_dump(exclude_unset=True)

    if "plan" in data and data["plan"] is not None:
        sub.plan = Plan(data["plan"]).value
    if "seats" in data:
        sub.seats = data["seats"]
    if "trial_ends_at" in data:
        sub.trial_ends_at = data["trial_ends_at"]

    if "status" in data and data["status"] is not None:
        new_status = SubscriptionStatus(data["status"]).value
        sub.status = new_status
        if new_status == SubscriptionStatus.active.value:
            if sub.activated_at is None:
                sub.activated_at = now
            sub.canceled_at = None
        elif new_status == SubscriptionStatus.canceled.value:
            sub.canceled_at = now

    return sub
