# 03 · El color nunca es la única señal (TeamDay y horas con plus de DayGrid)
- de: skill ui-movil-y-accesible
- clase: mixto
- brief: 7

## Entrada
«Revisa que el color no sea la única señal en las vistas de turnos: "Tu equipo hoy" del
empleado (`TeamDay`) y las horas con plus nocturno en el día del manager (`DayGrid`).»

## Comportamiento esperado
- `TeamDay`: la fila propia se identifica con texto, no solo con el color de la barra.
  **Hoy ya se cumple**: la columna de nombre escribe «Tú / You» (`employee.team.you`); la
  barra propia y las ajenas solo cambian de color (`bg-brand-600` / `bg-brand-100`), pero
  la fila ya lo dice en texto. El check queda como guardia para no perderlo.
- `DayGrid`: las horas con plus llevan una marca visible que no es color (textura o icono)
  y un texto accesible fuera del `title`. **Hoy falla**: el tramo es un `<span aria-hidden>`
  con `backgroundColor: PREMIUM_COLOR` y el dato solo está en el `title` de la barra.
- Sin volver a poner la leyenda de ocho colores ni «nocturnidad +X%» escrito en la barra:
  Max los quitó (PR #112).

## Checks
- En la captura a 1280 px pasada a escala de grises, las horas con plus de un turno 22:00–06:00 se distinguen del resto de la barra.
- El nombre accesible de la barra (o un texto `sr-only` junto a ella) dice cuántas horas llevan plus, sin pasar el ratón.
- La barra no muestra el texto «nocturnidad +X%» ni reaparece una leyenda de colores sobre el calendario.
- En `TeamDay` la fila propia sigue diciendo «Tú» / «You».

```check
# TeamDay: la fila propia se nombra con texto (hoy: sí)
grep -q "employee.team.you" frontend/src/components/employee/TeamDay.tsx
```

```check
# DayGrid: el tramo con plus lleva una marca que no es color (hoy: solo backgroundColor)...
awk '/stripes\.map\(/{on=1} on{print} on && /^[[:space:]]*\)\)\}/{exit}' frontend/src/components/schedule/DayGrid.tsx \
  | grep -Eq 'repeating-linear-gradient|backgroundImage|<svg|Icon|PREMIUM_(PATTERN|STYLE|TEXTURE)'
# ...y un texto accesible fuera del title (hoy: la clave solo aparece en el title)
n=$(grep -c 'calendar.dayGrid.shift.nightPremium' frontend/src/components/schedule/DayGrid.tsx || true)
grep -q 'sr-only' frontend/src/components/schedule/DayGrid.tsx || [ "$n" -ge 2 ]
```
