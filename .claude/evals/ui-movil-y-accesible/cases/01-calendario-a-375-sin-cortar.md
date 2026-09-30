# 01 · A 375 px el calendario del día no corta columnas
- de: skill ui-movil-y-accesible
- clase: mixto
- brief: 2

## Entrada
Max, desde el móvil: «en el móvil la vista del día no se ve, las horas se cortan». Pantalla:
el dashboard con un día del mes siguiente abierto (`DayView` + `DayGrid`) dentro de
`DashboardLayout`.

## Comportamiento esperado
A 375 px ninguna columna del día queda recortada ni inalcanzable: la barra lateral colapsa
bajo `md:` y el grid del día tiene scroll horizontal en su propio contenedor (o un modo día
que quepa). La página entera no tiene scroll horizontal. A 1280 px todo sigue igual que
antes.

**Hoy falla, y es la línea base.** `DashboardLayout.tsx` pinta
`<aside className="sticky … w-64 shrink-0 …">` siempre, sin variante `md:`, y
`<main className="flex-1 overflow-x-hidden">`: a 375 px quedan ~119 px de contenido y lo
que sobra se recorta sin barra. Solo la columna de nombres de `DayGrid` (`w-44`) ya mide
176 px, y ni `DayGrid` ni `DayView` tienen `overflow-x-auto`.

## Checks
- `capture.mjs` a 375 px (es y en, `Europe/Madrid`, un día del mes siguiente abierto) da `corta: false` y `pageScrollX: false`.
- A 1280 px la barra lateral sigue visible y el grid se ve como antes (comparar capturas).
- Bajo `md:` hay otra forma de navegar (botón de menú con `aria-expanded`, o barra superior).
- Las 24 columnas (o las de la ventana de apertura) se alcanzan con scroll dentro del contenedor del grid, no de la página.
- Si se resuelve con una vista de lista en vez de scroll, el segundo check de abajo se cambia por uno de esa vista en el mismo PR.

```check
# La barra lateral colapsa bajo md: (hoy: w-64 fija en todos los anchos)
grep -Eq 'hidden md:(flex|block)|max-md:hidden|md:w-64' frontend/src/pages/DashboardLayout.tsx
```

```check
# El grid del día tiene scroll horizontal propio (hoy: ni DayGrid ni DayView)
grep -Eq 'overflow-x-(auto|scroll)' frontend/src/components/schedule/DayGrid.tsx frontend/src/components/schedule/DayView.tsx
```
