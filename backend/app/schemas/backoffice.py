from __future__ import annotations

"""Back-office API contract -- the platform operator's view of the business.

One rule governs every shape in this file: **the back office counts customers,
it does not read their data.** The operator needs to know how many
organizations pay, how many managers and employees they carry, and who to
email when something breaks. They never need a roster, a salary, an absence
reason or a health flag, so none of those can be reached through here -- not
filtered out at the edge, simply never selected. The customer detail endpoint
lists the customer's *administrators* (the people who signed up) and returns
their staff only as totals.

The second rule is about money, and it has a direction. *Revenue* lives in the
payment provider; mirroring a price here would create a second,
silently-wrong source of truth for it. The one amount these shapes do carry
runs the other way -- what a customer's prompts **cost us** in model calls,
which no payment provider knows and nothing else on the platform measures.
"""

import uuid
from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enums import Plan, Role, SubscriptionStatus
from app.schemas import limits

# --- Platform admin identity -------------------------------------------------


class PlatformAdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str
    last_login_at: Optional[datetime] = None


class PlatformLoginIn(BaseModel):
    # Unauthenticated, like every login: whoever can reach this door can post
    # whatever they like through it, which is the whole reason for the lengths.
    # No floor on the password here for the same reason ``LoginIn`` has none --
    # a short one is a wrong one, and it is told so as 401, not as 422.
    email: str = Field(max_length=limits.EMAIL)
    password: str = Field(max_length=limits.PASSWORD_MAX)


class PlatformTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    admin: PlatformAdminOut


# --- Metrics -----------------------------------------------------------------


class CustomerCountsOut(BaseModel):
    """How many customers, split by where they are in the lifecycle.

    ``paying`` is the headline number and is intentionally narrow: only
    subscriptions in ``active``. ``past_due`` people are still customers but
    are not paying right now, so folding them in would quietly inflate the one
    figure that has to stay honest.
    """

    total: int
    paying: int
    trialing: int
    trial_expired: int
    past_due: int
    canceled: int


class PeopleCountsOut(BaseModel):
    """The human scale of the platform, and how much of it is paid for."""

    managers_total: int
    managers_paying: int
    employees_total: int
    employees_paying: int


class UsageCountsOut(BaseModel):
    """Paying is not the same as using. This is the gap.

    ``dormant_paying`` -- customers who pay and have not signed in for 30 days
    -- is the number worth acting on: it is churn that has already happened
    and has not been billed yet.
    """

    active_7d: int
    active_30d: int
    dormant_paying: int


class PlanCountOut(BaseModel):
    plan: Plan
    customers: int


class MonthlyCountOut(BaseModel):
    """One row per calendar month, oldest first. ``month`` is ``YYYY-MM``."""

    month: str
    signups: int
    conversions: int
    cancellations: int


class MonthlySpendOut(BaseModel):
    """One calendar month of model spend, oldest first. ``month`` is ``YYYY-MM``."""

    month: str
    usd: float


class ApiSpendOut(BaseModel):
    """What the platform's calls to the paid model cost, every customer summed.

    The same exception the customer page makes, made once at platform scale.
    It is worth a place on the overview because these calls are the product's
    only variable cost -- hosting is a flat bill, the opening interview is
    free, and everything a manager does between prompts is local -- so this
    single number is the whole of what serving one more customer costs.

    ``monthly`` runs twelve calendar months because the provider's cap is
    monthly: spend that looks calm as a 30-day average can still trip it in
    the month it lands. ``by_purpose_30d`` splits that window by what the call
    was for, which is how a feature that got expensive is found instead of
    guessed at.
    """

    calls_30d: int
    input_tokens_30d: int
    output_tokens_30d: int
    usd_30d: float
    usd_total: float
    by_purpose_30d: dict
    monthly: List[MonthlySpendOut]


class MetricsOut(BaseModel):
    generated_at: datetime
    customers: CustomerCountsOut
    people: PeopleCountsOut
    usage: UsageCountsOut
    api_spend: ApiSpendOut
    by_plan: List[PlanCountOut]
    monthly: List[MonthlyCountOut]


# --- Customers ---------------------------------------------------------------


class CustomerOut(BaseModel):
    """One organization as the platform sees it: identity, plan, size, pulse."""

    org_id: uuid.UUID
    org_name: str
    jurisdiction_code: str
    signed_up_at: datetime

    plan: Plan
    status: SubscriptionStatus
    seats: Optional[int] = None
    trial_ends_at: Optional[date] = None
    activated_at: Optional[datetime] = None
    canceled_at: Optional[datetime] = None

    owner_name: Optional[str] = None
    owner_email: Optional[str] = None

    managers: int
    employees: int
    last_active_at: Optional[datetime] = None


class CustomerAdminOut(BaseModel):
    """A person who administers a customer account -- never their staff.

    Only ``role == "manager"`` accounts appear here. Employee logins belong to
    the customer's workforce; the platform has no business listing them.
    """

    id: uuid.UUID
    full_name: str
    email: str
    role: Role
    is_active: bool
    last_seen_at: Optional[datetime] = None
    created_at: datetime


class ApiCostOut(BaseModel):
    """What this customer's prompts cost us in model calls.

    The one amount of money the back office does show, and it is a cost, not
    a price: the rule that revenue lives in the payment provider still holds.
    Dollars because that is the currency the provider bills in; converting
    would put a rate of the day into a number meant to be compared across
    months. ``by_purpose`` is the same 30 days split by what the call was for
    (``intake.*``, ``refine.*``, ``plan.month``), which is how the cost of a
    feature is read off rather than guessed.

    ``avg_ms_30d`` is the same split by how LONG each kind of call took, in
    milliseconds. It answers the other half of a support ticket -- a customer
    who says the generator is slow now has a number beside the dollars -- and
    it is averaged only over rows that carry a duration, because rows written
    before migration 0017 carry none. A purpose ending in ``.lost`` is not a
    reply: it is an attempt the SDK retried away, priced at zero because its
    tokens were never reported, and its duration is the time that was burned
    before it failed.
    """

    calls_30d: int
    input_tokens_30d: int
    output_tokens_30d: int
    usd_30d: float
    usd_total: float
    by_purpose_30d: dict
    avg_ms_30d: dict = {}


class CustomerDetailOut(CustomerOut):
    admins: List[CustomerAdminOut]
    employee_logins: int
    employees_by_status: dict
    shift_templates: int
    absences_recorded: int
    api_cost: ApiCostOut


class CustomerListOut(BaseModel):
    total: int
    items: List[CustomerOut]


class SubscriptionUpdateIn(BaseModel):
    """Manual lever for the operator: this is how an org becomes a customer.

    Every field is optional; only what is sent is applied. Moving ``status``
    to ``active`` stamps ``activated_at`` the first time, and moving it to
    ``canceled`` stamps ``canceled_at`` -- so the monthly conversion and churn
    series stay derivable from the row itself.
    """

    plan: Optional[Plan] = None
    status: Optional[SubscriptionStatus] = None
    seats: Optional[int] = None
    trial_ends_at: Optional[date] = None


class CustomerDeleteIn(BaseModel):
    """Typed confirmation for an irreversible delete.

    The operator has to type the company's name back. Deleting a customer
    removes their employees, contracts, schedules and vacation history along
    with them, and an "are you sure?" that only needs a click is the one guard
    everybody clicks through.
    """

    # Bounded like the name it has to match: a confirmation longer than any
    # company name is not a confirmation, it is a payload.
    confirm_name: str = Field(max_length=limits.NAME)


class CustomerDeleteOut(BaseModel):
    org_id: uuid.UUID
    name: str
    deleted_employees: int
    deleted_users: int
