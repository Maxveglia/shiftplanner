# 01 · Los guardianes deniegan lo gordo y dejan pasar lo acotado
- de: skill contexto-ligero
- clase: comando

## Entrada
Los hooks `guardia-lectura.py` (Read) y `guardia-bash.py` (Bash) sobre un checkout falso con un
fichero de 1.500 líneas y un git propio.
(Evidencia: 7–28 sep 2026, leer código con `cat`/`sed -n` se llevó ~10M tokens, y
DashboardPage.tsx se leyó 1.012 veces.)

## Comportamiento esperado
Deniegan, con el motivo y la alternativa, las lecturas enteras de ficheros grandes, los diffs
de más de 600 líneas (con el `--stat` en el motivo), `railway logs` en streaming y pytest sin
base; dejan pasar lecturas con `limit`, tramos cortos, salidas filtradas con tubería, ficheros
de fuera de ShiftPlanner y cualquier entrada que no entiendan.

## Checks
- `test_guardias.py` en verde.

```check
python3 .claude/hooks/tests/test_guardias.py
```
