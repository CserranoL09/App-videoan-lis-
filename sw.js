/* Táctica Lab · service worker (instalar la app y abrirla sin conexión)
   · La app (index.html) se pide primero a internet: con conexión siempre llega la última versión.
     Sin conexión, o si tarda más de 3 s, se abre la copia guardada.
   · Fuentes de Google y la librería de Excel se guardan al instalar y se sirven desde la copia.
   · Los vídeos nunca pasan por aquí: se abren desde el dispositivo. */
const APP = 'tacticalab-app-v1', EXT = 'tacticalab-ext-v1';
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@600;700;800&family=Oswald:wght@500;600;700&family=Barlow+Condensed:wght@600;700;800&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap';
const XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const LOCAL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const EXT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const app = await caches.open(APP);
    await Promise.all(LOCAL.map(u => app.add(new Request(u, {cache: 'reload'})).catch(() => {})));
    // extras: si fallan (sin conexión al instalar), la app funciona igual con las fuentes del sistema
    const ext = await caches.open(EXT);
    try{
      const css = await fetch(FONTS_CSS, {mode: 'cors'});
      if (css.ok){
        const txt = await css.clone().text();
        await ext.put(FONTS_CSS, css);
        const urls = [...new Set((txt.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g) || []).map(m => m.slice(4, -1)))];
        await Promise.all(urls.map(u => fetch(u, {mode: 'cors'}).then(r => r.ok && ext.put(u, r)).catch(() => {})));
      }
    }catch(err){}
    try{ const r = await fetch(XLSX, {mode: 'cors'}); if (r.ok) await ext.put(XLSX, r); }catch(err){}
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [APP, EXT];
    for (const k of await caches.keys()) if (k.startsWith('tacticalab-') && !keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});
function timeout(ms){ return new Promise((_, rej) => setTimeout(() => rej(new Error('lento')), ms)); }
async function appFirstNetwork(req){
  const cache = await caches.open(APP);
  try{
    const r = await Promise.race([fetch(req, {cache: 'no-cache'}), timeout(3000)]);
    if (r && r.ok){ cache.put('./index.html', r.clone()); return r; }
    throw new Error('respuesta ' + (r && r.status));
  }catch(err){
    return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
  }
}
async function extCacheFirst(req){
  const cache = await caches.open(EXT);
  const hit = await cache.match(req, {ignoreVary: true}) || await cache.match(req.url, {ignoreVary: true});
  if (hit) return hit;
  const r = await fetch(req);
  if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
  return r;
}
async function localStaleWhileRevalidate(req){
  const cache = await caches.open(APP);
  const hit = await cache.match(req, {ignoreSearch: true});
  const net = fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
}
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === location.origin){ e.respondWith(appFirstNetwork(req)); return; }
  if (EXT_HOSTS.includes(url.hostname)){ e.respondWith(extCacheFirst(req)); return; }
  if (url.origin === location.origin && req.headers.get('range') === null) e.respondWith(localStaleWhileRevalidate(req));
});
