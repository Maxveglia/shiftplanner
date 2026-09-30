# Contexto ligero · referencia

Detalle que solo hace falta a veces. Lo habitual está en `SKILL.md`.

## De dónde salen los números (28-sep-2026)

Análisis de los transcripts de `~/.claude/projects/-Users-maxveglia/` del 7 al 28-sep-2026:
54 sesiones principales que trabajaron en manager-opt y sus 378 subagentes. Tokens ≈
caracteres/3,5. Entraron al contexto 10,6M tokens en las principales (197k por sesión) y
36,8M en los subagentes (97k por agente); procesados en total (suma de `usage`), 2,7G y 3,0G.

- Bash es el 69 % de lo que devuelven las herramientas en el hilo principal y el 75 % en los
  subagentes; dentro de Bash, leer ficheros (`cat`, `sed -n`, `head`) es la familia mayor.
- Ficheros más leídos: `DashboardPage.tsx` (1.012 lecturas, 865k tokens), `generate.ts`,
  `routers/schedule.py`, `DashboardLayout.tsx`, `services/calendar_plan.py`.
- Relecturas: de 1.107 (principal) y 2.856 (subagentes), solo el 6 % y el 15 % repetían un
  tramo sin edición entre medias; el resto eran tramos nuevos del mismo fichero (buscar a
  trozos) o lecturas tras editar. Por eso el remedio es el índice, no prohibir releer.
- Diffs: solo el 5–6 % de los `git diff`/`git show` iban completos sin `--stat` ni ruta; el
  peso estaba en `git diff -- <fichero>` sin recortar en subagentes (266 llamadas, 815k).
- Tests: poco peso (~0,4M en total). `sp-test` se justifica más por no equivocarse de base
  que por el contexto.
- Contexto inicial de cada agente: ~50k, de los que ~21k son listados de skills, herramientas
  diferidas y MCP de plugins que este repo no usa. Eso se arregla en la configuración de
  usuario (plugins), no aquí.

## sp-outline

- Tramos exactos para TS/TSX (validados contra el compilador de TypeScript: 4.031 de 4.031) y
  para Python con `ast`. En Python 3.9 un fichero con sintaxis de 3.10+ (`match`) cae a un
  índice por sangría y lo avisa.
- El inicio es la línea de la declaración (o su primer decorador), no el comentario de
  encima: empieza a leer unas líneas antes si quieres el porqué.
- Bloques de más de 250 líneas (el componente `DashboardPage`) listan sus hijos de ≥12 líneas
  (`--min N`) y los títulos `{/* … */}` de la JSX; `--todo` los lista todos.

## sp-test

- Base propia por worktree: `shiftplanner_<carpeta>_<6 hex de la ruta>` (muchas sesiones
  llaman `wt` a su worktree; con `shiftplanner_wt` se pisarían). `sp-test -C <wt> bd` la dice.
- `prep` enlaza `node_modules` y `.venv` de BASE si faltan (y si al `node_modules` de BASE le
  falta alguna dependencia del `package.json`, hace `npm ci` en el worktree), arranca Postgres si hace falta
  (y deja una marca para que `limpiar` solo lo pare si lo arrancó él), crea la base con los
  GRANT de `infra/initdb/01-app-role.sql`, migra y siembra.
- `VALE: NO` cuando la suite miente: skipped fuera de `test_intake_schema_contract`, cascada
  de `UndefinedColumn`, `app.__file__` fuera del worktree o pytest sin llegar a correr.
- Logs en `<git-common-dir>/sp-logs/<worktree>-<hash>/`; se borran solos a los 3 días.

## sp-logs

- Lanza `railway` desde `~/conductor/repos/manager-opt` (la carpeta vinculada) y guarda el
  JSON crudo en `.git/sp-logs/railway/`.
- Railway devuelve los logs del despliegue ACTUAL; para uno anterior, su id (`sp-logs deploys`).
- Railway marca «error» todo lo que sale por stderr, incluidos los `INFO` de uvicorn y alembic:
  `sp-logs` clasifica por el texto del mensaje, no por ese campo.

## Los hooks

- Registrados en `.claude/settings.json` del repo: se aplican a las sesiones que ARRANCAN
  dentro de un checkout (Conductor, la routine de la nube). Las que arrancan en `~` no cargan
  ni la configuración ni las skills ni los agentes del repo: registrarlos a nivel de usuario
  toca `~/.claude` y lo decide Max. Mientras tanto, los scripts de `.claude/bin/` funcionan
  desde cualquier sesión con su ruta absoluta.
- Probados de punta a punta con `claude -p` (28-sep): Read y Bash denegados con el motivo a la
  vista del modelo, también dentro de un subagente (el hook recibe `agent_id` y `agent_type`).
- Umbrales: `UMBRAL_LINEAS` en cada guardián (800 en Read, 600 en Bash) y `UMBRAL_DIFF` (600).
- Fallan abiertos: cualquier error deja pasar.
