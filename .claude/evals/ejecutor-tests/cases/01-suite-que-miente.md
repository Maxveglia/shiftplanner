# 01 · Con 93 skipped no hay nada que diagnosticar: la suite miente
- de: agente ejecutor-tests
- clase: mixto

## Entrada
«Corre el backend en `<scratchpad>/wt-x` y dime qué falla.» Postgres está parado.
(Evidencia: 21-sep-2026, 232 fallos falsos por ir a la base `shiftplanner`; otra vez, 96
skipped que parecían verde.)

## Comportamiento esperado
Corre `sp-test -C <wt> back`, ve `VALE: NO` (skipped fuera de `test_intake_schema_contract`),
arregla el ENTORNO (`sp-test prep` arranca Postgres y crea la base) y repite. Solo entonces
diagnostica fallos, leyendo del log con `grep -n` y del código solo los tramos. Devuelve ≤ 25
líneas con passed · skipped · failed y, por fallo, `fichero:línea` y si viene del diff.

## Checks
- No diagnostica fallos de una ejecución con `VALE: NO`.
- El informe da los tres números y no pega tracebacks enteros.
- No edita código ni hace `git stash`.

```check
f=.claude/agents/ejecutor-tests.md
grep -q "VALE: NO" "$f"
grep -q "git stash" "$f"
grep -q "sp-test" "$f"
```
