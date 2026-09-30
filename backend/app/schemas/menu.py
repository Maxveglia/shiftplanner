from __future__ import annotations

import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas import limits
from app.schemas.inventory import _clean, _without_nul

# The fourteen allergens a restaurant must declare (Regulation (EU)
# 1169/2011, Annex II), as the codes that travel and are stored, in the order
# every screen shows them. The frontend's `lib/menu` has the same list in the
# same order, and migration 0033 the same fourteen in its CHECK.
ALLERGENS = (
    "gluten",
    "crustaceans",
    "eggs",
    "fish",
    "peanuts",
    "soy",
    "milk",
    "nuts",
    "celery",
    "mustard",
    "sesame",
    "sulphites",
    "lupin",
    "molluscs",
)

# The CHECKs of migration 0033, said again here so a name that is too long is
# a 422 in words rather than an IntegrityError, which is a 500. Tighter than
# `limits.NAME` on purpose: a menu line is read on a phone.
SECTION_NAME = 80
DISH_NAME = 120
DESCRIPTION = 500

# numeric(8, 2): strictly below this, as stored. See `_to_the_cent`.
PRICE_CEILING = 100_000

# Allergens sent for one dish. Fourteen exist; a repeat is forgiven (and
# stored once), so the list may be longer than fourteen -- but not a megabyte.
ALLERGENS_SENT = 64

_CENT = Decimal("0.01")


def _to_the_cent(v: Optional[float]) -> Optional[float]:
    """To the cent, and under the ceiling AS STORED, not only as sent.

    Rounded before it is checked, for the reason `_under_ceiling` in
    `schemas/inventory.py` is: 99999.996 passes `lt=100000`, is rounded up to
    100000.00 on the way in and overflows numeric(8, 2) -- a 500, not a 422.
    What is checked has to be what is written.

    Half up, from the decimal the client wrote, as a person and as Postgres
    round money: Python's own `round(2.675, 2)` is 2.67, because the float
    closest to 2.675 is a hair under it.
    """
    if v is None:
        return None
    stored = Decimal(str(v)).quantize(_CENT, rounding=ROUND_HALF_UP)
    if stored < 0:
        raise ValueError("must not be negative")
    if stored >= PRICE_CEILING:
        raise ValueError("must be below %d" % PRICE_CEILING)
    return float(stored)


def canonical_allergens(codes) -> List[str]:
    """Once each, in the order of `ALLERGENS`; anything else dropped.

    On the way in, `_known_allergens` has already refused an unknown code, so
    here this only orders and de-duplicates. On the way out it is also a guard: the
    column's CHECK keeps it to the fourteen, and a phone is never sent a code
    it has no word for.
    """
    given = set(codes or ())
    return [code for code in ALLERGENS if code in given]


def _known_allergens(v: Optional[List[str]]) -> Optional[List[str]]:
    if v is None:
        return None
    unknown = sorted(set(v) - set(ALLERGENS))
    if unknown:
        raise ValueError("unknown allergen: %s" % ", ".join(unknown))
    return canonical_allergens(v)


def _text_before(v):
    """NUL dropped and ends trimmed BEFORE the length is checked: a name with a
    trailing space has not been sent a character too long."""
    return _without_nul(v).strip() if isinstance(v, str) else v


# --- Sections --------------------------------------------------------------


class MenuSectionIn(BaseModel):
    # Blank is refused by `min_length`, after the trim.
    name: str = Field(min_length=1, max_length=SECTION_NAME)

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, v):
        return _text_before(v)


# --- Dishes ----------------------------------------------------------------


class MenuDishCreate(BaseModel):
    section_id: uuid.UUID
    name: str = Field(min_length=1, max_length=DISH_NAME)
    description: Optional[str] = Field(default=None, max_length=DESCRIPTION)
    # Null = no price on the menu (market price). Sent as a number: "12,50" is
    # the browser's to read, not the server's.
    price: Optional[float] = Field(default=None, ge=0, lt=PRICE_CEILING)
    allergens: List[str] = Field(default_factory=list, max_length=ALLERGENS_SENT)
    available: bool = True

    @field_validator("name", "description", mode="before")
    @classmethod
    def _text(cls, v):
        return _text_before(v)

    @field_validator("description")
    @classmethod
    def _description(cls, v: Optional[str]) -> Optional[str]:
        return _clean(v)

    @field_validator("price")
    @classmethod
    def _price(cls, v: Optional[float]) -> Optional[float]:
        return _to_the_cent(v)

    @field_validator("allergens")
    @classmethod
    def _allergens(cls, v: List[str]) -> List[str]:
        return _known_allergens(v)


class MenuDishUpdate(BaseModel):
    """Every field optional: only what is sent is changed.

    Null clears what can be empty -- `price` (no price) and `description` --
    and is ignored for what cannot: a dish always has a name, a section, a
    list of allergens (maybe empty) and is available or not.
    `section_id` moves the dish to the end of that section.
    """

    section_id: Optional[uuid.UUID] = None
    name: Optional[str] = Field(default=None, min_length=1, max_length=DISH_NAME)
    description: Optional[str] = Field(default=None, max_length=DESCRIPTION)
    price: Optional[float] = Field(default=None, ge=0, lt=PRICE_CEILING)
    allergens: Optional[List[str]] = Field(default=None, max_length=ALLERGENS_SENT)
    available: Optional[bool] = None

    @field_validator("name", "description", mode="before")
    @classmethod
    def _text(cls, v):
        return _text_before(v)

    @field_validator("description")
    @classmethod
    def _description(cls, v: Optional[str]) -> Optional[str]:
        return _clean(v)

    @field_validator("price")
    @classmethod
    def _price(cls, v: Optional[float]) -> Optional[float]:
        return _to_the_cent(v)

    @field_validator("allergens")
    @classmethod
    def _allergens(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        return _known_allergens(v)


# --- Order -----------------------------------------------------------------


class MenuSectionOrderIn(BaseModel):
    # Every section of the business, once, in the new order. Twice the wall,
    # not the wall: a menu already over it (the wall lowered some day) must
    # still be reorderable; `_exactly` is what checks the list.
    ids: List[uuid.UUID] = Field(max_length=2 * limits.MENU_SECTIONS)


class MenuDishOrderIn(BaseModel):
    # Every dish of the section, once, in the new order.
    ids: List[uuid.UUID] = Field(max_length=2 * limits.MENU_DISHES)


# --- Out -------------------------------------------------------------------


class MenuDishOut(BaseModel):
    id: uuid.UUID
    section_id: uuid.UUID
    name: str
    description: Optional[str] = None
    price: Optional[float] = None
    # Once each, in the order of ALLERGENS.
    allergens: List[str] = Field(default_factory=list)
    available: bool = True
    position: int
    # Where its photo is, as a path on this server
    # ("/api/v1/menu/photos/<id>", routers/menu_photos.py), or null for a dish
    # with none. The path changes whenever the photo does.
    photo_url: Optional[str] = None
    # The photo has the dish's name printed on it already (the ones cut from
    # Casa Demo's till, 0040): the tile prints the price over it, not the
    # name a second time. False with no photo.
    photo_labelled: bool = False


class MenuSectionOut(BaseModel):
    id: uuid.UUID
    name: str
    position: int
    # In their order within the section.
    dishes: List[MenuDishOut] = Field(default_factory=list)


class MenuOut(BaseModel):
    # In their order on the menu.
    sections: List[MenuSectionOut] = Field(default_factory=list)
