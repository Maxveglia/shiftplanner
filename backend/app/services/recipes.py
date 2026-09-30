"""Recipes: what one unit of a dish takes off the shelf, and what a sale took.

A dish of the menu can have INGREDIENTS -- products of the inventory, each
with how much of it one unit takes -- and COMPONENTS -- other dishes of the
same menu inside it, each with how many ("Combo Crispy Grande = 1 Crispy
Grande + 1 Patatas"). A combo takes what its components take, recursively,
and a dish can have both (migration 0041).

EXPANDING A SALE. For every line with a dish: the dish's ingredients times
the line's quantity, plus, recursively, each component's ingredients times
(the component's quantity times the line's quantity). Added up by product,
in exact decimals, and rounded ONCE, at the end, to the thousandth, half up --
the column's precision. What rounds to nothing is not kept. A free line, or a
dish with no recipe, takes nothing. Rounding every step instead would make
three halves of a third (0.333 x 0.5 x 3 = 0.4995 -> 0.500) come out as 0.501.

The arithmetic is done in a context with room for every digit and with
Inexact trapped: if a product ever needed more digits than it has, that is an
error, never a quiet rounding in the middle.

THE AUTOMATIC LINK (Max, 27-sep-2026: "Agua" on the menu is "Agua" on the
shelf). A dish with NO recipe of its own -- neither ingredients nor
components -- that is called the same as exactly ONE product of the inventory
that is not archived takes one unit of that product per unit sold, with
nothing configured. "The same" is `name_key`: without case, without accents
and with the spaces normalised ("agua" = "Água" = " AGUA "). Two products
with that name is no link at all (`ambiguous`): which of the two a sale takes
is not something to guess, and the Recetas screen says so. A recipe of its
own always wins, even one that does not mention the product. It holds for a
component of a combo too: a combo of "Crispy + Agua" takes the water when
"Agua" has no recipe and one product is called so. The sale and the Recetas
screen read the link from the same place -- `load` -- so what the screen
says a sale takes is what it takes.

WHAT IS WRITTEN is a snapshot (`store_sale_consumption`): worked out from the
recipes -- and the links -- as they are when the sale is saved, and never
again. Renaming the product afterwards changes the next sale, not this one.

THE SHAPE OF THE GRAPH is the API's to keep: no dish inside itself, directly
or through others, and at most `MAX_DEPTH` levels of components. The
expansion below does not trust that blindly -- an edge that would close a
circle takes nothing and is logged -- because a sale must be saved even if the
stored recipes were ever wrong.
"""
from __future__ import annotations

import logging
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import (
    ROUND_HALF_UP,
    Context,
    Decimal,
    DivisionByZero,
    Inexact,
    InvalidOperation,
    Overflow,
    localcontext,
)
from typing import Dict, Iterable, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import Numeric, String, cast, literal, null, select, union_all
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Session

from app.models.inventory import InventoryItem
from app.models.menu import MenuDish, MenuRecipeComponent, MenuRecipeItem

logger = logging.getLogger(__name__)

# Levels of "includes" in the longest chain: a combo of dishes that have only
# ingredients is ONE level; a combo inside a menu inside a party pack is three.
MAX_DEPTH = 5

# Per dish. A real recipe has a handful of each; these are the wall.
ITEMS_PER_DISH = 30
COMPONENTS_PER_DISH = 20

THOUSANDTH = Decimal("0.001")

# Room for every digit a product of these numbers can have: a line quantity
# and six levels of three-decimal factors under a million are ~80 digits.
# Inexact trapped, so running out of room is an exception, not a rounding.
_EXACT = Context(
    prec=200,
    rounding=ROUND_HALF_UP,
    traps=[Inexact, InvalidOperation, DivisionByZero, Overflow],
)
# The one rounding, to the thousandth, with room for any magnitude.
_ROUND = Context(prec=200, rounding=ROUND_HALF_UP)

Edges = Dict[UUID, List[Tuple[UUID, Decimal]]]


def name_key(name: str) -> str:
    """A name as the automatic link compares it: without case, without
    accents (NFKD, the combining marks dropped: "Água" is "agua", "Piña"
    "pina"), without the invisible format characters a name pasted from the
    web brings along (a zero-width space, a soft hyphen, a BOM: category Cf),
    and with every run of spaces one space, none at the ends."""
    decomposed = unicodedata.normalize("NFKD", name)
    bare = "".join(
        c
        for c in decomposed
        if not unicodedata.combining(c) and unicodedata.category(c) != "Cf"
    )
    return " ".join(bare.casefold().split())


@dataclass
class RecipeBook:
    """Every recipe of one business: dish -> [(product, quantity)] and
    dish -> [(component dish, how many)] -- and, for the dishes with neither,
    the automatic link: dish -> the one product called the same (`auto`), or
    dish -> the several that are, and so no link (`ambiguous`)."""

    items: Edges = field(default_factory=dict)
    components: Edges = field(default_factory=dict)
    auto: Dict[UUID, UUID] = field(default_factory=dict)
    ambiguous: Dict[UUID, List[UUID]] = field(default_factory=dict)
    # The one product each dish is called the same as, recipe or not: what the
    # link WOULD be if its recipe were emptied (the editor says so before).
    named: Dict[UUID, UUID] = field(default_factory=dict)

    def has_recipe(self, dish_id: UUID) -> bool:
        """A recipe of its own: ingredients or components. The automatic link
        is not one."""
        return bool(self.items.get(dish_id) or self.components.get(dish_id))

    def component_graph(self) -> Dict[UUID, List[UUID]]:
        return {dish: [c for c, _n in edges] for dish, edges in self.components.items()}

    def link(
        self, dishes: Iterable[Tuple[UUID, str]], products: Iterable[Tuple[UUID, str]]
    ) -> None:
        """Fill in `auto` and `ambiguous` from the menu's dishes and the
        products of the inventory that are not archived, each (id, name).
        Only for the dishes with no recipe of their own."""
        by_key: Dict[str, List[UUID]] = defaultdict(list)
        for item_id, name in products:
            by_key[name_key(name)].append(item_id)
        for dish_id, name in dishes:
            matches = by_key.get(name_key(name), ())
            if len(matches) == 1:
                self.named[dish_id] = matches[0]
            if self.has_recipe(dish_id):
                continue
            if len(matches) == 1:
                self.auto[dish_id] = matches[0]
            elif matches:
                self.ambiguous[dish_id] = sorted(matches, key=str)


def load(db: Session, org_id: UUID) -> RecipeBook:
    """The business's recipes, both lists, and the automatic links, in ONE
    statement.

    One statement rather than several so the whole book is one snapshot: a
    recipe being replaced at the same moment is read either before or after,
    never its new ingredients with its old components -- nor its old recipe
    with the link it has now that it has none. The dishes' and the products'
    names come in the same read, and are matched here (`RecipeBook.link`):
    a name without accents is not something Postgres can say without an
    extension.
    """
    no_id = cast(null(), PG_UUID(as_uuid=True))
    no_quantity = cast(null(), Numeric(12, 3))
    no_name = cast(null(), String)
    ingredients = select(
        literal("i").label("kind"),
        MenuRecipeItem.dish_id.label("row_id"),
        MenuRecipeItem.item_id.label("target_id"),
        MenuRecipeItem.quantity.label("quantity"),
        no_name.label("name"),
    ).where(MenuRecipeItem.org_id == org_id)
    components = select(
        literal("c"),
        MenuRecipeComponent.dish_id,
        MenuRecipeComponent.component_id,
        MenuRecipeComponent.quantity,
        no_name,
    ).where(MenuRecipeComponent.org_id == org_id)
    dishes = select(literal("d"), MenuDish.id, no_id, no_quantity, MenuDish.name).where(
        MenuDish.org_id == org_id
    )
    # Archived products are off the shelf the manager keeps: none is linked.
    products = (
        select(literal("p"), InventoryItem.id, no_id, no_quantity, InventoryItem.name)
        .where(InventoryItem.org_id == org_id)
        .where(InventoryItem.archived_at.is_(None))
    )
    book = RecipeBook()
    names: Dict[str, List[Tuple[UUID, str]]] = {"d": [], "p": []}
    for kind, row_id, target_id, quantity, name in db.execute(
        union_all(ingredients, components, dishes, products)
    ).all():
        if kind in names:
            names[kind].append((row_id, name))
            continue
        edges = book.items if kind == "i" else book.components
        edges.setdefault(row_id, []).append((target_id, Decimal(quantity)))
    book.link(names["d"], names["p"])
    return book


# --- Expanding ----------------------------------------------------------------


def _per_unit(
    book: RecipeBook,
    dish_id: UUID,
    memo: Dict[UUID, Dict[UUID, Decimal]],
    path: Tuple[UUID, ...],
) -> Dict[UUID, Decimal]:
    """What ONE unit of the dish takes, exact, by product."""
    if dish_id in memo:
        return memo[dish_id]
    if dish_id in path:
        logger.warning(
            "recipe cycle in stored data through dish %s; the edge takes nothing", dish_id
        )
        return {}
    if not book.has_recipe(dish_id):
        # No recipe of its own: the product called the same, one unit of it,
        # or nothing.
        linked = book.auto.get(dish_id)
        memo[dish_id] = {} if linked is None else {linked: Decimal(1)}
        return memo[dish_id]
    taken: Dict[UUID, Decimal] = defaultdict(Decimal)
    for item_id, quantity in book.items.get(dish_id, ()):
        taken[item_id] += quantity
    for component_id, how_many in book.components.get(dish_id, ()):
        inner = _per_unit(book, component_id, memo, path + (dish_id,))
        for item_id, quantity in inner.items():
            taken[item_id] += how_many * quantity
    memo[dish_id] = dict(taken)
    return memo[dish_id]


def _rounded(total: Dict[UUID, Decimal]) -> Dict[UUID, Decimal]:
    """The one rounding: to the thousandth, half up; nothing kept at zero."""
    out: Dict[UUID, Decimal] = {}
    with localcontext(_ROUND):
        for item_id, quantity in total.items():
            stored = quantity.quantize(THOUSANDTH, rounding=ROUND_HALF_UP)
            if stored > 0:
                out[item_id] = stored
    return out


def expand(
    book: RecipeBook, lines: Iterable[Tuple[UUID, Decimal]]
) -> Dict[UUID, Decimal]:
    """What these (dish, quantity) lines take, by product, rounded once."""
    total: Dict[UUID, Decimal] = defaultdict(Decimal)
    memo: Dict[UUID, Dict[UUID, Decimal]] = {}
    with localcontext(_EXACT):
        for dish_id, quantity in lines:
            for item_id, per_unit in _per_unit(book, dish_id, memo, ()).items():
                total[item_id] += per_unit * quantity
    return _rounded(total)


def per_unit(book: RecipeBook, dish_id: UUID) -> Dict[UUID, Decimal]:
    """What one unit of the dish takes, rounded as a sale of one would be."""
    return expand(book, [(dish_id, Decimal(1))])


# --- The shape of the graph -------------------------------------------------------


class CycleInStoredData(Exception):
    """A circle that does not go through the dish being changed: the stored
    recipes are already wrong. Never expected; refused rather than looped on."""


def cycle_through(
    graph: Dict[UUID, List[UUID]], dish_id: UUID
) -> Optional[List[UUID]]:
    """The circle dish -> ... -> dish in `graph`, if there is one, as the list
    of dishes along it (the dish at both ends); None if there is none.

    `graph` already has the dish's NEW components. Every circle a change can
    make goes through the dish changed, since the graph had none before (the
    API keeps it so, under the menu's lock), so searching from the dish is
    searching all of them.
    """
    # Depth first from each component, remembering how each dish was reached.
    for start in graph.get(dish_id, ()):
        if start == dish_id:
            return [dish_id, dish_id]
        came_from: Dict[UUID, UUID] = {start: dish_id}
        stack = [start]
        while stack:
            node = stack.pop()
            for nxt in graph.get(node, ()):
                if nxt == dish_id:
                    chain = [node]
                    while chain[-1] != start:
                        chain.append(came_from[chain[-1]])
                    return [dish_id] + list(reversed(chain)) + [dish_id]
                if nxt not in came_from:
                    came_from[nxt] = node
                    stack.append(nxt)
    return None


def _longest(graph: Dict[UUID, List[UUID]], start: UUID) -> int:
    """Edges in the longest chain starting at `start` (0 for none)."""
    memo: Dict[UUID, int] = {}
    on_path: set = set()

    def walk(node: UUID) -> int:
        if node in memo:
            return memo[node]
        if node in on_path:
            raise CycleInStoredData(node)
        on_path.add(node)
        best = 0
        for nxt in graph.get(node, ()):
            best = max(best, 1 + walk(nxt))
        on_path.discard(node)
        memo[node] = best
        return best

    return walk(start)


def depth_through(graph: Dict[UUID, List[UUID]], dish_id: UUID) -> int:
    """Levels of components in the longest chain that passes through the dish.

    Down from it, and up through every dish that includes it: making a dish a
    combo also makes every combo it is in one level deeper. Only chains
    through this dish are measured -- it is the only thing that changed.
    """
    parents: Dict[UUID, List[UUID]] = defaultdict(list)
    for dish, components in graph.items():
        for component in components:
            parents[component].append(dish)
    return _longest(graph, dish_id) + _longest(parents, dish_id)
