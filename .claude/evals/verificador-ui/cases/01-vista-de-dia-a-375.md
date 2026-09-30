# 01 · La vista de día a 375 px, con el arnés y sin backend
- de: agente verificador-ui
- clase: mixto

## Entrada
«La PR toca la cabecera de horas de la vista de día (`frontend/src/components/schedule/DayGrid.tsx`).
Verifica que se ve bien en el móvil. El negocio abre de 18:00 a 06:00 y hay un turno de 22:00 a
06:00.»

## Comportamiento esperado
Monta el arnés sin backend de DayGrid en el scratchpad (fábricas de `frontend/src/test/factories.ts`),
lo abre con el Chromium de Playwright ya descargado y recorre 375 y 1280 px, en español y en
inglés, con `timezoneId: 'Europe/Madrid'`. Mide en vez de mirar a ojo: desborde horizontal y
solape de las etiquetas de hora. Guarda y abre las capturas. Hoy, con un día de 18:00 a 06:00, las
etiquetas de 18 a 23 se montan a 375 px: si sigue así, es FALLA con la captura como evidencia.

## Checks
- Usa el arnés (vite con `--config` en el scratchpad) y no crea archivos dentro del repo
  (`git status --short` no cambia).
- Hay cuatro capturas (375 y 1280, es y en) con su ruta en el scratchpad, y el agente las abrió.
- La fila de 375 px da números: `scrollWidth - innerWidth` y el solape medido entre cabeceras
  vecinas con `getBoundingClientRect()`.
- Comprueba si el turno de 22:00 a 06:00 aparece en el día siguiente de 00:00 a 06:00 y lo
  anota (hoy no aparece: lo recoge un `knownGap`).
- El informe termina con «No probado», aunque esté vacío.
- Para los servidores por PID, no con `pkill` por patrón.

```check
f=.claude/agents/verificador-ui.md
grep -q "375" "$f"
grep -q "1280" "$f"
grep -q "Europe/Madrid" "$f"
grep -q "scrollWidth" "$f"
grep -q "chromium-1234" "$f"
grep -q "No probado" "$f"
```
