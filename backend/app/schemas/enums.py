from __future__ import annotations

from enum import Enum


class Role(str, Enum):
    """Who a login is. What each may do is app/access.py's table."""

    manager = "manager"
    employee = "employee"
    # The till's tablet: an employee's permissions without Turnos, and a
    # session that does not expire (app/access.py, migration 0046).
    store = "store"


class EmploymentStatus(str, Enum):
    active = "active"
    onboarding = "onboarding"
    on_leave = "on_leave"
    resigned = "resigned"


class EmploymentType(str, Enum):
    exempt_salaried = "exempt_salaried"
    non_exempt_hourly = "non_exempt_hourly"
    non_exempt_salaried = "non_exempt_salaried"


class PayPeriod(str, Enum):
    """How often an employee is paid -- agreed with the manager, per contract."""

    weekly = "weekly"
    biweekly = "biweekly"
    monthly = "monthly"


class AbsenceStatus(str, Enum):
    requested = "requested"
    approved = "approved"
    rejected = "rejected"
    cancelled = "cancelled"


class MovementType(str, Enum):
    accrual = "accrual"
    consumption = "consumption"
    adjustment = "adjustment"
    carryover = "carryover"
    expiration = "expiration"


class Hardness(str, Enum):
    hard = "hard"
    soft = "soft"


class Plan(str, Enum):
    """Commercial tier an organization sits on.

    ``trial`` is not a paid tier -- it is the state every organization starts
    in. Everything else is billable.
    """

    trial = "trial"
    starter = "starter"
    growth = "growth"
    scale = "scale"


class SubscriptionStatus(str, Enum):
    """Lifecycle of a customer account, from the platform's point of view.

    Only ``active`` counts as a *paying customer*. ``past_due`` is someone who
    was paying and whose payment failed -- still a customer, not yet revenue,
    so it is counted separately and never folded into ``active``.
    """

    trialing = "trialing"
    active = "active"
    past_due = "past_due"
    canceled = "canceled"
