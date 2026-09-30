---
name: entorno-de-pruebas
description: Preparar dónde trabajar en ShiftPlanner (repo Maxveglia/manager-opt) y correr su suite sin que mienta. Úsala SIEMPRE al empezar cualquier tarea en manager-opt, antes de leer código, ramificar o crear un worktree, y cada vez que vayas a correr pytest, alembic, vitest o tsc, a levantar Postgres o a encargar tests a un subagente. Úsala también cuando pytest salga con muchos «skipped», con una cascada de UndefinedColumn / «column ... does not exist», cuando un script «no reproduce» lo que debería, o cuando dudes de si tu copia está al día con origin/main. Solo para ShiftPlanner; no aplica a Tracky ni a VegliaStrips.
---

Al usar esta skill, dilo al principio de tu respuesta: «Skill: entorno-de-pruebas».

# Entorno de pruebas de ShiftPlanner

Aquí es fácil trabajar sobre código viejo y que los tests salgan verdes sin probar nada.
Sigue los pasos en orden. Cada llamada a Bash es una shell nueva (`export` no sobrevive):
escribe rutas y nombres literales en cada comando.

`BASE` = `~/conductor/repos/manager-opt` (repo raíz de Conductor, vinculado a Railway).

**Atajo (ramas desde el 28-sep-2026):** `<wt>/.claude/bin/sp-test -C <wt> prep|back|front|tsc|todo|limpiar`
hace los pasos 3 a 7 y 9 solo — base propia por worktree, variables en el comando, trampa del
`.venv` comprobada — e imprime un resumen de ~5 líneas con `VALE: sí|NO` y el log crudo
aparte. `sp-test -C <wt> bd` dice el nombre de tu base. Lo de abajo es lo que hace por dentro, y
la receta para ramas sin `.claude/bin/`. Para no llenar el contexto, skill `contexto-ligero`.

## 1. Ponte al día antes de leer nada

```bash
git -C ~/conductor/repos/manager-opt fetch origin
git -C ~/conductor/repos/manager-opt log --oneline -3 origin/main
```

El `main` local de BASE casi nunca está al día (llegó a ir 80 commits por detrás y se
planificó una funcionalidad que ya existía). Lee y ramifica siempre desde `origin/main`.

## 2. Trabaja en un worktree tuyo, en el scratchpad

BASE lo usan varias sesiones a la vez y tiene cambios y un stash de Max que no son tuyos.
En BASE solo se hace: `git fetch`, `git worktree add/remove`, comandos `railway` y leer.
Nunca `checkout`, `checkout -b`, `commit`, `stash` ni `stash pop` ahí.

```bash
git -C ~/conductor/repos/manager-opt worktree add -b <rama> <scratchpad>/<wt> origin/main
ln -s ~/conductor/repos/manager-opt/frontend/node_modules <scratchpad>/<wt>/frontend/node_modules
ln -s ~/conductor/repos/manager-opt/backend/.venv <scratchpad>/<wt>/backend/.venv
```

- `git stash` es común a todos los worktrees: no lo uses. Para apartar trabajo, commit WIP
  en tu rama. El stash «WIP renombrado de empleados» es de Max: no lo apliques ni lo borres.
- El `node_modules` de BASE se queda viejo (el 28-sep era del 3-sep y le faltaban
  `barcode-detector` y `zxing-wasm`): con el enlace, vitest dio «1881 passed» en verde con un
  fichero entero sin cargar (22 tests fuera) y tsc 3 errores. `sp-test prep` lo comprueba
  contra el `package.json` y, si falta algo, cambia el enlace por un `npm ci` en el worktree.
- Si falta un módulo (tsc: «Cannot find module», pytest: `ImportError`), tu rama trae una
  dependencia que los symlinks no tienen. Instala en el worktree (quita el symlink y haz
  `npm ci`, o un venv propio con `pip install -e ".[dev]"`); no toques los de BASE.
- Si `git` responde con la licencia de Xcode, mira `reference.md` (rodeo por `gh api`).

## 3. La trampa del `.venv` enlazado

El `.venv` tiene el backend instalado en modo editable apuntando a BASE. Según desde
dónde lances Python, `import app` carga tu rama o el código de BASE:

```bash
cd <wt>/backend && .venv/bin/python -c "import app; print(app.__file__)"   # <wt>/backend/app  (bien)
cd <wt> && backend/.venv/bin/python -c "import app; print(app.__file__)"   # BASE/backend/app  (MAL)
```

- pytest y alembic: siempre desde `<wt>/backend`, como `.venv/bin/python -m pytest` y
  `.venv/bin/alembic`.
- Scripts sueltos: `cd <wt>/backend && PYTHONPATH=. .venv/bin/python <script>.py`, y que el
  script imprima `app.__file__` antes de creerte el resultado. «No reproduce» con código
  viejo ya pasó.

## 4. Postgres: una base propia por worktree

Postgres 16 de Homebrew. Mira primero si ya está en marcha: `pg_isready -h localhost -p 5432`.

- Responde «aceptando conexiones» → ya estaba en marcha: al final NO lo pares.
- No responde → arráncalo y apunta que lo arrancaste tú:
  `/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D /opt/homebrew/var/postgresql@16 -l <scratchpad>/pg.log start`

Crea tu base con los GRANT de `infra/initdb/01-app-role.sql` (el mismo fichero que usa el
CI; crea `app_user` si falta):

```bash
createdb -U postgres -h localhost shiftplanner_<wt>
sed "s/ON DATABASE shiftplanner /ON DATABASE shiftplanner_<wt> /" <wt>/infra/initdb/01-app-role.sql | psql -U postgres -h localhost -d shiftplanner_<wt> -v ON_ERROR_STOP=1 -q
```

No uses `shiftplanner` a secas ni la base de otra sesión (`shiftplanner_audit`,
`_munich`…): `shiftplanner` tiene el esquema atrasado y el resto no son tuyas.

**Servidores locales: el puerto también tiene dueño.** Antes de levantar uvicorn o vite, y
antes de cualquier script que siembre o escriba por HTTP (`localhost:8000`…), mira quién
escucha y desde qué carpeta:

```bash
lsof -nP -iTCP:8000 -iTCP:5173 -sTCP:LISTEN
lsof -a -d cwd -p <pid>          # su directorio: ¿es <wt>?
```

- Si el proceso no sale de TU worktree (otra sesión, o un vite tuyo de una rama anterior),
  ese puerto no es tuyo: un script que siembra por ahí escribe en la base de otra sesión
  (25-sep), y un vite viejo en 5173 te enseña la rama anterior como si fuera la nueva.
- No lo mates si no lo arrancaste tú: levanta los tuyos en puertos propios (`--port 8011`,
  `vite --port 5183 --strictPort`, con `VITE_API_BASE_URL` y `CORS_ORIGINS` a juego;
  receta en `ui-movil-y-accesible/reference.md`) y pasa ese puerto explícito a tus scripts.
- Los que arrancaste tú en una rama anterior, páralos antes de abrir el worktree nuevo.

## 5. Migrar, sembrar y correr pytest con las dos variables EN el comando

```bash
cd <wt>/backend && ADMIN_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/shiftplanner_<wt> APP_DATABASE_URL=postgresql+psycopg://app_user:app_pass@localhost:5432/shiftplanner_<wt> .venv/bin/alembic upgrade head
cd <wt>/backend && ADMIN_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/shiftplanner_<wt> APP_DATABASE_URL=postgresql+psycopg://app_user:app_pass@localhost:5432/shiftplanner_<wt> .venv/bin/python -m app.seeds.labor
cd <wt>/backend && ADMIN_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/shiftplanner_<wt> APP_DATABASE_URL=postgresql+psycopg://app_user:app_pass@localhost:5432/shiftplanner_<wt> .venv/bin/python -m pytest -q -rs
```

Siembra siempre tras migrar una base nueva. La suite entera pasa sin sembrar (algunos
tests siembran por el camino), pero un subconjunto no: `tests/test_rota_law.py` solo, en
base nueva, da 12 fallos falsos («Spain is seeded in this database»).

Sin las variables, pytest cae en la base `shiftplanner`: con Postgres en marcha da una
cascada de fallos falsos (232 el 21-sep-2026); con Postgres parado, ~93 tests se saltan
en silencio y todo parece verde (una vez salieron 96 skipped). Las dos son mentira.

**Al encargar tests a un subagente**, pégale el comando entero de arriba, con las dos
variables y el `cd` al backend de tu worktree. No le mandes «sigue la receta»: el 21-sep
un agente fue a `shiftplanner` sin variables.

## 6. ¿El resultado vale o miente?

Referencia (28-sep-2026, base sembrada): **2065 passed, 11 skipped, 1 xfailed** en
~2–5 min según la carga. Los passed crecen con cada PR; los skipped no deberían: los 11 son
`test_intake_schema_contract.py`, que pide `ANTHROPIC_API_KEY`.

- Más de ~11 skipped, o un SKIPPED que no sea de ese fichero → **no vale**: falta la base
  o las variables. Comprueba que esto sale vacío:
  `... pytest -q -rs | grep SKIPPED | grep -v intake_schema_contract`
- Cascada de `UndefinedColumn` / «column ... does not exist» → es la base, no tu diff.
- `xfailed` son huecos conocidos (`@known_gap`), esperados. Un `XPASS(strict)` que falla
  es un hueco que alguien cerró: quita la marca (skill `reglas-de-turnos`).
- Nunca digas «tests en verde» sin dar los tres números: passed, skipped, failed.
- **Un test en rojo no se toca para que pase.** Si contradice lo que se pide, PARA,
  identifícalo y explica por qué. No talles el código para pasar el test ni lo marques
  skip/xfail/`known_gap`, y no modifiques los tests que ya existen en main (el hook
  `proteger-tests` pide el OK de Max; también para quitar un `@known_gap`). Si no se puede
  sin trampa, responde `BLOQUEADO: <test> contradice <requisito>`.
- Tabla de síntomas y causas: `reference.md`.

## 7. Frontend

```bash
cd <wt>/frontend && npx tsc --noEmit
cd <wt>/frontend && npx vitest run
```

- Vitest corre en `node`, sin DOM, a propósito (`vitest.config.ts`).
- Fallo de idioma solo en CI: reprodúcelo con `LANG=C LC_ALL=C npx vitest run`.
- Fechas y horas: repite con `TZ=Europe/Madrid npx vitest run <fichero>`.
- No pases prettier: el repo no lo usa y reformatea ficheros enteros.

## 8. Contra la API real: solo si tocas un esquema

Solo cuando cambies un esquema de salida estructurada (intake, refine, plan, triage,
entrevista): corre `test_intake_schema_contract.py` UNA vez con la clave de producción,
sin imprimirla:

```bash
cd ~/conductor/repos/manager-opt && railway run --service shiftplanner -- sh -c 'cd <wt>/backend && .venv/bin/python -m pytest -q tests/test_intake_schema_contract.py'
```

- Solo ese fichero: `railway run` inyecta todas las variables de producción.
- El `cd` al backend del worktree no es opcional: sin él mide el esquema viejo de BASE.
- Nada de mediciones en bucle: es la misma clave de producción y del CI, y el saldo ya se
  vació. `credit balance is too low` es saldo, no tu esquema: avisa a Max.

## 9. Al terminar

```bash
dropdb -U postgres -h localhost shiftplanner_<wt>
/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D /opt/homebrew/var/postgresql@16 stop   # SOLO si lo arrancaste tú
git -C ~/conductor/repos/manager-opt worktree remove <scratchpad>/<wt>                # cuando la rama ya esté empujada
```

Las bases huérfanas de otras sesiones no son tuyas: menciónalas a Max, no las borres.
