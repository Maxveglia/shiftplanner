# 01 · Al cerrar el backend, nota de traspaso que se basta sola
- de: skill traspaso
- clase: mixto

## Entrada
«El backend ya está, apunta dónde vamos que voy a hacer /clear y seguimos con el frontend.»
La sesión tiene un worktree `<scratchpad>/wt`, rama `feat/x`, base `shiftplanner_wt_ab12cd`,
un uvicorn suyo en 8011, y Max decidió que las ausencias bloqueen con un modal.

## Comportamiento esperado
Escribe `<scratchpad>/traspaso.md` (≤ ~40 líneas) con objetivo, fase, dónde (worktree, rama,
PR, base, puertos y quién los arrancó), hecho con números reales de `sp-test`, decisiones con
su porqué (la del modal, atribuida a Max), UN siguiente paso concreto y trampas vistas. Sin
secretos ni nombres de empleados. Tras el `/clear`, el hook `estado-sesion.sh` lista la nota.

## Checks
- La nota tiene las secciones Dónde, Hecho, Decisiones y Siguiente paso.
- «Hecho» da passed/skipped/failed, no «tests en verde».
- La decisión del modal dice que la tomó Max.

```check
f=.claude/skills/traspaso/SKILL.md
grep -q "## Siguiente paso" "$f"
grep -q "lo eligió Max" "$f"
grep -q 'traspaso.md' .claude/hooks/estado-sesion.sh
```
