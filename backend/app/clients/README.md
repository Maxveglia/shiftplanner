# Carpetas de cliente

Cada negocio (una fila de `organization`) puede tener su carpeta aquí:
`app/clients/<client_key>/`. La columna `organization.client_key` dice en qué
carpeta está archivado. Todos comparten la estética; lo demás —qué apps tiene
y, más adelante, cómo están configuradas— sale de su carpeta.

## Qué hay en una carpeta

- `client.json`, la ficha: `name`, `apps` (las apps activas, en el orden en
  que las ve el cliente, de entre `"shifts"` —Turnos—, `"inventory"`
  —Inventario— y `"store"` —Tienda: Ventas, Estadísticas y Menú—) y, opcional,
  `preparing` (ver abajo). Se lee una vez al arrancar y se valida estricta: un
  campo desconocido, una app que no existe o repetida, un `preparing` que no
  sea `true` o `false` de JSON, o un nombre de carpeta que no cumpla
  `^[a-z0-9][a-z0-9-]{0,39}$` hacen fallar el arranque y los tests. Nunca se
  degrada en silencio.
- `CLAUDE.md`: quién es el cliente, en pocas líneas.

## En preparación: `preparing`

`"preparing": true` en la ficha hace que el lanzador, al entrar, diga solo el
nombre del negocio, en lugar del «Hola», y debajo sus apps, que funcionan como
siempre. Si falta, es `false`: un negocio listo no dice nada. Viaja en la sesión (`preparing` de login, signup y `/auth/me`) y en
`GET /workspace` → `{"apps": [...], "preparing": true|false}`.

Es un campo de la ficha y no «no tener carpeta»: un cliente con carpeta propia
puede seguir en preparación mientras le construimos lo suyo. Cuando esté, se
apaga en SU ficha (quitándolo o con `false`) y en ningún otro sitio.

## Sin carpeta: la plantilla

`_template/` es lo que recibe un negocio sin `client_key` —todo negocio recién
dado de alta— o con una clave cuya carpeta no existe (esto último deja un
aviso en el log). La plantilla tiene Turnos e Inventario (`shifts`,
`inventory`) y está en preparación: el negocio nuevo planifica y cuenta su
stock desde el primer minuto, y se le dice que lo suyo está en camino. El `_` marca que no es un cliente; la base de
datos no admite una clave que empiece así.

La plantilla no tiene Tienda: la carta, las ventas y sus estadísticas son de
quien las lleva en su ficha (hoy, `casa-demo`).

## Dónde va un cambio: los tres peldaños

1. **La ficha.** Si se puede decir en `client.json`, se dice ahí.
2. **Código en su carpeta.** Si ese cliente necesita algo que la ficha no
   sabe expresar, va en su carpeta y solo le afecta a él.
3. **El núcleo.** Cuando lo mismo lo piden dos clientes, sube al código común
   y se vuelve configurable desde la ficha.
