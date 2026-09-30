# Mejora semanal de skills y agentes de ShiftPlanner
Trabajas sin supervisión. Tu salida es UN pull request o nada.

1. Contexto. git fetch origin learnings. Lee las notas de los últimos 7
   días (archivos de esta semana ISO y la anterior, filtrando por fecha
   de cada entrada). Lee git log --since="7 days ago" de la rama por
   defecto.
2. Si no hay notas nuevas, termina sin PR con un resumen de una línea.
3. Agrupa por skill/agente y causa. Es un patrón si la misma causa sale
   2 o más veces, o 1 sola vez si tipo=error e impacto=datos.
4. Línea base. Ejecuta .claude/evals/run.sh y evalúa los casos de
   comportamiento de las skills afectadas con un subagente por caso.
5. Por cada patrón (máximo 5, prioriza ocurrencias x impacto):
   - Edita solo .claude/skills/**, .claude/agents/**, CLAUDE.md y
     .claude/evals/**.
   - Cambio mínimo: añade o aclara una instrucción, un ejemplo o un caso
     límite. No reescribas lo que funciona ni borres reglas sin evidencia.
   - Añade un caso de eval que reproduzca el patrón.
   - Si la causa es un bug de la app, no lo arregles: anótalo para el PR.
6. Vuelve a ejecutar los evals. Si un caso que pasaba ahora falla,
   revierte el cambio que lo rompió.
7. En la rama learnings, mueve las notas procesadas a archive/, commit y
   push.
8. Abre un PR desde claude/skill-tuning-{YYYY-Www} hacia la rama por
   defecto con:
   - Resumen en 3 líneas
   - Tabla: patrón | ocurrencias | archivo cambiado | nota de evidencia
   - Evals antes y después
   - Bugs detectados en la app
   - Qué decidiste no cambiar y por qué
   No hagas merge.
