/* Service worker (skrivbordsversionen): gör att appen startar och fungerar utan nät.
   – Egna filer: nät först (så uppdateringar kommer direkt), annars senast sparade kopia.
   – Bibliotek från CDN (three, pdf.js …): cache först.
   – GitHub-API:t (data) rörs inte här – offline.js sköter datan. */
const CACHE = "4ddash-app-v1", CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
const PAGES = ["./index.html", "./gantt-popup.html"];
self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    for (const p of PAGES) {
      try {
        const r = await fetch(p, { cache: "no-store" }); if (!r.ok) continue; await c.put(p, r.clone());
        const html = await r.text(), urls = new Set(); html.replace(/(?:src|href)="([^"#]+\.(?:js|css|svg|png|webmanifest)[^"]*)"/g, (m, u) => { urls.add(u); return m; });
        await Promise.all([...urls].map(async u => { try { const abs = new URL(u, self.registration.scope).href; const x = await fetch(abs); if (x.ok) await c.put(abs, x); } catch (err) { /* hoppar över */ } }));
      } catch (err) { /* offline vid installation */ }
    }
    self.skipWaiting();
  })());
});
self.addEventListener("activate", e => { e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE && k.startsWith("4ddash-app-")) await caches.delete(k); await self.clients.claim(); })()); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return; const u = new URL(req.url);
  if (u.hostname === "api.github.com" || u.hostname === "raw.githubusercontent.com" || u.hostname.endsWith("githubusercontent.com")) return;
  if (u.origin === self.location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }
      catch (err) { const m = await c.match(req, { ignoreSearch: false }) || await c.match(req, { ignoreSearch: true }); if (m) return m; if (req.mode === "navigate") { const f = await c.match("./index.html"); if (f) return f; } throw err; }
    })());
  } else if (CDN.test(req.url)) {
    e.respondWith((async () => { const c = await caches.open(CACHE), m = await c.match(req); if (m) return m; const r = await fetch(req); if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; })());
  }
});
