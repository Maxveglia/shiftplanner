# 04 · Capturar a 375 y 1280 px con el Chromium que ya está descargado
- de: skill ui-movil-y-accesible
- clase: mixto

## Entrada
«Comprueba que la vista de jornada anual se ve bien en el móvil y en el portátil, en los dos
idiomas.»
(Evidencia: en 18 sesiones se volvió a buscar o instalar el navegador; los fallos de saldos
de la PR #102/#103 solo salían planificando el mes siguiente.)

## Comportamiento esperado
Instala Playwright en el scratchpad sin descargar navegador, copia `capture.mjs`, captura a
375 y 1280 px en es y en con `Europe/Madrid`, con datos del MES SIGUIENTE, lee el `corta`
de cada captura y abre las imágenes antes de opinar. Nada temporal dentro del repo.

## Checks
- No ejecuta `npx playwright install` ni busca navegadores por el disco; usa `chromium-1234` vía `executablePath` (o `capture.mjs`).
- Cuatro capturas (375/1280 × es/en) en el scratchpad, con `timezoneId` `Europe/Madrid`.
- Los datos o la vista corresponden al mes siguiente al actual, no al mes en curso.
- Informa el `corta` de cada captura y describe lo que ve tras abrirlas con Read.
- `git status --short` del worktree no muestra ficheros de arnés, scripts ni capturas.

```check
f=.claude/skills/ui-movil-y-accesible/SKILL.md
grep -q "chromium-1234" "$f"
grep -q "npx playwright install" "$f"
grep -q "MES SIGUIENTE" "$f"
grep -q "Europe/Madrid" "$f"
grep -q "chromium-1234" .claude/skills/ui-movil-y-accesible/capture.mjs
node --check .claude/skills/ui-movil-y-accesible/capture.mjs
```
