import type { MessageModule } from './types';

// Enum labels: the words the product uses for a value the SERVER stores as a
// code. `active`, `non_exempt_hourly`, `past_due` are wire values and never
// change; only the way they are written to a human does.
//
// Kept apart from the screens that show them because the same status appears in
// the employee list, the detail page and the back office, and it must read the
// same in all three.

export const labels: MessageModule = {
  en: {
    'labels.employmentStatus.active': 'Active',
    'labels.employmentStatus.onboarding': 'Onboarding',
    'labels.employmentStatus.on_leave': 'On leave',
    'labels.employmentStatus.resigned': 'Resigned',

    'labels.employmentType.exempt_salaried': 'Exempt (salaried)',
    'labels.employmentType.non_exempt_hourly': 'Non-exempt (hourly)',
    'labels.employmentType.non_exempt_salaried': 'Non-exempt (salaried)',

    'labels.absenceStatus.requested': 'Requested',
    'labels.absenceStatus.approved': 'Approved',
    'labels.absenceStatus.rejected': 'Rejected',
    'labels.absenceStatus.cancelled': 'Cancelled',

    'labels.movementType.accrual': 'Accrual',
    'labels.movementType.consumption': 'Consumption',
    'labels.movementType.adjustment': 'Adjustment',
    'labels.movementType.carryover': 'Carryover',
    'labels.movementType.expiration': 'Expiration',

    // Rows, not enums -- see `absenceTypeLabel` / `shiftTemplateLabel` in
    // format.ts. These are the words for the absence types and shift templates
    // WE seed into every new org; a row a manager wrote is never looked up here
    // and is shown exactly as he typed it.
    'labels.absenceType.VAC': 'Vacation',
    'labels.absenceType.PERS': 'Personal',
    'labels.absenceType.SICK': 'Sick',
    'labels.absenceType.UNPAID': 'Unpaid',

    // The same words the calendar's own time bands use, so a shift from the
    // seeded evening template and a synthesised evening shift read alike.
    'labels.shiftTemplate.morning': 'Morning',
    'labels.shiftTemplate.evening': 'Evening',
    'labels.shiftTemplate.night': 'Night',

    // The industries a manager can say their business is. Enums, not rows: the
    // codes are a closed list in `app/services/business_profile.py` and the
    // labels beside them there are English constants nobody translates. A code
    // this dictionary does not know keeps the server's own word -- see
    // `verticalLabel` in format.ts.
    'labels.vertical.bar': 'Bar / pub',
    'labels.vertical.restaurant': 'Restaurant',
    'labels.vertical.cafe': 'Cafe / bakery',
    'labels.vertical.retail': 'Retail shop',
    'labels.vertical.grocery': 'Grocery / supermarket',
    'labels.vertical.clinic': 'Clinic / pharmacy',
    'labels.vertical.hotel': 'Hotel',
    'labels.vertical.gym': 'Gym / studio',
    'labels.vertical.office': 'Office / services',
    'labels.vertical.other': 'Something else',

    // --- What a business of this kind typically does ----------------------
    // Offered, never applied: the manager turns one into a rule by writing it
    // in the brief. One key per sentence, unique across every vertical.
    'labels.suggestion.closing_cover':
      'More people in the last two hours than the rest of the day',
    'labels.suggestion.weekend_peak':
      'Friday and Saturday evenings busier than weeknights',
    'labels.suggestion.two_services':
      'Two service peaks (lunch and dinner) rather than flat cover',
    'labels.suggestion.split_shifts':
      'Let one person cover both services (a split day)',
    'labels.suggestion.opening_cover':
      'More people in the first two hours than the rest of the day',
    'labels.suggestion.restock_cover':
      'More people in the first two hours (restocking)',
    'labels.suggestion.saturday_peak': 'Saturday afternoon busier than weekdays',
    'labels.suggestion.steady_cover': 'Flat cover across the day rather than peaks',
    'labels.suggestion.night_skeleton': 'A smaller overnight team than the day shifts',
    'labels.suggestion.double_peak': 'Busy early morning and evening, quiet midday',

    // --- The one line on a holiday ledger that we write, not the manager ---
    'labels.ledgerReason.absenceApproved': 'Time off approved',

    'labels.payPeriod.weekly': 'Weekly',
    'labels.payPeriod.biweekly': 'Every two weeks',
    'labels.payPeriod.monthly': 'Monthly',

    'labels.payPeriodCadence.weekly': 'You are paid every week',
    'labels.payPeriodCadence.biweekly': 'You are paid every two weeks',
    'labels.payPeriodCadence.monthly': 'You are paid once a month',

    'labels.payPeriodCadenceShort.weekly': 'every week',
    'labels.payPeriodCadenceShort.biweekly': 'every two weeks',
    'labels.payPeriodCadenceShort.monthly': 'once a month',

    'labels.plan.trial': 'Trial',
    'labels.plan.starter': 'Starter',
    'labels.plan.growth': 'Growth',
    'labels.plan.scale': 'Scale',

    // 'active' reads as "Paying" everywhere on purpose: the operator's question
    // is who pays, and "active" is easy to misread as "logged in lately".
    'labels.subscriptionStatus.trialing': 'Trialing',
    'labels.subscriptionStatus.active': 'Paying',
    'labels.subscriptionStatus.past_due': 'Past due',
    'labels.subscriptionStatus.canceled': 'Canceled',
  },
  es: {
    'labels.employmentStatus.active': 'En activo',
    'labels.employmentStatus.onboarding': 'Incorporándose',
    'labels.employmentStatus.on_leave': 'De baja',
    'labels.employmentStatus.resigned': 'Ha causado baja',

    // "Exento" is the FLSA term and the product prices under FLSA, so it is
    // kept rather than translated into a Spanish labour-law category that would
    // mean something different.
    'labels.employmentType.exempt_salaried': 'Exento (sueldo fijo)',
    'labels.employmentType.non_exempt_hourly': 'No exento (por horas)',
    'labels.employmentType.non_exempt_salaried': 'No exento (sueldo fijo)',

    'labels.absenceStatus.requested': 'Solicitada',
    'labels.absenceStatus.approved': 'Aprobada',
    'labels.absenceStatus.rejected': 'Rechazada',
    'labels.absenceStatus.cancelled': 'Cancelada',

    'labels.movementType.accrual': 'Devengo',
    'labels.movementType.consumption': 'Consumo',
    'labels.movementType.adjustment': 'Ajuste',
    'labels.movementType.carryover': 'Traspaso',
    'labels.movementType.expiration': 'Caducidad',

    'labels.absenceType.VAC': 'Vacaciones',
    'labels.absenceType.PERS': 'Asuntos propios',
    'labels.absenceType.SICK': 'Baja médica',
    'labels.absenceType.UNPAID': 'Sin sueldo',

    // 'evening' is "Tarde-noche" and not "Tarde" on purpose: it is the same
    // stretch of the day `domain.band.evening` names, and the two labels sit
    // next to each other in the calendar.
    'labels.shiftTemplate.morning': 'Mañana',
    'labels.shiftTemplate.evening': 'Tarde-noche',
    'labels.shiftTemplate.night': 'Noche',

    'labels.vertical.bar': 'Bar / pub',
    'labels.vertical.restaurant': 'Restaurante',
    'labels.vertical.cafe': 'Cafetería / panadería',
    'labels.vertical.retail': 'Tienda',
    'labels.vertical.grocery': 'Supermercado / alimentación',
    'labels.vertical.clinic': 'Clínica / farmacia',
    'labels.vertical.hotel': 'Hotel',
    'labels.vertical.gym': 'Gimnasio / estudio',
    'labels.vertical.office': 'Oficina / servicios',
    'labels.vertical.other': 'Otra cosa',

    // --- Lo que suele hacer un negocio de este tipo ------------------------
    'labels.suggestion.closing_cover':
      'Más gente en las dos últimas horas que en el resto del día',
    'labels.suggestion.weekend_peak':
      'Viernes y sábados por la noche más fuertes que entre semana',
    'labels.suggestion.two_services':
      'Dos picos de servicio (comida y cena) en vez de cobertura plana',
    'labels.suggestion.split_shifts':
      'Que alguien pueda cubrir los dos servicios (jornada partida)',
    'labels.suggestion.opening_cover':
      'Más gente en las dos primeras horas que en el resto del día',
    'labels.suggestion.restock_cover':
      'Más gente en las dos primeras horas (reposición)',
    'labels.suggestion.saturday_peak': 'El sábado por la tarde más fuerte que entre semana',
    'labels.suggestion.steady_cover': 'Cobertura plana todo el día, sin picos',
    'labels.suggestion.night_skeleton': 'Un equipo de noche más pequeño que el de día',
    'labels.suggestion.double_peak': 'Fuerte a primera hora y por la tarde, flojo a mediodía',

    // --- La única línea del saldo de vacaciones que escribimos nosotros ----
    'labels.ledgerReason.absenceApproved': 'Ausencia aprobada',

    'labels.payPeriod.weekly': 'Semanal',
    'labels.payPeriod.biweekly': 'Cada dos semanas',
    'labels.payPeriod.monthly': 'Mensual',

    'labels.payPeriodCadence.weekly': 'Cobras todas las semanas',
    'labels.payPeriodCadence.biweekly': 'Cobras cada dos semanas',
    'labels.payPeriodCadence.monthly': 'Cobras una vez al mes',

    'labels.payPeriodCadenceShort.weekly': 'todas las semanas',
    'labels.payPeriodCadenceShort.biweekly': 'cada dos semanas',
    'labels.payPeriodCadenceShort.monthly': 'una vez al mes',

    'labels.plan.trial': 'Prueba',
    'labels.plan.starter': 'Starter',
    'labels.plan.growth': 'Growth',
    'labels.plan.scale': 'Scale',

    'labels.subscriptionStatus.trialing': 'En prueba',
    'labels.subscriptionStatus.active': 'Pagando',
    'labels.subscriptionStatus.past_due': 'Impagada',
    'labels.subscriptionStatus.canceled': 'Cancelada',
  },
};
