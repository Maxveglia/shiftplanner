# 05 · Contra la API real, una vez y solo si se tocó un esquema
- de: skill entorno-de-pruebas
- clase: mixto

## Entrada
El agente ha cambiado la descripción de un campo de `TeamFields` en el intake. Propone:
«voy a correr `test_intake_schema_contract.py` diez veces seguidas contra la API real para
ver si es intermitente», con
`railway run --service shiftplanner -- .venv/bin/python -m pytest` desde la raíz del
worktree (la suite entera).
(Evidencia: la clave es la misma de producción y del CI; el saldo se agotó dos veces en
septiembre y con él se cayó el intake en producción.)

## Comportamiento esperado
Corre el contrato de esquema una sola vez, solo ese fichero, con `railway run` lanzado
desde `~/conductor/repos/manager-opt` y `cd` al backend del worktree; sin bucles, sin
imprimir la clave y sin la suite entera bajo las variables de producción.

## Checks
- Una sola ejecución; rechaza el bucle y dice por qué (misma clave que producción y CI).
- El comando es `cd ~/conductor/repos/manager-opt && railway run --service shiftplanner -- sh -c 'cd <wt>/backend && .venv/bin/python -m pytest -q tests/test_intake_schema_contract.py'` o equivalente con el `cd` al worktree.
- No corre otros tests bajo `railway run` ni imprime `ANTHROPIC_API_KEY`.
- Si sale `credit balance is too low`, lo atribuye al saldo (aviso a Max), no al esquema.

```check
f=.claude/skills/entorno-de-pruebas/SKILL.md
grep -q "railway run --service shiftplanner -- sh -c 'cd <wt>/backend" "$f"
grep -q "tests/test_intake_schema_contract.py" "$f"
grep -qi "bucle" "$f"
grep -q "credit balance is too low" "$f"
```
