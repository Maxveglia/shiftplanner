import type { MessageModule } from './types';

// The roster screens: the employee list, one employee's file (contracts and
// vacation balance), absences, and the card that lets a manager hand somebody
// a login to the employee app.
//
// Enum words -- employment status, employment type, absence status, ledger
// movement, pay period -- are NOT here. They live in `labels.ts` because the
// same status is written in three different screens and must read the same in
// all of them.

export const people: MessageModule = {
  en: {
    // Shared by the three modals on these screens.
    'people.action.cancel': 'Cancel',
    'people.action.saving': 'Saving…',
    'people.action.create': 'Create',

    // Employees list
    'people.employees.title': 'Employees',
    'people.employees.description':
      'People in your organization and their current contract.',
    'people.employees.add': 'Add employee',
    'people.employees.loadError': 'Could not load employees',
    'people.employees.empty.title': 'No employees yet',
    'people.employees.empty.description': 'Add your first employee to get started.',
    'people.employees.col.number': '#',
    'people.employees.col.name': 'Name',
    'people.employees.name.label': 'Name of {name} — click to correct it',
    'people.employees.col.id': 'ID',
    'people.employees.col.status': 'Status',
    'people.employees.col.contract': 'Current contract',
    'people.employees.col.hours': 'Hours / week',
    // Where each person stands against their contract. "Ahead" and "behind"
    // rather than good and bad: under an annual average a long month is
    // answered by a short one, and colouring one of them as a problem would
    // have managers "fixing" a rota that is working as intended.
    'people.employees.col.balance': 'Hours balance',
    // The bar on the person's own file. The middle is their contract; how far
    // from it they are is how far from it they look. Ahead is not a problem
    // to be fixed -- under an annual average a long month is answered by a
    // short one -- so the two directions differ without either being an alarm.
    'people.employee.balance.title': 'Hours against contract',
    'people.employee.balance.month': 'This month',
    'people.employee.balance.quarter': 'This quarter',
    'people.employee.balance.year': 'This year',
    'people.employee.balance.ahead': '{hours} ahead',
    'people.employee.balance.behind': '{hours} behind',
    'people.employee.balance.level': 'On track',
    // The headline is the length of the bar in words: how much of the stretch
    // is done out of what the contract adds up to over it.
    'people.employee.balance.of': '{worked} of {total}',
    'people.employee.balance.since': 'since {date}',
    // The rota stops short of the stretch: hours nobody is staffed for yet.
    'people.employee.balance.unplanned': '{hours} unplanned',
    // Or it carries more than the contract asks for.
    'people.employee.balance.over': '{hours} over contract',
    'people.employee.balance.key.worked': 'worked',
    'people.employee.balance.key.planned': 'on the rota',
    'people.employee.balance.key.today': 'today',
    'people.employee.balance.loadError': 'Hours could not be loaded',
    'people.employee.balance.empty.title': 'Nothing to measure yet',
    'people.employee.balance.empty.description':
      'Once this person has a contract and a published rota, their hours show here.',
    'people.employees.balance.ahead': '+{hours}',
    'people.employees.balance.behind': '−{hours}',
    'people.employees.balance.level': 'on track',
    'people.employees.balance.month': 'this month',
    'people.employees.balance.quarter': 'quarter',
    'people.employees.balance.year': 'year',
    'people.employees.col.hireDate': 'Hire date',
    'people.employees.noContract': '— none —',
    'people.employees.remove': 'Remove',
    'people.employees.removeNamed': 'Remove {name}',
    'people.employees.removeHint':
      'Drag a row down to uncover its Remove button, or reach it with the Tab key. With a mouse, drag across several rows to mark them all. Nothing is asked beforehand — you get a few seconds to undo instead.',
    'people.employees.selected.one': '1 person marked',
    'people.employees.selected.other': '{count} people marked',
    'people.employees.selected.clear': 'Clear',
    'people.employees.selected.remove': 'Remove them',
    'people.employees.undo.removed': '{name} removed',
    'people.employees.undo.action': 'Undo',
    'people.employees.undo.restoring': 'Bringing them back…',
    'people.employees.undo.dismiss': 'Dismiss',
    'people.employees.undo.failed': 'Could not bring {name} back — try again.',

    // Employees list -- new employee modal
    'people.employees.form.title': 'Add employee',
    'people.employees.form.employeeId': 'Employee ID',
    'people.employees.form.assignAuto': 'Assign automatically',
    'people.employees.form.setManually': 'Set manually',
    'people.employees.form.idPlaceholder': 'e.g. EMP-014',
    'people.employees.form.autoAssigned': 'Assigned automatically — next available code',
    'people.employees.form.fullName': 'Full name',
    'people.employees.form.email': 'Email (optional)',
    'people.employees.form.status': 'Employment status',
    'people.employees.form.hireDate': 'Hire date',

    // Employee detail -- header and details card
    'people.employee.back': 'Back to employees',
    'people.employee.loadError': 'Could not load employee',
    'people.employee.noEmail': 'no email',
    'people.employee.addContract': 'Add contract version',
    'people.employee.details': 'Details',
    'people.employee.field.status': 'Status',
    'people.employee.field.hireDate': 'Hire date',
    'people.employee.field.currentContract': 'Current contract',
    'people.employee.field.weeklyHours': 'Hours / week',
    'people.employee.hours.label': 'Weekly hours — type a new number to change it',
    'people.employee.field.paid': 'Paid',
    'people.employee.field.created': 'Created',
    'people.employee.noContract': '— none —',

    // Employee detail -- vacation balance
    'people.employee.vacation.title': 'Vacation balance',
    'people.employee.vacation.days.one': '{count} day',
    'people.employee.vacation.days.other': '{count} days',
    'people.employee.vacation.loadError': 'Could not load balance',
    'people.employee.vacation.empty.title': 'No ledger movements yet',
    'people.employee.vacation.empty.description':
      'Accruals and consumptions will appear here.',
    'people.employee.vacation.col.date': 'Date',
    'people.employee.vacation.col.movement': 'Movement',
    'people.employee.vacation.col.days': 'Days',
    'people.employee.vacation.col.reason': 'Reason',

    // Employee detail -- contract history
    'people.employee.contracts.title': 'Contract history (versioned)',
    'people.employee.contracts.loadError': 'Could not load contracts',
    'people.employee.contracts.empty.title': 'No contracts yet',
    'people.employee.contracts.empty.description':
      'Add the first contract version for this employee.',
    'people.employee.contracts.col.type': 'Type',
    'people.employee.contracts.col.validFrom': 'Valid from',
    'people.employee.contracts.col.validTo': 'Valid to',
    'people.employee.contracts.col.salary': 'Salary',
    'people.employee.contracts.col.hourly': 'Hourly',
    'people.employee.contracts.col.hours': 'Min/Max hrs',
    'people.employee.contracts.col.complementary': 'Complementary',
    'people.employee.contracts.noPact': 'No pact',
    'people.employee.contracts.col.paid': 'Paid',
    'people.employee.contracts.col.premiums': 'Premiums',
    'people.employee.contracts.premiumsInherited': 'As the business',
    'people.employee.contracts.col.state': 'State',
    'people.employee.contracts.open': 'Open',
    'people.employee.contracts.closed': 'Closed',

    // Employee detail -- new contract version modal
    'people.employee.form.title': 'Add contract version',
    'people.employee.form.versioningNote':
      'Creating a new version closes the currently open contract (its valid-to becomes the day before this one starts). History is never rewritten.',
    'people.employee.form.employmentType': 'Employment type',
    'people.employee.form.baseSalary': 'Base annual salary',
    'people.employee.form.hourlyRate': 'Hourly rate',
    'people.employee.form.minHours': 'Min hours / week',
    'people.employee.form.maxHours': 'Max hours / week',
    'people.employee.form.complementaryPct': 'Complementary hours (%)',
    'people.employee.form.complementaryPct.hint':
      'Part-time only. The share of the contract agreed in writing as complementary hours (art. 12.5 ET): up to 30%, or 60% where a convenio says so. Leave empty if no pact was signed — then none of them may be required.',
    'people.employee.form.premiums': 'Own premiums',
    'people.employee.form.premiums.hint':
      'Leave a field empty to pay what the business pays. Type 0 only if this person is not paid that premium at all.',
    'people.employee.form.premiums.night': 'Night (%)',
    'people.employee.form.premiums.weekend': 'Weekend (%)',
    'people.employee.form.premiums.overtime': 'Overtime (×)',
    'people.employee.form.premiums.inheritPct': 'business default ({value}%)',
    'people.employee.form.premiums.inheritMult': 'business default (×{value})',
    'people.employee.form.premiums.includedInSalary':
      'Night work is included in the salary (art. 36.2 ET)',
    'people.employee.form.premiums.belowFloor':
      'The agreement sets a {pct}% night premium. Paying less is only lawful when night work is priced into the salary — tick the box above if it is. You can save either way.',
    'people.employee.form.paid': 'Paid',
    'people.employee.form.validFrom': 'Valid from',
    'people.employee.form.payPeriodNote':
      'The pay period is what this person sees in their own app: their hours and pay estimate are grouped by it.',

    // Absences
    'people.absences.title': 'Absences',
    'people.absences.description':
      'Time-off requests. Approving a balance-consuming type posts a ledger movement.',
    'people.absences.request': 'Request absence',
    'people.absences.loadError': 'Could not load absences',
    'people.absences.empty.title': 'No absences yet',
    'people.absences.col.employee': 'Employee',
    'people.absences.col.type': 'Type',
    'people.absences.col.from': 'From',
    'people.absences.col.to': 'To',
    'people.absences.col.status': 'Status',
    'people.absences.col.action': 'Action',
    'people.absences.approve': 'Approve',

    // What approving COST the rota. Approving used to change a status and a
    // balance and nothing else, so the shift stayed on the calendar with
    // nobody behind it. Now it comes off, and the manager is told -- because
    // the hole is theirs to fill and nothing else on this screen would say so.
    'people.absences.cleared.one':
      '1 shift came off {name}: {hours} that nobody is covering now.',
    'people.absences.cleared.other':
      '{count} shifts came off {name}: {hours} that nobody is covering now.',
    'people.absences.cleared.published':
      'The team had already been shown {count} of them.',
    'people.absences.cleared.none': 'Approved. There was nothing on the rota to take off.',

    // Absences -- request modal
    'people.absences.form.title': 'Request absence',
    'people.absences.form.submit': 'Submit',
    'people.absences.form.employee': 'Employee',
    'people.absences.form.employeePlaceholder': 'Select an employee…',
    'people.absences.form.type': 'Absence type',
    'people.absences.form.typePlaceholder': 'Select a type…',
    'people.absences.form.start': 'Start',
    'people.absences.form.end': 'End',
    'people.absences.form.note': 'Note (optional)',

    // Absences -- leave types
    'people.absences.types.title': 'Leave types in this organization',
    'people.absences.types.paid': 'paid',
    'people.absences.types.usesBalance': 'uses balance',
    'people.absences.types.recoverable': 'worked back',
    'people.absences.types.recoverable.note':
      'Tick a leave type whose hours are worked back later: those hours then count as ordinary hours of recovery rather than as overtime.',
    'people.absences.types.healthData': 'health data',
    'people.absences.types.note':
      'Health-data reasons are never shown to the scheduler — it only sees that the person is unavailable.',

    // Team access card
    'people.access.title': 'Team access',
    'people.access.canSignIn': 'Can sign in',
    'people.access.disabled': 'Disabled',
    'people.access.noLogin': 'No login',
    'people.access.granted': 'Granted {date}.',
    'people.access.revoking': 'Revoking…',
    'people.access.revoke': 'Revoke access',
    // Asked before it is done: the login is deleted, and giving it back means a new password.
    'people.access.revokeConfirm.title': 'Revoke the access of {name}?',
    'people.access.revokeConfirm.body':
      '{name} will no longer be able to sign in. Their record, shifts and history stay as they are. You can give them access again whenever you like, with a new password.',
    'people.access.revokeConfirm.confirm': 'Revoke access',
    'people.access.noAccess':
      '{name} cannot sign in yet, so their published shifts are not visible to them.',
    'people.access.noAccessPlain': '{name} cannot sign in yet.',
    'people.access.give': 'Give access',
    'people.access.handover.title': 'Pass these on to {name}',
    'people.access.handover.email': 'Email',
    'people.access.handover.password': 'Password',
    'people.access.handover.onceOnly':
      'This is the only time the password is shown — it is stored hashed.',
    'people.access.handover.done': 'Done',
    'people.access.form.title': 'Give access',
    'people.access.form.creating': 'Creating…',
    'people.access.form.submit': 'Create login',
    // What a login gets into, one line per app the business has
    // (lib/access.ts, accessScope): an employee all three; a shop account
    // -- the till's tablet -- the last two.
    'people.access.scope.intro': 'Signed in, they have:',
    'people.access.scope.introStore': 'Signed in, the tablet has:',
    'people.access.scope.shifts':
      'Their own shifts, hours and pay estimate — and nothing about anyone else on the team.',
    'people.access.scope.inventory':
      'The Inventory: stock, counts, deliveries and orders to suppliers — without creating or editing products or suppliers.',
    'people.access.scope.store':
      'The Shop: charging at the till, voiding a sale, and the menu, statistics and recipes to read — without touching the menu.',
    'people.access.form.email': 'Email',
    'people.access.form.emailPlaceholder': 'name@company.com',
    'people.access.form.password': 'Password',
    'people.access.form.suggest': 'Suggest',
  },
  es: {
    'people.action.cancel': 'Cancelar',
    'people.action.saving': 'Guardando…',
    'people.action.create': 'Crear',

    'people.employees.title': 'Empleados',
    'people.employees.description':
      'Las personas de tu organización y el contrato que tienen ahora mismo.',
    'people.employees.add': 'Añadir empleado',
    'people.employees.loadError': 'No se han podido cargar los empleados',
    'people.employees.empty.title': 'Todavía no hay empleados',
    'people.employees.empty.description': 'Añade tu primer empleado para empezar.',
    'people.employees.col.number': 'N.º',
    'people.employees.col.name': 'Nombre',
    'people.employees.name.label': 'Nombre de {name} — haz clic para corregirlo',
    'people.employees.col.id': 'ID',
    'people.employees.col.status': 'Situación',
    'people.employees.col.contract': 'Contrato actual',
    'people.employees.col.hours': 'Horas / semana',
    // "Por delante" y "por detrás", no bien y mal: con cómputo anual un mes
    // largo se compensa con uno corto.
    'people.employees.col.balance': 'Saldo de horas',
    // La barra de la ficha. El centro es su contrato.
    'people.employee.balance.title': 'Horas frente al contrato',
    'people.employee.balance.month': 'Este mes',
    'people.employee.balance.quarter': 'Este trimestre',
    'people.employee.balance.year': 'Este año',
    'people.employee.balance.ahead': '{hours} por delante',
    'people.employee.balance.behind': '{hours} por detrás',
    'people.employee.balance.level': 'Al día',
    'people.employee.balance.of': '{worked} de {total}',
    'people.employee.balance.since': 'desde el {date}',
    'people.employee.balance.unplanned': '{hours} sin planificar',
    'people.employee.balance.over': '{hours} por encima del contrato',
    'people.employee.balance.key.worked': 'trabajadas',
    'people.employee.balance.key.planned': 'en el horario',
    'people.employee.balance.key.today': 'hoy',
    'people.employee.balance.loadError': 'No se han podido cargar las horas',
    'people.employee.balance.empty.title': 'Todavía no hay nada que medir',
    'people.employee.balance.empty.description':
      'Cuando esta persona tenga contrato y un horario publicado, sus horas aparecerán aquí.',
    'people.employees.balance.ahead': '+{hours}',
    'people.employees.balance.behind': '−{hours}',
    'people.employees.balance.level': 'al día',
    'people.employees.balance.month': 'este mes',
    'people.employees.balance.quarter': 'trimestre',
    'people.employees.balance.year': 'año',
    'people.employees.col.hireDate': 'Fecha de alta',
    'people.employees.noContract': '— ninguno —',
    'people.employees.remove': 'Eliminar',
    'people.employees.removeNamed': 'Eliminar a {name}',
    'people.employees.removeHint':
      'Arrastra una fila hacia abajo para descubrir su botón de eliminar, o llega hasta él con el tabulador. Con ratón, arrastra sobre varias filas para marcarlas todas. No se pregunta nada antes: tienes unos segundos para deshacer.',
    'people.employees.selected.one': '1 persona marcada',
    'people.employees.selected.other': '{count} personas marcadas',
    'people.employees.selected.clear': 'Quitar la marca',
    'people.employees.selected.remove': 'Eliminarlas',
    'people.employees.undo.removed': 'Se ha eliminado a {name}',
    'people.employees.undo.action': 'Deshacer',
    'people.employees.undo.restoring': 'Recuperando…',
    'people.employees.undo.dismiss': 'Descartar',
    'people.employees.undo.failed':
      'No se ha podido recuperar a {name}. Inténtalo otra vez.',

    'people.employees.form.title': 'Añadir empleado',
    'people.employees.form.employeeId': 'ID de empleado',
    'people.employees.form.assignAuto': 'Asignar automáticamente',
    'people.employees.form.setManually': 'Escribirlo a mano',
    'people.employees.form.idPlaceholder': 'p. ej. EMP-014',
    'people.employees.form.autoAssigned':
      'Se asigna automáticamente — el siguiente código libre',
    'people.employees.form.fullName': 'Nombre completo',
    'people.employees.form.email': 'Email (opcional)',
    'people.employees.form.status': 'Situación laboral',
    'people.employees.form.hireDate': 'Fecha de alta',

    'people.employee.back': 'Volver a empleados',
    'people.employee.loadError': 'No se ha podido cargar el empleado',
    'people.employee.noEmail': 'sin email',
    'people.employee.addContract': 'Añadir versión de contrato',
    'people.employee.details': 'Datos',
    'people.employee.field.status': 'Situación',
    'people.employee.field.hireDate': 'Fecha de alta',
    'people.employee.field.currentContract': 'Contrato actual',
    'people.employee.field.weeklyHours': 'Horas / semana',
    'people.employee.hours.label': 'Horas semanales — escribe otro número para cambiarlas',
    'people.employee.field.paid': 'Cobra',
    'people.employee.field.created': 'Creado',
    'people.employee.noContract': '— ninguno —',

    'people.employee.vacation.title': 'Saldo de vacaciones',
    'people.employee.vacation.days.one': '{count} día',
    'people.employee.vacation.days.other': '{count} días',
    'people.employee.vacation.loadError': 'No se ha podido cargar el saldo',
    'people.employee.vacation.empty.title': 'Todavía no hay movimientos',
    'people.employee.vacation.empty.description':
      'Aquí aparecerán los devengos y los consumos.',
    'people.employee.vacation.col.date': 'Fecha',
    'people.employee.vacation.col.movement': 'Movimiento',
    'people.employee.vacation.col.days': 'Días',
    'people.employee.vacation.col.reason': 'Motivo',

    'people.employee.contracts.title': 'Historial de contratos (por versiones)',
    'people.employee.contracts.loadError': 'No se han podido cargar los contratos',
    'people.employee.contracts.empty.title': 'Todavía no hay contratos',
    'people.employee.contracts.empty.description':
      'Añade la primera versión de contrato de este empleado.',
    'people.employee.contracts.col.type': 'Tipo',
    'people.employee.contracts.col.validFrom': 'Desde',
    'people.employee.contracts.col.validTo': 'Hasta',
    'people.employee.contracts.col.salary': 'Sueldo',
    'people.employee.contracts.col.hourly': 'Por hora',
    'people.employee.contracts.col.hours': 'Horas mín./máx.',
    'people.employee.contracts.col.complementary': 'Complementarias',
    'people.employee.contracts.noPact': 'Sin pacto',
    'people.employee.contracts.col.paid': 'Cobra',
    'people.employee.contracts.col.premiums': 'Pluses',
    'people.employee.contracts.premiumsInherited': 'Como el negocio',
    'people.employee.contracts.col.state': 'Estado',
    'people.employee.contracts.open': 'Abierto',
    'people.employee.contracts.closed': 'Cerrado',

    'people.employee.form.title': 'Añadir versión de contrato',
    'people.employee.form.versioningNote':
      'Al crear una versión nueva se cierra el contrato abierto (su fecha de fin pasa a ser el día anterior al inicio de esta). El historial nunca se reescribe.',
    'people.employee.form.employmentType': 'Tipo de contrato',
    'people.employee.form.baseSalary': 'Sueldo bruto anual',
    'people.employee.form.hourlyRate': 'Precio por hora',
    'people.employee.form.minHours': 'Horas mín. / semana',
    'people.employee.form.maxHours': 'Horas máx. / semana',
    'people.employee.form.complementaryPct': 'Horas complementarias (%)',
    'people.employee.form.complementaryPct.hint':
      'Solo a tiempo parcial. Porcentaje del contrato pactado por escrito como horas complementarias (art. 12.5 ET): hasta el 30%, o el 60% si lo amplía el convenio. Déjalo vacío si no hay pacto firmado — entonces no puede exigirse ninguna.',
    'people.employee.form.premiums': 'Pluses propios',
    'people.employee.form.premiums.hint':
      'Deja un campo vacío para pagar lo que paga el negocio. Escribe 0 solo si esta persona no cobra ese plus.',
    'people.employee.form.premiums.night': 'Nocturnidad (%)',
    'people.employee.form.premiums.weekend': 'Fin de semana (%)',
    'people.employee.form.premiums.overtime': 'Horas extra (×)',
    'people.employee.form.premiums.inheritPct': 'como el negocio ({value} %)',
    'people.employee.form.premiums.inheritMult': 'como el negocio (×{value})',
    'people.employee.form.premiums.includedInSalary':
      'Nocturnidad incluida en el salario (art. 36.2 ET)',
    'people.employee.form.premiums.belowFloor':
      'El convenio fija una nocturnidad del {pct} %. Pagar menos solo es legal si la nocturnidad está incluida en el salario — marca la casilla de arriba si es así. Puedes guardar igualmente.',
    'people.employee.form.paid': 'Cobra',
    'people.employee.form.validFrom': 'En vigor desde',
    'people.employee.form.payPeriodNote':
      'El periodo de nómina es lo que esta persona ve en su propia app: sus horas y su estimación de sueldo se agrupan por él.',

    'people.absences.title': 'Ausencias',
    'people.absences.description':
      'Solicitudes de tiempo libre. Aprobar un tipo que consume saldo genera un movimiento en el histórico.',
    'people.absences.request': 'Solicitar ausencia',
    'people.absences.loadError': 'No se han podido cargar las ausencias',
    'people.absences.empty.title': 'Todavía no hay ausencias',
    'people.absences.col.employee': 'Empleado',
    'people.absences.col.type': 'Tipo',
    'people.absences.col.from': 'Desde',
    'people.absences.col.to': 'Hasta',
    'people.absences.col.status': 'Estado',
    'people.absences.col.action': 'Acción',
    'people.absences.approve': 'Aprobar',

    'people.absences.cleared.one':
      'Le hemos quitado 1 turno a {name}: {hours} que ahora no cubre nadie.',
    'people.absences.cleared.other':
      'Le hemos quitado {count} turnos a {name}: {hours} que ahora no cubre nadie.',
    'people.absences.cleared.published':
      'El equipo ya había visto {count} de ellos.',
    'people.absences.cleared.none': 'Aprobada. No había nada en el cuadrante que quitar.',

    'people.absences.form.title': 'Solicitar ausencia',
    'people.absences.form.submit': 'Enviar',
    'people.absences.form.employee': 'Empleado',
    'people.absences.form.employeePlaceholder': 'Elige un empleado…',
    'people.absences.form.type': 'Tipo de ausencia',
    'people.absences.form.typePlaceholder': 'Elige un tipo…',
    'people.absences.form.start': 'Inicio',
    'people.absences.form.end': 'Fin',
    'people.absences.form.note': 'Nota (opcional)',

    'people.absences.types.title': 'Tipos de ausencia de esta organización',
    'people.absences.types.paid': 'retribuida',
    'people.absences.types.usesBalance': 'consume saldo',
    'people.absences.types.recoverable': 'recuperable',
    'people.absences.types.recoverable.note':
      'Marca el tipo de ausencia cuyas horas se recuperan después: esas horas cuentan como horas ordinarias de recuperación, no como horas extraordinarias.',
    'people.absences.types.healthData': 'datos de salud',
    'people.absences.types.note':
      'Los motivos que son datos de salud no se le muestran nunca al planificador: sólo ve que la persona no está disponible.',

    'people.access.title': 'Acceso del empleado',
    'people.access.canSignIn': 'Puede entrar',
    'people.access.disabled': 'Desactivado',
    'people.access.noLogin': 'Sin acceso',
    'people.access.granted': 'Concedido el {date}.',
    'people.access.revoking': 'Revocando…',
    'people.access.revoke': 'Revocar acceso',
    // Se pregunta antes: el acceso se borra, y devolverlo es dar una contraseña nueva.
    'people.access.revokeConfirm.title': '¿Revocar el acceso de {name}?',
    'people.access.revokeConfirm.body':
      '{name} ya no podrá entrar. Su ficha, sus turnos y su historial se quedan como están. Puedes volver a darle acceso cuando quieras, con una contraseña nueva.',
    'people.access.revokeConfirm.confirm': 'Revocar acceso',
    'people.access.noAccess':
      '{name} todavía no puede entrar, así que no ve los turnos que publicas.',
    'people.access.noAccessPlain': '{name} todavía no puede entrar.',
    'people.access.give': 'Dar acceso',
    'people.access.handover.title': 'Pásale estos datos a {name}',
    'people.access.handover.email': 'Email',
    'people.access.handover.password': 'Contraseña',
    'people.access.handover.onceOnly':
      'Esta es la única vez que se muestra la contraseña: se guarda cifrada.',
    'people.access.handover.done': 'Hecho',
    'people.access.form.title': 'Dar acceso',
    'people.access.form.creating': 'Creando…',
    'people.access.form.submit': 'Crear acceso',
    // Lo que abre un acceso, una línea por app del negocio (lib/access.ts,
    // accessScope): el empleado las tres; la cuenta de tienda -- la tablet
    // del TPV -- las dos últimas.
    'people.access.scope.intro': 'Al entrar tendrá:',
    'people.access.scope.introStore': 'Al entrar, la tablet tendrá:',
    'people.access.scope.shifts':
      'Sus propios turnos, sus horas y su estimación de sueldo, y nada del resto del equipo.',
    'people.access.scope.inventory':
      'El Inventario: existencias, conteos, entradas de mercancía y pedidos al proveedor, sin crear ni editar productos ni proveedores.',
    'people.access.scope.store':
      'La Tienda: cobrar en el TPV, anular una venta y ver la carta, las estadísticas y las recetas, sin tocar la carta.',
    'people.access.form.email': 'Email',
    'people.access.form.emailPlaceholder': 'nombre@empresa.com',
    'people.access.form.password': 'Contraseña',
    'people.access.form.suggest': 'Sugerir',
  },
};
