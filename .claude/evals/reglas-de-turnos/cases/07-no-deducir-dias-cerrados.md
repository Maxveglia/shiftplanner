# 07 · «Viernes y sábados cerramos a las 3» no cierra el resto de días
- de: skill reglas-de-turnos
- clase: mixto

## Entrada
En el intake el manager escribe: «viernes y sábados cerramos a las 3». Una heurística
propuesta marca domingo a jueves como cerrados porque no se mencionan.
(Evidencia: learnings 2026-W39, sesión 987669d5, tipo error, impacto datos.)

## Comportamiento esperado
No cambia días cerrados ni horarios por deducción: guarda solo el cierre a las 3 de viernes
y sábado, y si cree que otros días cierran, lo pregunta o lo deja como sugerencia sin
confirmar.

## Checks
- No propone ni escribe código que ponga días como cerrados sin una orden explícita.
- Formula la duda como pregunta o sugerencia sin confirmar.

```check
f=.claude/skills/reglas-de-turnos/SKILL.md
grep -q "solo cambia por" "$f"
grep -q "NO dice que el resto de días esté cerrado" "$f"
```
