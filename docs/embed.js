/* Inbäddat läge: Gantt-schemat i 4D-planeringens 3D-editor (Victor 2026-11-11: "synka gantten i 3d-editorn mot TC-gantten så att den har exakt samma
   utseende och funktioner … 3d-editorn blir en kopia på gantt-planeringen från TC").
   3D-editorn visar den här sidan (?embed=gantt) i en iframe: exakt samma Gantt, samma kod, samma regler. Sidan runtom skickar projekt, token och källa
   (postMessage) och får tillbaka händelser: ändringar sparade (så att 3D-vyn läser om), markera aktivitet i 3D. Ingen Trimble Connect-anslutning behövs. */
(() => {
  if (typeof EMBED_GANTT === "undefined" || !EMBED_GANTT) return;
  const POP = new URLSearchParams(location.search).get("pop") === "1";   // eget fönster från dashboarden i Trimble Connect: fullständig Gantt, 3D-anropen går via värden
  document.documentElement.classList.add("embed-gantt"); if (POP) document.documentElement.classList.add("embed-pop");
  const st = document.createElement("style");
  st.textContent = `
html.embed-gantt body{margin:0}
html.embed-gantt #appGuide, html.embed-gantt header, html.embed-gantt #planSourceBar, html.embed-gantt #watchBanner, html.embed-gantt .panel:not([data-panel-id="gantt"]), html.embed-gantt #ganttHelp, html.embed-gantt .panel[data-panel-id="gantt"] > h2{display:none!important}
html.embed-gantt:not(.embed-pop) #ganttTimeRow, html.embed-gantt:not(.embed-pop) .gdd[data-dd="mode"], html.embed-gantt:not(.embed-pop) .gdd[data-dd="time"], html.embed-gantt:not(.embed-pop) #filterModelsBtn, html.embed-gantt:not(.embed-pop) label:has(#filterModelsBtn), html.embed-gantt:not(.embed-pop) label:has(#filterEndDate),
html.embed-gantt:not(.embed-pop) #ganttModeSeg, html.embed-gantt:not(.embed-pop) #ganttLoadModelsBtn, html.embed-gantt:not(.embed-pop) #ganttOpen3d, html.embed-gantt:not(.embed-pop) #ganttPhotoBtn, html.embed-gantt:not(.embed-pop) #ganttAssemblyBtn,
html.embed-gantt:not(.embed-pop) [data-gantt-view="montage"], html.embed-gantt:not(.embed-pop) .gantt-time-menu-wrap, html.embed-gantt:not(.embed-pop) #ganttScaleBtn, html.embed-gantt:not(.embed-pop) #ganttExactBtn,
html.embed-gantt:not(.embed-pop) #ganttStrictBtn, html.embed-gantt:not(.embed-pop) #ganttTimeAuto, html.embed-gantt:not(.embed-pop) #ganttFsTime{display:none!important}
#embedMg{position:fixed;right:10px;bottom:10px;z-index:9999;padding:5px 11px;border-radius:999px;font:600 12px system-ui,sans-serif;cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#334155;box-shadow:0 4px 14px rgba(15,23,42,.2)}#embedMg.on{background:#16a34a;border-color:#16a34a;color:#fff}
html.embed-compact #filterBar, html.embed-compact #lastUpdated, html.embed-compact #connectionWarning, html.embed-compact .gantt-fs-bar, html.embed-compact .gantt-head-row:not(:first-child){display:none!important}
html.embed-gantt .panel[data-panel-id="gantt"]{margin:0!important;border-radius:0!important;box-shadow:none!important;border-width:0!important}`;
  document.head.appendChild(st);
  const post = m => { try { window.parent.postMessage(m, "*"); } catch (e) { /* ingen förälder */ } };
  let initRes = null; const initP = new Promise(r => { initRes = r; });
  window.addEventListener("message", ev => {
    if (ev.source !== window.parent) return; const m = ev.data || {};
    if (m.t === "init") initRes(m);
    else if (m.t === "rpcr") { const p = rpcWait.get(m.id); if (p) { rpcWait.delete(m.id); m.ok ? p.res(m.value === null ? undefined : m.value) : p.rej(new Error(m.error || "Trimble Connect svarade inte")); } }
    else if (m.t === "tcEvent") { try { onTcEvent(m.event); } catch (e) { /* ok */ } }
    else if (m.t === "mg") { modelCtl.on = !!m.on; modelCtl.touched = modelCtl.touched || !!m.on; embedMgPaint(); if (typeof mgSyncUi === "function") mgSyncUi(); }
    else if (m.t === "compact") document.documentElement.classList.toggle("embed-compact", !!m.on);
    else if (m.t === "focus") embedFocus(m.ids || [], !!m.any);
    else if (m.t === "refresh") { const b = document.getElementById("ganttRefreshBtn"); if (typeof embedBusy !== "undefined" && embedBusy) return; if (b) b.click(); else if (typeof refreshAll === "function") refreshAll(); }
  });
  /* 3D-markering → Gantten: samma sak som när man markerar i Trimble Connects modell (syncGanttFromModel): aktiviteterna ramas in och pulserar, hopfällda grupper fälls ut,
     och ligger de utanför perioden eller dolda av sökningen hoppar Gantten dit automatiskt. */
  window.embedFocus = function (ids, any) {
    try {
      const set = new Set(ids.map(String)); ganttModelSel = set;
      if (!set.size) { applyGanttModelSel(false); return; }
      const hits = items.filter(it => set.has(String(it.id))); if (!hits.length) { applyGanttModelSel(false); return; }
      let opened = false; if (ganttGroupBy) hits.forEach(it => { const k = `${ganttGroupBy}:${ganttGroupKeyFor(it)}`; if (ganttCollapsedGroups.has(k)) { ganttCollapsedGroups.delete(k); opened = true; } });
      if (opened) { saveGanttPrefs(); renderGantt(getFilteredItems()); }
      let shown = applyGanttModelSel(true);
      if (!shown) {
        if (ganttSearch && !hits.some(ganttSearchMatch)) { const s2 = document.getElementById("ganttSearch"); if (s2) s2.value = ""; ganttSearch = ""; renderGantt(getFilteredItems()); shown = applyGanttModelSel(true); }
        if (!shown) { const first = hits.slice().sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")))[0]; if (first && first.startDate) ganttJumpToDate(first.startDate); }
      }
    } catch (e) { console.warn("Hoppa till aktivitet", e); }
  };
  /* Eget fönster: anropen mot Trimble Connects API (modell, markering, kamera, markeringar) går via dashboarden i Trimble Connect, som utför dem – där gäller 3D-styrningens brytare. */
  const rpcWait = new Map(); let rpcId = 0;
  const rpc = (path, args) => new Promise((res, rej) => { const id = ++rpcId; rpcWait.set(id, { res, rej }); let a; try { a = JSON.parse(JSON.stringify(args)); } catch (e) { a = []; } post({ t: "rpc", id, path, args: a }); setTimeout(() => { if (rpcWait.has(id)) { rpcWait.delete(id); rej(new Error("Inget svar från dashboarden i Trimble Connect")); } }, 60000); });
  const remote = path => new Proxy(function () {}, { get: (t, k) => (k === "then" || typeof k === "symbol" ? undefined : remote([...path, String(k)])), apply: (t, th, args) => rpc(path, args) });
  function embedMgPaint() { let b = document.getElementById("embedMg"); if (!POP) return; if (!b) { b = document.createElement("button"); b.id = "embedMg"; b.type = "button"; b.title = "3D-styrningen ligger i dashboarden i Trimble Connect – tryck för att slå på/av"; b.onclick = () => post({ t: "mgToggle" }); document.body.appendChild(b); } b.classList.toggle("on", !!modelCtl.on); b.textContent = modelCtl.on ? "3D-styrning på" : "3D-styrning av"; }
  /* "API" utan Trimble Connect: alla anrop går att göra men gör inget. */
  const nop = new Proxy(function () {}, { get: (t, k) => (k === "then" ? undefined : nop), apply: () => Promise.resolve(undefined) });
  window.embedBoot = async function () {
    API = POP ? remote([]) : nop; if (POP) embedMgPaint();
    post({ t: "ready" });
    const m = await Promise.race([initP, new Promise(r => setTimeout(() => r(null), 30000))]);
    if (!m) { updateConnectionWarning && document.getElementById("connectionWarning") && (document.getElementById("connectionWarning").textContent = "Fick ingen kontakt med 3D-editorn."); return; }
    projectId = m.project; projectName = m.projectName || ""; settings.githubToken = m.token || ""; if (m.userName) settings.userName = m.userName;
    planSource = m.planSource === "excel" ? "excel" : "pp";
    try { renderPlanSourceUi(); } catch (e) { /* ok */ }
    try { updateConnectionWarning(); } catch (e) { /* ok */ }
    await refreshAll();
    post({ t: "loaded" });
  };
  /* Ändringar som den här Gantten sparar → 3D-editorn läser om. */
  if (typeof ghWriteJSON === "function") { const w0 = ghWriteJSON; ghWriteJSON = window.ghWriteJSON = async function (...a) { const r = await w0.apply(this, a); post({ t: "changed", path: a[1] }); return r; }; }
  /* Markera aktivitet i 3D → görs av 3D-editorn (samma objekt, samma koppling). */
  const sel = async it => { if (!it) return; const ids = (it.members || [it]).map(x => x && x.id).filter(x => x != null); post({ t: "select", ids, name: it.name || "" }); };
  if (!POP) { window.selectActivityInModel = sel; window.selectGanttItemInModel = sel; }
})();
