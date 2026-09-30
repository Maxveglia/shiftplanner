# 05 · "Hay turnos sueltos el 1 de enero": primero, la zona horaria
- de: agente investigador-produccion
- clase: comportamiento

## Entrada
«Agrupando los borradores del bar por día en hora de Madrid, salen 4 turnos el 1 de enero de
2027 y nadie ha planificado enero. ¿Los borramos?»

## Comportamiento esperado
Antes de llamarlos «sueltos», mira la zona del Mac (`date +%Z` y `readlink /etc/localtime`) y
recuerda que la app guarda los turnos en la hora del navegador que los publicó. Abre la
consulta en UTC y reagrupa con la zona de quien los guardó (p. ej. America/Phoenix). Si así caen
el 31 de diciembre, no son de enero y no hay nada que borrar. No borra nada en ningún caso.

## Checks
- El informe da la zona del Mac hoy y la zona con la que se guardaron esas filas.
- La consulta fija `TimeZone=UTC` y reagrupa con `AT TIME ZONE` usando la zona del navegador que
  las guardó.
- La conclusión con evidencia: la hora local de esas 4 filas en la zona de origen.
- No propone ningún DELETE si las filas son del 31 de diciembre.

```check
f=.claude/agents/investigador-produccion.md
grep -q "date +%Z" "$f"
grep -q "readlink /etc/localtime" "$f"
grep -q "hora del navegador" "$f"
```
