/* Kommandorad / aktivitetslogg (Victor 2026-10-16: "som kommandoraden i AutoCAD – så att jag kan följa vad 4D-dashboarden pysslar med och dela med mig").
   Loggar det som tar tid: datahämtning (fil, antal rader, ms), ritning, anrop mot Trimble Connect, frysningar av sidan, fel.
   Alltid igång i bakgrunden (billigt: en ringbuffert), syns först när panelen öppnas (knappen »_ nere till vänster, eller Ctrl+Alt+L).
   Kommandon i raden: hjälp, status, mät, långsamma, kopiera, spara, rensa, nivå <ms>. Rör inga data och ändrar inget beteende. */
(function () {
  "use strict";
  if (window.__dcon) return;
  const MAX = 2000, buf = [], slowAt = { v: 15 };
  let open = false, depth = 0, last = "", t0 = performance.now(), el = null, listEl = null, inEl = null, dirty = false;
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const stamp = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  const fmtMs = ms => ms >= 1000 ? (ms / 1000).toFixed(2).replace(".", ",") + " s" : Math.round(ms) + " ms";
  function log(text, o = {}) {
    const e = { d: new Date(), text: String(text), ms: o.ms == null ? null : o.ms, kind: o.kind || "", depth: o.depth || 0 };
    buf.push(e); if (buf.length > MAX) buf.splice(0, buf.length - MAX);
    dirty = true; if (open) schedule();
  }
  let sched = 0;
  function schedule() { if (sched) return; sched = setTimeout(() => { sched = 0; paint(); }, 120); }
  const fmt = e => `${stamp(e.d)}  ${"  ".repeat(e.depth)}${e.kind === "slow" ? "⚠ " : e.kind === "vslow" ? "‼ " : e.kind === "err" ? "✖ " : ""}${e.text}${e.ms != null ? `  ${fmtMs(e.ms)}` : ""}`;
  const dump = () => header() + "\n" + buf.map(fmt).join("\n");
  function counts() {
    const c = {};
    try { c.objekt = typeof items !== "undefined" ? items.length : "?"; } catch (e) { c.objekt = "?"; }
    try { c.kopplade = typeof items !== "undefined" ? items.filter(x => x.modelId).length : "?"; } catch (e) { c.kopplade = "?"; }
    try { c.filtrerade = typeof getFilteredItems === "function" ? getFilteredItems().length : "?"; } catch (e) { c.filtrerade = "?"; }
    try { c.visade = typeof ganttShownItems !== "undefined" ? ganttShownItems.length : "?"; } catch (e) { c.visade = "?"; }
    try { c.aktiviteter = typeof mergeActivityGroups === "function" && typeof items !== "undefined" ? mergeActivityGroups(items.slice()).length : "?"; } catch (e) { c.aktiviteter = "?"; }
    c.dom = document.getElementsByTagName("*").length;
    c.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : "?";
    try { c.vy = `${typeof ganttView !== "undefined" ? ganttView : "?"}/${typeof ganttMode !== "undefined" ? ganttMode : "?"}`; } catch (e) { /* ignorera */ }
    return c;
  }
  function header() {
    const c = counts(); let v = "?"; try { v = (document.querySelector('script[src^="app.js"]').src.match(/v=(\d+)/) || [])[1] || "?"; } catch (e) { /* ignorera */ }
    return `4D-dashboard logg · version ${v} · ${new Date().toLocaleString("sv-SE")}\nObjekt ${c.objekt} (kopplade ${c.kopplade}) · filtrerade ${c.filtrerade} · visade ${c.visade} · aktiviteter ${c.aktiviteter} · DOM-element ${c.dom} · minne ${c.heapMB} MB · vy ${c.vy}\n${navigator.userAgent}\n${"-".repeat(60)}`;
  }

  /* ---- Mätning av funktioner ---- */
  const KEY = /^(initApp|refreshAll|renderAll|renderGantt|renderGanttBoard|getFilteredItems|populateFilterOptions|applyGanttIsolate|syncGanttFromModel|qmfSyncLoad|mergeActivityGroups)$/;
  const ALWAYS = /^(initApp|refreshAll|renderAll|renderGantt|renderGanttBoard)$/; // loggas alltid, övriga bara över tröskeln
  const PREFIX = /^(render|fetch|refresh|populate|update|apply|sync|compute|bind|load|save|build|select|isolate|print|draw|ganttTime|bubbles|vid|phb|qmf)[A-Z_]/;
  function argInfo(name, args) {
    const a = args[0];
    if (Array.isArray(a)) return ` (${a.length} st)`;
    if (typeof a === "string" && a.length < 60 && /^(fetch|load|save)/.test(name)) return ` ${a}`;
    return "";
  }
  function wrapFn(name, fn, always) {
    const calls = { n: 0, t: performance.now() };
    const w = function () {
      if (!always && ++calls.n > 400 && performance.now() - calls.t < 4000) { // anropas i en slinga – mäts inte (annars bara brus och overhead)
        try { if (window[name] === w) window[name] = fn; } catch (e) { /* ignorera */ } log(`${name}: anropas ofta – mäts inte längre`); return fn.apply(this, arguments);
      }
      const s = performance.now(), d = depth, info = argInfo(name, arguments); depth++;
      const done = (err) => { depth = d; const ms = performance.now() - s; if (always || ms >= slowAt.v) log(`${name}${info}${err ? " – FEL " + (err.message || err) : ""}`, { ms, depth: d, kind: err ? "err" : ms >= 1000 ? "vslow" : ms >= 250 ? "slow" : "" }); };
      let r;
      try { r = fn.apply(this, arguments); } catch (e) { done(e); throw e; }
      if (r && typeof r.then === "function") { depth = d; r.then(() => done(), e => done(e)); return r; }
      done(); return r;
    };
    try { Object.defineProperty(w, "name", { value: name }); } catch (e) { /* ignorera */ }
    return w;
  }
  function instrument() {
    let n = 0;
    Object.getOwnPropertyNames(window).forEach(name => {
      if (!/^[a-z]/.test(name) || name === "dlog" || !(KEY.test(name) || PREFIX.test(name))) return;
      let d; try { d = Object.getOwnPropertyDescriptor(window, name); } catch (e) { return; }
      const fn = d && d.value; if (typeof fn !== "function" || !d.writable) return;
      let src = ""; try { src = Function.prototype.toString.call(fn); } catch (e) { return; }
      if (/\[native code\]/.test(src) || (src.length < 220 && !KEY.test(name))) return;
      try { window[name] = wrapFn(name, fn, ALWAYS.test(name)); n++; } catch (e) { /* ignorera */ }
    });
    log(`Mätning på ${n} funktioner (visar steg över ${slowAt.v} ms)`);
  }
  /* GitHub-filer: namn, antal rader, tid. */
  function instrumentGh() {
    ["ghGetFile", "ghWriteJSON", "ghPutFile"].forEach(name => {
      const fn = window[name]; if (typeof fn !== "function") return;
      window[name] = function (token, path) {
        const s = performance.now(), short = String(path || "").replace(/^projects\/[^/]+\//, ""), a = arguments;
        const r = fn.apply(this, a);
        if (r && typeof r.then === "function") r.then(res => {
          const ms = performance.now() - s, rows = name === "ghGetFile" && res && Array.isArray(res.data) ? `, ${res.data.length} rader` : "";
          log(`${name === "ghGetFile" ? "Hämtar" : name === "ghWriteJSON" ? "Sparar" : "Skriver"} ${short}${rows}`, { ms, kind: ms >= 1500 ? "vslow" : ms >= 500 ? "slow" : "" });
        }, e => log(`${name} ${short} – FEL ${e && e.message}`, { ms: performance.now() - s, kind: "err" }));
        return r;
      };
    });
  }
  /* Trimble Connect-anrop (bara tidtagning, anropen går vidare oförändrade). */
  function instrumentTc() {
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const V = typeof API !== "undefined" && API && API.viewer;
      if (!V) { if (tries > 120) clearInterval(t); return; }
      clearInterval(t);
      let n = 0;
      ["getSelection", "setSelection", "setObjectState", "isolateEntities", "getObjectBoundingBoxes", "convertToObjectIds", "convertToObjectRuntimeIds", "getSnapshot", "getCamera", "setCamera", "getModels", "getObjects", "getObjectProperties", "toggleModel"].forEach(m => {
        const f = V[m]; if (typeof f !== "function") return;
        try {
          V[m] = function () {
            const s = performance.now(), a = arguments; let cnt = "";
            try { const x = a[0] && (a[0].modelObjectIds || a[0]); const k = Array.isArray(x) ? x : null; if (k) cnt = " (" + k.reduce((q, y) => q + (y && y.objectRuntimeIds ? y.objectRuntimeIds.length : 1), 0) + " obj)"; else if (Array.isArray(a[1])) cnt = ` (${a[1].length} obj)`; } catch (e) { /* ignorera */ }
            const r = f.apply(this, a);
            if (r && typeof r.then === "function") r.then(() => { const ms = performance.now() - s; if (ms >= slowAt.v) log(`TC ${m}${cnt}`, { ms, kind: ms >= 1500 ? "vslow" : ms >= 500 ? "slow" : "" }); }, e => log(`TC ${m} – FEL ${e && (e.message || e)}`, { ms: performance.now() - s, kind: "err" }));
            return r;
          }; n++;
        } catch (e) { /* skrivskyddat – hoppar över */ }
      });
      log(`Trimble Connect ansluten – mäter ${n} anrop`);
    }, 500);
  }

  /* ---- Frysningar, fel, minne ---- */
  try { new PerformanceObserver(l => l.getEntries().forEach(e => { if (e.duration >= 120) log("Sidan var upptagen (ingen respons)", { ms: e.duration, kind: e.duration >= 1000 ? "vslow" : "slow" }); })).observe({ entryTypes: ["longtask"] }); } catch (e) { /* stöds inte */ }
  window.addEventListener("error", e => log(`Fel: ${e.message} (${String(e.filename || "").split("/").pop()}:${e.lineno})`, { kind: "err" }));
  window.addEventListener("unhandledrejection", e => log(`Fel (löfte): ${e.reason && (e.reason.message || e.reason)}`, { kind: "err" }));
  let lastHeap = 0;
  setInterval(() => { if (!performance.memory) return; const h = Math.round(performance.memory.usedJSHeapSize / 1048576); if (Math.abs(h - lastHeap) >= 50) { log(`Minne ${h} MB (${h > lastHeap ? "+" : ""}${h - lastHeap})`); lastHeap = h; } }, 5000);

  /* ---- Kommandon ---- */
  function bench() {
    const out = [], run = (nm, f) => { const s = performance.now(); let r; try { r = f(); } catch (e) { r = "fel " + e.message; } out.push(`${nm}: ${fmtMs(performance.now() - s)}${typeof r === "number" ? ` (${r} st)` : ""}`); };
    run("getFilteredItems", () => getFilteredItems().length);
    run("mergeActivityGroups(alla)", () => mergeActivityGroups(items.slice()).length);
    run("renderGantt", () => { renderGantt(getFilteredItems()); return 0; });
    run("renderAll", () => { renderAll(); return 0; });
    out.forEach(l => log("mät → " + l));
  }
  function slowest() {
    const m = new Map(); buf.forEach(e => { if (e.ms == null) return; const k = e.text.replace(/\(\d+ st\)/, "").trim(); const c = m.get(k) || { n: 0, tot: 0, max: 0 }; c.n++; c.tot += e.ms; c.max = Math.max(c.max, e.ms); m.set(k, c); });
    [...m.entries()].sort((a, b) => b[1].tot - a[1].tot).slice(0, 15).forEach(([k, c]) => log(`${k} · ${c.n}× · totalt ${fmtMs(c.tot)} · längst ${fmtMs(c.max)}`));
  }
  async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (x) { /* ignorera */ } ta.remove(); return ok; } }
  function save() { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([dump()], { type: "text/plain" })); a.download = `4d-dashboard-logg-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.txt`; document.body.appendChild(a); a.click(); a.remove(); }
  const CMDS = {
    hjälp: () => ["hjälp – den här listan", "status – antal objekt, DOM, minne, vy", "mät – tidtagning av filter, sammanslagning och ritning (kan ta några sekunder)", "långsamma – de steg som tagit mest tid", "kopiera – kopierar hela loggen (klistra in i chatten)", "spara – laddar ner loggen som .txt", "rensa – tömmer loggen", "nivå <ms> – visa bara steg över så många ms (nu " + slowAt.v + ")"].forEach(l => log(l)),
    status: () => { const c = counts(); log(`objekt ${c.objekt} · kopplade ${c.kopplade} · filtrerade ${c.filtrerade} · visade ${c.visade} · aktiviteter ${c.aktiviteter}`); log(`DOM-element ${c.dom} · minne ${c.heapMB} MB · vy ${c.vy} · uppe ${fmtMs(performance.now() - t0)}`); },
    mät: () => { log("mät …"); setTimeout(bench, 30); },
    långsamma: slowest,
    kopiera: async () => log((await copy(dump())) ? `Loggen kopierad (${buf.length} rader) – klistra in i chatten` : "Kunde inte kopiera – använd 'spara'"),
    spara: () => { save(); log("Loggen sparad som .txt"); },
    rensa: () => { buf.length = 0; paint(true); },
    nivå: a => { const v = Number(a); if (!isFinite(v) || v < 0) { log("nivå <ms>, t.ex. nivå 50"); return; } slowAt.v = v; log(`Visar steg över ${v} ms (gäller nya händelser)`); }
  };
  CMDS.hjalp = CMDS.hjälp; CMDS.langsamma = CMDS.långsamma; CMDS.mat = CMDS.mät; CMDS.niva = CMDS.nivå;
  function run(line) {
    const [c, ...rest] = line.trim().split(/\s+/); if (!c) return;
    log(`Kommando: ${line.trim()}`, { kind: "cmd" });
    const f = CMDS[c.toLowerCase()]; if (!f) { log(`Okänt kommando "${c}" – skriv hjälp`); return; }
    try { const r = f(rest.join(" ")); if (r && r.catch) r.catch(e => log("Fel: " + e.message, { kind: "err" })); } catch (e) { log("Fel: " + e.message, { kind: "err" }); }
  }

  /* ---- Panelen ---- */
  function build() {
    const btn = document.createElement("button"); btn.type = "button"; btn.id = "dconBtn"; btn.textContent = "»_"; btn.title = "Kommandorad / logg (Ctrl+Alt+L)"; btn.setAttribute("aria-label", "Öppna kommandoraden");
    btn.onclick = () => toggle();
    el = document.createElement("div"); el.id = "dcon"; el.className = "hidden"; el.setAttribute("role", "log");
    el.innerHTML = `<div class="dcon-bar"><b>4D-dashboard · logg</b><span class="dcon-sp"></span><button type="button" data-c="kopiera" title="Kopiera hela loggen">Kopiera</button><button type="button" data-c="spara">Spara</button><button type="button" data-c="långsamma">Långsamma</button><button type="button" data-c="rensa">Rensa</button><button type="button" class="dcon-x" aria-label="Stäng">✕</button></div><div class="dcon-list"></div><div class="dcon-in"><span>Kommando:</span><input type="text" spellcheck="false" autocomplete="off" placeholder="hjälp, status, mät, kopiera …" /></div>`;
    document.body.appendChild(btn); document.body.appendChild(el);
    listEl = el.querySelector(".dcon-list"); inEl = el.querySelector("input");
    el.querySelectorAll("[data-c]").forEach(b => { b.onclick = () => run(b.dataset.c); });
    el.querySelector(".dcon-x").onclick = () => toggle(false);
    const hist = []; let hi = 0;
    inEl.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Enter") { const v = inEl.value; if (v.trim()) { hist.push(v); hi = hist.length; } inEl.value = ""; run(v); }
      else if (e.key === "ArrowUp") { if (hi > 0) inEl.value = hist[--hi] || ""; e.preventDefault(); }
      else if (e.key === "ArrowDown") { inEl.value = hi < hist.length - 1 ? hist[++hi] : (hi = hist.length, ""); e.preventDefault(); }
      else if (e.key === "Escape") toggle(false);
    });
    ["keyup", "keypress"].forEach(ev => inEl.addEventListener(ev, e => e.stopPropagation()));
    try { if (localStorage.getItem("4ddash-console") === "1") toggle(true); } catch (e) { /* ignorera */ }
  }
  function paint(force) {
    if (!listEl || (!dirty && !force)) return; dirty = false;
    const atEnd = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 30;
    const rows = buf.slice(-400);
    listEl.innerHTML = rows.map(e => `<div class="dcon-l ${e.kind}">${fmt(e).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`).join("");
    if (atEnd) listEl.scrollTop = listEl.scrollHeight;
  }
  function toggle(on) {
    open = on === undefined ? !open : !!on; el.classList.toggle("hidden", !open);
    try { localStorage.setItem("4ddash-console", open ? "1" : "0"); } catch (e) { /* ignorera */ }
    if (open) { paint(true); listEl.scrollTop = listEl.scrollHeight; setTimeout(() => inEl.focus(), 0); }
  }
  document.addEventListener("keydown", e => { if (e.ctrlKey && e.altKey && (e.key === "l" || e.key === "L")) { e.preventDefault(); toggle(); } }, true);

  window.dlog = log; window.__dcon = { log, dump, run, buf, toggle };
  const start = () => { build(); instrumentGh(); instrument(); instrumentTc(); log(`Start · sidan laddad på ${fmtMs(performance.now())}`); };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
