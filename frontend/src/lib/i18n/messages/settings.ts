import type { MessageModule } from './types';

// The settings screen, the compact language switcher, and the shell around
// every screen (sidebar navigation, session box, log out). Kept together
// because they are the chrome the manager sees on every page, whatever the page
// is showing.

export const settings: MessageModule = {
  en: {
    'settings.title': 'Settings',
    'settings.description':
      'What the AI builds the calendar from, and how the product behaves for you.',
    'settings.scheduler.title': 'Shifts and rules',
    'settings.scheduler.help':
      'What the AI builds the calendar from: the shifts it may use, what an hour costs, and the labour rules where you operate.',
    // --- Ending the account. Said plainly, in the order it happens. -------
    'settings.danger.title': 'Delete this account',
    'settings.danger.help':
      'Ends {org} and erases everything in it. This cannot be undone and there is no copy afterwards.',
    'settings.danger.item.people': 'Every employee, their contracts and their time off.',
    'settings.danger.item.calendars':
      'Every calendar, published and draft, and everything the product learned about your business.',
    'settings.danger.item.logins':
      'Every login, including your team’s: nobody will be able to sign in again.',
    'settings.danger.final': 'Download anything you need first.',
    'settings.danger.button': 'Delete this account',
    'settings.danger.modal.title': 'Delete this account',
    'settings.danger.modal.body':
      'This erases {name} and everything in it, for everyone, immediately. It cannot be undone.',
    'settings.danger.modal.label': 'Type {name} to confirm',
    'settings.danger.modal.confirm': 'Delete for ever',
    'settings.danger.modal.deleting': 'Deleting…',
    'settings.danger.cancel': 'Cancel',

    'settings.language.title': 'Language',
    'settings.language.help':
      'Changes the whole platform at once — every screen, and the way dates and amounts are written.',
    'settings.language.current': 'In use',
    'settings.language.select': 'Choose {language}',
    'settings.language.scope.title': 'Saved on this device',
    'settings.language.scope.body':
      'The choice stays in this browser, so signing in somewhere else starts from that machine’s language. It is not shared with the rest of your team.',
    'settings.language.sample.title': 'How it reads',
    'settings.language.sample.date': 'Date',
    'settings.language.sample.money': 'Amount',
    'settings.language.sample.hours': 'Hours',
    'settings.switcher.label': 'Language',

    'chrome.nav.dashboard': 'Dashboard',
    'chrome.nav.employees': 'Employees',
    'chrome.nav.absences': 'Absences',
    'chrome.nav.colours': 'Colours',
    'chrome.nav.dayNotes': 'Day notes',
    'chrome.nav.settings': 'Settings',
    'chrome.nav.stock': 'Stock',
    'chrome.nav.receive': 'Receive stock',
    'chrome.nav.newCount': 'New count',
    'chrome.nav.counts': 'Counts',
    'chrome.nav.receipts': 'Deliveries',
    'chrome.nav.sales': 'Sales',
    'chrome.nav.stats': 'Statistics',
    'chrome.nav.menu': 'Menu',
    'chrome.nav.recipes': 'Recipes',
    'chrome.nav.suppliers': 'Suppliers',
    // Below every app's own pages, for the manager: who can sign in, and as what.
    'chrome.nav.commonLabel': 'Business',
    'chrome.nav.access': 'Access',
    // The employee's two screens, as tabs under their header.
    'chrome.nav.employeeLabel': 'Navigation',
    'chrome.nav.myShifts': 'My shifts',
    'chrome.apps.switch': 'Switch app',
    'chrome.apps.shifts': 'Shifts',
    'chrome.apps.inventory': 'Inventory',
    'chrome.apps.store': 'Shop',
    // The launcher a manager lands on after signing in. Next to no words on
    // purpose: a greeting, and the name under each app's mark.
    'launcher.greeting': 'Hi, {name}',
    'launcher.greeting.anonymous': 'Hi',
    'launcher.apps': 'Your apps',
    'launcher.app.shifts': 'ShiftPlanner',
    // The same screen for a business with no app on yet -- every business,
    // the day it signs up. As few words: what is happening, and nothing to do.
    // Named by the business's own name; the workspace, when it has none. A
    // business with apps meanwhile sees its name alone, and neither line.
    'launcher.empty.title': 'Your workspace is being set up',
    'launcher.empty.titleNamed': '{name} is being set up',
    'launcher.empty.body': 'We’ll let you know when it’s ready.',
    // Which apps the business has could not be asked, and nothing was known.
    'workspace.loadError': 'Your workspace could not be opened.',
    'workspace.retry': 'Try again',

    // --- The colour legend, and the law behind the colours ----------------
    'colours.title': 'What the colours mean',
    'colours.description':
      'Every colour the calendar uses, what it is telling you, and which of them are the law rather than a choice of ours.',
    'colours.calendar.title': 'On the calendar',
    'colours.shift.title': 'A shift',
    'colours.shift.body':
      'Somebody is working. Every shift is the same colour on purpose: what a shift IS is written on the bar, and a calendar in one colour reads as one calendar.',
    'colours.premium.title': 'Hours paid {pct}% more',
    'colours.premium.body':
      'The part of a shift between {from} and {to}: night work, paid {pct}% above the ordinary hour here. The hatching sits exactly where those hours fall, so a bar half hatched is a shift half at night.',
    'colours.premium.none':
      'The part of a shift between {from} and {to} — night work. Your pay policy adds nothing for it today, so this is only telling you when it happens.',
    'colours.premium.law':
      'Art. 36.1 ET defines night work; art. 36.2 requires a specific payment for it and leaves the figure to the agreement.',
    'colours.covered.title': 'Covered',
    'colours.covered.body':
      'That hour has at least as many people on it as you asked for. Green is your own requirement being met, not a legal one.',
    'colours.short.title': 'Short-staffed',
    'colours.short.body':
      'Fewer people than you asked for, in that hour or that day. Nothing was cancelled: the rota could not be filled without breaking something else.',
    'colours.away.title': 'Away that day',
    'colours.away.body':
      'On leave or absent, so nobody can be given that day. It is amber and not grey because it is true today and not tomorrow.',
    'colours.away.law':
      'Art. 38 ET: annual leave is a right and cannot be paid off while the contract lives.',
    'colours.closed.title': 'Closed, or outside your hours',
    'colours.closed.body':
      'The business is shut then, so nothing can be placed there and nothing is missing from it.',
    'colours.published.title': 'Published',
    'colours.published.body':
      'In the year, a filled day: the team can already see its shifts.',
    'colours.draft.title': 'Draft',
    'colours.draft.body':
      'In the year, a ringed day: it has shifts only you can see until you publish them.',

    'colours.limits.title': 'The limits your calendar is built to',
    'colours.limits.help':
      'Read from the rules held for {jurisdiction}. The planner is told them before it starts, and no calendar is shown that breaks one.',
    'colours.limits.none':
      'No labour rules are held for this business yet, so the calendar is built to your brief alone.',
    'colours.limit.dailyRest': '{value} h between the end of one shift and the start of the next',
    'colours.limit.maxDaily': 'At most {value} h of ordinary work in one day',
    'colours.limit.weeklyRest': '{value} h of unbroken rest every week',
    'colours.limit.nightAverage': 'A night worker’s day averages no more than {value} h',
    'colours.limit.overtimeCap': 'At most {value} overtime hours a year, per person',

    'colours.elsewhere.title': 'Elsewhere in the product',
    'colours.amber.title': 'Amber',
    'colours.amber.body':
      'Something that is true and worth knowing, but that stops nothing: the rules behind a rota, an assumption nobody stated, a day somebody is away.',
    'colours.red.title': 'Red',
    'colours.red.body':
      'Something did not happen, or cannot be undone: hours nobody is covering, a roster change that failed, deleting an account.',
    'chrome.logout': 'Log out',
    'chrome.build': 'Build of {when}',
    'chrome.role.manager': 'Manager',
    'chrome.role.employee': 'Employee',
    // A shop account: the till's tablet, not a person. Not "Shop", which is
    // the app's name (chrome.apps.store).
    'chrome.role.store': 'Shop account',
    'chrome.role.owner': 'Owner',
    'chrome.backoffice.title': 'Back office',
    'chrome.backoffice.subtitle': 'Platform operations',
    'chrome.backoffice.nav.overview': 'Overview',
    'chrome.backoffice.nav.customers': 'Customers',
    // The phone's bar (components/layout/MobileNav.tsx): the button that opens
    // the sidebar as a panel, the panel's name, and its close. "Navigation",
    // not "Menu": Menu is the shop's menu (chrome.nav.menu), a page in it.
    'chrome.mobileNav.open': 'Open navigation',
    'chrome.mobileNav.title': 'Navigation',
    'chrome.mobileNav.close': 'Close navigation',
  },
  es: {
    'settings.title': 'Configuración',
    'settings.description':
      'Con qué construye la IA el calendario y cómo se comporta el producto para ti.',
    'settings.scheduler.title': 'Turnos y reglas',
    'settings.scheduler.help':
      'Con qué construye la IA el calendario: los turnos que puede usar, lo que cuesta una hora y las reglas laborales de donde operas.',
    // --- Terminar la cuenta. Dicho claro, en el orden en que pasa. --------
    'settings.danger.title': 'Eliminar esta cuenta',
    'settings.danger.help':
      'Termina {org} y borra todo lo que hay dentro. No se puede deshacer y después no queda ninguna copia.',
    'settings.danger.item.people': 'Todos los empleados, sus contratos y sus ausencias.',
    'settings.danger.item.calendars':
      'Todos los calendarios, publicados y borradores, y todo lo que el producto aprendió de tu negocio.',
    'settings.danger.item.logins':
      'Todos los accesos, incluidos los de tu equipo: nadie podrá volver a entrar.',
    'settings.danger.final': 'Descárgate antes lo que necesites.',
    'settings.danger.button': 'Eliminar esta cuenta',
    'settings.danger.modal.title': 'Eliminar esta cuenta',
    'settings.danger.modal.body':
      'Esto borra {name} y todo lo que contiene, para todo el mundo y al instante. No se puede deshacer.',
    'settings.danger.modal.label': 'Escribe {name} para confirmar',
    'settings.danger.modal.confirm': 'Eliminar para siempre',
    'settings.danger.modal.deleting': 'Eliminando…',
    'settings.danger.cancel': 'Cancelar',

    'settings.language.title': 'Idioma',
    'settings.language.help':
      'Cambia toda la plataforma de golpe: todas las pantallas y también cómo se escriben las fechas y los importes.',
    'settings.language.current': 'En uso',
    'settings.language.select': 'Usar {language}',
    'settings.language.scope.title': 'Se guarda en este dispositivo',
    'settings.language.scope.body':
      'La elección se queda en este navegador, así que si entras desde otro sitio se empieza por el idioma de esa máquina. No se comparte con el resto del equipo.',
    'settings.language.sample.title': 'Cómo se lee',
    'settings.language.sample.date': 'Fecha',
    'settings.language.sample.money': 'Importe',
    'settings.language.sample.hours': 'Horas',
    'settings.switcher.label': 'Idioma',

    'chrome.nav.dashboard': 'Panel',
    'chrome.nav.employees': 'Empleados',
    'chrome.nav.absences': 'Ausencias',
    'chrome.nav.colours': 'Colores',
    'chrome.nav.dayNotes': 'Notas del día',
    'chrome.nav.settings': 'Configuración',
    'chrome.nav.stock': 'Stock',
    'chrome.nav.receive': 'Recibir mercancía',
    'chrome.nav.newCount': 'Nuevo conteo',
    'chrome.nav.counts': 'Conteos',
    'chrome.nav.receipts': 'Entradas',
    'chrome.nav.sales': 'Ventas',
    'chrome.nav.stats': 'Estadísticas',
    'chrome.nav.menu': 'Menú',
    'chrome.nav.recipes': 'Recetas',
    'chrome.nav.suppliers': 'Proveedores',
    // Bajo las páginas de cada app, para el responsable: quién entra y como qué.
    'chrome.nav.commonLabel': 'Negocio',
    'chrome.nav.access': 'Accesos',
    // Las dos pantallas del empleado, como pestañas bajo su cabecera.
    'chrome.nav.employeeLabel': 'Navegación',
    'chrome.nav.myShifts': 'Mis turnos',
    'chrome.apps.switch': 'Cambiar de aplicación',
    'chrome.apps.shifts': 'Turnos',
    'chrome.apps.inventory': 'Inventario',
    'chrome.apps.store': 'Tienda',
    // El lanzador al que llega el manager tras iniciar sesión. Casi sin
    // palabras a propósito: un saludo, y el nombre bajo la marca de cada app.
    'launcher.greeting': 'Hola, {name}',
    'launcher.greeting.anonymous': 'Hola',
    'launcher.apps': 'Tus aplicaciones',
    'launcher.app.shifts': 'ShiftPlanner',
    // La misma pantalla para un negocio sin ninguna app todavía -- todos, el
    // día que se dan de alta. Igual de pocas palabras: qué pasa, y nada que hacer.
    // Con el nombre del negocio; «tu espacio» si no lo tiene. «Todo listo» y no
    // «listo» a secas: el sujeto puede ser «La Bodeguita». Un negocio que ya
    // tiene apps ve solo su nombre, sin ninguna de las dos líneas.
    'launcher.empty.title': 'Tu espacio se está preparando',
    'launcher.empty.titleNamed': '{name} se está preparando',
    'launcher.empty.body': 'Te avisaremos cuando esté todo listo.',
    // No se ha podido preguntar qué apps tiene el negocio, y no se sabía nada.
    'workspace.loadError': 'No se ha podido abrir tu espacio.',
    'workspace.retry': 'Reintentar',

    // --- La leyenda de colores, y la ley que hay detrás -------------------
    'colours.title': 'Qué significan los colores',
    'colours.description':
      'Todos los colores que usa el calendario, qué te están diciendo, y cuáles de ellos son la ley y no una decisión nuestra.',
    'colours.calendar.title': 'En el calendario',
    'colours.shift.title': 'Un turno',
    'colours.shift.body':
      'Alguien está trabajando. Todos los turnos son del mismo color a propósito: lo que un turno ES está escrito en la barra, y un calendario de un solo color se lee como un solo calendario.',
    'colours.premium.title': 'Horas pagadas un {pct}% más',
    'colours.premium.body':
      'La parte del turno que va de {from} a {to}: trabajo nocturno, pagado un {pct}% por encima de la hora ordinaria aquí. El rayado está justo donde caen esas horas, así que media barra rayada es medio turno de noche.',
    'colours.premium.none':
      'La parte del turno que va de {from} a {to} — trabajo nocturno. Tu política de pago no le añade nada hoy, así que esto sólo te señala cuándo ocurre.',
    'colours.premium.law':
      'El art. 36.1 ET define el trabajo nocturno; el 36.2 exige una retribución específica y deja la cifra al convenio.',
    'colours.covered.title': 'Cubierto',
    'colours.covered.body':
      'Esa hora tiene al menos la gente que pediste. El verde es tu propio requisito cumplido, no uno legal.',
    'colours.short.title': 'Falta personal',
    'colours.short.body':
      'Menos gente de la que pediste, en esa hora o ese día. No se ha cancelado nada: el cuadrante no se pudo rellenar sin romper otra cosa.',
    'colours.away.title': 'Ausente ese día',
    'colours.away.body':
      'De vacaciones o con una ausencia, así que ese día no se le puede dar trabajo. Es ámbar y no gris porque es verdad hoy y mañana no.',
    'colours.away.law':
      'Art. 38 ET: las vacaciones son un derecho y no se pueden sustituir por dinero mientras dure el contrato.',
    'colours.closed.title': 'Cerrado, o fuera de tu horario',
    'colours.closed.body':
      'El negocio está cerrado entonces, así que ahí no se puede poner nada ni falta nada.',
    'colours.published.title': 'Publicado',
    'colours.published.body':
      'En el año, un día relleno: el equipo ya ve sus turnos.',
    'colours.draft.title': 'Borrador',
    'colours.draft.body':
      'En el año, un día con aro: tiene turnos que solo ves tú hasta que los publiques.',

    'colours.limits.title': 'Los límites con los que se construye tu calendario',
    'colours.limits.help':
      'Leídos de las reglas que tenemos para {jurisdiction}. Al planificador se le dicen antes de empezar, y no se te enseña ningún calendario que incumpla una.',
    'colours.limits.none':
      'Todavía no hay reglas laborales para este negocio, así que el calendario se construye sólo con tu brief.',
    'colours.limit.dailyRest': '{value} h entre el final de un turno y el principio del siguiente',
    'colours.limit.maxDaily': 'Como mucho {value} h de trabajo ordinario en un día',
    'colours.limit.weeklyRest': '{value} h seguidas de descanso cada semana',
    'colours.limit.nightAverage': 'La jornada de un trabajador nocturno promedia como mucho {value} h',
    'colours.limit.overtimeCap': 'Como mucho {value} horas extra al año por persona',

    'colours.elsewhere.title': 'En el resto del producto',
    'colours.amber.title': 'Ámbar',
    'colours.amber.body':
      'Algo que es cierto y conviene saber, pero que no impide nada: las reglas que sigue un cuadrante, un supuesto que nadie dijo, un día que alguien no está.',
    'colours.red.title': 'Rojo',
    'colours.red.body':
      'Algo no ha pasado, o no tiene vuelta atrás: horas que nadie cubre, un cambio de plantilla que falló, eliminar una cuenta.',
    'chrome.logout': 'Cerrar sesión',
    'chrome.build': 'Versión del {when}',
    'chrome.role.manager': 'Responsable',
    'chrome.role.employee': 'Empleado',
    // Una cuenta de tienda: la tablet del TPV, no una persona. No «Tienda»,
    // que es el nombre de la app (chrome.apps.store).
    'chrome.role.store': 'Cuenta de tienda',
    'chrome.role.owner': 'Propietario',
    'chrome.backoffice.title': 'Back office',
    'chrome.backoffice.subtitle': 'Operaciones de la plataforma',
    'chrome.backoffice.nav.overview': 'Resumen',
    'chrome.backoffice.nav.customers': 'Clientes',
    // La barra del móvil: el botón que abre la barra lateral como panel, el
    // nombre del panel y su cierre. «Navegación» y no «Menú», que es la carta
    // de la tienda (chrome.nav.menu), una página dentro de él.
    'chrome.mobileNav.open': 'Abrir navegación',
    'chrome.mobileNav.title': 'Navegación',
    'chrome.mobileNav.close': 'Cerrar navegación',
  },
};
