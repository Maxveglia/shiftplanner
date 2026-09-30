from __future__ import annotations

"""Accesos: the manager's window onto who can sign in, and as what.

Max, 28-sep-2026. The manager's own account is the one made at signup and
can do everything; from here they see everybody else's way in:

* the managers of the business;
* every live person of the roster with their login, or none -- given and
  taken away with the routes that always did it,
  ``/employees/{id}/account`` (routers/accounts.py), unchanged;
* the till's tablets: logins with role ``store``, one per till, at most
  ``MAX_STORE_ACCOUNTS``. What they may do is app/access.py's table; they are
  made, re-keyed and deleted here;
* the orphans: logins of role ``employee`` with nobody live on the roster
  behind them -- left by a removal from before removing somebody took their
  login with them (routers/employees.py), or linked to nobody. They open
  nothing (app/deps.py); they are listed here to be deleted, and this is the
  one route that deletes them (``DELETE /access/accounts/{id}``).

All of it is ``access.manage``, which only a manager has. Core, behind no
app's door (app/main.py): who can sign in is not a feature of one app.

Like routers/accounts.py this runs on the admin session, because an address
is unique across every business and so is a pre-tenant question. Every other
query below filters on the manager's own ``org_id`` by hand -- the RLS
barrier is not doing it for us here. A tablet of another business, or a
login here that is not a tablet, is 404 ``store_account_not_found``: whether
it exists elsewhere is not something to confirm. Likewise an orphan: another
business's login, or one of this business that is not an orphan -- a manager,
a tablet, a person still on the team -- is 404 ``account_not_found``.

Every write commits before it answers: the screen lists the accounts again
the moment it hears back, and the tablet is told to sign in again the moment
its password changes.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.access import Perm, Role, permissions_for, require_permission
from app.db import get_admin_db
from app.errors import detail
from app.models.employee import Employee
from app.models.user_account import UserAccount
from app.routers.auth import email_in_use, looks_like_an_email, normalise_email
from app.schemas.access import (
    AccessAccountOut,
    AccessEmployeeOut,
    AccessManagerOut,
    AccessOrphanOut,
    AccessOut,
    StoreAccountCreate,
    StoreAccountOut,
    StorePasswordIn,
)
from app.schemas.auth import UserOut
from app.security import hash_password
from app.services.employees import LIVE

router = APIRouter(prefix="/access", tags=["access"])

# Tablets per business. One per till; a bar with twenty tills is not the
# customer this is for, and the wall is what stops a loop from minting logins.
MAX_STORE_ACCOUNTS = 20

_MANAGES = require_permission(Perm.ACCESS_MANAGE)

def _store_out(account: UserAccount) -> StoreAccountOut:
    return StoreAccountOut(
        id=account.id,
        name=account.full_name,
        email=account.email,
        created_at=account.created_at,
        last_seen_at=account.last_seen_at,
    )


def _get_store(db: Session, org_id: UUID, account_id: UUID) -> UserAccount:
    account = db.execute(
        select(UserAccount)
        .where(UserAccount.org_id == org_id)
        .where(UserAccount.id == account_id)
        .where(UserAccount.role == Role.store.value)
    ).scalar_one_or_none()
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("store_account_not_found", "Till account not found"),
        )
    return account


def _email_taken() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=detail("email_taken", "Email already registered"),
    )


@router.get("", response_model=AccessOut)
def get_access(
    db: Session = Depends(get_admin_db),
    current_user: UserOut = Depends(_MANAGES),
) -> AccessOut:
    org_id = current_user.org_id
    accounts = (
        db.execute(
            select(UserAccount)
            .where(UserAccount.org_id == org_id)
            .order_by(UserAccount.created_at.asc(), UserAccount.id.asc())
        )
        .scalars()
        .all()
    )
    # A person's login is the EMPLOYEE login linked to them, as
    # routers/accounts.py finds it -- the same answer GET
    # /employees/{id}/account gives. A manager linked to somebody of the
    # roster is listed as a manager, not as that person's access to take away.
    by_employee = {
        a.employee_id: a
        for a in accounts
        if a.employee_id is not None and a.role == Role.employee.value
    }
    employees = (
        db.execute(
            select(Employee)
            .where(Employee.org_id == org_id)
            .where(LIVE)
            .order_by(func.lower(Employee.full_name).asc(), Employee.id.asc())
        )
        .scalars()
        .all()
    )
    live = {e.id for e in employees}
    return AccessOut(
        managers=[
            AccessManagerOut.model_validate(a)
            for a in accounts
            if a.role == Role.manager.value
        ],
        employees=[
            AccessEmployeeOut(
                employee_id=e.id,
                name=e.full_name,
                email=e.email,
                account=(
                    AccessAccountOut.model_validate(by_employee[e.id])
                    if e.id in by_employee
                    else None
                ),
            )
            for e in employees
        ],
        stores=[_store_out(a) for a in accounts if a.role == Role.store.value],
        # The same rule as app/deps.py's `login_still_stands`: an employee's
        # login with nobody live of this business behind it.
        orphans=[
            AccessOrphanOut.model_validate(a)
            for a in accounts
            if a.role == Role.employee.value and a.employee_id not in live
        ],
        roles={role.value: permissions_for(role) for role in Role},
    )


@router.post("/stores", response_model=StoreAccountOut, status_code=status.HTTP_201_CREATED)
def create_store_account(
    payload: StoreAccountCreate,
    db: Session = Depends(get_admin_db),
    current_user: UserOut = Depends(_MANAGES),
) -> StoreAccountOut:
    org_id = current_user.org_id
    # Already trimmed and lower case (schemas/access.py); its shape is checked
    # here so the refusal carries a code the screen can put into words.
    email = normalise_email(payload.email)
    if not looks_like_an_email(email):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("email_invalid", "This is not an email address"),
        )
    # One tablet made at a time per business, until this one commits: two at
    # once would both count nineteen and make twenty-one.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": "store_accounts:%s" % org_id},
    )
    how_many = db.execute(
        select(func.count())
        .select_from(UserAccount)
        .where(UserAccount.org_id == org_id)
        .where(UserAccount.role == Role.store.value)
    ).scalar_one()
    if how_many >= MAX_STORE_ACCOUNTS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail(
                "too_many_store_accounts",
                "A business can have at most %d till accounts" % MAX_STORE_ACCOUNTS,
                limit=MAX_STORE_ACCOUNTS,
            ),
        )

    # Global check, in any capitalisation: an address is one login across
    # every business, and login no longer tells cases apart.
    if email_in_use(db, email):
        raise _email_taken()

    account = UserAccount(
        org_id=org_id,
        email=email,
        hashed_password=hash_password(payload.password),
        full_name=payload.name,
        role=Role.store.value,
        employee_id=None,
        is_active=True,
    )
    try:
        # Two tablets given one address at once both pass the check above;
        # the second meets the UNIQUE on email here, and is the same 409.
        with db.begin_nested():
            db.add(account)
            db.flush()
    except IntegrityError:
        raise _email_taken()
    db.refresh(account)
    out = _store_out(account)
    db.commit()
    return out


@router.put("/stores/{account_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def set_store_password(
    account_id: UUID,
    payload: StorePasswordIn,
    db: Session = Depends(get_admin_db),
    current_user: UserOut = Depends(_MANAGES),
) -> Response:
    """A new password, and every session of the old one ends: the tablet goes
    back to the login screen (`session_epoch`, app/deps.py)."""
    account = _get_store(db, current_user.org_id, account_id)
    account.hashed_password = hash_password(payload.password)
    account.session_epoch = UserAccount.session_epoch + 1
    db.flush()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/stores/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_store_account(
    account_id: UUID,
    db: Session = Depends(get_admin_db),
    current_user: UserOut = Depends(_MANAGES),
) -> Response:
    """The tablet's login goes, and with it its session: the role is read
    from the database on every request. What it rang up stays -- the sales
    keep their lines and lose only who saved them (ON DELETE SET NULL)."""
    db.delete(_get_store(db, current_user.org_id, account_id))
    db.flush()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_orphan_account(
    account_id: UUID,
    db: Session = Depends(get_admin_db),
    current_user: UserOut = Depends(_MANAGES),
) -> Response:
    """Delete an orphan: an employee's login with nobody live of this
    business behind it (`AccessOut.orphans`). It already opens nothing
    (app/deps.py); this takes it off the list and frees its address.

    Nothing else goes through here: a manager, a tablet (DELETE
    /access/stores/{id}) or the login of somebody still on the team (DELETE
    /employees/{id}/account) is the same 404 as another business's login or
    none at all. What the orphan did stays, as with any login deleted (ON
    DELETE SET NULL).
    """
    org_id = current_user.org_id
    account = db.execute(
        select(UserAccount)
        .where(UserAccount.org_id == org_id)
        .where(UserAccount.id == account_id)
        .where(UserAccount.role == Role.employee.value)
        .where(
            ~select(Employee.id)
            .where(Employee.id == UserAccount.employee_id)
            .where(Employee.org_id == org_id)
            .where(LIVE)
            .exists()
        )
    ).scalar_one_or_none()
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("account_not_found", "Account not found"),
        )
    db.delete(account)
    db.flush()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
