import type { MessageModule } from './types';

// The first five minutes of an account.
//
// Two kinds of string live here and they are not written in the same voice.
//
//   The QUESTIONS are asked the way a person would ask them — out loud, in one
//   breath, with the reason for asking attached. "What hours do you keep?" is
//   one question, not seven, because that is how a manager answers it.
//
//   The BRIEF sentences are the manager's own words being written FOR them,
//   and they go straight into the box they can edit. So they read like
//   something a manager would type, not like a form filled in: no labels, no
//   colons where a person would use none, and no vocabulary the intake has to
//   be clever about.
//
// Every brief sentence is one whole key. The temptation is to keep "we open"
// and stitch the days and the hours around it, and it does not survive the
// second language: the days come first in one and last in the other, and
// "closed on Sunday" is not "cerrado en domingo". A list of weekday names
// inside a sentence is joined with a comma, which is punctuation, not language.

export const onboarding: MessageModule = {
  en: {
    'onboarding.title': 'Let us set up your first calendar',
    'onboarding.subtitle':
      'A few short questions. Skip any of them — nothing here blocks anything.',
    'onboarding.progress': 'Step {step} of {total}',
    'onboarding.skipAll': 'Skip the questions',
    'onboarding.skipStep': 'Skip this one',
    'onboarding.back': 'Back',
    'onboarding.next': 'Next',
    'onboarding.finish': 'Build the calendar',
    'onboarding.building': 'Building…',
    'onboarding.yes': 'Yes',
    'onboarding.no': 'No',

    'onboarding.vertical.question': 'What kind of business is this?',
    'onboarding.vertical.help':
      'So we stop asking you what is obvious about a business like yours. You can change it later.',

    'onboarding.hours.question': 'What hours do you keep?',
    'onboarding.hours.help':
      'Say it in one go, the way you would tell someone: “Monday to Thursday six to two, Friday and Saturday until four.”',
    'onboarding.hours.placeholder':
      'Monday to Thursday 6am to 2pm, Friday and Saturday until 4am, closed Sundays',
    'onboarding.hours.read': 'Read it',
    'onboarding.hours.reading': 'Reading…',
    'onboarding.hours.failed':
      'That could not be read — {reason}. Set the hours below by hand instead.',
    'onboarding.hours.review':
      'This is what we understood. Correct anything that is wrong before it is saved.',
    'onboarding.hours.openLabel': 'Opens {day}',
    'onboarding.hours.closeLabel': 'Closes {day}',
    'onboarding.hours.closedDay': 'Closed',
    'onboarding.hours.nextDay': 'next day',
    'onboarding.hours.edit': 'Say it again',

    'onboarding.midnight.question': 'Closing at {time} — that is the next day?',
    'onboarding.midnight.help':
      'If it is, your day does not end at midnight. We will keep a Friday night on Friday, in the calendar and in the pay.',

    'onboarding.busy.question': 'Which days are your busy ones?',
    'onboarding.busy.help':
      'The days that get covered and paid differently from the rest. For a bar that is usually Friday and Saturday; for an office, Saturday and Sunday.',

    'onboarding.peak.question':
      'How many people do you need at the busiest point of the day?',
    'onboarding.peak.help':
      'Without this we assume two, and we assume it without telling you.',
    'onboarding.peak.label': 'People at once',

    'onboarding.split.question': 'Can anyone work two shifts in one day?',
    'onboarding.split.help':
      'A stretch in the morning and another in the evening, same person. A yes counts for one person a day — say a bigger number in the brief if there are more.',

    // The brief itself, written in the manager's own language.
    'onboarding.brief.hours': 'We open {days} from {from} to {to}.',
    'onboarding.brief.hoursEveryDay': 'We open every day from {from} to {to}.',
    'onboarding.brief.open24': 'We are open 24 hours {days}.',
    'onboarding.brief.open24EveryDay': 'We are open 24 hours, every day.',
    'onboarding.brief.closed': 'We are closed on {days}.',
    'onboarding.brief.minStaff':
      'At least {count} people have to be working at any one time.',
    'onboarding.brief.split':
      'One person can work a split day: two separate shifts on the same day.',

    // The one line that asks the manager to confirm the kind of business the
    // interview made us think they run. The label goes in quotes because it is
    // a category name ("Office / services"), and no article in front of it
    // fits all ten.
    'onboarding.inferredVertical.label': 'Kind of business',
    'onboarding.inferredVertical.question':
      'Your business looks like “{label}”. Is that right?',
    'onboarding.inferredVertical.yes': 'Yes',
    'onboarding.inferredVertical.no': 'No, it is another kind',
    'onboarding.inferredVertical.choose': 'Which kind is it?',
    'onboarding.inferredVertical.cancel': 'Cancel',
    'onboarding.inferredVertical.failed': 'Could not save it — {reason}. Try again.',
    'onboarding.inferredVertical.saved': 'Kind of business saved: {label}.',
  },
  es: {
    'onboarding.title': 'Vamos a montar tu primer calendario',
    'onboarding.subtitle':
      'Unas preguntas cortas. Sáltate las que quieras: aquí no se bloquea nada.',
    'onboarding.progress': 'Paso {step} de {total}',
    'onboarding.skipAll': 'Saltarme las preguntas',
    'onboarding.skipStep': 'Saltar esta',
    'onboarding.back': 'Atrás',
    'onboarding.next': 'Siguiente',
    'onboarding.finish': 'Montar el calendario',
    'onboarding.building': 'Montándolo…',
    'onboarding.yes': 'Sí',
    'onboarding.no': 'No',

    'onboarding.vertical.question': '¿Qué tipo de negocio es?',
    'onboarding.vertical.help':
      'Para dejar de preguntarte lo que se da por sabido en un negocio como el tuyo. Puedes cambiarlo cuando quieras.',

    'onboarding.hours.question': '¿Qué horario hacéis?',
    'onboarding.hours.help':
      'Dilo de una vez, como se lo contarías a alguien: «de lunes a jueves de seis a dos, y viernes y sábado hasta las cuatro».',
    'onboarding.hours.placeholder':
      'De lunes a jueves de 6 a 14, viernes y sábado hasta las 4 de la madrugada, domingos cerrado',
    'onboarding.hours.read': 'Leerlo',
    'onboarding.hours.reading': 'Leyéndolo…',
    'onboarding.hours.failed':
      'No se ha podido leer: {reason}. Pon el horario a mano aquí abajo.',
    'onboarding.hours.review':
      'Esto es lo que hemos entendido. Corrige lo que esté mal antes de guardarlo.',
    'onboarding.hours.openLabel': 'Abre el {day}',
    'onboarding.hours.closeLabel': 'Cierra el {day}',
    'onboarding.hours.closedDay': 'Cerrado',
    'onboarding.hours.nextDay': 'del día siguiente',
    'onboarding.hours.edit': 'Volver a decirlo',

    'onboarding.midnight.question': 'Cerráis a las {time}, ¿ya del día siguiente?',
    'onboarding.midnight.help':
      'Si es así, vuestro día no acaba a medianoche. El viernes por la noche seguirá siendo viernes, en el calendario y en la nómina.',

    'onboarding.busy.question': '¿Qué días tenéis más trabajo?',
    'onboarding.busy.help':
      'Los días que se cubren y se pagan distinto del resto. En un bar suelen ser viernes y sábado; en una oficina, sábado y domingo.',

    'onboarding.peak.question':
      '¿Cuántas personas hacen falta en el peor momento del día?',
    'onboarding.peak.help':
      'Sin esto damos por supuestas dos, y lo damos por supuesto sin decírtelo.',
    'onboarding.peak.label': 'Personas a la vez',

    'onboarding.split.question': '¿Alguien puede hacer dos turnos en un día?',
    'onboarding.split.help':
      'Un rato por la mañana y otro por la tarde, la misma persona. Un sí cuenta para una persona al día; si son más, dilo en el brief.',

    'onboarding.brief.hours': 'Abrimos {days} de {from} a {to}.',
    'onboarding.brief.hoursEveryDay': 'Abrimos todos los días de {from} a {to}.',
    'onboarding.brief.open24': 'Abrimos 24 horas {days}.',
    'onboarding.brief.open24EveryDay': 'Abrimos 24 horas todos los días.',
    'onboarding.brief.closed': 'Cerramos {days}.',
    'onboarding.brief.minStaff':
      'Como mínimo tiene que haber {count} personas trabajando a la vez.',
    'onboarding.brief.split':
      'Una persona puede hacer turno partido: dos turnos distintos el mismo día.',

    'onboarding.inferredVertical.label': 'Tipo de negocio',
    'onboarding.inferredVertical.question':
      'Parece que tu negocio es de tipo «{label}». ¿Correcto?',
    'onboarding.inferredVertical.yes': 'Sí',
    'onboarding.inferredVertical.no': 'No, es otro',
    'onboarding.inferredVertical.choose': '¿Qué tipo de negocio es?',
    'onboarding.inferredVertical.cancel': 'Cancelar',
    'onboarding.inferredVertical.failed': 'No se ha podido guardar: {reason}. Prueba otra vez.',
    'onboarding.inferredVertical.saved': 'Tipo de negocio guardado: {label}.',
  },
};
