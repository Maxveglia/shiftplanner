from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Callable, Optional
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app import clients
from app.access import apps_for, permissions_for
from app.clients import APP_KEYS, AppKey
from app.db import get_admin_db, get_db, set_current_org
from app.errors import detail
from app.models.employee import Employee
from app.models.organization import Organization
from app.models.platform_admin import PlatformAdmin
from app.models.user_account import UserAccount
from app.schemas.auth import UserOut
from app.schemas.backoffice import PlatformAdminOut
from app.schemas.enums import Role
from app.security import SCOPE_PLATFORM, SCOPE_TENANT, decode_access_token
from app.services.employees import LIVE

_bearer = HTTPBearer(auto_error=True)

_CREDENTIALS_EXC = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail=detail("session_invalid", "Could not validate credentials"),
    headers={"WWW-Authenticate": "Bearer"},
)

# How stale last_seen_at is allowed to get before we spend a write on it. The
# back office asks "did this customer show up this week?", so minute-level
# precision would buy nothing and cost one UPDATE per request.
LAST_SEEN_REFRESH_MINUTES = 15

# The person of the roster a login belongs to, if they are still on it: what
# `get_current_user` and login (routers/auth.py) outer-join onto the account,
# in the same query that reads it. Their own business's person, and live by
# the one rule there is (`LIVE`).
LIVE_EMPLOYEE_OF_LOGIN = and_(
    Employee.id == UserAccount.employee_id,
    Employee.org_id == UserAccount.org_id,
    LIVE,
)


def login_still_stands(role: str, live_employee_id: Optional[UUID]) -> bool:
    """Whether a login is still a way in, as far as the roster goes.

    An employee's login is only as good as their place on the roster: taken
    off it (routers/employees.py, which deletes the login with them) or never
    linked to anybody -- ``employee_id`` NULL, which the foreign key's ON
    DELETE SET NULL can leave behind -- it opens nothing, not even the till.
    The manager and the till's tablet are nobody of the roster, so this does
    not ask about them. `live_employee_id` is `LIVE_EMPLOYEE_OF_LOGIN`'s
    employee id, None when there is no such person.
    """
    if str(getattr(role, "value", role)) != Role.employee.value:
        return True
    return live_employee_id is not None


def _touch_last_seen(db: Session, user: UserAccount) -> None:
    now = datetime.now(timezone.utc)
    previous = user.last_seen_at
    if previous is not None:
        # psycopg returns tz-aware values for timestamptz, so this branch
        # should never fire; it is here so a naive value from a fixture can
        # never turn an auth check into a TypeError.
        if previous.tzinfo is None:
            previous = previous.replace(tzinfo=timezone.utc)
        if now - previous < timedelta(minutes=LAST_SEEN_REFRESH_MINUTES):
            return
    user.last_seen_at = now


def get_current_user(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> UserOut:
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        raise _CREDENTIALS_EXC

    # A platform-admin token must never open a tenant session. Tokens issued
    # before scopes existed carry no claim and are treated as tenant tokens.
    if payload.get("scope", SCOPE_TENANT) != SCOPE_TENANT:
        raise _CREDENTIALS_EXC

    user_id = payload.get("sub")
    org_id = payload.get("org_id")
    if not user_id or not org_id:
        raise _CREDENTIALS_EXC

    # Real tenant barrier: set the org for the request transaction BEFORE any
    # domain query. The RLS policies read this session variable.
    try:
        set_current_org(db, UUID(str(org_id)))
    except (ValueError, TypeError):
        raise _CREDENTIALS_EXC

    # The client folder rides on the same read as the rest of the org: which
    # apps this business has is asked on every request (`require_app`), so it
    # must not cost a query of its own. Nor does whether an employee's login
    # still has somebody on the roster behind it: the same read, outer-joined.
    row = db.execute(
        select(
            UserAccount,
            Organization.name,
            Organization.jurisdiction_code,
            Organization.client_key,
            Employee.id,
        )
        .join(Organization, Organization.id == UserAccount.org_id)
        .outerjoin(Employee, LIVE_EMPLOYEE_OF_LOGIN)
        .where(UserAccount.id == UUID(str(user_id)))
    ).first()
    if row is None:
        raise _CREDENTIALS_EXC

    user, org_name, jurisdiction, client_key, live_employee_id = row
    if not user.is_active:
        raise _CREDENTIALS_EXC
    # An employee taken off the roster, or a login of role employee linked to
    # nobody: the same 401 as a token that is no good (`login_still_stands`).
    if not login_still_stands(user.role, live_employee_id):
        raise _CREDENTIALS_EXC

    # A session from an earlier generation of this login: its password was
    # changed since (routers/access.py), which is how the till's tablet --
    # whose token does not run out -- is signed out. The same 401 as any
    # other token that is no good. A token from before the claim is 0.
    try:
        issued_under = int(payload.get("sv", 0))
    except (TypeError, ValueError):
        raise _CREDENTIALS_EXC
    if issued_under != user.session_epoch:
        raise _CREDENTIALS_EXC

    _touch_last_seen(db, user)

    profile = clients.profile_for(client_key)
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        org_id=user.org_id,
        org_name=org_name,
        org_jurisdiction=jurisdiction,
        employee_id=user.employee_id,
        apps=apps_for(user.role, profile.apps),
        preparing=profile.preparing,
        permissions=permissions_for(user.role),
    )


def require_app(key: AppKey) -> Callable[..., None]:
    """A dependency that lets the request through only if the business has `key`.

    Put on a whole router where it is included (app/main.py), not on each
    route: an app is switched on or off as a unit, and a route added to it
    later is behind the same door without anybody remembering to put it there.

    Every role alike -- this is about what the business has, not who is
    asking; the one exception is decided before, in `apps_for` (the till's
    tablet has no Turnos), so it reaches this door as an app the business
    lacks. Who may do what inside an app is still each route's own
    `require_permission` / `get_current_manager` / `assert_can_read_employee`,
    and runs after this.

    The user comes from `get_current_user`, which FastAPI resolves once per
    request however many dependencies ask for it, so the door costs nothing:
    the apps were read in the same query as the user.
    """
    if key not in APP_KEYS:
        # At import, from app/main.py: a typo there must stop the boot rather
        # than lock every business out of an app that does not exist.
        raise ValueError("unknown app %r; the apps are %s" % (key, APP_KEYS))

    def app_enabled(current_user: UserOut = Depends(get_current_user)) -> None:
        if key not in current_user.apps:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=detail(
                    "app_not_enabled",
                    "This business does not have the %s app" % key,
                    app=key,
                ),
            )

    # Read by tests/test_client_workspace.py, which walks every route and
    # checks each one is behind the door of the app its router belongs to.
    app_enabled.app_key = key  # type: ignore[attr-defined]
    app_enabled.__name__ = "require_app_%s" % key
    return app_enabled


def assert_can_read_employee(current_user: UserOut, employee_id: UUID) -> None:
    """Managers see the whole roster; everyone else sees only themselves.

    Personal data -- pay, contract terms, time off -- is the reason this exists.
    Row-level security keeps organisations apart; this keeps colleagues apart.
    """
    if current_user.role == "manager":
        return
    if current_user.employee_id == employee_id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=detail("employee_not_yours", "Not allowed to read this employee"),
    )


def get_current_manager(
    current_user: UserOut = Depends(get_current_user),
) -> UserOut:
    if current_user.role != "manager":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail("manager_role_required", "Manager role required"),
        )
    return current_user


def get_current_platform_admin(
    db: Session = Depends(get_admin_db),
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> PlatformAdminOut:
    """Authenticate the operator of the platform, not a customer of it.

    Note the session: ``get_admin_db``, the superuser engine. The back office
    exists precisely to read across every tenant, which the RLS-bound runtime
    role cannot do by design. That makes this dependency the single door to
    unfiltered data, so it is deliberately narrow -- a token is accepted only
    when it carries ``scope="platform"`` AND resolves to a live row in
    ``platform_admin``, a table no tenant path can even reach.
    """
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.PyJWTError:
        raise _CREDENTIALS_EXC

    if payload.get("scope") != SCOPE_PLATFORM:
        raise _CREDENTIALS_EXC

    admin_id = payload.get("sub")
    if not admin_id:
        raise _CREDENTIALS_EXC

    try:
        admin_uuid = UUID(str(admin_id))
    except (ValueError, TypeError):
        raise _CREDENTIALS_EXC

    admin = db.execute(
        select(PlatformAdmin).where(PlatformAdmin.id == admin_uuid)
    ).scalar_one_or_none()
    if admin is None or not admin.is_active:
        raise _CREDENTIALS_EXC

    return PlatformAdminOut.model_validate(admin)
