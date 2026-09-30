from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app import clients
from app.access import apps_for, permissions_for
from app.db import get_admin_db
from app.deps import LIVE_EMPLOYEE_OF_LOGIN, get_current_user, login_still_stands
from app.errors import detail
from app.models.employee import Employee
from app.models.organization import Organization
from app.models.user_account import UserAccount
from app.schemas.auth import LoginIn, SignupIn, TokenOut, UserOut
from app.security import (
    create_access_token,
    hash_password,
    verify_against_decoy,
    verify_password,
)
from app.services import business_profile as bp
from app.services import login_guard
from app.services.seeding import seed_org_defaults
from app.services.subscriptions import start_trial

router = APIRouter(prefix="/auth", tags=["auth"])


def normalise_email(email: str) -> str:
    """An address as it is stored and compared: no spaces around it, lower
    case. A tablet that capitalises "Tienda@..." on its own is the same login.

    Shared with routers/access.py and routers/accounts.py, which make the
    other logins; services/login_guard.py counts attempts by the same key.
    """
    return (email or "").strip().lower()


# The shape of an address, and no more: one @, something before it, a domain
# with a dot, no spaces -- the same wall as the day notes' list of addresses
# (schemas/day_note.py). Whether it receives mail is not ours to know.
_EMAIL_SHAPE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def looks_like_an_email(email: str) -> bool:
    """Whether a (normalised) address has the shape of one. Checked where the
    manager makes a login -- a tablet's (routers/access.py) and a person's
    (routers/accounts.py) -- so a typo is refused with a code the screen puts
    into words, not saved as a login nobody can type."""
    return _EMAIL_SHAPE.fullmatch(email) is not None


def email_in_use(db: Session, email: str) -> bool:
    """Whether any login, of any business, already has this address in any
    capitalisation. Rows from before addresses were normalised may be mixed
    case; a second one differing only in case would make login ambiguous."""
    return (
        db.execute(
            select(UserAccount.id)
            .where(func.lower(UserAccount.email) == normalise_email(email))
            .limit(1)
        ).first()
        is not None
    )


def _issue_token(user: UserAccount) -> str:
    return create_access_token(
        subject=str(user.id),
        org_id=str(user.org_id),
        role=user.role,
        session_epoch=user.session_epoch or 0,
    )


def _user_out(
    user: UserAccount, org_name: str, jurisdiction: str, client_key: str | None
) -> UserOut:
    # The same fields `get_current_user` fills, from the same columns, so what
    # login answers and what /auth/me answers a second later cannot disagree.
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


@router.post("/signup", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupIn, db: Session = Depends(get_admin_db)) -> TokenOut:
    # Kept as login compares it: "Ana@X.com " signs up as ana@x.com, and is
    # taken if any login has it in any capitalisation.
    email = normalise_email(payload.email)
    if email_in_use(db, email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail("email_taken", "Email already registered"),
        )

    # Hospitality, because that is what this product sells to: bars and
    # restaurants in Barcelona, with shops second. A shop changes it in
    # Settings in one click, and either way the statute underneath (`ES`) is
    # the same. The old default was the FLSA, which was never true for
    # anybody who has ever signed up.
    #
    # No `client_key`, deliberately: a business that has just signed up has no
    # folder in app/clients/ yet, so it is served the template -- Turnos and
    # Inventario, and told that its space is being prepared until we set up
    # what is its.
    org = Organization(
        name=payload.org_name,
        jurisdiction_code="ES-CT-HOSTELERIA",
        night_differential_pct=25,
        weekend_premium_pct=0,
        overtime_multiplier=1,
    )
    db.add(org)
    db.flush()

    user = UserAccount(
        org_id=org.id,
        email=email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role="manager",
        is_active=True,
    )
    db.add(user)
    db.flush()

    # Per-org seeding: default absence types + shift templates, org bound to
    # its jurisdiction (set on the organization row above).
    seed_org_defaults(db, org.id)
    # Commercial state from minute one. Every organization has a subscription,
    # starting as a trial, so the back office never has to guess what an org
    # with no row means.
    start_trial(db, org.id)
    # This account has been told nothing and asked nothing. Signup is the only
    # place that knows an org is genuinely new, so it is the only place that
    # opens the first-run questions -- see `open_first_run`. An org that skips
    # them, or never sees them, works exactly as every org did before.
    bp.open_first_run(db, org.id)
    db.flush()
    db.refresh(user)

    token = _issue_token(user)
    return TokenOut(
        access_token=token,
        token_type="bearer",
        user=_user_out(user, org.name, org.jurisdiction_code, org.client_key),
    )


@router.post("/login", response_model=TokenOut)
def login(
    payload: LoginIn, request: Request, db: Session = Depends(get_admin_db)
) -> TokenOut:
    # Written down and counted before anything is looked up: a refusal for
    # knocking too often cannot depend on -- and therefore cannot report --
    # whether this email has an account, and an attempt that is recorded before
    # the password is checked cannot be raced past by sending fifty at once.
    # See services/login_guard.py for the policy and for why the count is by
    # email rather than by a forgeable client address.
    knock = login_guard.attempt(request, login_guard.TENANT, payload.email)
    login_guard.reserve(db, knock)

    # Without spaces around it and whatever its case, the way it is stored
    # (`normalise_email`) and the way the attempts above are counted. Rows
    # from before addresses were normalised may still be mixed case: two that
    # differ only in case are settled by the one written exactly as typed,
    # then by the older.
    typed = (payload.email or "").strip()
    row = db.execute(
        select(
            UserAccount,
            Organization.name,
            Organization.jurisdiction_code,
            Organization.client_key,
            # Whether an employee's login still has somebody on the roster
            # behind it (app/deps.py), in the same read.
            Employee.id,
        )
        .join(Organization, Organization.id == UserAccount.org_id)
        .outerjoin(Employee, LIVE_EMPLOYEE_OF_LOGIN)
        .where(func.lower(UserAccount.email) == normalise_email(typed))
        .order_by(
            case((UserAccount.email == typed, 0), else_=1),
            UserAccount.created_at.asc(),
            UserAccount.id.asc(),
        )
        .limit(1)
    ).first()
    if row is None:
        # Nothing to check the password against, so it is checked against a
        # decoy of identical cost and the answer thrown away. Same refusal as
        # ever -- but now it also takes as long as ever, and the clock stops
        # being an oracle for which addresses are registered here. See
        # app/security.py for why the decoy is built once, at import.
        verify_against_decoy(payload.password)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail("invalid_credentials", "Invalid credentials"),
        )
    user, org_name, jurisdiction, client_key, live_employee_id = row
    # Verified BEFORE the account's state is read, and not after an `or` that
    # would skip it: a disabled account has to cost the same as a live one and
    # as no account at all, or "this address is disabled here" is the thing the
    # stopwatch reads instead. The same for an employee who is no longer on the
    # roster (`login_still_stands`): the right password, and the same refusal.
    password_ok = verify_password(payload.password, user.hashed_password)
    if (
        not password_ok
        or not user.is_active
        or not login_still_stands(user.role, live_employee_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail("invalid_credentials", "Invalid credentials"),
        )

    # The password was right, so the four wrong ones before it were somebody
    # forgetting which one it was, not somebody guessing. Forget them.
    login_guard.clear(db, knock)

    token = _issue_token(user)
    return TokenOut(
        access_token=token,
        token_type="bearer",
        user=_user_out(user, org_name, jurisdiction, client_key),
    )


@router.get("/me", response_model=UserOut)
def me(current_user: UserOut = Depends(get_current_user)) -> UserOut:
    return current_user
