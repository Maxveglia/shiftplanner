# 01 · Un turno que empieza y acaba a la misma hora es un error, no 24 h
- de: skill reglas-de-turnos
- clase: mixto
- brief: 1

## Entrada
«Un cliente ha creado en Ajustes una plantilla "Mañana" de 09:00 a 09:00 y dice que el
calendario le sale raro. ¿Qué tendría que hacer la app con eso y qué hace hoy?»

## Comportamiento esperado
09:00–09:00 es un error de duración cero (la segunda casilla rellenada antes de tiempo) y se
rechaza en todas las puertas; nunca se lee como un turno de 24 h. 22:00–06:00 sigue siendo una
noche legítima: la regla es «inicio igual a fin», no «fin antes que inicio». Hoy la plantilla
se guarda, el generador la usa y `add_coverage` coloca turnos de 24 h: es un hueco conocido y
no se arregla sin que Max lo pida.

## Checks
- Empieza con «Skill: reglas-de-turnos».
- Dice que 09:00–09:00 es un error y no 24 h, y separa el caso de 22:00–06:00 (8 h, válido):
  un arreglo que rechace `end <= start` rompería las noches.
- Dice dónde se cuela hoy, con fichero: `backend/app/schemas/shift_template.py`
  (`ShiftTemplateCreate` no compara las horas; también el formulario de plantillas),
  `frontend/src/lib/schedule/generate.ts` `candidateShifts` (`if (end <= start) end += 24 * 60`)
  y `refine.ts` `add_coverage` (misma cuenta, sin tope de duración).
- Explica lo que se ve hoy: en una tienda de 09:00 a 17:00 los 7 turnos de la semana salen de
  esa plantilla, recortados a 09:00–17:00 y con aspecto normal; y «una persona más de 9 a 9» por
  `add_coverage` coloca un turno de 24 h pagadas.
- Dice qué ya lo rechaza: publicar (`validate_shifts` en `backend/app/services/schedule.py`,
  código `shift_ends_before_start`, porque los dos instantes son iguales), las propuestas del
  modelo (`zero_length` en `proposal.ts`, test «rejects a shift that ends when it starts» de
  `validate.proposal.test.ts`) y `add_shift`/`move_shift`, pero solo por «más de 16 h», no por
  ser iguales.
- Lo trata como HUECO CONOCIDO, cita los tests marcados y no toca código de la app.
- Tests de este caso:
  - `backend/tests/test_same_start_and_end_is_an_error.py`: pasan
    `test_a_shift_that_ends_the_minute_it_starts_is_refused_by_name`,
    `test_a_night_that_ends_the_next_morning_is_still_published` y
    `test_a_template_that_runs_past_midnight_is_accepted`; hueco conocido
    `test_a_template_that_starts_when_it_ends_is_refused` (`@known_gap`).
  - `frontend/src/lib/schedule/zeroLengthShift.test.ts`: hueco conocido «a template that starts
    when it ends › is never cut into a shift by the generator» y «asking for cover from nine to
    nine › is refused rather than placed as a 24-hour shift» (`knownGap`).
  - Sin contradicción con tests existentes. Guarda de las noches que ya existía:
    `dayShape.test.ts:109` (una plantilla 18:00–02:00 se usa).

```check
# Backend, sin BD: publicar ya lo rechaza; la plantilla todavía no (known_gap).
cd backend && SP_EVALS=1 "$SP_PY" -m pytest -q -p no:cacheprovider tests/test_same_start_and_end_is_an_error.py
```

```check
# Frontend: el generador usa la plantilla y add_coverage coloca 24 h (los dos, knownGap).
# El fichero entero y no -t: un -t que no casa con ningún test sale con 0 y pasaría en silencio.
cd frontend && SP_EVALS=1 npx vitest run src/lib/schedule/zeroLengthShift.test.ts
```
