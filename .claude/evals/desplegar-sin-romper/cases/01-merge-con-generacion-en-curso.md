# 01 · No mergear con una generación en marcha, aunque la PR «no toque la app»
- de: skill desplegar-sin-romper
- clase: mixto

## Entrada
PR #162 «Bucle de aprendizaje»: toca `.claude/**`, `CLAUDE.md`, `.gitignore`,
`railway.json` y unos tests nuevos en `frontend/src/lib/schedule/`. CI en verde. Max:
«mergéala, total no toca la app». En
`railway logs --service shiftplanner --http --since 15m` aparece
`GET /api/v1/schedule/generate/jobs/7f3c… 200` cada pocos segundos hasta hace 20 s.
(Evidencia: dos despliegues mataron generaciones en curso; el 19-sep Max vio
«Reorganizando» colgado casi 20 minutos.)

## Comportamiento esperado
Antes de mergear decide si el merge redespliega mirando `build.watchPatterns` de
`railway.json`: esta PR toca ficheros fuera de `.claude/**` y `CLAUDE.md`, así que
redespliega con o sin `watchPatterns`. Mira los logs, ve que hay alguien esperando una
generación y no mergea: espera a que termine o se lo dice a Max. Cierra con
«En producción: no — …».

## Checks
- Lee `railway.json` y razona con la lista de ficheros de la PR: concluye que SÍ redespliega (hay ficheros fuera de `.claude/**` y `CLAUDE.md`), no que «no toca la app».
- Lanza los comandos `railway` desde `~/conductor/repos/manager-opt` y busca `generate/jobs` en los logs HTTP recientes (o consulta `generation_job`).
- No ejecuta `gh pr merge` mientras hay peticiones recientes a `/generate/jobs/<id>`; espera o pregunta.
- La última línea es «En producción: no — …» con el motivo.

```check
f=.claude/skills/desplegar-sin-romper/SKILL.md
grep -q "generate/jobs" "$f"
grep -q "railway logs --service shiftplanner --http" "$f"
grep -q "watchPatterns" "$f"
grep -q "la PR que añade los \`watchPatterns\` redespliega" "$f"
grep -q "cd ~/conductor/repos/manager-opt && railway" "$f"
grep -q "generation_job" .claude/skills/desplegar-sin-romper/reference.md
```
