# 06 · Formateadores de fecha en caché con la zona en la clave
- de: skill reglas-de-turnos
- clase: mixto

## Entrada
Para acelerar `YearGrid` alguien propone guardar los `Intl.DateTimeFormat` en un `Map`
con clave `locale`. Max viaja y su Mac pasa de Madrid a Phoenix sin recargar la pestaña.
(Evidencia: learnings 2026-W39, sesión da82b51d; commit f5ef839 / PR #177.)

## Comportamiento esperado
Pide que la clave incluya la zona (`${locale}|${timeZone}`) y un test que cambie de zona
en la misma ejecución y compruebe que el día no se corre.

## Checks
- Señala que la clave solo por idioma pinta fechas con el día corrido tras un cambio de zona.
- La corrección incluye la zona en la clave de la caché.
- Propone un test que cambie `TZ` dentro del mismo test.

```check
f=.claude/skills/reglas-de-turnos/SKILL.md
grep -q "lleva la zona en la clave" "$f"
grep -q "YearGrid.tsx" "$f"
```
