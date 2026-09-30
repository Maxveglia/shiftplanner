import type { MessageModule } from './types';

// The opening interview: a model asks, the manager answers, a brief comes out.
// Written as one person talking to another. The privacy line is not small
// print: it is the reason the interview may exist on a free tier at all.
export const interview: MessageModule = {
  en: {
    'interview.title': 'Let me ask you a few things',
    'interview.cancel': 'Back',
    'interview.skip': 'Skip for now',
    'interview.thinking': '…',
    'interview.placeholder': 'Answer here',
    'interview.send': 'Send',
    'interview.voice.start': 'Speak instead',
    'interview.voice.stop': 'Stop listening',
    'interview.voice.listening': 'Listening…',
    'interview.privacy':
      'The assistant is told the names you write here and the contract hours beside them, and nothing else about anyone: no pay, no age, no health.',
    'interview.finishNow': 'That’s all, write the brief',
    'interview.retry': 'Try again',
    'interview.brief.title': 'Here is what I understood',
    'interview.brief.help': 'Change anything before it is used.',
    'interview.brief.remembered':
      'This is kept as the description of your business. Every brief you write from now on is read with it in mind; you can edit it later in Settings.',
    'interview.brief.use': 'Keep this and build the calendar',
    'interview.brief.building': 'Building…',
    'interview.brief.keepTalking': 'Keep talking',
    'interview.hours.question':
      'First of all: when are you open, each day? Drag the bar on each day over the hours you are open. Pull either end to change the time, slide the bar to move it, or press an empty day to draw one.',
    'interview.hours.help':
      'Half-hour steps. A bar that runs past midnight closes the next morning; the shaded part is that morning.',
    'interview.hours.continue': 'That’s our week',
    'interview.hours.closed': 'Closed',
    'interview.hours.open': 'Open',
    'interview.hours.closedHint': 'Closed · drag to open',
    'interview.hours.copy': 'Copy',
    'interview.hours.copyToAll': 'Copy to every day',
    'interview.hours.handle.open': 'Opening time on {day}',
    'interview.hours.handle.close': 'Closing time on {day}',
    'interview.hours.allClosed': 'Every day is closed. Open at least one, or skip this for now.',
    // --- The month of the first calendar: a list, straight after the hours ---
    'interview.month.question': 'Which month do you want your first calendar for?',
    'interview.month.help': 'The current month only has the days that are left: the ones already gone are not planned.',
    'interview.month.rest': 'What’s left: {from}–{to}',
    'interview.month.withYear': '{month} {year}',
    'interview.month.answer': '{month}.',
    'interview.month.answerRest': '{month} {from}–{to}: only what’s left of it.',
    // --- The roster form: who works here, when the model asks for it --------
    // Its answer goes up as the manager's own message, names and all, which
    // is what the line under the box promises and what the brief needs: the
    // planner builds the team from the names in it.
    'interview.roster.help':
      'A row for each of you, from the number you just gave. Put a name on each one and pick the hours their contract is for; add or remove rows if the number was not exact.',
    'interview.roster.name': 'Name',
    'interview.roster.namePlaceholder': 'Ana',
    'interview.roster.hours': 'Hours a week',
    'interview.roster.hours.pick': 'Pick one…',
    'interview.roster.hours.none': 'No fixed hours',
    'interview.roster.hours.option': '{hours} h',
    'interview.roster.hours.other': 'Another number…',
    'interview.roster.remove': 'Remove {name}',
    'interview.roster.add': 'Add someone',
    'interview.roster.continue': 'That’s everyone',
    'interview.roster.orType': 'Or just type the answer below.',
    'interview.roster.said.one':
      'One person works here, and these are their weekly contract hours: {list}.',
    'interview.roster.said.other':
      'There are {count} of us, and these are the weekly contract hours of each: {list}.',
    'interview.roster.said.person': '{name} {hours} h',
    'interview.roster.said.noHours': '{name} with no fixed hours',
    'interview.roster.said.unsaid': '{name}, hours not settled',
    'interview.brief.researching': 'Looking up how a business like yours runs in your area…',
    'interview.progress.title': 'Getting your calendar ready',
    'interview.progress.sr': 'Step {step} of {total}: {label}',
    'interview.progress.step.save': 'Saving what you told me',
    'interview.progress.step.research': 'Looking up how businesses like yours run in your area',
    'interview.progress.step.research.at': 'Looking up how businesses like yours run in {location}',
    'interview.progress.step.build': 'Building your first calendar',
    'interview.progress.tip.1': 'Checking the hours when places like yours get busiest.',
    'interview.progress.tip.2': 'Comparing weekdays with the weekend.',
    'interview.progress.tip.3': 'Looking for local habits: holidays, seasons, usual hours.',
    'interview.progress.tip.4': 'What I find is only a guide: what you told me comes first.',
    'interview.progress.tip.5': 'If this takes too long I carry on without it — the calendar doesn’t depend on it.',
    'interview.progress.stay': 'Keep this page open; I’ll take you to the calendar as soon as it’s done.',
    // --- Starting a SECOND round of the fixed questions -------------------
    // Warned rather than noted: by the time the chat is open the first
    // question is on screen, and what a new round replaces includes a thing
    // nobody would guess -- the research we did about their business.
    'interview.restart.title': 'Start the questions again?',
    'interview.restart.body':
      'A new round replaces the last one whole. What you told us before is forgotten, not added to:',
    'interview.restart.item.notes': 'The description of your business, in your words.',
    'interview.restart.item.hours': 'The opening hours you set in the form.',
    'interview.restart.item.research':
      'What we went and read about businesses like yours — it is re-read from your new answers.',
    'interview.restart.keeps':
      'Your team, their contracts, your calendars and everything we learned from your corrections stay exactly as they are.',
    'interview.restart.cancel': 'Leave it as it is',
    'interview.restart.confirm': 'Start again',

    'interview.offer.firstRun': 'Prefer to be asked? Talk to an assistant instead',
    'interview.offer.prompt': 'Not sure what to write? Let it ask you',
  },
  es: {
    'interview.title': 'Deja que te pregunte',
    'interview.cancel': 'Volver',
    'interview.skip': 'Saltar por ahora',
    'interview.thinking': '…',
    'interview.placeholder': 'Responde aquí',
    'interview.send': 'Enviar',
    'interview.voice.start': 'Hablar en vez de escribir',
    'interview.voice.stop': 'Dejar de escuchar',
    'interview.voice.listening': 'Escuchando…',
    'interview.privacy':
      'Al asistente le llegan los nombres que escribas aquí y las horas de contrato que pongas al lado, y nada más de nadie: ni sueldos, ni edad, ni salud.',
    'interview.finishNow': 'Eso es todo, escribe el brief',
    'interview.retry': 'Reintentar',
    'interview.brief.title': 'Esto es lo que he entendido',
    'interview.brief.help': 'Cambia lo que quieras antes de usarlo.',
    'interview.brief.remembered':
      'Esto se guarda como la descripción de tu negocio. Cada brief que escribas a partir de ahora se lee teniéndolo en cuenta; puedes corregirlo más adelante en Ajustes.',
    'interview.brief.use': 'Guardar esto y construir el calendario',
    'interview.brief.building': 'Construyendo…',
    'interview.brief.keepTalking': 'Seguir hablando',
    'interview.hours.question':
      'Antes de nada: ¿a qué hora abrís cada día? Arrastra la barra de cada día sobre las horas en que estáis abiertos. Tira de un extremo para cambiar la hora, desliza la barra para moverla, o pulsa en un día vacío para dibujar una.',
    'interview.hours.help':
      'Pasos de media hora. Una barra que pasa de medianoche cierra a la mañana siguiente; la parte sombreada es esa madrugada.',
    'interview.hours.continue': 'Así es nuestra semana',
    'interview.hours.closed': 'Cerrado',
    'interview.hours.open': 'Abrir',
    'interview.hours.closedHint': 'Cerrado · arrastra para abrir',
    'interview.hours.copy': 'Copiar',
    'interview.hours.copyToAll': 'Copiar a todos los días',
    'interview.hours.handle.open': 'Hora de apertura del {day}',
    'interview.hours.handle.close': 'Hora de cierre del {day}',
    'interview.hours.allClosed': 'Todos los días están cerrados. Abre al menos uno, o sáltatelo por ahora.',
    // --- El mes del primer calendario: una lista, justo después del horario ---
    'interview.month.question': '¿Para qué mes quieres tu primer calendario?',
    'interview.month.help': 'El mes en curso solo trae los días que quedan: los que ya han pasado no se planifican.',
    'interview.month.rest': 'Lo que queda: del {from} al {to}',
    'interview.month.withYear': '{month} de {year}',
    'interview.month.answer': '{month}.',
    'interview.month.answerRest': '{month}, solo lo que queda: del {from} al {to}.',
    // --- El formulario de plantilla: quién trabaja aquí ---------------------
    'interview.roster.help':
      'Una fila por cada uno, según el número que acabas de dar. Ponle nombre a cada una y elige las horas que dice su contrato; añade o quita filas si el número no era exacto.',
    'interview.roster.name': 'Nombre',
    'interview.roster.namePlaceholder': 'Ana',
    'interview.roster.hours': 'Horas a la semana',
    'interview.roster.hours.pick': 'Elige…',
    'interview.roster.hours.none': 'Sin horas fijas',
    'interview.roster.hours.option': '{hours} h',
    'interview.roster.hours.other': 'Otro número…',
    'interview.roster.remove': 'Quitar a {name}',
    'interview.roster.add': 'Añadir a alguien',
    'interview.roster.continue': 'Ya estamos todos',
    'interview.roster.orType': 'O respóndelo escribiendo aquí abajo.',
    'interview.roster.said.one':
      'Trabaja una persona, y estas son sus horas de contrato a la semana: {list}.',
    'interview.roster.said.other':
      'Somos {count}, y estas son las horas de contrato de cada uno a la semana: {list}.',
    'interview.roster.said.person': '{name} {hours} h',
    'interview.roster.said.noHours': '{name} sin horas fijas',
    'interview.roster.said.unsaid': '{name}, sin concretar las horas',
    'interview.brief.researching': 'Buscando cómo funciona un negocio como el tuyo en tu zona…',
    'interview.progress.title': 'Preparando tu calendario',
    'interview.progress.sr': 'Paso {step} de {total}: {label}',
    'interview.progress.step.save': 'Guardando lo que me has contado',
    'interview.progress.step.research': 'Buscando cómo trabajan los negocios como el tuyo en tu zona',
    'interview.progress.step.research.at': 'Buscando cómo trabajan los negocios como el tuyo en {location}',
    'interview.progress.step.build': 'Construyendo tu primer calendario',
    'interview.progress.tip.1': 'Mirando a qué horas suelen llenarse los sitios como el tuyo.',
    'interview.progress.tip.2': 'Comparando los días entre semana con el fin de semana.',
    'interview.progress.tip.3': 'Buscando costumbres de la zona: festivos, temporadas, horarios habituales.',
    'interview.progress.tip.4': 'Lo que encuentre es solo orientativo: manda lo que tú me has dicho.',
    'interview.progress.tip.5': 'Si tarda demasiado, sigo sin ello: el calendario no depende de esto.',
    'interview.progress.stay': 'Deja esta página abierta; en cuanto termine te llevo al calendario.',
    // --- Empezar una SEGUNDA ronda de las preguntas fijas -----------------
    'interview.restart.title': '¿Volver a empezar las preguntas?',
    'interview.restart.body':
      'Una ronda nueva sustituye a la anterior entera. Lo que nos contaste antes se olvida, no se suma:',
    'interview.restart.item.notes': 'La descripción de tu negocio, con tus palabras.',
    'interview.restart.item.hours': 'El horario de apertura que pusiste en el formulario.',
    'interview.restart.item.research':
      'Lo que buscamos sobre negocios como el tuyo — se vuelve a buscar con tus respuestas nuevas.',
    'interview.restart.keeps':
      'Tu plantilla, sus contratos, tus calendarios y todo lo aprendido de tus correcciones se quedan exactamente como están.',
    'interview.restart.cancel': 'Dejarlo como está',
    'interview.restart.confirm': 'Empezar de nuevo',

    'interview.offer.firstRun': '¿Prefieres que te pregunte? Habla con un asistente',
    'interview.offer.prompt': '¿No sabes qué escribir? Deja que te pregunte',
  },
};
