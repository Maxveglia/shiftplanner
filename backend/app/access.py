"""Who may do what: the one table of roles and permissions.

Max, 28-sep-2026. Three kinds of login to one business:

* ``manager`` -- the owner's own account, made at signup. Everything, and the
  one who hands out the rest (``access.manage``: routers/access.py).
* ``employee`` -- one per person of the team, made by the manager from the
  roster (routers/accounts.py). Sees their own rota as always; in Inventario
  and Tienda, counts, receives, charges at the till and voids, and reads the
  rest. Does not add products or suppliers, edit the menu, edit a recipe,
  delete a count or a delivery, or type a sale by hand.
* ``store`` -- the till's tablet, next to the card reader. The employee's
  permissions, WITHOUT Turnos: it is not a person, it has no rota. Its session
  does not expire (``settings.store_token_expire_days``) and is ended by
  changing its password or deleting it (``session_epoch``, app/deps.py).

THE TABLE IS HERE AND NOWHERE ELSE. A route says which permission it needs
(`require_permission`), never which role: "an employee may count" is a line
of `_GRANTED` below, not an `if role == ...` in a router. The browser gets the
same list (`UserOut.permissions`, `WorkspaceOut.permissions`) and hides what
the server would refuse, so the two cannot disagree about a button.

A refusal says why in the code the client already translates: a permission
only the manager has is 403 ``manager_role_required`` -- what these routes
answered before roles existed. One the employee has and this role does not
(none today) is 403 ``role_not_allowed``.

Turnos is not in this table: an employee there is what it always was (their
own calendar, `assert_can_read_employee`), and the store simply does not have
the app (`apps_for`), so every route of it is the door's 403
``app_not_enabled``.
"""
from __future__ import annotations

from enum import Enum
from typing import Callable, Dict, FrozenSet, List, Sequence

from fastapi import Depends, HTTPException, status

from app.errors import detail
from app.schemas.auth import UserOut

# The roles, as `user_account.role` holds them (CHECK in migration 0046). The
# enum lives in schemas/enums.py because UserOut is typed with it and this
# module imports UserOut; it is re-exported here so the roles and what each
# may do are read from one place.
from app.schemas.enums import Role

__all__ = [
    "Role",
    "Perm",
    "ROLES",
    "permissions_for",
    "can",
    "apps_for",
    "require_permission",
    "MANAGER_ONLY",
]

ROLES: tuple = tuple(r.value for r in Role)


class Perm(str, Enum):
    """Every permission there is, in the order the browser receives them."""

    INVENTORY_VIEW = "inventory.view"
    INVENTORY_COUNT = "inventory.count"
    INVENTORY_RECEIVE = "inventory.receive"
    INVENTORY_PRODUCTS = "inventory.products"
    INVENTORY_RECORDS_DELETE = "inventory.records.delete"
    INVENTORY_SUPPLIERS = "inventory.suppliers"
    MENU_VIEW = "menu.view"
    MENU_EDIT = "menu.edit"
    STORE_CHARGE = "store.charge"
    STORE_SALES_MANUAL = "store.sales.manual"
    STORE_SALES_VIEW = "store.sales.view"
    STORE_SALES_VOID = "store.sales.void"
    STORE_STATS = "store.stats"
    # Reserved: the full statistics, the manager's, still to be built. No route
    # asks for it yet; it is in the list so the browser can already tell.
    STORE_STATS_FULL = "store.stats.full"
    STORE_RECIPES_VIEW = "store.recipes.view"
    STORE_RECIPES_EDIT = "store.recipes.edit"
    ACCESS_MANAGE = "access.manage"


# What the team does in Inventario and Tienda: see what there is, count it,
# take a delivery in, charge at the till, void a sale, read the menu, the
# statistics as they are today and the recipes. Everything else is the
# manager's.
_TEAM: FrozenSet[Perm] = frozenset(
    {
        Perm.INVENTORY_VIEW,
        Perm.INVENTORY_COUNT,
        Perm.INVENTORY_RECEIVE,
        Perm.MENU_VIEW,
        Perm.STORE_CHARGE,
        Perm.STORE_SALES_VIEW,
        Perm.STORE_SALES_VOID,
        Perm.STORE_STATS,
        Perm.STORE_RECIPES_VIEW,
    }
)

_GRANTED: Dict[str, FrozenSet[Perm]] = {
    Role.manager.value: frozenset(Perm),
    Role.employee.value: _TEAM,
    # The till's tablet: what an employee may do in the two shops. What it
    # does NOT have -- Turnos -- is not a permission but an app (`apps_for`).
    Role.store.value: _TEAM,
}

# Only the manager has these: refused with the code the client has always
# shown for "a manager has to do this".
MANAGER_ONLY: FrozenSet[Perm] = frozenset(
    p
    for p in Perm
    if not any(p in granted for role, granted in _GRANTED.items() if role != Role.manager.value)
)

# The apps a role never gets, whatever the business has switched on.
_NO_APPS: Dict[str, FrozenSet[str]] = {
    Role.store.value: frozenset({"shifts"}),
}


def _role(role) -> str:
    """The role as a plain string, whether it came as the enum or the column."""
    return str(getattr(role, "value", role))


def permissions_for(role) -> List[str]:
    """What `role` may do, as strings, in `Perm`'s order. An unknown role may
    do nothing: a row the CHECK would refuse is not a way in."""
    granted = _GRANTED.get(_role(role), frozenset())
    return [p.value for p in Perm if p in granted]


def can(user: UserOut, perm: Perm) -> bool:
    """Whether this signed-in user may do `perm`. Read from the table by the
    role, not from `user.permissions`: the table is the authority, the list
    on the session is its copy for the browser."""
    return Perm(perm) in _GRANTED.get(_role(user.role), frozenset())


def apps_for(role, org_apps: Sequence[str]) -> List[str]:
    """The business's apps, in its profile's order, as this role gets them.

    The store's tablet has no Turnos: it is not a person and has no rota. The
    one function every place that answers `apps` goes through -- the session
    (`get_current_user`), login and signup, and /workspace -- so what the
    browser mounts and what the doors let in are the same list.
    """
    hidden = _NO_APPS.get(_role(role), frozenset())
    return [key for key in org_apps if key not in hidden]


def require_permission(perm: Perm) -> Callable[..., UserOut]:
    """A dependency that lets the request through only if the user may `perm`,
    and hands the route the user, as `get_current_manager` did.

    Declared on each route, before any dependency that reads the body (the
    photos' `read_upload`): a refusal must come before a byte is read.

    The function carries `permission`, read by tests/test_access_roles.py,
    which walks every route of Inventario and Tienda and checks each one
    declares exactly one permission, the one its table says.
    """
    # Here and not at the top: app/deps.py reads this module's table on every
    # request (`permissions_for`, `apps_for`), so importing it back from the
    # top would be a circle. By the time a router calls this, deps is loaded.
    from app.deps import get_current_user

    perm = Perm(perm)

    def permission_granted(current_user: UserOut = Depends(get_current_user)) -> UserOut:
        if can(current_user, perm):
            return current_user
        if perm in MANAGER_ONLY:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=detail("manager_role_required", "Manager role required"),
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail(
                "role_not_allowed",
                "This account's role may not do that",
                permission=perm.value,
            ),
        )

    permission_granted.permission = perm  # type: ignore[attr-defined]
    permission_granted.__name__ = "require_permission_%s" % perm.value.replace(".", "_")
    return permission_granted
