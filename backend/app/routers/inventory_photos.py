"""A product's photo, for anybody who has its address.

THE ONE ROUTE OF THE INVENTORY WITH NO TOKEN, and on purpose -- the same as
the menu's photos (routers/menu_photos.py, whose docstring says it at length).
The photos are shown with <img>, and an <img> cannot send the token: it
travels in the `Authorization` header, and this app has no cookies. So the
photo is served to whoever asks for it by its id, which is what makes it safe
enough:

* The id is random (uuid4, 122 bits), is a photo's alone, and is given out
  only by the authenticated routes that show products -- `photo_url` on the
  stock's list, a count's and a delivery's lines, a recipe's ingredients.
  Nothing lists photos; guessing an id is guessing a uuid.
* What it opens is one photo of one product on a shelf, and nothing else: this
  table holds only that, and this route reads two columns of it.
* A new photo is a new id (routers/inventory.py), and a deleted one is a 404
  from the next request that reaches the server: an old link leads to nothing
  current.

Because the id is the address of one set of bytes forever, the answer is
cached for a year, `immutable` (app/photo_http.py, shared with the menu).

Core, not behind the Inventario door (app/main.py): the door is a dependency
on the signed-in user, and there is no user here. A business without
Inventario has no list of products to learn an id from.

Read on the ADMIN session: row-level security needs a business in context,
and the business is exactly what is not known until the row is found. The read
is by primary key, two columns, one table.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_admin_db
from app.models.inventory import InventoryItemPhoto
from app.photo_http import SERVED, not_found, served

router = APIRouter(prefix="/inventory/photos", tags=["inventory"])

# The path a photo is served at, as `photo_url` gives it: the prefix of
# app/main.py (API_PREFIX) and this router's. Written out rather than imported
# from main, which imports this; tests/test_inventory_photos.py checks it
# against the route itself.
PATH = "/api/v1/inventory/photos/%s"


def photo_url(photo_id: UUID) -> str:
    return PATH % photo_id


def photo_url_or_none(photo_id: Optional[UUID]) -> Optional[str]:
    """For a row read with an outer join: no photo, no address."""
    return None if photo_id is None else PATH % photo_id


@router.get(
    "/{photo_id}",
    name="inventory_photo",
    response_class=Response,
    responses=SERVED,
)
def get_photo(photo_id: UUID, db: Session = Depends(get_admin_db)) -> Response:
    row = db.execute(
        select(InventoryItemPhoto.content_type, InventoryItemPhoto.data).where(
            InventoryItemPhoto.id == photo_id
        )
    ).one_or_none()
    if row is None:
        return not_found()
    return served(row.content_type, row.data)
