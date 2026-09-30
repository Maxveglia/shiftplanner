# 02 · Un turno de 22:00 a 06:00 cuenta 8 h y aparece en los dos días
- de: skill reglas-de-turnos
- clase: mixto
- brief: 4

## Entrada
«Marta trabaja el lunes de 22:00 a 06:00. ¿Cuántas horas se le pagan, a qué día pertenecen y
dónde tiene que verla el encargado en el calendario? El martes por la mañana no la veo.»

## Comportamiento esperado
Son 8 h pagadas (`1320 → 1800 min = 480 min`), no 16 ni 2, y el turno se archiva bajo el lunes
(el día en que empieza). En el calendario aparece en los dos días: de 22:00 a 24:00 el lunes y
de 00:00 a 06:00 el martes. Lo primero ya se cumple; lo segundo no, porque la vista de día lo
pinta entero bajo el lunes: es un hueco conocido.

## Checks
- Empieza con «Skill: reglas-de-turnos».
- Da 8 h con la cuenta hecha y dice que el turno es del lunes (semana del lunes) aunque sus
  últimas 6 h caigan en martes.
- Dice que tiene que verse también el martes de 00:00 a 06:00, y que hoy no se ve: localiza
  la causa en `segmentsForDay` / `dayTrack` (`frontend/src/components/schedule/dayTrack.ts`),
  que dibuja el turno una sola vez bajo el día en que empieza.
- Nombra la contradicción: `dayTrack.test.ts` exige hoy lo contrario («draws a shift that runs
  past midnight whole, under the day it started», l. 119, espera el martes vacío; también
  «leaves last night out of tonight, instead of drawing it twice», l. 176, y el bloque «a late
  night followed by an ordinary day», l. 215). Max decidió que manda el brief: cerrar el hueco
  obliga a cambiar esos tests en el mismo PR, y hasta entonces no se tocan.
- Menciona que la nómina también atribuye el turno entero al día de inicio (`payroll.ts`),
  que no cambia las 8 h pero sí qué plus de fin de semana cobra.
- Lo trata como HUECO CONOCIDO y no toca código de la app.
- Tests de este caso:
  - `frontend/src/lib/schedule/overnightShift.test.ts`: pasan «is read back as eight paid
    hours, under the night it starts on» y «is paid as eight hours, once». (`payroll.test.ts:54`
    ya paga un turno nocturno, pero escribe las 8 h a mano; este test las saca de los
    instantes del servidor.)
  - `frontend/src/components/schedule/overnightBothDays.test.ts`: hueco conocido «also appears
    on the next day, from 00:00 to 06:00» (`knownGap`).

```check
# Las 8 h: ya se cumple.
cd frontend && SP_EVALS=1 npx vitest run src/lib/schedule/overnightShift.test.ts
```

```check
# Los dos días: hueco conocido (dayTrack.test.ts:119 exige lo contrario).
# El fichero entero y no -t: un -t que no casa con ningún test sale con 0 y pasaría en silencio.
cd frontend && SP_EVALS=1 npx vitest run src/components/schedule/overnightBothDays.test.ts
```
