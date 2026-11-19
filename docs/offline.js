/* Offline-läge (skrivbordsversionen, Victor 2026-11-10: "offline-cache också").
   – Varje lyckad läsning av en datafil mot GitHub (4D-data) sparas i IndexedDB. Saknas nätet visas senast hämtade version.
   – Ändringar som sparas utan nät läggs i en väntekö (en per fil) och skickas när nätet är tillbaka.
     Har någon annan hunnit ändra filen under tiden skrivs INGET över: ändringen ligger kvar som konflikt och kan sparas ner som fil.
   – En liten ruta längst ner till vänster visar "Offline" och antal väntande ändringar.
   Läses in efter github-storage.js. Gör ingenting om IndexedDB saknas. */
(() => {
  try { if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {}); } catch (e) { /* ok */ }
  if (typeof ghGetFile !== "function" || typeof ghWriteJSON !== "function" || typeof indexedDB === "undefined") return;
  const DB = "4dplan-offline", ST_FILES = "files", ST_PEND = "pending", ST_BIN = "bin";
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => { const q = indexedDB.open(DB, 2); q.onupgradeneeded = () => { const d = q.result; if (!d.objectStoreNames.contains(ST_FILES)) d.createObjectStore(ST_FILES, { keyPath: "path" }); if (!d.objectStoreNames.contains(ST_PEND)) d.createObjectStore(ST_PEND, { keyPath: "path" }); if (!d.objectStoreNames.contains(ST_BIN)) d.createObjectStore(ST_BIN, { keyPath: "path" }); }; q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }));
  const tx = async (st, mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(st, mode), s = t.objectStore(st), r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  const put = (st, v) => tx(st, "readwrite", s => s.put(v)).catch(() => {});
  const get = (st, k) => tx(st, "readonly", s => s.get(k)).catch(() => null);
  const del = (st, k) => tx(st, "readwrite", s => s.delete(k)).catch(() => {});
  const all = st => tx(st, "readonly", s => s.getAll()).then(v => v || []).catch(() => []);
  const isNet = e => e && (e.name === "TypeError" || /Failed to fetch|NetworkError|Load failed|network/i.test(String(e.message || e))) && !e.status && !e.conflict && !e.rateLimited;
  // Skrivbordsläge (installerad app/Electron): nätfel räcker för att falla tillbaka på cachen. I vanlig webbläsarflik görs det bara när webbläsaren själv säger att den är offline.
  const desktop = (() => { try { return /Electron/i.test(navigator.userAgent) || (window.matchMedia && (matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: minimal-ui)").matches)) || /[?&]offline=1/.test(location.search); } catch (e) { return false; } })();
  const netFail = e => isNet(e) && desktop;
  const offlineNow = () => typeof navigator !== "undefined" && navigator.onLine === false;
  const state = { offline: false, pending: 0, conflicts: 0 }, pendSet = new Set();   // vilka filer som har väntande ändringar (så att vanliga läsningar/skrivningar slipper vänta på IndexedDB)
  let box = null;
  function badge() {
    if (typeof document === "undefined" || !document.body) return;
    if (!box) { box = document.createElement("div"); box.id = "offlineBadge"; box.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:99999;padding:7px 12px;border-radius:999px;font:600 12px system-ui,sans-serif;color:#fff;background:#b45309;box-shadow:0 4px 16px rgba(0,0,0,.35);display:none;cursor:default"; document.body.appendChild(box); }
    const parts = []; if (state.offline) parts.push("Offline – visar senast hämtade data"); if (state.pending) parts.push(`${state.pending} ändring${state.pending === 1 ? "" : "ar"} väntar på nätet`); if (state.conflicts) parts.push(`${state.conflicts} konflikt${state.conflicts === 1 ? "" : "er"} (filen ändrad av någon annan)`);
    box.style.display = parts.length ? "block" : "none"; box.style.cursor = "pointer"; box.title = "Klicka för offline-panelen (väntande ändringar, förbered för offline)"; box.onclick = () => { if (typeof l3ofOpen === "function") l3ofOpen(); }; box.textContent = parts.join(" · "); box.style.background = state.conflicts ? "#b91c1c" : "#b45309";
  }
  async function refresh() { const p = await all(ST_PEND); pendSet.clear(); p.forEach(x => pendSet.add(x.path)); state.pending = p.filter(x => !x.conflict).length; state.conflicts = p.filter(x => x.conflict).length; badge(); }
  const origGet = ghGetFile, origWrite = ghWriteJSON;

  // Läsning: spara lyckade, falla tillbaka på cachen om nätet saknas.
  ghGetFile = window.ghGetFile = async function (token, path, opts = {}) {
    const pend = pendSet.has(path) ? await get(ST_PEND, path) : null;
    if (pend && !pend.conflict && (offlineNow() || desktop && state.offline)) return { data: pend.data, sha: pend.baseSha };
    try {
      const r = await origGet(token, path, opts); state.offline = false; badge();
      if (r && r.sha) put(ST_FILES, { path, data: r.data, sha: r.sha, at: Date.now() });
      return pend && !pend.conflict ? { data: pend.data, sha: r.sha } : r;
    } catch (e) {
      if (!(netFail(e) || offlineNow())) throw e;
      const c = await get(ST_FILES, path); state.offline = true; badge();
      if (pend && !pend.conflict) return { data: pend.data, sha: pend.baseSha };
      if (c) return { data: c.data, sha: c.sha };
      throw e;
    }
  };
  // Skrivning: utan nät → väntekö.
  ghWriteJSON = window.ghWriteJSON = async function (token, path, mutateFn, message, maxRetries, preFetched) {
    const queue = async () => {
      const pend = pendSet.has(path) ? await get(ST_PEND, path) : null, cached = pend && !pend.conflict ? { data: pend.data, sha: pend.baseSha } : await get(ST_FILES, path);
      if (!cached && !pend) throw new Error("Offline och filen har aldrig hämtats – kan inte spara nu.");
      const cur = Array.isArray(cached.data) ? cached.data : [], next = mutateFn(cur.slice());
      await put(ST_PEND, { path, data: next, baseSha: cached.sha, message: message || "Offline-ändring", at: Date.now(), conflict: false }); pendSet.add(path);
      if (typeof ghFileCache !== "undefined") ghFileCache.set(path, { data: next, sha: cached.sha, own: true, at: Date.now() });
      state.offline = true; await refresh(); return next;
    };
    if (offlineNow() || desktop && state.offline && !(await probe(token))) return queue();
    try { const r = await origWrite(token, path, mutateFn, message, maxRetries, preFetched); state.offline = false; badge(); return r; } catch (e) { if (netFail(e) || (isNet(e) && offlineNow())) return queue(); throw e; }
  };
  /* Binärfiler (ritningens PDF, bilder, DXF …): sparas när de hämtas och används när nätet saknas – annars saknas underlaget offline. Högst 150 MB per fil. */
  if (typeof ghReadBinaryUrl === "function") {
    const origBin = ghReadBinaryUrl;
    ghReadBinaryUrl = window.ghReadBinaryUrl = async function (token, path, onProgress) {
      try {
        const url = await origBin(token, path, onProgress); state.offline = false;
        try { const b = await (await fetch(url)).blob(); if (b.size < 150e6) put(ST_BIN, { path, blob: b, at: Date.now() }); } catch (e) { /* utan cache */ }
        return url;
      } catch (e) {
        if (!(netFail(e) || offlineNow())) throw e;
        const c = await get(ST_BIN, path); state.offline = true; badge(); if (c && c.blob) return URL.createObjectURL(c.blob); throw e;
      }
    };
  }
  async function probe(token) { try { const r = await fetch("https://api.github.com/rate_limit", { cache: "no-store" }); if (r.ok) { state.offline = false; badge(); return true; } } catch (e) { /* inget nät */ } return false; }

  // Skicka väntande när nätet är tillbaka.
  let flushing = false;
  async function flush() {
    if (flushing || offlineNow()) return; flushing = true;
    try {
      const token = typeof ghToken === "function" ? ghToken() : (typeof settings !== "undefined" && settings && settings.githubToken) || null;
      const list = (await all(ST_PEND)).filter(x => !x.conflict); if (!list.length || !token) return; if (!(await probe(token))) return;
      for (const p of list) {
        let remote; try { remote = await origGet(token, p.path, { fresh: true }); } catch (e) { continue; }
        if (remote.sha !== p.baseSha) { await put(ST_PEND, { ...p, conflict: true }); if (typeof l3Toast === "function") l3Toast(`Offline-ändring i ${p.path} kunde inte skickas: filen har ändrats av någon annan. Inget skrevs över.`); continue; }
        try { await origWrite(token, p.path, () => p.data, p.message, 3, remote); await del(ST_PEND, p.path); } catch (e) { if (!isNet(e)) { await put(ST_PEND, { ...p, conflict: true }); } }
      }
    } finally { flushing = false; await refresh(); if (!state.pending && !state.conflicts && typeof l3Toast === "function") { /* tyst */ } }
  }
  addEventListener("online", () => { state.offline = false; setTimeout(flush, 800); }); addEventListener("offline", () => { state.offline = true; badge(); });
  setInterval(() => { if (state.pending) flush(); }, 30000);
  window.offlineSync = { state, flush, refresh, pending: async () => (await all(ST_PEND)), cachedFiles: async () => (await all(ST_FILES)).map(x => x.path), cachedFileMeta: async () => (await all(ST_FILES)).map(x => ({ path: x.path, sha: x.sha })), binMeta: async () => (await all(ST_BIN)).map(x => ({ path: x.path, sha: x.sha || null, size: x.blob ? x.blob.size : 0 })), tagBin: async (path, sha) => { const c = await get(ST_BIN, path); if (c) await put(ST_BIN, { ...c, sha }); }, cachedBins: async () => (await all(ST_BIN)).map(x => ({ path: x.path, size: x.blob ? x.blob.size : 0 })), conflicts: async () => (await all(ST_PEND)).filter(x => x.conflict), clearConflict: p => del(ST_PEND, p).then(refresh) };
  if (document.readyState !== "loading") refresh(); else document.addEventListener("DOMContentLoaded", refresh);
  setTimeout(flush, 3000);
})();
