---
name: reglas-de-turnos
description: Contrato de dominio de ShiftPlanner (repo Maxveglia/manager-opt) — qué debe cumplir un turno y un calendario (inicio igual a fin, turnos de noche, cobertura de personas distintas, horas semanales de contrato, descansos, jornada anual española, zona horaria) y en qué fichero TypeScript o Python vive cada regla. Úsala antes de tocar o revisar generate.ts, validate.ts, demand.ts, coverage.ts, weekHours.ts, refine.ts, dayTrack.ts, rota_law.py, workday.py, labour_floor.py o schedule.py, y siempre que Max diga que las horas, las noches, la cobertura, las horas extra o los saldos salen mal («tiene mal las horas semanales», «cuenta como si hubiera dos personas», «le da 24 h a un contrato de 16 h»). Solo para ShiftPlanner.
---

Al usar esta skill, dilo al principio de tu respuesta: «Skill: reglas-de-turnos».

# Reglas de turnos de ShiftPlanner

Max ha corregido las horas una docena de veces. Casi nunca faltaba un test: fallaban dos
piezas que por separado estaban bien (navegador y servidor, semana y año, turno y
persona). Antes de tocar una cifra que ve el manager, busca dónde más se calcula; casi
siempre hay otro sitio. Mapa de ficheros y espejos TS↔Python: `reference.md`.

## Reglas

Son el brief de Max y el **objetivo del producto**: mandan aunque hoy la app no cumpla
alguna. El «Estado hoy» se verificó sobre origin/main b315b60 (24-sep-2026); vuelve a
comprobarlo con `grep` antes de citarlo, las líneas se mueven.

**1. Un turno con inicio igual a fin (09:00–09:00) es un error, nunca «24 h».**
Estado hoy: no se cumple. `generate.ts` (~L519, plantillas) y `refine.ts` `add_coverage`
(~L618) hacen `if (end <= start) end += 24 * 60` → turno de 24 h. `add_shift` y
`move_shift` lo convierten en 24 h y lo rechazan por «demasiado largo» (>16 h), no por
igual. El formulario de plantillas (`RequirementsPanel.tsx`, `onSubmit`) y
`schemas/shift_template.py` lo aceptan. El servidor solo rechaza instantes con
`end_at <= start_at` (`services/schedule.py` ~L270), que no llegan porque el cliente ya lo
hizo 24 h. El intake lo lee como «nada» (`tests/test_overnight_hours.py`).

**2. (UI)** La vista de día a 375 px no corta columnas → skill `ui-movil-y-accesible`.

**3. (UI)** Pestañas accesibles → skill `ui-movil-y-accesible`.

**4. Un turno 22:00–06:00 cuenta 8 h y aparece en ambos días.**
Estado hoy: a medias. La duración sí (fin < inicio → +24 h = 8 h). Pero se pinta solo bajo
el día en que empieza y `components/schedule/dayTrack.test.ts` lo exige («draws a shift
that runs past midnight whole, under the day it started», «does not draw it again on
Saturday»). `payroll.ts` también atribuye el turno entero al día de inicio: el plus del
sábado de un viernes 18:00–04:00 se pierde (deuda aparcada, cambia importes).

**5. Cobertura mínima de PERSONAS distintas (no turnos) en toda la franja de apertura, sin
huecos dentro de una hora.**
Estado hoy: personas sí — `coverage.ts` `peopleAt` cuenta empleados distintos y es la única
definición (DayGrid, validate y generate la importan; PR #97). Pero se mide UN minuto por
hora (`demand.ts` `coverageMinute`, `peopleAtHour`): un hueco de 21:30 a 21:45 no se ve, y
un turno que acaba a las 03:15 cubre la hora 03 entera.

**6. Nadie supera sus horas semanales de contrato; si no cabe, se avisa.**
Estado hoy: no. Desde las PR #102 y #115 el contrato es un objetivo, no un techo
(`generate.ts` ~L275 «a target, not a cage», `weeklyCeiling`); lo que pasa del contrato se
marca `extraHours` («beyond contract») y `generate.test.ts:312` exige que un contrato de
20 h reciba más de 20. Con jornada española (`weeklyAverageHours`) `validate.ts` (~L367)
ni juzga la semana. Choca con una decisión anterior de Max (#115: «las horas de más, a los
de contrato más bajo»): cerrarlo es decisión suya.

**7. Todo turno tiene puesto y el color nunca es la única señal.**
Estado hoy: no hay puestos ni habilidades; el «puesto» es el nombre de franja o plantilla
(`Assignment.templateName`), escrito en la barra si cabe. Las horas con plus de `DayGrid`
se distinguen solo por un tono (`PREMIUM_COLOR`, `aria-hidden`) y el dato vive solo en el
`title`. Receta de UI en `ui-movil-y-accesible`.

## Huecos conocidos: no se cierran por iniciativa propia

- Cada hueco tiene un test marcado (tabla por regla en `reference.md`): frontend
  `knownGap('…', () => …)` de `src/test/knownGap.ts`; backend `@known_gap("…")` de
  `tests/known_gap.py`. En CI son un fallo esperado; con `SP_EVALS=1` fallan de verdad.
- **No arregles un hueco conocido que no te han pedido**, aunque lo veas al pasar. Varios
  chocan con decisiones previas (regla 6 con #115, regla 4 con `dayTrack`). Díselo a Max
  en una línea y sigue con lo tuyo.
- Cuando Max lo pida y lo cierres: en el mismo PR cambia `knownGap` por `it` (o borra
  `@known_gap`) y actualiza el «Estado hoy» de aquí. Si no, CI se pone rojo: un `it.fails`
  o `xfail(strict)` que pasa es un fallo, a propósito.

## Otras reglas vigentes (España, perfil `ES-CT-HOSTELERIA`)

Los números viven en `compliance_rule` (siembra: `backend/app/seeds/labor.py`); llegan al
navegador dentro del spec y al servidor por `services/labour_floor.py`. Ningún motor lleva
su propia copia de un límite.

- **Semana de lunes a domingo**: `startOfWeek` (generate.ts), `week_start` (workday.py).
  Ojo: `generate.ts` ~L1047 `weekStartAbs` sigue anclado en domingo.
- **9 h** ordinarias al día · **12 h** entre turnos · **36 h** de descanso semanal, medidas
  hasta el turno vecino y no cortadas en el borde de la semana (PR #128).
- **Noche 22:00–06:00**; el trabajador nocturno promedia 8 h y no hace extras.
- **40 h de media ANUAL** (art. 34.1 ET): una semana larga no es infracción; se juzga el año.
- **Año de 1.783 h** (convenio). Las extras son la MAYOR de dos preguntas (¿esta semana pasó
  de su contrato? ¿lleva más de lo que su año contiene?), nunca la suma. Tope 80 h/año
  prorrateado.
- **Parciales**: nunca «horas extraordinarias» (art. 12.4.c); son complementarias y exigen
  pacto escrito (`contract.complementary_pct`; NULL = sin pacto, que no es cero).
- `min_rest = brief.min_rest_hours or statutory_rest or 11` (`intake.py` ~L849): hoy un
  brief puede bajar la ley. Pendiente de decidir.
- El juez del servidor (`rota_law.py`) solo observa: `PUBLISH_LAW_ENFORCED=false`. Lo que
  el manager edita a mano no pasa por `validateSchedule`.
- Orden del generador (decisión de Max): mandan las indicaciones del manager (personas por
  franja, peticiones sobre alguien); el coste solo desempata; noches y findes repartidos.
  Y todo ajuste configurable tiene que poder decírselo a la IA en la misma entrega.
- El estado del negocio (días cerrados, horario de apertura, reglas fijas) solo cambia por
  una orden explícita del manager. Lo que se deduce del lenguaje («viernes y sábados
  cerramos a las 3» NO dice que el resto de días esté cerrado) se propone como sugerencia
  sin confirmar o se pregunta; nunca se guarda (27-sep; mismo patrón que el tipo de
  negocio de Jev en f00b62f y «este sábado mínimo cuatro» en 6530b6f).

## Hora y zona

- Los turnos se guardan en la hora del NAVEGADOR que publicó; no hay zona por organización.
  El servidor compone correos en `Europe/Madrid` (`services/business_time.py`).
- La zona del Mac de Max cambia (Phoenix, Madrid…): `readlink /etc/localtime` antes de leer
  producción, y agrupa filas por la zona de quien las guardó.
- Todo lo que convierte un instante del navegador en fecha del servidor, pruébalo con
  `TZ=Europe/Madrid` (el «Mes» salía septiembre por un `toISOString`).
- Un formateador de fechas guardado en caché (`Intl.DateTimeFormat`, `toLocaleDateString`)
  lleva la zona en la clave, no solo el idioma: si no, un cambio de zona sin recargar
  pinta fechas con el día corrido (`YearGrid.tsx`, PR #177). Pruébalo cambiando `TZ`
  dentro del mismo test.
- `rota_law` usa un offset fijo por periodo: en la noche del cambio de hora puede no
  coincidir con el navegador.
- Leyendo `timestamptz` en `psql`, fija la zona primero (`SET TimeZone = 'UTC';` o
  `'Europe/Madrid'`): el Postgres local está en `America/Phoenix`.

## Dos motores que pueden divergir

La misma regla existe en TypeScript (lo que el manager ve y el generador) y en Python (lo
que el servidor juzga y los saldos). Si tocas uno, abre su espejo (tabla en `reference.md`)
y pásales el mismo caso: misma semana, mismos turnos, mismo contrato.

## Cómo verificar

```bash
cd <wt>/frontend && npx vitest run src/lib/schedule src/components/schedule
cd <wt>/frontend && TZ=Europe/Madrid npx vitest run src/lib/schedule
cd <wt>/frontend && ROTA_BENCH=1 npx vitest run src/lib/schedule/rotaBench.test.ts
```

Backend con base de datos, migrada y SEMBRADA (comando completo con las dos variables:
skill `entorno-de-pruebas`; sin `app.seeds.labor`, `test_rota_law.py` suelto falla en base
nueva): `tests/test_rota_law.py tests/test_spanish_labour.py
tests/test_annual_workday.py tests/test_overtime_over_contract.py
tests/test_overnight_hours.py tests/test_hours_balance_cycle.py`.

- El banco compara contra `origin/main` en otro worktree con el mismo comando, no contra
  `rotaBench.fixture.json` (está desfasado).
- Luego mira números de verdad: una plantilla realista (40 h, 20 h, 16 h, alguien corto),
  planificando el MES SIGUIENTE, cifra a cifra. Los «+159 h» y «−416 h» que vio Max salían
  con todos los tests en verde.
