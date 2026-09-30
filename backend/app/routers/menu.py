"""The menu: the restaurant's carta, sections and the dishes in each.

Written by hand by the manager, dish by dish, and read by the whole team: the
waiter asked "what is there without gluten?" answers from their phone. So
reading is for anyone of the business (`menu.view`) and writing -- a dish
marked sold out included -- is the manager's (`menu.edit`, app/access.py); an
employee or the till's tablet that tries gets the same 403 as everywhere
else. Nothing here is public: there is no menu for customers.

Only the carta: what is offered, not what it is made of (see migration
0033). What a dish is made of -- its recipe, and so what selling it takes off
the stock -- is Tienda > Recetas, routers/recipes.py, which takes this
module's lock for its writes.

The order is the manager's, not the alphabet's: `position`, with the moment a
row was added breaking a tie. A new section goes to the end of the menu and a
new dish to the end of its section. Reordering sends the whole list in its
new order, and the list has to be exactly what is there -- one missing or one
left over means the screen was looking at another menu than this one (another
tab, another manager), and guessing which it meant is how a dish disappears.

An id of another business is a 404, never a 403: whether a section exists in
somebody else's menu is not something to confirm. Every query is scoped by
`org_id` in the WHERE and behind `org_isolation` as well, like every other
tenant table.

A dish can have a photo (migration 0038): put and taken away here, by the
manager, and served from `routers/menu_photos.py` -- the one route of the menu
without a token, since an <img> cannot send one. A dish carries the photo's
address, `photo_url`; the menu is read without ever loading a picture.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import case, delete, func, select, text, update
from sqlalchemy.orm import Session

from app.access import Perm, require_permission
from app.db import get_db
from app.errors import detail
from app.models.menu import MenuDish, MenuDishPhoto, MenuRecipeComponent, MenuSection
from app.photo_http import PHOTO_BODY, Upload, checked, read_upload
from app.routers.menu_photos import photo_url
from app.schemas import limits
from app.schemas.auth import UserOut
from app.schemas.menu import (
    MenuDishCreate,
    MenuDishOrderIn,
    MenuDishOut,
    MenuDishUpdate,
    MenuOut,
    MenuSectionIn,
    MenuSectionOrderIn,
    MenuSectionOut,
    canonical_allergens,
)

router = APIRouter(prefix="/menu", tags=["menu"])


# --- Reading ----------------------------------------------------------------


# A dish's photo as the menu needs it: its id (for the address) and whether
# its name is printed on it. Never its bytes.
Photo = Tuple[UUID, bool]


def _dish_out(dish: MenuDish, photo: Optional[Photo]) -> MenuDishOut:
    photo_id, labelled = photo if photo is not None else (None, False)
    return MenuDishOut(
        id=dish.id,
        section_id=dish.section_id,
        name=dish.name,
        description=dish.description,
        price=None if dish.price is None else float(dish.price),
        allergens=canonical_allergens(dish.allergens),
        available=dish.available,
        position=dish.position,
        photo_url=None if photo_id is None else photo_url(photo_id),
        photo_labelled=labelled,
    )


def _dishes(
    db: Session, org_id: UUID, section_id: Optional[UUID] = None
) -> List[Tuple[MenuDish, Optional[Photo]]]:
    """This business's dishes (or one section's), in their order, each with
    its photo's id and label (None for none).

    Those two of the photo and nothing else: a menu of a hundred photos is
    read without one byte of a picture.

    `populate_existing` because a reorder writes the positions with one UPDATE
    that does not touch the objects already loaded in this session: what is
    read back has to be the row, not the copy from before.
    """
    query = (
        select(MenuDish, MenuDishPhoto.id, MenuDishPhoto.labelled)
        .outerjoin(
            MenuDishPhoto,
            (MenuDishPhoto.dish_id == MenuDish.id)
            & (MenuDishPhoto.org_id == MenuDish.org_id),
        )
        .where(MenuDish.org_id == org_id)
    )
    if section_id is not None:
        query = query.where(MenuDish.section_id == section_id)
    rows = db.execute(
        query.order_by(MenuDish.position, MenuDish.created_at, MenuDish.id)
        .execution_options(populate_existing=True)
    ).tuples()
    return [
        (dish, None if photo_id is None else (photo_id, bool(labelled)))
        for dish, photo_id, labelled in rows
    ]


def _photo(db: Session, org_id: UUID, dish_id: UUID) -> Optional[Photo]:
    row = db.execute(
        select(MenuDishPhoto.id, MenuDishPhoto.labelled)
        .where(MenuDishPhoto.org_id == org_id)
        .where(MenuDishPhoto.dish_id == dish_id)
    ).first()
    return None if row is None else (row[0], bool(row[1]))


def _menu(db: Session, org_id: UUID) -> MenuOut:
    """The whole menu, in two reads whatever its size (the photos' ids come
    with the dishes, in a join)."""
    sections = list(
        db.execute(
            select(MenuSection)
            .where(MenuSection.org_id == org_id)
            .order_by(MenuSection.position, MenuSection.created_at, MenuSection.id)
            .execution_options(populate_existing=True)
        ).scalars()
    )
    by_section: Dict[UUID, List[MenuDishOut]] = defaultdict(list)
    for dish, photo in _dishes(db, org_id):
        by_section[dish.section_id].append(_dish_out(dish, photo))
    return MenuOut(
        sections=[
            MenuSectionOut(
                id=s.id, name=s.name, position=s.position, dishes=by_section[s.id]
            )
            for s in sections
        ]
    )


def _section_out(db: Session, section: MenuSection) -> MenuSectionOut:
    return MenuSectionOut(
        id=section.id,
        name=section.name,
        position=section.position,
        dishes=[_dish_out(d, p) for d, p in _dishes(db, section.org_id, section.id)],
    )


# --- Finding one, or saying it is not there ---------------------------------


def _get_section(db: Session, org_id: UUID, section_id: UUID) -> MenuSection:
    section = db.execute(
        select(MenuSection)
        .where(MenuSection.org_id == org_id)
        .where(MenuSection.id == section_id)
    ).scalar_one_or_none()
    if section is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("menu_section_not_found", "Menu section not found"),
        )
    return section


def _get_dish(db: Session, org_id: UUID, dish_id: UUID) -> MenuDish:
    dish = db.execute(
        select(MenuDish).where(MenuDish.org_id == org_id).where(MenuDish.id == dish_id)
    ).scalar_one_or_none()
    if dish is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("menu_dish_not_found", "Dish not found"),
        )
    return dish


# --- Walls and order ----------------------------------------------------------


def _one_writer(db: Session, org_id: UUID) -> None:
    """One change to a business's menu at a time, until this one commits.

    Every write takes it first. Without it, a double click on "add section" at
    49 counts 49 twice and stores 51 -- one past the wall that the reorder is
    also held to -- two new dishes take the same position, and a dish created
    (or edited) in a section being deleted meets a row that is gone: a foreign
    key error or a stale update, which is a 500. Behind the lock the second
    request reads what the first one left, and "gone" is a 404. A menu is edited
    by hand; queuing its writes costs nobody anything.

    Namespaced ("menu:") so it is not the schedule's lock for the same business
    (`services/schedule.py` takes `hashtext(org_id)`).
    """
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": "menu:%s" % org_id},
    )


def _too_many(what: str, limit: int) -> HTTPException:
    """The ceiling of `limits.py`: a wall a script reaches, not a real menu.

    `what` is "sections" or "dishes", so the sentence can say which.
    """
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=detail(
            "menu_too_many",
            "A menu holds at most %d %s" % (limit, what),
            what=what,
            limit=limit,
        ),
    )


def _how_many(db: Session, model, org_id: UUID) -> int:
    return db.execute(
        select(func.count()).select_from(model).where(model.org_id == org_id)
    ).scalar_one()


def _at_the_end(db: Session, column, *where) -> int:
    """One past the last position among these rows; 0 when there are none."""
    return db.execute(
        select(func.coalesce(func.max(column), -1) + 1).where(*where)
    ).scalar_one()


def _exactly(sent: Sequence[UUID], there: Iterable[UUID]) -> None:
    """422 unless `sent` is every one of `there`, once each.

    Not a merge: a list with one missing or one extra is a screen showing a
    different menu than the one stored, and any guess at what it meant puts a
    dish somewhere nobody asked for.
    """
    if len(set(sent)) != len(sent) or set(sent) != set(there):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "menu_order_mismatch",
                "The new order must list every item exactly once",
            ),
        )


def _renumber(db: Session, model, org_id: UUID, ids: Sequence[UUID]) -> None:
    """Positions 0, 1, 2... in the order given, in one UPDATE.

    Synchronising the session is left out on purpose: whatever is read after
    this is read with `populate_existing` (see `_dishes`).
    """
    if not ids:
        return
    db.execute(
        update(model)
        .where(model.org_id == org_id)
        .where(model.id.in_(ids))
        .values(position=case({i: n for n, i in enumerate(ids)}, value=model.id))
        .execution_options(synchronize_session=False)
    )


def _money(value: Optional[float]) -> Optional[Decimal]:
    # Already rounded to the cent by the schema; a Decimal of its shortest
    # spelling is exactly that cent, and numeric(8, 2) is given nothing to round.
    return None if value is None else Decimal(str(value))


def _answer(db: Session, out):
    """Commit, then answer with what was read BEFORE the commit.

    `get_db` commits when the request closes, which FastAPI does after the
    body has gone -- and the screen refetches the menu the moment it hears
    200, so it could read the menu of before: a new dish vanishing (and typed
    again, twice), a deleted one coming back, "sold out" snapping off. Same
    reason as PUT /schedule/draft and routers/contracts.py.

    `out` is read first because the tenant the RLS policies see is SET LOCAL:
    after the commit, a lazy load would be a read with no business at all.
    The commit also releases `_one_writer`'s lock.
    """
    db.commit()
    return out


# --- The menu -------------------------------------------------------------


@router.get("", response_model=MenuOut)
def get_menu(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.MENU_VIEW)),
) -> MenuOut:
    """The whole menu, for anyone of the business. Sold-out dishes included:
    the screen shows them as such rather than pretending they are not on it."""
    return _menu(db, current_user.org_id)


# --- Sections -----------------------------------------------------------------
# `/sections/order` is declared before `/sections/{section_id}` so "order" is
# never read as an id. (They are different methods today; this keeps it so.)


@router.put("/sections/order", response_model=MenuOut)
def order_sections(
    payload: MenuSectionOrderIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.MENU_EDIT)),
) -> MenuOut:
    _one_writer(db, current_user.org_id)
    org_id = current_user.org_id
    there = db.execute(
        select(MenuSection.id).where(MenuSection.org_id == org_id)
    ).scalars()
    _exactly(payload.ids, there)
    _renumber(db, MenuSection, org_id, payload.ids)
    db.flush()
    return _answer(db, _menu(db, org_id))


@router.post(
    "/sections", response_model=MenuSectionOut, status_code=status.HTTP_201_CREATED
)
def create_section(
    payload: MenuSectionIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.MENU_EDIT)),
) -> MenuSectionOut:
    _one_writer(db, current_user.org_id)
    org_id = current_user.org_id
    if _how_many(db, MenuSection, org_id) >= limits.MENU_SECTIONS:
        raise _too_many("sections", limits.MENU_SECTIONS)
    section = MenuSection(
        org_id=org_id,
        name=payload.name,
        position=_at_the_end(db, MenuSection.position, MenuSection.org_id == org_id),
    )
    db.add(section)
    db.flush()
    db.refresh(section)
    return _answer(
        db,
        MenuSectionOut(
            id=section.id, name=section.name, position=section.position, dishes=[]
        ),
    )


@router.patch("/sections/{section_id}", response_model=MenuSectionOut)
def rename_section(
    section_id: UUID,
    payload: MenuSectionIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.MENU_EDIT)),
) -> MenuSectionOut:
    _one_writer(db, current_user.org_id)
    section = _get_section(db, current_user.org_id, section_id)
    section.name = payload.name
    db.flush()
    return _answer(db, _section_out(db, section))


def _combos_holding(
    db: Session, org_id: UUID, dish_ids: Sequence[UUID], section_id: Optional[UUID] = None
) -> List[str]:
    """The combos (by name, in menu order) that include any of these dishes --
    leaving out, when a section is being deleted, the combos in that section,
    which go with it.

    A dish inside a combo is not deleted from under it: the combo would go on
    selling and stop taking that dish's ingredients off the stock, and nothing
    on the Menu page would say so (recipes are not shown there). The manager is
    told which combos to change first, in Tienda > Recetas.
    """
    if not dish_ids:
        return []
    combo = MenuDish.__table__.alias("combo")
    query = (
        select(combo.c.name)
        .select_from(
            MenuRecipeComponent.__table__.join(
                combo, combo.c.id == MenuRecipeComponent.dish_id
            )
        )
        .where(MenuRecipeComponent.org_id == org_id)
        .where(combo.c.org_id == org_id)
        .where(MenuRecipeComponent.component_id.in_(dish_ids))
        .distinct()
    )
    if section_id is not None:
        query = query.where(combo.c.section_id != section_id)
    return sorted(db.execute(query).scalars(), key=str.lower)


def _in_combo(body: dict) -> HTTPException:
    """409 with the combos named. Built by the caller with the code spelled out
    (tests/test_error_codes.py reads the codes off the `detail(...)` calls)."""
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=body)


@router.delete("/sections/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_section(
    section_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.MENU_EDIT)),
) -> Response:
    """Its dishes go with it: ON DELETE CASCADE, in the same statement. The
    screen says how many before it asks. Not while a dish of it is inside a
    combo of another section (409, see `_combos_holding`)."""
    _one_writer(db, current_user.org_id)
    org_id = current_user.org_id
    section = _get_section(db, org_id, section_id)
    dish_ids = list(
        db.execute(
            select(MenuDish.id)
            .where(MenuDish.org_id == org_id)
            .where(MenuDish.section_id == section.id)
        ).scalars()
    )
    combos = _combos_holding(db, org_id, dish_ids, section_id=section.id)
    if combos:
        raise _in_combo(
            detail(
                "menu_section_in_combo",
                "A dish of this section is inside a combo of another section",
                combos=", ".join(combos),
            )
        )
    db.delete(section)
    db.flush()
    return _answer(db, Response(status_code=status.HTTP_204_NO_CONTENT))


@router.put("/sections/{section_id}/dishes/order", response_model=MenuOut)
def order_dishes(
    section_id: UUID,
    payload: MenuDishOrderIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.MENU_EDIT)),
) -> MenuOut:
    _one_writer(db, current_user.org_id)
    org_id = current_user.org_id
    section = _get_section(db, org_id, section_id)
    there = db.execute(
        select(MenuDish.id)
        .where(MenuDish.org_id == org_id)
        .where(MenuDish.section_id == section.id)
    ).scalars()
    _exactly(payload.ids, there)
    _renumber(db, MenuDish, org_id, payload.ids)
    db.flush()
    return _answer(db, _menu(db, org_id))


# --- Dishes -------------------------------------------------------------------


@router.post("/dishes", response_model=MenuDishOut, status_code=status.HTTP_201_CREATED)
def create_dish(
    payload: MenuDishCreate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.MENU_EDIT)),
) -> MenuDishOut:
    _one_writer(db, current_user.org_id)
    org_id = current_user.org_id
    # A section of another business is "not found", exactly like one that
    # never existed.
    section = _get_section(db, org_id, payload.section_id)
    if _how_many(db, MenuDish, org_id) >= limits.MENU_DISHES:
        raise _too_many("dishes", limits.MENU_DISHES)
    dish = MenuDish(
        org_id=org_id,
        section_id=section.id,
        name=payload.name,
        description=payload.description,
        price=_money(payload.price),
        allergens=payload.allergens,
        available=payload.available,
        position=_at_the_end(
            db,
            MenuDish.position,
            MenuDish.org_id == org_id,
            MenuDish.section_id == section.id,
        ),
    )
    db.add(dish)
    db.flush()
    db.refresh(dish)
    return _answer(db, _dish_out(dish, None))


@router.patch("/dishes/{dish_id}", response_model=MenuDishOut)
def update_dish(
    dish_id: UUID,
    payload: MenuDishUpdate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.MENU_EDIT)),
) -> MenuDishOut:
    """Only what is sent is changed (see `MenuDishUpdate`).

    A new `section_id` moves the dish to the END of that section: where in the
    middle it should go is a second question, asked by reordering.
    """
    _one_writer(db, current_user.org_id)
    org_id = current_user.org_id
    dish = _get_dish(db, org_id, dish_id)
    sent = payload.model_fields_set
    if (
        "section_id" in sent
        and payload.section_id is not None
        and payload.section_id != dish.section_id
    ):
        target = _get_section(db, org_id, payload.section_id)
        dish.position = _at_the_end(
            db,
            MenuDish.position,
            MenuDish.org_id == org_id,
            MenuDish.section_id == target.id,
        )
        dish.section_id = target.id
    if "name" in sent and payload.name is not None:
        dish.name = payload.name
    if "description" in sent:
        dish.description = payload.description
    if "price" in sent:
        dish.price = _money(payload.price)
    if "allergens" in sent and payload.allergens is not None:
        dish.allergens = payload.allergens
    if "available" in sent and payload.available is not None:
        dish.available = payload.available
    dish.updated_at = datetime.now(timezone.utc)
    db.flush()
    db.refresh(dish)
    return _answer(db, _dish_out(dish, _photo(db, org_id, dish.id)))


@router.delete("/dishes/{dish_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dish(
    dish_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.MENU_EDIT)),
) -> Response:
    """Its photo goes with it: ON DELETE CASCADE (0038), and so does its own
    recipe -- but not while it is inside a combo (409, see `_combos_holding`)."""
    _one_writer(db, current_user.org_id)
    dish = _get_dish(db, current_user.org_id, dish_id)
    combos = _combos_holding(db, current_user.org_id, [dish.id])
    if combos:
        raise _in_combo(
            detail("menu_dish_in_combo", "This dish is inside a combo", combos=", ".join(combos))
        )
    db.delete(dish)
    db.flush()
    return _answer(db, Response(status_code=status.HTTP_204_NO_CONTENT))


# --- A dish's photo -------------------------------------------------------------


# The body is read, checked and refused by app/photo_http.py, shared with the
# stock's products: the same wall and the same codes for both.


def _drop_photo(db: Session, org_id: UUID, dish_id: UUID) -> None:
    db.execute(
        delete(MenuDishPhoto)
        .where(MenuDishPhoto.org_id == org_id)
        .where(MenuDishPhoto.dish_id == dish_id)
    )


@router.put(
    "/dishes/{dish_id}/photo", response_model=MenuDishOut, openapi_extra=PHOTO_BODY
)
def put_dish_photo(
    dish_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.MENU_EDIT)),
    # AFTER the permission: whoever may not is turned away before a byte is read.
    upload: Upload = Depends(read_upload),
) -> MenuDishOut:
    """Put a photo on a dish, or change the one it has; answered with the dish.

    The body is the image, sent with its own Content-Type (image/jpeg, png or
    webp). A dish that had a photo gets a NEW one, with a new id -- so a new
    `photo_url`, and no phone keeps showing the old one from its cache.
    """
    photo = checked(upload, "dish")
    _one_writer(db, current_user.org_id)
    org_id = current_user.org_id
    dish = _get_dish(db, org_id, dish_id)
    # Out with the old row first, in its own statement: dish_id is UNIQUE,
    # and the new row is a new id rather than the old one overwritten.
    _drop_photo(db, org_id, dish.id)
    new = MenuDishPhoto(
        org_id=org_id,
        dish_id=dish.id,
        content_type=photo.content_type,
        data=upload.data,
        width=photo.width,
        height=photo.height,
    )
    db.add(new)
    db.flush()
    # An upload is a picture of the dish, never one with its name on it.
    return _answer(db, _dish_out(dish, (new.id, False)))


@router.delete("/dishes/{dish_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
def delete_dish_photo(
    dish_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.MENU_EDIT)),
) -> Response:
    """Take the photo off a dish. A dish with none is already as asked: 204.
    Its address is a 404 from now on."""
    _one_writer(db, current_user.org_id)
    org_id = current_user.org_id
    dish = _get_dish(db, org_id, dish_id)
    _drop_photo(db, org_id, dish.id)
    return _answer(db, Response(status_code=status.HTTP_204_NO_CONTENT))
