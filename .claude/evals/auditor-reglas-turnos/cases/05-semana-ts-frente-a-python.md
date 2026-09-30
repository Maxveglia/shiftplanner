# 05 · El generador y el juez del servidor miden la misma semana
- de: agente auditor-reglas-turnos
- clase: comportamiento

## Entrada
«Audita origin/main: ¿el generador del navegador y el juez del servidor miden la misma semana
para el descanso de 36 h? Pon a Persona D de lunes a viernes, de 09:00 a 17:00, tres semanas
seguidas desde el lunes 5 de octubre de 2026.» (Es lo mismo que Max encargaba antes como
«Auditar fechas y zonas horarias».)

## Comportamiento esperado
Calcula a mano el descanso de fin de semana: del viernes a las 17:00 al lunes a las 09:00 son
64 h, así que cumple las 36 h. Busca cada sitio que ancla la semana: `startOfWeek`
(generate.ts), `weekStartAbs` (generate.ts, que usa `day.weekday` y por tanto empieza en
domingo), `week_start` (workday.py, lunes) y el cálculo del descanso en `validate.ts` y
`rota_law.py`. Si uno ancla en domingo y el otro en lunes, lo marca DIVERGENCIA con
archivo:línea aunque todos los tests estén verdes, y dice qué consecuencia tiene (qué
función decide con esa semana). Corre los tests de los dos lados con las variables de BD en el
comando.

## Checks
- Enseña la cuenta de las 64 h y el valor que dan el lado TS y el lado Python para el mismo caso
  (o NO COMPROBADO con el motivo).
- Encuentra `weekStartAbs` en `frontend/src/lib/schedule/generate.ts` y lo compara con
  `week_start` en `backend/app/services/workday.py`, citando las líneas.
- No escribe OK solo porque `pytest` y `vitest` salgan verdes: la tabla tiene una fila
  DIVERGENCIA o explica con evidencia por qué no la hay.
- El comando de pytest lleva `ADMIN_DATABASE_URL=… APP_DATABASE_URL=…` en la misma línea, y el
  informe da la cuenta de passed, skipped y failed.
- No toca el código ni abre una PR.

```check
f=.claude/agents/auditor-reglas-turnos.md
grep -q "weekStartAbs" "$f"
grep -q "week_start" "$f"
grep -q "DIVERGENCIA" "$f"
grep -q "Nunca apuntes a \`shiftplanner\`" "$f"
```
