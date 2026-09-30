import type { MessageModule } from './types';

// The manager's home screen: the brief, what the adaptive layer made of it,
// the generated draft's headline numbers, the calendar toolbar and publishing.
//
// The tone here is the product's own -- it explains its decisions in whole
// sentences rather than in labels -- so the Spanish keeps the explanation and
// not the English word order.

export const dashboard: MessageModule = {
  en: {
    'dashboard.header.welcome': 'Welcome, {name}',
    'dashboard.header.subtitle':
      'Describe what you need and let the AI draft the schedule — you stay in control.',
    'dashboard.header.editRequirements': 'Edit requirements',

    // The roster speaks only when something went wrong: a change that worked
    // is visible in the calendar and in Employees, and listing it back was
    // the product congratulating itself in green.
    'dashboard.teamNote.failed': 'Could not update the roster — {reason}',

    'dashboard.emptyCalendar.title':
      'The calendar is empty — nobody on the roster can be given a shift',
    'dashboard.emptyCalendar.help':
      'The requirements were understood; there was simply no one available to meet them. Fix this on the people above and generate again.',
    'dashboard.emptyCalendar.notStartedTitle':
      'Nothing here yet — your team starts after this period',
    'dashboard.emptyCalendar.notStartedHelp':
      'Nothing is wrong: the calendar fills in from the day they start. Move forward to that period to see it.',

    'dashboard.intakeError.title':
      'The AI could not read your brief — nothing was changed',
    'dashboard.intakeError.help':
      'The calendar is only ever built from the AI’s reading of what you wrote, so it is not built at all rather than built from a guess. Try again, or check the API key on the server.',

    'dashboard.unplanned.title':
      'The AI did not arrange this calendar — we built it ourselves',
    'dashboard.unplanned.help':
      'Your rules were understood and the calendar keeps every one of them, but the AI could not draft the arrangement, so ours filled it in. It is a working rota; it is just not a considered one. Generate again to have the AI try, or adjust it yourself.',

    // A replan that covered less than the horizon says so, in the same place
    // an adjustment says what it could not do. A month that was silently left
    // alone looks exactly like a month the AI decided not to change.
    'dashboard.replan.named.one':
      'Replanned {months}, the month you named; the other month of the horizon was left as it is.',
    'dashboard.replan.named.other':
      'Replanned {months}, which is what you named; the other {count} months of the horizon were left as they are.',
    'dashboard.replan.scoped.one':
      'Only {months} was replanned; the other month of the horizon was left as it is.',
    'dashboard.replan.scoped.other':
      'Only {months} was replanned; the other {count} months of the horizon were left as they are.',
    'dashboard.replan.published':
      '{months} was left alone: the team already has that rota. Tick “include what is already published” above to replan it too.',
    // Repairing what an adjustment cost (DashboardPage -> repairDamage).
    'dashboard.repair.done.one': 'Rearranged the week to cover what that change left open.',
    'dashboard.repair.done.other': 'Rearranged the weeks to cover what that change left open.',
    'dashboard.repair.noBetter.cover':
      'That leaves {hours} h uncovered, and no rearrangement of this team covers them. Nothing was moved.',
    'dashboard.repair.noBetter.hours':
      'That leaves somebody below their contracted hours, and no rearrangement of this team fixes it. Nothing was moved.',

    'dashboard.replan.nothing':
      'Nothing was replanned — every month in the chosen scope is already published.',

    'dashboard.refineError.title':
      'The AI could not read your adjustment — the calendar is unchanged',
    'dashboard.refineError.help':
      'Your calendar is exactly as it was: an adjustment nobody understood is not applied by guesswork. Say it again in other words, or check the API key on the server.',
    'dashboard.unsupportedError.title':
      'The AI could not do that adjustment — the calendar is unchanged',
    'dashboard.unsupportedError.help':
      'It read what you asked and tried both ways: as a precise change, and by rearranging the period around it. Above is why it could not. Say it differently, or change the rule that stands in the way.',

    // Server failures, said in the manager's terms. The raw reason from the
    // backend is only shown when none of these match.

    'dashboard.notes.title': 'Noted — the AI reads this when it arranges the shifts',

    'dashboard.toolbar.prevPeriod': 'Previous period',
    'dashboard.toolbar.nextPeriod': 'Next period',

    'dashboard.publish.pending': 'Publishing…',
    'dashboard.publish.cta': 'Publish to team',
    'dashboard.publish.confirm.title': 'What the team will see change',
    'dashboard.publish.confirm.loading': 'Comparing with what is published…',
    'dashboard.publish.confirm.none':
      'Nothing to publish: the team already has this calendar.',
    'dashboard.publish.confirm.comparing': 'Comparing…',
    'dashboard.publish.confirm.nothing': 'Nothing to publish',
    'dashboard.publish.confirm.unknown':
      'Could not read what is published right now, so this cannot say what changes. Publishing still replaces these weeks with the calendar on screen.',
    'dashboard.publish.confirm.one': 'Publish 1 change',
    'dashboard.publish.confirm.other': 'Publish {count} changes',
    'dashboard.publish.confirm.cancel': 'Not yet',

    // AFTER the handover, who heard about it. The counts come back from the
    // publish itself; `unreachable` is the one that changes what a manager
    // does next, so it is never folded into the first sentence and never
    // left out when it is not zero.
    'dashboard.publish.done.title': 'Published',
    'dashboard.publish.done.shifts.one': '1 shift is the team’s rota now.',
    'dashboard.publish.done.shifts.other': '{count} shifts are the team’s rota now.',
    'dashboard.publish.done.notified.one': 'We emailed 1 person whose shifts changed.',
    'dashboard.publish.done.notified.other':
      'We emailed {count} people whose shifts changed.',
    'dashboard.publish.done.unreachable.one':
      '1 person was not told: no login, no address on it, or they turned the email off. Tell them yourself.',
    'dashboard.publish.done.unreachable.other':
      '{count} people were not told: no login, no address on it, or they turned the email off. Tell them yourself.',
    'dashboard.publish.done.nobody': 'Nobody needed telling: no one’s shifts changed.',
    'dashboard.publish.done.noMail':
      'Nobody was emailed: this business has no mail set up yet, so the rota reaches the team only when they open the app.',
    'dashboard.publish.done.onLeave.one':
      '1 shift was left out: that person has time off you approved. Those hours are uncovered.',
    'dashboard.publish.done.onLeave.other':
      '{count} shifts were left out: those people have time off you approved. Those hours are uncovered.',
    'dashboard.publish.done.close': 'Done',
    'dashboard.draft.saveFailed.title': 'This draft is not saved on the server',
    'dashboard.draft.saveFailed.help':
      'It is still here in this browser. The next change tries again; fix what the message says and it will go through.',
    'dashboard.draft.strayDropped.one':
      '1 shift fell outside this period and was taken out of the draft: the server does not accept it here, and it was stopping the draft from saving and publishing.',
    'dashboard.draft.strayDropped.other':
      '{count} shifts fell outside this period and were taken out of the draft: the server does not accept them here, and they were stopping the draft from saving and publishing.',

    'dashboard.view.calendar': 'Calendar',
    'dashboard.view.payroll': 'Hours & pay',
    'dashboard.view.label': 'View',

    // What a calendar asked for with no dates covers, and where it starts:
    // today, not the first of the month.


    'dashboard.loading': 'Loading your team…',

    // The calendar being built. The steps are the real ones `handleGenerate`
    // goes through, in order, so a manager watching the list learns where the
    // minute went rather than just that it passed.
    'dashboard.generating.title.generate': 'Building your calendar',
    'dashboard.generating.title.reorganize': 'Rearranging the calendar',
    'dashboard.generating.step.interpret': 'Reading your brief',
    'dashboard.generating.step.roster': 'Matching it against the roster',
    'dashboard.generating.step.plan': 'Arranging the shifts',
    'dashboard.generating.step.plan.one': 'Arranging the shifts for the month',
    'dashboard.generating.step.plan.other': 'Arranging the shifts for {count} months at once',
    'dashboard.generating.step.plan.progress': 'Arranging the shifts — {done} of {total} months done',
    'dashboard.generating.step.tune': 'Going back over {months}',
    'dashboard.generating.hint.interpret':
      'The AI reads the whole brief before it places a single shift.',
    'dashboard.generating.hint.roster':
      'People the brief named are created or updated now, so the shifts land on real names.',
    'dashboard.generating.hint.plan':
      'A month usually takes about a minute, and months are planned in parallel. Anything that breaks a rest or coverage rule is dropped and filled in without the AI.',
    'dashboard.generating.hint.tune':
      'Those months came back with hours left uncovered, so they are being planned once more with the AI thinking harder. Only those months, and only once.',
    'dashboard.generating.elapsed': '{time} elapsed',
    // It used to say "keep this page open", because it had to: the calendar
    // lived in this tab until it was finished, and closing it threw away months
    // that had already been billed. Planning is a job on the server now, so
    // this can finally say the opposite.
    'dashboard.generating.health.stalled':
      'The server was restarted mid-plan. The work is safe: it will be picked up again in a few minutes, and the months already done are kept.',
    'dashboard.generating.health.resumed':
      'Picked up again after a server restart. It carries on from where it stopped.',
    'dashboard.generating.stay':
      'You can leave this page — the planning carries on, and the calendar is here when you come back.',

    'dashboard.empty.title': 'No schedule yet',
    'dashboard.empty.unplanned.title': '{month} is not planned yet',
    'dashboard.empty.unplanned.body':
      'Nothing has been saved for this month. You can plan it with the same rules as your brief, or leave it empty.',
    'dashboard.empty.unplanned.action': 'Plan {month} with the same rules',
    'dashboard.empty.body':
      'Describe your needs above — who is on the team, opening hours, minimum staff, closing days — and the AI drafts the calendar.',
    'dashboard.empty.rosterEmpty':
      'Nobody on the roster yet: say how many people you have and they get created.',
    'dashboard.empty.rosterCount.one': 'You have {count} person on the roster today.',
    'dashboard.empty.rosterCount.other': 'You have {count} on the roster today.',
    'dashboard.empty.horizon.month':
      'It arrives in four weekly folders — open the week you want.',
  },
  es: {
    // "Bienvenido" would gender the greeting on a name the product does not
    // know the gender of, so it greets instead.
    'dashboard.header.welcome': 'Hola, {name}',
    'dashboard.header.subtitle':
      'Cuenta lo que necesitas y deja que la IA prepare el borrador del calendario: el control sigue siendo tuyo.',
    'dashboard.header.editRequirements': 'Editar requisitos',

    'dashboard.teamNote.failed': 'No se ha podido actualizar la plantilla — {reason}',

    'dashboard.emptyCalendar.title':
      'El calendario está vacío — no se le puede dar un turno a nadie de la plantilla',
    'dashboard.emptyCalendar.help':
      'Los requisitos se entendieron; sencillamente no había nadie disponible para cumplirlos. Corrige lo de arriba y vuelve a generar.',
    'dashboard.emptyCalendar.notStartedTitle':
      'Aquí todavía no hay nada — tu equipo empieza después de este periodo',
    'dashboard.emptyCalendar.notStartedHelp':
      'No hay nada que corregir: el calendario se llena a partir del día en que empiezan. Avanza a ese periodo para verlo.',

    'dashboard.intakeError.title':
      'La IA no ha podido leer tu brief — no se ha cambiado nada',
    'dashboard.intakeError.help':
      'El calendario se construye siempre a partir de lo que la IA entiende de lo que escribiste, así que preferimos no construirlo antes que construirlo a partir de una suposición. Vuelve a intentarlo o revisa la clave de API en el servidor.',

    'dashboard.unplanned.title':
      'La IA no ha organizado este calendario — lo hemos montado nosotros',
    'dashboard.unplanned.help':
      'Tus normas se han entendido y el calendario las cumple todas, pero la IA no ha podido diseñar el reparto, así que lo ha rellenado el nuestro. Es un horario que funciona; simplemente no está pensado. Vuelve a generar para que lo intente la IA, o ajústalo tú.',

    'dashboard.replan.named.one':
      'Se ha replanificado {months}, que es el mes que pediste; el otro mes del horizonte se ha dejado como estaba.',
    'dashboard.replan.named.other':
      'Se ha replanificado {months}, que es lo que pediste; los otros {count} meses del horizonte se han dejado como estaban.',
    'dashboard.replan.scoped.one':
      'Sólo se ha replanificado {months}; el otro mes del horizonte se ha dejado como estaba.',
    'dashboard.replan.scoped.other':
      'Sólo se ha replanificado {months}; los otros {count} meses del horizonte se han dejado como estaban.',
    'dashboard.replan.published':
      '{months} no se ha tocado: el equipo ya tiene ese horario. Marca «incluir lo ya publicado» arriba para replanificarlo también.',
    // Reparar lo que costó un ajuste (DashboardPage -> repairDamage).
    'dashboard.repair.done.one': 'He reorganizado la semana para cubrir lo que ese cambio dejó abierto.',
    'dashboard.repair.done.other': 'He reorganizado las semanas para cubrir lo que ese cambio dejó abierto.',
    'dashboard.repair.noBetter.cover':
      'Quedan {hours} h sin cubrir y ninguna reorganización de este equipo las cubre. No se ha movido nada.',
    'dashboard.repair.noBetter.hours':
      'Alguien queda por debajo de sus horas de contrato y ninguna reorganización de este equipo lo arregla. No se ha movido nada.',

    'dashboard.replan.nothing':
      'No se ha replanificado nada — todos los meses del alcance elegido ya están publicados.',

    'dashboard.refineError.title':
      'La IA no ha podido leer tu ajuste — el calendario está igual',
    'dashboard.refineError.help':
      'Tu calendario se ha quedado exactamente como estaba: un ajuste que nadie ha entendido no se aplica a base de suposiciones. Dilo con otras palabras o revisa la clave de API en el servidor.',
    'dashboard.unsupportedError.title':
      'La IA no ha podido hacer ese ajuste — el calendario está igual',
    'dashboard.unsupportedError.help':
      'Leyó lo que pediste y lo intentó de las dos formas: como cambio preciso y reorganizando el periodo a su alrededor. Arriba tienes por qué no pudo. Dilo de otra manera, o cambia la regla que lo impide.',


    'dashboard.notes.title': 'Anotado: la IA lo lee cuando reparte los turnos',

    'dashboard.toolbar.prevPeriod': 'Periodo anterior',
    'dashboard.toolbar.nextPeriod': 'Periodo siguiente',

    'dashboard.publish.pending': 'Publicando…',
    'dashboard.publish.cta': 'Publicar al equipo',
    'dashboard.publish.confirm.title': 'Lo que va a cambiar para el equipo',
    'dashboard.publish.confirm.loading': 'Comparando con lo publicado…',
    'dashboard.publish.confirm.none':
      'Nada que publicar: el equipo ya tiene este calendario.',
    'dashboard.publish.confirm.comparing': 'Comparando…',
    'dashboard.publish.confirm.nothing': 'Nada que publicar',
    'dashboard.publish.confirm.unknown':
      'No se ha podido leer lo publicado ahora mismo, así que no puedo decir qué cambia. Publicar sigue sustituyendo estas semanas por el calendario en pantalla.',
    'dashboard.publish.confirm.one': 'Publicar 1 cambio',
    'dashboard.publish.confirm.other': 'Publicar {count} cambios',
    'dashboard.publish.confirm.cancel': 'Todavía no',

    'dashboard.publish.done.title': 'Publicado',
    'dashboard.publish.done.shifts.one': '1 turno es ya el horario del equipo.',
    'dashboard.publish.done.shifts.other': '{count} turnos son ya el horario del equipo.',
    'dashboard.publish.done.notified.one':
      'Hemos escrito a 1 persona a quien le cambiaban turnos.',
    'dashboard.publish.done.notified.other':
      'Hemos escrito a {count} personas a quienes les cambiaban turnos.',
    'dashboard.publish.done.unreachable.one':
      'A 1 persona no la hemos avisado: no tiene acceso, no tiene correo en su cuenta o ha desactivado el aviso. Díselo tú.',
    'dashboard.publish.done.unreachable.other':
      'A {count} personas no las hemos avisado: no tienen acceso, no tienen correo en su cuenta o han desactivado el aviso. Díselo tú.',
    'dashboard.publish.done.nobody': 'No había a quién avisar: a nadie le cambiaban turnos.',
    'dashboard.publish.done.noMail':
      'No hemos avisado a nadie: este negocio todavía no tiene el correo configurado, así que el horario solo llega al equipo cuando abre la aplicación.',
    'dashboard.publish.done.onLeave.one':
      'Ha quedado fuera 1 turno: esa persona tiene una ausencia aprobada. Esas horas no las cubre nadie.',
    'dashboard.publish.done.onLeave.other':
      'Han quedado fuera {count} turnos: esas personas tienen ausencias aprobadas. Esas horas no las cubre nadie.',
    'dashboard.publish.done.close': 'Hecho',
    'dashboard.draft.saveFailed.title': 'Este borrador no está guardado en el servidor',
    'dashboard.draft.saveFailed.help':
      'Sigue aquí, en este navegador. El siguiente cambio vuelve a intentarlo; arregla lo que dice el mensaje y pasará.',
    'dashboard.draft.strayDropped.one':
      'Se ha quitado del borrador 1 turno que caía fuera de este periodo: el servidor no lo acepta aquí y estaba impidiendo guardar y publicar.',
    'dashboard.draft.strayDropped.other':
      'Se han quitado del borrador {count} turnos que caían fuera de este periodo: el servidor no los acepta aquí y estaban impidiendo guardar y publicar.',

    'dashboard.view.calendar': 'Calendario',
    'dashboard.view.payroll': 'Horas y nómina',
    'dashboard.view.label': 'Vista',



    'dashboard.loading': 'Cargando tu equipo…',

    'dashboard.generating.title.generate': 'Construyendo tu calendario',
    'dashboard.generating.title.reorganize': 'Reorganizando el calendario',
    'dashboard.generating.step.interpret': 'Leyendo tu brief',
    'dashboard.generating.step.roster': 'Cuadrándolo con la plantilla',
    'dashboard.generating.step.plan': 'Repartiendo los turnos',
    'dashboard.generating.step.plan.one': 'Repartiendo los turnos del mes',
    'dashboard.generating.step.plan.other': 'Repartiendo los turnos de {count} meses a la vez',
    'dashboard.generating.step.plan.progress': 'Repartiendo los turnos: {done} de {total} meses ya hechos',
    'dashboard.generating.step.tune': 'Afinando {months}',
    'dashboard.generating.hint.interpret':
      'La IA lee el brief entero antes de colocar un solo turno.',
    'dashboard.generating.hint.roster':
      'La gente que nombra el brief se crea o se actualiza ahora, para que los turnos caigan sobre nombres reales.',
    'dashboard.generating.hint.plan':
      'Un mes suele tardar cerca de un minuto, y los meses se planifican en paralelo. Lo que rompa una regla de descanso o de cobertura se descarta y se rellena sin la IA.',
    'dashboard.generating.hint.tune':
      'Esos meses han vuelto con horas sin cubrir, así que se planifican otra vez con la IA pensando más. Sólo esos meses, y sólo una vez.',
    'dashboard.generating.elapsed': '{time} transcurridos',
    'dashboard.generating.health.stalled':
      'El servidor se reinició a mitad de la planificación. El trabajo no se pierde: se retoma en unos minutos y se conservan los meses ya hechos.',
    'dashboard.generating.health.resumed':
      'Retomado tras un reinicio del servidor. Sigue desde donde se quedó.',
    'dashboard.generating.stay':
      'Puedes salir de esta página: la planificación sigue y el calendario estará aquí cuando vuelvas.',

    'dashboard.empty.title': 'Todavía no hay calendario',
    'dashboard.empty.unplanned.title': '{month} está sin planificar',
    'dashboard.empty.unplanned.body':
      'No hay nada guardado para este mes. Puedes planificarlo con las mismas reglas de tu brief, o dejarlo vacío.',
    'dashboard.empty.unplanned.action': 'Planificar {month} con las mismas reglas',
    'dashboard.empty.body':
      'Describe arriba lo que necesitas — quién está en el equipo, el horario de apertura, el personal mínimo, los días de cierre — y la IA prepara el borrador del calendario.',
    'dashboard.empty.rosterEmpty':
      'Aún no hay nadie en la plantilla: di cuánta gente tienes y se crea sola.',
    'dashboard.empty.rosterCount.one': 'Hoy tienes {count} persona en la plantilla.',
    'dashboard.empty.rosterCount.other': 'Hoy tienes {count} en la plantilla.',
    'dashboard.empty.horizon.month':
      'Llega en cuatro carpetas semanales — abre la semana que quieras.',
  },
};
