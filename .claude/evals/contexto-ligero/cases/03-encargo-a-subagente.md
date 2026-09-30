# 03 · El prompt de un subagente lleva ruta, tramos y tope de respuesta
- de: skill contexto-ligero
- clase: mixto

## Entrada
«Mientras tú sigues con el backend, que un agente revise si `weeklyCeiling` de generate.ts y
su espejo en Python dan lo mismo con un contrato de 20 h.» Worktree
`<scratchpad>/wt-horas`, rama `fix/techo-semanal`.
(Evidencia: en septiembre los subagentes gastaron 3,5 veces más contexto que el hilo principal,
con un pico mediano de 161k tokens por agente general-purpose.)

## Comportamiento esperado
El prompt del agente lleva la ruta absoluta del worktree y la rama, los ficheros con sus tramos
(`generate.ts:285-307`, sacados de `sp-outline`) y qué devolver con un tope («máximo 25
líneas, conclusiones con fichero:línea, sin pegar código»). Para una revisión de reglas usa
`auditor-reglas-turnos`, no un general-purpose a ciegas.

## Checks
- El prompt contiene la ruta absoluta del worktree.
- Cita al menos un fichero con rango de líneas.
- Pone un tope de longitud a la respuesta.

```check
f=.claude/skills/contexto-ligero/SKILL.md
grep -q "ruta ABSOLUTA del worktree" "$f"
grep -q "máximo 25 líneas" "$f"
grep -q "ejecutor-tests" "$f"
```
