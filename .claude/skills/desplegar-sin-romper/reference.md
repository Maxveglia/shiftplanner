# Desplegar sin romper · referencia

## Ver la cola de generación en producción

Postgres de producción no tiene URL pública y `railway run` desde el Mac no resuelve
`postgres.railway.internal`. Se consulta DENTRO del contenedor con `railway ssh`. La
consulta es de solo lectura y no saca nombres ni correos.

1. Escribe el script en el scratchpad (`<scratchpad>/cola.py`):

   ```python
   from sqlalchemy import text
   from app.db import admin_engine  # superusuario: app_user ve 0 filas sin organización (RLS)

   SQL = """
   select id, status, attempts, created_at, started_at, heartbeat_at
   from generation_job
   where status in ('queued', 'running')
   order by created_at desc
   limit 10
   """
   with admin_engine.connect() as c:
       c.execute(text("SET TimeZone = 'UTC'"))  # horas en UTC, no en la zona del servidor
       rows = c.execute(text(SQL)).all()
   for r in rows:
       print(r)
   print(f"{len(rows)} en cola o en marcha")
   ```

2. Lánzalo sin pelearte con las comillas:

   ```bash
   B64=$(base64 < <scratchpad>/cola.py | tr -d '\n')
   cd ~/conductor/repos/manager-opt && railway ssh --service shiftplanner -- python -c "import base64; exec(base64.b64decode('$B64'))"
   ```

3. Si el clasificador de permisos lo bloquea, pide a Max que lo lance él con `!` delante
   del mismo comando.

Cómo leerlo: `running` con `heartbeat_at` de hace segundos = alguien esperando ahora mismo.
Un `running` con latido de hace más de 300 s (`generation_stale_after_seconds`) es un
trabajo abandonado que la cola retomará. Estados: `queued`, `running`, `done`, `failed`.
Tras un despliegue, un trabajo muerto se retoma a los 5 min, y luego el navegador puede
lanzar solo un reintento a esfuerzo alto (`planRetry.ts`): por eso matar una generación
cuesta ~20 min de «Reorganizando».

## Diagnóstico rápido de producción caída

| Lo que ves | Qué suele ser | Qué hacer |
|---|---|---|
| Deploy `CRASHED`, la web en 502 | dos cabezas de Alembic, o un import que no está en `dependencies` | `railway logs --service shiftplanner <id>`; `alembic heads` en origin/main |
| Deploy `SUCCESS`, la web en 502 | la app no arranca tras el healthcheck, o reinicia | `railway logs --service shiftplanner --lines 200` |
| `/health` 200 pero los briefs no dan calendario | IA sin saldo o sin límite (la web no toca la API al cargar) | mirar el mensaje en el CI o en los logs |
| Ningún deploy con el hash del merge | el aviso de GitHub no llegó | proponer a Max un commit vacío en main |
| Max sigue viendo lo viejo | su pestaña tiene el JS anterior | que recargue (Safari: `Cmd+Option+R`); la hora de build sale al pie de la barra lateral |

`railway logs --service shiftplanner --http --since 1h` da la duración y el estado de cada
petición (un 499 es el cliente que se cansó de esperar); los logs de la app no lo dicen.

## Las dos cabezas de Alembic

El número de una migración se elige mirando la `main` de ese momento; dos ramas en
paralelo eligen el mismo y el CI de cada una pasa. El 20-sep `0023_notify_by_email` y
`0023_login_attempt` dejaron producción 5 minutos en 502.

- Mejor evitarlo: antes de mergear una rama con migración, si otra con migración entró
  entretanto, rebasa y cambia tu `down_revision` a la cabeza real.
- Si ya pasó: migración vacía con `down_revision = ("<cabeza_a>", "<cabeza_b>")`, como
  `backend/alembic/versions/0024_one_head.py`; PR, CI y merge cuanto antes.

## Saldo y límite de la API

| Mensaje | Qué es | Arreglo (lo hace Max) |
|---|---|---|
| `Your credit balance is too low to access the Anthropic API` | saldo agotado | comprar créditos (Plans & Billing) |
| `You have reached your specified API usage limits` | límite mensual de gasto | subir el límite (Limits) |

Se ve primero en el CI (los tests de `test_intake_schema_contract.py`, que llaman a la API
real, en rojo) mientras la web responde 200. Mirar `api_usage` antes de recargar a ciegas.

## Quién lanzó un deploy

`railway deployment list --service shiftplanner --json`: los automáticos traen
`meta.repo`, `meta.branch = main` y `meta.commitHash`; los manuales traen `cliCaller`. Un
deploy manual (`railway up`) no debería existir: si ves uno, pregunta de dónde salió.

## Sin git (licencia de Xcode sin aceptar)

`gh pr merge` invoca git por debajo y falla. `gh api -X PUT
repos/Maxveglia/manager-opt/pulls/<n>/merge -f merge_method=merge` no. Úsalo solo si Max
te ha pedido mergear y git está roto; el resto del procedimiento no cambia.
