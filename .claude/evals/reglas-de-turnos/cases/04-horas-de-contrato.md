# 04 · Nadie supera sus horas semanales de contrato; si no cabe, se avisa
- de: skill reglas-de-turnos
- clase: mixto
- brief: 6

## Entrada
«Lucía tiene contrato de 20 h semanales y es la única de la tienda, que necesita a alguien de
9 a 17 de lunes a viernes. Genero dos semanas. ¿Cuántas horas le tocan y qué me dice la app de
las que faltan?»

## Comportamiento esperado
Lucía no pasa de 20 h en ninguna semana, y las horas que no caben en su contrato aparecen como
aviso explícito (huecos de cobertura), no absorbidas en silencio. Hoy pasa lo contrario: desde
la PR #102 el contrato es un objetivo y no un techo, Lucía hace 37,5 h cada semana, no sale
ningún hueco y lo único que queda son las `extraHours` de cada turno (una etiqueta «extra» en
la barra y el detalle en su `title`). Es un hueco conocido y choca con una decisión anterior
de Max: cerrarlo es decisión suya.

## Checks
- Empieza con «Skill: reglas-de-turnos».
- Dice que la regla es que el contrato semanal es un techo y que lo que no cabe se avisa.
- Dice qué hace hoy con números: 37,5 h por semana, 0 huecos, 17,5 h por semana marcadas
  `extraHours`, que en `DayGrid` son una etiqueta «extra» en la barra (si cabe) y «… por
  encima del contrato» en su `title`; `ScheduleResult` no tiene campo de avisos, así que nada
  lo dice a nivel de calendario.
- Localiza la causa: `weeklyCeiling` en `frontend/src/lib/schedule/generate.ts` (el máximo de
  `maxHoursPerWeek`, el contrato y el mínimo: 40 h aquí) y `extraBeyondContract`; distingue el
  tope semanal del brief (`maxHoursPerWeek`), que sí muerde y deja huecos
  (`generate.test.ts:210`), del contrato de cada persona, que no.
- No lo confunde con la jornada española: con `weeklyAverageHours` el validador ni juzga la
  semana (`validate.ts`), y las extras son otra pregunta (la mayor de semana y año).
- Nombra la contradicción: `generate.test.ts:312` («marks the hours past the stated number as
  beyond contract») exige que un contrato de 20 h reciba MÁS de 20. Choca también con la #115
  («las horas de más, a los de contrato más bajo»). No se toca hasta que Max lo decida.
- Lo trata como HUECO CONOCIDO y no toca código de la app.
- Tests de este caso:
  - `frontend/src/lib/schedule/contractHoursCap.test.ts`: hueco conocido «is never given more
    than 20 hours in any week» y «reports the hours no contract could cover, instead of
    absorbing them» (los dos `knownGap`; el segundo porque hoy no hay ningún aviso a nivel de
    calendario, solo `extraHours` por turno).

```check
# Techo semanal de contrato y aviso de lo que no cabe: los dos, hueco conocido.
# El fichero entero y no -t: un -t que no casa con ningún test sale con 0 y pasaría en silencio.
cd frontend && SP_EVALS=1 npx vitest run src/lib/schedule/contractHoursCap.test.ts
```
