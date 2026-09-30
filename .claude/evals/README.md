# Evals de skills y agentes

Dos niveles:

1. **`run.sh`**: corre la suite del proyecto (pytest con Postgres, `tsc`, vitest)
   y después los bloques `check` de cada caso. Escribe
   `results/{fecha}.json` (ignorado por git). Es barato y determinista.
2. **Casos de comportamiento**: lo que no se puede comprobar con un comando lo
   evalúa un subagente por caso (paso 4 de `.claude/routine/weekly-tuning.md`):
   recibe la skill o el agente, la entrada del caso y los criterios, y dice
   pasa/falla con su porqué.

## Estructura

```
.claude/evals/
  run.sh
  {skill-o-agente}/cases/NN-slug.md
  results/                 # generado, fuera de git
```

`{skill-o-agente}` es exactamente el nombre de `.claude/skills/{nombre}/` o de
`.claude/agents/{nombre}.md`.

## Formato de un caso

````markdown
# 03 · Turno 22:00–06:00 cuenta 8 h y aparece en ambos días
- de: skill reglas-de-turnos        (o: agente verificador-ui)
- clase: comando | comportamiento | mixto
- brief: 4                          (número del caso del brief original, si viene de ahí)

## Entrada
Lo que recibe la skill o el agente: la petición, el dato o el diff.

## Comportamiento esperado
Qué debe hacer o qué debe ser verdad, en una o dos frases.

## Checks
- Criterio verificable 1 (concreto: qué se mira y qué valor debe dar).
- Criterio verificable 2.

```check
cd frontend && SP_EVALS=1 npx vitest run src/lib/schedule/overnight.eval.test.ts
```
````

Reglas:

- **Bloques `check`**: bash, se ejecutan desde la raíz del repo con `set -euo pipefail`
  y un límite de 300 s. Salida 0 = pasa. Puede haber varios: todos deben pasar.
  Variables disponibles: `SP_EVALS=1`, `SP_PY` (python del backend), y
  `ADMIN_DATABASE_URL`/`APP_DATABASE_URL` si `run.sh` tiene base de datos.
  Si el check necesita Postgres y no hay, que salga con código 77: `run.sh` lo
  anota como `sin_bd`, no como falla.
- Un caso **sin** bloque `check` es de clase `comportamiento`: `run.sh` lo anota
  como `pendiente` y lo evalúa un subagente.
- Los checks de comportamiento que sí se pueden comprobar en estático (que la
  skill contenga una instrucción, que un componente tenga `role="tablist"`) van
  como `check` con `grep`: sirven para detectar que un cambio de la routine
  borró una regla que funcionaba.

## Huecos conocidos (`known gap`)

Cuando un caso describe algo que la app **aún no** cumple, su test entra en la
suite del proyecto como fallo esperado para no poner el CI en rojo:

- vitest: `knownGap('...', () => { ... })` de `src/test/knownGap.ts`
  (es `it.fails` en CI, e `it` normal con `SP_EVALS=1`).
- pytest: `@known_gap("motivo")` de `tests/known_gap.py`
  (es `xfail(strict=True)` en CI, y un test normal con `SP_EVALS=1`).

Así el CI sigue verde, el `check` del caso (que corre con `SP_EVALS=1`) marca
«falla» mientras el hueco exista, y el día que la app lo cumpla el CI se pone
rojo y obliga a quitar la marca: el hueco no se cierra en silencio.
