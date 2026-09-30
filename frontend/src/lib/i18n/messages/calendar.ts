// The calendar itself: the day grid, the folders that fold it up, the payroll
// table for the period, and the panel that shows what the product believes
// about this business.

import type { MessageModule } from './types';

export const calendar: MessageModule = {
  en: {
    // Month names joined into a sentence -- "October and December". Its own
    // string because the conjunction is a fact about the language, the same
    // reason `domain.spec.dayJoin` is one.
    'calendar.monthJoin': ' and ',

    // --- DayGrid: hour ruler and clock ---------------------------------
    // English writes the schedule on a 12-hour clock; Spanish on a 24-hour
    // one. The shape of the label is part of the translation, which is why
    // both the hour number and the raw hour are handed to every key.
    // A day that runs past midnight is drawn in one row, so the same wall
    // clock can appear twice in a calendar and "+1" is what tells the two
    // apart. It is a marker rather than a sentence because it has to fit
    // inside a shift bar; lib/format.ts already writes an overnight span the
    // same way.
    'calendar.dayGrid.hour.am': '{h12}a',
    'calendar.dayGrid.hour.pm': '{h12}p',
    'calendar.dayGrid.hour.midnight': 'Midnight — the hours after this are the next day',
    'calendar.dayGrid.clock.am': '{h12}:{m} AM',
    'calendar.dayGrid.clock.pm': '{h12}:{m} PM',
    'calendar.dayGrid.clock.am.nextDay': '{h12}:{m} AM +1',
    'calendar.dayGrid.clock.pm.nextDay': '{h12}:{m} PM +1',

    // --- DayGrid: day header -------------------------------------------
    'calendar.dayGrid.closed': 'Closed',
    'calendar.dayGrid.scheduled': '{hours} scheduled',
    'calendar.dayGrid.marginalCost': 'marginal cost',
    'calendar.dayGrid.gaps.one': '{count} uncovered hour',
    'calendar.dayGrid.gaps.other': '{count} uncovered hours',
    'calendar.dayGrid.fullyCovered': 'Fully covered',
    'calendar.dayGrid.understaffed': 'Understaffed',

    // --- DayGrid: rows and coverage strip -------------------------------
    'calendar.dayGrid.employee': 'Employee',
    'calendar.dayGrid.week': '{hours}/wk',
    'calendar.dayGrid.week.short': '{hours} this week, under the {contract} of the contract',
    'calendar.dayGrid.week.partial': '{hours} in {days} of 7 days',
    'calendar.dayGrid.week.partial.tooltip':
      'Only {days} of this week’s 7 days are on the calendar, so this is not a full week',
    'calendar.dayGrid.coverage': 'Coverage',
    'calendar.dayGrid.coverage.tooltip': '{time} — {have} of {need} required',
    'calendar.dayGrid.addShift': 'Add a shift at {time}',
    'calendar.dayGrid.notScheduled': 'Not scheduled — {reason}',

    // --- DayGrid: shift bars --------------------------------------------
    'calendar.dayGrid.shift.beyondContract': '{hours} beyond contract',
    'calendar.dayGrid.shift.overtime': '{hours} overtime',
    'calendar.dayGrid.shift.manual': 'added manually',
    'calendar.dayGrid.shift.clickToSelect': 'click to select it',
    'calendar.dayGrid.shift.dragToMove': 'press and drag to move it to other hours or another person',
    'calendar.dayGrid.shift.dragToResize': 'drag an edge to change the hours',
    'calendar.dayGrid.shift.remove': 'Remove this shift',
    'calendar.dayGrid.shift.overlaps': 'Overlaps another shift of {name}',
    'calendar.dayGrid.shift.unavailable': '{name}: {reason}',
    'calendar.dayGrid.shift.extraTag': 'extra',
    'calendar.dayGrid.shift.nightPremium': '{hours} paid at +{pct}% for night work',
    'calendar.dayGrid.shift.overtimeTag': 'OT',

    // --- CalendarFolder --------------------------------------------------
    'calendar.folder.days.one': '{count} day',
    'calendar.folder.days.other': '{count} days',
    'calendar.folder.shifts.one': '{count} shift',
    'calendar.folder.shifts.other': '{count} shifts',

    // --- PayrollView: header ---------------------------------------------
    'calendar.payroll.title': 'Hours & pay',
    'calendar.payroll.hours': 'Hours',
    'calendar.payroll.totalPayroll': 'Total payroll',
    'calendar.payroll.belowMinimum.one':
      '{count} employee is paid below the {rate} minimum wage on record. Fix the contract rate before publishing.',
    'calendar.payroll.belowMinimum.other':
      '{count} employees are paid below the {rate} minimum wage on record. Fix the contract rate before publishing.',

    // --- PayrollView: legend ----------------------------------------------
    'calendar.payroll.legend.regular': 'Regular hours',
    'calendar.payroll.legend.overtime': 'Overtime hours',
    'calendar.payroll.legend.note':
      'Every column shows the exact amount paid, not a multiplier.',

    // --- PayrollView: table -----------------------------------------------
    'calendar.payroll.col.employee': 'Employee',
    'calendar.payroll.col.composition': 'Composition',
    'calendar.payroll.col.hours': 'Hours',
    'calendar.payroll.col.base': 'Base',
    'calendar.payroll.col.overtime': 'Overtime',
    'calendar.payroll.col.night': 'Night',
    'calendar.payroll.col.weekend': 'Weekend',
    'calendar.payroll.col.total': 'Total',
    'calendar.payroll.salaried': 'salaried',
    'calendar.payroll.underContract': 'under contract',
    'calendar.payroll.underContract.title':
      'Contracted for about {hours} this period',
    'calendar.payroll.bar.regular': '{hours} regular',
    'calendar.payroll.bar.overtime': '{hours} overtime',
    'calendar.payroll.base.salary': 'salary',
    'calendar.payroll.underMinimum': 'under {rate} minimum',
    'calendar.payroll.underMinimum.title':
      'Below the {rate} minimum wage on record for this jurisdiction',
    'calendar.payroll.nightBelowFloor.one':
      '{count} employee has a night premium under the {pct}% the agreement sets, and nothing on the contract says night work is included in the salary. If it is, mark it on the contract (art. 36.2 ET).',
    'calendar.payroll.nightBelowFloor.other':
      '{count} employees have a night premium under the {pct}% the agreement sets, and nothing on their contracts says night work is included in the salary. If it is, mark it on the contract (art. 36.2 ET).',
    'calendar.payroll.nightBelowFloor': 'under {pct}% agreement',
    'calendar.payroll.nightBelowFloor.title':
      'The agreement sets a {pct}% night premium. Paying less is only lawful when night work is priced into the salary (art. 36.2 ET).',
    'calendar.payroll.ownPremiums': 'own premiums',
    'calendar.payroll.ownPremiums.title':
      'Paid on their own figures: night {night}%, weekend {weekend}%, overtime ×{overtime}',
    'calendar.payroll.total': 'Total',

    // --- Assumptions, said out loud ----------------------------------------
    // Two halves per row and both are load-bearing: WHAT is in force, and WHY
    // that number. Without the why an assumption reads as a setting the manager
    // forgot making; with it, it reads as a reading of their own brief that
    // they can correct in a sentence.
    'calendar.assumed.people.one': '{staff} person',
    'calendar.assumed.people.other': '{staff} people',
    'calendar.assumed.what.min_staff': 'At least {people} on shift whenever open',
    'calendar.assumed.what.on_weekday': '{people} on {day}',
    'calendar.assumed.what.in_window': '{people} from {from} to {to}',
    'calendar.assumed.why.lowest_stated': 'because that is the smallest number you gave us',
    'calendar.assumed.why.ranked_weekday':
      'because you called those days busier — one more than the {floor} you set',
    'calendar.assumed.why.ranked_window':
      'because you said it gets busier then — one more than the {floor} you set',
    // Inferred, not told to us -- so the sentence says whose idea it was. The
    // clause after the dash is Gemini's own, about this trade in this city,
    // and it is what makes the row arguable: a manager who reads "because a
    // bar in Barcelona fills on Friday night" and knows theirs does not can
    // say so, which is the whole point of showing it.
    'calendar.assumed.why.researched_weekday':
      'because we looked it up — {why}',
    'calendar.assumed.why.researched_window':
      'because we looked it up — {why}',
    'calendar.assumed.what.closed_date': 'Closed on {date}',
    // --- The year grid, and the day it opens ----------------------------
    'calendar.year.today': 'Today',
    'calendar.year.previous': 'Go to {year}',
    'calendar.year.next': 'Go to {year}',
    'calendar.year.legend.published': 'Published',
    'calendar.year.legend.draft': 'Draft',
    // Read out with the date, so the colour is never the only way to know.
    'calendar.year.day.today': 'today',
    'calendar.year.day.published': 'published to the team',
    'calendar.year.day.draft': 'drafted, not published',
    'calendar.year.day.empty': 'nothing planned',
    'calendar.year.empty': 'No calendar yet for this year.',
    'calendar.day.previous': 'Previous day',
    'calendar.day.next': 'Next day',
    'calendar.day.back': 'Back to the year',
    'calendar.day.loading': 'Loading…',
    'calendar.assumed.why.researched_holiday':
      'because we looked it up and businesses like yours usually shut — {why}',
    // A gap nothing could be derived from. The figure is read back out of the
    // spec rather than retyped here, so this can never quote a number the
    // calendar is not actually using.
    'calendar.assumed.generic.opening_hours': 'Open from {from} to {to}',
    'calendar.assumed.generic.min_staff': 'At least {people} on shift whenever open',
    'calendar.assumed.generic.max_weekly_hours': 'Up to {hours} a week per person',
    'calendar.assumed.generic.min_rest': '{hours} of rest between shifts',
    'calendar.assumed.generic.coverage': 'The same number of people all day, every day',
    'calendar.assumed.generic.closures': 'Open every day',
    'calendar.assumed.generic.shift_length': 'Shift length left to the scheduler',
    'calendar.assumed.generic.horizon':
      'The next four weeks, starting today. Say a period in the brief to plan another one',

    // --- StandingRules: one list, every kind of authority -------------------
    // The pill is what tells one row from another, so the rows that govern
    // nothing yet -- a belief still counting days, a stereotype, something the
    // manager put aside -- can sit in the same list without being mistaken for
    // rules. Saying so is the point: a belief must never appear fully formed.
    'calendar.standing.title': 'What this calendar is following',
    'calendar.standing.help':
      'Everything the rota obeys, and where each line came from. Below them, what does not govern anything yet. Say it differently in the brief and it changes.',
    'calendar.standing.pill.heard': 'Heard',
    'calendar.standing.pill.stated': 'You said it',
    'calendar.standing.pill.learned': 'Learned',
    'calendar.standing.pill.assumed': 'We assumed it',
    'calendar.standing.pill.default': 'Nobody said',
    'calendar.standing.pill.watching': 'Watching',
    'calendar.standing.pill.typical': 'Typical',
    'calendar.standing.pill.forgotten': 'Forgotten',
    'calendar.standing.nothing': 'Nothing to lean on — this is a plain default.',
    'calendar.standing.empty': 'Write a brief and this fills in.',
    // What corrections taught us, and whether this calendar needed it.
    'calendar.standing.learned.used':
      'Your brief said nothing about this, so a correction you kept making filled it in.',
    'calendar.standing.learned.idle':
      'Learned from your corrections. This calendar did not need it.',
    'calendar.standing.evidence.one': 'seen on {count} day',
    'calendar.standing.evidence.other': 'seen on {count} days',
    'calendar.standing.forget.hint': 'Forget this',
    // The rows below the line, each saying why it changes nothing.
    'calendar.standing.watching.why':
      '{evidence} of {needed} days — changes nothing yet',
    'calendar.standing.typical.why':
      'Common for a business like yours. Not applied: say it in the brief and it becomes a rule.',
    'calendar.standing.forgotten.why': 'You put this aside. It changes nothing.',
    'calendar.standing.notYet': 'Not in force yet',
    'calendar.standing.reuse': 'Use it again',
    // Correcting one. The manager types the number they meant; the calendar is
    // rebuilt from it rather than patched, so the correction goes through the
    // same generator as everything else.
    'calendar.standing.change.label': 'Make it',
    'calendar.standing.change.apply': 'Apply',
    'calendar.standing.change.people': 'people',
    'calendar.standing.corrected': '{what} — you set this',
    // --- Declarations: what the manager told us, and can take back ---------
    'calendar.declared.dayHours': '{day}, {from} to {to}',
    'calendar.declared.closed': 'Closed on {day}',
    'calendar.declared.windowOnDay': '{people} on {day}, {from} to {to}',
    'calendar.declared.unknown': 'A rule you set',
    // --- What a correction taught us -------------------------------------
    // The same claims as above, from a different authority, and one of them
    // is worded differently on purpose: a learned busy window says how many
    // MORE than the floor, where a declared one says how many.
    'calendar.learned.openOn': 'Open on {day}',
    'calendar.learned.extraWindow.one': 'One more person from {from} to {to}',
    'calendar.learned.extraWindow.other': '{count} more people from {from} to {to}',
    'calendar.learned.extraOnDay.one': 'One more person on {day}, from {from} to {to}',
    'calendar.learned.extraOnDay.other':
      '{count} more people on {day}, from {from} to {to}',
    'calendar.standing.forget': 'Take it back',
    'calendar.standing.heard.why':
      'You said this while adjusting the calendar. It changes nothing until you confirm it.',
    'calendar.standing.heard.inForce': 'You told us this, and confirmed it.',
    'calendar.standing.heard.confirm': 'Always',
    'calendar.standing.heard.dismiss': 'Just that time',
    // --- Noticed in how the manager retouches our calendars -------------
    // A question like the ones above, but about something they DID rather
    // than said -- so the row says so, and the "no" is not "just that time".
    'calendar.standing.pill.noticed': 'We noticed',
    'calendar.standing.edits.why':
      'You changed this by hand before publishing, on {count} different days. It changes nothing until you confirm it.',
    'calendar.standing.edits.inForce': 'Noticed in your changes, and confirmed by you.',
    'calendar.standing.edits.dismiss': 'Not a rule',
    'calendar.standing.notes.why':
      'The planner noted this after a publication. It changes nothing until you confirm it.',
    'calendar.edits.trim': 'Every {day} {band}, the minimum cover is enough: no extra shifts',
    'calendar.edits.start': 'Every {day}, the shift starting at {from} starts at {to} instead',
    'calendar.edits.noNights': '{name} does not work night shifts',
    'calendar.edits.band.early': 'early morning',
    'calendar.edits.band.morning': 'morning',
    'calendar.edits.band.afternoon': 'afternoon',
    'calendar.edits.band.evening': 'evening',
    'calendar.edits.band.night': 'night',
  },
  es: {
    'calendar.monthJoin': ' y ',

    // --- DayGrid: regla de horas y reloj --------------------------------
    'calendar.dayGrid.hour.am': '{h}',
    'calendar.dayGrid.hour.pm': '{h}',
    'calendar.dayGrid.hour.midnight': 'Medianoche — a partir de aquí es el día siguiente',
    'calendar.dayGrid.clock.am': '{h24}:{m}',
    'calendar.dayGrid.clock.pm': '{h24}:{m}',
    'calendar.dayGrid.clock.am.nextDay': '{h24}:{m} +1',
    'calendar.dayGrid.clock.pm.nextDay': '{h24}:{m} +1',

    // --- DayGrid: cabecera del día --------------------------------------
    'calendar.dayGrid.closed': 'Cerrado',
    'calendar.dayGrid.scheduled': '{hours} programadas',
    'calendar.dayGrid.marginalCost': 'de coste marginal',
    'calendar.dayGrid.gaps.one': '{count} hora sin cubrir',
    'calendar.dayGrid.gaps.other': '{count} horas sin cubrir',
    'calendar.dayGrid.fullyCovered': 'Cobertura completa',
    'calendar.dayGrid.understaffed': 'Falta personal',

    // --- DayGrid: filas y tira de cobertura ------------------------------
    'calendar.dayGrid.employee': 'Empleado',
    'calendar.dayGrid.week': '{hours}/sem',
    'calendar.dayGrid.week.short': '{hours} esta semana, por debajo de las {contract} de su contrato',
    'calendar.dayGrid.week.partial': '{hours} en {days} de 7 días',
    'calendar.dayGrid.week.partial.tooltip':
      'El calendario solo tiene {days} de los 7 días de esta semana, así que no es una semana completa',
    'calendar.dayGrid.coverage': 'Cobertura',
    'calendar.dayGrid.coverage.tooltip': '{time} — {have} de {need} necesarios',
    'calendar.dayGrid.addShift': 'Añadir un turno a las {time}',
    'calendar.dayGrid.notScheduled': 'Sin turno — {reason}',

    // --- DayGrid: barras de turno ----------------------------------------
    'calendar.dayGrid.shift.beyondContract': '{hours} por encima del contrato',
    'calendar.dayGrid.shift.overtime': '{hours} de horas extra',
    'calendar.dayGrid.shift.manual': 'añadido a mano',
    'calendar.dayGrid.shift.clickToSelect': 'haz clic para seleccionarlo',
    'calendar.dayGrid.shift.dragToMove': 'mantén pulsado y arrastra para moverlo de hora o de persona',
    'calendar.dayGrid.shift.dragToResize': 'arrastra un borde para cambiar las horas',
    'calendar.dayGrid.shift.remove': 'Quitar este turno',
    'calendar.dayGrid.shift.overlaps': 'Se solapa con otro turno de {name}',
    'calendar.dayGrid.shift.unavailable': '{name}: {reason}',
    'calendar.dayGrid.shift.extraTag': 'extra',
    'calendar.dayGrid.shift.nightPremium': '{hours} con plus de nocturnidad (+{pct}%)',
    'calendar.dayGrid.shift.overtimeTag': 'HE',

    // --- CalendarFolder ---------------------------------------------------
    'calendar.folder.days.one': '{count} día',
    'calendar.folder.days.other': '{count} días',
    'calendar.folder.shifts.one': '{count} turno',
    'calendar.folder.shifts.other': '{count} turnos',

    // --- PayrollView: cabecera --------------------------------------------
    'calendar.payroll.title': 'Horas y nómina',
    'calendar.payroll.hours': 'Horas',
    'calendar.payroll.totalPayroll': 'Nómina total',
    'calendar.payroll.belowMinimum.one':
      '{count} empleado cobra por debajo del salario mínimo de {rate} que consta. Corrige la tarifa del contrato antes de publicar.',
    'calendar.payroll.belowMinimum.other':
      '{count} empleados cobran por debajo del salario mínimo de {rate} que consta. Corrige la tarifa del contrato antes de publicar.',

    // --- PayrollView: leyenda ----------------------------------------------
    'calendar.payroll.legend.regular': 'Horas normales',
    'calendar.payroll.legend.overtime': 'Horas extra',
    'calendar.payroll.legend.note':
      'Cada columna muestra el importe exacto que se paga, no un multiplicador.',

    // --- PayrollView: tabla -------------------------------------------------
    'calendar.payroll.col.employee': 'Empleado',
    'calendar.payroll.col.composition': 'Composición',
    'calendar.payroll.col.hours': 'Horas',
    'calendar.payroll.col.base': 'Base',
    'calendar.payroll.col.overtime': 'Horas extra',
    'calendar.payroll.col.night': 'Nocturnidad',
    'calendar.payroll.col.weekend': 'Fin de semana',
    'calendar.payroll.col.total': 'Total',
    'calendar.payroll.salaried': 'salario fijo',
    'calendar.payroll.underContract': 'por debajo del contrato',
    'calendar.payroll.underContract.title':
      'Su contrato son unas {hours} en este periodo',
    'calendar.payroll.bar.regular': '{hours} normales',
    'calendar.payroll.bar.overtime': '{hours} de horas extra',
    'calendar.payroll.base.salary': 'salario',
    'calendar.payroll.underMinimum': 'por debajo del mínimo de {rate}',
    'calendar.payroll.underMinimum.title':
      'Por debajo del salario mínimo de {rate} que consta para esta jurisdicción',
    'calendar.payroll.nightBelowFloor.one':
      '{count} empleado tiene una nocturnidad por debajo del {pct} % que fija el convenio, y su contrato no dice que la nocturnidad esté incluida en el salario. Si lo está, márcalo en el contrato (art. 36.2 ET).',
    'calendar.payroll.nightBelowFloor.other':
      '{count} empleados tienen una nocturnidad por debajo del {pct} % que fija el convenio, y sus contratos no dicen que la nocturnidad esté incluida en el salario. Si lo está, márcalo en el contrato (art. 36.2 ET).',
    'calendar.payroll.nightBelowFloor': 'por debajo del {pct} % del convenio',
    'calendar.payroll.nightBelowFloor.title':
      'El convenio fija una nocturnidad del {pct} %. Pagar menos solo es legal si la nocturnidad está incluida en el salario (art. 36.2 ET).',
    'calendar.payroll.ownPremiums': 'pluses propios',
    'calendar.payroll.ownPremiums.title':
      'Cobra con sus propios pluses: nocturnidad {night} %, fin de semana {weekend} %, extras ×{overtime}',
    'calendar.payroll.total': 'Total',

    // --- Suposiciones, dichas en voz alta -----------------------------------
    // Dos mitades por línea y las dos sostienen: QUÉ rige, y POR QUÉ esa cifra.
    // Sin el porqué, una suposición se lee como un ajuste que el responsable
    // olvidó poner; con él, se lee como una lectura de su propio brief que
    // puede corregir hablando.
    'calendar.assumed.people.one': '{staff} persona',
    'calendar.assumed.people.other': '{staff} personas',
    'calendar.assumed.what.min_staff': 'Al menos {people} mientras esté abierto',
    'calendar.assumed.what.on_weekday': '{people} los {day}',
    'calendar.assumed.what.in_window': '{people} de {from} a {to}',
    'calendar.assumed.why.lowest_stated': 'porque es la cifra más baja que nos diste',
    'calendar.assumed.why.ranked_weekday':
      'porque dijiste que son días más fuertes: uno más que el mínimo de {floor}',
    'calendar.assumed.why.ranked_window':
      'porque dijiste que ahí hay más trabajo: uno más que el mínimo de {floor}',
    // Deducido, no dicho por el manager: la frase dice de quién es la idea.
    'calendar.assumed.why.researched_weekday':
      'porque lo hemos mirado: {why}',
    'calendar.assumed.why.researched_window':
      'porque lo hemos mirado: {why}',
    'calendar.assumed.what.closed_date': 'Cerrado el {date}',
    // --- La rejilla del año, y el día que abre ---------------------------
    'calendar.year.today': 'Hoy',
    'calendar.year.previous': 'Ir a {year}',
    'calendar.year.next': 'Ir a {year}',
    'calendar.year.legend.published': 'Publicado',
    'calendar.year.legend.draft': 'Borrador',
    'calendar.year.day.today': 'hoy',
    'calendar.year.day.published': 'publicado al equipo',
    'calendar.year.day.draft': 'en borrador, sin publicar',
    'calendar.year.day.empty': 'sin planificar',
    'calendar.year.empty': 'Todavía no hay calendario para este año.',
    'calendar.day.previous': 'Día anterior',
    'calendar.day.next': 'Día siguiente',
    'calendar.day.back': 'Volver al año',
    'calendar.day.loading': 'Cargando…',
    'calendar.assumed.why.researched_holiday':
      'porque lo hemos mirado y los negocios como el tuyo suelen cerrar: {why}',
    // Un hueco del que no se podía derivar nada. La cifra se lee de la spec en
    // vez de reescribirse aquí, así que esto nunca puede citar un número que el
    // calendario no esté usando.
    'calendar.assumed.generic.opening_hours': 'Abierto de {from} a {to}',
    'calendar.assumed.generic.min_staff': 'Al menos {people} mientras esté abierto',
    'calendar.assumed.generic.max_weekly_hours': 'Hasta {hours} por semana y persona',
    'calendar.assumed.generic.min_rest': '{hours} de descanso entre turnos',
    'calendar.assumed.generic.coverage': 'El mismo número de personas todo el día, todos los días',
    'calendar.assumed.generic.closures': 'Abierto todos los días',
    'calendar.assumed.generic.shift_length': 'La duración del turno la elige el planificador',
    'calendar.assumed.generic.horizon':
      'Las próximas cuatro semanas a partir de hoy. Di un periodo en el brief para planificar otro',

    // --- StandingRules: una lista, todas las clases de autoridad ------------
    // La etiqueta es lo que distingue una línea de otra, así que las que
    // todavía no rigen -- una creencia contando días, un tópico del sector,
    // algo que el responsable apartó -- pueden ir en la misma lista sin que se
    // confundan con reglas. Decirlo es el objetivo: una creencia nunca debe
    // aparecer dada por hecha.
    'calendar.standing.title': 'Lo que este calendario está siguiendo',
    'calendar.standing.help':
      'Todo lo que el cuadrante obedece, y de dónde sale cada línea. Debajo, lo que todavía no rige. Dilo de otra forma en el brief y cambia.',
    'calendar.standing.pill.heard': 'Te lo oímos',
    'calendar.standing.pill.stated': 'Lo dijiste tú',
    'calendar.standing.pill.learned': 'Aprendido',
    'calendar.standing.pill.assumed': 'Lo supusimos',
    'calendar.standing.pill.default': 'Nadie lo dijo',
    'calendar.standing.pill.watching': 'En observación',
    'calendar.standing.pill.typical': 'Habitual',
    'calendar.standing.pill.forgotten': 'Olvidado',
    'calendar.standing.nothing': 'No había nada en qué apoyarse: es un valor por defecto.',
    'calendar.standing.empty': 'Escribe un brief y esto se rellena.',
    // Lo que nos enseñaron tus correcciones, y si aquí hacía falta.
    'calendar.standing.learned.used':
      'Tu brief no decía nada de esto, así que lo rellenó una corrección que repetías.',
    'calendar.standing.learned.idle':
      'Aprendido de tus correcciones. En este calendario no hacía falta.',
    'calendar.standing.evidence.one': 'visto en {count} día',
    'calendar.standing.evidence.other': 'visto en {count} días',
    'calendar.standing.forget.hint': 'Olvidar esto',
    // Las líneas de abajo, cada una diciendo por qué no cambia nada.
    'calendar.standing.watching.why':
      '{evidence} de {needed} días — todavía no cambia nada',
    'calendar.standing.typical.why':
      'Habitual en un negocio como el tuyo. No se aplica: dilo en el brief y pasará a regir.',
    'calendar.standing.forgotten.why': 'Lo apartaste. No cambia nada.',
    'calendar.standing.notYet': 'Todavía no rige',
    'calendar.standing.reuse': 'Volver a usarlo',
    // Corregir una. El responsable escribe la cifra que quería decir y el
    // calendario se reconstruye con ella en vez de parchearse, así que la
    // corrección pasa por el mismo generador que todo lo demás.
    'calendar.standing.change.label': 'Que sean',
    'calendar.standing.change.apply': 'Aplicar',
    'calendar.standing.change.people': 'personas',
    'calendar.standing.corrected': '{what} — lo fijaste tú',
    // --- Declaraciones: lo que el responsable nos dijo, y puede retirar -----
    'calendar.declared.dayHours': '{day}, de {from} a {to}',
    'calendar.declared.closed': 'Cerrado los {day}',
    'calendar.declared.windowOnDay': '{people} los {day}, de {from} a {to}',
    'calendar.declared.unknown': 'Una regla que fijaste tú',
    // --- Lo que nos enseñó una corrección --------------------------------
    'calendar.learned.openOn': 'Abierto los {day}',
    'calendar.learned.extraWindow.one': 'Una persona más de {from} a {to}',
    'calendar.learned.extraWindow.other': '{count} personas más de {from} a {to}',
    'calendar.learned.extraOnDay.one': 'Una persona más los {day}, de {from} a {to}',
    'calendar.learned.extraOnDay.other':
      '{count} personas más los {day}, de {from} a {to}',
    'calendar.standing.forget': 'Retirarlo',
    'calendar.standing.heard.why':
      'Lo dijiste mientras ajustabas el cuadrante. No cambia nada hasta que lo confirmes.',
    'calendar.standing.heard.inForce': 'Nos lo dijiste y lo confirmaste.',
    'calendar.standing.heard.confirm': 'Siempre',
    'calendar.standing.heard.dismiss': 'Solo esa vez',
    // --- Visto en cómo el responsable retoca nuestros calendarios --------
    'calendar.standing.pill.noticed': 'Lo vimos',
    'calendar.standing.edits.why':
      'Lo cambiaste a mano antes de publicar, en {count} días distintos. No cambia nada hasta que lo confirmes.',
    'calendar.standing.edits.inForce': 'Lo vimos en tus cambios y lo confirmaste.',
    'calendar.standing.edits.dismiss': 'No es una regla',
    'calendar.standing.notes.why':
      'El planificador lo apuntó después de una publicación. No cambia nada hasta que lo confirmes.',
    'calendar.edits.trim': 'Cada {day} {band} basta con la cobertura mínima: sin turnos de más',
    'calendar.edits.start': 'Cada {day}, el turno que empieza a las {from} entra a las {to}',
    'calendar.edits.noNights': '{name} no hace turnos de noche',
    'calendar.edits.band.early': 'a primera hora',
    'calendar.edits.band.morning': 'por la mañana',
    'calendar.edits.band.afternoon': 'por la tarde',
    'calendar.edits.band.evening': 'al final de la tarde',
    'calendar.edits.band.night': 'por la noche',
  },
};
