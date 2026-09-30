import type { MessageModule } from './types';

// The scheduling engine's own voice.
//
// These strings are not written by a component: they are built by the pure
// functions in lib/schedule/* -- the rule chips read out of the manager's
// brief, the trail of what a refinement actually did, and the reasons an
// operation was refused. They still end up on screen, so they still live here.
//
// Every one of them is a sentence with data inside it, so every one is a
// SINGLE key with placeholders. Splitting "Added Ana on Tuesday" into pieces
// and gluing them together would produce Spanish in English word order.
//
// Weekday and month names never appear here: they come from the locale (see
// `weekdayName` in lib/schedule/spec.ts), which already follows the language.

export const domain: MessageModule = {
  en: {
    // Time bands: what a shift is called when no template names it, and the
    // calendar legend.
    'domain.band.early': 'Early',
    'domain.band.morning': 'Morning',
    'domain.band.afternoon': 'Afternoon',
    'domain.band.evening': 'Evening',
    'domain.band.night': 'Night',

    // Rules understood from the brief, shown back as chips the manager checks.
    'domain.rule.open24': 'Open 24 hours',
    'domain.rule.openHours': 'Open {from}-{to}',
    'domain.rule.minStaff': 'At least {count} on shift every open hour',
    'domain.rule.peakCover': '{count} on shift during {from}-{to}',
    'domain.rule.closedDay': 'Closed on {day}',
    'domain.rule.maxWeeklyHours': 'Max {count} h/week per employee',
    'domain.rule.minRest': '{count} h minimum rest between shifts',
    'domain.rule.minRestDefault': '{count} h rest between shifts (company policy)',
    'domain.rule.overtime': 'Hours above the contracted week (art. 35.1 ET)',

    // The whole spec in one line.
    'domain.spec.summary24': '24 hours, min {count} on shift',
    'domain.spec.summary24Closed': '24 hours, min {count} on shift, closed {days}',
    'domain.spec.summaryHours': '{from}-{to}, min {count} on shift',
    'domain.spec.summaryHoursClosed': '{from}-{to}, min {count} on shift, closed {days}',
    'domain.spec.dayJoin': ' & ',

    // Which operation a refusal is about, used as the prefix of one.
    'domain.refine.op.remove': 'Remove',
    'domain.refine.op.addShift': 'Add shift',
    'domain.refine.op.moveShift': 'Move shift',
    'domain.refine.op.swap': 'Swap',

    // When an operation applies. Each carries its own preposition so the
    // sentence around it reads naturally in both languages.
    'domain.refine.when.everyWeekday': 'every {day}',
    'domain.refine.when.onDate': 'on {date}',
    'domain.refine.when.range': 'from {from} to {to}',
    'domain.refine.when.weekdayInRange': 'every {day} from {from} to {to}',
    'domain.refine.everyone': 'everyone',

    // Refinements that could not be honoured.
    'domain.refine.noEmployee': '{op}: no employee matches "{ref}"',
    'domain.refine.remove.noDay': 'Remove: no day matched — say a date or a weekday.',
    'domain.refine.addShift.badTime': 'Add shift: "{from}-{to}" is not a valid time.',
    'domain.refine.addShift.tooLong': 'Add shift: {from}–{to} is longer than 16 hours.',
    'domain.refine.moveShift.badTime': 'Move shift: "{time}" is not a valid time.',
    'domain.refine.moveShift.noShift': '{name} has no shift on {date} to move.',
    'domain.refine.moveShift.tooLong': 'Move shift: {from}–{to} is longer than 16 hours.',
    'domain.refine.outsidePeriod':
      '{date} is outside {period}, the period on screen. Move to that month to change it.',
    'domain.refine.cannotWork': '{name} cannot work {date} — {reason}.',
    'domain.refine.alreadyOnShift': '{name} already has a shift on {date}.',
    'domain.refine.onboarding.maxHours':
      '{name} is onboarding — max {max} h a day, that shift is {hours} h.',
    'domain.refine.onboarding.noNights': '{name} is onboarding — no night shifts yet.',
    'domain.refine.swap.neither': 'Neither has a shift on {date}.',
    'domain.refine.cover.badTime': 'Extra cover: "{from}-{to}" is not a valid time.',
    'domain.refine.cover.noDay': 'Extra cover: no day matched — say a date or a weekday.',
    'domain.refine.cover.partial':
      '{date}: only {placed} of {want} extra could be added — nobody else is free.',
    'domain.refine.minStaff.range': 'Minimum staff of {count} is out of range.',
    'domain.refine.peak.badRange': 'Peak cover: invalid time range.',
    'domain.refine.hours.badRange': 'Opening hours: invalid range.',
    'domain.refine.maxHours.range': 'Max {count} h/week is out of range.',

    // Refinements that landed, reported back one line each.
    'domain.refine.cleared.one': 'Cleared 1 shift for {who} {when}.',
    'domain.refine.cleared.other': 'Cleared {count} shifts for {who} {when}.',
    'domain.refine.cleared.none': '{who} had no shifts {when}.',
    // An AI answer that met a hand edit made while it was working
    // (lib/schedule/handEdits). The hand edit stood; say where.
    'domain.handEdits.kept.one':
      'You edited {cells} by hand while the AI was working; your edit was kept there and the adjustment left that day alone.',
    'domain.handEdits.kept.other':
      'You edited {count} days by hand while the AI was working — {cells}; your edits were kept and the adjustment left those days alone.',
    'domain.handEdits.refused.one':
      'Your hand edit on {cells} could not be kept: after this adjustment that person is away that day or no longer on the team.',
    'domain.handEdits.refused.other':
      'Your hand edits on {count} days could not be kept — {cells}: after this adjustment those people are away those days or no longer on the team.',
    'domain.refine.covered.one': 'The gap was covered with 1 shift.',
    'domain.refine.covered.other': 'The gap was covered with {count} shifts.',
    'domain.refine.added': '{name} added on {date}, {from}–{to}.',
    'domain.refine.moved': '{name} moved to {from}–{to} on {date}.',
    'domain.refine.swapped': 'Swapped {a} and {b} on {date}.',
    'domain.refine.cover.added.one': 'Added 1 extra shift covering {from}–{to}.',
    'domain.refine.cover.added.other': 'Added {count} extra shifts covering {from}–{to}.',
    'domain.refine.minStaff.set': 'Minimum staffing set to {count} per open hour.',
    'domain.refine.peak.set': '{count} on shift during {from}–{to}.',
    'domain.refine.hours.set': 'Opening hours set to {from}–{to}.',
    'domain.refine.closedDay.closed': '{day} is now closed.',
    'domain.refine.closedDay.open': '{day} is now open.',
    'domain.refine.maxHours.set': 'Nobody may exceed {count} h per week.',
  },
  es: {
    'domain.band.early': 'Temprano',
    'domain.band.morning': 'Mañana',
    'domain.band.afternoon': 'Tarde',
    'domain.band.evening': 'Tarde-noche',
    'domain.band.night': 'Noche',

    'domain.rule.open24': 'Abierto 24 horas',
    'domain.rule.openHours': 'Abierto de {from} a {to}',
    'domain.rule.minStaff': 'Al menos {count} en turno cada hora de apertura',
    'domain.rule.peakCover': '{count} en turno de {from} a {to}',
    'domain.rule.closedDay': 'Cerrado el {day}',
    'domain.rule.maxWeeklyHours': 'Máximo {count} h/semana por empleado',
    'domain.rule.minRest': '{count} h de descanso mínimo entre turnos',
    'domain.rule.minRestDefault': '{count} h de descanso entre turnos (política de empresa)',
    'domain.rule.overtime': 'Horas por encima de la jornada contratada (art. 35.1 ET)',

    'domain.spec.summary24': '24 horas, mín. {count} en turno',
    'domain.spec.summary24Closed': '24 horas, mín. {count} en turno, cerrado {days}',
    'domain.spec.summaryHours': 'De {from} a {to}, mín. {count} en turno',
    'domain.spec.summaryHoursClosed':
      'De {from} a {to}, mín. {count} en turno, cerrado {days}',
    'domain.spec.dayJoin': ' y ',

    'domain.refine.op.remove': 'Quitar',
    'domain.refine.op.addShift': 'Añadir turno',
    'domain.refine.op.moveShift': 'Mover turno',
    'domain.refine.op.swap': 'Intercambiar',

    'domain.refine.when.everyWeekday': 'cada {day}',
    'domain.refine.when.onDate': 'el {date}',
    'domain.refine.when.range': 'del {from} al {to}',
    'domain.refine.when.weekdayInRange': 'cada {day} del {from} al {to}',
    'domain.refine.everyone': 'toda la plantilla',

    'domain.refine.noEmployee': '{op}: no hay ningún empleado que coincida con «{ref}»',
    'domain.refine.remove.noDay':
      'Quitar: ningún día coincide; indica una fecha o un día de la semana.',
    'domain.refine.addShift.badTime': 'Añadir turno: «{from}-{to}» no es una hora válida.',
    'domain.refine.addShift.tooLong': 'Añadir turno: de {from} a {to} son más de 16 horas.',
    'domain.refine.moveShift.badTime': 'Mover turno: «{time}» no es una hora válida.',
    'domain.refine.moveShift.noShift': '{name} no tiene ningún turno el {date} que mover.',
    'domain.refine.moveShift.tooLong': 'Mover turno: de {from} a {to} son más de 16 horas.',
    'domain.refine.outsidePeriod':
      'El {date} está fuera de {period}, el periodo en pantalla; cambia a ese mes para tocarlo.',
    'domain.refine.cannotWork': '{name} no puede trabajar el {date}: {reason}.',
    'domain.refine.alreadyOnShift': '{name} ya tiene un turno el {date}.',
    'domain.refine.onboarding.maxHours':
      '{name} se está incorporando: máximo {max} h al día, y ese turno es de {hours} h.',
    'domain.refine.onboarding.noNights':
      '{name} se está incorporando: todavía no puede hacer turnos de noche.',
    'domain.refine.swap.neither': 'Ninguno de los dos tiene turno el {date}.',
    'domain.refine.cover.badTime': 'Refuerzo: «{from}-{to}» no es una hora válida.',
    'domain.refine.cover.noDay':
      'Refuerzo: ningún día coincide; indica una fecha o un día de la semana.',
    'domain.refine.cover.partial':
      '{date}: sólo se han podido añadir {placed} de {want} refuerzos; no hay nadie más libre.',
    'domain.refine.minStaff.range': 'Un mínimo de {count} personas está fuera de rango.',
    'domain.refine.peak.badRange': 'Refuerzo de hora punta: rango horario no válido.',
    'domain.refine.hours.badRange': 'Horario de apertura: rango no válido.',
    'domain.refine.maxHours.range': 'Un máximo de {count} h/semana está fuera de rango.',

    'domain.refine.cleared.one': 'Se ha eliminado 1 turno de {who} {when}.',
    'domain.refine.cleared.other': 'Se han eliminado {count} turnos de {who} {when}.',
    'domain.refine.cleared.none': '{who} no tenía turnos {when}.',
    'domain.handEdits.kept.one':
      'Editaste a mano {cells} mientras la IA trabajaba; se ha respetado tu cambio y el ajuste no ha tocado ese día.',
    'domain.handEdits.kept.other':
      'Editaste a mano {count} días mientras la IA trabajaba ({cells}); se han respetado tus cambios y el ajuste no ha tocado esos días.',
    'domain.handEdits.refused.one':
      'No se ha podido conservar lo que editaste a mano en {cells}: tras este ajuste esa persona está ausente ese día o ya no está en el equipo.',
    'domain.handEdits.refused.other':
      'No se han podido conservar tus ediciones a mano en {count} días ({cells}): tras este ajuste esas personas están ausentes esos días o ya no están en el equipo.',
    'domain.refine.covered.one': 'El hueco se cubrió con 1 turno.',
    'domain.refine.covered.other': 'El hueco se cubrió con {count} turnos.',
    'domain.refine.added': 'Se ha añadido a {name} el {date}, de {from} a {to}.',
    'domain.refine.moved': 'Se ha movido a {name} al horario de {from} a {to} el {date}.',
    'domain.refine.swapped': 'Se han intercambiado {a} y {b} el {date}.',
    'domain.refine.cover.added.one': 'Se ha añadido 1 turno de refuerzo de {from} a {to}.',
    'domain.refine.cover.added.other':
      'Se han añadido {count} turnos de refuerzo de {from} a {to}.',
    'domain.refine.minStaff.set': 'Personal mínimo fijado en {count} por hora de apertura.',
    'domain.refine.peak.set': '{count} en turno de {from} a {to}.',
    'domain.refine.hours.set': 'Horario de apertura fijado de {from} a {to}.',
    'domain.refine.closedDay.closed': 'El {day} ahora está cerrado.',
    'domain.refine.closedDay.open': 'El {day} ahora está abierto.',
    'domain.refine.maxHours.set': 'Nadie puede superar las {count} h por semana.',
  },
};
