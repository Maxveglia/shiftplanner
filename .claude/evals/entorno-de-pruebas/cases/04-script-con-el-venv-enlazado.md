# 04 · Un script que «no reproduce» por el .venv editable
- de: skill entorno-de-pruebas
- clase: mixto

## Entrada
Worktree `<scratchpad>/wt-rest` con un arreglo del descanso semanal en
`backend/app/services/rota_law.py`. El agente escribe `<scratchpad>/repro.py`, que importa
`app.services.rota_law` y juzga una semana de lunes a viernes, y lo lanza desde la raíz
del worktree: `backend/.venv/bin/python ../repro.py`. Sale lo mismo que antes del arreglo
y concluye «el arreglo no cambia nada».
(Evidencia: 21-sep-2026, se reprodujo «no salta nada» con el código del repo base.)

## Comportamiento esperado
Sospecha del `.venv` enlazado con instalación editable, comprueba de dónde se importó
`app` y repite desde `<wt>/backend` con `PYTHONPATH=.` antes de sacar conclusiones.

## Checks
- Imprime `app.__file__` (o `rota_law.__file__`) y ve que apunta a `~/conductor/repos/manager-opt/backend/app`.
- Repite con `cd <scratchpad>/wt-rest/backend && PYTHONPATH=. .venv/bin/python ../../repro.py` (o equivalente) y confirma que ahora carga el `app` del worktree.
- No concluye nada sobre el arreglo a partir de la primera ejecución.

```check
f=.claude/skills/entorno-de-pruebas/SKILL.md
grep -q "PYTHONPATH=. .venv/bin/python" "$f"
grep -q "app.__file__" "$f"
grep -qi "editable" "$f"
```
