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
  setInterval(() => send(false), 250);
  window.addEventListener("pagehide", () => { try { ch.postMessage({ t: "state", mode: "off", date: "" }); } catch (e) { /* */ } });
  send(true);
})();
