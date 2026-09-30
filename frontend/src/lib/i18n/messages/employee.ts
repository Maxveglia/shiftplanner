import type { MessageModule } from './types';

// The employee app: one screen, read on a phone, by someone who is not a
// manager. Every string here is written for that reader -- their shifts, their
// hours, what they will be paid, and the days they have asked off.

export const employee: MessageModule = {
  en: {
    // My schedule -- the screen itself
    'employee.loading': 'Loading your schedule…',
    'employee.error.title': 'We could not load your record',
    'employee.error.unlinked':
      'This login is not linked to an employee yet. Ask your manager to set it up.',
    'employee.greeting': 'Hi, {name}',
    'employee.period.prev': 'Previous period',
    'employee.period.next': 'Next period',
    // The team of a day this person works, opened from one of their own
    // shifts. Names and hours only -- see backend TeammateShiftOut for the
    // list of what is deliberately not sent.
    'employee.team.scheduled': '{hours} scheduled',
    'employee.team.close': 'Close',
    'employee.team.you': 'You',
    'employee.team.empty': 'Nobody else is on that day.',
    'employee.team.error': 'That day could not be loaded',
    'employee.shiftList.openDay': 'See who is on: {range}',
    'employee.shifts.loadError': 'Could not load your shifts',

    'employee.stat.shifts': 'Shifts',
    'employee.stat.week': 'This week',
    'employee.stat.period': 'This period',
    'employee.stat.hours': 'Hours',
    'employee.stat.regular': 'Regular',
    'employee.stat.overtime': 'Overtime',
    'employee.stat.estimated': 'Estimated',

    'employee.noContract.title': 'No contract on file yet',
    'employee.noContract.body':
      'Your pay cannot be estimated until your manager records your contract terms.',
    'employee.terms.title': 'Your terms',
    'employee.terms.paid': 'Paid',
    'employee.terms.rate': 'Hourly rate',
    'employee.terms.minimum': 'Contracted minimum',
    'employee.terms.minimumValue': '{hours} / week',
    'employee.terms.below':
      'You are scheduled {hours} below your contracted hours for this period. Worth raising with your manager.',

    // Next shift card
    'employee.next.label': 'Next shift',
    'employee.next.onShift': 'On shift now',
    'employee.next.today': 'Today',
    'employee.next.tomorrow': 'Tomorrow',
    'employee.next.empty.title': 'Nothing scheduled',
    'employee.next.empty.body':
      'You have no upcoming shifts in the next two weeks.',
    'employee.next.endsAt': 'ends at {time}',
    'employee.next.startsInMinutes': 'starts in {minutes} min',
    'employee.next.startsInHours': 'starts in {hours} h',
    'employee.next.inDays.one': 'in {count} day',
    'employee.next.inDays.other': 'in {count} days',
    'employee.next.meta': '{template} · {hours} paid',

    // Shift list
    'employee.shiftList.today': 'Today · {label}',
    'employee.shiftList.empty.title': 'No shifts in this period',
    'employee.shiftList.empty.body':
      'Either you are not scheduled, or your manager has not published this period yet.',
    // "New to you", not "newly created" -- a shift whose hours moved is new to
    // the person working it. Short, because it sits beside the time.
    'employee.shiftList.tag.new': 'New',
    'employee.shiftList.tag.night': 'night',
    'employee.shiftList.tag.weekend': 'weekend',
    'employee.shiftList.overtime': '{hours} overtime',

    // Pay breakdown
    'employee.pay.title': 'Estimated pay',
    'employee.pay.salary': 'Salary',
    'employee.pay.salary.detail':
      '{hours} scheduled · your salary does not change with hours',
    'employee.pay.base': 'Base',
    'employee.pay.overtime': 'Overtime',
    'employee.pay.night': 'Night hours',
    'employee.pay.weekend': 'Weekend hours',
    'employee.pay.line.detail': '{hours} x {rate}',
    'employee.pay.line.detailPlus': '{hours} x +{rate}',
    'employee.pay.total': 'Total',
    'employee.pay.footer.estimate':
      'Estimated from the shifts your manager published, before tax and deductions. Your payslip is the final word.',
    'employee.pay.footer.empty':
      'Nothing to estimate yet — no shifts are published for this period.',

    // Time off
    'employee.timeOff.title': 'Time off',
    'employee.timeOff.defaultType': 'Time off',
    'employee.timeOff.balance.one': '{days} day available',
    'employee.timeOff.balance.other': '{days} days available',
    'employee.timeOff.request': 'Request',
    'employee.timeOff.empty': 'No time off booked.',
    'employee.timeOff.modal.title': 'Request time off',
    'employee.timeOff.modal.note':
      'Your manager approves requests. Until then your shifts stay as they are, but the scheduler will try to plan around these dates.',
    'employee.timeOff.field.type': 'Type',
    'employee.timeOff.field.from': 'From',
    'employee.timeOff.field.to': 'To',
    'employee.timeOff.field.note': 'Note (optional)',
    'employee.timeOff.field.notePlaceholder':
      'Anything your manager should know',
    'employee.timeOff.cancel': 'Cancel',
    'employee.timeOff.send': 'Send request',
    'employee.timeOff.sending': 'Sending…',

    // The one switch this screen has. The email it turns off is the only way
    // a published rota reaches somebody who is not looking at the app, so the
    // "off" line says plainly what carries on happening without it.
    'employee.settings.title': 'Settings',
    'employee.notify.label': 'Email me when my rota changes',
    'employee.notify.help':
      'We write to {email}, and only when shifts of yours are published or moved.',
    'employee.notify.off':
      'We will not email you. Your rota still changes here — you will only see it if you open this screen.',
    'employee.notify.saving': 'Saving…',
    'employee.notify.error': 'That did not save. Try again.',
    'employee.notify.loadError': 'This setting could not be loaded.',
  },
  es: {
    // My schedule -- the screen itself
    'employee.loading': 'Cargando tus turnos…',
    'employee.error.title': 'No hemos podido cargar tu ficha',
    'employee.error.unlinked':
      'Este acceso todavía no está vinculado a ningún empleado. Pídele a tu responsable que lo configure.',
    'employee.greeting': 'Hola, {name}',
    'employee.period.prev': 'Periodo anterior',
    'employee.period.next': 'Periodo siguiente',
    // El equipo de un día que esta persona trabaja.
    'employee.team.scheduled': '{hours} programadas',
    'employee.team.close': 'Cerrar',
    'employee.team.you': 'Tú',
    'employee.team.empty': 'Ese día no trabaja nadie más.',
    'employee.team.error': 'No se ha podido cargar ese día',
    'employee.shiftList.openDay': 'Ver con quién trabajas: {range}',
    'employee.shifts.loadError': 'No hemos podido cargar tus turnos',

    'employee.stat.shifts': 'Turnos',
    'employee.stat.week': 'Esta semana',
    'employee.stat.period': 'Este periodo',
    'employee.stat.hours': 'Horas',
    'employee.stat.regular': 'Ordinarias',
    'employee.stat.overtime': 'Horas extra',
    'employee.stat.estimated': 'Estimado',

    'employee.noContract.title': 'Todavía no hay contrato registrado',
    'employee.noContract.body':
      'No podemos estimar tu cobro hasta que tu responsable registre las condiciones de tu contrato.',
    'employee.terms.title': 'Tus condiciones',
    'employee.terms.paid': 'Cobras',
    'employee.terms.rate': 'Precio por hora',
    'employee.terms.minimum': 'Mínimo por contrato',
    'employee.terms.minimumValue': '{hours} / semana',
    'employee.terms.below':
      'Tienes {hours} menos de las que marca tu contrato para este periodo. Merece la pena comentárselo a tu responsable.',

    // Next shift card
    'employee.next.label': 'Tu próximo turno',
    'employee.next.onShift': 'Estás de turno',
    'employee.next.today': 'Hoy',
    'employee.next.tomorrow': 'Mañana',
    'employee.next.empty.title': 'No tienes nada programado',
    'employee.next.empty.body':
      'No tienes ningún turno en las próximas dos semanas.',
    'employee.next.endsAt': 'acaba a las {time}',
    'employee.next.startsInMinutes': 'empieza en {minutes} min',
    'employee.next.startsInHours': 'empieza en {hours} h',
    'employee.next.inDays.one': 'dentro de {count} día',
    'employee.next.inDays.other': 'dentro de {count} días',
    'employee.next.meta': '{template} · {hours} pagadas',

    // Shift list
    'employee.shiftList.today': 'Hoy · {label}',
    'employee.shiftList.empty.title': 'No tienes turnos en este periodo',
    'employee.shiftList.empty.body':
      'O no te han asignado ninguno, o tu responsable todavía no ha publicado este periodo.',
    'employee.shiftList.tag.new': 'Nuevo',
    'employee.shiftList.tag.night': 'noche',
    'employee.shiftList.tag.weekend': 'fin de semana',
    'employee.shiftList.overtime': '{hours} extra',

    // Pay breakdown
    'employee.pay.title': 'Cobro estimado',
    'employee.pay.salary': 'Salario',
    'employee.pay.salary.detail':
      '{hours} programadas · tu salario no cambia con las horas',
    'employee.pay.base': 'Base',
    'employee.pay.overtime': 'Horas extra',
    'employee.pay.night': 'Horas nocturnas',
    'employee.pay.weekend': 'Horas de fin de semana',
    'employee.pay.line.detail': '{hours} x {rate}',
    'employee.pay.line.detailPlus': '{hours} x +{rate}',
    'employee.pay.total': 'Total',
    'employee.pay.footer.estimate':
      'Estimado a partir de los turnos que ha publicado tu responsable, antes de impuestos y deducciones. La última palabra la tiene tu nómina.',
    'employee.pay.footer.empty':
      'Todavía no hay nada que estimar: no hay turnos publicados para este periodo.',

    // Time off
    'employee.timeOff.title': 'Vacaciones y ausencias',
    'employee.timeOff.defaultType': 'Ausencia',
    'employee.timeOff.balance.one': '{days} día disponible',
    'employee.timeOff.balance.other': '{days} días disponibles',
    'employee.timeOff.request': 'Solicitar',
    'employee.timeOff.empty': 'No tienes ninguna ausencia pedida.',
    'employee.timeOff.modal.title': 'Solicitar ausencia',
    'employee.timeOff.modal.note':
      'Las solicitudes las aprueba tu responsable. Hasta entonces tus turnos siguen igual, pero el planificador intentará organizar el cuadrante evitando estas fechas.',
    'employee.timeOff.field.type': 'Tipo',
    'employee.timeOff.field.from': 'Desde',
    'employee.timeOff.field.to': 'Hasta',
    'employee.timeOff.field.note': 'Nota (opcional)',
    'employee.timeOff.field.notePlaceholder':
      'Algo que tu responsable deba saber',
    'employee.timeOff.cancel': 'Cancelar',
    'employee.timeOff.send': 'Enviar solicitud',
    'employee.timeOff.sending': 'Enviando…',

    'employee.settings.title': 'Ajustes',
    'employee.notify.label': 'Avísame por correo cuando cambie mi horario',
    'employee.notify.help':
      'Te escribimos a {email}, y solo cuando se publican o se mueven turnos tuyos.',
    'employee.notify.off':
      'No te escribiremos. Tu horario sigue cambiando aquí: solo lo verás si abres esta pantalla.',
    'employee.notify.saving': 'Guardando…',
    'employee.notify.error': 'No se ha guardado. Inténtalo otra vez.',
    'employee.notify.loadError': 'No se ha podido cargar este ajuste.',
  },
};
