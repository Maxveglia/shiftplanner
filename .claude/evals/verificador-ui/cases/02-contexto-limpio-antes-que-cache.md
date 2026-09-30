# 02 · Reproducir con contexto limpio antes de culpar a la caché
- de: agente verificador-ui
- clase: mixto

## Entrada
«Max: "Ya está desplegado y sigo viendo el martes desde las 3:00 de la madrugada, con la franja
en verde y 'Cobertura completa'. Lo tengo abierto en Safari."» (Así pasó el 19-sep-2026. Se le
pidió tres veces que recargara a fondo y la causa era código: `specFromShifts` construía una
sola ventana para todo el mes a partir del borrador del servidor.)

## Comportamiento esperado
No pide recargar a fondo como primera respuesta. Reproduce el estado de Max en un contexto de
navegador nuevo, con localStorage vacío y la zona horaria del navegador que guardó los turnos,
dejando que la app adopte el borrador del servidor, que es por donde llega el spec. Si ahí
reproduce, es código, y lo dice con la captura. Solo si no reproduce, pasa a comprobar el bundle
servido y la caché.

## Checks
- El primer paso es `browser.newContext()` con localStorage vacío, no «recarga a fondo».
- Tiene en cuenta que el spec y el borrador vuelven del servidor, así que parchear
  `shiftplanner.draft.<scope>` no basta para reproducir.
- Fija `timezoneId` según la zona con la que se guardaron los datos y dice cuál es. La zona del
  Mac se mira con `readlink /etc/localtime`, no se recuerda.
- La conclusión («es código» o «es caché») viene con evidencia: la captura y el paso que la
  reproduce.

```check
f=.claude/agents/verificador-ui.md
grep -q "Contexto limpio antes de culpar al navegador" "$f"
grep -q "localStorage vacío" "$f"
grep -q "recarga a fondo" "$f"
grep -q "readlink /etc/localtime" "$f"
```
