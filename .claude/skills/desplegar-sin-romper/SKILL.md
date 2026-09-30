---
name: desplegar-sin-romper
description: Llevar un cambio de ShiftPlanner (repo Maxveglia/manager-opt; Railway despliega solo desde main) de PR a «En producción: sí/no» sin matar generaciones en curso ni tumbar la app. Úsala SIEMPRE antes de `gh pr merge` o de empujar a main en manager-opt; cuando Max pregunte «¿hiciste deploy?», «¿está en producción?», «¿lo mergeaste?», «¿ya está subido?»; cuando el CI salga en rojo, haya un 502 o un deploy CRASHED; y al cerrar cualquier tarea que haya tocado ese repo, para terminar con la línea de estado. Solo para ShiftPlanner; no aplica a Tracky ni a VegliaStrips.
---

Al usar esta skill, dilo al principio de tu respuesta: «Skill: desplegar-sin-romper».

# De PR a producción en ShiftPlanner

Cómo funciona: un merge a `main` hace que Railway construya y despliegue solo (GitHub
conectado; healthcheck `/health` en `railway.json`). **El despliegue no espera al CI.** Los
workers de la cola de generación viven en el mismo contenedor que la web: un despliegue
los mata a media generación.

Los comandos `railway` se lanzan desde `~/conductor/repos/manager-opt`, que es el directorio
vinculado (desde un worktree responden «No linked project»). Ahí solo se lee: nada de
`checkout`. Producción: `https://shiftplanner-production.up.railway.app`.

## 1. Antes de mergear

1. **CI en verde**: `gh pr checks <n> -R Maxveglia/manager-opt`.
   Si el backend cae con `credit balance is too low` (saldo agotado) o `reached your
   specified API usage limits` (límite mensual), no es tu cambio: la clave de Anthropic es
   la MISMA en CI y en producción, así que ahora mismo ningún manager puede generar un
   calendario. Díselo a Max como urgente (saldo: recargar en console.anthropic.com → Plans
   & Billing; límite: subirlo en Limits). No relances el CI en bucle.
2. **Solo lo tuyo**: `git -C <wt> status --short` vacío y
   `gh pr diff <n> -R Maxveglia/manager-opt --name-only` con solo tus ficheros. Nada sin
   commitear, ningún `preview.html`, nada de otra sesión.
   Mira también el contenido, antes de abrir la PR y tras cada rebase o merge de main
   (el 25-sep, rebasar la rama del modo oscuro sobre main deshizo entera la recepción de
   mercancía de #174):
   ```bash
   git -C <wt> fetch origin
   git -C <wt> diff --stat origin/main...HEAD
   git -C <wt> diff --stat --ignore-all-space --ignore-blank-lines origin/main...HEAD
   git -C <wt> log --oneline -5 origin/main
   ```
   - Líneas borradas en ficheros de una PR recién mergeada que tú no querías tocar = estás
     revirtiéndola. Rehaz el rebase conservando lo de main; no abras la PR así.
   - Si las dos `--stat` no coinciden hay cambios solo de espacios o líneas en blanco:
     quítalos. Se cambia lo que pide la tarea, no se limpia de paso (24-sep).
3. **Otras sesiones también despliegan** (ocho PR en 45 minutos el 20-sep):
   ```bash
   git -C ~/conductor/repos/manager-opt fetch origin
   git -C ~/conductor/repos/manager-opt log --oneline -5 origin/main
   cd ~/conductor/repos/manager-opt && railway deployment list --service shiftplanner --limit 3
   ```
   Si hay un deploy `BUILDING` o `DEPLOYING`, espera a que acabe. Si tu PR trae migración,
   mira que nadie haya mergeado otra con tu número:
   `git -C ~/conductor/repos/manager-opt ls-tree --name-only origin/main backend/alembic/versions/ | sort | tail -3`.
4. **Generaciones en curso** (dos despliegues ya mataron una; Max vio «Reorganizando»
   colgado casi 20 minutos):
   ```bash
   cd ~/conductor/repos/manager-opt && railway logs --service shiftplanner --http --since 15m | grep -E 'generate/jobs|schedule/(generate|refine)'
   ```
   Peticiones recientes a `/api/v1/schedule/generate/jobs/<id>` = alguien esperando. Para
   ver la cola, la consulta de `generation_job` de `reference.md`. Si hay algo en marcha,
   espera o pregunta a Max; no mergees.
5. Si Max puede estar usando la app, avísale de que el deploy la corta unos segundos.

## 2. Mergear

```bash
gh pr merge <n> -R Maxveglia/manager-opt --merge
```

- Siempre con `-R Maxveglia/manager-opt`: sin él falló tres veces.
- Si el clasificador de permisos bloquea el merge, no busques rodeos (`gh api`, push
  directo): pide a Max que lo lance él escribiendo
  `! gh pr merge <n> -R Maxveglia/manager-opt --merge`.
- Nunca `railway up`: sube la carpeta local tal cual; así se selló producción con una
  migración sin commitear (2-sep).

## 3. Después: comprobar, no suponer

**a) Una sola cabeza de Alembic en la main resultante.** Dos cabezas = el contenedor no
arranca (`alembic upgrade head` → «Multiple head revisions»), 502 en todo:

```bash
git -C <wt> fetch origin && git -C <wt> switch --detach origin/main
cd <wt>/backend && .venv/bin/alembic heads
```

Una sola línea con `(head)`. Si salen dos: migración puente vacía con las dos en
`down_revision` (el patrón es `backend/alembic/versions/0024_one_head.py`), PR y merge ya.

**b) El deploy de tu commit exacto, en SUCCESS:**

```bash
git -C ~/conductor/repos/manager-opt rev-parse origin/main
cd ~/conductor/repos/manager-opt && railway deployment list --service shiftplanner --limit 3 --json | jq -r '.[] | "\(.status) \(.meta.commitHash) \(.createdAt)"'
```

El primero tiene que llevar tu `commitHash` y llegar a `SUCCESS` (pasa por `BUILDING` y
`DEPLOYING`; tarda unos minutos). `CRASHED` o `FAILED`: lee sus logs
(`railway logs --service shiftplanner <id-del-deploy>`) y díselo a Max ya.
Si pasados ~3 minutos no hay NINGÚN deploy con tu hash, el aviso de GitHub no llegó (pasó
con la #150): propón a Max un commit vacío en main (`git commit --allow-empty -m
"Redeploy: …"` y push, como 433dbb3). No lo hagas sin su sí.

**c) SUCCESS no garantiza que la app arrancó** (un `import httpx` en `app/` pasó el CI y
tumbó producción: `httpx` solo está en `[dev]`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://shiftplanner-production.up.railway.app/health
B=https://shiftplanner-production.up.railway.app; JS=$(curl -s "$B/" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "$B/$JS" | grep -oE '"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z"' | head -1
curl -s "$B/$JS" | grep -c '<texto que solo existe tras tu cambio>'
```

- `/health` 200.
- La fecha que sale es la hora de build del bundle (`__BUILD_TIME__`): posterior al
  `createdAt` del deploy. Si el cambio es de frontend, busca además un texto nuevo tuyo.
- Si es de backend: el campo o la ruta nueva en `$B/openapi.json`, y
  `railway logs --service shiftplanner --lines 100` sin trazas al arrancar.
- Si tocó la IA, `/health` no dice nada de ella: una prueba real del camino o pídesela a Max.

## 4. ¿Este merge redespliega?

Mira `build.watchPatterns` en `railway.json` de `origin/main` antes de responder:

- Sin `watchPatterns` (así estaba hasta la PR del bucle de aprendizaje): **cualquier**
  merge redespliega, también uno que solo toque `.claude/`, y mata generaciones (paso 1.4).
- Con `["**", "!/.claude/**", "!/CLAUDE.md"]`: un PR que SOLO toque `.claude/**` o
  `CLAUDE.md` no redespliega; la última línea es «En producción: no aplica (solo .claude/)».
- Basta un fichero fuera de esas rutas (un test, `.gitignore`, el propio `railway.json`)
  para que redespliegue entero: la PR que añade los `watchPatterns` redespliega.
- Compruébalo después: `railway deployment list` no debe tener un deploy nuevo con tu hash.

## 5. La última línea, siempre

Max ha preguntado «¿hiciste deploy/merge?» once veces en ocho sesiones. Cierra toda
respuesta que haya tocado este repo con UNA de estas líneas (hora de Madrid):

- `En producción: sí (commit 7c5fc89, deploy SUCCESS 10:49, /health 200, bundle nuevo)`
- `En producción: no — PR #161 abierta, sin mergear (espero tu OK)`
- `En producción: no — mergeado a1b2c3d, deploy CRASHED (dos cabezas de Alembic, arreglando)`

Nunca «debería estar» ni «se desplegará solo»: o lo has comprobado o dices que no.
