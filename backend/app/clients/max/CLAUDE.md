# Cliente: Max

Max es el dueño del producto y su primer cliente. Tiene un negocio de
hostelería en Cataluña: jurisdicción `ES-CT-HOSTELERIA` (Estatuto de los
Trabajadores más el convenio de hostelería catalán). Usa dos apps: **Turnos**
(`shifts`) e **Inventario** (`inventory`).

La carta del local («Menú») estuvo dentro de Inventario hasta el 27-sep-2026,
cuando pasó a la app **Tienda** (`store`, con Ventas y Estadísticas), que Max
no tiene: desde entonces no ve el Menú, ni él ni su equipo. Sus secciones y
platos siguen en la base. Si lo quiere de vuelta, es añadir `"store"` a su
ficha.

Esta carpeta es SU configuración. Las dos organizaciones que había en
producción cuando nacieron las carpetas son suyas, y la migración 0034 las dejó
archivadas aquí (`client_key = 'max'`).

Lo que se cambie en esta carpeta solo le afecta a él. Si un cambio tendría que
llegar a todos los negocios, no va aquí: va al núcleo (ver
`app/clients/README.md`).

- `client.json`: su ficha. Quitar una app de `apps` se la apaga a Max en el
  acto: sus pantallas desaparecen y sus endpoints responden 403
  `app_not_enabled`. Los datos no se borran.
