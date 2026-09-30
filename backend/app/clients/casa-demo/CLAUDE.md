# Cliente: Casa Demo

Casa Demo es el restaurante de ejemplo de este snapshot público: ocupa el
lugar de un cliente real cuyos datos (nombre, carta y fotos) se han retirado.
Nació, como todo negocio nuevo, con la plantilla (Turnos e Inventario, en
preparación). El 27-sep-2026 Max pidió para él una tercera app, **Tienda**
(`store`), con tres secciones: **Ventas** (lo vendido, apuntado a mano: aún no
hay TPV), **Estadísticas** (lo que sale de esas ventas) y **Menú** (la carta
del local, que el equipo lee desde su pantalla). Por eso tiene carpeta propia:
Tienda solo la tiene quien la lleva en su ficha.

Su espacio sigue **en preparación** (`"preparing": true`): el lanzador le dice
solo «Casa Demo» encima de sus tres apps, que funcionan ya.
Cuando lo suyo esté listo, se apaga aquí y en ningún otro sitio.

La migración 0036 lo archiva aquí (`client_key = 'casa-demo'`) buscándolo
por el nombre, y solo si hay exactamente un negocio sin carpeta que se llame
«Casa Demo». Si no lo encontró (otro nombre, o dos altas con ese nombre),
sigue en la plantilla y hay que archivarlo a mano por su id.

**Su carta** se cargó el 27-sep-2026 desde una foto de su TPV (migración
0037): cuatro secciones (Crispy, Combos, Ensaladas, Bebidas) y 20 productos.
Cuatro llegaron sin precio (Crispy Ahumado y Crispy Wrap, con «2
variantes»; El del Puerto; Ensalada Casa Demo) y están cargados como no
disponibles hasta que el manager les ponga precio. La foto estaba cortada por
abajo: puede faltar algo. Desde entonces la carta es suya y se cambia en la
pantalla del Menú, no aquí.

**Sus fotos** venían de la foto de su TPV y se han retirado de este snapshot
junto con `menu-photos/`: las migraciones 0039 y 0044 no encuentran la carpeta
y no hacen nada, y los platos salen con el marcador de iniciales.

Lo que se cambie en esta carpeta solo le afecta a él. Si un cambio tendría que
llegar a todos los negocios, no va aquí: va al núcleo (ver
`app/clients/README.md`).

- `client.json`: su ficha. Quitar una app de `apps` se la apaga en el acto:
  sus pantallas desaparecen y sus endpoints responden 403 `app_not_enabled`.
  Los datos no se borran.
