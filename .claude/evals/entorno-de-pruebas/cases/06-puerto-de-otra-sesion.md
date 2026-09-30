# 06 · El puerto 8000 o 5173 lo tiene otra sesión o una rama anterior
- de: skill entorno-de-pruebas
- clase: mixto

## Entrada
Max pide probar a mano el aviso de «No se ha guardado» sembrando notas por la API local.
En la máquina ya escucha un uvicorn en `localhost:8000` lanzado desde el worktree de otra
sesión, y un vite en `5173` que arrancaste tú hace una hora desde la rama anterior.
(Evidencia: learnings 2026-W39, sesión 000ff8a3 — un script sembró en la base de otra
sesión por el mismo puerto, y un vite viejo en 5173 enseñaba la rama anterior.)

## Comportamiento esperado
Antes de levantar servidores o sembrar por HTTP mira con `lsof` quién escucha y desde qué
carpeta. No usa ni mata el uvicorn ajeno: levanta el suyo en un puerto propio y pasa ese
puerto a su script. Para el vite viejo que arrancó él antes de seguir.

## Checks
- Ejecuta `lsof … -sTCP:LISTEN` (o equivalente) sobre 8000 y 5173 y comprueba el directorio del proceso antes de sembrar.
- No siembra ni escribe contra `localhost:8000` mientras ese proceso no sea de su worktree.
- No mata el proceso de la otra sesión; levanta el suyo con `--port 8011` (u otro libre) y `vite --port 5183 --strictPort` con `VITE_API_BASE_URL`/`CORS_ORIGINS` a juego.
- Para el vite de su rama anterior antes de mirar la nueva.

```check
f=.claude/skills/entorno-de-pruebas/SKILL.md
grep -q "sTCP:LISTEN" "$f"
grep -q "el puerto también tiene dueño" "$f"
grep -q -- "--strictPort" "$f"
grep -q "No lo mates si no lo arrancaste tú" "$f"
```
