/* Mängdavtagning – motorn (Victor 2026-10-14, omgjord 2026-10-19: "tänk nytt, grundprincip att vi läser från Excel, förenkla").
   Modellens objekt läses ur Trimble Connect (getObjectProperties, bl.a. "Calculated Geometry Values → Volume"), och varje objekt kopplas till en kod i mängd-
   förteckningen (Excel). Mängdslaget bestäms av kodens enhet: m³ = betong (volym), m² = form (sidoyta) eller yta, m = längd, kg/ton = armering (vikt eller
   schablon per m³ betong), st = antal. Gränssnittet (matrisen i Excel-layout) ligger i quantities-ui.js, Excel- och kopplingsdatan i quantities-mf.js.
   Inget skrivs till modellen eller Excel-filen. */

const QTY_KEY = "4ddash-qty";
const qty = { cfg: { scope: "gantt", from: "", date: "", formTop: false, unit: "auto", rebarMode: "schablon", rebarKg: 100, valKeys: {} }, objs: [], keys: new Map(), kv: {}, notes: [], volFactor: 1, busy: false, missing: 0 };
try { const s = JSON.parse(localStorage.getItem(QTY_KEY) || "{}"); Object.assign(qty.cfg, s); if (s.rebarT !== undefined && s.rebarKg === undefined) qty.cfg.rebarKg = Math.round(Number(s.rebarT) * 1000) || 100; } catch (e) { /* standard */ }
/* Mängdslag: [namn, enhet, stark egenskapsmatch, svag egenskapsmatch]. Kodens enhet väljer mängdslag (se qmfKindOfPost). */
const QTY_KINDS = {
  vol: ["Betong – volym", "m³", /calculated\s*geometry\s*values\s*\/\s*volume$/i, /volume|volym/i],
  form: ["Form – sidoyta (utan över-/underyta)", "m²", /calculated\s*geometry\s*values\s*\/\s*(total\s*)?surface\s*area$/i, /surface|side\s*area|form|area|yta/i],
  area: ["Yta – en sida (volym ÷ tjocklek)", "m²", /^$/, /^$/],
  len: ["Längd", "m", /calculated\s*geometry\s*values\s*\/\s*length$/i, /length|längd/i],
  cnt: ["Antal", "st", /^$/, /^$/],
  kg: ["Armering (kg)", "kg", /calculated\s*geometry\s*values\s*\/\s*weight$/i, /weight|vikt|mass/i],
  rebar: ["Armering (ton)", "ton", /^$/, /^$/],
};
const qtySave = () => { try { localStorage.setItem(QTY_KEY, JSON.stringify(qty.cfg)); } catch (e) { /* ingen lagring */ } };
const qtyEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const qtyNum = v => { if (typeof v === "number") return Number.isFinite(v) ? v : null; if (typeof v !== "string") return null; const n = parseFloat(v.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) && /^[-+]?[\d\s.,]+(e[-+]?\d+)?\s*[a-zA-Zµ²³°%/]*$/i.test(v.trim()) ? n : null; };
const qtyFmt = (n, d = 1) => (Number.isFinite(n) ? n.toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: d }) : "–");

/* Alla egenskaper hos ett objekt som en platt lista "Egenskapsgrupp / Egenskap" → värde. */
function qtyFlat(obj) {
  const f = {};
  if (obj.product && obj.product.name) f["Produkt / Namn"] = obj.product.name;
  if (obj.class) f["IFC-klass"] = obj.class;
  (obj.properties || []).forEach(ps => (ps.properties || []).forEach(p => { if (p && p.name !== undefined && p.value !== undefined && p.value !== null && typeof p.value !== "object") f[`${ps.name || "Övrigt"} / ${p.name}`] = p.value; }));
  return f;
}

/* ---- Klart vid datum (Ganttens regel). Datumet följer tidslinjen i Gantt-schemat tills man själv skriver ett datum. ---------------------------- */
const qtyFollow = () => qty.cfg.follow !== false;
const qtyAt = () => (qtyFollow() ? ((typeof ganttAsOf !== "undefined" && ganttAsOf) || qty.cfg.date) : (qty.cfg.date || (typeof ganttAsOf !== "undefined" && ganttAsOf))) || todayISO();
let qtyFollowT = 0;
/* Anropas när tidslinjen flyttas: ritar om matrisen (utan att läsa om modellen) om fliken syns. */
function qtyFollowTick() {
  if (!qtyFollow()) return;
  const host = document.getElementById("qtyBox"); if (!host || !host.offsetParent || !qty.objs.length) return;
  clearTimeout(qtyFollowT); qtyFollowT = setTimeout(() => { try { qtyRender(); } catch (e) { console.warn("Mängdavtagning följer tidslinjen", e); } }, 220);
}
/* "Från" (valfritt): bara det som blev klart från och med det datumet – klart vid datumet men inte redan klart dagen före Från. */
const qtyFrom = () => qty.cfg.from || "";
const qtyDone = o => {
  const hasDates = o.item && (o.item.startDate || o.item.endDate), f = qtyFrom();
  if (!hasDates) return !f; // utan datum räknas objektet som klart, men inte som producerat i en period
  if (ganttPhaseAt(o.item, qtyAt()) !== "klar") return false;
  return !f || ganttPhaseAt(o.item, addDaysIso(f, -1)) !== "klar";
};

/* ---- Urval och inläsning ---------------------------------------------------------------------------------------------------------------- */
function qtyObjects() {
  const base = qty.cfg.scope === "all" ? items : (typeof ganttInRangeItems !== "undefined" && ganttInRangeItems ? ganttInRangeItems : typeof ganttShownItems !== "undefined" ? ganttShownItems : items).flatMap(it => it.members || [it]); // inom Ganttens visade datumintervall
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
    if (!targets.length) { qtyMsg(qty.cfg.scope === "sel" ? "Inget är markerat i TC." : "Inga objekt matchar urvalet (kolla Ganttens filter och datumintervall)."); qty.objs = []; qtyRender(); return; }
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
    const keys = new Map(); objs.forEach(o => Object.entries(o.flat).forEach(([k, v]) => { const e = keys.get(k) || { n: 0, num: 0, sample: v }; e.n++; if (qtyNum(v) !== null) e.num++; keys.set(k, e); }));
    qty.keys = keys;
    await qtyPrepare();
    try { if (typeof qmfAutoMap === "function" && qmfAllPosts().length) qmfAutoMap(); } catch (e) { console.warn(e); }
    qtyMsg(`${objs.length} objekt lästa${missing ? ` · ${missing} hittades inte i de inlästa modellerna` : ""}.`);
  } catch (e) { console.warn("Mängdavtagning", e); qtyMsg("Kunde inte läsa egenskaper: " + ((e && (e.message || e.error)) || "Trimble Connect svarade inte")); }
  finally { qty.busy = false; qtyBusyUi(false); qtyRender(); }
}

/* ---- Egenskap och enhet per mängdslag ---------------------------------------------------------------------------------------------------------- */
const qtyNumKeys = () => [...qty.keys].filter(([, e]) => e.num >= Math.max(1, e.n * 0.8)).map(([k]) => k);
function qtyValKeyFor(kind) {
  const nk = qtyNumKeys(), K = QTY_KINDS[kind], want = qty.cfg.valKeys && qty.cfg.valKeys[kind];
  return want && qty.keys.has(want) ? want : (nk.find(k => K[2].test(k)) || nk.find(k => K[3].test(k)) || (K[2].source === "^$" || kind === "kg" ? "" : nk[0]) || "");
}
const qtyVolKey = o => { if (o._vk !== undefined) return o._vk; const K = QTY_KINDS.vol, ks = Object.keys(o.flat); return (o._vk = ks.find(k => K[2].test(k)) || ks.find(k => /(^|\/\s*)volume$/i.test(k)) || ""); };
/* Förberedelse efter inläsning: vilken egenskap varje mängdslag läser, och om volym/yta står i m³/m² eller mm³/mm² (jämförs med objektens omslutande låda). */
async function qtyPrepare() {
  qty.kv = {}; qty.notes = []; qty.volFactor = 1;
  Object.keys(QTY_KINDS).forEach(k => { qty.kv[k] = { valKey: qtyValKeyFor(k), factor: 1 }; });
  const u = qty.cfg.unit;
  await qtyVolFactor();
  qty.kv.vol.factor = qty.volFactor;
  if (u !== "auto") { const f = Number(u) || 1; qty.kv.form.factor = f; qty.notes.push(`Enhet vald: ÷ ${f.toLocaleString("sv-SE")}.`); }
  else {
    const f = await qtyAreaFactor(); qty.kv.form.factor = f;
    qty.notes.push(`Volymen verkar vara i ${qty.volFactor > 1 ? "mm³ – räknas om till m³" : "m³"} och ytan i ${f > 1 ? "mm² – räknas om till m²" : "m²"} (jämförd med objektens mått).`);
  }
  if (qtyNeedsBoxes()) await qtyLoadBoxes();
}
async function qtyAreaFactor() {
  const V = API && API.viewer, key = qty.kv.form.valKey; if (!V || typeof V.getObjectBoundingBoxes !== "function" || !key) return 1;
  const sample = qty.objs.filter(o => qtyNum(o.flat[key]) > 0).slice(0, 40), ratios = [], byModel = new Map(); sample.forEach(o => (byModel.get(o.modelId) || byModel.set(o.modelId, []).get(o.modelId)).push(o));
  for (const [modelId, list] of byModel) {
    try { const bb = await V.getObjectBoundingBoxes(modelId, list.map(o => o.rid)), by = new Map(bb.map(b => [b.id, b.boundingBox])); list.forEach(o => { const b = by.get(o.rid); if (!b) return; const x = b.max.x - b.min.x, y = b.max.y - b.min.y, z = b.max.z - b.min.z, ref = 2 * (x * y + y * z + x * z); if (ref > 0) ratios.push(qtyNum(o.flat[key]) / ref); }); } catch (e) { /* ingen kontroll */ }
  }
  if (!ratios.length) return 1; ratios.sort((a, b) => a - b); return ratios[ratios.length >> 1] > 1e3 ? 1e6 : 1;
}
async function qtyVolFactor() {
  qty.volFactor = 1; const u = qty.cfg.unit;
  if (u !== "auto") { const f = Number(u) || 1; qty.volFactor = f === 1 ? 1 : f === 1e6 ? 1e9 : Math.pow(f, 1.5); return; }
  const V = API && API.viewer; if (!V || typeof V.getObjectBoundingBoxes !== "function") return;
  const ratios = [], by = new Map(); qty.objs.filter(o => qtyVolKey(o) && qtyNum(o.flat[qtyVolKey(o)]) > 0).slice(0, 40).forEach(o => (by.get(o.modelId) || by.set(o.modelId, []).get(o.modelId)).push(o));
  for (const [m, list] of by) { try { const bb = await V.getObjectBoundingBoxes(m, list.map(o => o.rid)), mp = new Map(bb.map(b => [b.id, b.boundingBox])); list.forEach(o => { const b = mp.get(o.rid); if (!b) return; const ref = (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z); if (ref > 0) ratios.push(qtyNum(o.flat[qtyVolKey(o)]) / ref); }); } catch (e) { /* ingen kontroll */ } }
  if (!ratios.length) return; ratios.sort((a, b) => a - b); qty.volFactor = ratios[ratios.length >> 1] > 1e4 ? 1e9 : 1;
}
/* Höjd (z) och mått per objekt ur TC:s omslutande lådor – behövs för formyta och "yta en sida". */
const qtyNeedsBoxes = () => typeof qmf !== "undefined" && ["form", "area"].some(k => Object.keys((qmf.map.types || {})[k] || {}).length || Object.keys((qmf.map.obj || {})[k] || {}).length);
async function qtyLoadBoxes() {
  const V = API && API.viewer; if (!V || typeof V.getObjectBoundingBoxes !== "function") return;
  const byM = new Map(); qty.objs.filter(o => o.hz === undefined && o.rid !== undefined && o.rid !== null).forEach(o => (byM.get(o.modelId) || byM.set(o.modelId, []).get(o.modelId)).push(o));
  for (const [m, list] of byM) for (let i = 0; i < list.length; i += 300) {
    const ch = list.slice(i, i + 300);
    try { const bb = await V.getObjectBoundingBoxes(m, ch.map(o => o.rid)), by = new Map(bb.map(b => [b.id, b.boundingBox])); ch.forEach(o => { const b = by.get(o.rid); o.hz = b ? b.max.z - b.min.z : 0; o.bx = b ? b.max.x - b.min.x : 0; o.by = b ? b.max.y - b.min.y : 0; }); } catch (e) { ch.forEach(o => { o.hz = 0; }); }
  }
}

/* ---- Mängden för ett objekt i ett mängdslag --------------------------------------------------------------------------------------------------- */
/* Formyta: "Surface area" räknar även över- och underyta, och de formas inte. Formytan = hela ytan − 2 × (volym ÷ höjd) = sidoytorna. Stämmer för stående och liggande
   prismor (väggar, plattor, sulor, pelare); för sluttande eller böjda objekt är det en uppskattning. */
function qtyFormDeduct(o) {
  if (!(o.hz > 0.001)) return null; const k = qtyVolKey(o), raw = k ? qtyNum(o.flat[k]) : null; if (raw === null || !(raw > 0)) return null;
  return 2 * (raw / (qty.volFactor || 1)) / o.hz;
}
function qtyValue(o, k) {
  const kv = qty.kv[k] || { valKey: "", factor: 1 };
  const vol = () => { const key = qtyVolKey(o), raw = key ? qtyNum(o.flat[key]) : null; return raw !== null && raw > 0 ? raw / (qty.volFactor || 1) : null; };
  if (k === "cnt") return 1;
  if (k === "area") { const v = vol(); if (v === null) return null; const dims = [o.bx, o.by, o.hz].filter(x => x > 0.001); return dims.length ? v / Math.min(...dims) : null; } // en sidas yta = volym ÷ tjocklek
  if (k === "kg" || k === "rebar") { // armering: schablon (kg per m³ betong) eller vikt ur modellen
    const mul = k === "rebar" ? 0.001 : 1;
    if (qty.cfg.rebarMode !== "modell") { const v = vol(); return v === null ? null : v * (Number(qty.cfg.rebarKg) || 0) * mul; }
    const raw = kv.valKey ? qtyNum(o.flat[kv.valKey]) : null; return raw === null ? null : raw / (kv.factor || 1) * mul;
  }
  const raw = kv.valKey ? qtyNum(o.flat[kv.valKey]) : null; if (raw === null) return null;
  let v = raw / (kv.factor || 1);
  if (k === "form" && !qty.cfg.formTop) { const d = qtyFormDeduct(o); if (d !== null) v = Math.max(0, v - d); }
  return v;
}

/* ---- Hjälpare ------------------------------------------------------------------------------------------------------------------------------------- */
async function qtySelectRows(objs) {
  const V = API && API.viewer; if (!V || typeof V.setSelection !== "function") return;
  const by = new Map(); objs.forEach(o => (by.get(o.modelId) || by.set(o.modelId, []).get(o.modelId)).push(o.rid));
  try { ownModelSelectionUntil = Date.now() + 1500; await V.setSelection({ modelObjectIds: [...by].map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds })) }, "set"); if (typeof V.setCamera === "function") V.setCamera({ modelObjectIds: [...by].map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds })) }, { animationTime: 400 }); } catch (e) { console.warn("Markera i TC", e); }
}
/* Stå kvar på samma ställe när listorna ritas om (Victor 2026-10-19: "det hoppar till botten när jag trycker på spara"): rullningen hos fönstret och alla rullbara
   föräldrar sparas före omritningen och sätts tillbaka efteråt (utom om man själv rullat under tiden). */
["wheel", "keydown", "pointerdown", "touchstart"].forEach(ev => window.addEventListener(ev, () => { qtyKeepScroll.userAt = Date.now(); }, { capture: true, passive: true }));
function qtyKeepScroll(fn) {
  const host = document.getElementById("qtyBox"), saved = [];
  for (let n = host; n; n = n.parentElement) if (n.scrollTop > 0) saved.push([n, n.scrollTop]);
  const wy = window.scrollY, wx = window.scrollX;
  const restore = () => { saved.forEach(([n, t]) => { if (n.isConnected && n.scrollTop !== t) n.scrollTop = t; }); if (window.scrollY !== wy) window.scrollTo(wx, wy); };
  const t0 = Date.now(); qtyKeepScroll.userAt = 0;
  try { return fn(); } finally { restore(); requestAnimationFrame(() => { if (!qtyKeepScroll.userAt || qtyKeepScroll.userAt < t0) restore(); }); }
}
