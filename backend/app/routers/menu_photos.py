"""A dish's photo, for anybody who has its address.

THE ONE ROUTE OF THE MENU WITH NO TOKEN, and on purpose. The photos are shown
with <img>, and an <img> cannot send the token: it travels in the
`Authorization` header, and this app has no cookies. So the photo is served
to whoever asks for it by its id -- which is what makes it safe enough:

* The id is random (uuid4, 122 bits), is a photo's alone, and is given out
  only by the authenticated `GET /menu` and `GET /store/recipes` (the same
  business's managers), as a dish's `photo_url`. Nothing lists photos;
  guessing an id is guessing a uuid.
* What it opens is one photo of one dish on a menu, and nothing else: this
  table holds only that, and this route reads two columns of it.
* A new photo is a new id (routers/menu.py), and a deleted one is a 404 from
  the next request that reaches the server: an old link leads to nothing
  current. A phone that already loaded it keeps its copy (the cache below is
  private, so only that phone).

Because the id is the address of one set of bytes forever, the answer is
cached for a year, `immutable`: the team's phones fetch each photo once.

Core, not behind the Tienda door (app/main.py): the door is a dependency on
the signed-in user, and there is no user here. A business without Tienda has
no `GET /menu` to learn an id from, so nothing opens for it.

Read on the ADMIN session, which is not how a tenant table is read at request
time -- and it is the only way here: row-level security needs a business in
context, and the business is exactly what is not known until the row is
found. The read is by primary key, two columns, one table.

`Cross-Origin-Resource-Policy: same-site`: the photos are for this app's own
pages -- the same origin in production, another port of localhost in
development -- and a page elsewhere that learned an address cannot show one.
(The rest of the API has no such header because it needs a token; see
app/security_headers.py.)

The answer itself -- the headers, the bare 404 -- is app/photo_http.py's,
shared with the stock's products (routers/inventory_photos.py, 0042).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_admin_db
from app.models.menu import MenuDishPhoto
from app.photo_http import CACHE_FOREVER, SERVED, not_found, served

router = APIRouter(prefix="/menu/photos", tags=["menu"])

# The path a photo is served at, as `MenuDishOut.photo_url` gives it: the
# prefix of app/main.py (API_PREFIX) and this router's. Written out rather
# than imported from main, which imports this; tests/test_menu_photos.py
# checks it against the route itself.
PATH = "/api/v1/menu/photos/%s"

# How long a photo is kept by the phone that loaded it: a year, `immutable`
# (app/photo_http.py). Named here too, for tests/test_menu_photos.py.
__all__ = ["CACHE_FOREVER", "PATH", "photo_url", "router"]


def photo_url(photo_id: UUID) -> str:
    return PATH % photo_id


@router.get(
    "/{photo_id}",
    name="menu_photo",
    response_class=Response,
    responses=SERVED,
)
def get_photo(photo_id: UUID, db: Session = Depends(get_admin_db)) -> Response:
    row = db.execute(
        select(MenuDishPhoto.content_type, MenuDishPhoto.data).where(
            MenuDishPhoto.id == photo_id
        )
    ).one_or_none()
    if row is None:
        return not_found()
    return served(row.content_type, row.data)
