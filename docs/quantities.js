/* Mängdavtagning (Victor 2026-10-14): mängder ur modellen i Trimble Connect för de objekt som Ganttens regel räknar som klara
   (eller alla, eller markeringen i TC), summerade per egenskap – t.ex. betong (m³) per typ, område eller byggnad – för att jämföra
   med mängdförteckningen. Allt läses ur TC:s egna egenskaper (getObjectProperties), bl.a. "Calculated Geometry Values → Volume".
   Inget sparas någonstans; resultatet kan exporteras som CSV (öppnas i Excel). */

const QTY_KEY = "4ddash-qty";
const qty = { cfg: { scope: "gantt", phase: "klar", date: "", from: "", formTop: false, kind: "vol", valKeys: {}, rowKey: "", colKey: "", valKey: "", filter: "", exclude: "", unit: "auto" }, objs: [], keys: new Map(), info: "", busy: false };
try { Object.assign(qty.cfg, JSON.parse(localStorage.getItem(QTY_KEY) || "{}")); } catch (e) { /* standard */ }
/* Mängdslag: Betong (volym m³), Form (yta m²), Kantform/längd (m), Armering/vikt (kg). Varje slag minns sin egenskap. */
const QTY_KINDS = { vol: ["Betong – volym (m³)", "m³", /calculated\s*geometry\s*values\s*\/\s*volume$/i, /volume|volym/i], form: ["Form – sidoyta (m², utan över-/underyta)", "m²", /calculated\s*geometry\s*values\s*\/\s*(total\s*)?surface\s*area$/i, /surface|side\s*area|form|area|yta/i], len: ["Längd (m)", "m", /calculated\s*geometry\s*values\s*\/\s*length$/i, /length|längd/i], kg: ["Armering/vikt (kg)", "kg", /calculated\s*geometry\s*values\s*\/\s*weight$/i, /weight|vikt|mass/i] };
const qtyKind = () => QTY_KINDS[qty.cfg.kind] ? qty.cfg.kind : "vol";
const qtySave = () => { try { localStorage.setItem(QTY_KEY, JSON.stringify(qty.cfg)); } catch (e) { /* ingen lagring */ } };
const qtyEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const qtyNum = v => { if (typeof v === "number") return Number.isFinite(v) ? v : null; if (typeof v !== "string") return null; const n = parseFloat(v.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) && /^[-+]?[\d\s.,]+(e[-+]?\d+)?\s*[a-zA-Zµ²³°%/]*$/i.test(v.trim()) ? n : null; };
const qtyFmt = (n, d = 1) => (Number.isFinite(n) ? n.toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: d }) : "–");
/* Specialnycklar som kommer från aktiviteten i Gantt-schemat i stället för från modellen. */
const QTY_ACT_KEYS = { "◆ Område (hela)": o => o.item.area || "", "◆ Område (sista ledet)": o => String(o.item.area || "").split("/").map(x => x.trim()).filter(Boolean).pop() || "", "◆ Aktivitet": o => o.item.activity || o.item.objectName || "", "◆ Entreprenör": o => o.item.contractor || "", "◆ Modell": o => o.modelId };

/* Alla egenskaper hos ett objekt som en platt lista "Egenskapsgrupp / Egenskap" → värde. */
function qtyFlat(obj) {
  const f = {};
  if (obj.product && obj.product.name) f["Produkt / Namn"] = obj.product.name;
  if (obj.class) f["IFC-klass"] = obj.class;
  (obj.properties || []).forEach(ps => (ps.properties || []).forEach(p => { if (p && p.name !== undefined && p.value !== undefined && p.value !== null && typeof p.value !== "object") f[`${ps.name || "Övrigt"} / ${p.name}`] = p.value; }));
  return f;
}
/* Klar vid valt datum enligt Ganttens regel (räknas vid summeringen, så datumet kan ändras utan att läsa om). */
const qtyAt = () => qty.cfg.date || (typeof ganttAsOf !== "undefined" && ganttAsOf) || todayISO();
/* Läge "Klara under period" (Victor 2026-10-15): det som blev klart mellan Från och Till – klart vid Till men inte redan klart dagen före Från. */
const qtyFrom = () => qty.cfg.phase === "period" ? (qty.cfg.from || addDaysIso(qtyAt(), -6)) : "";
const qtyDone = o => {
  const hasDates = o.item && (o.item.startDate || o.item.endDate), f = qtyFrom();
  if (!hasDates) return !f; // utan datum räknas objektet som klart (som förut), men inte som producerat i en period
  if (ganttPhaseAt(o.item, qtyAt()) !== "klar") return false;
  return !f || ganttPhaseAt(o.item, addDaysIso(f, -1)) !== "klar";
};
const qtyActive = o => qty.cfg.scope === "sel" || (qty.cfg.phase !== "klar" && qty.cfg.phase !== "period") || qtyDone(o);
function qtyObjects() {
  const base = qty.cfg.scope === "all" ? items : (typeof ganttShownItems !== "undefined" ? ganttShownItems : items).flatMap(it => it.members || [it]);
  const seen = new Set(), out = [];
  base.forEach(m => {
    if (!m.modelId || !m.objectId) return;
    const k = `${m.modelId}|${m.objectId}`; if (seen.has(k)) return; seen.add(k);
    out.push({ modelId: m.modelId, objectId: String(m.objectId), item: m });
  });
  return out;
}
async function qtySelectionObjects() {
  const V = API && API.viewer, sel = await V.getSelection(), out = [];
  (sel || []).forEach(s => (s.objectRuntimeIds || []).forEach(rid => out.push({ modelId: s.modelId, rid, objectId: "", item: {} })));
  return out;
}
async function qtyRead() {
  if (qty.busy) return;
  const V = API && API.viewer;
  if (!V || typeof V.getObjectProperties !== "function") { qtyMsg("Mängdavtagning kräver Trimble Connect-vyn."); return; }
  qty.busy = true; qtyBusyUi(true);
  try {
    const targets = qty.cfg.scope === "sel" ? await qtySelectionObjects() : qtyObjects();
    if (!targets.length) { qtyMsg(qty.cfg.scope === "sel" ? "Inget är markerat i TC." : "Inga objekt matchar urvalet (kolla datum och Ganttens filter)."); qty.objs = []; qtyRender(); return; }
    const byModel = new Map(); targets.forEach(t => (byModel.get(t.modelId) || byModel.set(t.modelId, []).get(t.modelId)).push(t));
    const objs = []; let missing = 0, n = 0;
    for (const [modelId, list] of byModel) {
      if (qty.cfg.scope !== "sel") {
        const r = await dashRuntimeIds(V, modelId, list.map(t => t.objectId));
        if (r.modelFailed) { missing += list.length; continue; }
        list.forEach(t => { t.rid = r.map.get(t.objectId); });
      }
      const ok = list.filter(t => t.rid !== null && t.rid !== undefined); missing += list.length - ok.length;
      for (let i = 0; i < ok.length; i += 150) {
        const chunk = ok.slice(i, i + 150), props = await V.getObjectProperties(modelId, chunk.map(t => t.rid)), byId = new Map((props || []).map(p => [p.id, p]));
        chunk.forEach(t => { const p = byId.get(t.rid); if (!p) { missing++; return; } objs.push({ ...t, flat: qtyFlat(p) }); });
        n += chunk.length; qtyMsg(`Läser egenskaper: ${n} av ${targets.length}…`);
      }
    }
    qty.objs = objs; qty.missing = missing;
    // Vilka egenskaper som finns (och hur många objekt som har dem) – för valen nedan.
    const keys = new Map(); objs.forEach(o => Object.entries(o.flat).forEach(([k, v]) => { const e = keys.get(k) || { n: 0, num: 0, sample: v }; e.n++; if (qtyNum(v) !== null) e.num++; keys.set(k, e); }));
    qty.keys = keys;
    qtyPickDefaults();
    await qtyUnitCheck();
    qtyMsg(`${objs.length} objekt lästa${missing ? ` · ${missing} hittades inte i de inlästa modellerna` : ""}.`);
  } catch (e) { console.warn("Mängdavtagning", e); qtyMsg("Kunde inte läsa egenskaper: " + ((e && (e.message || e.error)) || "Trimble Connect svarade inte")); }
  finally { qty.busy = false; qtyBusyUi(false); qtyRender(); }
}
function qtyNumKeys() { return [...qty.keys].filter(([, e]) => e.num >= Math.max(1, e.n * 0.8)).map(([k]) => k); }
function qtyPickDefaults() {
  const nk = qtyNumKeys(), all = [...qty.keys.keys()], K = QTY_KINDS[qtyKind()];
  const want = qty.cfg.valKeys && qty.cfg.valKeys[qtyKind()];
  qty.cfg.valKey = want && qty.keys.has(want) ? want : (nk.find(k => K[2].test(k)) || nk.find(k => K[3].test(k)) || nk[0] || "");
  const okRow = k => k === "" || qty.keys.has(k) || QTY_ACT_KEYS[k];
  if (!okRow(qty.cfg.rowKey) || !qty.cfg.rowKey) qty.cfg.rowKey = all.find(k => /product\s*object\s*type$/i.test(k)) || all.find(k => /produkt \/ namn/i.test(k)) || "◆ Område (sista ledet)";
  if (!okRow(qty.cfg.colKey)) qty.cfg.colKey = "";
}
/* Enheten i rådata: volym i TC:s egenskaper kan vara m³ eller mm³. Jämförs med objektens omslutande låda (i meter) om det går. */
async function qtyUnitCheck() {
  await qtyUnitCheck0();
  if (qtyKind() === "form") { await qtyVolFactor(); await qtyLoadBoxes(); const n = qty.objs.filter(o => qtyFormDeduct(o) === null).length; qty.unitNote += `${qty.unitNote ? " " : ""}${qty.cfg.formTop ? "Hela ytan räknas (inklusive över- och underyta)." : "Över- och underyta är avdragna (formyta = sidoytor)."}${n && !qty.cfg.formTop ? ` ${n} objekt saknar volym eller höjd och räknas med hela ytan.` : ""}`; }
}
async function qtyUnitCheck0() {
  qty.factor = 1; qty.unitNote = "";
  const u = qty.cfg.unit, kind = qtyKind();
  if (u !== "auto") { qty.factor = Number(u) || 1; qty.unitNote = `Enhet vald: ÷ ${qty.factor.toLocaleString("sv-SE")}.`; return; }
  if (kind !== "vol" && kind !== "form") return;
  const V = API && API.viewer; if (!V || typeof V.getObjectBoundingBoxes !== "function") return;
  const sample = qty.objs.filter(o => qtyNum(o.flat[qty.cfg.valKey]) > 0).slice(0, 40), ratios = [];
  const byModel = new Map(); sample.forEach(o => (byModel.get(o.modelId) || byModel.set(o.modelId, []).get(o.modelId)).push(o));
  for (const [modelId, list] of byModel) {
    try { const bb = await V.getObjectBoundingBoxes(modelId, list.map(o => o.rid)), by = new Map(bb.map(b => [b.id, b.boundingBox])); list.forEach(o => { const b = by.get(o.rid); if (!b) return; const x = b.max.x - b.min.x, y = b.max.y - b.min.y, z = b.max.z - b.min.z, ref = kind === "vol" ? x * y * z : 2 * (x * y + y * z + x * z); if (ref > 0) ratios.push(qtyNum(o.flat[qty.cfg.valKey]) / ref); }); } catch (e) { /* ingen kontroll */ }
  }
  if (!ratios.length) return;
  ratios.sort((a, b) => a - b); const med = ratios[ratios.length >> 1], big = kind === "vol" ? 1e4 : 1e3, F = kind === "vol" ? 1e9 : 1e6;
  if (med > big) { qty.factor = F; qty.unitNote = `${kind === "vol" ? "Volymen" : "Ytan"} verkar vara i mm${kind === "vol" ? "³" : "²"} (jämförd med objektens mått) – räknas om till ${kind === "vol" ? "m³" : "m²"}.`; }
  else qty.unitNote = `${kind === "vol" ? "Volymen" : "Ytan"} verkar vara i ${kind === "vol" ? "m³" : "m²"} (jämförd med objektens mått).`;
}
/* Innehåller / Utesluter (flera ord med komma): objektet tas med om någon egenskap innehåller något av orden i Innehåller och ingen innehåller något ord i Utesluter. */
const qtyTerms = t => String(t || "").toLowerCase().split(/[,;]/).map(x => x.trim()).filter(Boolean);
function qtyPass(o) {
  const inc = qtyTerms(qty.cfg.filter), exc = qtyTerms(qty.cfg.exclude); if (!inc.length && !exc.length) return true;
  const vals = Object.values(o.flat).map(v => String(v).toLowerCase());
  if (inc.length && !inc.some(t => vals.some(v => v.includes(t)))) return false;
  return !(exc.length && exc.some(t => vals.some(v => v.includes(t))));
}
/* Formyta (Victor 2026-10-15): "Surface area" i modellen räknar även över- och underyta, och de formas inte. Formytan = hela ytan − 2 × (volym ÷ höjd),
   alltså sidoytorna; höjden är objektets utsträckning i höjdled (z) i modellen. Stämmer för stående och liggande prismor (väggar, plattor, sulor,
   pelare); för sluttande eller böjda objekt är det en uppskattning. Kryssrutan "Räkna med över- och underyta" ger hela ytan som förut. */
const qtyVolKey = o => { if (o._vk !== undefined) return o._vk; const K = QTY_KINDS.vol, ks = Object.keys(o.flat); return (o._vk = ks.find(k => K[2].test(k)) || ks.find(k => /(^|\/\s*)volume$/i.test(k)) || ""); };
function qtyFormDeduct(o) {
  if (!(o.hz > 0.001)) return null; const k = qtyVolKey(o), raw = k ? qtyNum(o.flat[k]) : null; if (raw === null || !(raw > 0)) return null;
  return 2 * (raw / (qty.volFactor || 1)) / o.hz;
}
function qtyValue(o) {
  const raw = qty.cfg.valKey ? qtyNum(o.flat[qty.cfg.valKey]) : null; if (raw === null) return null;
  let v = raw / (qty.factor || 1);
  if (qtyKind() === "form" && !qty.cfg.formTop) { const d = qtyFormDeduct(o); if (d !== null) v = Math.max(0, v - d); }
  return v;
}
/* Höjd (z) per objekt ur TC:s omslutande lådor – behövs för formytan. */
async function qtyLoadBoxes() {
  const V = API && API.viewer; if (!V || typeof V.getObjectBoundingBoxes !== "function") return;
  const byM = new Map(); qty.objs.filter(o => o.hz === undefined && o.rid !== undefined && o.rid !== null).forEach(o => (byM.get(o.modelId) || byM.set(o.modelId, []).get(o.modelId)).push(o));
  for (const [m, list] of byM) for (let i = 0; i < list.length; i += 300) {
    const ch = list.slice(i, i + 300);
    try { const bb = await V.getObjectBoundingBoxes(m, ch.map(o => o.rid)), by = new Map(bb.map(b => [b.id, b.boundingBox])); ch.forEach(o => { const b = by.get(o.rid); o.hz = b ? b.max.z - b.min.z : 0; }); } catch (e) { ch.forEach(o => { o.hz = 0; }); }
  }
}
/* Summering: rader × kolumner. */
function qtyPivot() {
  const C = qty.cfg, f = qty.factor || 1;
  const val = o => qtyValue(o);
  const get = (o, k) => (!k ? "" : QTY_ACT_KEYS[k] ? QTY_ACT_KEYS[k](o) : (o.flat[k] === undefined ? "(saknas)" : String(o.flat[k])));
  const rows = new Map(), cols = new Set(); let total = 0, nObj = 0, nNo = 0;
  qty.objs.forEach(o => {
    if (!qtyActive(o)) return;
    if (!qtyPass(o)) return;
    const v = val(o); if (v === null) { nNo++; }
    const rk = get(o, C.rowKey) || "(tomt)", ck = C.colKey ? (get(o, C.colKey) || "(tomt)") : "";
    cols.add(ck);
    const r = rows.get(rk) || { key: rk, n: 0, sum: 0, cells: new Map(), objs: [] };
    r.n++; r.objs.push(o); if (v !== null) { r.sum += v; r.cells.set(ck, (r.cells.get(ck) || 0) + v); }
    rows.set(rk, r); if (v !== null) total += v; nObj++;
  });
  return { rows: [...rows.values()].sort((a, b) => b.sum - a.sum), cols: [...cols].sort((a, b) => a.localeCompare(b, "sv", { numeric: true })), total, nObj, nNo };
}
function qtyUnitLabel() { return QTY_KINDS[qtyKind()][1]; }
function qtyMsg(t) { const el = document.getElementById("qtyMsg"); if (el) el.textContent = t; }
function qtyBusyUi(on) { const b = document.getElementById("qtyRead"); if (b) { b.disabled = on; b.textContent = on ? "Läser…" : "Läs mängder"; } }
async function qtySelectRows(objs) {
  const V = API && API.viewer; if (!V || typeof V.setSelection !== "function") return;
  const by = new Map(); objs.forEach(o => (by.get(o.modelId) || by.set(o.modelId, []).get(o.modelId)).push(o.rid));
  try { ownModelSelectionUntil = Date.now() + 1500; await V.setSelection({ modelObjectIds: [...by].map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds })) }, "set"); if (typeof V.setCamera === "function") V.setCamera({ modelObjectIds: [...by].map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds })) }, { animationTime: 400 }).catch(() => {}); } catch (e) { modelToast("Kunde inte markera i TC"); }
}
function qtyCsv() {
  const P = qtyPivot(), u = qtyUnitLabel(), d = v => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000).replace(".", ",") : "");
  const head = [qty.cfg.rowKey || "Rad", ...(qty.cfg.colKey ? P.cols : []), `Summa${u ? " " + u : ""}`, "Antal objekt"];
  const lines = [head, ...P.rows.map(r => [r.key, ...(qty.cfg.colKey ? P.cols.map(c => d(r.cells.get(c) || 0)) : []), d(r.sum), r.n]), ["Totalt", ...(qty.cfg.colKey ? P.cols.map(c => d(P.rows.reduce((s, r) => s + (r.cells.get(c) || 0), 0))) : []), d(P.total), P.nObj]];
  return "﻿" + lines.map(l => l.map(x => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\r\n");
}
function qtyExport() {
  const blob = new Blob([qtyCsv()], { type: "text/csv;charset=utf-8" }), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = `Mängder ${todayISO()}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function qtyRender() { qtyRender0(); qtyAfterRender(); }
function qtyRender0() {
  const host = document.getElementById("qtyBox"); if (!host) return;
  const C = qty.cfg, E = qtyEsc, hasData = qty.objs.length > 0;
  const keyOpts = (sel, withNone, acts) => `${withNone ? `<option value="">(ingen)</option>` : ""}${acts ? Object.keys(QTY_ACT_KEYS).map(k => `<option value="${E(k)}"${sel === k ? " selected" : ""}>${E(k)}</option>`).join("") : ""}${[...qty.keys].map(([k, e]) => `<option value="${E(k)}"${sel === k ? " selected" : ""}>${E(k)} (${e.n})</option>`).join("")}`;
  const seg = (attr, cur, opts) => `<div class="gantt-seg qty-seg" role="group">${opts.map(([v, t, tip]) => `<button type="button" class="gantt-seg-btn${cur === v ? " active" : ""}" ${attr}="${v}"${tip ? ` title="${E(tip)}"` : ""}>${t}</button>`).join("")}</div>`;
  const ic = d => `<svg class="gp-svg" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const kindOpts = Object.entries(QTY_KINDS).map(([k, v]) => [k, { vol: "Betong m³", form: "Form m²", len: "Längd m", kg: "Vikt kg" }[k] || v[0], v[0]]);
  host.innerHTML = `<div class="qty-hint">Mängder ur modellen för de objekt som <b>Ganttens regel</b> räknar som klara (eller alla), att jämföra mot mängdförteckningen. Läses ur TC:s egna egenskaper. Inget ändras eller sparas.</div>
    <div class="gantt-head qty-head">
      <div class="gantt-head-row">
        <span class="gantt-sub-label">Urval</span>${seg("data-qscope", C.scope, [["gantt", "Gantt-schemat", "Det som visas i Gantt-schemat"], ["all", "Hela planen"], ["sel", "Markerat i TC"]])}
        ${C.scope !== "sel" ? `<span class="gantt-sub-label">Läge</span>${seg("data-qphase", C.phase, [["klar", "Klara"], ["period", "Under period", "Klara under en period (Från–Till)"], ["all", "Alla", "Alla oavsett läge"]])}
        ${C.phase === "period" ? `<label class="gantt-toolbar-field" title="Första dagen i perioden – bara det som blev klart från och med den här dagen räknas">Från <input type="date" id="qtyFrom" value="${E(C.from || addDaysIso(qtyAt(), -6))}" /></label>` : ""}
        ${C.phase === "klar" || C.phase === "period" ? `<label class="gantt-toolbar-field" title="${C.phase === "period" ? "Sista dagen i perioden" : "Klara enligt Ganttens regel vid det här datumet"}">${C.phase === "period" ? "Till" : "Datum"} <input type="date" id="qtyDate" value="${E(C.date || (typeof ganttAsOf !== "undefined" && ganttAsOf) || todayISO())}" /></label><button type="button" id="qtyToday" class="gantt-chip" title="Använd dagens datum">Idag</button>` : ""}` : ""}
        <span class="gantt-head-spacer"></span><span id="qtyMsg" class="hint"></span>
        <button type="button" id="qtyRead" class="gantt-toolbar-btn qty-read">${ic('<path d="M4 10a6 6 0 0 1 10.5-4L16 7.5M16 3v4.5h-4.5M16 10a6 6 0 0 1-10.5 4L4 12.5M4 17v-4.5h4.5"/>')}<span>Läs mängder</span></button>
      </div>
      ${hasData ? `<div class="gantt-head-row gantt-head-sub">
        <span class="gantt-sub-label" title="Vad som ska summeras">Mängdslag</span>${seg("data-qkind", qtyKind(), kindOpts)}
        ${qtyKind() === "form" ? `<label class="gantt-pill" title="Av: bara sidoytorna (formyta). På: hela ytan, även över- och underyta som inte formas."><input type="checkbox" id="qtyFormTop"${C.formTop ? " checked" : ""} /> Med över-/underyta</label>` : ""}
        <label class="gantt-toolbar-field">Mängd <select id="qtyVal">${qtyNumKeys().map(k => `<option value="${E(k)}"${C.valKey === k ? " selected" : ""}>${E(k)}</option>`).join("")}</select></label>
        <label class="gantt-toolbar-field" title="Enheten på mängden i modellen. Auto jämför volymen med objektens mått.">Enhet <select id="qtyUnit">${[["auto", "Auto"], ["1", "som i modellen"], ["1000", "÷ 1 000"], ["1000000", "÷ 1 000 000 (mm² → m²)"], ["1000000000", "÷ 1 000 000 000 (mm³ → m³)"]].map(([v, t]) => `<option value="${v}"${String(C.unit) === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      </div>
      <div class="gantt-head-row gantt-head-sub">
        <label class="gantt-toolbar-field">Rader efter <select id="qtyRowKey">${keyOpts(C.rowKey, false, true)}</select></label>
        <label class="gantt-toolbar-field">Kolumner efter <select id="qtyColKey">${keyOpts(C.colKey, true, true)}</select></label>
        <label class="gantt-toolbar-field" title="Visa bara objekt där någon egenskap innehåller något av orden (flera ord med komma, t.ex. Concrete, Betong)">Innehåller <input type="text" id="qtyFilter" value="${E(C.filter)}" placeholder="t.ex. Concrete, Betong" /></label>
        <label class="gantt-toolbar-field" title="Lämna bort objekt där någon egenskap innehåller något av orden (t.ex. Steel, Stål för att inte räkna stålpålar som betong)">Utesluter <input type="text" id="qtyExclude" value="${E(C.exclude || "")}" placeholder="t.ex. Steel, Stål" /></label>
        <span class="gantt-chips qty-presets" title="Snabbval som fyller i Innehåller/Utesluter – ändra orden så de passar egenskaperna i din modell"><button type="button" class="gantt-chip" data-qpre="all">Allt</button><button type="button" class="gantt-chip" data-qpre="concrete">Bara betong</button><button type="button" class="gantt-chip" data-qpre="steel">Bara stål</button></span>
      </div>` : ""}
    </div>
    ${hasData ? `<div class="qty-notes"><div class="hint">${E(qty.unitNote || "")}</div>
      ${C.phase === "period" ? `<div class="hint"><b>Klart under perioden ${E(qtyFrom())} – ${E(qtyAt())}</b> (klart senast ${E(qtyAt())}, men inte redan klart före ${E(qtyFrom())}).</div>` : ""}</div>
      <div id="qtyTable" class="qty-card"></div>
      <div class="qty-actions"><button type="button" id="qtyCsv" class="gantt-toolbar-btn" title="Exportera tabellen som CSV (öppnas i Excel)">${ic('<path d="M10 3v9m0 0-3-3m3 3 3-3M4 14v2.5h12V14"/>')}<span>CSV (Excel)</span></button><button type="button" id="qtyAllSel" class="gantt-toolbar-btn" title="Markera alla objekt i tabellen i TC">${ic('<path d="M5 3l11 6.5-5 1.5-1.5 5z"/>')}<span>Markera alla i TC</span></button></div>
      <details class="qty-props"><summary>Egenskaper som hittades (${qty.keys.size})</summary><div class="qty-proplist">${[...qty.keys].map(([k, e]) => `<div><b>${E(k)}</b> <span class="hint">${e.n} obj · ex: ${E(String(e.sample).slice(0, 60))}</span></div>`).join("")}</div></details>` : ""}`;
  const q = s => host.querySelector(s), put = (k, v) => { qty.cfg[k] = v; qtySave(); };
  host.querySelectorAll("[data-qscope]").forEach(b => b.onclick = () => { put("scope", b.dataset.qscope); qtyRender(); });
  host.querySelectorAll("[data-qphase]").forEach(b => b.onclick = () => { put("phase", b.dataset.qphase); qtyRender(); });
  if (q("#qtyDate")) q("#qtyDate").onchange = e => { put("date", e.target.value); if (C.phase === "period") qtyRender(); };
  if (q("#qtyFrom")) q("#qtyFrom").onchange = e => { put("from", e.target.value); qtyRender(); };
  if (q("#qtyToday")) q("#qtyToday").onclick = () => { put("date", todayISO()); qtyRender(); };
  q("#qtyRead").onclick = qtyRead;
  if (!hasData) return;
  host.querySelectorAll("[data-qkind]").forEach(b => b.onclick = async () => { put("kind", b.dataset.qkind); qtyPickDefaults(); qtySave(); await qtyUnitCheck(); if (typeof qmfAutoMap === "function" && typeof qmf !== "undefined" && qmf.posts.length) qmfAutoMap(); qtyRender(); });
  q("#qtyVal").onchange = async e => { put("valKey", e.target.value); qty.cfg.valKeys = { ...(qty.cfg.valKeys || {}), [qtyKind()]: e.target.value }; qtySave(); await qtyUnitCheck(); qtyRender(); };
  q("#qtyRowKey").onchange = e => { put("rowKey", e.target.value); qtyRender(); };
  q("#qtyColKey").onchange = e => { put("colKey", e.target.value); qtyRender(); };
  q("#qtyFilter").onchange = e => { put("filter", e.target.value); qtyRender(); };
  if (q("#qtyFormTop")) q("#qtyFormTop").onchange = async e => { put("formTop", e.target.checked); await qtyUnitCheck(); qtyRender(); };
  q("#qtyExclude").onchange = e => { put("exclude", e.target.value); qtyRender(); };
  host.querySelectorAll("[data-qpre]").forEach(b => b.onclick = () => {
    const P = { all: ["", ""], concrete: ["Concrete, Betong", "Steel, Stål, Rebar, Armering, Pile, Påle"], steel: ["Steel, Stål, Pile, Påle, Rebar, Armering", ""] }[b.dataset.qpre];
    put("filter", P[0]); put("exclude", P[1]); qtyRender();
  });
  q("#qtyUnit").onchange = async e => { put("unit", e.target.value); await qtyUnitCheck(); qtyRender(); };
  q("#qtyCsv").onclick = qtyExport;
  const P = qtyPivot(), u = qtyUnitLabel(), tb = q("#qtyTable");
  tb.innerHTML = `<table class="qty-table"><thead><tr><th>${E(C.rowKey || "Rad")}</th>${C.colKey ? P.cols.map(c => `<th class="num">${E(c || "")}</th>`).join("") : ""}<th class="num">Summa${u ? " " + u : ""}</th><th class="num">Objekt</th></tr></thead><tbody>${P.rows.map((r, i) => `<tr data-r="${i}" title="Klicka för att markera objekten i TC"><td>${E(r.key)}</td>${C.colKey ? P.cols.map(c => `<td class="num">${qtyFmt(r.cells.get(c) || 0)}</td>`).join("") : ""}<td class="num"><b>${qtyFmt(r.sum)}</b></td><td class="num">${r.n}</td></tr>`).join("")}</tbody><tfoot><tr><td><b>Totalt</b></td>${C.colKey ? P.cols.map(c => `<td class="num"><b>${qtyFmt(P.rows.reduce((s, r) => s + (r.cells.get(c) || 0), 0))}</b></td>`).join("") : ""}<td class="num"><b>${qtyFmt(P.total)}</b></td><td class="num"><b>${P.nObj}</b></td></tr></tfoot></table>${P.nNo ? `<div class="hint">${P.nNo} objekt saknar värde för vald mängd och räknas inte med i summan.</div>` : ""}`;
  tb.querySelectorAll("tr[data-r]").forEach(tr => { tr.onclick = () => { const r = P.rows[Number(tr.dataset.r)]; if (r) qtySelectRows(r.objs); }; });
  q("#qtyAllSel").onclick = () => qtySelectRows(P.rows.flatMap(r => r.objs));
}
function qtyAfterRender() { const host = document.getElementById("qtyBox"); if (!host) return; let b = document.getElementById("qmfBox"); if (!b) { b = document.createElement("div"); b.id = "qmfBox"; b.className = "qmf-box"; host.appendChild(b); } if (typeof qmfRender === "function") qmfRender(); }
function initQuantities() { if (document.getElementById("qtyBox")) qtyRender(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initQuantities); else setTimeout(initQuantities, 0);

/* Volymens enhet (m³ eller mm³) för formytans avdrag – jämförs med objektens omslutande lådor. */
async function qtyVolFactor() {
  qty.volFactor = 1; const f = qty.factor || 1; if (qty.cfg.unit !== "auto") { qty.volFactor = f === 1 ? 1 : f === 1e6 ? 1e9 : Math.pow(f, 1.5); return; }
  const V = API && API.viewer; if (!V || typeof V.getObjectBoundingBoxes !== "function") { qty.volFactor = f === 1e6 ? 1e9 : 1; return; }
  const ratios = [], by = new Map(); qty.objs.filter(o => qtyVolKey(o) && qtyNum(o.flat[qtyVolKey(o)]) > 0).slice(0, 40).forEach(o => (by.get(o.modelId) || by.set(o.modelId, []).get(o.modelId)).push(o));
  for (const [m, list] of by) { try { const bb = await V.getObjectBoundingBoxes(m, list.map(o => o.rid)), mp = new Map(bb.map(b => [b.id, b.boundingBox])); list.forEach(o => { const b = mp.get(o.rid); if (!b) return; const ref = (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z); if (ref > 0) ratios.push(qtyNum(o.flat[qtyVolKey(o)]) / ref); }); } catch (e) { /* ingen kontroll */ } }
  if (!ratios.length) { qty.volFactor = f === 1e6 ? 1e9 : 1; return; }
  ratios.sort((a, b) => a - b); qty.volFactor = ratios[ratios.length >> 1] > 1e4 ? 1e9 : 1;
}
