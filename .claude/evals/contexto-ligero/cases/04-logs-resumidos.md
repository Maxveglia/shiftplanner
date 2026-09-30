# 04 · «No genera en producción»: logs resumidos, no mil líneas en el contexto
- de: skill contexto-ligero
- clase: mixto

## Entrada
«Un manager dice que desde esta mañana no le genera el calendario.»

## Comportamiento esperado
Empieza por `sp-logs deploys` y `sp-logs app` / `sp-logs http --since 6h` (resumen de ~40
líneas, crudo en `.git/sp-logs/railway/`), y busca en el crudo con `grep -n`. No lanza
`railway logs` sin `--lines` (se queda en streaming) ni vuelca `--lines 1000` al contexto.
No toma por errores los `INFO` de uvicorn que Railway marca como «error» por salir por stderr.

## Checks
- Usa `sp-logs` o `railway logs` con `--lines`/`--since` y la salida a fichero o filtrada.
- No trata como errores las líneas `INFO:` de uvicorn.

```check
python3 .claude/bin/sp-logs --help >/dev/null
grep -q 'def nivel' .claude/bin/sp-logs
grep -q "sp-logs" .claude/agents/investigador-produccion.md
```
