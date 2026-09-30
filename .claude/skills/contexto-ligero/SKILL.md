---
name: contexto-ligero
description: Trabajar en ShiftPlanner (repo Maxveglia/manager-opt) sin llenar el contexto — índice de ficheros grandes con sp-outline y lectura por tramos, mapa del repo con sp-mapa, suite resumida con sp-test, logs de producción resumidos con sp-logs, diffs por fichero, y cómo encargar trabajo a subagentes para que devuelvan conclusiones y no volcados. Úsala al empezar cualquier tarea de manager-opt que vaya a leer código, antes de leer un fichero de más de ~600 líneas (DashboardPage.tsx, generate.ts, business_profile.py, schedule.py…), un diff, logs o capturas, antes de lanzar subagentes, y siempre que un hook guardia-lectura o guardia-bash te deniegue una lectura. También cuando Max diga «vas lento», «gastas mucho», «se te llena el contexto» o «compacta». Solo para ShiftPlanner.
---

Al usar esta skill, dilo al principio de tu respuesta: «Skill: contexto-ligero».

# Contexto ligero en ShiftPlanner

Medido en 54 sesiones y 378 subagentes (7–28 sep 2026): pico de contexto mediano de 299k
tokens (p90 583k) en el hilo principal. Con 1M casi nunca se compacta (1 de 54), así que
todo lo leído se vuelve a procesar en CADA llamada hasta el final. Dónde se fue:

| Qué | Tokens | Arreglo |
|---|---|---|
| leer código con `cat`/`sed -n` (sobre todo subagentes) | ~10M | índice + tramo |
| leer a trozos ficheros grandes, buscando | ~2,6M | `sp-outline` dice dónde está cada cosa |
| capturas PNG leídas con Read | ~1,6M | comprobar por DOM; pocas capturas |
| `git diff -- <fichero>` sin recortar | ~0,8M | `grep -n '^@@'` y solo los trozos |
| salidas >30k persistidas y releídas enteras | ~0,9M | `grep` sobre el fichero persistido |
| repetir el mismo tramo sin haberlo editado | ~0,9M | usar lo que ya está en contexto |

Los subagentes gastan 3,5 veces más que el hilo principal: un prompt vago los manda a explorar.

## Las herramientas (en `<wt>/.claude/bin/`, rutas absolutas porque Bash vuelve a `~`)

| Necesito | Usa |
|---|---|
| orientarme en el repo o en una carpeta | `sp-mapa` · `sp-mapa backend/app/services` |
| qué hay en un fichero grande y en qué líneas | `sp-outline <fichero>` → Read con `offset`/`limit` |
| una cosa concreta | `grep -n '<texto>' <fichero>` → Read del tramo |
| correr tests | `sp-test -C <wt> back [tests/…] \| front \| tsc \| todo` (o el agente `ejecutor-tests`) |
| logs de producción | `sp-logs app \| http --since 2h \| build \| deploys` |
| un diff | `git diff --stat …` → `git diff … -- <ruta>` → `\| grep -n '^@@'` → `\| sed -n 'a,bp'` |
| la versión de main de un fichero | `git grep -n '<texto>' origin/main -- <ruta>` → `git show origin/main:<ruta> \| sed -n 'a,bp'` |

`sp-test` imprime ~5 líneas (números, si VALE o miente, fallos con `fichero:línea`) y deja el
crudo en un log; `sp-logs` igual con Railway. Para los detalles, `grep -n` en ese log.

## Reglas de lectura

1. **Índice antes que fichero.** Más de ~600 líneas: `sp-outline` primero (DashboardPage:
   1,6k tokens de índice frente a 42,8k del fichero) y luego solo los tramos.
2. **No barras un fichero a trozos consecutivos** buscando algo: el índice o `grep -n` te
   dicen la línea.
3. **No releas lo que ya tienes.** Tras editar, relee solo el tramo editado.
4. **Salida persistida** («Output too large… saved to <fichero>»): `grep -n` sobre ese fichero,
   nunca Read entero.
5. **Memoria:** lee solo el fichero de memoria de la palabra clave de la tarea, no varios «por
   si acaso»: lo que entra al principio se arrastra en todas las llamadas.

## Los guardianes

Los hooks `guardia-lectura` (Read) y `guardia-bash` (Bash) deniegan lo de arriba con un motivo
que dice qué hacer: Read sin `limit` de >800 líneas; `cat`/`head`/`tail`/`sed -n` que saquen
>600 líneas; `git diff`/`git show` de >600 líneas cambiadas (el motivo trae el `--stat`);
`railway logs` sin `--lines`/`--since`; `pytest` sin las variables de base. Sigue la indicación.
Si de verdad necesitas todo (vas a reescribir el fichero entero), `limit` explícito en Read o
`SP_ENTERO=1 ` delante del comando, y di por qué.

## Encargar a subagentes

El prompt de un subagente lleva, siempre:

- la ruta ABSOLUTA del worktree y la rama;
- los ficheros con sus tramos (`generate.ts:1412-1646`, sacados de `sp-outline`), no «mira el
  generador»;
- qué devolver y cuánto: «máximo 25 líneas; conclusiones con `fichero:línea`; nada de pegar
  código, diffs ni salidas crudas»;
- para tests, el agente `ejecutor-tests` (o el comando `sp-test` literal con `-C <wt>`).

Agentes del repo: `ejecutor-tests` (suite), `auditor-reglas-turnos` (reglas de turnos en un
diff), `verificador-ui` (navegador), `investigador-produccion` (producción, solo lectura). Para
búsquedas amplias de solo lectura, `Explore`, diciéndole que use `sp-mapa` y `sp-outline`. No
delegues lo que resuelve un `grep`. `/code-review`: `low` o `medium` para diffs pequeños
(26 revisiones lanzaron 114 agentes y 2,3M tokens).

## Capturas

Cada captura cuesta ~1,2k tokens y se arrastra. Comprueba primero por DOM (texto, roles,
`scrollWidth > clientWidth`, lo que mide `capture.mjs` en su JSON) y abre con Read solo las
capturas que hagan falta para juzgar lo visual; recortadas al componente si se puede.

## Fases y /clear

Al cerrar una fase (plan aprobado, backend listo, PR abierta), escribe la nota de traspaso
(skill `traspaso`) y proponle a Max `/clear`: la fase siguiente arranca en ~50k en vez de
arrastrar 300k. El hook `estado-sesion.sh` le enseña a la sesión nueva las notas recientes.
