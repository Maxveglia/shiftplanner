import type { MessageModule } from './types';

// Recipes (Tienda › Recetas): what each product of the menu takes from the
// inventory when it is sold, and "try a sale". Its own module, as the menu
// has: a screen of its own. The sidebar's link is in settings.ts, with the
// rest of the chrome, and the errors the server names for it in errors.ts.
//
// Product and ingredient names are shown as the manager typed them, in every
// language; only the frame around them is here.
export const recipes: MessageModule = {
  en: {
    // --- The screen ------------------------------------------------------------
    'recipes.title': 'Recipes',
    'recipes.description': 'What each product of the menu takes from the inventory when it is sold.',
    // Who may not set them (an employee, the till's tablet) reads them.
    'recipes.descriptionReadOnly':
      'What each product of the menu takes from the inventory when it is sold. The manager sets the recipes.',
    'recipes.noInventory.title': 'Recipes need the inventory',
    'recipes.noInventory.description':
      'A recipe takes products of the inventory, and this business does not have that app switched on.',
    'recipes.loadError': 'Could not load the recipes',
    'recipes.empty.title': 'The menu is empty',
    'recipes.empty.description': 'A recipe belongs to a product of the menu. Write your menu first.',
    'recipes.empty.descriptionReadOnly': 'A recipe belongs to a product of the menu, and the menu has none yet.',
    'recipes.empty.action': 'Go to Menu',
    // "Take from the inventory": a recipe, or the automatic link by name.
    'recipes.summary.one': '{done} of {total} product takes from the inventory',
    'recipes.summary.other': '{done} of {total} products take from the inventory',
    'recipes.list.title': 'Products',
    'recipes.list.onlyMissing': 'Only those that take nothing',
    'recipes.list.allDone': 'Every product takes from the inventory.',
    'recipes.status.with': 'With recipe',
    'recipes.status.without': 'No recipe',
    'recipes.noRecipeTag': 'no recipe',
    'recipes.row.nothing': 'Selling it takes nothing from the inventory.',
    'recipes.row.edit': 'Edit recipe',
    'recipes.row.add': 'Add recipe',
    // Starts with the button's own words ({action}: "Edit recipe"), as its
    // accessible name must (WCAG 2.5.3).
    'recipes.row.editLabel': '{action}: “{name}”',
    'recipes.archived': 'archived',
    'recipes.unknownItem': 'Product no longer in the inventory',
    'recipes.unknownDish': 'Product no longer on the menu',

    // --- One product's recipe ----------------------------------------------------
    'recipes.edit.title': 'Recipe of “{name}”',
    'recipes.edit.onlyNewSales':
      'A change only affects new sales. Sales already recorded keep what they took.',
    'recipes.edit.items': 'Ingredients',
    'recipes.edit.itemsHelp': 'Products of the inventory, each in its own unit: 3/4, 1/2, 0.75 or 1.',
    'recipes.edit.noItems': 'No ingredients.',
    'recipes.edit.addItem': 'Add an ingredient',
    'recipes.edit.pickItem': 'Choose a product of the inventory…',
    'recipes.edit.noStock': 'There are no products in the inventory to choose from. Add them under Stock.',
    'recipes.edit.allItemsIn': 'Every product of the inventory is already in this recipe.',
    'recipes.edit.maxItems': '{count} ingredients at most.',
    'recipes.edit.stockError': 'Could not load the inventory: {reason}',
    'recipes.edit.components': 'Includes',
    'recipes.edit.componentsHelp':
      'Other products of the menu that go inside this one, as in a combo. Their ingredients are taken too.',
    'recipes.edit.noComponents': 'It includes no other product.',
    'recipes.edit.addComponent': 'Add a product of the menu',
    'recipes.edit.pickDish': 'Choose a product…',
    'recipes.edit.noOtherDishes': 'The menu has no other product to put inside this one.',
    'recipes.edit.allDishesIn': 'Every other product of the menu is already included.',
    'recipes.edit.noDishes':
      'None of the products left can go inside this one: they already include it, or it would be more than {max} levels deep.',
    'recipes.edit.maxComponents': '{count} products at most.',
    'recipes.edit.add': 'Add',
    'recipes.edit.remove': 'Remove “{name}”',
    'recipes.edit.quantityInvalid': 'Type a quantity: 0.75, 3/4 or 1.',
    'recipes.edit.quantityTooBig': 'Too much for one unit: less than {max}.',
    'recipes.edit.perSale': 'Each sale takes:',
    'recipes.edit.perSaleNothing': 'Nothing: selling “{name}” will not touch the inventory.',
    'recipes.edit.perSalePartial': 'Lines without a valid quantity do not count yet.',
    'recipes.edit.fixQuantities': 'Fix the quantities in red.',
    'recipes.edit.cancel': 'Cancel',
    'recipes.edit.save': 'Save recipe',
    'recipes.edit.saving': 'Saving…',

    // --- Try a sale ----------------------------------------------------------------
    'recipes.try.title': 'Try a sale',
    'recipes.try.description':
      'Choose what is sold and see what it would take from the stock, and how the stock would be left. Nothing is saved.',
    'recipes.try.asToday': 'It is tried as a sale made today: it comes off what is on the shelf now.',
    'recipes.try.product': 'Product',
    'recipes.try.pick': 'Choose a product…',
    'recipes.try.quantity': 'Quantity',
    'recipes.try.add': 'Add',
    'recipes.try.quantityInvalid': 'Not a quantity: above 0, up to 3 decimals.',
    'recipes.try.sold': 'Sold',
    'recipes.try.clear': 'Clear',
    'recipes.try.takesNothing.one': '{names}: takes nothing from the inventory.',
    'recipes.try.takesNothing.other': '{names}: take nothing from the inventory.',
    'recipes.try.result': 'How the stock would be left',
    'recipes.try.summary.items.one': '1 ingredient',
    'recipes.try.summary.items.other': '{count} ingredients',
    'recipes.try.summary.low.one': '1 would go below its minimum',
    'recipes.try.summary.low.other': '{count} would go below their minimum',
    'recipes.try.summary.negative.one': '1 would go below zero',
    'recipes.try.summary.negative.other': '{count} would go below zero',
    'recipes.try.nothing': 'This sale takes nothing from the inventory.',
    'recipes.try.stockError': 'Could not load the stock',
    'recipes.try.col.item': 'Ingredient',
    'recipes.try.col.take': 'Taken',
    'recipes.try.col.now': 'Now',
    'recipes.try.col.after': 'Would be left',
    'recipes.try.status.negative': 'Below zero',
    'recipes.try.status.low': 'Below minimum ({min})',
    'recipes.try.negativeHelp': 'Below zero is selling more than there is: a delivery is still to be entered.',

    // --- The automatic link: "Agua" on the menu takes 1 "Agua" of the inventory ----
    'recipes.status.auto': 'Automatic',
    'recipes.status.ambiguous': 'No recipe',
    'recipes.auto.tag': 'automatic',
    'recipes.auto.summary': '1 × {name} (same name)',
    'recipes.auto.ambiguous':
      'Several products of the inventory have this name ({names}): it takes nothing until you give it a recipe.',
    'recipes.auto.ambiguousUnnamed':
      'Several products of the inventory have this name: it takes nothing until you give it a recipe.',
    'recipes.edit.auto':
      'Without a recipe of its own, each sale takes 1 × {item} from the inventory, because it has the same name. A recipe of its own replaces that.',
    'recipes.edit.autoAmbiguous':
      'Several products of the inventory have this name ({names}), so none is taken by itself. Give it a recipe to say which.',
    'recipes.edit.autoAmbiguousUnnamed':
      'Several products of the inventory have this name, so none is taken by itself. Give it a recipe to say which.',
    'recipes.edit.relink': 'Left without a recipe, it will take 1 × {item} (same name).',
  },
  es: {
    // --- La pantalla ---------------------------------------------------------------
    'recipes.title': 'Recetas',
    'recipes.description': 'Lo que cada producto de la carta descuenta del Inventario al venderse.',
    'recipes.descriptionReadOnly':
      'Lo que cada producto de la carta descuenta del Inventario al venderse. Las recetas las pone el responsable.',
    'recipes.noInventory.title': 'Las recetas necesitan el Inventario',
    'recipes.noInventory.description':
      'Una receta descuenta productos del Inventario, y este negocio no tiene esa app activada.',
    'recipes.loadError': 'No se pudieron cargar las recetas',
    'recipes.empty.title': 'La carta está vacía',
    'recipes.empty.description': 'Las recetas son de los productos de la carta. Escribe primero la carta.',
    'recipes.empty.descriptionReadOnly': 'Las recetas son de los productos de la carta, y la carta aún no tiene ninguno.',
    'recipes.empty.action': 'Ir a Menú',
    // «Descuentan»: con receta, o con el enlace automático por el nombre.
    'recipes.summary.one': '{done} de {total} producto descuenta del inventario',
    'recipes.summary.other': '{done} de {total} productos descuentan del inventario',
    'recipes.list.title': 'Productos',
    'recipes.list.onlyMissing': 'Solo los que no descuentan nada',
    'recipes.list.allDone': 'Todos los productos descuentan del inventario.',
    'recipes.status.with': 'Con receta',
    'recipes.status.without': 'Sin receta',
    'recipes.noRecipeTag': 'sin receta',
    'recipes.row.nothing': 'Venderlo no descuenta nada del inventario.',
    'recipes.row.edit': 'Editar receta',
    'recipes.row.add': 'Poner receta',
    'recipes.row.editLabel': '{action}: «{name}»',
    'recipes.archived': 'archivado',
    'recipes.unknownItem': 'Producto que ya no está en el inventario',
    'recipes.unknownDish': 'Producto que ya no está en la carta',

    // --- La receta de un producto ------------------------------------------------------
    'recipes.edit.title': 'Receta de «{name}»',
    'recipes.edit.onlyNewSales':
      'Un cambio solo afecta a las ventas nuevas. Las ventas ya apuntadas conservan lo que descontaron.',
    'recipes.edit.items': 'Ingredientes',
    'recipes.edit.itemsHelp': 'Productos del Inventario, cada uno en su unidad: 3/4, 1/2, 0,75 o 1.',
    'recipes.edit.noItems': 'Sin ingredientes.',
    'recipes.edit.addItem': 'Añadir ingrediente',
    'recipes.edit.pickItem': 'Elige un producto del Inventario…',
    'recipes.edit.noStock': 'No hay productos en el Inventario para elegir. Añádelos en Stock.',
    'recipes.edit.allItemsIn': 'Todos los productos del Inventario ya están en esta receta.',
    'recipes.edit.maxItems': '{count} ingredientes como mucho.',
    'recipes.edit.stockError': 'No se pudo cargar el Inventario: {reason}',
    'recipes.edit.components': 'Incluye',
    'recipes.edit.componentsHelp':
      'Otros productos de la carta que van dentro, como en un combo. Se descuentan también sus ingredientes.',
    'recipes.edit.noComponents': 'No incluye otros productos.',
    'recipes.edit.addComponent': 'Añadir producto de la carta',
    'recipes.edit.pickDish': 'Elige un producto…',
    'recipes.edit.noOtherDishes': 'La carta no tiene otros productos que poner dentro de este.',
    'recipes.edit.allDishesIn': 'Todos los demás productos de la carta ya están incluidos.',
    'recipes.edit.noDishes':
      'Ninguno de los productos que quedan puede ir dentro de este: ya lo incluyen, o pasaría de {max} niveles.',
    'recipes.edit.maxComponents': '{count} productos como mucho.',
    'recipes.edit.add': 'Añadir',
    'recipes.edit.remove': 'Quitar «{name}»',
    'recipes.edit.quantityInvalid': 'Escribe una cantidad: 0,75, 3/4 o 1.',
    'recipes.edit.quantityTooBig': 'Demasiado para una unidad: menos de {max}.',
    'recipes.edit.perSale': 'Por cada venta se descuenta:',
    'recipes.edit.perSaleNothing': 'Nada: vender «{name}» no tocará el inventario.',
    'recipes.edit.perSalePartial': 'Las líneas sin una cantidad válida no cuentan todavía.',
    'recipes.edit.fixQuantities': 'Corrige las cantidades en rojo.',
    'recipes.edit.cancel': 'Cancelar',
    'recipes.edit.save': 'Guardar receta',
    'recipes.edit.saving': 'Guardando…',

    // --- Probar una venta -----------------------------------------------------------
    'recipes.try.title': 'Probar una venta',
    'recipes.try.description':
      'Elige qué se vende y mira lo que se descontaría y cómo quedarían las existencias. No se guarda nada.',
    'recipes.try.asToday': 'Se prueba como una venta de hoy: se descuenta de lo que hay ahora.',
    'recipes.try.product': 'Producto',
    'recipes.try.pick': 'Elige un producto…',
    'recipes.try.quantity': 'Cantidad',
    'recipes.try.add': 'Añadir',
    'recipes.try.quantityInvalid': 'No es una cantidad: más de 0, hasta 3 decimales.',
    'recipes.try.sold': 'Se vende',
    'recipes.try.clear': 'Vaciar',
    'recipes.try.takesNothing.one': '{names}: no descuenta nada del inventario.',
    'recipes.try.takesNothing.other': '{names}: no descuentan nada del inventario.',
    'recipes.try.result': 'Cómo quedarían las existencias',
    'recipes.try.summary.items.one': '1 ingrediente',
    'recipes.try.summary.items.other': '{count} ingredientes',
    'recipes.try.summary.low.one': '1 bajaría del mínimo',
    'recipes.try.summary.low.other': '{count} bajarían del mínimo',
    'recipes.try.summary.negative.one': '1 quedaría en negativo',
    'recipes.try.summary.negative.other': '{count} quedarían en negativo',
    'recipes.try.nothing': 'Esta venta no descuenta nada del inventario.',
    'recipes.try.stockError': 'No se pudieron cargar las existencias',
    'recipes.try.col.item': 'Ingrediente',
    'recipes.try.col.take': 'Se descuenta',
    'recipes.try.col.now': 'Ahora',
    'recipes.try.col.after': 'Quedaría',
    'recipes.try.status.negative': 'En negativo',
    'recipes.try.status.low': 'Bajo mínimo ({min})',
    'recipes.try.negativeHelp': 'En negativo es vender más de lo que hay: falta apuntar alguna entrada.',

    // --- El enlace automático: «Agua» de la carta descuenta 1 «Agua» del inventario ----
    'recipes.status.auto': 'Automático',
    'recipes.status.ambiguous': 'Sin receta',
    'recipes.auto.tag': 'automático',
    'recipes.auto.summary': '1 × {name} (se llama igual)',
    'recipes.auto.ambiguous':
      'Varios productos del inventario se llaman así ({names}): no descuenta nada hasta que le pongas una receta.',
    'recipes.auto.ambiguousUnnamed':
      'Varios productos del inventario se llaman así: no descuenta nada hasta que le pongas una receta.',
    'recipes.edit.auto':
      'Sin receta propia, cada venta descuenta 1 × {item} del inventario, porque se llama igual. Si le pones una receta, la sustituye.',
    'recipes.edit.autoAmbiguous':
      'Varios productos del inventario se llaman así ({names}), así que no se descuenta ninguno solo. Ponle una receta para decir cuál.',
    'recipes.edit.autoAmbiguousUnnamed':
      'Varios productos del inventario se llaman así, así que no se descuenta ninguno solo. Ponle una receta para decir cuál.',
    'recipes.edit.relink': 'Al quedar sin receta descontará 1 × {item} (se llama igual).',
  },
};
