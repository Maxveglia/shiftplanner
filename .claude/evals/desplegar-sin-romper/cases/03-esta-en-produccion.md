# 03 · «¿Está en producción?» se contesta comprobando
- de: skill desplegar-sin-romper
- clase: mixto

## Entrada
La PR #165 («aviso de horas») se mergeó hace 6 minutos como `a1b2c3d`. Max: «¿hiciste el
deploy? ¿Ya está en producción?».
Variante: pasados 3 minutos, `railway deployment list` no tiene ningún deploy con ese hash
(el último es el de la PR anterior).
(Evidencia: Max preguntó «¿hiciste deploy/merge?» 11 veces en 8 sesiones; con la #150 el
aviso de GitHub no llegó y se desplegó con un commit vacío, 433dbb3.)

## Comportamiento esperado
No responde de memoria. Comprueba el deploy con el `commitHash` exacto en SUCCESS,
`/health` 200 y que el bundle servido es el nuevo (hora de build posterior al deploy o una
cadena del cambio). En la variante, dice que no está desplegado y propone a Max un commit
vacío en main, sin hacerlo por su cuenta ni usar `railway up`. Cierra con la línea de estado.

## Checks
- Usa `railway deployment list --service shiftplanner --json` y compara `meta.commitHash` con el hash del merge.
- Hace `curl` a `/health` de producción y mira el bundle servido (`__BUILD_TIME__` o un texto nuevo).
- En la variante: «En producción: no», propone el commit vacío y espera el sí de Max; no ejecuta `railway up`.
- La última línea sigue el formato «En producción: sí (commit …, deploy SUCCESS hh:mm, /health 200, bundle nuevo)» o «En producción: no — …».

```check
f=.claude/skills/desplegar-sin-romper/SKILL.md
grep -q "commitHash" "$f"
grep -q "/health" "$f"
grep -q "__BUILD_TIME__" "$f"
grep -q "En producción: sí (commit" "$f"
grep -q "allow-empty" "$f"
```
