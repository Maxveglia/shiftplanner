# Reglas de turnos · referencia

Mapa de dónde vive cada cosa (origin/main b315b60, 24-sep-2026). Las rutas son desde la
raíz del repo; los números de línea son aproximados.

## Espejos TypeScript ↔ Python

Si tocas una columna, abre la otra y pásales el mismo caso.

| Qué | Navegador (`frontend/src/…`) | Servidor (`backend/app/…`) |
|---|---|---|
| Juez de la ley sobre los turnos (`rest`, `daily_hours`, `weekly_rest`, `night_average`) | `lib/schedule/validate.ts` `validateSchedule` (la fuente de verdad) | `services/rota_law.py` `judge_shifts` (portado de validate.ts, solo observa) |
| Ley del año si se publica (80 h, complementarias, pacto, 10 %, preaviso) | — (solo se muestra) | `routers/workday.py` `law_if_published` + `services/workday.py` |
| Inicio de semana | `lib/schedule/generate.ts` `startOfWeek` (lo usan `weekKey`, `weekDays`, `payPeriod.ts`); **`weekStartAbs` ~L1047 sigue en domingo** | `services/workday.py` `week_start` (lunes) |
| Horas de la semana de una persona | `lib/schedule/weekHours.ts` `weekHoursFor` (duración con pausa incluida) | `services/workday.py` `classify_week` |
| Horas que «debe» cada uno (mes / trimestre / año) | `lib/schedule/projectedBalance.ts` | `services/workday.py` `period_balance`, `agreed_year_hours_between`, `_share_of_years` |
| Contrato de referencia | `generate.ts` `contractedHours` (máx. si lo hay, si no el mín.), `weeklyCeiling` | `services/workday.py` `_terms`, `expected_annual_hours`; `services/contracts.py` |
| Nómina y pluses | `lib/schedule/payroll.ts` `computePayroll` (turno entero al día de inicio) | reparto anual en `services/workday.py` (no coinciden: deuda conocida) |
| Límites legales (los números) | llegan en el spec; `lib/schedule/jurisdiction.ts` | `services/labour_floor.py` `floor_for` ← tabla `compliance_rule` ← `seeds/labor.py` |
| Del brief al spec | `lib/schedule/spec.ts` (parser local) | `services/intake.py` `brief_to_spec` |
| Retoques hablados | `lib/schedule/refine.ts` `applyOps` | `services/refine_intake.py` (`CalendarPlan`, `RosterPlan`) |
| Validación estructural al guardar/publicar | `refine.ts` (fuera de periodo), `handEdits.ts` | `services/schedule.py` `validate_shifts` (`shift_ends_before_start`, `shift_outside_period`) |
| Hora del negocio | la del navegador (`api/workday.ts` `localIso`) | `services/business_time.py` `BUSINESS_ZONE = Europe/Madrid` (solo lo que compone el servidor) |

Solo en el navegador (sin espejo): cobertura (`coverage.ts` `peopleAt`, `demand.ts`
`coverageMinute`/`needAt`), el generador voraz (`generate.ts` `generateSchedule`), el
reparto de libres (`restDays.ts`), el reintento (`planRetry.ts`), la reparación
(`repair.ts`), el dibujo del día (`components/schedule/dayTrack.ts`).

## Tests de las siete reglas (huecos conocidos incluidos)

Añadidos con la PR del bucle de aprendizaje. Los que llevan `knownGap` / `@known_gap`
describen lo que la app aún no cumple: pasan en CI como fallo esperado y fallan de verdad
con `SP_EVALS=1`.

| Regla | Test |
|---|---|
| 1 · inicio = fin es error | `frontend/src/lib/schedule/zeroLengthShift.test.ts`, `backend/tests/test_same_start_and_end_is_an_error.py` |
| 4 · 22–06 son 8 h y en los dos días | `frontend/src/lib/schedule/overnightShift.test.ts` (las 8 h), `frontend/src/components/schedule/overnightBothDays.test.ts` (los dos días) |
| 5 · cobertura sin huecos dentro de la hora | `frontend/src/lib/schedule/coverageWithinHour.test.ts` |
| 6 · nadie pasa de su contrato semanal | `frontend/src/lib/schedule/contractHoursCap.test.ts` |
| 7 · todo turno tiene puesto | `frontend/src/lib/schedule/shiftPost.test.ts` |

Para ver el estado real de todos: `cd <wt>/frontend && SP_EVALS=1 npx vitest run <ficheros>`.

## Tests por tema

| Tema | Frontend (`frontend/src/…`) | Backend (`backend/tests/…`) |
|---|---|---|
| Ley española | `lib/schedule/spanishRules.test.ts`, `labourFloor.test.ts` | `test_spanish_labour.py`, `test_rota_law.py`, `test_publish_obeys_the_law.py` |
| Noches y medianoche | `lib/schedule/night.test.ts`, `nightCoverage.test.ts`, `components/schedule/dayTrack.test.ts` | `test_overnight_hours.py` |
| Cobertura | `lib/schedule/coverage.test.ts`, `demand.test.ts`, `placeShift.test.ts` | — |
| Contrato y extras | `lib/schedule/generate.test.ts`, `contractFirst.test.ts`, `ordinaryWeek.test.ts`, `weekHours.test.ts` | `test_overtime_over_contract.py`, `test_contract_hours_year.py` |
| Año y saldos | `lib/schedule/projectedBalance.test.ts` | `test_annual_workday.py`, `test_hours_balance_cycle.py`, `test_balance_arithmetic.py`, `test_workday_endpoint.py` |
| Descanso semanal y libres | `lib/schedule/restDays.test.ts`, `lastDayOfWeek.test.ts`, `validate.test.ts` | `test_rota_law.py` |
| Calidad del generador | `lib/schedule/rotaBench.test.ts` (`ROTA_BENCH=1`), `objective.identity.test.ts`, `objective.profiles.test.ts` | — |

## Cómo reproducir sin API

- Generador: `generateSchedule` con las fábricas de `src/test/factories.ts` (`employee`,
  `contract`, `spec`, `days`) y el spec del bar (17:00→27:00, finde →28:00, `minStaff 2`,
  reglas de España). Ejemplo vivo: `restDays.test.ts`.
- Demostrar que un arreglo arregla algo: copia el test nuevo a un worktree de `origin/main`
  y comprueba que allí falla.
- Regenerar fixtures (`objective.*.fixture.json`, `rotaBench.fixture.json`) solo imprimiendo
  una tabla viejo→nuevo por escenario y leyéndola. Regenerar a ciegas es taparse los ojos.
- Fixtures de semana: empiezan en LUNES (`days('2026-03-02', 7)`); una semana que empieza en
  domingo ya no es una semana.

## Deuda conocida que roza estas reglas (sin arreglar al 24-sep-2026)

- `workday.py` ~L1050 cuenta lo debido desde `week_start(year_start)`: en 2026 todos salen
  con −17 h.
- `set_base_hours` (`services/contracts.py`) solo sube el `max`; la cifra efectiva es
  `max ?? min`: bajar horas de contrato no baja las horas.
- El DEFAULT de columna `organization.jurisdiction_code` sigue siendo `'US-FED'`, con suelo
  vacío: el juez aprobaría en silencio.
- La siembra se salta perfiles existentes (`seeds/labor.py`): editar las reglas no cambia
  producción. Compruébalo con `SELECT rule_type FROM compliance_rule`.
- Horas de la noche de la nómina: ventana fija 22–06; el generador usa `spec.nightWindow`.
- El generador trata un multiplicador de extras NO dicho como 1,5 (`overtimeMultiplier`).
