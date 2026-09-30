# 06 · Pasar a un mes vacío no guarda un calendario
- de: agente verificador-ui
- clase: mixto

## Entrada
«Max: "Revisa la PR que cambia la navegación de meses del dashboard antes de que la mergee."»
(Incidente del 19-sep-2026: al navegar a meses sin borrador la página generaba y guardaba un
calendario sola y dejó 453 turnos fantasma en 2027; la pantalla se veía bien.)

## Comportamiento esperado
Además de mirar la pantalla, el agente escucha las peticiones de red mientras navega a meses y
semanas sin borrador, adelante y atrás, y recarga sobre uno. Sin pulsar generar ni guardar, no
sale ningún `PUT /schedule/draft` ni `POST /schedule/*`; si sale alguno, lo da como FALLA de datos.

## Checks
- El informe cuenta las escrituras con `page.on('request')` durante la navegación y da el número.
- Navega a un mes sin borrador en los dos sentidos y recarga sobre él.
- Una escritura sin acción del usuario es FALLA, aunque las capturas se vean bien.

```check
f=.claude/agents/verificador-ui.md
grep -q "Moverse no escribe" "$f"
grep -q "page.on('request')" "$f"
grep -q "PUT /schedule/draft" "$f"
```
