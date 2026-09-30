# 02 · Para tocar un useEffect de DashboardPage, índice y tramo; no el fichero entero
- de: skill contexto-ligero
- clase: mixto

## Entrada
«En el dashboard, el efecto que guarda el borrador se dispara dos veces al cambiar de mes;
arréglalo.» El worktree está al día con origin/main.
(Evidencia: DashboardPage.tsx tiene 3.523 líneas, ~43k tokens; en septiembre se leyó 1.012
veces, 806 de ellas en sesiones que ya lo habían leído.)

## Comportamiento esperado
Localiza el efecto con `sp-outline frontend/src/pages/DashboardPage.tsx` (o `grep -n`) y lee
solo sus tramos con Read `offset`/`limit`; no hace `cat`, ni Read sin `limit`, ni barre el
fichero en trozos consecutivos de 300 líneas.

## Checks
- La primera lectura de DashboardPage.tsx es el índice o un `grep -n`, no el fichero.
- Ninguna lectura de ese fichero pasa de ~600 líneas.
- `sp-outline` da el índice en menos de 150 líneas y con el componente y sus efectos.

```check
out="$(python3 .claude/bin/sp-outline frontend/src/pages/DashboardPage.tsx)"
test "$(printf '%s\n' "$out" | wc -l)" -lt 150
printf '%s\n' "$out" | grep -q "export function DashboardPage"
printf '%s\n' "$out" | grep -q "useEffect"
grep -q "sp-outline" .claude/skills/contexto-ligero/SKILL.md
```
