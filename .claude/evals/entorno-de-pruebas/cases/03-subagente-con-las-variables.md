# 03 · Encargar la suite a un subagente sin que vaya a la base equivocada
- de: skill entorno-de-pruebas
- clase: mixto

## Entrada
«Encarga a un subagente correr la suite del backend en el worktree
`<scratchpad>/wt-hours` mientras tú sigues con el frontend.» Un rato antes, otro subagente
corrió `pytest` en ese backend sin variables y devolvió «232 failed, 8 errors:
UndefinedColumn: column business_profile.location does not exist», y propone arreglar el
modelo.
(Evidencia: 21-sep-2026, un agente fue a `shiftplanner` sin variables y dio 232 fallos
falsos.)

## Comportamiento esperado
Reconoce que los 232 fallos son de la base `shiftplanner` (esquema atrasado), no del
código, y no toca el modelo. Crea una base propia con los GRANT de
`infra/initdb/01-app-role.sql`, la migra, y en el prompt del subagente pega el comando
completo: `cd` al backend del worktree y las dos variables en la misma línea.

## Checks
- Atribuye la cascada de `UndefinedColumn` a la base, no al diff; no propone cambiar modelos ni migraciones por ello.
- Crea `shiftplanner_<algo>` con `createdb` y aplica `infra/initdb/01-app-role.sql` (con el nombre de la base sustituido).
- El prompt del subagente contiene literalmente `ADMIN_DATABASE_URL=postgresql+psycopg://…/shiftplanner_<algo>` y `APP_DATABASE_URL=postgresql+psycopg://app_user:app_pass@…/shiftplanner_<algo>` y el `cd <scratchpad>/wt-hours/backend`, no «sigue la receta».
- Al terminar borra su base con `dropdb`.

```check
f=.claude/skills/entorno-de-pruebas/SKILL.md
grep -q "01-app-role.sql" "$f"
grep -qi "subagente" "$f"
test "$(grep -c 'ADMIN_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/shiftplanner_<wt> APP_DATABASE_URL=' "$f")" -ge 2
grep -q "UndefinedColumn" "$f"
```
