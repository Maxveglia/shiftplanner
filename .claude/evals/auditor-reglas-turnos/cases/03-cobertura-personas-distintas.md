# 03 · La cobertura cuenta personas distintas, no turnos
- de: agente auditor-reglas-turnos
- clase: mixto

## Entrada
«El martes 6 de octubre de 2026 el brief pide 2 personas de 20:00 a 24:00. El borrador tiene:
Persona A de 20:00 a 24:00, Persona A otra vez de 22:00 a 23:00 (un clic de más en la rejilla)
y Persona B de 20:00 a 22:00. La franja de cobertura sale verde. ¿Está bien?»

## Comportamiento esperado
Cuenta personas distintas minuto a minuto: de 20:00 a 22:00 hay 2 (A y B) y de 22:00 a 24:00
hay 1 (el segundo turno de A no suma una persona). Faltan 2 h × 1 persona. Compara esa cuenta
con `peopleAt` (coverage.ts) y con lo que pinta la franja. Si la franja dice verde con 1
persona, es un FALLO con archivo:línea. Comprueba además que la rejilla no deja apilar dos
turnos de la misma persona (`placeShift.ts` los fusiona).

## Checks
- La fila de la regla de cobertura muestra la cuenta por tramos (20–22: 2 personas; 22–24:
  1 persona) y el hueco de 2 h.
- Sale el valor que da `peopleAt` a las 22:30 con esos tres turnos (1), obtenido con una sonda
  y no leyendo el código.
- Menciona que la cobertura tiene una sola definición (`coverage.ts`, `peopleAt` y
  `peopleAtHour`), importada por `DayGrid`, `validate.ts` y `generate.ts`, y que cualquier
  contador nuevo que no la use es sospechoso.
- Si existe el `knownGap` de huecos dentro de una hora (`coverageWithinHour.test.ts`), lo
  cita como HUECO CONOCIDO y no como regresión.

```check
f=.claude/agents/auditor-reglas-turnos.md
grep -q "personas distintas" "$f"
grep -q "MISMA persona" "$f"
grep -q "peopleAt" "$f"
```

```check
# La misma persona dos veces sigue contando como una.
P="$(mktemp -d)/sonda.ts"
cat > "$P" <<EOF
import { peopleAt } from '$PWD/frontend/src/lib/schedule/coverage';
const s = [
  { employeeId: 'a', startMin: 1200, endMin: 1440 },
  { employeeId: 'a', startMin: 1320, endMin: 1380 },
  { employeeId: 'b', startMin: 1200, endMin: 1320 },
];
console.log(peopleAt(s, 1350), peopleAt(s, 1260));
EOF
test "$(cd frontend && ./node_modules/.bin/vite-node "$P" | tail -1)" = "1 2"
```
