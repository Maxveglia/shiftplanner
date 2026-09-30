import type { MessageModule } from './types';

// The access window (/access): who can sign in to the business, and as what.
// The manager's, reached from the sidebar of every app. Giving an employee a
// login reuses the employee page's words (people.access.*).

export const access: MessageModule = {
  en: {
    'access.title': 'Access',
    'access.description': 'Who can sign in to {org}, and what each one can do.',
    'access.loadError': 'The list of access could not be loaded.',
    'access.cancel': 'Cancel',
    'access.lastSeen': 'Last in {date}',
    'access.neverSeen': 'Not signed in yet',

    // --- The manager ---------------------------------------------------------
    'access.managers.title': 'Manager',
    'access.managers.full': 'Full access',
    'access.managers.you': 'You',

    // --- The team ------------------------------------------------------------
    'access.employees.title': 'Employees',
    'access.employees.help': 'Each one signs in with their own email and password.',
    'access.employees.empty': 'There is nobody on the team yet. Add people in Employees.',
    'access.employees.noEmail': 'No email on their record',

    // --- The till's tablets -----------------------------------------------------
    'access.stores.title': 'Shop accounts',
    'access.stores.help':
      'The till’s tablet: it charges, receives deliveries and counts stock like an employee, but has no shifts — it is not a person. Its session does not expire: it stays signed in until you change its password or delete it.',
    'access.stores.empty': 'No shop accounts yet.',
    'access.stores.new': 'New shop account',
    'access.stores.form.title': 'New shop account',
    'access.stores.form.name': 'Name',
    'access.stores.form.namePlaceholder': 'Bar tablet',
    'access.stores.form.nameHelp': 'So you can tell it apart: where the device is.',
    'access.stores.form.email': 'Email it signs in with',
    'access.stores.form.emailPlaceholder': 'bar@yourbusiness.com',
    'access.stores.form.password': 'Password',
    'access.stores.form.submit': 'Create account',
    'access.stores.form.creating': 'Creating…',
    'access.stores.handover.title': 'Sign-in details for “{name}”',
    'access.stores.password.button': 'Change password',
    'access.stores.password.title': 'New password for {name}',
    'access.stores.password.note':
      'The tablet is signed out at once and will have to sign in again with the new password.',
    'access.stores.password.submit': 'Change password',
    'access.stores.password.saving': 'Changing…',
    'access.stores.password.handover': '“{name}” will have to be signed in again with the new password',
    'access.stores.delete.button': 'Delete',
    'access.stores.delete.title': 'Delete {name}?',
    'access.stores.delete.body':
      'The tablet is signed out at once, and this account will not be able to sign in again. This cannot be undone.',
    'access.stores.delete.confirm': 'Delete account',
    'access.stores.delete.deleting': 'Deleting…',

    // --- What each one can do -----------------------------------------------------
    'access.table.title': 'What each one can do',
    'access.table.caption': 'What the manager, an employee and a shop account can each do',
    'access.table.permission': 'Can…',
    'access.table.yes': 'Yes',
    'access.table.no': 'No',
    'access.table.group.shifts': 'Shifts',
    'access.table.group.inventory': 'Inventory',
    'access.table.group.store': 'Shop',
    'access.table.group.business': 'Business',
    'access.table.shifts.row': 'See the shifts',
    'access.table.shifts.all': 'The whole team’s',
    'access.table.shifts.own': 'Their own',
    'access.perm.inventory.view': 'See the stock, counts, deliveries and suppliers',
    'access.perm.inventory.count': 'Count the stock',
    'access.perm.inventory.receive': 'Receive deliveries',
    // Not a permission of its own: seeing the stock and the suppliers covers it (lib/access.ts, EXTRA_ROWS).
    'access.perm.inventory.order': 'Order from suppliers',
    'access.perm.inventory.products': 'Create and edit products (minimum, order, photo, barcodes, archiving)',
    'access.perm.inventory.records.delete': 'Delete a count or a delivery',
    'access.perm.inventory.suppliers': 'Add, edit and delete suppliers',
    'access.perm.menu.view': 'See the menu',
    'access.perm.menu.edit': 'Edit the menu (dishes, sections, photos, sold out)',
    'access.perm.store.charge': 'Charge at the till',
    'access.perm.store.sales.manual': 'Enter a sale by hand',
    'access.perm.store.sales.view': 'See the sales',
    'access.perm.store.sales.void': 'Void a sale',
    'access.perm.store.stats': 'See the statistics',
    'access.perm.store.stats.full': 'See the full statistics (coming)',
    'access.perm.store.recipes.view': 'See the recipes',
    'access.perm.store.recipes.edit': 'Edit the recipes',
    'access.perm.access.manage': 'Give and take away access',

    // --- Old accounts with nobody behind them -------------------------------------
    'access.orphans.title': 'Old accounts with no employee',
    'access.orphans.help':
      'They belonged to people who are no longer on the team. They cannot sign in any more; delete them to keep the list clean.',
    'access.orphans.delete.button': 'Delete',
    'access.orphans.delete.title': 'Delete the account of {name}?',
    'access.orphans.delete.body':
      'The account {email} is deleted. It could no longer sign in anyway. This cannot be undone.',
    'access.orphans.delete.confirm': 'Delete account',
    'access.orphans.delete.deleting': 'Deleting…',
  },
  es: {
    'access.title': 'Accesos',
    'access.description': 'Quién entra en {org} y qué puede hacer cada uno.',
    'access.loadError': 'No se ha podido cargar la lista de accesos.',
    'access.cancel': 'Cancelar',
    'access.lastSeen': 'Última vez: {date}',
    'access.neverSeen': 'Aún no ha entrado',

    // --- El responsable --------------------------------------------------------
    'access.managers.title': 'Responsable',
    'access.managers.full': 'Acceso completo',
    'access.managers.you': 'Tú',

    // --- El equipo ---------------------------------------------------------------
    'access.employees.title': 'Empleados',
    'access.employees.help': 'Cada uno entra con su propio correo y su contraseña.',
    'access.employees.empty': 'Aún no hay nadie en el equipo. Añade personas en Empleados.',
    'access.employees.noEmail': 'Sin correo en su ficha',

    // --- Las tablets del TPV -------------------------------------------------------
    'access.stores.title': 'Cuentas de tienda',
    'access.stores.help':
      'La tablet del TPV: cobra, recibe mercancía y cuenta existencias como un empleado, pero no tiene turnos, porque no es una persona. Su sesión no caduca: sigue dentro hasta que cambies su contraseña o la elimines.',
    'access.stores.empty': 'Todavía no hay cuentas de tienda.',
    'access.stores.new': 'Nueva cuenta de tienda',
    'access.stores.form.title': 'Nueva cuenta de tienda',
    'access.stores.form.name': 'Nombre',
    'access.stores.form.namePlaceholder': 'Tablet barra',
    'access.stores.form.nameHelp': 'Para distinguirla: dónde está el dispositivo.',
    'access.stores.form.email': 'Correo con el que entra',
    'access.stores.form.emailPlaceholder': 'barra@tunegocio.com',
    'access.stores.form.password': 'Contraseña',
    'access.stores.form.submit': 'Crear cuenta',
    'access.stores.form.creating': 'Creando…',
    'access.stores.handover.title': 'Datos para entrar en «{name}»',
    'access.stores.password.button': 'Cambiar contraseña',
    'access.stores.password.title': 'Nueva contraseña para {name}',
    'access.stores.password.note':
      'La tablet se cierra al momento y tendrá que volver a entrar con la contraseña nueva.',
    'access.stores.password.submit': 'Cambiar contraseña',
    'access.stores.password.saving': 'Cambiando…',
    'access.stores.password.handover': 'En «{name}» habrá que volver a entrar con la contraseña nueva',
    'access.stores.delete.button': 'Eliminar',
    'access.stores.delete.title': '¿Eliminar {name}?',
    'access.stores.delete.body':
      'La tablet se cierra al momento y esta cuenta ya no podrá volver a entrar. No se puede deshacer.',
    'access.stores.delete.confirm': 'Eliminar cuenta',
    'access.stores.delete.deleting': 'Eliminando…',

    // --- Qué puede hacer cada uno ---------------------------------------------------
    'access.table.title': 'Qué puede hacer cada uno',
    'access.table.caption': 'Qué puede hacer el responsable, un empleado y una cuenta de tienda',
    'access.table.permission': 'Puede…',
    'access.table.yes': 'Sí',
    'access.table.no': 'No',
    'access.table.group.shifts': 'Turnos',
    'access.table.group.inventory': 'Inventario',
    'access.table.group.store': 'Tienda',
    'access.table.group.business': 'Negocio',
    'access.table.shifts.row': 'Ver los turnos',
    'access.table.shifts.all': 'Los de todo el equipo',
    'access.table.shifts.own': 'Los suyos',
    'access.perm.inventory.view': 'Ver existencias, conteos, entradas y proveedores',
    'access.perm.inventory.count': 'Contar existencias',
    'access.perm.inventory.receive': 'Recibir mercancía',
    // No es un permiso propio: lo cubre ver existencias y proveedores (lib/access.ts, EXTRA_ROWS).
    'access.perm.inventory.order': 'Pedir al proveedor',
    'access.perm.inventory.products': 'Crear y editar productos (mínimo, pedido, foto, códigos, archivar)',
    'access.perm.inventory.records.delete': 'Borrar un conteo o una entrada',
    'access.perm.inventory.suppliers': 'Añadir, editar y borrar proveedores',
    'access.perm.menu.view': 'Ver la carta',
    'access.perm.menu.edit': 'Editar la carta (platos, secciones, fotos, agotado)',
    'access.perm.store.charge': 'Cobrar en el TPV',
    'access.perm.store.sales.manual': 'Apuntar una venta a mano',
    'access.perm.store.sales.view': 'Ver las ventas',
    'access.perm.store.sales.void': 'Anular una venta',
    'access.perm.store.stats': 'Ver las estadísticas',
    'access.perm.store.stats.full': 'Ver las estadísticas completas (próximamente)',
    'access.perm.store.recipes.view': 'Ver las recetas',
    'access.perm.store.recipes.edit': 'Editar las recetas',
    'access.perm.access.manage': 'Dar y quitar accesos',

    // --- Cuentas antiguas sin nadie detrás -------------------------------------------
    'access.orphans.title': 'Cuentas antiguas sin empleado',
    'access.orphans.help':
      'Eran de personas que ya no están en la plantilla. Ya no pueden entrar; elimínalas para que la lista quede limpia.',
    'access.orphans.delete.button': 'Eliminar',
    'access.orphans.delete.title': '¿Eliminar la cuenta de {name}?',
    'access.orphans.delete.body':
      'Se borra la cuenta {email}. De todos modos ya no podía entrar. No se puede deshacer.',
    'access.orphans.delete.confirm': 'Eliminar cuenta',
    'access.orphans.delete.deleting': 'Eliminando…',
  },
};
