"""Suppliers: who a business buys its products from (Inventario > Proveedores).

Max, 27-sep-2026: when a product runs low, the app prepares the order to its
supplier and opens WhatsApp with the text already written, one message per
supplier. A supplier is a name and, optionally, the phone its orders go to; a
product says which one it is bought from (`supplier_id`, routers/
inventory.py). Building the message and the link is the browser's; nothing is
sent from here.

THE PHONE is kept as the manager wrote it -- "+34 612 34 56 78", "(93)
123-45-67" -- since that is what the screen shows back. It has to be a phone:
digits, spaces, hyphens, parentheses and one leading "+", 7 to 15 digits, at
most 40 characters. Anything else is 422 `inventory_supplier_phone_invalid`,
and migration 0045's CHECK says the same.

THE NAME is one per business whatever its case: a second "makro" next to
"Makro" is 409 `inventory_supplier_name_taken`, naming the one that has it.

DELETING ONE leaves its products without a supplier, in the same transaction:
this route nulls them first, and the key on (supplier_id, org_id) only
refuses (see migration 0045 for why the key does not do it itself).

Every write commits before it answers (`_answer`): the product form adds a
supplier and, the moment it hears back, saves the product with it -- a
request that would find no supplier if this one had not committed yet.

Behind the Inventario's door (app/main.py). The whole team reads the list --
ordering from the till needs it -- and only the manager adds, changes or
deletes a supplier (app/access.py). Every query is scoped by `org_id` in the
WHERE and behind `org_isolation` as well; another business's supplier is a
404, never a 403.
"""
from __future__ import annotations

import re
from typing import Callable, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.access import Perm, require_permission
from app.db import get_db
from app.errors import detail
from app.models.inventory import InventoryItem, InventorySupplier
from app.schemas.auth import UserOut
from app.schemas.inventory import (
    SUPPLIER_PHONE,
    InventorySupplierIn,
    InventorySupplierOut,
    InventorySupplierUpdate,
)

router = APIRouter(prefix="/inventory/suppliers", tags=["inventory"])

# Digits, spaces, hyphens and parentheses, after one "+" at most, at the
# start. ASCII digits only: a phone typed with Arabic-Indic numerals is not
# one WhatsApp's link takes.
_PHONE_SHAPE = re.compile(r"\+?[0-9 ()\-]*", re.ASCII)
PHONE_DIGITS = (7, 15)


def phone_is_valid(phone: str) -> bool:
    """A phone as a manager writes one: see the module's docstring."""
    if len(phone) > SUPPLIER_PHONE or not _PHONE_SHAPE.fullmatch(phone):
        return False
    digits = sum(1 for c in phone if "0" <= c <= "9")
    return PHONE_DIGITS[0] <= digits <= PHONE_DIGITS[1]


def _checked_phone(phone: Optional[str]) -> Optional[str]:
    if phone is not None and not phone_is_valid(phone):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "inventory_supplier_phone_invalid",
                "A phone is 7 to 15 digits, with spaces, hyphens, parentheses "
                "and a leading + at most",
            ),
        )
    return phone


def _taken(name: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=detail(
            "inventory_supplier_name_taken",
            "There is already a supplier called %s" % name,
            name=name,
        ),
    )


def _holder(
    db: Session, org_id: UUID, name: str, besides: Optional[UUID] = None
) -> Optional[str]:
    """The name of the supplier of this business that already has this one,
    whatever its case -- other than `besides`."""
    query = (
        select(InventorySupplier.name)
        .where(InventorySupplier.org_id == org_id)
        .where(func.lower(InventorySupplier.name) == func.lower(name))
    )
    if besides is not None:
        query = query.where(InventorySupplier.id != besides)
    return db.execute(query.limit(1)).scalar_one_or_none()


def _get(
    db: Session, org_id: UUID, supplier_id: UUID, lock: bool = False
) -> InventorySupplier:
    query = (
        select(InventorySupplier)
        .where(InventorySupplier.org_id == org_id)
        .where(InventorySupplier.id == supplier_id)
    )
    if lock:
        query = query.with_for_update()
    supplier = db.execute(query).scalar_one_or_none()
    if supplier is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("inventory_supplier_not_found", "Supplier not found"),
        )
    return supplier


def _item_counts(db: Session, org_id: UUID, ids: Optional[List[UUID]] = None) -> dict:
    """How many products on the list (not archived) each supplier has, in one
    read."""
    query = (
        select(InventoryItem.supplier_id, func.count())
        .where(InventoryItem.org_id == org_id)
        .where(InventoryItem.supplier_id.is_not(None))
        .where(InventoryItem.archived_at.is_(None))
        .group_by(InventoryItem.supplier_id)
    )
    if ids is not None:
        query = query.where(InventoryItem.supplier_id.in_(ids))
    return dict(db.execute(query).all())


def _out(supplier: InventorySupplier, counts: dict) -> InventorySupplierOut:
    return InventorySupplierOut(
        id=supplier.id,
        name=supplier.name,
        phone=supplier.phone,
        item_count=int(counts.get(supplier.id, 0)),
    )


def _written(
    db: Session, org_id: UUID, name: str, own_id: Optional[UUID], write: Callable[[], None]
) -> None:
    """Make the change (`write`) and flush it, turning the UNIQUE on (org_id,
    lower(name)) into the 409 the check beforehand gives -- for the request
    that slips in between. Inside a savepoint, so the transaction is still
    usable to look the name up; and the change is made INSIDE it, because
    `begin_nested` flushes what is pending before the SAVEPOINT."""
    try:
        with db.begin_nested():
            write()
            db.flush()
    except IntegrityError as exc:
        raise _taken(_holder(db, org_id, name, besides=own_id) or name) from exc


def _answer(db: Session, out):
    """Commit, then answer with what was read BEFORE the commit (see the
    module's docstring; the same reason as routers/inventory.py's)."""
    db.commit()
    return out


@router.get("", response_model=List[InventorySupplierOut])
def list_suppliers(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_VIEW)),
) -> List[InventorySupplierOut]:
    """Every supplier of the business, by name, each with how many products
    on the list say they are bought from it."""
    org_id = current_user.org_id
    suppliers = db.execute(
        select(InventorySupplier)
        .where(InventorySupplier.org_id == org_id)
        .order_by(func.lower(InventorySupplier.name), InventorySupplier.id)
    ).scalars().all()
    counts = _item_counts(db, org_id)
    return [_out(s, counts) for s in suppliers]


@router.post("", response_model=InventorySupplierOut, status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: InventorySupplierIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_SUPPLIERS)),
) -> InventorySupplierOut:
    org_id = current_user.org_id
    phone = _checked_phone(payload.phone)
    holder = _holder(db, org_id, payload.name)
    if holder is not None:
        raise _taken(holder)
    supplier = InventorySupplier(org_id=org_id, name=payload.name, phone=phone)
    _written(db, org_id, payload.name, None, lambda: db.add(supplier))
    db.refresh(supplier)
    return _answer(db, _out(supplier, {}))


@router.patch("/{supplier_id}", response_model=InventorySupplierOut)
def update_supplier(
    supplier_id: UUID,
    payload: InventorySupplierUpdate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_SUPPLIERS)),
) -> InventorySupplierOut:
    """Change its name, its phone or both; `phone: null` takes the phone off."""
    org_id = current_user.org_id
    # Locked: a supplier deleted at the same moment is waited for and then
    # not found (404), rather than updated after it has gone (a 500).
    supplier = _get(db, org_id, supplier_id, lock=True)
    sent = payload.model_fields_set
    changes = {}
    if "phone" in sent:
        changes["phone"] = _checked_phone(payload.phone)
    if "name" in sent and payload.name is not None:
        holder = _holder(db, org_id, payload.name, besides=supplier.id)
        if holder is not None:
            raise _taken(holder)
        changes["name"] = payload.name

    def write() -> None:
        for column, value in changes.items():
            setattr(supplier, column, value)

    _written(db, org_id, changes.get("name", supplier.name), supplier.id, write)
    db.refresh(supplier)
    return _answer(db, _out(supplier, _item_counts(db, org_id, [supplier.id])))


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier(
    supplier_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_SUPPLIERS)),
) -> Response:
    """Delete it; its products -- archived ones too -- are left without a
    supplier, in the same transaction.

    The supplier's row is locked first. A product being saved with it at
    this moment holds it FOR KEY SHARE (routers/inventory.py::
    _known_supplier): this waits for that save, and then finds its product
    among the ones to leave without a supplier -- rather than deleting a
    supplier a product has just been given, which the key would refuse at
    the commit."""
    org_id = current_user.org_id
    supplier = _get(db, org_id, supplier_id, lock=True)
    db.execute(
        update(InventoryItem)
        .where(InventoryItem.org_id == org_id)
        .where(InventoryItem.supplier_id == supplier.id)
        .values(supplier_id=None)
        .execution_options(synchronize_session=False)
    )
    db.delete(supplier)
    db.flush()
    return _answer(db, Response(status_code=status.HTTP_204_NO_CONTENT))
