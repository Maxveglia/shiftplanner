---
name: ui-movil-y-accesible
description: Lista de comprobación y receta para cualquier cambio de interfaz en ShiftPlanner (repo Maxveglia/manager-opt, React + Tailwind) — móvil a 375 px sin cortar columnas, pestañas con el patrón WAI-ARIA, el color nunca como única señal, y cómo capturar la app con Playwright (el Chromium ya está descargado) a 375 y 1280 px, en español e inglés, con TZ Europe/Madrid y el mes siguiente. Úsala al tocar DashboardLayout, DashboardPage, DayGrid, DayView, YearGrid, TeamDay o cualquier componente de frontend/src; al revisar accesibilidad, responsive o móvil; y siempre que haya que «mirar la pantalla», hacer una captura o comprobar que algo «se ve bien». Solo para ShiftPlanner.
---

Al usar esta skill, dilo al principio de tu respuesta: «Skill: ui-movil-y-accesible».

# UI móvil y accesible en ShiftPlanner

Vitest corre en `node`, sin DOM, a propósito (`frontend/vitest.config.ts`): ningún test ve
un layout. Por eso aquí se trabaja así: la lógica que decide qué se pinta va en una función
pura con su test (como `components/schedule/dayTrack.ts` o `workdayRows.ts`), y lo visual se
comprueba con capturas. No añadas jsdom ni testing-library. En este repo mirar la pantalla
encuentra fallos que los tests no.

## Cómo está hoy (24-sep-2026; compruébalo antes de citarlo)

- No hay vista semanal ni `WeekGrid`: el calendario es `YearGrid` (el año) o `DayView` +
  `DayGrid` (un día). `DashboardPage.tsx`: «The year, or one day of it».
- `pages/DashboardLayout.tsx`: `<aside className="sticky … w-64 shrink-0 …">` siempre
  visible, sin variante `md:`, y `<main className="flex-1 overflow-x-hidden">`. A 375 px
  quedan ~119 px de contenido y lo que sobra se recorta sin barra de scroll.
- `DayGrid.tsx`: columna de nombres `w-44` más la rejilla de horas; ni `DayGrid` ni
  `DayView` tienen `overflow-x-auto`.
- No hay componente de pestañas. El conmutador calendar/payroll/workday de
  `DashboardPage.tsx` (~L3117) son `<button>` cuyo estado solo está en la clase
  (`bg-gray-900`): sin `role`, `aria-selected`, `aria-controls` ni flechas.
- `TeamDay.tsx`: la barra propia y las ajenas se distinguen por color (`bg-brand-600` /
  `bg-brand-100`); la columna de nombre sí escribe «Tú / You».
- `DayGrid`: todas las barras en un color (`SHIFT_COLOR`); las horas con plus, en un tono
  más oscuro (`PREMIUM_COLOR`, `aria-hidden`), y el dato solo en el `title`.
- Bien resueltos, para copiar: `Table.tsx`, `PayrollView.tsx`, `WorkdayView.tsx` y
  `TeamDay.tsx` ponen `overflow-x-auto` en el contenedor de la tabla.

## Regla 1 · A 375 px no se corta ninguna columna

- Salidas válidas: (a) una vista que quepa (modo día o lista), o (b) scroll horizontal
  DEL CONTENEDOR del grid: `overflow-x-auto` fuera y un `min-w-[…]` dentro.
- Nunca scroll horizontal de la página entera: `document.documentElement.scrollWidth`
  tiene que ser ≤ `innerWidth`.
- La barra lateral no puede comerse 256 px en móvil: que colapse bajo `md:` (p. ej.
  `hidden md:flex` más un botón de menú o una barra superior).
- Conserva el `min-w-0` de los hijos flex que envuelven el grid (DashboardPage lo explica).
- Destinos táctiles de 24×24 px como mínimo. Los asas de 10 px de arrastre necesitan
  alternativa en táctil (seleccionar y usar botones o teclas).

## Regla 2 · Pestañas con el patrón WAI-ARIA

Cualquier conmutador que cambia un panel:

- Contenedor `role="tablist"` con `aria-label`.
- Cada botón: `role="tab"`, `id`, `aria-selected={activo}`, `aria-controls={idPanel}`,
  `tabIndex={activo ? 0 : -1}` (tabindex itinerante: solo la activa entra en el Tab).
- Teclado dentro del tablist: ←/→ pasan a la anterior/siguiente (con vuelta), `Home` y
  `End` a la primera/última; Tab sale al panel.
- Panel: `role="tabpanel"`, `id`, `aria-labelledby={idPestaña}`, y `tabIndex={0}` si no
  contiene nada enfocable.
- La activa se distingue también sin color (peso, borde o subrayado).
- La cuenta de «qué índice sigue» va en una función pura con test en vitest; el JSX solo
  la llama.

## Regla 3 · El color nunca es la única señal

- Todo lo que el color distingue (yo/otros, horas con plus, publicado/borrador,
  cubierto/sin cubrir) lleva además algo que se VE sin color (texto, icono o textura) y un
  nombre accesible (`aria-label` o texto `sr-only`).
- `title` no cuenta: no se ve en táctil ni con teclado.
- Max quitó la leyenda de ocho colores y el «nocturnidad +X%» escrito en las barras (PR
  #112): no los vuelvas a poner. Para las horas con plus, textura (p. ej.
  `repeating-linear-gradient`) o un icono pequeño, más texto accesible.
- Contraste AA: 4,5:1 texto normal; 3:1 texto grande y elementos gráficos.

## Además, en todo cambio de UI

- Textos por `t()` con clave en `es` y en `en` (`lib/i18n/messages/parity.test.ts` lo exige).
- Animaciones con `motion-reduce:`.
- No pases prettier: el repo no lo usa y reformatea ficheros enteros.

## Mirarlo: capturas con Playwright

El Chromium YA está descargado en `~/Library/Caches/ms-playwright/chromium-1234/`. No
ejecutes `npx playwright install` ni lo busques por el disco: pásale `executablePath`.
El script `capture.mjs` de esta skill ya lo hace y además mide si algo se corta.

```bash
mkdir -p <scratchpad>/e2e && cd <scratchpad>/e2e
[ -d node_modules/playwright ] || { npm init -y >/dev/null && npm i playwright; }
cp <wt>/.claude/skills/ui-movil-y-accesible/capture.mjs .
node capture.mjs http://localhost:5173/ --out <scratchpad>/capturas --auth auth.json --before abrir-dia.mjs
```

- Anchos 375 y 1280, idiomas `es` y `en`, zona `Europe/Madrid`: son los valores por
  defecto del script.
- Planifica y mira el MES SIGUIENTE al actual, no el de hoy (y uno pasado si la pantalla
  habla de saldos o de «hoy»): con el mes en curso los fallos no aparecen.
- El JSON dice `corta: true` si la página tiene scroll horizontal o algo queda recortado
  fuera del borde. Luego abre con Read las capturas que necesites para juzgar lo visual y di
  lo que ves: cada una son ~1,2k tokens que se arrastran, así que no la matriz entera si el
  JSON ya responde.
- Qué servir: un arnés sin backend para un componente suelto (vite con `--config` en el
  scratchpad), o la app entera con datos por la API. Las dos recetas, en `reference.md`.
- Nada temporal dentro del repo: arnés, scripts, logs, PID y capturas, en el scratchpad.
  Para parar servidores, `kill` del PID que guardaste; nunca `pkill` por patrón.
- Para reproducir la pantalla de alguien: contexto nuevo (sin localStorage) y SU zona
  (`--tz America/Los_Angeles` si era la de Max); el spec viene del borrador del servidor,
  así que parchear localStorage no basta.

## Al entregar

- Rutas de las capturas a 375 y 1280, en es y en, y el `corta` de cada una.
- `npx tsc --noEmit` y `npx vitest run` en verde (con los números).
- Las tres reglas marcadas: cumple / no cumple / no aplica.
