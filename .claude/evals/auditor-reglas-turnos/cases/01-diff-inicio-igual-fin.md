# 01 · Un diff que da la vuelta a medianoche sin rechazar inicio == fin
- de: agente auditor-reglas-turnos
- clase: mixto

## Entrada
«Audita este diff antes de que lo mergee»:

```diff
--- a/frontend/src/lib/schedule/placeShift.ts
+++ b/frontend/src/lib/schedule/placeShift.ts
@@ -95,0 +96,12 @@
+/**
+ * Minutes of a shift typed as two clock times ("22:00", "06:00").
+ * A close before the open is a night: it rolls into the next day.
+ */
+export function spanFromClock(start: string, end: string): { startMin: number; endMin: number } {
+  const [sh, sm] = start.split(':').map(Number);
+  const [eh, em] = end.split(':').map(Number);
+  const s = sh * 60 + sm;
+  let e = eh * 60 + em;
+  if (e <= s) e += 24 * 60; // crosses midnight
+  return { startMin: s, endMin: e };
+}
```

## Comportamiento esperado
Marca FALLO de la regla 1 (inicio == fin es un error) con la cuenta hecha: `09:00–09:00` →
`s = 540, e = 540 → 540 + 1440 = 1980` → 1440 min = 24 h, cuando lo esperado es rechazarlo.
Confirma que `22:00–06:00` sí da 480 min = 8 h, así que la vuelta a medianoche es correcta y
lo que falta es rechazar antes `e === s`.

## Checks
- La tabla de salida tiene una fila de la regla 1 con el caso `09:00–09:00`, esperado «rechazo»,
  obtenido 1440 min o 24 h, y veredicto FALLO.
- El fallo cita `frontend/src/lib/schedule/placeShift.ts` con la línea del `if (e <= s) e += 24 * 60`
  (la 105 del archivo resultante, o la línea del diff).
- La fila de `22:00–06:00` da 8 h y NO se marca como fallo. La propuesta no es quitar la vuelta
  a medianoche, sino rechazar `e === s` (o devolver null o error) antes.
- Recuerda que hay otras puertas con el mismo patrón (`grep` de `end <= start` o `+= 24 * 60` en
  `refine.ts`, `generate.ts`, `hand_edits.py`) y separa las que ya tienen `knownGap` o
  `@known_gap` (hueco conocido) de la nueva (regresión).
- No edita el archivo ni hace commit.

```check
f=.claude/agents/auditor-reglas-turnos.md
grep -q "09:00–09:00" "$f"
grep -q "inicio == fin" "$f"
grep -qF 'end += 24 * 60' "$f"
grep -q "archivo:línea" "$f"
```
