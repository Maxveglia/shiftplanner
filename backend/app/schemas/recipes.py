"""What a recipe is, as the Recetas screen sends it and reads it back.

A dish's recipe is two lists -- ingredients (products of the inventory) and
components (other dishes of the menu) -- sent WHOLE on every save: the list
sent is the recipe, and two empty lists is no recipe (routers/recipes.py).
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas.store import _as_stored

_THOUSANDTH = Decimal("0.001")

# How much of one product ONE unit of a dish may take, in the product's unit:
# 5000 ml of a bag-in-box is a lot; a hundred thousand is a wall, not a dish.
ITEM_QUANTITY_CEILING = 100_000

# How many of another dish one unit may contain: a party tray of a hundred
# wings is plausible, a thousand is the wall.
COMPONENT_QUANTITY_CEILING = 1_000

# What one request may carry at all. The real ceilings, 30 ingredients and 20
# components, are the router's to refuse with a code the screen can put into
# words (`recipe_too_many`); this is only the wall against a list of a million.
LIST_WALL = 100


def _quantity(v: float, ceiling: int) -> float:
    """Above zero and under the ceiling AS STORED: 0.0004 passes `gt=0` and is
    stored as 0.000, which the CHECK refuses. Rounded half up from the decimal
    written, to the thousandth -- a third sent as 0.3333333 is kept as 0.333."""
    stored = _as_stored(v, _THOUSANDTH, ceiling)
    if stored <= 0:
        raise ValueError("must be at least 0.001")
    return float(stored)


class RecipeItemIn(BaseModel):
    item_id: uuid.UUID
    # In the product's own unit: 0.75 is three quarters of a kilo when its
    # unit is "kg".
    quantity: float = Field(gt=0, lt=ITEM_QUANTITY_CEILING)

    @field_validator("quantity")
    @classmethod
    def _stored(cls, v: float) -> float:
        return _quantity(v, ITEM_QUANTITY_CEILING)


class RecipeComponentIn(BaseModel):
    # Another dish of the same menu.
    dish_id: uuid.UUID
    quantity: float = Field(gt=0, lt=COMPONENT_QUANTITY_CEILING)

    @field_validator("quantity")
    @classmethod
    def _stored(cls, v: float) -> float:
        return _quantity(v, COMPONENT_QUANTITY_CEILING)


class RecipeIn(BaseModel):
    """The whole recipe. Both lists are required, so a client that forgets one
    does not silently wipe it; send [] for none."""

    items: List[RecipeItemIn] = Field(max_length=LIST_WALL)
    components: List[RecipeComponentIn] = Field(max_length=LIST_WALL)


# --- Out -----------------------------------------------------------------------


class RecipeItemOut(BaseModel):
    item_id: uuid.UUID
    name: str
    unit: Optional[str] = None
    quantity: float
    # The product was archived in the inventory. Still in the recipe, and
    # still taken off by a sale: the screen says so.
    archived: bool = False
    # The product's photo in the inventory ("/api/v1/inventory/photos/<id>",
    # routers/inventory_photos.py), or null for one with none.
    photo_url: Optional[str] = None


class RecipeComponentOut(BaseModel):
    dish_id: uuid.UUID
    name: str
    quantity: float


class RecipeExpandedOut(BaseModel):
    """One product and how much of it ONE unit of the dish takes, components
    included, rounded as a sale of one unit would be."""

    item_id: uuid.UUID
    name: str
    unit: Optional[str] = None
    quantity: float
    archived: bool = False
    # As `RecipeItemOut.photo_url`.
    photo_url: Optional[str] = None


class RecipeAutoItemOut(BaseModel):
    """A product of the inventory called the same as a dish (services/
    recipes.py, "the automatic link")."""

    item_id: uuid.UUID
    name: str
    unit: Optional[str] = None
    # As `RecipeItemOut.photo_url`.
    photo_url: Optional[str] = None


class RecipeDishOut(BaseModel):
    id: uuid.UUID
    section_id: uuid.UUID
    name: str
    # The dish's photo in the menu ("/api/v1/menu/photos/<id>",
    # routers/menu_photos.py), or null for one with none.
    photo_url: Optional[str] = None
    # A recipe of its OWN: ingredients or components. The automatic link is
    # not one -- a dish linked by its name says false here, and a recipe of
    # its own, once saved, replaces the link.
    has_recipe: bool
    items: List[RecipeItemOut]
    components: List[RecipeComponentOut]
    # What one unit takes, all said: the recipe's, or the automatic link's
    # 1 x product, components' links included. What a sale takes.
    expanded: List[RecipeExpandedOut]
    # With no recipe of its own, the one product of the inventory (not
    # archived) called the same, whose unit each sale takes; null otherwise.
    auto_item: Optional[RecipeAutoItemOut] = None
    # With no recipe of its own, several products are called the same: no
    # link, and a sale takes nothing. `auto_matches` are those products, by
    # name, so the screen can say which.
    auto_ambiguous: bool = False
    auto_matches: List[RecipeAutoItemOut] = Field(default_factory=list)
    # The product called the same, whether or not a recipe of its own hides
    # the link: what a sale would take if the recipe were emptied.
    name_match: Optional[RecipeAutoItemOut] = None


class RecipeSectionOut(BaseModel):
    id: uuid.UUID
    name: str
    dishes: List[RecipeDishOut]


class RecipesOut(BaseModel):
    """Every section and dish of the menu, in the menu's order, each with its
    recipe -- or none."""

    sections: List[RecipeSectionOut]
