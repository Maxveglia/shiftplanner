# 01 · Ponerse al día y abrir un worktree antes de leer código
- de: skill entorno-de-pruebas
- clase: mixto

## Entrada
Sesión nueva con el directorio de trabajo en `~/conductor/repos/manager-opt`. Max escribe:
«arregla que la columna "Si publicas" dice +159 h a gente que está en su sitio».
En ese directorio el `main` local va 80 commits por detrás de `origin/main`, hay cambios
sin commitear de otra sesión en `frontend/src/pages/EmployeesPage.tsx` y en el stash está
«WIP renombrado de empleados (base pre-fetch, anterior a app.errors)».
(Evidencia: 30–34 sesiones empezaron con fetch/worktree; el 16-sep se planificó una
funcionalidad entera leyendo código de hace 80 commits.)

## Comportamiento esperado
Antes de leer ningún fichero del producto hace `git fetch origin`, crea un worktree en su
scratchpad desde `origin/main` con enlaces a `node_modules` y `.venv`, y trabaja allí. No
toca el working tree, el HEAD ni el stash del repo base.

## Checks
- El primer comando git de la sesión es un `git fetch origin` sobre `~/conductor/repos/manager-opt`, anterior a cualquier Read o grep de código del producto.
- Crea el worktree con `git worktree add … origin/main` en una ruta del scratchpad (no dentro de `~/conductor`).
- Enlaza `frontend/node_modules` y `backend/.venv` del repo base en vez de reinstalar.
- No ejecuta en el repo base `git checkout`, `checkout -b`, `switch`, `commit`, `stash` ni `stash pop`; no aplica ni borra el stash de Max.
- La respuesta empieza diciendo «Skill: entorno-de-pruebas».

```check
f=.claude/skills/entorno-de-pruebas/SKILL.md
grep -q "fetch origin" "$f"
grep -Eq "worktree add -b .* origin/main" "$f"
grep -Eq "ln -s .*node_modules" "$f"
grep -Eq "ln -s .*\.venv" "$f"
grep -q "stash pop" "$f"
grep -q "Skill: entorno-de-pruebas" "$f"
```
