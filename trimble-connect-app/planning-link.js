/* Koppling till 4D-planering (Victor 2026-10-14): dashboardens Gantt har högsta prioritet i Trimble Connects 3D-vy.
   Den här filen gör bara två saker, och rör inget annat i dashboarden:
   1) Berättar för 4D-planering (via BroadcastChannel "4d-gantt-link") när Gantten styr 3D-vyn och vilket datum Tid-läget står på –
      då slutar 4D-planering skriva färg/synlighet till modellen (se dashboard-link.js där).
   2) Tar emot datum från 4D-planeringens reglage och flyttar Tid-lägets datum dit – men bara när Gantten står i Tid-läget.
   Allt är inkapslat i try/catch: fungerar inte kanalen går dashboarden som vanligt. */

(function () {
  let ch = null, last = "", lastAt = 0;
  try { if (typeof BroadcastChannel !== "undefined") ch = new BroadcastChannel("4d-gantt-link"); } catch (e) { ch = null; }
  if (!ch) return;
  const state = () => ({ t: "state", mode: typeof ganttMode !== "undefined" ? ganttMode : "off", date: typeof ganttAsOf !== "undefined" && ganttAsOf ? ganttAsOf : "" });
  const send = force => {
    try {
      const m = state(), sig = m.mode + "|" + m.date, now = Date.now();
      if (!force && sig === last && now - lastAt < 3000) return; // ändring direkt, annars en puls var tredje sekund
      last = sig; lastAt = now; ch.postMessage(m);
    } catch (e) { /* ingen kanal */ }
  };
  ch.onmessage = e => {
    try {
      const m = e.data || {};
      if (m.t === "hello") send(true);
      else if (m.t === "setDate" && m.date && typeof ganttMode !== "undefined" && ganttMode === "time" && typeof setGanttAsOf === "function" && m.date !== ganttAsOf) setGanttAsOf(m.date, { now: true });
    } catch (err) { console.warn("Koppling till 4D-planering", err); }
  };
  /* ---- 3D-editorn (lägesplanen) öppnas härifrån (Victor 2026-10-15) ----
     Fönstret frågar sin öppnare (den här sidan) efter token och projekt, och skickar sina övriga förfrågningar (TC-modeller, filer, koppling …)
     hit – de vidarebefordras till 4D-planering över kanalen och svaren skickas tillbaka. Utan 4D-planering öppen i Trimble Connect startar 3D-vyn
     ändå, men utan TC-modeller. */
  const pend = new Map(); let lwin = null;
  window.openLagesplan3d = () => {
    if (typeof projectId === "undefined" || !projectId) { alert("Projektet är inte laddat än."); return; }
    const w = Math.round(screen.availWidth * 0.62), h = screen.availHeight, left = (screen.availLeft || 0) + screen.availWidth - w, top = screen.availTop || 0;
    const url = `${location.origin}/4D-planering/lagesplan.html?project=${encodeURIComponent(projectId)}${typeof planSource !== "undefined" && planSource === "pp" ? "&source=pp" : ""}&view=3d`;
    const win = window.open(url, "lagesplan-" + projectId, `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    if (win) { win.focus(); lwin = win; } else alert("Webbläsaren blockerade fönstret – tillåt popup-fönster för den här sidan.");
  };
  window.addEventListener("message", e => {
    if (e.origin !== location.origin || !e.data || !e.data.lagesplan || !e.source) return;
    const msg = e.data, src = e.source;
    try {
      if (msg.type === "hello") {
        src.postMessage({ lagesplanReply: true, reqId: msg.reqId, settings: { githubToken: (typeof settings !== "undefined" && settings.githubToken) || "" }, projectId: typeof projectId !== "undefined" ? projectId : null, planSource: typeof planSource !== "undefined" ? planSource : "pp" }, location.origin);
        return;
      }
      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      pend.set(id, { src, reqId: msg.reqId });
      ch.postMessage({ t: "relay", id, msg });
      if (msg.type === "planChanged" && typeof refreshAll === "function") setTimeout(() => { try { refreshAll(); } catch (er) { /* */ } }, 600); // lägesplanen har sparat i tidplanen
    } catch (err) { try { src.postMessage({ lagesplanReply: true, reqId: msg.reqId, error: "Kunde inte skicka till 4D-planering: " + err.message }, location.origin); } catch (e2) { /* */ } }
  });
  ch.addEventListener("message", e => {
    const m = e.data || {};
    if (m.t !== "relayReply" && m.t !== "relayProgress") return;
    const p = pend.get(m.id); if (!p) return;
    try {
      if (m.t === "relayProgress") { p.src.postMessage({ lagesplanProgress: true, reqId: p.reqId, f: m.f, got: m.got, total: m.total }, location.origin); return; }
      pend.delete(m.id);
      const pay = m.payload || {}; p.src.postMessage({ lagesplanReply: true, reqId: p.reqId, ...pay }, location.origin, pay.bytes instanceof ArrayBuffer ? [pay.bytes] : []);
    } catch (er) { pend.delete(m.id); }
  });
  setInterval(() => { try { if (lwin && !lwin.closed) lwin.postMessage({ lagesplanPing: true }, location.origin); else lwin = null; } catch (e) { lwin = null; } }, 3000);
  { const b = document.getElementById("ganttOpen3d"); if (b) b.onclick = () => window.openLagesplan3d(); }
  setInterval(() => send(false), 250);
  window.addEventListener("pagehide", () => { try { ch.postMessage({ t: "state", mode: "off", date: "" }); } catch (e) { /* */ } });
  send(true);
})();
