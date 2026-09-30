import type { MessageModule } from './types';

// The labour rules the calendar is built to, in the reader's language.
//
// These are global reference data: three profiles and twenty-one rules, seeded
// once into the database and the same for every customer. The server sends them
// as codes and numbers plus one paragraph of prose each, and that paragraph was
// English on every screen -- which is a strange thing for a Spanish bar in
// Barcelona to be told Spanish labour law in.
//
// SO WHERE DOES THE PROSE LIVE. Here, in both languages, and the server's
// `notes` is the fallback for a rule this bundle has never heard of -- a newer
// seed, an added jurisdiction. That is the same arrangement as a vertical and a
// suggestion, and the reason is the one this whole directory exists for: the
// server has no dictionary.
//
// The copy in `backend/app/seeds/labor.py` therefore stops being what a manager
// reads and stays what it always also was: the record of where each figure
// comes from, for whoever maintains the seed. If the two ever disagree, this
// one is what is on screen -- so a figure that changes has to change here too,
// and the article it cites is the thing to search for.
//
// The Spanish is the original in every sense: every rule below is Spanish law
// or a Catalan sector agreement, and the article numbers, the "convenio" and
// the "Inspección de Trabajo" are its own words, not a translation of ours.
export const labour: MessageModule = {
  en: {
    // --- The bodies of rules we hold -------------------------------------
    'labels.jurisdiction.ES': 'Spain (Estatuto de los Trabajadores)',
    'labels.jurisdiction.ES-CT-HOSTELERIA':
      'Catalonia — hospitality (convenio 2025-2028)',
    'labels.jurisdiction.ES-CT-COMERCIO': 'Barcelona — retail (branch agreement)',

    // --- What each kind of rule is, said in three or four words ----------
    'labels.ruleType.daily_rest_between_shifts': 'rest between shifts',
    'labels.ruleType.weekly_rest_hours': 'weekly rest',
    'labels.ruleType.max_daily_ordinary_hours': 'ordinary hours in a day',
    'labels.ruleType.weekly_ordinary_hours_average': 'weekly hours, averaged',
    'labels.ruleType.annual_ordinary_hours': 'ordinary hours in a year',
    'labels.ruleType.night_work_window_start': 'night work starts',
    'labels.ruleType.night_work_window_end': 'night work ends',
    'labels.ruleType.night_work_daily_average_max': 'a night worker’s day',
    'labels.ruleType.night_worker_no_overtime': 'no overtime for night workers',
    'labels.ruleType.night_premium': 'night premium',
    'labels.ruleType.annual_overtime_cap': 'overtime in a year',
    'labels.ruleType.no_statutory_overtime_premium': 'no statutory overtime premium',
    'labels.ruleType.annual_leave_days': 'annual leave',
    'labels.ruleType.time_record_retention_years': 'time records kept',
    'labels.ruleType.minimum_wage': 'minimum wage',

    // --- The unit a threshold is counted in ------------------------------
    'labels.ruleUnit.hours': 'h',
    'labels.ruleUnit.hour_of_day': 'h',
    'labels.ruleUnit.calendar_days': 'calendar days',
    'labels.ruleUnit.years': 'years',
    'labels.ruleUnit.percent': '%',
    'labels.ruleUnit.eur_per_hour': '€/h',

    // --- Why each rule says what it says ---------------------------------
    'labels.laborNote.ES.daily_rest_between_shifts':
      'Art. 34.3 ET: at least 12 hours between the end of one shift and the start of the next. Twelve, not the eleven of the EU directive (2003/88/EC art. 3) — Spain improves on it, and a rota built to the European figure is an hour short here.',
    'labels.laborNote.ES.weekly_rest_hours':
      'Art. 37.1 ET: a day and a half without interruption every week — 36 hours, normally Saturday afternoon or Monday morning plus the Sunday. It may be accumulated over periods of up to 14 days, which is how a hospitality rota runs alternate weekends.',
    'labels.laborNote.ES.max_daily_ordinary_hours':
      'Art. 34.3 ET: no more than 9 ordinary hours in a day unless a convenio colectivo agrees another distribution (it usually does, and the 12-hour rest between days still holds whatever it says). Under-18s may never exceed 8, and that one is not negotiable by agreement.',
    'labels.laborNote.ES.weekly_ordinary_hours_average':
      'Art. 34.1 ET: 40 hours a week of effective work AS AN ANNUAL AVERAGE. Not a weekly ceiling: a 45-hour week is lawful if the year averages out. Up to 10% of the year may be distributed irregularly, with 5 days’ notice (art. 34.2).',
    'labels.laborNote.ES.night_work_window_start':
      'Art. 36.1 ET: night work is what falls between 22:00 and 06:00. The same window the app already used for its differential.',
    'labels.laborNote.ES.night_work_window_end':
      'Art. 36.1 ET: the other end of the night window that starts at 22:00.',
    'labels.laborNote.ES.night_work_daily_average_max':
      'Art. 36.1 ET: a night worker’s day may not exceed 8 hours on average over 15 days. A night worker is anyone who normally does 3+ hours of their daily shift at night, or a third of their year. This is what makes a bar’s ten-hour closing shift unlawful as a habit rather than as an exception.',
    'labels.laborNote.ES.night_worker_no_overtime':
      'Art. 36.1 ET: night workers may not work overtime, save for the exceptions the article lists (shift changeovers, force majeure). So a night shift cannot be lengthened to cover a gap.',
    'labels.laborNote.ES.annual_overtime_cap':
      'Art. 35.2 ET: 80 overtime hours a year per person, and hours compensated with time off within 4 months do not count towards it. Overtime is voluntary unless the contract or the convenio says otherwise.',
    'labels.laborNote.ES.no_statutory_overtime_premium':
      'Art. 35.1 ET: an overtime hour is paid AT LEAST as much as an ordinary one, or compensated with equivalent time off within 4 months. There is no 1.5x by law. Whatever premium exists comes from the convenio or the contract.',
    'labels.laborNote.ES.annual_leave_days':
      'Art. 38 ET: 30 calendar days a year, never replaceable by money while the contract lives.',
    'labels.laborNote.ES.time_record_retention_years':
      'Art. 34.9 ET (RDL 8/2019): the start and end time of every worker’s day must be recorded daily and kept for 4 years, available to the worker, their representatives and the Inspección de Trabajo. A published rota is not a record: what is kept has to be what actually happened.',
    'labels.laborNote.ES.minimum_wage':
      'SMI 2026 (RD of 24 February 2026): 1,221 € a month over 14 payments = 17,094 € a year for a full-time year. Stated per hour against the 2,080-hour theoretical year (40 × 52) so it is an absolute floor nobody falls under; a convenio with a shorter year raises the hourly figure. The real floor for a given person is their category’s line in the convenio’s salary table.',
    'labels.laborNote.ES-CT-HOSTELERIA.annual_ordinary_hours':
      'Art. 28 of the agreement: 1,783 hours of effective work a year for 2026, 2027 and 2028 — down from 1,791, and equivalent to the statutory 40-hour week averaged over the year. This, not any weekly figure, is what a year’s rota has to add up to.',
    'labels.laborNote.ES-CT-HOSTELERIA.night_premium':
      'Hours between 22:00 and 06:00 carry a 25% night premium. The statute (art. 36.2 ET) requires a specific payment for night work but sets no figure; this is the agreement’s.',
    'labels.laborNote.ES-CT-HOSTELERIA.annual_leave_days':
      'One day above the statutory 30: the 2025-2028 agreement raised annual leave to 31 calendar days.',
    'labels.laborNote.ES-CT-HOSTELERIA.minimum_wage':
      'The SMI over this agreement’s year: 17,094 € / 1,783 h = 9.59 €/h. An absolute floor, not the rate owed: the salary table (Annex II.A for Barcelona) sets more for every category, and it is the one to check a contract against.',
    'labels.laborNote.ES-CT-COMERCIO.annual_ordinary_hours':
      'Set by the branch agreement (comercio del metal, textil, alimentación…), not by one retail agreement for the city: they differ, and 2025-2027 texts step down to figures around 1,768 h at different paces. Enter the one in your own convenio.',
    'labels.laborNote.ES-CT-COMERCIO.minimum_wage':
      'The SMI is the floor everywhere (1,221 € a month over 14 payments in 2026); your branch’s salary table is above it and is what a contract is checked against. Enter the rate for the category you are hiring.',
    'labels.laborNote.ES-CT-COMERCIO.night_premium':
      'Art. 36.2 ET requires a specific payment for night work and sets no figure; in retail the branch agreement does, and many shops never work nights at all. Enter yours if it applies.',
  },
  es: {
    // --- Los cuerpos de normas que tenemos --------------------------------
    'labels.jurisdiction.ES': 'España (Estatuto de los Trabajadores)',
    'labels.jurisdiction.ES-CT-HOSTELERIA':
      'Cataluña — hostelería (convenio 2025-2028)',
    'labels.jurisdiction.ES-CT-COMERCIO': 'Barcelona — comercio (convenio de rama)',

    // --- Qué es cada tipo de norma, en tres o cuatro palabras -------------
    'labels.ruleType.daily_rest_between_shifts': 'descanso entre turnos',
    'labels.ruleType.weekly_rest_hours': 'descanso semanal',
    'labels.ruleType.max_daily_ordinary_hours': 'horas ordinarias al día',
    'labels.ruleType.weekly_ordinary_hours_average': 'horas semanales, en promedio',
    'labels.ruleType.annual_ordinary_hours': 'horas ordinarias al año',
    'labels.ruleType.night_work_window_start': 'la noche empieza',
    'labels.ruleType.night_work_window_end': 'la noche acaba',
    'labels.ruleType.night_work_daily_average_max': 'jornada del trabajador nocturno',
    'labels.ruleType.night_worker_no_overtime': 'sin horas extra de noche',
    'labels.ruleType.night_premium': 'plus de nocturnidad',
    'labels.ruleType.annual_overtime_cap': 'horas extra al año',
    'labels.ruleType.no_statutory_overtime_premium': 'sin recargo legal por hora extra',
    'labels.ruleType.annual_leave_days': 'vacaciones',
    'labels.ruleType.time_record_retention_years': 'registro horario guardado',
    'labels.ruleType.minimum_wage': 'salario mínimo',

    // --- La unidad en que se cuenta el umbral -----------------------------
    'labels.ruleUnit.hours': 'h',
    'labels.ruleUnit.hour_of_day': 'h',
    'labels.ruleUnit.calendar_days': 'días naturales',
    'labels.ruleUnit.years': 'años',
    'labels.ruleUnit.percent': '%',
    'labels.ruleUnit.eur_per_hour': '€/h',

    // --- Por qué cada norma dice lo que dice ------------------------------
    'labels.laborNote.ES.daily_rest_between_shifts':
      'Art. 34.3 ET: al menos 12 horas entre el final de un turno y el principio del siguiente. Doce, no las once de la directiva europea (2003/88/CE art. 3) — España mejora el mínimo, y un cuadrante hecho con la cifra europea se queda aquí una hora corto.',
    'labels.laborNote.ES.weekly_rest_hours':
      'Art. 37.1 ET: día y medio ininterrumpido cada semana — 36 horas, normalmente la tarde del sábado o la mañana del lunes más el domingo. Se puede acumular en periodos de hasta 14 días, que es como la hostelería libra fines de semana alternos.',
    'labels.laborNote.ES.max_daily_ordinary_hours':
      'Art. 34.3 ET: no más de 9 horas ordinarias al día salvo que un convenio colectivo pacte otra distribución (suele hacerlo, y las 12 horas de descanso entre jornadas siguen valiendo diga lo que diga). Los menores de 18 no pueden pasar nunca de 8, y eso no lo negocia ningún convenio.',
    'labels.laborNote.ES.weekly_ordinary_hours_average':
      'Art. 34.1 ET: 40 horas semanales de trabajo efectivo EN PROMEDIO ANUAL. No es un techo semanal: una semana de 45 horas es legal si el año sale a la media. Hasta un 10% del año puede distribuirse de forma irregular, avisando con 5 días (art. 34.2).',
    'labels.laborNote.ES.night_work_window_start':
      'Art. 36.1 ET: es trabajo nocturno el que cae entre las 22:00 y las 06:00. La misma franja que la app ya usaba para el plus.',
    'labels.laborNote.ES.night_work_window_end':
      'Art. 36.1 ET: el otro extremo de la franja nocturna que empieza a las 22:00.',
    'labels.laborNote.ES.night_work_daily_average_max':
      'Art. 36.1 ET: la jornada de un trabajador nocturno no puede pasar de 8 horas de media en 15 días. Trabajador nocturno es quien normalmente hace 3 horas o más de su jornada de noche, o un tercio de su año. Esto es lo que hace que el turno de cierre de diez horas de un bar sea ilegal como costumbre, no como excepción.',
    'labels.laborNote.ES.night_worker_no_overtime':
      'Art. 36.1 ET: los trabajadores nocturnos no pueden hacer horas extra, salvo las excepciones que enumera el artículo (cambios de turno, fuerza mayor). Así que un turno de noche no se puede alargar para tapar un hueco.',
    'labels.laborNote.ES.annual_overtime_cap':
      'Art. 35.2 ET: 80 horas extra al año por persona, y las compensadas con descanso dentro de 4 meses no cuentan para ese tope. Las horas extra son voluntarias salvo que el contrato o el convenio digan otra cosa.',
    'labels.laborNote.ES.no_statutory_overtime_premium':
      'Art. 35.1 ET: una hora extra se paga AL MENOS como una ordinaria, o se compensa con descanso equivalente dentro de 4 meses. No hay un 1,5x por ley. El recargo que haya sale del convenio o del contrato.',
    'labels.laborNote.ES.annual_leave_days':
      'Art. 38 ET: 30 días naturales al año, nunca sustituibles por dinero mientras el contrato siga vivo.',
    'labels.laborNote.ES.time_record_retention_years':
      'Art. 34.9 ET (RDL 8/2019): hay que registrar cada día la hora de entrada y de salida de cada trabajador y guardarlo 4 años, a disposición del trabajador, de sus representantes y de la Inspección de Trabajo. Un cuadrante publicado no es un registro: lo que se guarda tiene que ser lo que pasó de verdad.',
    'labels.laborNote.ES.minimum_wage':
      'SMI 2026 (RD de 24 de febrero de 2026): 1.221 € al mes en 14 pagas = 17.094 € al año a jornada completa. Se da por hora sobre el año teórico de 2.080 horas (40 × 52) para que sea un suelo absoluto por debajo del cual no cae nadie; un convenio con menos horas al año sube la cifra por hora. El suelo REAL de una persona es la línea de su categoría en la tabla salarial del convenio.',
    'labels.laborNote.ES-CT-HOSTELERIA.annual_ordinary_hours':
      'Art. 28 del convenio: 1.783 horas de trabajo efectivo al año para 2026, 2027 y 2028 — ocho menos que las 1.791 anteriores, y equivalentes a las 40 horas semanales del Estatuto promediadas en el año. Esto, y no ninguna cifra semanal, es lo que tiene que sumar el cuadrante de un año.',
    'labels.laborNote.ES-CT-HOSTELERIA.night_premium':
      'Las horas entre las 22:00 y las 06:00 llevan un plus de nocturnidad del 25%. El Estatuto (art. 36.2 ET) exige una retribución específica por el trabajo nocturno pero no pone cifra; esta es la del convenio.',
    'labels.laborNote.ES-CT-HOSTELERIA.annual_leave_days':
      'Un día por encima de los 30 del Estatuto: el convenio 2025-2028 subió las vacaciones a 31 días naturales.',
    'labels.laborNote.ES-CT-HOSTELERIA.minimum_wage':
      'El SMI repartido sobre el año de este convenio: 17.094 € / 1.783 h = 9,59 €/h. Un suelo absoluto, no lo que se debe: la tabla salarial (Anexo II.A para Barcelona) pone más para todas las categorías, y es la que hay que mirar para un contrato.',
    'labels.laborNote.ES-CT-COMERCIO.annual_ordinary_hours':
      'Lo fija el convenio de rama (comercio del metal, textil, alimentación…), no un único convenio de comercio para la ciudad: son distintos, y los textos 2025-2027 bajan hacia cifras de unas 1.768 h a ritmos diferentes. Pon la de tu propio convenio.',
    'labels.laborNote.ES-CT-COMERCIO.minimum_wage':
      'El SMI es el suelo en todas partes (1.221 € al mes en 14 pagas en 2026); la tabla salarial de tu rama está por encima y es con la que se comprueba un contrato. Pon la de la categoría que vayas a contratar.',
    'labels.laborNote.ES-CT-COMERCIO.night_premium':
      'El art. 36.2 ET exige una retribución específica por el trabajo nocturno y no pone cifra; en comercio la pone el convenio de rama, y muchas tiendas no trabajan de noche nunca. Pon el tuyo si te aplica.',
  },
};
