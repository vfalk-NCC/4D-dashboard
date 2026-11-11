/* Gantt-schemat i ett eget fönster (Victor 2026-11-11: "går gantten fristående i ett annat internetfönster – i TC?").
   Knappen ⧉ i Gantt-schemats rad öppnar gantt-popup.html, som visar Gantten i inbäddat läge (?embed=gantt). Den här dashboarden (i Trimble Connect) är kvar som "värd": den styr modellen
   (Kopplade/Tid/färger/markera i modellen) och skickar projekt, token och uppdateringar till fönstret; fönstret skickar tillbaka ändringar och "markera i modellen".
   Öppnar Trimble Connect inte nya fönster från tillägget visas ett meddelande. */
(() => {
  if (typeof EMBED_GANTT !== "undefined" && EMBED_GANTT) return;
  const pop = { w: null, timer: null };
  const on = () => !!(pop.w && !pop.w.closed);
  const send = m => { try { if (on()) pop.w.postMessage({ dpop: true, msg: m }, location.origin); } catch (e) { /* ingen */ } };
  window.dashPopSend = send; window.dashPopOn = on;
  function open() {
    if (on()) { pop.w.focus(); return; }
    let w = null; try { w = window.open("gantt-popup.html", "dash-gantt-popup", "popup=yes,width=1500,height=900"); } catch (e) { /* blockerad */ }
    if (!w) { if (typeof modelToast === "function") modelToast("Trimble Connect eller webbläsaren tillät inte ett nytt fönster från tillägget – tillåt popup-fönster, eller öppna 4D-planeringens 3D-editor och använd Gantten där."); return; }
    pop.w = w; clearInterval(pop.timer); pop.timer = setInterval(() => { if (!on()) { clearInterval(pop.timer); paint(); } }, 1500); paint();
    if (typeof modelToast === "function") modelToast("Gantten är öppnad i ett eget fönster – synkad med dashboarden.");
  }
  function paint() { const b = document.getElementById("ganttPopBtn"); if (b) { b.classList.toggle("on", on()); b.setAttribute("aria-pressed", String(on())); } }
  window.addEventListener("message", ev => {
    if (ev.origin !== location.origin || !ev.data || !ev.data.dpop || ev.source !== pop.w) return; const m = ev.data.msg || {};
    if (m.t === "ready") send({ t: "init", project: projectId, projectName: projectName || "", token: settings.githubToken || "", userName: settings.userName || "", planSource });
    else if (m.t === "loaded") { send({ t: "compact", on: false }); send({ t: "focus", ids: [...ganttModelSel], any: ganttModelSel.size > 0 }); }
    else if (m.t === "changed") { clearTimeout(pop.dt); pop.dt = setTimeout(() => { if (typeof refreshAll === "function") refreshAll(); }, 700); }
    else if (m.t === "select") { const set = new Set((m.ids || []).map(String)), members = items.filter(it => set.has(String(it.id))); if (members.length) selectActivityInModel({ members }); }
    else if (m.t === "popupClosed") { pop.w = null; clearInterval(pop.timer); paint(); }
  });
  /* Sparar värden något → fönstret läser om. Markeras något i modellen → fönstret hoppar dit. */
  if (typeof ghWriteJSON === "function") { const w0 = ghWriteJSON; ghWriteJSON = window.ghWriteJSON = async function (...a) { const r = await w0.apply(this, a); if (on() && /plan_item/.test(String(a[1] || ""))) { clearTimeout(pop.wt); pop.wt = setTimeout(() => send({ t: "refresh" }), 800); } return r; }; }
  if (typeof syncGanttFromModel === "function") { const s0 = syncGanttFromModel; syncGanttFromModel = window.syncGanttFromModel = async function (...a) { const r = await s0.apply(this, a); if (on()) send({ t: "focus", ids: [...ganttModelSel], any: ganttModelSel.size > 0 }); return r; }; }
  const mount = () => {
    if (document.getElementById("ganttPopBtn")) return; const row = document.querySelector(".gantt-head-row"), sp = row && row.querySelector(".gantt-head-spacer"); if (!row) return;
    const b = document.createElement("button"); b.type = "button"; b.id = "ganttPopBtn"; b.className = "gantt-toolbar-btn"; b.title = "Eget fönster – öppna Gantten i ett eget webbläsarfönster (t.ex. på en andra skärm), synkat med dashboarden"; b.textContent = "⧉ Eget fönster"; b.onclick = open;
    sp ? row.insertBefore(b, sp.nextSibling) : row.appendChild(b); paint();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
