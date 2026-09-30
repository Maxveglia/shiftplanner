---
name: traspaso
description: Escribir la nota de traspaso de una tarea de ShiftPlanner (repo Maxveglia/manager-opt) en `<scratchpad>/traspaso.md` para que sobreviva a la compactación, a un /clear o a otra sesión — objetivo, qué está hecho, decisiones con su porqué, el siguiente paso exacto y dónde vive todo (worktree, rama, base de pruebas, puertos, PR). Úsala cuando Max diga «/traspaso», «apunta dónde vamos», «voy a compactar», «sigue mañana», «retoma lo de…»; al cerrar una fase de una tarea larga (plan aprobado, backend terminado, antes de pasar al frontend o a verificar); y antes de encargar a otra sesión o routine que continúe. Solo para ShiftPlanner.
---

Al usar esta skill, dilo al principio de tu respuesta: «Skill: traspaso».

# Nota de traspaso

La compactación resume la conversación, pero lo concreto se pierde: la ruta del worktree,
qué se decidió y por qué, qué se probó y dio qué. La sesión siguiente lo redescubre leyendo
otra vez los mismos ficheros. Esta nota es lo que el hook `estado-sesion.sh` vuelve a
poner en contexto tras compactar o retomar (y lo que lista tras un `/clear`), así que
tiene que bastarse sola.

## Dónde

`<scratchpad>/traspaso.md`, con el scratchpad de ESTA sesión (el que dice el prompt de
sistema). Si ya existe, reescríbela entera: es una foto del estado, no un diario.

## Qué lleva (máximo ~40 líneas; lo que no cabe, no hacía falta)

```markdown
# <objetivo en una línea, en palabras de Max>
Actualizada: <AAAA-MM-DD HH:MM> · fase: <plan | backend | frontend | verificar | PR | merge>

## Dónde
- worktree: <ruta> · rama: <rama> · PR: #<n> o «sin PR»
- base de pruebas: <`sp-test bd`> · servidores: <puertos y quién los arrancó, o «ninguno»>
- Postgres: <lo arranqué yo | ya estaba en marcha>

## Hecho (y comprobado cómo)
- <cambio> — <cómo se comprobó: «sp-test back: 2065 passed · 11 skipped · 0 failed»>

## Decisiones
- <decisión> — porque <razón>. <Si la tomó Max, dilo: «lo eligió Max»>

## Siguiente paso
<UNA acción concreta: fichero y función, o comando>

## Pendiente después
- <…>

## Trampas vistas en esta tarea
- <lo que costó descubrir y no está en las skills>
```

## Reglas

- Números reales, no «tests en verde»: `passed · skipped · failed` del último `sp-test`.
- Rutas absolutas y `fichero:línea`; nada de «el fichero de antes».
- Las decisiones de Max, con sus palabras si son cortas. Son lo más caro de perder.
- Nada de secretos, tokens ni datos personales de empleados (nombres de clientes reales
  tampoco: «un bar de 8 personas»).
- Una trampa nueva que valga para siempre no se queda aquí: dilo en la respuesta para
  que el bucle de aprendizaje la lleve a su skill.

## Retomar

Tras compactar o `/resume`, el hook ya te ha puesto la nota en contexto: sigue por
«Siguiente paso» sin releer lo que la nota da por hecho. Tras `/clear`, el hook lista
las notas de las últimas 12 h; léela solo si Max pide retomar ese trabajo.
