/* Inbäddat läge: Gantt-schemat i 4D-planeringens 3D-editor (Victor 2026-11-11: "synka gantten i 3d-editorn mot TC-gantten så att den har exakt samma
   utseende och funktioner … 3d-editorn blir en kopia på gantt-planeringen från TC").
   3D-editorn visar den här sidan (?embed=gantt) i en iframe: exakt samma Gantt, samma kod, samma regler. Sidan runtom skickar projekt, token och källa
   (postMessage) och får tillbaka händelser: ändringar sparade (så att 3D-vyn läser om), markera aktivitet i 3D. Ingen Trimble Connect-anslutning behövs. */
(() => {
  if (typeof EMBED_GANTT === "undefined" || !EMBED_GANTT) return;
  document.documentElement.classList.add("embed-gantt");
  const st = document.createElement("style");
  st.textContent = `
html.embed-gantt body{margin:0}
html.embed-gantt #appGuide, html.embed-gantt #ganttTimeRow, html.embed-gantt .gdd[data-dd="mode"], html.embed-gantt .gdd[data-dd="time"], html.embed-gantt header, html.embed-gantt #planSourceBar, html.embed-gantt #watchBanner, html.embed-gantt .panel:not([data-panel-id="gantt"]),
html.embed-gantt #filterModelsBtn, html.embed-gantt label:has(#filterModelsBtn), html.embed-gantt label:has(#filterEndDate),
html.embed-gantt #ganttModeSeg, html.embed-gantt #ganttLoadModelsBtn, html.embed-gantt #ganttOpen3d, html.embed-gantt #ganttPhotoBtn, html.embed-gantt #ganttAssemblyBtn,
html.embed-gantt [data-gantt-view="montage"], html.embed-gantt .gantt-time-menu-wrap, html.embed-gantt #ganttScaleBtn, html.embed-gantt #ganttExactBtn,
html.embed-gantt #ganttStrictBtn, html.embed-gantt #ganttTimeAuto, html.embed-gantt #ganttFsTime, html.embed-gantt #ganttHelp, html.embed-gantt .panel[data-panel-id="gantt"] > h2{display:none!important}
html.embed-gantt .panel[data-panel-id="gantt"]{margin:0!important;border-radius:0!important;box-shadow:none!important;border-width:0!important}`;
  document.head.appendChild(st);
  const post = m => { try { window.parent.postMessage(m, "*"); } catch (e) { /* ingen förälder */ } };
  let initRes = null; const initP = new Promise(r => { initRes = r; });
  window.addEventListener("message", ev => {
    if (ev.source !== window.parent) return; const m = ev.data || {};
    if (m.t === "init") initRes(m);
    else if (m.t === "refresh") { const b = document.getElementById("ganttRefreshBtn"); if (typeof embedBusy !== "undefined" && embedBusy) return; if (b) b.click(); else if (typeof refreshAll === "function") refreshAll(); }
  });
  /* "API" utan Trimble Connect: alla anrop går att göra men gör inget. */
  const nop = new Proxy(function () {}, { get: (t, k) => (k === "then" ? undefined : nop), apply: () => Promise.resolve(undefined) });
  window.embedBoot = async function () {
    API = nop;
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
  window.selectActivityInModel = sel; window.selectGanttItemInModel = sel;
})();
