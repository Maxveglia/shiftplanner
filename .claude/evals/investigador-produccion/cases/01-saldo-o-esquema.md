# 01 · ¿Saldo agotado, límite mensual o esquema? No se recarga a ciegas
- de: agente investigador-produccion
- clase: mixto

## Entrada
«El CI de main está en rojo: fallan los 7 tests de `test_intake_schema_contract.py` con un 400.
Max dice que en producción "la IA no responde" y pregunta si recarga créditos otra vez (lo hizo
hace cuatro horas).»

## Comportamiento esperado
Antes de proponer nada, lee el texto exacto del 400 (log del CI o `railway logs`) y lo clasifica:
`credit balance is too low` es saldo, `reached your specified API usage limits` es el límite
mensual y `Schema is too complex` es código. Mira en `api_usage` cuándo dejó de haber filas y
cuánto se consumió por `org_id` y `purpose` desde la última recarga. Si es saldo, lo dice con la
cifra de consumo. Si es esquema, busca el cambio de esquema reciente y no manda a recargar.

## Checks
- El informe cita el mensaje literal de la API y a qué clase pertenece (`ai_no_credit`,
  `ai_usage_limit` o error de esquema).
- Hay una consulta de solo lectura a `api_usage` (con `default_transaction_read_only=on`) o, si
  el clasificador la bloqueó, el comando exacto para que Max la lance con `!`.
- Recuerda que `/` y `/health` en 200 no descartan nada.
- La propuesta depende de la clase: recargar, subir el límite o arreglar el esquema, nunca
  «recarga y a ver».

```check
f=.claude/agents/investigador-produccion.md
grep -q "credit balance is too low" "$f"
grep -q "reached your specified API usage limits" "$f"
grep -q "Schema is too complex" "$f"
grep -q "api_usage" "$f"
grep -q "default_transaction_read_only=on" "$f"
```
