# 02 · El conmutador de vistas del dashboard es un tablist accesible
- de: skill ui-movil-y-accesible
- clase: mixto
- brief: 3

## Entrada
«Haz que el conmutador Calendario / Horas y pago / Jornada del dashboard se pueda usar con
teclado y lector de pantalla.» Hoy son tres `<button>` en `DashboardPage.tsx` (~L3117) cuyo
estado activo solo está en la clase (`bg-gray-900`).

## Comportamiento esperado
Sigue el patrón WAI-ARIA Tabs: `role="tablist"` con `aria-label`; cada pestaña con
`role="tab"`, `aria-selected`, `aria-controls` y tabindex itinerante; flechas izquierda y
derecha con vuelta, `Home` y `End`; panel `role="tabpanel"` con `aria-labelledby`. La
lógica de «qué índice sigue» es una función pura con test en vitest (sin DOM).

**Hoy falla**: no hay ningún `role="tablist"` en `frontend/src`.

## Checks
- En el navegador: Tab entra en la pestaña activa (solo una tiene `tabIndex=0`); `ArrowRight` desde la última vuelve a la primera; `Home`/`End` van a los extremos; Tab siguiente entra en el panel.
- `page.getByRole('tab')` devuelve 3 y la activa tiene `aria-selected="true"`; su `aria-controls` apunta al `id` de un `role="tabpanel"` existente.
- La activa se distingue también sin color (peso, borde o subrayado).
- Hay un test de vitest de la función de navegación por teclado.
- Textos por `t()` en es y en.

```check
# Un fichero con el patrón completo (hoy: ninguno)
f=$(grep -rl 'role="tablist"' frontend/src | sed -n 1p)
test -n "$f"
grep -q 'role="tab"' "$f"
grep -q 'aria-selected' "$f"
grep -q 'aria-controls' "$f"
grep -q 'tabIndex' "$f"
grep -Eq "ArrowRight" "$f"
grep -Eq "'Home'|\"Home\"" "$f"
```

```check
# Y el dashboard lo usa (directamente o a través de un componente Tabs)
grep -Eq 'role="tablist"|<Tabs[ >]' frontend/src/pages/DashboardPage.tsx
```
