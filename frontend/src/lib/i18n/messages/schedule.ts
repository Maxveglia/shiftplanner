import type { MessageModule } from './types';

export const schedule: MessageModule = {
  en: {
    // PromptPanel -- the brief the manager writes or dictates.
    'schedule.prompt.title': 'Describe your scheduling needs',
    'schedule.prompt.placeholder':
      'There are 3 of us, we open 8am to 10pm, at least 2 people per hour, extra cover from noon to 3pm, closed on Sundays…',
    'schedule.prompt.voice.start': 'Dictate with your voice',
    'schedule.prompt.voice.startAria': 'Start dictation',
    'schedule.prompt.voice.stop': 'Stop dictation',
    'schedule.prompt.voice.unsupported': 'Voice input is not supported in this browser',
    'schedule.prompt.voice.listening': 'Listening… speak now.',
    'schedule.prompt.voice.micError': 'Could not access the microphone.',
    'schedule.prompt.voice.startError': 'Voice input could not start.',
    'schedule.prompt.voice.browsers': 'Voice dictation needs Chrome, Edge or Safari.',
    'schedule.prompt.generating': 'Building schedule…',
    'schedule.prompt.generate': 'Generate schedule with AI',
    'schedule.prompt.clear': 'Clear',

    // RefineBar -- every prompt after the first one adjusts the calendar.
    'schedule.refine.placeholder':
      'Keep talking — give Sarah Friday off, hire two more cooks, New hire 1 is called Ana…',
    'schedule.refine.voice.start': 'Dictate an adjustment',
    'schedule.refine.voice.stop': 'Stop dictation',
    'schedule.refine.voice.unsupported': 'Voice input needs Chrome, Edge or Safari',
    'schedule.refine.submit': 'Adjust',
    'schedule.refine.submit.help':
      'Changes what you asked for and nothing else. If the sentence needs the whole rota rearranged, it goes to the planner by itself.',
    'schedule.refine.working': 'Adjusting…',
    'schedule.refine.undo': 'Undo',
    'schedule.refine.newCalendar': 'New calendar',
    'schedule.refine.reorganize': 'Reorganize with AI',
    'schedule.refine.reorganize.help':
      'With the box empty: lets the model rearrange the whole calendar as it sees fit. People may move. You can undo it.',
    'schedule.refine.scope.label': 'Replan',
    'schedule.refine.scope.month': 'This month ({month})',
    'schedule.refine.scope.horizon': 'All {count} months',
    'schedule.refine.scope.published': 'Include what is already published: {months}',
    'schedule.refine.scope.help':
      'Every month is a separate call to the AI, so the narrower scope is also the faster and cheaper one. Widen it when what you are asking for is about the whole period — "alternate the weekends" is.',
    'schedule.changes.title': 'What changed ({count})',
    'schedule.changes.none': 'Nothing changed.',
    'schedule.changes.off': '{name}: {day} off ({hours}).',
    'schedule.changes.moved': '{name}: {day} now {to}, was {from}.',
    'schedule.changes.covers': '{name} covers {day}, {hours}.',
    'schedule.changes.skipped': 'Could not be done',

    // RequirementsPanel -- the shift catalogue and the rules the AI must respect.
    'schedule.requirements.table.shift': 'Shift',
    'schedule.requirements.table.hours': 'Hours',
    'schedule.requirements.table.break': 'Unpaid break',
    'schedule.requirements.table.flags': 'Flags',
    'schedule.requirements.breakMinutes': '{n} min',
    'schedule.requirements.flag.night': 'Night',
    'schedule.requirements.flag.weekend': 'Weekend premium',
    'schedule.requirements.addTemplate': 'Add shift template',
    'schedule.requirements.premiums.title': 'Pay premiums',
    'schedule.requirements.premiums.night': 'Night (10 PM–6 AM)',
    'schedule.requirements.premiums.weekend': 'Weekend',
    'schedule.requirements.premiums.minimumWage': 'Minimum wage',
    'schedule.requirements.premiums.minimumWagePlaceholder': 'not set',
    'schedule.requirements.premiums.notSaved': 'This was not saved:',
    // It used to say overtime was "fixed at 1.5x by federal law", which is
    // another country's law and was not even true of this form: the field is
    // editable, and it was the FLOOR behind it that made every save fail.
    'schedule.requirements.premiums.note':
      'An extra hour is never worth less than an ordinary one (art. 35.1 ET); many collective agreements pay it the same or give the time back as rest. The wage floor changes every January — enter the rate that applies to you.',
    'schedule.requirements.rules.title': 'Labour rules enforced',
    'schedule.requirements.rules.where': 'Where you operate',
    'schedule.requirements.form.cancel': 'Cancel',
    'schedule.requirements.form.create': 'Create',
    'schedule.requirements.form.creating': 'Creating…',
    'schedule.requirements.form.name': 'Name',
    'schedule.requirements.form.start': 'Start',
    'schedule.requirements.form.end': 'End',
    'schedule.requirements.form.break': 'Unpaid break (minutes)',
    'schedule.requirements.form.colour': 'Colour',
    'schedule.requirements.form.night': 'Night shift',
    'schedule.requirements.form.weekend': 'Weekend premium',

    // TeamProposal -- the roster changes the brief implies, confirmed line by line.
    'schedule.teamProposal.title.retireOnly': 'Some people were not in your brief',
    'schedule.teamProposal.title.default': 'Your brief describes a team',
    'schedule.teamProposal.body.retireOnly':
      'They are still on the roster and still on the calendar. Retire them only if your brief was the whole team — nothing is saved until you confirm.',
    'schedule.teamProposal.body.default':
      'Apply it to your roster so the calendar, hours & pay and time-off all work from the same people. Nothing is saved until you confirm.',
    'schedule.teamProposal.badge.retireOnly': '{retires} to retire',
    'schedule.teamProposal.badge.summary':
      '{adds} to add · {updates} to update · {retires} to retire',
    'schedule.teamProposal.section.creates': 'New employees',
    'schedule.teamProposal.section.updates': 'Update existing',
    'schedule.teamProposal.section.resignations':
      'Not in the brief — retire? (off by default)',
    'schedule.teamProposal.create.title': '{name} · {status}',
    'schedule.teamProposal.create.noTerms': 'No contract terms stated — add them later',
    'schedule.teamProposal.create.detail': '{terms} · {reason}',
    'schedule.teamProposal.resign.detail':
      'Marks them resigned — history is kept, they drop off the calendar',
    'schedule.teamProposal.draft.minHours': '{hours}h/wk min',
    'schedule.teamProposal.draft.hourlyRate': '€{rate}/h',
    'schedule.teamProposal.draft.annualSalary': '€{salary}/yr',
    'schedule.teamProposal.apply.applying': 'Applying…',
    'schedule.teamProposal.apply.none': 'Nothing selected',
    'schedule.teamProposal.apply.one': 'Apply 1 change to roster',
    'schedule.teamProposal.apply.other': 'Apply {count} changes to roster',
    'schedule.teamProposal.dismiss': 'Not now',

    // DraftBalanceColumn -- where each person lands if this draft is published.
    // Kept to a word apiece on purpose: the column is sixteen characters wide
    // and sits beside a calendar that is already full.
    'schedule.balances.title': 'If you publish',
    'schedule.balances.help':
      "Each person's hours over the stretch if you publish this draft, against what their contract asks for over the whole stretch. The bar splits what is already published from the draft. Underneath, how far over (+) or short (−) they are over the part already planned.",
    'schedule.balances.spanLabel': 'Stretch',
    'schedule.balances.span.month': 'Month',
    'schedule.balances.span.quarter': 'Quarter',
    'schedule.balances.span.year': 'Year',
    // "182.5 / 525.7h": the stretch's hours if published, of what the contract
    // asks for over the whole of it. `{owed}` arrives with its unit.
    'schedule.balances.of': '{hours} / {owed}',
    // The deviation of the planned part, named by the months it covers. Every
    // `{hours}` here arrives formatted and signed, unit included -- the
    // sentence must not add a second "h".
    'schedule.balances.deviation.month': '{hours} in {month}',
    'schedule.balances.deviation.months': '{hours} from {from} to {to}',
    'schedule.balances.deviation.range': '{hours} from {from} to {to}',
    // The hours still to hand out over the rest of the stretch, on the
    // working-year screen. Beside the deviation, never inside it: these are
    // rota nobody has written, not hours anybody is behind on.
    'schedule.balances.pending': '{hours} still to plan',
    'schedule.balances.row.title':
      '{name}: {hours} of the {owed} their contract asks for over this stretch, if you publish.',
    'schedule.balances.row.split':
      'Of those, published and unchanged: {kept}. New or changed in this draft: {drafted}.',
    'schedule.balances.row.pending':
      'Of what the contract asks for, {hours} falls on days with no rota yet.',
    'schedule.balances.row.deviation': 'Over what is already planned: {deviation}.',
    'schedule.balances.legend.kept': 'published',
    'schedule.balances.legend.drafted': 'draft',
    'schedule.balances.row.unmeasurable':
      '{name}: this stretch asks for no contracted hours, so there is nothing to measure the draft against',
    'schedule.balances.since': 'Counted from {date}',
    'schedule.balances.loading': 'Reading hours…',
    'schedule.balances.empty': 'Nobody on the roster yet.',
  },
  es: {
    // PromptPanel -- the brief the manager writes or dictates.
    'schedule.prompt.title': 'Describe lo que necesitas para tus turnos',
    'schedule.prompt.placeholder':
      'Somos 3 personas, abrimos de 8 a 22, mínimo 2 por hora, refuerzo de 12 a 15, cerramos los domingos…',
    'schedule.prompt.voice.start': 'Dictar con la voz',
    'schedule.prompt.voice.startAria': 'Empezar a dictar',
    'schedule.prompt.voice.stop': 'Parar el dictado',
    'schedule.prompt.voice.unsupported': 'Este navegador no admite el dictado por voz',
    'schedule.prompt.voice.listening': 'Escuchando… habla ahora.',
    'schedule.prompt.voice.micError': 'No se ha podido acceder al micrófono.',
    'schedule.prompt.voice.startError': 'No se ha podido iniciar el dictado.',
    'schedule.prompt.voice.browsers': 'El dictado por voz necesita Chrome, Edge o Safari.',
    'schedule.prompt.generating': 'Construyendo el calendario…',
    'schedule.prompt.generate': 'Generar calendario con IA',
    'schedule.prompt.clear': 'Borrar',

    // RefineBar -- every prompt after the first one adjusts the calendar.
    'schedule.refine.placeholder':
      'Sigue hablando: dale el viernes libre a Sara, contrata dos cocineros más, Nueva incorporación 1 se llama Ana…',
    'schedule.refine.voice.start': 'Dictar un ajuste',
    'schedule.refine.voice.stop': 'Parar el dictado',
    'schedule.refine.voice.unsupported': 'El dictado por voz necesita Chrome, Edge o Safari',
    'schedule.refine.submit': 'Ajustar',
    'schedule.refine.submit.help':
      'Cambia lo que pides y nada más. Si la frase necesita reorganizar el cuadrante entero, pasa al planificador por su cuenta.',
    'schedule.refine.working': 'Ajustando…',
    'schedule.refine.undo': 'Deshacer',
    'schedule.refine.newCalendar': 'Calendario nuevo',
    'schedule.refine.reorganize': 'Reorganizar con IA',
    'schedule.refine.reorganize.help':
      'Con la caja vacía: deja que el modelo reorganice todo el calendario como mejor le parezca. Puede mover a gente. Se puede deshacer.',
    'schedule.refine.scope.label': 'Replanificar',
    'schedule.refine.scope.month': 'Este mes ({month})',
    'schedule.refine.scope.horizon': 'Los {count} meses',
    'schedule.refine.scope.published': 'Incluir lo ya publicado: {months}',
    'schedule.refine.scope.help':
      'Cada mes es una llamada aparte a la IA, así que el alcance más estrecho también es el más rápido y barato. Amplíalo cuando lo que pides sea sobre todo el periodo — «alterna los fines de semana» lo es.',
    'schedule.changes.title': 'Qué cambió ({count})',
    'schedule.changes.none': 'No cambió nada.',
    'schedule.changes.off': '{name}: {day} fuera ({hours}).',
    'schedule.changes.moved': '{name}: {day} ahora {to}, antes {from}.',
    'schedule.changes.covers': '{name} cubre el {day}, {hours}.',
    'schedule.changes.skipped': 'No se pudo hacer',

    // RequirementsPanel -- the shift catalogue and the rules the AI must respect.
    'schedule.requirements.table.shift': 'Turno',
    'schedule.requirements.table.hours': 'Horario',
    'schedule.requirements.table.break': 'Descanso no retribuido',
    'schedule.requirements.table.flags': 'Marcas',
    'schedule.requirements.breakMinutes': '{n} min',
    'schedule.requirements.flag.night': 'Noche',
    'schedule.requirements.flag.weekend': 'Plus de fin de semana',
    'schedule.requirements.addTemplate': 'Añadir plantilla de turno',
    'schedule.requirements.premiums.title': 'Pluses salariales',
    'schedule.requirements.premiums.night': 'Noche (22:00–6:00)',
    'schedule.requirements.premiums.weekend': 'Fin de semana',
    'schedule.requirements.premiums.minimumWage': 'Salario mínimo',
    'schedule.requirements.premiums.minimumWagePlaceholder': 'sin definir',
    'schedule.requirements.premiums.notSaved': 'Esto no se ha guardado:',
    'schedule.requirements.premiums.note':
      'Una hora extra nunca vale menos que una ordinaria (art. 35.1 ET); muchos convenios la pagan igual o la devuelven en descanso. El salario mínimo cambia cada enero: introduce el que se te aplica.',
    'schedule.requirements.rules.title': 'Normas laborales que se aplican',
    'schedule.requirements.rules.where': 'Dónde operas',
    'schedule.requirements.form.cancel': 'Cancelar',
    'schedule.requirements.form.create': 'Crear',
    'schedule.requirements.form.creating': 'Creando…',
    'schedule.requirements.form.name': 'Nombre',
    'schedule.requirements.form.start': 'Inicio',
    'schedule.requirements.form.end': 'Fin',
    'schedule.requirements.form.break': 'Descanso no retribuido (minutos)',
    'schedule.requirements.form.colour': 'Color',
    'schedule.requirements.form.night': 'Turno de noche',
    'schedule.requirements.form.weekend': 'Plus de fin de semana',

    // TeamProposal -- the roster changes the brief implies, confirmed line by line.
    'schedule.teamProposal.title.retireOnly': 'Hay gente que no aparecía en tu brief',
    'schedule.teamProposal.title.default': 'Tu brief describe un equipo',
    'schedule.teamProposal.body.retireOnly':
      'Siguen en la plantilla y siguen en el calendario. Dales de baja solo si tu brief era el equipo entero: no se guarda nada hasta que lo confirmes.',
    'schedule.teamProposal.body.default':
      'Aplícalo a tu plantilla para que el calendario, las horas y la nómina, y las ausencias trabajen con las mismas personas. No se guarda nada hasta que lo confirmes.',
    'schedule.teamProposal.badge.retireOnly': '{retires} para dar de baja',
    'schedule.teamProposal.badge.summary':
      '{adds} para añadir · {updates} para actualizar · {retires} para dar de baja',
    'schedule.teamProposal.section.creates': 'Empleados nuevos',
    'schedule.teamProposal.section.updates': 'Actualizar los existentes',
    'schedule.teamProposal.section.resignations':
      'No están en el brief, ¿dar de baja? (desmarcado por defecto)',
    'schedule.teamProposal.create.title': '{name} · {status}',
    'schedule.teamProposal.create.noTerms':
      'No se han indicado condiciones de contrato: añádelas más adelante',
    'schedule.teamProposal.create.detail': '{terms} · {reason}',
    'schedule.teamProposal.resign.detail':
      'Los marca como baja: se conserva el historial y desaparecen del calendario',
    'schedule.teamProposal.draft.minHours': 'mín. {hours} h/sem',
    'schedule.teamProposal.draft.hourlyRate': '{rate} €/h',
    'schedule.teamProposal.draft.annualSalary': '{salary} €/año',
    'schedule.teamProposal.apply.applying': 'Aplicando…',
    'schedule.teamProposal.apply.none': 'No has seleccionado nada',
    'schedule.teamProposal.apply.one': 'Aplicar 1 cambio a la plantilla',
    'schedule.teamProposal.apply.other': 'Aplicar {count} cambios a la plantilla',
    'schedule.teamProposal.dismiss': 'Ahora no',

    // DraftBalanceColumn -- dónde queda cada persona si se publica el borrador.
    'schedule.balances.title': 'Si publicas',
    'schedule.balances.help':
      'Horas de cada persona en el tramo si publicas este borrador, frente a lo que pide su contrato en el tramo entero. La barra separa lo ya publicado del borrador. Debajo, cuánto se pasa (+) o se queda corto (−) en la parte ya planificada.',
    'schedule.balances.spanLabel': 'Tramo',
    'schedule.balances.span.month': 'Mes',
    'schedule.balances.span.quarter': 'Trim.',
    'schedule.balances.span.year': 'Año',
    // "182,5 / 525,7h": las horas del tramo si publicas, de las que pide el
    // contrato en el tramo entero. `{owed}` llega con su unidad.
    'schedule.balances.of': '{hours} / {owed}',
    // El desvío de la parte planificada, nombrado por los meses que cubre.
    // Todo `{hours}` llega formateado y con signo, unidad incluida -- la frase
    // no añade otra "h".
    'schedule.balances.deviation.month': '{hours} en {month}',
    'schedule.balances.deviation.months': '{hours} de {from} a {to}',
    'schedule.balances.deviation.range': '{hours} del {from} al {to}',
    // Las horas que quedan por repartir en el resto del tramo, en la vista de
    // jornada anual. Al lado del saldo, nunca dentro: es cuadrante sin
    // escribir, no horas que nadie deba.
    'schedule.balances.pending': 'faltan {hours} por planificar',
    'schedule.balances.row.title':
      '{name}: {hours} de las {owed} que pide su contrato en este tramo, si publicas.',
    'schedule.balances.row.split':
      'De ellas, publicadas y sin cambios: {kept}. Nuevas o cambiadas en este borrador: {drafted}.',
    'schedule.balances.row.pending':
      'De lo que pide el contrato, {hours} caen en días que aún no tienen cuadrante.',
    'schedule.balances.row.deviation': 'En lo ya planificado: {deviation}.',
    'schedule.balances.legend.kept': 'publicado',
    'schedule.balances.legend.drafted': 'borrador',
    'schedule.balances.row.unmeasurable':
      '{name}: este tramo no pide horas de contrato, así que no hay nada contra lo que medir el borrador',
    'schedule.balances.since': 'Cuenta desde el {date}',
    'schedule.balances.loading': 'Leyendo horas…',
    'schedule.balances.empty': 'Aún no hay nadie en la plantilla.',
  },
};
