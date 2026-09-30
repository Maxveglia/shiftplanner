import type { MessageModule } from './types';

// What went wrong, said to the person it went wrong for.
//
// The server names the failure with a code (see backend/app/errors.py) and the
// sentence is written here, which is the same arrangement as every other
// sentence in this product and it exists for the same reason: a server with no
// dictionary can only write English. Until now it did, and a manager working in
// Spanish who mistyped their password read "Invalid credentials".
//
// TWO KINDS OF LINE LIVE HERE, and they are worth telling apart.
//
// Most are things a person did, or a thing that is temporarily true: a wrong
// password, an allowance spent, a name that does not match. Those get a
// sentence that says what happened and, where there is one, what to do next.
//
// The rest are things a person cannot cause -- a request with a malformed
// timestamp, a weekday outside 0-6, a month list longer than a year. The client
// is supposed to make those impossible, so seeing one is a bug in this app, and
// the sentence says so rather than pretending the manager mistyped something.
// Keeping them here anyway is deliberate: a bug seen in the wrong language is
// a bug reported badly.
//
// What is NOT here is the exception text a model call failed with. The server
// still carries it in `message`, where a developer reading the network tab or
// a log finds it; a manager gets the sentence. That line was already drawn for
// the research endpoint -- "no raw API error reaches the manager" is a test --
// and it now holds everywhere.
export const errors: MessageModule = {
  en: {
    // --- Signing in, and who you are -------------------------------------
    'errors.invalid_credentials': 'That email and password do not match an account.',
    // Five wrong passwords in a quarter of an hour and the door shuts, for
    // that email, on both logins. Said in minutes because the server sends the
    // wait in minutes; it never says whether the address has an account,
    // because the server refuses before it has looked.
    'errors.too_many_attempts':
      'Too many failed attempts. Wait {minutes} min and try again.',
    'errors.session_invalid': 'Your session has expired. Sign in again.',
    'errors.email_taken': 'That email address already has an account.',
    'errors.manager_role_required': 'Only a manager can do that.',
    // The access window: shop accounts (the till's tablets), and a role that
    // may not do what was asked (an employee may, the shop account not).
    'errors.too_many_store_accounts': 'This business already has 20 shop accounts, the most there can be. Delete one you no longer use first.',
    'errors.store_account_not_found': 'That shop account no longer exists.',
    // An old login with nobody behind it, deleted from the access window.
    'errors.account_not_found': 'That account no longer exists.',
    'errors.email_invalid': 'That email is not valid.',
    'errors.role_not_allowed': 'This account cannot do that. Ask your manager.',
    'errors.account_not_linked':
      'This login is not linked to anyone on the team yet. Ask your manager to set it up.',
    'errors.employee_not_yours': 'That person is not on your team.',
    'errors.organization_not_found': 'That workspace no longer exists.',
    'errors.confirm_name_mismatch':
      'Type the workspace name exactly as it is written to confirm.',
    // An app this business has not got switched on. The app travels in
    // `params.app` as its key ('shifts'), which is not a name to show, so the
    // sentence does without it: the screens of an app a business lacks are
    // not mounted, and meeting this at all means a stale tab or a bug.
    'errors.app_not_enabled': 'That app is not switched on for this business.',

    // --- The team, their logins and their contracts -----------------------
    'errors.employee_not_found': 'That person is no longer on the team.',
    'errors.employee_already_has_login': 'They already have a login.',
    'errors.employee_has_no_login': 'They do not have a login.',
    'errors.employee_has_no_login_yet': 'They do not have a login yet.',
    'errors.employee_has_no_email': 'There is no email on file for them — add one.',
    'errors.employee_has_no_open_contract':
      'They have no open contract, so there are no hours to set.',

    // --- Time off ---------------------------------------------------------
    'errors.absence_not_found': 'That time off is no longer there.',
    'errors.absence_type_not_found': 'That kind of time off no longer exists.',
    'errors.end_before_start': 'The end has to come after the start.',

    // --- What the business is ---------------------------------------------
    'errors.unknown_vertical': 'We do not know that kind of business.',
    'errors.unknown_objective': 'We do not know that objective.',
    'errors.unknown_jurisdiction':
      'We hold no labour rules for {jurisdiction}. The ones we have: {known}.',
    'errors.hint_not_found': 'That belief is no longer there.',
    'errors.open_hours_invalid': 'Those opening hours do not describe a week we can use.',

    // --- The AI, and what it costs ----------------------------------------
    'errors.anthropic_key_missing':
      'The assistant is not set up on the server, so the calendar was built without it.',
    'errors.gemini_key_missing': 'The questions are not set up on the server.',
    'errors.interview_quota_spent':
      'The questions have used up their allowance for now. You can write the brief yourself, or come back later.',
    'errors.research_quota_spent':
      'The web search has used up its allowance for now. It can be tried again later; nothing else is affected.',
    'errors.org_budget_spent':
      'This account has reached its monthly allowance for AI planning. It frees up as earlier usage ages past 30 days, and everything else in the calendar keeps working meanwhile.',
    // The four ways a model call fails that a manager can do something about,
    // told apart on the server from the vendor's own wording (`ai_failure`).
    // They used to be worked out here by looking for "credit balance" inside
    // the error text -- which is matching on prose, and stopped working the
    // moment the prose was translated.
    'errors.ai_no_credit': 'The Anthropic account has no credit left.',
    'errors.ai_usage_limit':
      'The Anthropic usage limit has been reached — it frees up when the limit resets.',
    'errors.ai_bad_key': 'The Anthropic API key was rejected.',
    'errors.ai_rate_limit':
      'Too many requests to Anthropic at once. Try again in a moment.',
    'errors.intake_failed': 'The brief could not be read. Try again in a moment.',
    'errors.refine_failed': 'The adjustment could not be worked out. Try again in a moment.',
    'errors.plan_failed': 'The calendar could not be planned. Try again in a moment.',
    // Planning is a job now, not a wait: the request returns a ticket and a
    // worker writes the months. These three are what a person can meet while
    // that is happening.
    'errors.generation_already_running':
      'This account is already planning a calendar. Wait for that one to finish.',
    'errors.generation_not_found': 'That calendar is no longer being planned.',
    // Publishing is refused by the SERVER now, not only judged in the browser.
    // The body carries the findings in `params.violations` -- a rule, a person
    // and a day each -- and NOTHING RENDERS THEM YET, so this sentence has to
    // stand on its own. It used to say "fix what is flagged", which was a
    // promise the screen did not keep. Say where to look instead, until the
    // findings are shown next to the shifts they are about.
    'errors.schedule_breaks_the_law':
      'This calendar breaks a working-time rule, so it was not published. Check the rest between shifts, the hours in one day, and the day and a half off each week.',
    'errors.generation_abandoned':
      'The calendar was interrupted and did not finish. The months that were ready have been kept — ask again for the rest.',
    'errors.interview_failed': 'The questions could not go on. Try again in a moment.',
    'errors.research_failed': 'The search could not be done. Try again in a moment.',
    'errors.nothing_known_yet':
      'We know nothing about this business yet. Answer the questions first.',

    // --- Publishing and saving a rota -------------------------------------
    'errors.published_shift_overlap':
      'A shift overlaps one already published outside this period. Publish the neighbouring period too, or shorten the shift.',
    'errors.draft_shift_overlap':
      'Two shifts overlap for the same person. Shorten one of them, or save the neighbouring period too.',
    'errors.unknown_employee': 'A shift is assigned to somebody no longer on the team.',
    'errors.unknown_shift_template':
      'A shift uses a shift type that does not belong to this business.',
    'errors.shift_ends_before_start': 'A shift ends before it starts.',
    'errors.shift_outside_period': 'A shift starts outside the period being saved.',
    'errors.negative_break': 'A break cannot be a negative number of minutes.',

    // --- Things this app is supposed to make impossible -------------------
    // If one of these reaches a screen, the bug is here and not in what the
    // manager typed. The sentence says so, because "period_end must be after
    // period_start" tells them to fix something they never wrote.
    'errors.text_empty': 'Something went wrong in the app: it sent an empty request.',
    'errors.context_empty': 'Something went wrong in the app: it sent no calendar.',
    'errors.months_empty': 'Something went wrong in the app: it asked for no months.',
    'errors.too_many_months': 'A year at a time is the most that can be planned.',
    'errors.unknown_effort': 'Something went wrong in the app: it asked for an unknown effort.',
    'errors.weekday_out_of_range': 'Something went wrong in the app: that is not a weekday.',
    'errors.day_has_no_length': 'A day has to open before it closes.',
    'errors.day_boundary_out_of_range': 'That is not a time of day.',
    'errors.weekend_days_invalid': 'Something went wrong in the app: those are not weekdays.',
    'errors.period_end_before_start': 'Something went wrong in the app: the period ends before it starts.',
    'errors.window_end_before_start': 'Something went wrong in the app: the period ends before it starts.',
    // The app only ever asks for one day here, so a person seeing this is a
    // person whose request was not written by the app.
    'errors.window_too_wide':
      'The team can only be looked up one day at a time.',
    'errors.naive_period': 'Something went wrong in the app: it sent times with no time zone.',
    'errors.naive_shift_times': 'Something went wrong in the app: it sent shift times with no time zone.',
    'errors.naive_window': 'Something went wrong in the app: it sent times with no time zone.',
    'errors.bad_date': 'Something went wrong in the app: it asked about a date it had written wrongly.',
    // Not quite one of the above: this one a manager CAN cause, by publishing
    // a very large period in one go, so it says what to do rather than only
    // that something broke.
    'errors.request_too_large':
      'That was too much to send at once. Publish a shorter period, or shorten what you typed.',
    // You see the team of a day you are on, and only that day.
    'errors.not_on_that_day': 'You can only see the team for a day you are working.',

    // --- The back office --------------------------------------------------
    'errors.customer_not_found': 'That customer no longer exists.',
    'errors.confirm_company_mismatch':
      'Type the company name exactly as it is written to confirm: {name}.',

    // --- The business assistant ---------------------------------------------
    'errors.assistant_unavailable': 'The assistant could not answer just now. Try again in a moment.',
    'errors.assistant_timeout': 'The assistant took too long to answer. Ask again, perhaps a shorter question.',
    'errors.assistant_busy': 'The assistant is still answering your previous message.',
    'errors.conversation_not_found': 'That conversation is not available.',
    'errors.conversation_closed': 'That conversation has ended. A new one starts with everything the assistant remembers.',
    'errors.memory_not_found': 'That line is no longer in the assistant’s memory.',

    // --- Inventory ---------------------------------------------------------
    'errors.inventory_item_not_found': 'That product is no longer in your inventory.',
    'errors.inventory_count_not_found': 'That count no longer exists.',
    'errors.inventory_count_duplicate_item':
      'A product appears twice in this count. This is a bug in the app; reload and try again.',
    'errors.inventory_barcode_taken': 'That barcode already belongs to “{product}”.',
    'errors.inventory_barcode_invalid':
      'That barcode is empty. Scan it again, or type the digits printed under the bars.',
    'errors.inventory_barcode_not_found': 'That barcode is no longer on this product.',
    'errors.inventory_receipt_not_found': 'That delivery no longer exists.',
    'errors.inventory_receipt_duplicate_item':
      'A product appears twice in this delivery. This is a bug in the app; reload and try again.',
    'errors.inventory_date_out_of_range':
      'Check the date: it has to be between the year 2000 and tomorrow.',
    'errors.inventory_supplier_not_found': 'That supplier is no longer in your inventory.',
    'errors.inventory_supplier_name_taken': 'You already have a supplier called “{name}”.',
    'errors.inventory_supplier_phone_invalid':
      'That is not a phone: 7 to 15 digits; spaces, dashes, brackets and a + in front are fine.',

    // --- The menu ------------------------------------------------------------
    'errors.menu_section_not_found': 'That section is no longer on the menu.',
    'errors.menu_dish_not_found': 'That dish is no longer on the menu.',
    // Somebody else (or another tab) changed the menu while it was being
    // reordered here; the screen has already fetched what is there now.
    'errors.menu_order_mismatch':
      'The menu changed while you were reordering it. It is up to date now: try again.',
    'errors.menu_too_many':
      'The menu is full: 50 sections and 500 dishes at most. Delete something to add more.',
    // The app shrinks a photo before sending it, so these two mean it could
    // not: a file the browser cannot read, or one that is still too big. A
    // product of the stock is refused with the same two codes as a dish
    // (app/photo_http.py), so neither sentence names the menu.
    'errors.menu_photo_too_large': 'That photo is too big, even made smaller. Try another one.',
    'errors.menu_photo_bad_type': 'That file is not a photo the app can use. Try a JPEG, PNG or WebP.',
    // A dish inside a combo's recipe cannot leave the menu: the combo would
    // go on selling and stop taking its ingredients. {combos} comes joined
    // with commas.
    'errors.menu_dish_in_combo':
      'It is inside these combos: {combos}. Take it out of them in Shop › Recipes before deleting it.',
    'errors.menu_section_in_combo':
      'Products of this section are inside these combos: {combos}. Take them out of them in Shop › Recipes before deleting the section.',

    // --- The shop: sales and their statistics --------------------------------
    // A sale naming a dish that has left the menu is refused with
    // `menu_dish_not_found`, above: the sentence is the same one.
    'errors.store_sale_not_found': 'That sale no longer exists.',
    'errors.store_date_out_of_range':
      'Check the date: it has to be between the year 2000 and tomorrow.',
    // The screen offers 7, 30 and 90 days, so a person never asks for more.
    'errors.store_range_too_long':
      'Something went wrong in the app: it asked for statistics over more than a year.',
    // What the sale's recipes would take of one product is past what the stock
    // can hold: a quantity typed wrong, almost certainly.
    'errors.store_sale_consumption_too_large':
      'This sale would take far too much of “{item}” off the stock. Check the quantities.',
    // Voided from another tab, or by somebody else, while this one was open.
    'errors.store_sale_already_voided': 'That sale was already voided.',
    // What the till sends is checked against the menu as it is now: every
    // line a dish of it, at its price, charged today. The till refetches the
    // menu on the second and marks the lines that changed (ChargeDialog.tsx).
    'errors.till_line_needs_dish': 'Every line charged at the till has to be a dish on the menu.',
    'errors.menu_price_changed': 'The price of a dish has changed, or it has none now: check the order.',
    'errors.till_sale_not_today': 'A till charge has to be for today.',
    'errors.till_quantity_invalid': 'The quantity has to be a whole number from 1 to 999.',

    // --- Recipes -------------------------------------------------------------------
    // A product of the menu inside another, which already contains the first
    // (A in B in A). The editor leaves those out, so this is a stale screen or
    // two managers at once.
    'errors.recipe_cycle':
      'A product cannot contain itself, not even through another product. Take out the one that already contains this one.',
    'errors.recipe_too_deep':
      'Too many levels of products inside products: 5 at most. Put the ingredients in directly instead.',
    // The editor stops at 30 and 20; meeting these is a stale screen or a bug.
    'errors.recipe_too_many':
      'Too much in one recipe: 30 ingredients and 20 included products at most.',
    'errors.recipe_duplicate':
      'Something appears twice in this recipe. This is a bug in the app; reload and try again.',

    // --- Day notes ---------------------------------------------------------
    'errors.day_note_not_found': 'There is no note for that day.',
  },
  es: {
    // --- Entrar, y quién eres ---------------------------------------------
    'errors.invalid_credentials': 'Ese correo y esa contraseña no coinciden con ninguna cuenta.',
    'errors.too_many_attempts':
      'Demasiados intentos fallidos. Espera {minutes} min y vuelve a probar.',
    'errors.session_invalid': 'Tu sesión ha caducado. Vuelve a entrar.',
    'errors.email_taken': 'Ese correo ya tiene cuenta.',
    'errors.manager_role_required': 'Esto solo lo puede hacer un responsable.',
    // La ventana de accesos: cuentas de tienda (las tablets del TPV), y un rol
    // que no puede hacer lo pedido (el empleado sí, la cuenta de tienda no).
    'errors.too_many_store_accounts': 'Este negocio ya tiene 20 cuentas de tienda, el máximo. Elimina antes una que ya no uses.',
    'errors.store_account_not_found': 'Esa cuenta de tienda ya no existe.',
    'errors.account_not_found': 'Esa cuenta ya no existe.',
    'errors.email_invalid': 'Ese correo no es válido.',
    'errors.role_not_allowed': 'Esta cuenta no puede hacer eso. Pídeselo a tu responsable.',
    'errors.account_not_linked':
      'Este acceso todavía no está vinculado a nadie del equipo. Pídele a tu responsable que lo configure.',
    'errors.employee_not_yours': 'Esa persona no es de tu equipo.',
    'errors.organization_not_found': 'Ese espacio de trabajo ya no existe.',
    'errors.confirm_name_mismatch':
      'Escribe el nombre del espacio de trabajo exactamente como está para confirmar.',
    'errors.app_not_enabled': 'Esa aplicación no está activada en este negocio.',

    // --- El equipo, sus accesos y sus contratos ----------------------------
    'errors.employee_not_found': 'Esa persona ya no está en el equipo.',
    'errors.employee_already_has_login': 'Ya tiene acceso.',
    'errors.employee_has_no_login': 'No tiene acceso.',
    'errors.employee_has_no_login_yet': 'Todavía no tiene acceso.',
    'errors.employee_has_no_email': 'No hay ningún correo suyo registrado — añade uno.',
    'errors.employee_has_no_open_contract':
      'No tiene ningún contrato abierto, así que no hay horas que fijar.',

    // --- Ausencias ---------------------------------------------------------
    'errors.absence_not_found': 'Esa ausencia ya no está.',
    'errors.absence_type_not_found': 'Ese tipo de ausencia ya no existe.',
    'errors.end_before_start': 'El final tiene que ir después del principio.',

    // --- Qué es el negocio -------------------------------------------------
    'errors.unknown_vertical': 'No conocemos ese tipo de negocio.',
    'errors.unknown_objective': 'No conocemos ese objetivo.',
    'errors.unknown_jurisdiction':
      'No tenemos normas laborales de {jurisdiction}. Las que tenemos: {known}.',
    'errors.hint_not_found': 'Esa creencia ya no está.',
    'errors.open_hours_invalid': 'Ese horario de apertura no describe una semana que podamos usar.',

    // --- La IA, y lo que cuesta --------------------------------------------
    'errors.anthropic_key_missing':
      'El asistente no está configurado en el servidor, así que el calendario se ha hecho sin él.',
    'errors.gemini_key_missing': 'Las preguntas no están configuradas en el servidor.',
    'errors.interview_quota_spent':
      'Las preguntas han agotado su cupo por ahora. Puedes escribir el brief tú mismo, o volver más tarde.',
    'errors.research_quota_spent':
      'La búsqueda web ha agotado su cupo por ahora. Se puede reintentar más tarde; no afecta a nada más.',
    'errors.org_budget_spent':
      'Esta cuenta ha llegado a su cupo mensual de planificación con IA. Se va liberando según el consumo antiguo cumple 30 días, y mientras tanto el resto del calendario sigue funcionando.',
    'errors.ai_no_credit': 'La cuenta de Anthropic se ha quedado sin saldo.',
    'errors.ai_usage_limit':
      'Se ha alcanzado el límite de uso de Anthropic — se libera cuando el límite se reinicia.',
    'errors.ai_bad_key': 'La clave de API de Anthropic ha sido rechazada.',
    'errors.ai_rate_limit':
      'Demasiadas peticiones a Anthropic a la vez. Inténtalo dentro de un momento.',
    'errors.intake_failed': 'No se ha podido leer el brief. Inténtalo dentro de un momento.',
    'errors.refine_failed': 'No se ha podido calcular el ajuste. Inténtalo dentro de un momento.',
    'errors.plan_failed': 'No se ha podido planificar el calendario. Inténtalo dentro de un momento.',
    'errors.generation_already_running':
      'Esta cuenta ya está planificando un calendario. Espera a que termine.',
    'errors.generation_not_found': 'Ese calendario ya no se está planificando.',
    'errors.schedule_breaks_the_law':
      'Este calendario incumple una norma de jornada, así que no se ha publicado. Revisa el descanso entre turnos, las horas de un mismo día y el día y medio libre de cada semana.',
    'errors.generation_abandoned':
      'La planificación se interrumpió y no llegó a terminar. Los meses que estaban listos se han guardado: vuelve a pedir el resto.',
    'errors.interview_failed': 'Las preguntas no han podido seguir. Inténtalo dentro de un momento.',
    'errors.research_failed': 'No se ha podido hacer la búsqueda. Inténtalo dentro de un momento.',
    'errors.nothing_known_yet':
      'Todavía no sabemos nada de este negocio. Responde primero a las preguntas.',

    // --- Publicar y guardar un cuadrante -----------------------------------
    'errors.published_shift_overlap':
      'Un turno se solapa con otro ya publicado fuera de este periodo. Publica también el periodo de al lado, o acorta el turno.',
    'errors.draft_shift_overlap':
      'Dos turnos se solapan en la misma persona. Acorta uno, o guarda también el periodo de al lado.',
    'errors.unknown_employee': 'Hay un turno asignado a alguien que ya no está en el equipo.',
    'errors.unknown_shift_template':
      'Hay un turno con un tipo de turno que no es de este negocio.',
    'errors.shift_ends_before_start': 'Hay un turno que acaba antes de empezar.',
    'errors.shift_outside_period': 'Hay un turno que empieza fuera del periodo que se está guardando.',
    'errors.negative_break': 'Un descanso no puede ser un número negativo de minutos.',

    // --- Cosas que esta app tendría que hacer imposibles --------------------
    'errors.text_empty': 'Algo ha fallado en la app: ha mandado una petición vacía.',
    'errors.context_empty': 'Algo ha fallado en la app: no ha mandado ningún calendario.',
    'errors.months_empty': 'Algo ha fallado en la app: no ha pedido ningún mes.',
    'errors.too_many_months': 'Como mucho se puede planificar un año de una vez.',
    'errors.unknown_effort': 'Algo ha fallado en la app: ha pedido un esfuerzo que no existe.',
    'errors.weekday_out_of_range': 'Algo ha fallado en la app: eso no es un día de la semana.',
    'errors.day_has_no_length': 'Un día tiene que abrir antes de cerrar.',
    'errors.day_boundary_out_of_range': 'Eso no es una hora del día.',
    'errors.weekend_days_invalid': 'Algo ha fallado en la app: esos no son días de la semana.',
    'errors.period_end_before_start': 'Algo ha fallado en la app: el periodo acaba antes de empezar.',
    'errors.window_end_before_start': 'Algo ha fallado en la app: el periodo acaba antes de empezar.',
    'errors.window_too_wide':
      'El equipo solo se puede consultar de un día en un día.',
    'errors.naive_period': 'Algo ha fallado en la app: ha mandado horas sin zona horaria.',
    'errors.naive_shift_times': 'Algo ha fallado en la app: ha mandado horas de turno sin zona horaria.',
    'errors.naive_window': 'Algo ha fallado en la app: ha mandado horas sin zona horaria.',
    'errors.bad_date': 'Algo ha fallado en la app: ha preguntado por una fecha mal escrita.',
    'errors.request_too_large':
      'Eso era demasiado para mandarlo de una vez. Publica un periodo más corto, o acorta lo que has escrito.',
    'errors.not_on_that_day': 'Solo puedes ver el equipo de un día en el que trabajas.',

    // --- El back office ----------------------------------------------------
    'errors.customer_not_found': 'Ese cliente ya no existe.',
    'errors.confirm_company_mismatch':
      'Escribe el nombre de la empresa exactamente como está para confirmar: {name}.',

    // --- El asistente del negocio -------------------------------------------
    'errors.assistant_unavailable': 'El asistente no ha podido responder ahora. Prueba de nuevo en un momento.',
    'errors.assistant_timeout': 'El asistente ha tardado demasiado. Vuelve a preguntar, mejor algo más corto.',
    'errors.assistant_busy': 'El asistente todavía está respondiendo a tu mensaje anterior.',
    'errors.conversation_not_found': 'Esa conversación no está disponible.',
    'errors.conversation_closed': 'Esa conversación ha terminado. Una nueva empieza con todo lo que el asistente recuerda.',
    'errors.memory_not_found': 'Esa línea ya no está en la memoria del asistente.',

    // --- Inventory ---------------------------------------------------------
    'errors.inventory_item_not_found': 'Ese producto ya no está en tu inventario.',
    'errors.inventory_count_not_found': 'Ese conteo ya no existe.',
    'errors.inventory_count_duplicate_item':
      'Un producto aparece dos veces en este conteo. Es un fallo de la app; recarga e inténtalo de nuevo.',
    'errors.inventory_barcode_taken': 'Ese código ya es de «{product}».',
    'errors.inventory_barcode_invalid':
      'Ese código está vacío. Vuelve a escanearlo o escribe los números que hay bajo las barras.',
    'errors.inventory_barcode_not_found': 'Ese código ya no está en este producto.',
    'errors.inventory_receipt_not_found': 'Esa entrada ya no existe.',
    'errors.inventory_receipt_duplicate_item':
      'Un producto aparece dos veces en esta entrada. Es un fallo de la app; recarga e inténtalo de nuevo.',
    'errors.inventory_date_out_of_range':
      'Revisa la fecha: tiene que estar entre el año 2000 y mañana.',
    'errors.inventory_supplier_not_found': 'Ese proveedor ya no está en tu inventario.',
    'errors.inventory_supplier_name_taken': 'Ya tienes un proveedor que se llama «{name}».',
    'errors.inventory_supplier_phone_invalid':
      'Eso no es un teléfono: de 7 a 15 cifras; valen espacios, guiones, paréntesis y un + delante.',

    // --- La carta --------------------------------------------------------------
    'errors.menu_section_not_found': 'Esa sección ya no está en la carta.',
    'errors.menu_dish_not_found': 'Ese plato ya no está en la carta.',
    'errors.menu_order_mismatch':
      'La carta ha cambiado mientras la ordenabas. Ya está al día: prueba otra vez.',
    'errors.menu_too_many':
      'La carta está llena: 50 secciones y 500 platos como mucho. Borra algo para añadir más.',
    'errors.menu_photo_too_large': 'Esa foto es demasiado grande, incluso reducida. Prueba con otra.',
    'errors.menu_photo_bad_type': 'Ese archivo no es una foto que se pueda usar. Prueba con un JPEG, PNG o WebP.',
    'errors.menu_dish_in_combo':
      'Está dentro de estos combos: {combos}. Quítalo de ellos en Tienda › Recetas antes de borrarlo.',
    'errors.menu_section_in_combo':
      'Hay productos de esta sección dentro de estos combos: {combos}. Quítalos de ellos en Tienda › Recetas antes de borrar la sección.',

    // --- La tienda: ventas y estadísticas ----------------------------------------
    'errors.store_sale_not_found': 'Esa venta ya no existe.',
    'errors.store_date_out_of_range':
      'Revisa la fecha: tiene que estar entre el año 2000 y mañana.',
    'errors.store_range_too_long':
      'Algo ha fallado en la app: ha pedido estadísticas de más de un año.',
    'errors.store_sale_consumption_too_large':
      'Esta venta descontaría muchísimo de «{item}» del inventario. Revisa las cantidades.',
    'errors.store_sale_already_voided': 'Esa venta ya estaba anulada.',
    'errors.till_line_needs_dish': 'Cada línea del cobro tiene que ser un plato de la carta.',
    'errors.menu_price_changed': 'El precio de algún plato ha cambiado o ya no tiene precio: revisa la cuenta.',
    'errors.till_sale_not_today': 'Un cobro del TPV tiene que ser de hoy.',
    'errors.till_quantity_invalid': 'La cantidad tiene que ser un número entero de 1 a 999.',

    // --- Recetas -------------------------------------------------------------------
    'errors.recipe_cycle':
      'Un producto no puede contenerse a sí mismo, ni a través de otro. Quita el que ya contiene a este.',
    'errors.recipe_too_deep':
      'Demasiados niveles de productos dentro de productos: 5 como mucho. Pon los ingredientes directamente.',
    'errors.recipe_too_many':
      'Demasiado en una receta: 30 ingredientes y 20 productos incluidos como mucho.',
    'errors.recipe_duplicate':
      'Algo aparece dos veces en esta receta. Es un fallo de la app; recarga e inténtalo de nuevo.',

    // --- Day notes ---------------------------------------------------------
    'errors.day_note_not_found': 'No hay nota para ese día.',
  },
};
