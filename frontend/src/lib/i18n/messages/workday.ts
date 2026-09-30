// The working year: the screen that reads a rota by the year rather than the
// week (art. 34 ET).
//
// The wording carries a burden the numbers cannot. A manager looking at "+12h"
// needs to know whether that is a problem, and under an annual average it is
// usually not one -- it is somebody running ahead, who will take a shorter week
// later. So the balance is named as a position rather than as a verdict
// ("ahead"/"behind", "por delante"/"por detrás"), and only the findings are
// written as breaches.
//
// The Spanish is the original here, not a translation. These are Spanish legal
// concepts and the terms are fixed by the Estatuto: "distribución irregular",
// "preaviso", "horas extraordinarias", "horas complementarias". The English is
// what explains them to somebody reading the same screen in English.
//
// ONE CONVENTION, AFTER A BUG THAT WAS ON SCREEN FOR MONTHS. `formatHours`
// already writes the unit -- it returns "23,2h", not "23,2" -- and five of
// these strings added another " h" on top, so the screen said "23,2h h por
// detrás" and "1h h complementarias". The rule now, for every string in this
// module:
//
//   a value passed through `formatHours` or `signedHours` brings its own "h",
//   and the sentence must NOT add one;
//
//   a bare number (a contracted week, an annual total, a cap) is written with
//   its unit here, because nothing has formatted it.
//
// Both kinds appear below. Which one a placeholder is can be read off the call
// site in one line, and the two must never be mixed in a single string.

import type { MessageModule } from './types';

export const workday: MessageModule = {
  en: {
    'workday.title': 'Working year',
    'workday.view': 'Working year',
    'workday.subtitle':
      'The contracted week as an annual average ({hours} h/week), not a weekly ceiling.',
    'workday.subtitle.weekly':
      'The contracted week as a weekly ceiling. No annual average applies here.',
    'workday.period.range': 'Measured from {from} to {to}',
    'workday.since': 'Nothing before {date} counts: it is the first rota published.',

    // --- What the law allows, folded away ------------------------------
    // Context, not the reading. It used to sit in three grey lines above the
    // table, where it competed with the figures for the same glance.
    'workday.law.summary': 'What the law allows',
    'workday.annualHours': 'A full year is {hours} h',
    'workday.irregular':
      'Up to {pct}% of the year may be distributed irregularly, with {days} days of notice',
    'workday.overtimeCap':
      'Up to {hours} extra hours a year, {months} months to give them back instead',

    // --- One row per person --------------------------------------------
    'workday.col.employee': 'Employee',
    'workday.col.contract': 'Contract',
    'workday.col.hours': 'Hours',
    'workday.col.hours.title':
      'Hours on the rota, against what the contract asks for over this period. That second figure comes from the annual one ({annual} h a year) spread over the days, so a month without anybody\u2019s holiday in it asks for slightly less than the contracted week times the weeks.',
    'workday.col.balance': 'Balance',
    'workday.col.overtime': 'Extra',
    'workday.col.errors': 'Findings',
    'workday.contract.weekly': '{hours} h/week',
    'workday.hours.tooltip':
      '{worked} worked of the {expected} this contract asks for over these dates',
    'workday.balance.tooltip':
      'Against what the contract asks for over these dates — not against the annual average',
    // The line under the balance. The SENTENCE itself is
    // `schedule.balances.pending`, borrowed from the planner's column so that
    // the same fact is worded once; this is only the tooltip, which says
    // "period" where the column says "stretch". `{hours}` arrives formatted,
    // unit included -- neither of them adds a second "h".
    'workday.pending.tooltip':
      'Measured to {date}, as far as the rota goes. The contract asks for {hours} more over the rest of this period, and nobody is on those hours yet.',
    'workday.row.expand': 'Show {name}’s weeks',
    'workday.row.collapse': 'Hide {name}’s weeks',
    'workday.weeks.title': 'Week by week',

    // The same column, named for what the LAW makes those hours. A
    // part-timer's extra hours are unlawful as such (art. 12.4.c), so the word
    // has to change with the contract and not just the number. And hours moved
    // under art. 34.2 are ordinary hours worked early: they explain a balance
    // rather than breaching anything, which is why they are said in grey.
    'workday.extra.overtime': '{hours} extra',
    'workday.extra.complementary': '{hours} complementary',
    'workday.extra.moved': '{hours} moved',
    'workday.extra.compensated': '{hours} of them already given back as rest',
    'workday.moved.tooltip':
      'Ordinary hours moved here (art. 34.2) — a shorter week owes them back',

    'workday.deviation.ahead': '{hours} ahead',
    'workday.deviation.behind': '{hours} behind',
    'workday.deviation.level': 'On pace',

    // --- The weeks underneath ------------------------------------------
    'workday.col.week': 'Week',
    'workday.col.weekHours': 'Hours',
    'workday.col.annual': 'Year to date',
    'workday.col.deviation': 'vs. annual pace',
    'workday.col.recovery': 'Recovery',
    'workday.col.moved': 'Moved',
    'workday.recovery.tooltip': 'Worked back against the day off of {date}',
    'workday.none': '—',
    'workday.empty': 'No hours scheduled in this period.',
    'workday.loading': 'Working out the year…',

    // --- Findings ------------------------------------------------------
    // One key per `rule` the server sends, said once per person however many
    // weeks it touched. Numbers are interpolated; the server never sends a
    // sentence.
    'workday.findings.count': '×{count}',
    'workday.findings.countTitle': 'Happened {count} times in this period',
    'workday.error.short_notice':
      'Announced {days} days ahead — {required} are owed (art. 34.2 ET)',
    // Dirty data, not a different rule: a shift entered after it was worked
    // sends a negative notice, and "announced −140 days ahead" is nonsense.
    'workday.error.short_notice_after':
      'Published after the shift had been worked — {required} days of notice are owed (art. 34.2 ET)',
    'workday.error.irregular_share_exceeded':
      '{moved} h moved around the year — the limit is {allowed} h ({pct}%)',
    'workday.error.overtime_cap_exceeded':
      '{worked} extra hours this year — {cap} is the limit (art. 35.2 ET). Hours given back as rest within four months do not count',
    'workday.error.complementary_without_pact':
      '{hours} h above a part-time contract with no written pact — none of them could be required (art. 12.5 ET)',
    'workday.error.complementary_contract_too_short':
      'A {weekly} h contract is under the {required} h a complementary-hours pact needs (art. 12.5.a ET) — {hours} h are above it',
    'workday.error.complementary_cap_exceeded':
      '{worked} complementary hours this year — the pact covers {allowed} (art. 12.5.c ET)',
    'workday.error.complementary_pact_above_statute':
      'The pact agrees {agreed}% of the contract as complementary hours; no agreement may go past {allowed}% (art. 12.5.c ET)',
    'workday.error.unknown': 'Breach of {rule}',
  },
  es: {
    'workday.title': 'Jornada anual',
    'workday.view': 'Jornada anual',
    'workday.subtitle':
      'La jornada contratada es un promedio anual ({hours} h/semana), no un tope semanal.',
    'workday.subtitle.weekly':
      'La jornada contratada es un tope semanal. Aquí no se aplica cómputo anual.',
    'workday.period.range': 'Medido del {from} al {to}',
    'workday.since':
      'Nada anterior al {date} cuenta: es el primer cuadrante publicado.',

    // --- Lo que permite la ley, recogido -------------------------------
    'workday.law.summary': 'Qué permite la ley',
    'workday.annualHours': 'El año completo son {hours} h',
    'workday.irregular':
      'Puede distribuirse irregularmente hasta el {pct}% de la jornada anual, con {days} días de preaviso',
    'workday.overtimeCap':
      'Hasta {hours} horas extraordinarias al año, con {months} meses para devolverlas como descanso',

    // --- Una fila por persona ------------------------------------------
    'workday.col.employee': 'Empleado',
    'workday.col.contract': 'Contrato',
    'workday.col.hours': 'Horas',
    'workday.col.hours.title':
      'Horas en el cuadrante, frente a lo que pide el contrato en este periodo. Esa segunda cifra sale de la jornada anual ({annual} h al a\u00f1o) repartida por d\u00edas, as\u00ed que un mes sin vacaciones de nadie pide algo menos que la jornada semanal por las semanas.',
    'workday.col.balance': 'Saldo',
    'workday.col.overtime': 'De más',
    'workday.col.errors': 'Incumplimientos',
    'workday.contract.weekly': '{hours} h/sem',
    'workday.hours.tooltip':
      '{worked} trabajadas de las {expected} que pide este contrato en estas fechas',
    'workday.balance.tooltip':
      'Frente a lo que pide el contrato en estas fechas, no frente al promedio anual',
    // La línea bajo el saldo. La frase es `schedule.balances.pending`, la
    // misma que usa la columna del planificador: un solo hecho, una sola
    // manera de decirlo. Esto es sólo el tooltip, que dice "periodo" donde la
    // columna dice "tramo". `{hours}` llega formateado, con su unidad.
    'workday.pending.tooltip':
      'Medido hasta el {date}, que es hasta donde llega el cuadrante. El contrato pide {hours} más en el resto del periodo, y todavía no hay nadie puesto en esas horas.',
    'workday.row.expand': 'Ver las semanas de {name}',
    'workday.row.collapse': 'Ocultar las semanas de {name}',
    'workday.weeks.title': 'Semana a semana',

    'workday.extra.overtime': '{hours} extraordinarias',
    'workday.extra.complementary': '{hours} complementarias',
    'workday.extra.moved': '{hours} movidas',
    'workday.extra.compensated': '{hours} ya devueltas como descanso',
    'workday.moved.tooltip':
      'Horas ordinarias trasladadas aquí (art. 34.2) — una semana más corta las devuelve',

    'workday.deviation.ahead': '{hours} por delante',
    'workday.deviation.behind': '{hours} por detrás',
    'workday.deviation.level': 'Al día',

    // --- Las semanas de debajo -----------------------------------------
    'workday.col.week': 'Semana',
    'workday.col.weekHours': 'Horas',
    'workday.col.annual': 'Acumulado del año',
    'workday.col.deviation': 'Frente al ritmo anual',
    'workday.col.recovery': 'Recuperación',
    'workday.col.moved': 'Movidas',
    'workday.recovery.tooltip': 'Recuperadas del día libre del {date}',
    'workday.none': '—',
    'workday.empty': 'No hay horas planificadas en este periodo.',
    'workday.loading': 'Calculando el año…',

    // --- Incumplimientos -----------------------------------------------
    'workday.findings.count': '×{count}',
    'workday.findings.countTitle': 'Ocurre {count} veces en este periodo',
    'workday.error.short_notice':
      'Comunicado con {days} días — se deben {required} (art. 34.2 ET)',
    'workday.error.short_notice_after':
      'Publicado después de trabajarse el turno — se deben {required} días de preaviso (art. 34.2 ET)',
    'workday.error.irregular_share_exceeded':
      '{moved} h distribuidas irregularmente — el límite es {allowed} h ({pct}%)',
    'workday.error.overtime_cap_exceeded':
      '{worked} horas extraordinarias este año — el tope es {cap} (art. 35.2 ET). Las compensadas con descanso en cuatro meses no cuentan',
    'workday.error.complementary_without_pact':
      '{hours} h por encima de un contrato a tiempo parcial sin pacto escrito — no se podía exigir ninguna (art. 12.5 ET)',
    'workday.error.complementary_contract_too_short':
      'Un contrato de {weekly} h no llega a las {required} h que exige el pacto de horas complementarias (art. 12.5.a ET) — hay {hours} h por encima',
    'workday.error.complementary_cap_exceeded':
      '{worked} horas complementarias este año — el pacto cubre {allowed} (art. 12.5.c ET)',
    'workday.error.complementary_pact_above_statute':
      'El pacto fija el {agreed}% del contrato como horas complementarias; ningún convenio puede pasar del {allowed}% (art. 12.5.c ET)',
    'workday.error.unknown': 'Incumplimiento de {rule}',
  },
};
