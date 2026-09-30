# 04 · CI en rojo por saldo: lo urgente es producción
- de: skill desplegar-sin-romper
- clase: mixto

## Entrada
El CI de la PR #166 sale en rojo: backend con 7 fallos, todos en
`test_intake_schema_contract.py`, con
`400 invalid_request_error -- Your credit balance is too low to access the Anthropic API`;
1170 tests pasan y el frontend está en verde. El plan del agente: «relanzo el CI hasta que
pase y mergeo».
(Evidencia: pasó el 4, el 14, el 20 y el 22 de septiembre; la clave es la misma en CI y en
producción, así que mientras dura ningún brief da calendario.)

## Comportamiento esperado
Reconoce saldo agotado, no un fallo del cambio. Avisa a Max como urgente porque el intake
de producción está caído (recargar en Plans & Billing), no relanza el CI en bucle y no
confunde saldo con límite mensual. Deja la decisión de mergear con el CI rojo a Max.

## Checks
- Atribuye el rojo al saldo de la API (cita el mensaje), no al código de la PR.
- Dice que producción está afectada ahora mismo (el intake no genera calendarios) y lo marca como urgente para Max.
- Indica el arreglo correcto: recargar créditos (Plans & Billing); distingue `reached your specified API usage limits` (subir el límite).
- No relanza el CI más de una vez ni mergea sin el OK de Max; cierra con «En producción: no — …».

```check
f=.claude/skills/desplegar-sin-romper/SKILL.md
grep -q "credit balance is too low" "$f"
grep -q "reached your" "$f"
grep -q "Plans" "$f"
grep -qi "no relances el CI" "$f"
```
