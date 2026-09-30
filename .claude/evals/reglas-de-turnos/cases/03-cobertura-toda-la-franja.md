# 03 · La cobertura mínima de personas se cumple en toda la franja de apertura
- de: skill reglas-de-turnos
- clase: mixto
- brief: 5

## Entrada
«La tienda abre de 9 a 17 y siempre tiene que haber una persona. Ana entra a las 9 y se va a
las 13:15; Bruno llega a las 13:45 y cierra. El calendario dice que está todo cubierto.
¿Lo está?»

## Comportamiento esperado
No lo está: de 13:15 a 13:45 no hay nadie y la app tiene que avisarlo. La cobertura se cuenta
en PERSONAS distintas (dos turnos solapados de la misma persona son una) y en toda la franja
de apertura, no en un minuto por hora. Lo de personas ya se cumple; lo de toda la franja no:
es un hueco conocido.

## Checks
- Empieza con «Skill: reglas-de-turnos».
- Responde que no está cubierto y señala el hueco de 13:15 a 13:45.
- Explica por qué la app dice lo contrario: la cobertura se pregunta un minuto por hora
  (`coverageMinute` en `frontend/src/lib/schedule/demand.ts`, `peopleAtHour` en
  `coverage.ts`); a las 13:00 está Ana y a las 14:00 Bruno, así que la hora 13 sale cubierta.
- Dice que la cobertura cuenta personas distintas y no turnos (`peopleAt` en `coverage.ts`,
  única definición desde la PR #97) y que eso ya funciona.
- Si propone un arreglo, nota que `CoverageGap` hoy es por hora (`hour`) y que el mismo
  muestreo lo usan el validador, el generador y la tira de cobertura de `DayGrid`.
- Lo trata como HUECO CONOCIDO y no toca código de la app.
- Tests de este caso:
  - `frontend/src/lib/schedule/coverageWithinHour.test.ts`: pasa «reports nothing when the
    handover is clean» (09:00–13:00 y 13:00–17:00, sin huecos); hueco conocido «reports the
    half hour nobody is there, even inside one hour» (`knownGap`).
  - Ya cubiertos, no duplicados: personas y no turnos en `coverage.test.ts:28` («counts one
    person with two shifts on top of each other as ONE»); un calendario generado cubre cada
    hora de apertura en `generate.test.ts:154`.
  - Sin contradicción con tests existentes (ninguno afirma que un hueco dentro de la hora esté
    cubierto; `generate.test.ts:154` también muestrea a la hora en punto).

```check
# Personas distintas, no turnos: ya se cumple.
cd frontend && SP_EVALS=1 npx vitest run src/lib/schedule/coverage.test.ts
```

```check
# Toda la franja, también dentro de una hora: hueco conocido.
# El fichero entero y no -t: un -t que no casa con ningún test sale con 0 y pasaría en silencio.
cd frontend && SP_EVALS=1 npx vitest run src/lib/schedule/coverageWithinHour.test.ts
```
