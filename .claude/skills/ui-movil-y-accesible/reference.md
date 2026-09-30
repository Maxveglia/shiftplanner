# UI móvil y accesible · referencia

Dos formas de poner algo delante de `capture.mjs`. La primera es mucho más barata: úsala
siempre que el cambio sea de un componente. En las dos, **nada temporal dentro del repo**:
arneses, scripts, logs, PID y capturas viven en el scratchpad (`$S` abajo; escribe la ruta
literal en cada comando, la shell no la recuerda). Es la misma receta que usa el agente
`verificador-ui`.

## A. Arnés sin backend (un componente suelto)

Lo que se usó para probar el arrastre de `DayGrid` (PR #111) y el panel de carga (PR #65),
ahora sin tocar el repo. Crea en `$S/arnes/`:

1. `ln -sfn <wt>/frontend/node_modules $S/arnes/node_modules`
2. `index.html`: `<div id="root"></div>` y `<script type="module" src="/main.tsx"></script>`.
3. `main.tsx`: importa `@app/index.css` y monta el componente dentro de
   `<LanguageProvider>` (de `@app/lib/i18n`) con datos de `@app/test/factories`
   (`employee`, `contract`, `template`, `spec`, `days`, `day`). Para `DayGrid` hacen falta
   asignaciones (`Assignment` de `@app/lib/schedule/types`): sácalas de
   `generateSchedule(...)`.
4. `vite.config.mjs`:
   ```js
   import { defineConfig } from 'vite'; import react from '@vitejs/plugin-react'; import tailwind from 'tailwindcss';
   const FE = '<ruta absoluta de wt>/frontend', H = '<ruta absoluta de $S>/arnes';
   export default defineConfig({ root: H, plugins: [react()], resolve: { alias: { '@app': FE + '/src' } },
     define: { __BUILD_TIME__: '"arnes"' },
     css: { postcss: { plugins: [tailwind({ config: FE + '/tailwind.config.js', content: [FE + '/src/**/*.{ts,tsx}'] })] } },
     server: { port: 5199, strictPort: true, fs: { allow: [FE, H, '/Users/maxveglia/conductor/repos/manager-opt/frontend/node_modules'] } } });
   ```
5. Arranca y guarda el PID:
   `(cd <wt>/frontend && exec nohup ./node_modules/.bin/vite --config $S/arnes/vite.config.mjs) > $S/arnes/vite.log 2>&1 & echo $! > $S/arnes/pid`
6. `node capture.mjs http://localhost:5199/ --out $S/capturas`. Si hay animación de
   entrada y la captura sale a medio fundido, sube `--wait`.
7. Al terminar: `kill $(cat $S/arnes/pid)`. Nunca `pkill` por patrón: puede matar el
   servidor de otra sesión.

## B. La app entera en local

Para flujos, datos del servidor, saldos o la cola. Base propia creada y migrada como dice
`entorno-de-pruebas` (pasos 4-5), sembrada con `app.seeds.labor`. Nunca `shiftplanner`.

```bash
(cd <wt>/backend && ADMIN_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/shiftplanner_<wt> APP_DATABASE_URL=postgresql+psycopg://app_user:app_pass@localhost:5432/shiftplanner_<wt> JWT_SECRET=dev-secret-for-local-run-0123456789abcdef exec nohup .venv/bin/python -m uvicorn app.main:app --port 8000) > $S/api.log 2>&1 & echo $! > $S/api.pid
(cd <wt>/frontend && exec nohup ./node_modules/.bin/vite) > $S/vite.log 2>&1 & echo $! > $S/vite.pid
```

- `curl http://localhost:8000/` da 404 y eso significa que está VIVO (no hay ruta raíz);
  `curl http://localhost:8000/health` da 200.
- Si 8000 o 5173 están ocupados por otra sesión, no los mates: backend con `--port 8011`
  y `CORS_ORIGINS=http://localhost:5183`; frontend con
  `VITE_API_BASE_URL=http://localhost:8011 ./node_modules/.bin/vite --port 5183 --strictPort`.
- El frontend no necesita `.env`: `src/lib/api.ts` cae a `http://localhost:8000`.
- Sin `GEMINI_API_KEY` la entrevista no se ofrece y no te manda a `/welcome`. Sin clave de
  Anthropic válida no hay IA: el calendario se monta a mano o por la API.
- Al terminar: `kill $(cat $S/api.pid $S/vite.pid)` y `dropdb` de tu base.

Datos de prueba por la API (`/api/v1`, cabecera `Authorization: Bearer <access_token>`):

| Paso | Llamada | Esquema |
|---|---|---|
| Cuenta | `POST /auth/signup` `{org_name, email, password (≥8), full_name}` | `schemas/auth.py` |
| Carpeta | Un negocio nuevo nace con Turnos e Inventario y en preparación (la plantilla: el lanzador dice solo el nombre del negocio, en lugar del «Hola»), sin Tienda y por tanto sin Menú. Para ver lo de Max, sin el mensaje, en tu base: `UPDATE organization SET client_key='max' WHERE name='<org_name>'`; para la Tienda (Ventas, Estadísticas, Menú), `client_key='casa-demo'` (o el cliente que pruebes, `backend/app/clients/`) | `app/clients/README.md` |
| Foto de plato | `PUT /menu/dishes/{id}/photo` con los BYTES de la imagen como cuerpo (no JSON) y `Content-Type: image/jpeg\|png\|webp` (≤ 512 KB, ≤ 4096 px de lado; `curl --data-binary @foto.jpg -H 'Content-Type: image/jpeg'`); responde el plato con `photo_url`, una ruta relativa que se sirve SIN token (un `<img>` no lo manda). `DELETE` la quita. Solo manager | `routers/menu.py`, `routers/menu_photos.py` |
| Venta | `POST /store/sales` `{sold_on: "YYYY-MM-DD", client_ref: <uuid nuevo>, note?, lines: [{dish_id?, name, unit_price, quantity}]}` (solo con Tienda; un `dish_id` sale de `GET /menu`) | `schemas/store.py` |
| Sesión | `POST /auth/login` → guarda ESTA respuesta (ya trae `apps` y `preparing`) como `auth.json` para `--auth` | `schemas/auth.py` |
| Persona | `POST /employees` `{full_name, employment_status: "active", hire_date}` | `schemas/employee.py` |
| Contrato | `POST /employees/{id}/contracts` `{employment_type, min_hours_per_week, max_hours_per_week, hourly_rate, valid_from}` | `schemas/contract.py` |
| Borrador | `PUT /schedule/draft` `{period_start, period_end, shifts: [{employee_id, start_at, end_at}]}` | `schemas/assignment.py` (`PublishIn`, `ShiftIn`) |
| Publicado | `POST /schedule/publish` (mismo cuerpo) | idem |

- Fechas con offset (`2026-10-01T00:00:00+02:00`): sin offset el servidor da 422.
- Plantilla realista: 40 h, 20 h, alguien corto de horas, un turno de 22:00 a 06:00 y un
  nombre de 40 caracteres.
- El periodo, el MES SIGUIENTE al de hoy. El dashboard carga el borrador del SERVIDOR:
  tocar `localStorage` (`shiftplanner.draft.<scope>`) no basta, la app lo pisa al cargar.
- Si consultas fechas directamente en Postgres: el servidor local tiene `TimeZone`
  `America/Phoenix` aunque el Mac esté en Madrid. Empieza la sesión de `psql` con
  `SET TimeZone = 'Europe/Madrid';` (o `'UTC'`) antes de leer un `timestamptz`.

## Ejemplo de `--before` (abrir un día del mes siguiente)

```js
// $S/e2e/abrir-dia.mjs — ajusta los selectores a lo que haya en pantalla
export default async (page, { lang }) => {
  const d = new Date();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 15);
  const label = next.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { day: 'numeric', month: 'long' });
  // Los días de YearGrid llevan aria-label con la fecha larga y su estado.
  await page.locator(`button[aria-label*="${label}"]`).first().click();
};
```

## Medir además de mirar

- `corta: true` en el JSON de `capture.mjs` = scroll horizontal de página o elementos
  recortados fuera del borde. `clipped` lista los primeros.
- Teclado: `page.keyboard.press('Tab')` y comprobar `document.activeElement` (rol, nombre,
  `aria-selected`) después de cada `ArrowRight` / `Home` / `End`; Esc cierra modales.
- Roles: `await page.getByRole('tab', { name: /calendario/i }).count()`; si el rol no
  existe da 0, y eso ya es la prueba de que la regla 2 no se cumple.
- Contraste: calcúlalo con los colores de `tailwind.config.js`, no a ojo.

## Reproducir lo que ve otra persona

- Zona: la del navegador que guardó los turnos (Max ha trabajado desde
  `America/Los_Angeles`, `America/Phoenix` y `Europe/Madrid`); mírala con
  `readlink /etc/localtime`, no la supongas.
- Contexto limpio: sin localStorage. Sin spec local, el spec sale de `specFromShifts`, y
  ahí estaban los fallos de la vista de día (PR #122).
- Tras un despliegue, recargar de verdad: en Safari `Cmd+Option+R` (`Cmd+Shift+R` es el
  modo lector). La hora de build sale al pie de la barra lateral.
