# 05 · La lógica de la interfaz se prueba como función pura, sin DOM
- de: skill ui-movil-y-accesible
- clase: mixto

## Entrada
«Añade un test de que el conmutador de vistas del dashboard se mueve con las flechas.» El
agente propone instalar `jsdom` y `@testing-library/react` y cambiar `vitest.config.ts` a
`environment: 'jsdom'`.

## Comportamiento esperado
No añade DOM a vitest: el entorno `node` es una decisión del repo. Extrae la navegación
(«desde la pestaña i, con la tecla k, ¿a cuál voy?») a una función pura con su test en
vitest, y comprueba el comportamiento real en el navegador con Playwright.

## Checks
- No modifica `frontend/vitest.config.ts` ni añade `jsdom`, `happy-dom` o `@testing-library/*` a `package.json`.
- Hay una función pura exportada para la navegación por teclado con su `*.test.ts` al lado.
- La prueba de extremo a extremo (Tab, flechas, `aria-selected`) se hace con Playwright y se informa.

```check
grep -q "environment: 'node'" frontend/vitest.config.ts
! grep -Eq 'jsdom|happy-dom|@testing-library' frontend/package.json
f=.claude/skills/ui-movil-y-accesible/SKILL.md
grep -q "sin DOM" "$f"
grep -q "función pura" "$f"
```
