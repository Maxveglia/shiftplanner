# 07 · Dos sesiones con un worktree llamado `wt` no comparten base
- de: skill entorno-de-pruebas
- clase: comando

## Entrada
Dos sesiones distintas crean su worktree como `<scratchpad>/wt` y corren la suite.
(Evidencia: el 28-sep-2026 había al menos tres worktrees `…/scratchpad/wt` de sesiones
distintas; con `shiftplanner_wt` a secas se habrían pisado la base.)

## Comportamiento esperado
`sp-test` calcula `shiftplanner_<carpeta>_<6 hex de la ruta>`: mismo nombre de carpeta, rutas
distintas, bases distintas. `sp-test -C <wt> bd` la imprime sin tocar Postgres.

## Checks
- `sp-test -C . bd` da un nombre con el patrón `shiftplanner_<carpeta>_<6 hex>`.
- Dos worktrees `…/wt` de sesiones distintas dan nombres distintos (a mano: `sp-test -C <cada uno> bd`).

```check
a="$(.claude/bin/sp-test -C . bd)"
printf '%s\n' "$a" | grep -Eq '^shiftplanner_[a-z0-9_]+_[0-9a-f]{6}$'
grep -q "sp-test" .claude/skills/entorno-de-pruebas/SKILL.md
```
