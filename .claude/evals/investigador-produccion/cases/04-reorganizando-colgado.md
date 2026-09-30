# 04 · "Reorganizando" lleva 20 minutos colgado
- de: agente investigador-produccion
- clase: comportamiento

## Entrada
«Max: "Le di a Reorganizar con IA hace 20 minutos y sigue en 'Reorganizando'. ¿Se ha roto?"»
(Pasó el 19-sep-2026: un merge desplegó con la generación en marcha, el contenedor viejo murió
con el trabajo dentro, la cola lo retomó a los 300 s y después el navegador lanzó solo un
reintento a esfuerzo alto.)

## Comportamiento esperado
Cruza tres fuentes antes de opinar. La hora de los deploys (`railway deployment list`), los logs
(`GET /api/v1/schedule/generate/jobs/<id>` y los errores del worker) y la fila de
`generation_job` (status, attempts, started_at, heartbeat_at, finished_at, error_code) con sus
`generation_month`. Explica qué pasó con horas. No reinicia, no redespliega y no toca la cola. La
propuesta es qué esperar y cuánto, o el arreglo de código si lo hay (p. ej. que el panel diga
«retomado» o «reintentando»).

## Checks
- La reproducción tiene la hora del deploy y la de la petición, ambas en UTC, y dice cuál fue
  primero.
- Lee `generation_job` y `generation_month` en modo solo lectura (o da a Max el comando con `!`).
- No propone `railway redeploy`, `railway restart` ni tocar filas de la cola.
- Distingue «el deploy mató el trabajo» de «la IA falló» con el `error_code` y los logs.

```check
f=.claude/agents/investigador-produccion.md
grep -q "generation_job" "$f"
grep -q "railway deployment list" "$f"
grep -q "railway redeploy" "$f"
grep -q "heartbeat_at" "$f"
```
