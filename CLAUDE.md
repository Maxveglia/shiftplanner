# ShiftPlanner

## Aprendizajes

Las sesiones de este repo alimentan un bucle semanal de mejora: al cerrar cada
sesión, un hook (`.claude/hooks/capture-learnings.sh`) extrae lo aprendido a la
rama `learnings`, y cada domingo una routine (`.claude/routine/weekly-tuning.md`)
lo convierte en cambios a las skills, los agentes y este archivo. El extractor
lee el transcript, así que dos convenciones le dejan las señales claras:

- Cuando Max te corrija, empieza tu respuesta con `CORRECCIÓN:` y resume en una
  frase qué hacías mal.
- Cuando uses una skill o un agente, nómbralo al principio de la respuesta
  (`Skill: entorno-de-pruebas`, `Agente: verificador-ui`).

## Contexto

Leer código es lo que más contexto gasta aquí (DashboardPage.tsx: 3.500 líneas, ~43k tokens),
y con 1M casi nunca se compacta: todo lo leído se reprocesa en cada llamada. Antes de leer un
fichero grande, un diff o logs, skill `contexto-ligero`. Herramientas en `.claude/bin/`:
`sp-outline` (índice de un fichero con números de línea), `sp-mapa` (mapa del repo),
`sp-test` (suite resumida, con su propia base) y `sp-logs` (Railway resumido). Los hooks
`guardia-lectura` y `guardia-bash` deniegan las lecturas enteras de ficheros grandes con el
motivo y la alternativa. Al cerrar una fase, skill `traspaso` y proponer `/clear`.

## Tests: verde de verdad, y sin tocarlos para que pasen

No terminas un turno con código cambiado (`backend/`, `infra/`, `frontend/`) sin una ejecución
COMPLETA de `sp-test` que VALGA y esté en verde sobre exactamente ese código: el hook Stop
`verde-de-verdad` compara la huella del código (`.claude/bin/sp-huella`) con la que dejó `sp-test`
y, si no casa, te devuelve el comando exacto (`sp-test -C <wt> back|front|tsc|todo`). Con
argumentos o filtros la suite sirve para iterar, no cuenta.

Si un test contradice lo que se pide, PARA, identifícalo y explica por qué. No talles el código
para pasar el test, ni lo marques skip/xfail/`known_gap`, ni lo apagues desde la configuración
(`conftest.py`, `pytest.ini`, `addopts`, `vitest.config`), y no modifiques los tests que ya
existen en main: el hook `proteger-tests` pide el OK de Max para cambiar o borrar uno y para tocar
esa configuración (crear tests nuevos y editar los de tu rama es libre). Si no se puede hacer sin trampa, responde
`BLOQUEADO: <test> contradice <requisito>` en una línea aparte; si necesitas a Max antes de
acabar, pon en una línea aparte `PREGUNTA: …`. Las dos dejan terminar sin tests, a la vista de Max.
