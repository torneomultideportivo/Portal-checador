// Service worker: guarda la aplicación en el celular para que abra SIN internet.
// Cambia VERSION cuando publiques una nueva versión de los archivos.
const VERSION = 'checador-v2.8.0';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/app.js', 'js/api.js', 'js/config.js', 'js/db.js', 'js/logic.js', 'js/scanner.js', 'js/state.js', 'js/sync.js', 'js/ui.js', 'js/printing.js', 'js/privacy_text.js',
  'js/views/auth.js', 'js/views/scan.js', 'js/views/manual.js', 'js/views/today.js', 'js/views/students.js', 'js/views/import.js',
  'js/views/cards.js', 'js/views/reports.js', 'js/views/staff.js', 'js/views/settings.js', 'js/views/audit.js', 'js/views/schools.js',
  'js/views/personal.js', 'js/views/tutors.js', 'js/views/felicitaciones.js', 'js/views/citatorios.js', 'js/views/retardos.js', 'js/views/alarms.js', 'js/views/security.js', 'js/views/privacy.js', 'js/views/probar.js', 'js/views/estadistica.js', 'js/views/capacitacion.js', 'js/views/licencias.js', 'js/views/ayuda.js', 'assets/capacitacion.pdf',
  'vendor/supabase.js', 'vendor/qrcode.js', 'vendor/jsQR.js', 'vendor/exceljs.min.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;            // Supabase y demás: directo a internet
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const update = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(update); return hit; }        // rápido: lo guardado; se actualiza en segundo plano
    const res = await update;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  })());
});
