"""Recipes: what each product of the Tienda is made of (Tienda > Recetas).

Max, 27-sep-2026: selling a product takes its ingredients off the stock -- a
Crispy Grande is 0.75 kg of chicken and 0.1 kg of onion, as the Inventario
has them -- and a combo is made of other products and takes what they take.
What a product is made of is configured here, apart: neither the sales nor
the menu show it.

A dish's recipe is two lists, sent WHOLE on every save (PUT): ingredients
(products of the inventory, each with how much one unit takes, in the
product's own unit) and components (other dishes of the menu, each with how
many). Two empty lists is no recipe. What a sale takes is worked out from
these when the sale is saved (routers/store.py, services/recipes.py); a recipe
changed afterwards changes the next sale, not the ones already saved.

A dish with no recipe of its own that is called the same as exactly one
product of the inventory takes one of it per unit sold, with nothing
configured ("Agua" -> Agua; services/recipes.py, "the automatic link"). The
list says so on each dish (`auto_item`, or `auto_ambiguous` and
`auto_matches` when several products are called the same), and `expanded` is
what a sale takes, the link included -- read from the same book the sale is
expanded through. Saving a recipe of its own replaces the link; saving an
empty one brings it back.

WHAT A RECIPE CANNOT BE:
* A dish inside itself, directly or through others (A -> B -> A):
  422 `recipe_cycle`, with the dishes along the circle.
* More than `MAX_DEPTH` levels of components, counting every combo that
  already includes this dish: 422 `recipe_too_deep`.
* More than 30 ingredients or 20 components: 422 `recipe_too_many`.
* The same product, or the same dish, twice: 422 `recipe_duplicate`.
* A product of another business's inventory, or a dish of another business's
  menu -- or one that is not there: 404 with that resource's code
  (`inventory_item_not_found`, `menu_dish_not_found`), never a 403.

Every write takes the MENU's lock (routers/menu.py::_one_writer): a recipe
names dishes, and a dish deleted from the menu between the check and the
insert would be a foreign key error -- a 500 -- instead of a 404. The same
lock is what makes "no circles" true: two saves at once, A into B and B into
A, would each see no circle on its own.

The whole team reads them; only the manager changes one (app/access.py). A
sale "tried" on this screen is worked out in the browser, not here. Tienda's
router, behind its door (app/main.py); and the
ingredients are the Inventario's products, so a business without Inventario
is refused here too, with the same 403 `app_not_enabled` the door gives --
checked in the route rather than as a second door, because the guard in
tests/test_client_workspace.py holds every router to exactly one.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Dict, List, Optional, Sequence
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, delete, select
from sqlalchemy.orm import Session

from app.access import Perm, require_permission
from app.db import get_db
from app.errors import detail
from app.models.inventory import InventoryItem, InventoryItemPhoto
from app.models.menu import (
    MenuDish,
    MenuDishPhoto,
    MenuRecipeComponent,
    MenuRecipeItem,
    MenuSection,
)
from app.routers import menu_photos
from app.routers.inventory_photos import photo_url_or_none
from app.routers.menu import _get_dish, _one_writer
from app.schemas.auth import UserOut
from app.schemas.recipes import (
    RecipeAutoItemOut,
    RecipeComponentOut,
    RecipeDishOut,
    RecipeExpandedOut,
    RecipeIn,
    RecipeItemOut,
    RecipeSectionOut,
    RecipesOut,
)
from app.services import recipes
from app.services.recipes import COMPONENTS_PER_DISH, ITEMS_PER_DISH, MAX_DEPTH

router = APIRouter(prefix="/store/recipes", tags=["store"])


# --- Doors and walls ----------------------------------------------------------


def _needs_inventory(current_user: UserOut) -> None:
    """The ingredients are the Inventario's: without it there is nothing to
    make a product of, and nothing a sale could take off."""
    if "inventory" not in current_user.apps:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail(
                "app_not_enabled",
                "This business does not have the inventory app",
                app="inventory",
            ),
        )


def _unprocessable(body: dict) -> HTTPException:
    # The code is written out at each call, inside `detail(...)`, where
    # tests/test_error_codes.py can read it -- never passed in a variable.
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=body)


def _walls(payload: RecipeIn) -> None:
    """How many, and each once."""
    if len(payload.items) > ITEMS_PER_DISH:
        raise _unprocessable(
            detail(
                "recipe_too_many",
                "A product has at most %d ingredients" % ITEMS_PER_DISH,
                what="items",
                limit=ITEMS_PER_DISH,
            )
        )
    if len(payload.components) > COMPONENTS_PER_DISH:
        raise _unprocessable(
            detail(
                "recipe_too_many",
                "A product includes at most %d other products" % COMPONENTS_PER_DISH,
                what="components",
                limit=COMPONENTS_PER_DISH,
            )
        )
    items = [i.item_id for i in payload.items]
    if len(set(items)) != len(items):
        raise _unprocessable(
            detail(
                "recipe_duplicate",
                "An ingredient appears more than once in the recipe",
                what="items",
            )
        )
    components = [c.dish_id for c in payload.components]
    if len(set(components)) != len(components):
        raise _unprocessable(
            detail(
                "recipe_duplicate",
                "A product is included more than once in the recipe",
                what="components",
            )
        )


def _all_found(db: Session, model, org_id: UUID, ids: Sequence[UUID]) -> bool:
    wanted = set(ids)
    if not wanted:
        return True
    found = set(
        db.execute(
            select(model.id).where(model.org_id == org_id).where(model.id.in_(wanted))
        ).scalars()
    )
    return found == wanted


def _known(db: Session, org_id: UUID, payload: RecipeIn) -> None:
    """404 unless every ingredient is a product of this business's inventory
    (archived ones too: they can still be on the shelf) and every component
    a dish of its menu. Another business's is "not found", like one that
    never existed."""
    if not _all_found(db, InventoryItem, org_id, [i.item_id for i in payload.items]):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("inventory_item_not_found", "Product not found"),
        )
    if not _all_found(db, MenuDish, org_id, [c.dish_id for c in payload.components]):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("menu_dish_not_found", "Dish not found"),
        )


def _dish_names(db: Session, org_id: UUID) -> Dict[UUID, str]:
    return dict(
        db.execute(
            select(MenuDish.id, MenuDish.name).where(MenuDish.org_id == org_id)
        ).all()
    )


def _shape(db: Session, org_id: UUID, dish: MenuDish, components: List[UUID]) -> None:
    """No circle, and not too deep, with these as the dish's components.

    The whole business's graph, read in one statement, with this dish's edges
    replaced by the new ones.
    """
    graph = recipes.load(db, org_id).component_graph()
    graph[dish.id] = list(components)
    try:
        circle = recipes.cycle_through(graph, dish.id)
        depth = None if circle else recipes.depth_through(graph, dish.id)
    except recipes.CycleInStoredData:  # pragma: no cover - never written
        circle, depth = [dish.id, dish.id], None
    if circle:
        names = _dish_names(db, org_id)
        path = [names.get(i, str(i)) for i in circle]
        raise _unprocessable(
            detail(
                "recipe_cycle",
                "A product cannot include itself: %s" % " > ".join(path),
                path=path,
            )
        )
    if depth is not None and depth > MAX_DEPTH:
        raise _unprocessable(
            detail(
                "recipe_too_deep",
                "Products can be included at most %d levels deep" % MAX_DEPTH,
                limit=MAX_DEPTH,
            )
        )


# --- Reading --------------------------------------------------------------------


def _num(value: Decimal) -> float:
    return float(value)


def _recipes(db: Session, org_id: UUID, only: Optional[UUID] = None) -> RecipesOut:
    """Every section and dish of the menu with its recipe, in four reads
    whatever the size of the menu: sections, dishes, the recipes (one
    statement for both lists) and the products they name. A dish comes with
    the address of its photo in the menu, a product with its photo in the
    inventory, each joined in the same read (never the picture).

    `only`: just that dish's section, with just that dish in it.
    """
    sections = db.execute(
        select(MenuSection.id, MenuSection.name)
        .where(MenuSection.org_id == org_id)
        .order_by(MenuSection.position, MenuSection.created_at, MenuSection.id)
    ).all()
    dishes = db.execute(
        select(
            MenuDish.id,
            MenuDish.section_id,
            MenuDish.name,
            MenuDishPhoto.id.label("photo_id"),
        )
        .outerjoin(
            MenuDishPhoto,
            and_(
                MenuDishPhoto.dish_id == MenuDish.id,
                MenuDishPhoto.org_id == MenuDish.org_id,
            ),
        )
        .where(MenuDish.org_id == org_id)
        .order_by(MenuDish.position, MenuDish.created_at, MenuDish.id)
    ).all()
    book = recipes.load(db, org_id)
    item_ids = {i for edges in book.items.values() for i, _q in edges}
    item_ids |= set(book.auto.values()) | set(book.named.values())
    item_ids |= {i for matches in book.ambiguous.values() for i in matches}
    products = {}
    if item_ids:
        products = {
            row.id: row
            for row in db.execute(
                select(
                    InventoryItem.id,
                    InventoryItem.name,
                    InventoryItem.unit,
                    InventoryItem.archived_at,
                    InventoryItemPhoto.id.label("photo_id"),
                )
                .outerjoin(
                    InventoryItemPhoto,
                    and_(
                        InventoryItemPhoto.item_id == InventoryItem.id,
                        InventoryItemPhoto.org_id == InventoryItem.org_id,
                    ),
                )
                .where(InventoryItem.org_id == org_id)
                .where(InventoryItem.id.in_(item_ids))
            ).all()
        }
    names = {d.id: d.name for d in dishes}

    def by_name(name: str, key: UUID):
        return (name.lower(), str(key))

    def auto_out(item_id: UUID) -> RecipeAutoItemOut:
        product = products[item_id]
        return RecipeAutoItemOut(
            item_id=item_id,
            name=product.name,
            unit=product.unit,
            photo_url=photo_url_or_none(product.photo_id),
        )

    by_section: Dict[UUID, List[RecipeDishOut]] = defaultdict(list)
    for d in dishes:
        if only is not None and d.id != only:
            continue
        items = sorted(
            (
                RecipeItemOut(
                    item_id=item_id,
                    name=products[item_id].name,
                    unit=products[item_id].unit,
                    quantity=_num(quantity),
                    archived=products[item_id].archived_at is not None,
                    photo_url=photo_url_or_none(products[item_id].photo_id),
                )
                for item_id, quantity in book.items.get(d.id, ())
                if item_id in products
            ),
            key=lambda i: by_name(i.name, i.item_id),
        )
        components = sorted(
            (
                RecipeComponentOut(
                    dish_id=component_id, name=names[component_id], quantity=_num(n)
                )
                for component_id, n in book.components.get(d.id, ())
                if component_id in names
            ),
            key=lambda c: by_name(c.name, c.dish_id),
        )
        expanded = sorted(
            (
                RecipeExpandedOut(
                    item_id=item_id,
                    name=products[item_id].name,
                    unit=products[item_id].unit,
                    quantity=_num(quantity),
                    archived=products[item_id].archived_at is not None,
                    photo_url=photo_url_or_none(products[item_id].photo_id),
                )
                for item_id, quantity in recipes.per_unit(book, d.id).items()
                if item_id in products
            ),
            key=lambda i: by_name(i.name, i.item_id),
        )
        linked = book.auto.get(d.id)
        matches = sorted(
            (auto_out(i) for i in book.ambiguous.get(d.id, ()) if i in products),
            key=lambda m: by_name(m.name, m.item_id),
        )
        by_section[d.section_id].append(
            RecipeDishOut(
                id=d.id,
                section_id=d.section_id,
                name=d.name,
                photo_url=(
                    None if d.photo_id is None else menu_photos.photo_url(d.photo_id)
                ),
                has_recipe=bool(items or components),
                items=items,
                components=components,
                expanded=expanded,
                auto_item=auto_out(linked) if linked in products else None,
                auto_ambiguous=d.id in book.ambiguous,
                auto_matches=matches,
                name_match=(
                    auto_out(book.named[d.id])
                    if book.named.get(d.id) in products
                    else None
                ),
            )
        )
    return RecipesOut(
        sections=[
            RecipeSectionOut(id=s.id, name=s.name, dishes=by_section[s.id])
            for s in sections
            if only is None or by_section[s.id]
        ]
    )


def _answer(db: Session, out):
    """Commit, then answer with what was read BEFORE the commit -- the screen
    reads the recipes again the moment it hears back. Same reason as
    routers/menu.py, whose lock the commit also releases."""
    db.commit()
    return out


# --- The routes -------------------------------------------------------------------


@router.get("", response_model=RecipesOut)
def list_recipes(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.STORE_RECIPES_VIEW)),
) -> RecipesOut:
    """The whole menu, section by section in its order, every dish with its
    recipe -- or none (`has_recipe` false, empty lists)."""
    _needs_inventory(current_user)
    return _recipes(db, current_user.org_id)


@router.put("/{dish_id}", response_model=RecipeDishOut)
def put_recipe(
    dish_id: UUID,
    payload: RecipeIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.STORE_RECIPES_EDIT)),
) -> RecipeDishOut:
    """Replace the dish's recipe with this one, whole; answered with the dish
    as the list reads it."""
    _needs_inventory(current_user)
    org_id = current_user.org_id
    _one_writer(db, org_id)
    dish = _get_dish(db, org_id, dish_id)
    _walls(payload)
    if any(c.dish_id == dish.id for c in payload.components):
        raise _unprocessable(
            detail(
                "recipe_cycle",
                "A product cannot include itself: %s > %s" % (dish.name, dish.name),
                path=[dish.name, dish.name],
            )
        )
    _known(db, org_id, payload)
    _shape(db, org_id, dish, [c.dish_id for c in payload.components])

    db.execute(
        delete(MenuRecipeItem)
        .where(MenuRecipeItem.org_id == org_id)
        .where(MenuRecipeItem.dish_id == dish.id)
    )
    db.execute(
        delete(MenuRecipeComponent)
        .where(MenuRecipeComponent.org_id == org_id)
        .where(MenuRecipeComponent.dish_id == dish.id)
    )
    db.add_all(
        MenuRecipeItem(
            org_id=org_id,
            dish_id=dish.id,
            item_id=i.item_id,
            # Already rounded by the schema; a Decimal of its shortest
            # spelling is exactly that thousandth.
            quantity=Decimal(str(i.quantity)),
        )
        for i in payload.items
    )
    db.add_all(
        MenuRecipeComponent(
            org_id=org_id,
            dish_id=dish.id,
            component_id=c.dish_id,
            quantity=Decimal(str(c.quantity)),
        )
        for c in payload.components
    )
    db.flush()
    [section] = _recipes(db, org_id, only=dish.id).sections
    return _answer(db, section.dishes[0])
