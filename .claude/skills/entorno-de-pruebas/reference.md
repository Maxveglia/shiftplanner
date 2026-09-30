# Entorno de pruebas · referencia

Detalle que solo hace falta a veces. Lo habitual está en `SKILL.md`.

## Qué hay en la máquina (24-sep-2026)

- Postgres 16 de Homebrew. Superusuarios: `postgres` y el usuario del sistema. Rol
  `app_user` (NOSUPERUSER, contraseña local `app_pass`) ya creado. En localhost la
  contraseña de `postgres` no se comprueba.
- Ya no está «parado por defecto»: a veces corre como servicio de `brew services`. Por eso
  se mira con `pg_isready` y solo se para si lo arrancaste tú.
- Bases que NO son tuyas: `shiftplanner` (la de Max, esquema atrasado) y las de otras
  sesiones (`shiftplanner_audit`, `_annual`, `_munich`, `_swipe`, `_sec1`…).
- `docker` no está en el PATH: el `Makefile` asume `docker compose`, no hace falta.
- Chromium de Playwright ya descargado: ver la skill `ui-movil-y-accesible`.

## Por qué se salta o falla cada cosa

| Síntoma | Causa | Arreglo |
|---|---|---|
| ~90+ skipped, «No Postgres reachable» | Postgres parado o inalcanzable | paso 4 |
| cientos de errores `UndefinedColumn` | pytest fue a `shiftplanner` (sin variables) | paso 5 |
| 11 skipped de `test_intake_schema_contract` | sin `ANTHROPIC_API_KEY` | normal; paso 8 si tocas un esquema |
| el script «no reproduce» un arreglo | `import app` cargó BASE por el `.venv` editable | paso 3 |
| `ImportError` / «Cannot find module» | la rama trae una dependencia nueva | instalar en el worktree |
| `permission denied for table …` con `app_user` | la base se creó sin los GRANT | paso 4 (el `sed` + `psql`) |

`test_tenant_isolation.py` y compañía comprueban si Postgres responde (`SELECT 1` por
`app_engine`) y se saltan si no. Si responde pero la base es la equivocada, no se saltan:
fallan. Por eso hay dos síntomas distintos para el mismo olvido.

## La siembra de perfiles laborales

`python -m app.seeds.labor` crea los perfiles `ES`, `ES-CT-HOSTELERIA` y `ES-CT-COMERCIO`
(el contenedor lo hace en cada arranque). Por qué va en el paso 5 aunque el CI no siembre:

- La suite ENTERA en el orden del CI pasa sin sembrar, porque algún test anterior siembra
  por el camino.
- Un SUBCONJUNTO en una base nueva, no: `tests/test_rota_law.py` solo, sin sembrar, dio 12
  fallos falsos («Spain is seeded in this database»); sembrada, 73 passed (24-sep-2026).
- La app en local sin sembrar no tiene reglas de España.

Receta completa de backend + frontend + capturas: skill `ui-movil-y-accesible`.

## Fechas leídas directamente en Postgres

El Postgres local tiene `TimeZone = America/Phoenix` aunque el Mac esté en Madrid. Antes de
leer un `timestamptz` en `psql`, fija la zona: `SET TimeZone = 'Europe/Madrid';` (o
`'UTC'`). En producción, agrupa por la zona del navegador que guardó las filas (skill
`reglas-de-turnos`, «Hora y zona»).

## Git bloqueado por la licencia de Xcode (pasó el 17-sep-2026, resuelto)

Compruébalo primero con `git --version`. Si responde con «You have not agreed to the Xcode
license agreements», falla todo binario de las Command Line Tools (`git`, `python3` del
sistema). Lo arregla Max con `! sudo xcodebuild -license accept`: pídeselo.

Mientras tanto:

- Python usable: `~/conductor/repos/manager-opt/backend/.venv/bin/python`.
- ¿Está BASE al día? `cat .git/refs/heads/main` frente a
  `gh api repos/Maxveglia/manager-opt/commits/main --jq .sha`, y
  `gh api repos/Maxveglia/manager-opt/compare/<local>...<remoto> --jq .ahead_by`.
- Copia de trabajo sin git: `rsync -a --exclude node_modules --exclude .git` al scratchpad
  y `ln -s` al `node_modules` de BASE.
- `gh pr create` y `gh pr merge` invocan git por debajo y NO sirven. `gh api` sí: blobs
  (`POST git/blobs`), tree con `base_tree`, commit, ref, `POST pulls`, `PUT pulls/<n>/merge`.
  Antes de construir el tree, compara el hash de blob de cada fichero propio con el árbol
  de main (`gh api repos/.../git/trees/<sha>?recursive=1`): `compare` lista ficheros que
  cambiaron y volvieron, y no basta.
