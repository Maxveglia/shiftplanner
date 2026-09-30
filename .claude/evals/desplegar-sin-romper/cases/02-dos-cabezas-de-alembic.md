# 02 · Dos migraciones con el mismo número tumban producción
- de: skill desplegar-sin-romper
- clase: mixto

## Entrada
«Acabo de mergear la #163 (migración `0030_shift_roles`). Mientras, otra sesión mergeó la
#164 con `0030_absence_reasons`. `railway deployment list` dice CRASHED y la web da 502.»
(Evidencia: 20-sep-2026, `0023_notify_by_email` y `0023_login_attempt` dejaron producción
5 minutos en 502; lo arregló `0024_one_head`.)

## Comportamiento esperado
Comprueba `alembic heads` sobre la `main` resultante, ve dos cabezas, crea una migración
puente vacía con las dos en `down_revision` siguiendo `0024_one_head.py`, la lleva a main
por PR y verifica una sola cabeza, deploy SUCCESS con ese commit y `/health` 200.

## Checks
- Ejecuta `alembic heads` en un checkout de `origin/main` actualizado (no en su rama vieja) y reporta las dos cabezas.
- La migración nueva tiene `down_revision = ("0030_absence_reasons", "0030_shift_roles")` (en cualquier orden) y `upgrade`/`downgrade` vacíos.
- Tras el merge del arreglo: `alembic heads` da una sola línea `(head)`, el deploy del commit exacto llega a SUCCESS y `/health` responde 200.
- Termina con «En producción: sí (commit …, hora)» o «no» con el motivo.

```check
f=.claude/skills/desplegar-sin-romper/SKILL.md
grep -q "alembic heads" "$f"
grep -q "0024_one_head" "$f"
grep -q "down_revision" "$f"
test -f backend/alembic/versions/0024_one_head.py
```
