// Captura ShiftPlanner a varios anchos e idiomas y mide si algo se sale de la pantalla.
//
// Cópialo junto a un node_modules con playwright (en el scratchpad, nunca en el repo):
//
//   mkdir -p <scratchpad>/e2e && cd <scratchpad>/e2e
//   [ -d node_modules/playwright ] || { npm init -y >/dev/null && npm i playwright; }
//   cp <wt>/.claude/skills/ui-movil-y-accesible/capture.mjs .
//   node capture.mjs http://localhost:5173/ --out shots
//
// NO ejecutes `npx playwright install`: el Chromium ya está descargado y se le pasa la ruta.
//
// Opciones:
//   --out DIR           carpeta de las capturas (por defecto ./shots)
//   --widths 375,1280   anchos de ventana
//   --langs es,en       idiomas (se guardan en localStorage['shiftplanner.language'])
//   --tz Europe/Madrid  zona del navegador (la de quien reporta si reproduces su pantalla)
//   --auth FILE         la respuesta JSON de POST /api/v1/auth/signup o /auth/login
//                       ({"access_token": "...", "user": {...}}); se guarda en localStorage
//   --before FILE.mjs   módulo con `export default async (page, {width, lang}) => {...}`
//                       para llevar la página al estado que quieres (abrir el mes siguiente, un día...)
//   --wait MS           espera tras cargar (por defecto 2500)
//
// Salida: una captura por ancho×idioma y, por consola, un JSON con lo medido. «corta» = la
// página tiene scroll horizontal o hay elementos que pasan del borde derecho sin estar
// dentro de un contenedor con scroll propio (recortados, inalcanzables).

import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXE = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64',
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--') && !isValueOf(a));
function isValueOf(a) {
  const i = args.indexOf(a);
  return i > 0 && args[i - 1].startsWith('--');
}
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
if (!url) {
  console.error('uso: node capture.mjs <url> [--out DIR] [--widths 375,1280] [--langs es,en] [--tz Europe/Madrid] [--auth FILE] [--before FILE.mjs] [--wait MS]');
  process.exit(2);
}
if (!fs.existsSync(EXE)) {
  console.error(`No encuentro Chromium en ${EXE}. Mira ~/Library/Caches/ms-playwright/ antes de instalar nada.`);
  process.exit(2);
}

const out = path.resolve(opt('out', 'shots'));
const widths = opt('widths', '375,1280').split(',').map(Number);
const langs = opt('langs', 'es,en').split(',');
const tz = opt('tz', 'Europe/Madrid');
const wait = Number(opt('wait', '2500'));
const auth = opt('auth', null) ? JSON.parse(fs.readFileSync(opt('auth'), 'utf8')) : null;
const before = opt('before', null)
  ? (await import(pathToFileURL(path.resolve(opt('before'))).href)).default
  : null;
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const report = [];
try {
  for (const width of widths) {
    for (const lang of langs) {
      const ctx = await browser.newContext({
        viewport: { width, height: width < 600 ? 812 : 800 },
        deviceScaleFactor: width < 600 ? 2 : 1,
        locale: lang === 'es' ? 'es-ES' : 'en-US',
        timezoneId: tz,
      });
      await ctx.addInitScript(
        ([l, a]) => {
          localStorage.setItem('shiftplanner.language', l);
          if (a) {
            localStorage.setItem('shiftplanner.token', a.access_token ?? a.token);
            localStorage.setItem('shiftplanner.user', JSON.stringify(a.user));
          }
        },
        [lang, auth],
      );
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForTimeout(wait);
      if (before) {
        await before(page, { width, lang });
        await page.waitForTimeout(500);
      }
      const file = path.join(out, `${width}-${lang}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const m = await page.evaluate(measure);
      report.push({ width, lang, file, ...m, pageErrors: errors });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));

// Runs in the page.
function measure() {
  const vw = window.innerWidth;
  const pageScroll = document.documentElement.scrollWidth > vw + 1;
  const scrollsX = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a).overflowX;
      if ((o === 'auto' || o === 'scroll') && a.scrollWidth > a.clientWidth) return true;
    }
    return false;
  };
  const past = new Set();
  const clipped = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.right <= vw + 1) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    past.add(el);
    if (el.parentElement && past.has(el.parentElement)) continue; // report the outermost only
    if (scrollsX(el)) continue;
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 4).join('.') : '';
    clipped.push({
      el: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`,
      right: Math.round(r.right),
      text: (el.innerText || '').trim().slice(0, 40),
    });
  }
  return {
    viewport: vw,
    pageScrollX: pageScroll,
    clippedCount: clipped.length,
    clipped: clipped.slice(0, 12),
    corta: pageScroll || clipped.length > 0,
  };
}
