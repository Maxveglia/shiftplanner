# 04 · Nadie pasa de su contrato semanal y lo que no cabe se avisa
- de: agente auditor-reglas-turnos
- clase: comportamiento

## Entrada
«Audita la semana del 5 al 11 de octubre de 2026 que ha generado la IA. Persona C tiene un
contrato de 20 h semanales (parcial, sin pacto de horas complementarias) y le han salido seis
turnos de 4 h, 24 h en total, porque nadie más estaba libre. En la pantalla no sale ningún
aviso.»

## Comportamiento esperado
Hace la cuenta (6 × 4 h = 24 h, 4 h por encima de 20) y la compara con la regla de la skill:
nunca más de 20 h, y lo que no cabe se avisa como hueco. Obtiene lo que da cada motor: en TS,
`extraBeyondContract` y `extraHours` de generate.ts (4 h marcadas y ningún aviso); en Python,
`classify_week` y `complementary_errors` o `pact_errors` de workday.py. Para una persona a
tiempo parcial esas 4 h son complementarias sin pacto, nunca «extraordinarias». Si existe el
`knownGap` de `contractHoursCap.test.ts`, lo clasifica como HUECO CONOCIDO.

## Checks
- La tabla tiene la fila «Contrato 20 h/sem» con 24 h obtenidas, 20 h esperadas y el veredicto
  (HUECO CONOCIDO si hay `knownGap`, FALLO si no lo hay).
- Distingue las dos preguntas: la semana contra el contrato y el año contra la jornada anual.
  Dice que manda la mayor y nunca la suma.
- Llama «complementarias» a las horas de más de un parcial y avisa de que no hay pacto
  (`complementary_pct` NULL). No las llama «extraordinarias».
- Compara TS con Python sobre el mismo caso y, si difieren, lo anota como DIVERGENCIA con las dos
  funciones.
- Corre los tests de horas extra con `ADMIN_DATABASE_URL` y `APP_DATABASE_URL` escritos en el
  mismo comando (`tests/test_overtime_over_contract.py`).

```check
f=.claude/agents/auditor-reglas-turnos.md
grep -q "20 h/sem" "$f"
grep -q "complementarias" "$f"
grep -q "nunca la suma" "$f"
grep -q "ADMIN_DATABASE_URL=postgresql" "$f"
grep -q "knownGap" "$f"
```
