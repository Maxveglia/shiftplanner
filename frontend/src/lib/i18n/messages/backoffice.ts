import type { MessageModule } from './types';

// The operator's back office: platform metrics, the customer list, and the one
// screen where a subscription is actually moved.
//
// Two conventions worth knowing before editing these strings:
//
//   - Plan names (Starter, Growth, Scale) and the words "Back office" and
//     "ShiftPlanner" are product names and stay in English in both tables. The
//     plan and subscription-status labels themselves live in `labels.ts`,
//     because the same status is read on this screen and inside the product.
//   - A few sentences emphasise one word in the middle -- the customer's name,
//     or a subscription status. The whole sentence is still ONE key, and the
//     emphasised part is left as an unfilled `{name}` / `{status}` placeholder
//     that the component splits on before wrapping it in a <span>. That keeps
//     the word order free to change between languages, which concatenating
//     three fragments at the call site would not.

export const backoffice: MessageModule = {
  en: {
    'backoffice.viz.never': 'Never',
    'backoffice.viz.today': 'Today',
    'backoffice.viz.yesterday': 'Yesterday',
    'backoffice.viz.daysAgo': '{count} days ago',
    'backoffice.viz.monthsAgo.one': '1 month ago',
    'backoffice.viz.monthsAgo.other': '{count} months ago',

    'backoffice.login.subtitle': 'Platform operations. Not a customer workspace.',
    'backoffice.login.email': 'Email',
    'backoffice.login.password': 'Password',
    'backoffice.login.submit': 'Sign in',
    'backoffice.login.submitting': 'Signing in…',
    'backoffice.login.employee': 'Looking for your own schedule?',
    'backoffice.login.employeeLink': 'Sign in to ShiftPlanner',

    'backoffice.overview.title': 'Overview',
    'backoffice.overview.description':
      'How many companies are on ShiftPlanner, and how many of them pay.',
    'backoffice.overview.loading': 'Loading platform metrics…',
    'backoffice.overview.error': 'Could not load platform metrics',
    'backoffice.overview.paying.label': 'Paying customers',
    'backoffice.overview.paying.hint':
      '{share} of {total} accounts. Subscriptions in {status} only — past due is counted separately.',
    'backoffice.overview.trialing.label': 'On trial',
    'backoffice.overview.trialing.hint': 'Signed up, trial still running.',
    'backoffice.overview.trialExpired.label': 'Trial expired',
    'backoffice.overview.trialExpired.hint': 'Trial ran out without converting.',
    'backoffice.overview.pastDue.label': 'Past due',
    'backoffice.overview.pastDue.hint': 'Was paying, payment failed.',
    'backoffice.overview.canceled.label': 'Canceled',
    'backoffice.overview.canceled.hint': 'Left the platform.',

    'backoffice.overview.people.title': 'People on the platform',
    'backoffice.overview.managers.label': 'Managers',
    'backoffice.overview.employees.label': 'Employees scheduled',
    'backoffice.overview.people.hint': '{count} at paying customers.',
    'backoffice.overview.active7d.label': 'Active this week',
    'backoffice.overview.active7d.hint': 'Companies where someone signed in.',
    'backoffice.overview.dormant.label': 'Paying but dormant',
    'backoffice.overview.dormant.hint':
      'Paying, nobody in for 30 days. Churn that has not been filed yet.',

    'backoffice.overview.spend.title': 'What the model costs us',
    'backoffice.overview.spend.usd30d': 'Last 30 days',
    'backoffice.overview.spend.usdTotal': 'All time',
    'backoffice.overview.spend.calls30d': 'Model calls, 30 days',
    'backoffice.overview.spend.tokens30d': 'Tokens, 30 days',
    'backoffice.overview.spend.byPurpose': 'Last 30 days by what the call was for',
    'backoffice.overview.spend.empty': 'No model calls recorded yet.',
    'backoffice.overview.spend.note':
      'Every customer added up, priced at today’s rates in the provider’s currency. It is the only variable cost the product has, so this is what one more customer costs to serve.',
    'backoffice.overview.spend.months.title': 'Model spend by month',
    'backoffice.overview.spend.months.description':
      'The provider bills by calendar month, so this is the figure its cap applies to.',

    'backoffice.overview.byPlan.title': 'Customers by plan',
    'backoffice.overview.byPlan.note':
      'Every account holds a plan from the day it signs up, so the rows add up to all {total} accounts — trials included.',

    'backoffice.overview.months.title': 'Last 12 months',
    'backoffice.overview.months.showCharts': 'Show charts',
    'backoffice.overview.months.showTable': 'Show table',
    'backoffice.overview.months.column': 'Month',
    'backoffice.overview.signups.title': 'Signups',
    'backoffice.overview.signups.description': 'New companies',
    'backoffice.overview.conversions.title': 'Conversions',
    'backoffice.overview.conversions.description': 'Trials that started paying',
    'backoffice.overview.cancellations.title': 'Cancellations',
    'backoffice.overview.cancellations.description': 'Customers who left',
    'backoffice.overview.note':
      'Counts only. Amounts live with the payment provider — mirroring them here would create a second, quietly wrong answer to “how much”.',

    'backoffice.monthlyBars.total': '{count} in 12 months',
    'backoffice.monthlyBars.aria': '{title} by month. {summary}.',

    'backoffice.customers.title': 'Customers',
    'backoffice.customers.description':
      'Every organization on the platform, whether it pays or not.',
    'backoffice.customers.search': 'Search',
    'backoffice.customers.search.placeholder': 'Company name or email',
    'backoffice.customers.status': 'Status',
    'backoffice.customers.status.all': 'All accounts',
    'backoffice.customers.error': 'Could not load customers',
    'backoffice.customers.empty.title': 'No customers match',
    'backoffice.customers.empty.filtered':
      'Try a different search or clear the status filter.',
    'backoffice.customers.empty.none': 'Nobody has signed up yet.',
    'backoffice.customers.column.company': 'Company',
    'backoffice.customers.column.plan': 'Plan',
    'backoffice.customers.column.status': 'Status',
    'backoffice.customers.column.managers': 'Managers',
    'backoffice.customers.column.employees': 'Employees',
    'backoffice.customers.column.signedUp': 'Signed up',
    'backoffice.customers.column.lastActive': 'Last active',
    'backoffice.customers.range': '{from}–{to} of {total}',
    'backoffice.customers.previous': 'Previous',
    'backoffice.customers.next': 'Next',

    'backoffice.customer.loading': 'Loading customer…',
    'backoffice.customer.error': 'Could not load this customer',
    'backoffice.customer.back': '← All customers',
    'backoffice.customer.description': 'Signed up {date} · {jurisdiction}',

    'backoffice.customer.size.title': 'Size of the account',
    'backoffice.customer.size.managers': 'Managers',
    'backoffice.customer.size.employees': 'Employees',
    'backoffice.customer.size.templates': 'Shift templates',
    'backoffice.customer.size.absences': 'Absences recorded',
    'backoffice.customer.size.byStatus': 'Workforce by status',
    'backoffice.customer.size.note':
      'Totals only. The back office never loads a customer’s roster, salaries, or absence reasons — a support question is answered with the account’s administrators, listed below.',

    'backoffice.customer.cost.title': 'What this customer costs us',
    'backoffice.customer.cost.usd30d': 'Last 30 days',
    'backoffice.customer.cost.usdTotal': 'All time',
    'backoffice.customer.cost.calls30d': 'Model calls, 30 days',
    'backoffice.customer.cost.tokens30d': 'Tokens, 30 days',
    'backoffice.customer.cost.byPurpose': 'Last 30 days by what the call was for',
    'backoffice.customer.cost.purpose.intake.schedule': 'Reading the brief: hours and coverage',
    'backoffice.customer.cost.purpose.intake.team': 'Reading the brief: the team',
    'backoffice.customer.cost.purpose.intake.emphasis': 'Reading the brief: busy times',
    'backoffice.customer.cost.purpose.refine.calendar': 'Adjusting: calendar changes',
    'backoffice.customer.cost.purpose.refine.roster': 'Adjusting: roster changes',
    'backoffice.customer.cost.purpose.plan.month': 'Planning a month',
    'backoffice.customer.cost.purpose.plan.month.failed': 'Planning a month that was never delivered',
    'backoffice.customer.cost.purpose.notes.publish': 'Planner notes after a publish',
    'backoffice.customer.cost.purpose.notes.publish.lost': 'Planner notes after a publish, attempt lost to a retry',
    'backoffice.customer.cost.empty': 'No model calls recorded yet.',
    'backoffice.customer.cost.note':
      'Model calls only, priced at today’s rates in the provider’s currency. Hosting is a flat bill and the opening interview is free. This is a cost, not what the customer pays.',

    'backoffice.customer.admins.title': 'Administrators',
    'backoffice.customer.admins.empty.title': 'No manager accounts',
    'backoffice.customer.admins.empty.description':
      'Nobody can sign in to this workspace.',
    'backoffice.customer.admins.column.name': 'Name',
    'backoffice.customer.admins.column.email': 'Email',
    'backoffice.customer.admins.column.lastSeen': 'Last seen',
    'backoffice.customer.admins.column.state': 'State',
    'backoffice.customer.admins.active': 'Active',
    'backoffice.customer.admins.disabled': 'Disabled',
    'backoffice.customer.admins.logins.one':
      'Plus {count} employee login, counted but not listed.',
    'backoffice.customer.admins.logins.other':
      'Plus {count} employee logins, counted but not listed.',

    'backoffice.customer.pulse.title': 'Pulse',
    'backoffice.customer.pulse.lastSignIn': 'Last sign-in',
    'backoffice.customer.pulse.trialEnds': 'Trial ends',
    'backoffice.customer.pulse.startedPaying': 'Started paying',
    'backoffice.customer.pulse.canceled': 'Canceled',
    'backoffice.customer.pulse.never': 'Never',

    'backoffice.customer.subscription.title': 'Subscription',
    'backoffice.customer.subscription.plan': 'Plan',
    'backoffice.customer.subscription.status': 'Status',
    'backoffice.customer.subscription.seats': 'Contracted seats',
    'backoffice.customer.subscription.seats.placeholder': 'Not agreed',
    'backoffice.customer.subscription.trialEnds': 'Trial ends',
    'backoffice.customer.subscription.saved': 'Saved.',
    'backoffice.customer.subscription.save': 'Save subscription',
    'backoffice.customer.subscription.saving': 'Saving…',
    'backoffice.customer.subscription.note':
      'Moving this to {status} is what adds the account to the headline count.',

    'backoffice.customer.delete.title': 'Delete customer',
    'backoffice.customer.delete.warning':
      'Permanently removes {name} and everything that belonged to them — {count} employees, their contracts, schedules, absences and logins. This cannot be undone.',
    'backoffice.customer.delete.alternative':
      'For a customer who might come back, set their subscription to {status} instead — that keeps their history.',
    'backoffice.customer.delete.open': 'Delete this customer',
    'backoffice.customer.delete.confirmLabel': 'Type "{name}" to confirm',
    'backoffice.customer.delete.confirm': 'Delete permanently',
    'backoffice.customer.delete.deleting': 'Deleting…',
    'backoffice.customer.delete.cancel': 'Cancel',
  },
  es: {
    'backoffice.viz.never': 'Nunca',
    'backoffice.viz.today': 'Hoy',
    'backoffice.viz.yesterday': 'Ayer',
    'backoffice.viz.daysAgo': 'hace {count} días',
    'backoffice.viz.monthsAgo.one': 'hace 1 mes',
    'backoffice.viz.monthsAgo.other': 'hace {count} meses',

    'backoffice.login.subtitle':
      'Operaciones de la plataforma. Esto no es el espacio de trabajo de un cliente.',
    'backoffice.login.email': 'Email',
    'backoffice.login.password': 'Contraseña',
    'backoffice.login.submit': 'Entrar',
    'backoffice.login.submitting': 'Entrando…',
    'backoffice.login.employee': '¿Buscas tus propios turnos?',
    'backoffice.login.employeeLink': 'Entra en ShiftPlanner',

    'backoffice.overview.title': 'Resumen',
    'backoffice.overview.description':
      'Cuántas empresas hay en ShiftPlanner y cuántas de ellas pagan.',
    'backoffice.overview.loading': 'Cargando las métricas de la plataforma…',
    'backoffice.overview.error':
      'No se han podido cargar las métricas de la plataforma',
    'backoffice.overview.paying.label': 'Clientes que pagan',
    'backoffice.overview.paying.hint':
      '{share} de {total} cuentas. Sólo las suscripciones marcadas como {status} — las impagadas se cuentan aparte.',
    'backoffice.overview.trialing.label': 'En prueba',
    'backoffice.overview.trialing.hint':
      'Se han dado de alta y la prueba sigue en marcha.',
    'backoffice.overview.trialExpired.label': 'Prueba caducada',
    'backoffice.overview.trialExpired.hint': 'La prueba terminó sin convertir.',
    'backoffice.overview.pastDue.label': 'Impagadas',
    'backoffice.overview.pastDue.hint': 'Pagaban, pero falló el cobro.',
    'backoffice.overview.canceled.label': 'Canceladas',
    'backoffice.overview.canceled.hint': 'Se han ido de la plataforma.',

    'backoffice.overview.people.title': 'Personas en la plataforma',
    'backoffice.overview.managers.label': 'Responsables',
    'backoffice.overview.employees.label': 'Empleados planificados',
    'backoffice.overview.people.hint': '{count} en clientes que pagan.',
    'backoffice.overview.active7d.label': 'Activas esta semana',
    'backoffice.overview.active7d.hint': 'Empresas en las que ha entrado alguien.',
    'backoffice.overview.dormant.label': 'Pagan pero no entran',
    'backoffice.overview.dormant.hint':
      'Pagan y nadie entra desde hace 30 días. Bajas que todavía no se han dado por perdidas.',

    'backoffice.overview.spend.title': 'Lo que nos cuesta el modelo',
    'backoffice.overview.spend.usd30d': 'Últimos 30 días',
    'backoffice.overview.spend.usdTotal': 'Desde el principio',
    'backoffice.overview.spend.calls30d': 'Llamadas al modelo, 30 días',
    'backoffice.overview.spend.tokens30d': 'Tokens, 30 días',
    'backoffice.overview.spend.byPurpose':
      'Últimos 30 días según para qué fue la llamada',
    'backoffice.overview.spend.empty':
      'Todavía no hay llamadas al modelo registradas.',
    'backoffice.overview.spend.note':
      'Todos los clientes sumados, a los precios de hoy y en la moneda del proveedor. Es el único coste variable del producto, así que esto es lo que cuesta atender a un cliente más.',
    'backoffice.overview.spend.months.title': 'Gasto en el modelo por mes',
    'backoffice.overview.spend.months.description':
      'El proveedor factura por mes natural, así que este es el número al que se aplica su límite.',

    'backoffice.overview.byPlan.title': 'Clientes por plan',
    'backoffice.overview.byPlan.note':
      'Toda cuenta tiene un plan desde el día del alta, así que las filas suman las {total} cuentas — pruebas incluidas.',

    'backoffice.overview.months.title': 'Últimos 12 meses',
    'backoffice.overview.months.showCharts': 'Ver gráficos',
    'backoffice.overview.months.showTable': 'Ver tabla',
    'backoffice.overview.months.column': 'Mes',
    'backoffice.overview.signups.title': 'Altas',
    'backoffice.overview.signups.description': 'Empresas nuevas',
    'backoffice.overview.conversions.title': 'Conversiones',
    'backoffice.overview.conversions.description':
      'Pruebas que empezaron a pagar',
    'backoffice.overview.cancellations.title': 'Cancelaciones',
    'backoffice.overview.cancellations.description': 'Clientes que se fueron',
    'backoffice.overview.note':
      'Sólo recuentos. Los importes están en la pasarela de pago — duplicarlos aquí crearía una segunda respuesta, discretamente equivocada, a la pregunta de “cuánto”.',

    'backoffice.monthlyBars.total': '{count} en 12 meses',
    'backoffice.monthlyBars.aria': '{title} por mes. {summary}.',

    'backoffice.customers.title': 'Clientes',
    'backoffice.customers.description':
      'Todas las organizaciones de la plataforma, paguen o no.',
    'backoffice.customers.search': 'Buscar',
    'backoffice.customers.search.placeholder': 'Nombre de la empresa o email',
    'backoffice.customers.status': 'Estado',
    'backoffice.customers.status.all': 'Todas las cuentas',
    'backoffice.customers.error': 'No se han podido cargar los clientes',
    'backoffice.customers.empty.title': 'Ningún cliente coincide',
    'backoffice.customers.empty.filtered':
      'Prueba con otra búsqueda o quita el filtro de estado.',
    'backoffice.customers.empty.none': 'Todavía no se ha dado de alta nadie.',
    'backoffice.customers.column.company': 'Empresa',
    'backoffice.customers.column.plan': 'Plan',
    'backoffice.customers.column.status': 'Estado',
    'backoffice.customers.column.managers': 'Responsables',
    'backoffice.customers.column.employees': 'Empleados',
    'backoffice.customers.column.signedUp': 'Alta',
    'backoffice.customers.column.lastActive': 'Última actividad',
    'backoffice.customers.range': '{from}–{to} de {total}',
    'backoffice.customers.previous': 'Anteriores',
    'backoffice.customers.next': 'Siguientes',

    'backoffice.customer.loading': 'Cargando el cliente…',
    'backoffice.customer.error': 'No se ha podido cargar este cliente',
    'backoffice.customer.back': '← Todos los clientes',
    'backoffice.customer.description': 'Alta el {date} · {jurisdiction}',

    'backoffice.customer.size.title': 'Tamaño de la cuenta',
    'backoffice.customer.size.managers': 'Responsables',
    'backoffice.customer.size.employees': 'Empleados',
    'backoffice.customer.size.templates': 'Plantillas de turno',
    'backoffice.customer.size.absences': 'Ausencias registradas',
    'backoffice.customer.size.byStatus': 'Empleados por situación',
    'backoffice.customer.size.note':
      'Sólo totales. El back office nunca carga la plantilla de un cliente, ni sus salarios, ni los motivos de sus ausencias — una consulta de soporte se resuelve con los administradores de la cuenta, que están listados debajo.',

    'backoffice.customer.cost.title': 'Lo que nos cuesta este cliente',
    'backoffice.customer.cost.usd30d': 'Últimos 30 días',
    'backoffice.customer.cost.usdTotal': 'Desde el principio',
    'backoffice.customer.cost.calls30d': 'Llamadas al modelo, 30 días',
    'backoffice.customer.cost.tokens30d': 'Tokens, 30 días',
    'backoffice.customer.cost.byPurpose': 'Últimos 30 días según para qué fue la llamada',
    'backoffice.customer.cost.purpose.intake.schedule': 'Leer el brief: horarios y cobertura',
    'backoffice.customer.cost.purpose.intake.team': 'Leer el brief: el equipo',
    'backoffice.customer.cost.purpose.intake.emphasis': 'Leer el brief: momentos de más trabajo',
    'backoffice.customer.cost.purpose.refine.calendar': 'Ajustar: cambios en el calendario',
    'backoffice.customer.cost.purpose.refine.roster': 'Ajustar: cambios en la plantilla',
    'backoffice.customer.cost.purpose.plan.month': 'Planificar un mes',
    'backoffice.customer.cost.purpose.plan.month.failed': 'Planificar un mes que no llegó a entregarse',
    'backoffice.customer.cost.purpose.notes.publish': 'Notas del planificador tras publicar',
    'backoffice.customer.cost.purpose.notes.publish.lost': 'Notas del planificador tras publicar, intento perdido en un reintento',
    'backoffice.customer.cost.empty': 'Todavía no hay llamadas al modelo registradas.',
    'backoffice.customer.cost.note':
      'Sólo llamadas al modelo, a los precios de hoy y en la moneda del proveedor. El alojamiento es una factura fija y la entrevista inicial es gratis. Es un coste, no lo que paga el cliente.',

    'backoffice.customer.admins.title': 'Administradores',
    'backoffice.customer.admins.empty.title': 'Sin cuentas de responsable',
    'backoffice.customer.admins.empty.description':
      'Nadie puede entrar en este espacio de trabajo.',
    'backoffice.customer.admins.column.name': 'Nombre',
    'backoffice.customer.admins.column.email': 'Email',
    'backoffice.customer.admins.column.lastSeen': 'Última conexión',
    'backoffice.customer.admins.column.state': 'Situación',
    'backoffice.customer.admins.active': 'Activa',
    'backoffice.customer.admins.disabled': 'Desactivada',
    'backoffice.customer.admins.logins.one':
      'Y además {count} acceso de empleado, contado pero no listado.',
    'backoffice.customer.admins.logins.other':
      'Y además {count} accesos de empleado, contados pero no listados.',

    'backoffice.customer.pulse.title': 'Pulso',
    'backoffice.customer.pulse.lastSignIn': 'Última entrada',
    'backoffice.customer.pulse.trialEnds': 'Fin de la prueba',
    'backoffice.customer.pulse.startedPaying': 'Empezó a pagar',
    'backoffice.customer.pulse.canceled': 'Cancelada',
    'backoffice.customer.pulse.never': 'Nunca',

    'backoffice.customer.subscription.title': 'Suscripción',
    'backoffice.customer.subscription.plan': 'Plan',
    'backoffice.customer.subscription.status': 'Estado',
    'backoffice.customer.subscription.seats': 'Licencias contratadas',
    'backoffice.customer.subscription.seats.placeholder': 'Sin acordar',
    'backoffice.customer.subscription.trialEnds': 'Fin de la prueba',
    'backoffice.customer.subscription.saved': 'Guardado.',
    'backoffice.customer.subscription.save': 'Guardar la suscripción',
    'backoffice.customer.subscription.saving': 'Guardando…',
    'backoffice.customer.subscription.note':
      'Pasar esto a {status} es lo que suma la cuenta al recuento principal.',

    'backoffice.customer.delete.title': 'Eliminar el cliente',
    'backoffice.customer.delete.warning':
      'Elimina para siempre a {name} y todo lo que era suyo — {count} empleados, sus contratos, sus cuadrantes, sus ausencias y sus accesos. Esto no se puede deshacer.',
    'backoffice.customer.delete.alternative':
      'Si el cliente puede volver, pon su suscripción en {status} en vez de esto — así conservas su historial.',
    'backoffice.customer.delete.open': 'Eliminar este cliente',
    'backoffice.customer.delete.confirmLabel': 'Escribe "{name}" para confirmar',
    'backoffice.customer.delete.confirm': 'Eliminar definitivamente',
    'backoffice.customer.delete.deleting': 'Eliminando…',
    'backoffice.customer.delete.cancel': 'Cancelar',
  },
};
