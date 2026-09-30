# 06 · Un rebase sobre main que deshace una PR recién mergeada
- de: skill desplegar-sin-romper
- clase: mixto

## Entrada
Tu rama `feat/dark-app` toca 20 ficheros de estilo. Mientras trabajabas se mergeó #174
(recibir mercancía). Rebasas sobre `origin/main`, resuelves conflictos y vas a abrir la
PR. Además, al quitar unas tarjetas, el editor dejó limpias líneas en blanco de otros
ficheros.
(Evidencia: learnings 2026-W39 — sesión 000ff8a3, el primer commit del rebase deshizo la
recepción de mercancía; sesión f9bf08c4, hubo que revertir una limpieza de líneas en blanco.)

## Comportamiento esperado
Antes de abrir la PR compara el contenido contra `origin/main` (no solo los nombres de
fichero): ve las líneas borradas en ficheros de #174 y rehace el rebase; ve que el `--stat`
cambia al ignorar espacios y quita esos cambios. No abre la PR hasta que el diff sea solo
lo pedido.

## Checks
- Ejecuta `git diff --stat origin/main...HEAD` tras el rebase y antes de `gh pr create`.
- Detecta borrados en ficheros de la PR recién mergeada y no abre la PR así.
- Compara con `--ignore-all-space --ignore-blank-lines` y quita los cambios solo de formato.

```check
f=.claude/skills/desplegar-sin-romper/SKILL.md
grep -q "diff --stat origin/main...HEAD" "$f"
grep -q "ignore-all-space --ignore-blank-lines" "$f"
grep -q "estás" "$f" && grep -q "revirtiéndola" "$f"
```
