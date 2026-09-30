from __future__ import annotations

"""Cross-tenant aggregation for the back office.

Every function here takes the **admin** session (superuser engine). That is not
an oversight to be tidied up later: the runtime role is bound by row-level
security to a single organization, which is exactly the property that makes the
tenant side safe and exactly the property that makes it useless for counting
customers. The back office is the one place that must see all tenants, so it
uses the one connection that can -- and in exchange every query below is
written to return *aggregates and account metadata only*. No function in this
module selects an employee's name, a salary, an absence reason or a health
flag. See app/schemas/backoffice.py for the contract that mirrors this.

Vocabulary, fixed once so the numbers cannot drift apart:

* **customer**  -- one ``organization`` row.
* **paying**    -- its subscription is ``active``. Nothing else counts.
* **trialing**  -- ``trialing`` and the trial has not run out yet.
* **expired**   -- ``trialing`` and it has. Signed up, never converted.
* **dormant**   -- paying, but nobody has signed in for 30 days.

Every employee count here means people still ON the customer's roster. Somebody
their manager removed is gone from the manager's own screens, so counting them
for the operator would say this customer is bigger than they can see themselves
-- and headcount is the number the plan and the pricing conversation rest on.
The rows are still in the table (removal is reversible); ``LIVE`` is what keeps
them out of the arithmetic.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence
from uuid import UUID

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.orm import Session

from app.deps import LIVE_EMPLOYEE_OF_LOGIN
from app.models.absence import Absence
from app.models.api_usage import ApiUsage
from app.models.employee import Employee
from app.models.organization import Organization
from app.models.shift_template import ShiftTemplate
from app.models.subscription import Subscription
from app.models.user_account import UserAccount
from app.schemas.backoffice import (
    ApiCostOut,
    ApiSpendOut,
    CustomerAdminOut,
    CustomerCountsOut,
    CustomerDetailOut,
    CustomerListOut,
    CustomerOut,
    MetricsOut,
    MonthlyCountOut,
    MonthlySpendOut,
    PeopleCountsOut,
    PlanCountOut,
    UsageCountsOut,
)
from app.schemas.enums import Plan, SubscriptionStatus
from app.services.employees import LIVE, live_ids

ACTIVE = SubscriptionStatus.active.value
TRIALING = SubscriptionStatus.trialing.value
PAST_DUE = SubscriptionStatus.past_due.value
CANCELED = SubscriptionStatus.canceled.value

DORMANT_AFTER_DAYS = 30
MONTHLY_WINDOW = 12
SPEND_WINDOW_DAYS = 30

# "Somebody signed in" means a person: the manager or somebody of their team.
# The till's tablet (role "store", app/access.py) is a login that stays signed
# in for years and stamps `last_seen_at` all day long, so counting it would make
# every business with a till look active -- and never dormant -- whether anybody
# opens the app or not.
A_PERSON = UserAccount.role != "store"


def _count(db: Session, stmt: Select) -> int:
    return int(db.execute(stmt).scalar_one() or 0)


def _month_key(value: datetime | date) -> str:
    return "%04d-%02d" % (value.year, value.month)


def _recent_months(today: date, count: int = MONTHLY_WINDOW) -> List[str]:
    """The last ``count`` calendar months, oldest first, including this one."""
    months: List[str] = []
    year, month = today.year, today.month
    for _ in range(count):
        months.append("%04d-%02d" % (year, month))
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    months.reverse()
    return months


def _monthly_counts(db: Session, column, since: date) -> Dict[str, int]:
    """Group a timestamp column into ``YYYY-MM`` buckets from ``since`` on.

    The cast to UTC before truncating matters: without it the bucket a signup
    lands in depends on the database session's timezone, so the same month
    would report different totals to different callers.
    """
    bucket = func.date_trunc("month", func.timezone("UTC", column))
    rows = db.execute(
        select(bucket.label("bucket"), func.count())
        .where(column.is_not(None))
        .where(column >= since)
        .group_by("bucket")
    ).all()
    return {_month_key(bucket_value): int(total) for bucket_value, total in rows}


def _priced_groups(
    db: Session, *keys, since: Optional[datetime] = None
) -> List[tuple]:
    """``(key tuple, calls, input tokens, output tokens, usd)`` per group.

    Tokens are summed in SQL and turned into money in Python, because the price
    is per model and lives in ``services/api_usage``. That is why every
    grouping here carries ``ApiUsage.model`` whether the caller asked for it or
    not: a sum across two models priced at either one's rate is not a rounding
    error, it is the wrong number.

    The customer page sums a handful of rows in Python and says so. This one
    reads every call the platform has ever made, so the rows stay in the
    database.
    """
    from app.services import api_usage

    columns = [*keys, ApiUsage.model]
    stmt = select(
        *columns,
        func.count(),
        func.coalesce(func.sum(ApiUsage.input_tokens), 0),
        func.coalesce(func.sum(ApiUsage.output_tokens), 0),
        func.coalesce(func.sum(ApiUsage.cache_creation_input_tokens), 0),
        func.coalesce(func.sum(ApiUsage.cache_read_input_tokens), 0),
    ).group_by(*columns)
    if since is not None:
        stmt = stmt.where(ApiUsage.created_at >= since)

    groups: List[tuple] = []
    for row in db.execute(stmt).all():
        *key, model, calls, inp, out, cache_write, cache_read = row
        usd = api_usage.cost_usd(
            model, int(inp), int(out), int(cache_write), int(cache_read)
        )
        groups.append((tuple(key), int(calls), int(inp), int(out), usd))
    return groups


def platform_api_spend(
    db: Session, *, today: date, days: int = SPEND_WINDOW_DAYS
) -> ApiSpendOut:
    """The platform's model bill: last ``days``, all time, and by month.

    Priced at today's rates throughout, including history -- which answers
    "what would last month cost now" and deliberately does not answer "what
    were we charged", a question only the provider's invoice can settle.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)

    calls = input_tokens = output_tokens = 0
    usd_window = 0.0
    by_purpose: Dict[str, float] = {}
    for (purpose,), group_calls, inp, out, usd in _priced_groups(
        db, ApiUsage.purpose, since=since
    ):
        calls += group_calls
        input_tokens += inp
        output_tokens += out
        usd_window += usd
        by_purpose[purpose] = by_purpose.get(purpose, 0.0) + usd

    usd_total = sum(usd for _, _, _, _, usd in _priced_groups(db))

    months = _recent_months(today)
    window_start = datetime(
        int(months[0][:4]), int(months[0][5:]), 1, tzinfo=timezone.utc
    )
    bucket = func.date_trunc("month", func.timezone("UTC", ApiUsage.created_at))
    per_month: Dict[str, float] = {}
    for (bucket_value,), _calls, _inp, _out, usd in _priced_groups(
        db, bucket.label("bucket"), since=window_start
    ):
        key = _month_key(bucket_value)
        per_month[key] = per_month.get(key, 0.0) + usd

    return ApiSpendOut(
        calls_30d=calls,
        input_tokens_30d=input_tokens,
        output_tokens_30d=output_tokens,
        usd_30d=round(usd_window, 4),
        usd_total=round(usd_total, 4),
        by_purpose_30d={k: round(v, 4) for k, v in sorted(by_purpose.items())},
        monthly=[
            MonthlySpendOut(month=month, usd=round(per_month.get(month, 0.0), 4))
            for month in months
        ],
    )


def compute_metrics(db: Session, *, today: Optional[date] = None) -> MetricsOut:
    """The whole overview screen in one round of aggregate queries."""
    now = datetime.now(timezone.utc)
    today = today or now.date()
    dormant_cutoff = now - timedelta(days=DORMANT_AFTER_DAYS)
    active_7d_cutoff = now - timedelta(days=7)
    active_30d_cutoff = now - timedelta(days=30)

    org_count = select(func.count()).select_from(Organization)

    def with_status(*conditions) -> Select:
        return (
            select(func.count())
            .select_from(Subscription)
            .where(*conditions)
        )

    trial_live = and_(
        Subscription.status == TRIALING,
        or_(
            Subscription.trial_ends_at.is_(None),
            Subscription.trial_ends_at >= today,
        ),
    )
    trial_over = and_(
        Subscription.status == TRIALING,
        Subscription.trial_ends_at.is_not(None),
        Subscription.trial_ends_at < today,
    )

    customers = CustomerCountsOut(
        total=_count(db, org_count),
        paying=_count(db, with_status(Subscription.status == ACTIVE)),
        trialing=_count(db, with_status(trial_live)),
        trial_expired=_count(db, with_status(trial_over)),
        past_due=_count(db, with_status(Subscription.status == PAST_DUE)),
        canceled=_count(db, with_status(Subscription.status == CANCELED)),
    )

    paying_orgs = select(Subscription.org_id).where(Subscription.status == ACTIVE)

    is_manager = and_(UserAccount.role == "manager", UserAccount.is_active.is_(True))
    people = PeopleCountsOut(
        managers_total=_count(
            db, select(func.count()).select_from(UserAccount).where(is_manager)
        ),
        managers_paying=_count(
            db,
            select(func.count())
            .select_from(UserAccount)
            .where(is_manager, UserAccount.org_id.in_(paying_orgs)),
        ),
        employees_total=_count(
            db, select(func.count()).select_from(Employee).where(LIVE)
        ),
        employees_paying=_count(
            db,
            select(func.count())
            .select_from(Employee)
            .where(LIVE)
            .where(Employee.org_id.in_(paying_orgs)),
        ),
    )

    def orgs_seen_since(cutoff: datetime) -> Select:
        return (
            select(func.count(func.distinct(UserAccount.org_id)))
            .select_from(UserAccount)
            .where(A_PERSON)
            .where(UserAccount.last_seen_at.is_not(None))
            .where(UserAccount.last_seen_at >= cutoff)
        )

    # Paying customers with no sign-in inside the window -- including those who
    # have never signed in at all, which is why this is a NOT IN rather than a
    # comparison on a max() that would be NULL for them.
    orgs_seen_recently = (
        select(UserAccount.org_id)
        .where(A_PERSON)
        .where(UserAccount.last_seen_at.is_not(None))
        .where(UserAccount.last_seen_at >= dormant_cutoff)
    )
    usage = UsageCountsOut(
        active_7d=_count(db, orgs_seen_since(active_7d_cutoff)),
        active_30d=_count(db, orgs_seen_since(active_30d_cutoff)),
        dormant_paying=_count(
            db,
            select(func.count())
            .select_from(Subscription)
            .where(Subscription.status == ACTIVE)
            .where(Subscription.org_id.not_in(orgs_seen_recently)),
        ),
    )

    plan_rows = dict(
        db.execute(
            select(Subscription.plan, func.count()).group_by(Subscription.plan)
        ).all()
    )
    by_plan = [
        PlanCountOut(plan=plan, customers=int(plan_rows.get(plan.value, 0)))
        for plan in Plan
    ]

    months = _recent_months(today)
    window_start = date(int(months[0][:4]), int(months[0][5:]), 1)
    signups = _monthly_counts(db, Organization.created_at, window_start)
    conversions = _monthly_counts(db, Subscription.activated_at, window_start)
    cancellations = _monthly_counts(db, Subscription.canceled_at, window_start)
    monthly = [
        MonthlyCountOut(
            month=month,
            signups=signups.get(month, 0),
            conversions=conversions.get(month, 0),
            cancellations=cancellations.get(month, 0),
        )
        for month in months
    ]

    return MetricsOut(
        generated_at=now,
        customers=customers,
        people=people,
        usage=usage,
        api_spend=platform_api_spend(db, today=today),
        by_plan=by_plan,
        monthly=monthly,
    )


# --- Customer listing --------------------------------------------------------


def _managers_per_org(db: Session, org_ids: Sequence[UUID]) -> Dict[UUID, int]:
    rows = db.execute(
        select(UserAccount.org_id, func.count())
        .where(UserAccount.org_id.in_(org_ids))
        .where(UserAccount.role == "manager")
        .where(UserAccount.is_active.is_(True))
        .group_by(UserAccount.org_id)
    ).all()
    return {org_id: int(total) for org_id, total in rows}


def _employees_per_org(db: Session, org_ids: Sequence[UUID]) -> Dict[UUID, int]:
    rows = db.execute(
        select(Employee.org_id, func.count())
        .where(Employee.org_id.in_(org_ids))
        .where(LIVE)
        .group_by(Employee.org_id)
    ).all()
    return {org_id: int(total) for org_id, total in rows}


def _last_active_per_org(
    db: Session, org_ids: Sequence[UUID]
) -> Dict[UUID, datetime]:
    rows = db.execute(
        select(UserAccount.org_id, func.max(UserAccount.last_seen_at))
        .where(UserAccount.org_id.in_(org_ids))
        .where(A_PERSON)
        .group_by(UserAccount.org_id)
    ).all()
    return {org_id: seen for org_id, seen in rows if seen is not None}


def _owner_per_org(db: Session, org_ids: Sequence[UUID]) -> Dict[UUID, UserAccount]:
    """The account that created each org: its oldest manager."""
    rows = db.execute(
        select(UserAccount)
        .where(UserAccount.org_id.in_(org_ids))
        .where(UserAccount.role == "manager")
        .order_by(UserAccount.org_id, UserAccount.created_at.asc())
        .distinct(UserAccount.org_id)
    ).scalars()
    return {user.org_id: user for user in rows}


def _to_customer(
    org: Organization,
    sub: Optional[Subscription],
    *,
    managers: int,
    employees: int,
    owner: Optional[UserAccount],
    last_active_at: Optional[datetime],
) -> CustomerOut:
    return CustomerOut(
        org_id=org.id,
        org_name=org.name,
        jurisdiction_code=org.jurisdiction_code,
        signed_up_at=org.created_at,
        plan=(sub.plan if sub else Plan.trial.value),
        status=(sub.status if sub else SubscriptionStatus.trialing.value),
        seats=sub.seats if sub else None,
        trial_ends_at=sub.trial_ends_at if sub else None,
        activated_at=sub.activated_at if sub else None,
        canceled_at=sub.canceled_at if sub else None,
        owner_name=owner.full_name if owner else None,
        owner_email=owner.email if owner else None,
        managers=managers,
        employees=employees,
        last_active_at=last_active_at,
    )


def list_customers(
    db: Session,
    *,
    status: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> CustomerListOut:
    """One page of customers, newest signup first.

    The page is fetched first and enriched with four grouped queries rather
    than per-row lookups, so the cost stays flat as the customer base grows.
    """
    base = select(Organization).outerjoin(
        Subscription, Subscription.org_id == Organization.id
    )
    if status:
        base = base.where(Subscription.status == status)
    if query:
        pattern = "%%%s%%" % query.strip()
        # Search by company name or by any address inside it -- when a customer
        # writes in, their email is what you have to go on.
        matching_email = (
            select(UserAccount.id)
            .where(UserAccount.org_id == Organization.id)
            .where(UserAccount.email.ilike(pattern))
        )
        base = base.where(
            or_(Organization.name.ilike(pattern), matching_email.exists())
        )

    total = _count(
        db, select(func.count()).select_from(base.subquery())
    )

    orgs = list(
        db.execute(
            base.order_by(Organization.created_at.desc()).limit(limit).offset(offset)
        )
        .scalars()
        .all()
    )
    if not orgs:
        return CustomerListOut(total=total, items=[])

    org_ids = [org.id for org in orgs]
    subs = {
        sub.org_id: sub
        for sub in db.execute(
            select(Subscription).where(Subscription.org_id.in_(org_ids))
        ).scalars()
    }
    managers = _managers_per_org(db, org_ids)
    employees = _employees_per_org(db, org_ids)
    owners = _owner_per_org(db, org_ids)
    last_active = _last_active_per_org(db, org_ids)

    items = [
        _to_customer(
            org,
            subs.get(org.id),
            managers=managers.get(org.id, 0),
            employees=employees.get(org.id, 0),
            owner=owners.get(org.id),
            last_active_at=last_active.get(org.id),
        )
        for org in orgs
    ]
    return CustomerListOut(total=total, items=items)


def get_customer(db: Session, org_id: UUID) -> Optional[CustomerDetailOut]:
    org = db.execute(
        select(Organization).where(Organization.id == org_id)
    ).scalar_one_or_none()
    if org is None:
        return None

    sub = db.execute(
        select(Subscription).where(Subscription.org_id == org_id)
    ).scalar_one_or_none()

    # Administrators only. Employee-linked logins are counted, never listed --
    # the platform has no reason to hold a customer's staff directory.
    admin_rows = list(
        db.execute(
            select(UserAccount)
            .where(UserAccount.org_id == org_id)
            .where(UserAccount.role == "manager")
            .order_by(UserAccount.created_at.asc())
        )
        .scalars()
        .all()
    )
    # People of the team who can sign in: an employee's login with somebody
    # live of this business behind it -- the session's own rule
    # (app/deps.py, LIVE_EMPLOYEE_OF_LOGIN). Not the till's tablet (role
    # "store"), a login but not a person; nor an orphan -- a login left
    # behind by a removal from before removing somebody took it with them, or
    # linked to nobody -- which opens nothing.
    employee_logins = _count(
        db,
        select(func.count())
        .select_from(UserAccount)
        .join(Employee, LIVE_EMPLOYEE_OF_LOGIN)
        .where(UserAccount.org_id == org_id)
        .where(UserAccount.role == "employee"),
    )

    by_status = {
        str(status_value): int(total)
        for status_value, total in db.execute(
            select(Employee.employment_status, func.count())
            .where(Employee.org_id == org_id)
            .where(LIVE)
            .group_by(Employee.employment_status)
        ).all()
    }

    managers = _managers_per_org(db, [org_id]).get(org_id, 0)
    employees = _employees_per_org(db, [org_id]).get(org_id, 0)
    owner = _owner_per_org(db, [org_id]).get(org_id)
    last_active = _last_active_per_org(db, [org_id]).get(org_id)

    base = _to_customer(
        org,
        sub,
        managers=managers,
        employees=employees,
        owner=owner,
        last_active_at=last_active,
    )

    return CustomerDetailOut(
        **base.model_dump(),
        admins=[CustomerAdminOut.model_validate(u, from_attributes=True) for u in admin_rows],
        employee_logins=employee_logins,
        employees_by_status=by_status,
        shift_templates=_count(
            db,
            select(func.count())
            .select_from(ShiftTemplate)
            .where(ShiftTemplate.org_id == org_id),
        ),
        absences_recorded=_count(
            db,
            select(func.count())
            .select_from(Absence)
            .where(Absence.org_id == org_id)
            # Time off belonging to somebody who has been removed no longer
            # exists for the customer -- it is off their absences screen -- so
            # it must not still be counted as usage of the product here.
            .where(Absence.employee_id.in_(live_ids(org_id))),
        ),
        api_cost=api_cost_for_org(db, org_id),
    )


def api_cost_for_org(db: Session, org_id: UUID, days: int = 30) -> ApiCostOut:
    """Tokens spent on this organization, priced at today's rates.

    Rows are summed in Python rather than SQL because the price is per model
    and lives in code; the table is small per customer (a few rows per
    prompt) and this is one screen in the back office, not a report.
    """
    from app.services import api_usage

    since = datetime.now(timezone.utc) - timedelta(days=days)
    all_rows = list(
        db.execute(select(ApiUsage).where(ApiUsage.org_id == org_id)).scalars().all()
    )
    recent = [r for r in all_rows if r.created_at >= since]
    by_purpose: Dict[str, float] = {}
    # Durations are averaged over the rows that HAVE one. Rows older than
    # migration 0017 carry NULL, and counting those as zero would drag every
    # average towards a speed no call ever ran at.
    timed: Dict[str, List[int]] = {}
    for r in recent:
        by_purpose[r.purpose] = round(
            by_purpose.get(r.purpose, 0.0) + api_usage.total_usd([r]), 4
        )
        if r.duration_ms is not None:
            timed.setdefault(r.purpose, []).append(r.duration_ms)
    avg_ms = {k: round(sum(v) / len(v)) for k, v in timed.items()}
    return ApiCostOut(
        calls_30d=len(recent),
        input_tokens_30d=sum(r.input_tokens for r in recent),
        output_tokens_30d=sum(r.output_tokens for r in recent),
        usd_30d=round(api_usage.total_usd(recent), 4),
        usd_total=round(api_usage.total_usd(all_rows), 4),
        by_purpose_30d=dict(sorted(by_purpose.items())),
        avg_ms_30d=dict(sorted(avg_ms.items())),
    )
