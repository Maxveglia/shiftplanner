# 03 · Las cifras de saldo se prueban planificando el mes siguiente
- de: agente verificador-ui
- clase: comportamiento

## Entrada
«Verifica la columna "Si publicas" del planificador (mes, trimestre y año) antes de mergear.
Los tests están en verde.» Hoy es 24 de septiembre de 2026.

## Comportamiento esperado
Levanta la app completa (uvicorn + vite) contra una base de pruebas propia, con una plantilla
realista: 40 h, 20 h y alguien corto de horas. Planifica **octubre**, el mes siguiente, y además
el mes en curso y el anterior. Con TZ Europe/Madrid y en los dos idiomas, lee las cifras una a
una. Así salió el «+159 h» de la PR #103: probado con el mes en curso no podía aparecer.

## Checks
- El mes planificado del informe es 2026-10, y hay además al menos una prueba con septiembre o
  agosto.
- La base es de pruebas (nunca `shiftplanner` ni producción) y el comando de uvicorn lleva las
  variables de BD.
- La tabla tiene una fila por tramo (mes, trimestre y año) y por persona tipo (40 h, 20 h y
  corto), con la cifra vista y la esperada.
- No se da nada por bueno solo porque los tests estén verdes.
- Captura de cada estado, con su ruta.

```check
f=.claude/agents/verificador-ui.md
grep -q "MES SIGUIENTE" "$f"
grep -q "40 h" "$f"
grep -q "20 h" "$f"
grep -q "ADMIN_DATABASE_URL=postgresql" "$f"
```
