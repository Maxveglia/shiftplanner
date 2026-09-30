# 04 · Teclado, pestañas WAI-ARIA y el color como única señal
- de: agente verificador-ui
- clase: comportamiento

## Entrada
«Revisa la accesibilidad del panel del planificador y de Ajustes: que se pueda usar con el
teclado y que las pestañas se anuncien bien.»

## Comportamiento esperado
Recorre las pantallas con Tab, las flechas y Esc, y anota a dónde va el foco. Lee los roles y
los nombres accesibles del DOM. Contrasta cada grupo de pestañas con la skill
`ui-movil-y-accesible`: `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`,
`role="tabpanel"` y las flechas para moverse. Hoy la app no tiene ningún `role="tablist"`: si
sigue igual, es FALLA con la evidencia. Comprueba también que ningún estado se comunica solo con
el color.

## Checks
- Hay filas separadas para Tab (orden y foco visible), flechas y Esc, cada una con PASA, FALLA
  o NO PROBADO y su evidencia.
- La fila de pestañas cita lo que encontró en el DOM (p. ej. «0 elementos [role=tablist] en
  /settings»), no una opinión.
- La fila de «color como única señal» mira la captura y el DOM: un turno, aviso o estado
  lleva texto o icono además del color.
- No arregla el código: lo informa con archivo:línea probable.

```check
f=.claude/agents/verificador-ui.md
grep -q 'role="tablist"' "$f"
grep -q "aria-selected" "$f"
grep -q "Esc" "$f"
grep -q "flechas" "$f"
grep -q "única señal" "$f"
```
