// Text produced by the pure modules behind the calendar and the roster:
// `lib/schedule/{calendar,availability,persist}.ts` and `lib/roster/*`.
//
// These are not components -- they are functions that build a sentence and
// hand it to a component to paint. They translate through `translate()` at
// call time, never at module load, so the language switch reaches them too.

import type { MessageModule } from './types';

export const roster: MessageModule = {
  en: {
    // Calendar folders (lib/schedule/calendar.ts)
    'roster.calendar.week': 'Week {n}',

    // Why somebody cannot work a day (lib/schedule/availability.ts)
    'roster.availability.startsOn': 'Starts {date}',
    'roster.availability.noContract': 'No active contract',
    'roster.availability.contractStarts': 'Contract starts {date}',
    'roster.availability.contractEnded': 'Contract ended {date}',
    'roster.availability.timeOff': 'Time off',
    'roster.availability.requested': '{type} requested',

    // A shift whose template no longer exists (lib/schedule/persist.ts)
    'roster.shift.untitled': 'Shift',

    // The plan the brief proposes for the team (lib/roster/reconcile.ts)
    'roster.plan.placeholderName': 'New hire {n}',
    'roster.plan.terms.hoursPerWeek': '{hours}h/wk',
    'roster.plan.terms.minHoursPerWeek': '{hours}h/wk min',
    'roster.plan.terms.hourlyRate': '€{rate}/h',
    'roster.plan.terms.annualSalary': '€{amount}/yr',
    'roster.plan.terms.nightPremium': 'night premium {pct}%',
    'roster.plan.terms.noNightPremium': 'no night premium',
    'roster.plan.terms.nightInSalary': 'night work included in the salary',
    'roster.plan.terms.weekendPremium': 'weekend premium {pct}%',
    'roster.plan.terms.overtimeMultiplier': 'overtime ×{mult}',
    'roster.plan.terms.premiumsFollowBusiness': 'premiums as the business',
    'roster.plan.change.status': 'status → {status}',
    'roster.plan.change.contract': 'contract → {contract}',
    'roster.plan.reason.named': 'Named in the brief',
    'roster.plan.reason.namedNoTerms':
      'Named in the brief — terms not stated, so hourly with no weekly minimum',
    'roster.plan.reason.fromBrief': 'From the brief ({terms})',
    'roster.plan.reason.headcount': 'Headcount from the brief',
    'roster.plan.reason.notMentioned': 'Not mentioned in the brief',

    // What was written, or not, when the manager talks to the roster
    // (lib/roster/ops.ts)
    'roster.ops.added': 'Added {name} to the roster',
    'roster.ops.renamed': 'Renamed {from} to {to}',
    'roster.ops.termsUpdated': "Updated {name}'s terms",
    'roster.ops.termsUpdatedWith': "Updated {name}'s terms: {terms}",
    'roster.ops.statusChanged': '{name} → {status}',
    'roster.ops.statusAlready': '{name}’s status is already “{status}”.',
    'roster.ops.noMatch': 'No one on the roster matches “{ref}”.',
    'roster.ops.saveFailed': 'Could not save that roster change ({op}).',
    'roster.ops.op.addEmployee': 'add employee',
    'roster.ops.op.renameEmployee': 'rename employee',
    'roster.ops.op.setEmployeeTerms': 'set employee terms',
    'roster.ops.op.setEmployeeStatus': 'set employee status',
    'roster.ops.op.addAbsence': 'record time off',
    'roster.ops.absenceAdded.one': '{name} is off on {from}',
    'roster.ops.absenceAdded.range': '{name} is off from {from} to {to}',

    // The one question worth stopping a manager for (AbsenceKindModal.tsx).
    'roster.absenceKind.title': 'What kind of time off is this?',
    'roster.absenceKind.forOne': '{name}, on {from}',
    'roster.absenceKind.forRange': '{name}, from {from} to {to}',
    'roster.absenceKind.why':
      'The calendar looks the same either way. This decides whether those hours are paid.',
    'roster.absenceKind.paid': 'Paid',
    'roster.absenceKind.unpaid': 'Unpaid',
    'roster.absenceKind.consumesBalance': 'comes off their holiday balance',
    'roster.absenceKind.recoverable': 'worked back later',
    'roster.absenceKind.save': 'Save',
    'roster.absenceKind.cancel': 'Cancel',
    'roster.absenceKind.noTypes':
      'This business has no types of time off set up, so there is nothing to record this as.',
    'roster.absenceKind.more.one': 'One more to go.',
    'roster.absenceKind.more.other': '{count} more to go.',
  },
  es: {
    // Calendar folders (lib/schedule/calendar.ts)
    'roster.calendar.week': 'Semana {n}',

    // Why somebody cannot work a day (lib/schedule/availability.ts)
    'roster.availability.startsOn': 'Empieza el {date}',
    'roster.availability.noContract': 'Sin contrato en vigor',
    'roster.availability.contractStarts': 'El contrato empieza el {date}',
    'roster.availability.contractEnded': 'El contrato terminó el {date}',
    'roster.availability.timeOff': 'Ausencia',
    'roster.availability.requested': '{type} pendiente de aprobar',

    // A shift whose template no longer exists (lib/schedule/persist.ts)
    'roster.shift.untitled': 'Turno',

    // The plan the brief proposes for the team (lib/roster/reconcile.ts)
    'roster.plan.placeholderName': 'Nueva incorporación {n}',
    'roster.plan.terms.hoursPerWeek': '{hours} h/sem',
    'roster.plan.terms.minHoursPerWeek': 'mín. {hours} h/sem',
    'roster.plan.terms.hourlyRate': '{rate} €/h',
    'roster.plan.terms.annualSalary': '{amount} €/año',
    'roster.plan.terms.nightPremium': 'nocturnidad {pct} %',
    'roster.plan.terms.noNightPremium': 'sin plus de nocturnidad',
    'roster.plan.terms.nightInSalary': 'nocturnidad incluida en el sueldo',
    'roster.plan.terms.weekendPremium': 'plus de fin de semana {pct} %',
    'roster.plan.terms.overtimeMultiplier': 'extras ×{mult}',
    'roster.plan.terms.premiumsFollowBusiness': 'pluses como el negocio',
    'roster.plan.change.status': 'estado → {status}',
    'roster.plan.change.contract': 'contrato → {contract}',
    'roster.plan.reason.named': 'Aparece por su nombre en el brief',
    'roster.plan.reason.namedNoTerms':
      'Aparece por su nombre en el brief — sin condiciones indicadas, así que por horas y sin mínimo semanal',
    'roster.plan.reason.fromBrief': 'Del brief ({terms})',
    'roster.plan.reason.headcount': 'Plantilla indicada en el brief',
    'roster.plan.reason.notMentioned': 'No aparece en el brief',

    // What was written, or not, when the manager talks to the roster
    // (lib/roster/ops.ts)
    'roster.ops.added': 'Se ha añadido a {name} a la plantilla',
    'roster.ops.renamed': '{from} ahora se llama {to}',
    'roster.ops.termsUpdated': 'Condiciones de {name} actualizadas',
    'roster.ops.termsUpdatedWith': 'Condiciones de {name} actualizadas: {terms}',
    'roster.ops.statusChanged': '{name} → {status}',
    'roster.ops.statusAlready': 'El estado de {name} ya es «{status}».',
    'roster.ops.noMatch': 'Nadie de la plantilla coincide con «{ref}».',
    'roster.ops.saveFailed':
      'No se ha podido guardar ese cambio de plantilla ({op}).',
    'roster.ops.op.addEmployee': 'alta de empleado',
    'roster.ops.op.renameEmployee': 'cambio de nombre',
    'roster.ops.op.setEmployeeTerms': 'cambio de condiciones',
    'roster.ops.op.setEmployeeStatus': 'cambio de estado',
    'roster.ops.op.addAbsence': 'registro de ausencia',
    'roster.ops.absenceAdded.one': '{name} no trabaja el {from}',
    'roster.ops.absenceAdded.range': '{name} no trabaja del {from} al {to}',

    // La única pregunta por la que merece la pena parar (AbsenceKindModal.tsx).
    'roster.absenceKind.title': '¿Qué tipo de ausencia es?',
    'roster.absenceKind.forOne': '{name}, el {from}',
    'roster.absenceKind.forRange': '{name}, del {from} al {to}',
    'roster.absenceKind.why':
      'El calendario queda igual de las dos formas. Esto decide si esas horas se pagan.',
    'roster.absenceKind.paid': 'Retribuida',
    'roster.absenceKind.unpaid': 'Sin sueldo',
    'roster.absenceKind.consumesBalance': 'descuenta de sus vacaciones',
    'roster.absenceKind.recoverable': 'se recuperan después',
    'roster.absenceKind.save': 'Guardar',
    'roster.absenceKind.cancel': 'Cancelar',
    'roster.absenceKind.noTypes':
      'Este negocio no tiene tipos de ausencia configurados, así que no hay dónde registrarla.',
    'roster.absenceKind.more.one': 'Queda una más por decidir.',
    'roster.absenceKind.more.other': 'Quedan {count} más por decidir.',
  },
};
