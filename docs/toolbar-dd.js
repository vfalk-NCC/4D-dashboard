/* Gantt-schemats verktygsrad som fyra rullgardiner (Victor 2026-10-19: "skapa 4-dropdowns för de här knapparna istället, blir plottrigt nu").
   De befintliga knapparna FLYTTAS in i rullgardinerna (samma element, samma funktion och tillstånd) och får en text bredvid ikonen:
   3D-läge · Modeller och utdata · Tid och färg · Verktyg. Knapparna Dölj knappar och Helskärm ligger kvar i raden. */
(function () {
  "use strict";
  const bar = document.querySelector(".gantt-fs-bar");
  if (!bar || bar.dataset.dd) return;
  bar.dataset.dd = "1";
  const $ = id => document.getElementById(id);
  const ICONS = {
    out: '<path d="M10 3v9m0 0-3-3m3 3 3-3M4 13v3h12v-3"/>',
    time: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 1.5"/>',
    tools: '<path d="M4 6h12M4 10h12M4 14h12"/><circle cx="7" cy="6" r="1.6" fill="currentColor"/><circle cx="13" cy="10" r="1.6" fill="currentColor"/><circle cx="8" cy="14" r="1.6" fill="currentColor"/>'
  };
  const svg = p => `<svg class="gp-svg" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const dds = [];
  function make(key, label, icon, nodes) {
    const w = document.createElement("div"); w.className = "gdd"; w.dataset.dd = key;
    const b = document.createElement("button"); b.type = "button"; b.className = "gdd-btn"; b.setAttribute("aria-haspopup", "true"); b.setAttribute("aria-expanded", "false"); b.title = label;
    b.innerHTML = `<span class="gdd-ic">${icon}</span><span class="gdd-t">${label}</span><span class="gdd-car">▾</span>`;
    const m = document.createElement("div"); m.className = "gdd-menu hidden"; m.setAttribute("role", "menu");
    nodes.filter(Boolean).forEach(n => m.appendChild(n));
    w.appendChild(b); w.appendChild(m);
    b.onclick = e => { e.stopPropagation(); toggle(w); };
    m.addEventListener("click", e => { // ett val stänger menyn – utom färg- och visningsmenyn som ligger öppen inne i den
      if (e.target.closest("#ganttTimeMenu") || e.target.closest("#ganttTimeMenuBtn")) return;
      if (e.target.closest("button, label")) setTimeout(() => close(w), 0);
    });
    dds.push({ w, b, m, label, key });
    return w;
  }
  function close(w) { const d = dds.find(x => x.w === w); if (!d) return; d.m.classList.add("hidden"); d.b.setAttribute("aria-expanded", "false"); w.classList.remove("open"); }
  function closeAll(except) { dds.forEach(d => { if (d.w !== except) close(d.w); }); }
  function toggle(w, on) {
    const d = dds.find(x => x.w === w); if (!d) return;
    const open = on === undefined ? d.m.classList.contains("hidden") : on;
    closeAll(open ? w : null);
    d.m.classList.toggle("hidden", !open); d.b.setAttribute("aria-expanded", String(open)); w.classList.toggle("open", open);
  }
  /* Text i menyraden: titeln före " – " är namnet, resten en liten förklaring. */
  const DESC = {
    ganttFsTime: ["Tidslinjedragare", "av/på – 3D följer med"], ganttOpen3d: ["3D-editorn", "öppna lägesplanen i eget fönster"], ganttPhotoBtn: ["Foto med bubblor", "ta bild av 3D-vyn med aktiviteterna"],
    ganttAskAi: ["Fråga AI", "skapa HTML till Claude och läs in omplaneringen"], ganttViewsBtn: ["Vyer", "spara och hämta hur schemat ser ut"], dpOpenBtn: ["Dagsplan UE", "importera, justera och exportera till HTML"],
    ganttAutoCoupleBtn: ["Auto-koppla", "koppla aktiviteter till 3D-objekt från koder i namnen"], ganttAssemblyBtn: ["Montageordning", "stega genom aktiviteterna i byggordning med 3D-modellen"], ganttLoadModelsBtn: ["Modeller", "läs in modellerna aktiviteterna är kopplade till"], ganttPpExportBtn: ["Till Powerproject", "exportera aktiviteter (MS Project-XML)"],
    ganttPrintBtn: ["Skriv ut", "skriv ut eller spara som PDF"], ganttFullBtn: ["Helskärm", "visa schemat i helskärm (Esc stänger)"],
    ganttTimeAuto: ["Hela spannet", "anpassa tidsaxeln automatiskt"], ganttScaleBtn: ["Färgskala efter datum", "tidig → sen start mellan två färger"], ganttStrictBtn: ["Följ datum", "färg strikt efter start och slut, inte framdrift"]
  };
  function label(btn, name, desc) {
    if (DESC[btn.id] && name === undefined && desc === undefined) { name = DESC[btn.id][0]; desc = DESC[btn.id][1]; }
    if (btn.querySelector(".gdd-lbl")) return;
    const t = String(btn.getAttribute("title") || ""), i = t.indexOf(" – ");
    const nm = name || btn.getAttribute("aria-label") || (i > 0 ? t.slice(0, i) : t), ds = desc !== undefined ? desc : (i > 0 ? t.slice(i + 3) : "");
    btn.querySelectorAll(".gfs-l").forEach(x => x.remove());
    const sp = document.createElement("span"); sp.className = "gdd-lbl"; sp.innerHTML = `<b>${nm.replace(/</g, "&lt;")}</b>${ds ? `<small>${ds.replace(/</g, "&lt;").slice(0, 90)}</small>` : ""}`;
    btn.appendChild(sp);
  }
  const seg = $("ganttModeSeg"), g2 = [...bar.querySelectorAll(":scope > .gfs-grp")];
  const grpA = g2[0], grpB = g2[1];
  [...bar.querySelectorAll(":scope > .gfs-sep")].forEach(x => x.remove());

  // 1. 3D-läge
  if (seg) { seg.querySelectorAll("button").forEach(b => label(b)); }
  const d1 = make("mode", "3D-läge", "", [seg]);
  // 2. Modeller och utdata
  const outBtns = ["ganttAutoCoupleBtn", "ganttAssemblyBtn", "ganttLoadModelsBtn", "ganttPpExportBtn", "ganttPrintBtn", "ganttFullBtn"].map($).filter(Boolean);
  outBtns.forEach(b => label(b));
  const d2 = make("out", "Modeller", svg(ICONS.out), outBtns);
  // 3. Tid och färg (färg- och visningsmenyn ligger öppen inne i rullgardinen)
  const wrap = document.querySelector(".gantt-time-menu-wrap");
  const timeBtns = ["ganttTimeAuto", "ganttScaleBtn", "ganttStrictBtn"].map($).filter(Boolean);
  timeBtns.forEach(b => label(b));
  const tmb = $("ganttTimeMenuBtn"); if (tmb) label(tmb, "Färger och visning", "färger, opacitet, kommande, pulsera, markera pågående");
  const d3 = make("time", "Tid och färg", svg(ICONS.time), [...timeBtns, wrap]);
  // 4. Verktyg
  const toolBtns = ["ganttFsTime", "ganttOpen3d", "ganttPhotoBtn", "ganttAskAi", "ganttViewsBtn", "ganttRefreshBtn", "dpOpenBtn"].map($).filter(Boolean);
  toolBtns.forEach(b => { if (b.id === "ganttRefreshBtn") { b.classList.add("gdd-keeptext"); } else label(b); });
  const d4 = make("tools", "Verktyg", svg(ICONS.tools), toolBtns);

  const first = bar.firstChild;
  [d1, d2, d3, d4].forEach(d => bar.insertBefore(d, first));
  if (grpA && !grpA.children.length) grpA.remove(); if (grpB && !grpB.children.length && !grpB.querySelector("*")) grpB.remove();
  // Ordning: dropdowns först, sedan Dölj knappar / Helskärm kvar i raden.

  /* Knappen för 3D-läget visar läget (ikon + namn); övriga lyser när något i dem är påslaget. */
  const modeBtn = d1.querySelector(".gdd-btn");
  function paintMode() {
    const on = seg && seg.querySelector('button[aria-pressed="true"]'); if (!on) return;
    modeBtn.querySelector(".gdd-ic").innerHTML = on.querySelector("svg") ? on.querySelector("svg").outerHTML : "";
    modeBtn.querySelector(".gdd-t").textContent = "3D: " + (on.getAttribute("aria-label") || "läge");
    modeBtn.classList.toggle("on", on.dataset.gmode !== "off");
  }
  function paintOn() {
    d3.querySelector(".gdd-btn").classList.toggle("on", !!((($("ganttStrictBtn") || {}).getAttribute && $("ganttStrictBtn").getAttribute("aria-pressed") === "true") || ($("ganttScaleBtn") && $("ganttScaleBtn").classList.contains("on"))));
    d4.querySelector(".gdd-btn").classList.toggle("on", !!($("ganttFsTime") && $("ganttFsTime").getAttribute("aria-pressed") === "true"));
  }
  const mo = new MutationObserver(() => { paintMode(); paintOn(); });
  [seg, $("ganttStrictBtn"), $("ganttScaleBtn"), $("ganttFsTime")].filter(Boolean).forEach(n => mo.observe(n, { attributes: true, subtree: n === seg, attributeFilter: ["aria-pressed", "class"] }));
  paintMode(); paintOn();

  document.addEventListener("pointerdown", e => { if (!e.target.closest(".gdd")) closeAll(); }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeAll(); });
  window.ganttDdOpen = (key, on = true) => { const d = dds.find(x => x.key === key); if (d) toggle(d.w, on); };
  window.ganttDdCloseAll = () => closeAll();
})();
