/* Foto med bubblor – objektbubblor (Victor 2026-10-19: "skapa bubblor med valfria UDA från IFC-modellen, egen text och AMA-koden jag kopplat i mängdavtagningen").
   Markera objekt i Trimble Connect och tryck "Bubbla från markerade i TC": välj vilka egenskaper (UDA) som ska stå i bubblan, lägg till egen text, och
   bubblan sätts vid objektet på fotot. Särskilda fält hämtas från resten av appen: ◆ AMA-kod (kopplad i mängdavtagningen), ◆ Aktivitet / Datum / Framdrift / Status
   (aktiviteten som objektet hör till), ◆ Mängd (ur mängdavtagningen, i kodens enhet) och ◆ Antal objekt. Bubblorna kan flyttas, få egen färg och skala, och följer
   med i PNG och PDF (som flyttbara stämplar i lagret Bubblor). Tillägg till photo-bubbles.js, som anropar phbOc*-funktionerna. */

const PHB_OC_KEY = "4ddash-phb-oc-fields";
const PHB_OC_SPECIAL = [["◆ AMA-kod", "AMA-kod"], ["◆ Aktivitet", "Aktivitet"], ["◆ Datum", "Datum"], ["◆ Framdrift", "Framdrift"], ["◆ Status", "Status"], ["◆ Mängd", "Mängd"], ["◆ Antal objekt", "Antal objekt"]];
const PHB_OC_PH = { forsenad: "Försenad", pagaende: "Pågår", klar: "Klar", planerad: "Planerad" };
const phbOcLabel = key => { const s = PHB_OC_SPECIAL.find(x => x[0] === key); return s ? s[1] : String(key).split(" / ").slice(-1)[0]; };
const phbOcDefaults = () => { try { const a = JSON.parse(localStorage.getItem(PHB_OC_KEY) || "null"); if (Array.isArray(a) && a.length) return a; } catch (e) { /* standard */ } return ["◆ AMA-kod", "◆ Aktivitet", "◆ Framdrift"]; };
const phbOcRemember = fields => { try { localStorage.setItem(PHB_OC_KEY, JSON.stringify(fields)); } catch (e) { /* */ } };
/* Förval (Victor 2026-10-20): "Spara som förval" sparar hela bubblans inställning – fält, decimaler, rubrikkälla, skala, färg, egen text och bubbelläge –
   och nästa bubblor från markeringen i TC får den direkt. */
const PHB_OC_PRESET = "4ddash-phb-oc-preset";
function phbOcPreset() { try { const p = JSON.parse(localStorage.getItem(PHB_OC_PRESET) || "null"); return p && Array.isArray(p.fields) ? p : null; } catch (e) { return null; } }
function phbOcSavePreset(src) {
  const p = { fields: (src.fields || []).slice(), dec: src.dec == null ? 2 : src.dec, titleSrc: src.titleSrc || "", scale: src.scale || 1, colOver: src.colOver || null, text: src.text || "", group: src.group || "obj" };
  try { localStorage.setItem(PHB_OC_PRESET, JSON.stringify(p)); phbOcRemember(p.fields); } catch (e) { /* ingen lagring */ }
  return p;
}

/* ---- Läsa markeringen i TC ---------------------------------------------------------------------------------------------------------------------- */
async function phbOcReadSelection() {
  const V = API && API.viewer; if (!V || typeof V.getSelection !== "function") throw new Error("Kräver Trimble Connect-vyn");
  const sel = await V.getSelection(), out = [];
  for (const m of sel || []) {
    const rids = (m.objectRuntimeIds || []).slice(0, 400 - out.length); if (!rids.length) continue;
    const props = new Map(), boxes = new Map(), ids = new Map();
    for (let i = 0; i < rids.length; i += 150) { const ch = rids.slice(i, i + 150); try { (await V.getObjectProperties(m.modelId, ch) || []).forEach(p => props.set(p.id, p)); } catch (e) { /* utan egenskaper */ } }
    try { const e = await V.convertToObjectIds(m.modelId, rids); rids.forEach((r, i) => ids.set(r, e && e[i] !== undefined && e[i] !== null ? String(e[i]) : "")); } catch (e) { /* utan id */ }
    try { (await V.getObjectBoundingBoxes(m.modelId, rids) || []).forEach(b => boxes.set(b.id, b.boundingBox)); } catch (e) { /* utan läge */ }
    rids.forEach(rid => out.push({ modelId: m.modelId, rid, objectId: ids.get(rid) || "", flat: qtyFlat(props.get(rid) || {}), box: boxes.get(rid) || null }));
    if (out.length >= 400) break;
  }
  return out;
}
const phbOcKeys = objs => { const c = new Map(); objs.forEach(o => Object.keys(o.flat || {}).forEach(k => c.set(k, (c.get(k) || 0) + 1))); return [...c.keys()].sort((a, b) => a.localeCompare(b, "sv", { numeric: true })); };
const phbOcName = o => { const n = (o.flat && (o.flat["Produkt / Namn"] || o.flat["Name"])) || ""; return String(n).replace(/\s*[:#]\s*\d{3,}$/, "") || (o.flat && o.flat["IFC-klass"]) || "Objekt"; };

/* ---- Värden ------------------------------------------------------------------------------------------------------------------------------------- */
const phbOcItemOf = o => (typeof items !== "undefined" ? items : []).find(it => it.modelId === o.modelId && String(it.objectId) === String(o.objectId) && o.objectId);
function phbOcCodes(o) {
  const posts = qmfAllPosts(), out = [];
  Object.keys(QTY_KINDS).forEach(k => { const key = qmfEffPost(o, k), p = key && posts.find(x => x.key === key); if (p && qmfKindOfPost(p) === k) out.push(p); });
  return out;
}
const phbOcUniq = a => [...new Set(a.filter(x => x !== "" && x != null))];
/* Tal med enhet: m³/m² (eller m) läses ur egenskapens namn; mm-enheter räknas om. Antal decimaler väljs per bubbla. */
function phbOcUnit(key) {
  const k = String(key).toLowerCase(), has = r => r.test(k);
  if (has(/mm\s*[³3]/)) return { f: 1e-9, u: "m³" }; if (has(/mm\s*[²2]/)) return { f: 1e-6, u: "m²" };
  if (has(/m\s*[³3]|volym|volume/)) return { f: has(/volym|volume/) && !has(/m\s*[³3]/) && typeof qty !== "undefined" && qty.kv && qty.kv.vol ? qty.kv.vol.factor ? 1 / qty.kv.vol.factor : 1 : 1, u: "m³" };
  if (has(/m\s*[²2]|area|yta/)) return { f: has(/m\s*[²2]/) || typeof qty === "undefined" || !qty.kv || !qty.kv.form || !qty.kv.form.factor ? 1 : 1 / qty.kv.form.factor, u: "m²" };
  if (has(/\bmm\b/)) return { f: 1e-3, u: "m" };
  if (has(/\bkg\b/)) return { f: 1, u: "kg" };
  if (has(/längd|length|\(m\)/)) return { f: 1, u: "m" };
  return null;
}
const phbOcNum = (v, key, dec) => {
  const n = qtyNum(v); if (n === null || !/^[-+]?[\d\s.,]+$/.test(String(v).trim())) return String(v);
  const un = key ? phbOcUnit(key) : null, d = dec == null ? 2 : dec;
  const fm = x => x.toLocaleString("sv-SE", { minimumFractionDigits: d, maximumFractionDigits: d });
  return un ? `${fm(n * un.f)} ${un.u}` : fm(n);
};
/* Värdet för ett fält som rader (en eller flera). */
function phbOcVal(st, oc, key) {
  const objs = oc.objs, n = objs.length;
  if (key === "◆ Antal objekt") return [String(n)];
  if (key === "◆ AMA-kod") { const c = new Map(); objs.forEach(o => phbOcCodes(o).forEach(p => c.set(p.key, p))); const l = [...c.values()].map(p => `${p.ref} ${p.label.split("|")[0].trim().slice(0, 44)}`); return l.length ? l : ["–"]; }
  if (key === "◆ Aktivitet" || key === "◆ Datum" || key === "◆ Framdrift" || key === "◆ Status") {
    const its = phbOcUniq(objs.map(o => phbOcItemOf(o))), acts = typeof mergeActivityGroups === "function" ? mergeActivityGroups(its.map(x => x)) : its; if (!acts.length) return ["–"];
    return acts.slice(0, 3).map(a => {
      if (key === "◆ Aktivitet") return itemLabel(a);
      if (key === "◆ Datum") return a.startDate ? `${phbFmtDate(a.startDate)} – ${phbFmtDate(a.endDate || a.startDate)}` : "–";
      const ph = ganttPhaseAt(a, st.at);
      return key === "◆ Status" ? PHB_OC_PH[ph] || "–" : `${phbProg(a, st, ph)} %`;
    });
  }
  if (key === "◆ Mängd") {
    if (typeof qty === "undefined" || !qty.objs.length) return ["– (läs mängder först)"];
    const byKey = new Map(qty.objs.map(o => [`${o.modelId}|${o.objectId || o.rid}`, o])), sums = new Map();
    objs.forEach(o => { const q = byKey.get(`${o.modelId}|${o.objectId || o.rid}`); if (!q) return; phbOcCodes(q).forEach(p => { const v = qtyValue(q, qmfKindOfPost(p)); if (v !== null) { const e = sums.get(p.key) || { p, v: 0 }; e.v += v; sums.set(p.key, e); } }); });
    const l = [...sums.values()].map(e => `${e.v.toLocaleString("sv-SE", { minimumFractionDigits: oc.dec == null ? 2 : oc.dec, maximumFractionDigits: oc.dec == null ? 2 : oc.dec })} ${e.p.unit} (${e.p.ref})`); return l.length ? l : ["–"];
  }
  const vals = phbOcUniq(objs.map(o => (o.flat || {})[key])); if (!vals.length) return ["–"];
  return vals.length <= 3 ? [vals.map(x => phbOcNum(x, key, oc.dec)).join(" / ")] : [`${vals.length} olika värden`];
}
function phbOcAutoColor(st, oc) {
  const its = phbOcUniq(oc.objs.map(o => phbOcItemOf(o))); if (!its.length) return "#2563eb";
  const phs = its.map(a => ganttPhaseAt(a, st.at)); return PHB_COL[phs.includes("forsenad") ? "forsenad" : phs.includes("pagaende") ? "pagaende" : phs.every(p => p === "klar") ? "klar" : "planerad"];
}
/* Rubrik ur Ganttens koppling till objektet (t.ex. J34): objektnamn, område eller aktivitet. */
const PHB_OC_TSRC = [["", "Objektets namn i modellen"], ["name", "Gantt: objektnamn"], ["area", "Gantt: område"], ["act", "Gantt: aktivitet"], ["areaact", "Gantt: område · aktivitet"]];
function phbOcTitleFromGantt(oc) {
  const its = phbOcUniq(oc.objs.map(o => phbOcItemOf(o))); if (!oc.titleSrc || !its.length) return "";
  const f = { name: a => a.objectName, area: a => a.area, act: a => a.activity, areaact: a => [a.area, a.activity].filter(Boolean).join(" · ") }[oc.titleSrc];
  const v = phbOcUniq(its.map(a => f ? f(a) : "")); return v.length ? v.slice(0, 4).join(" / ") + (v.length > 4 ? " …" : "") : "";
}
const phbOcCol = oc => oc.colOver || oc.autoCol || "#2563eb";

/* ---- Mått och ritning ------------------------------------------------------------------------------------------------------------------------ */
function phbOcMeasure(oc, st) {
  const ctx = phbMeasure(), kk = st.k * st.g.bscale * oc.scale, WMAX = 270 * kk, PAD = 14 * kk + 16 * kk; oc.kk = kk; oc.autoCol = phbOcAutoColor(st, oc);
  ctx.font = `700 ${15 * kk}px ${PHB_FAM}`;
  oc.tl = phbWrap(ctx, oc.title != null && oc.title !== "" ? oc.title : phbOcTitleFromGantt(oc) || (oc.objs.length === 1 ? phbOcName(oc.objs[0]) : `${oc.objs.length} objekt`), WMAX - PAD, 2);
  let need = Math.max(0, ...oc.tl.map(l => ctx.measureText(l).width));
  ctx.font = `${11.5 * kk}px ${PHB_FAM}`; const rows = [];
  oc.fields.forEach(key => phbOcVal(st, oc, key).forEach((v, i) => rows.push({ lab: i === 0 ? phbOcLabel(key) : "", v })));
  oc.rows = rows.slice(0, 16).map(r => { const lw = r.lab ? ctx.measureText(r.lab + ": ").width : 0; let t = String(r.v); const maxW = WMAX - PAD - lw; while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1); const v = t.length < String(r.v).length ? t.replace(/\s+$/, "") + "…" : t; need = Math.max(need, lw + ctx.measureText(v).width); return { lab: r.lab ? r.lab + ":" : "", lw, v }; });
  ctx.font = `italic ${11.5 * kk}px ${PHB_FAM}`;
  oc.tx = String(oc.text || "").trim() ? String(oc.text).split("\n").flatMap(l => (l.trim() ? phbWrap(ctx, l, WMAX - PAD, 3) : [""])).slice(0, 8) : [];
  while (oc.tx.length && oc.tx[oc.tx.length - 1] === "") oc.tx.pop();
  oc.tx.forEach(l => { need = Math.max(need, ctx.measureText(l).width); });
  oc.W = Math.max(130 * kk, Math.min(WMAX, need + PAD)); // bredden följer innehållet – ingen tom yta åt höger
  oc.h = (8 + oc.tl.length * 18 + (oc.rows.length ? 3 : 0) + oc.rows.length * 15.5 + (oc.tx.length ? 5 + oc.tx.length * 15 : 0) + 9) * kk;
}
function phbOcMeasureAll(st) { (st.ocards || []).forEach(oc => phbOcMeasure(oc, st)); }
function phbOcDraw(ctx, c) {
  const { x, y } = c, kk = c.kk, col = phbOcCol(c);
  ctx.save(); ctx.shadowColor = "rgba(15,23,42,.28)"; ctx.shadowBlur = 14 * kk; ctx.shadowOffsetY = 3 * kk; ctx.fillStyle = "#fff"; phbRR(ctx, x, y, c.W, c.h, 5 * kk); ctx.fill(); ctx.restore();
  ctx.fillStyle = col; ctx.fillRect(x, y + 1, 5 * kk, c.h - 2);
  let ty = y + 8 * kk; const tx = x + 14 * kk; ctx.textBaseline = "top"; ctx.fillStyle = "#111827"; ctx.font = `700 ${15 * kk}px ${PHB_FAM}`;
  c.tl.forEach(l => { ctx.fillText(l, tx, ty); ty += 18 * kk; }); if (c.rows.length) ty += 3 * kk;
  ctx.font = `${11.5 * kk}px ${PHB_FAM}`;
  c.rows.forEach(r => { ctx.fillStyle = "#6b7280"; if (r.lab) ctx.fillText(r.lab, tx, ty + 1 * kk); ctx.fillStyle = "#111827"; ctx.fillText(r.v, tx + r.lw, ty + 1 * kk); ty += 15.5 * kk; });
  if (c.tx.length) { ty += 5 * kk; ctx.fillStyle = "#374151"; ctx.font = `italic ${11.5 * kk}px ${PHB_FAM}`; c.tx.forEach(l => { ctx.fillText(l, tx, ty); ty += 15 * kk; }); }
}
function phbOcRender(ctx, st) {
  const k = st.k, list = st.ocards || [];
  if (st.g.lines) list.forEach(c => { if (!isFinite(c.ax)) return; const p = phbLeaderStart(c); if (!p) return;
    ctx.strokeStyle = phbOcCol(c); ctx.lineWidth = 2.5 * k * st.g.lineW; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(c.ax, c.ay); ctx.stroke();
    ctx.fillStyle = phbOcCol(c); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.arc(c.ax, c.ay, 6 * k * st.g.dot, 0, 7); ctx.fill(); ctx.stroke(); });
  list.forEach(c => phbOcDraw(ctx, c));
}
/* PDF: samma kort som vektorer (egen stämpel med linje och punkt). */
function phbOcPdfCard(c, f) {
  const kk = c.kk, w = c.W * f, h = c.h * f, tx = 14 * kk * f, col = phbOcCol(c); let o = "", ty = 8 * kk;
  o += `1 g ${phbRRpdf(0.5, 0.5, w - 1, h - 1, 4 * kk * f)} f 0.85 G ${phbN(0.8 * kk * f)} w ${phbRRpdf(0.5, 0.5, w - 1, h - 1, 4 * kk * f)} S `;
  o += `${phbRgb(col)} rg 0 ${phbN(1 * kk * f)} ${phbN(5 * kk * f)} ${phbN(h - 2 * kk * f)} re f `;
  o += `BT 0.07 0.09 0.15 rg /F2 ${phbN(15 * kk * f)} Tf `; c.tl.forEach(l => { o += `1 0 0 1 ${phbN(tx)} ${phbN(h - (ty + 12.3 * kk) * f)} Tm ${phbPdfStr(l)} Tj `; ty += 18 * kk; }); o += "ET "; if (c.rows.length) ty += 3 * kk;
  c.rows.forEach(r => { const by = h - (ty + 1 * kk + 9.4 * kk) * f;
    if (r.lab) o += `BT 0.42 0.45 0.5 rg /F1 ${phbN(11.5 * kk * f)} Tf 1 0 0 1 ${phbN(tx)} ${phbN(by)} Tm ${phbPdfStr(r.lab)} Tj ET `;
    o += `BT 0.07 0.09 0.15 rg /F1 ${phbN(11.5 * kk * f)} Tf 1 0 0 1 ${phbN(tx + r.lw * f)} ${phbN(by)} Tm ${phbPdfStr(r.v)} Tj ET `; ty += 15.5 * kk; });
  if (c.tx.length) { ty += 5 * kk; o += `BT 0.22 0.25 0.32 rg /F1 ${phbN(11.5 * kk * f)} Tf `; c.tx.forEach(l => { o += `1 0 0 1 ${phbN(tx)} ${phbN(h - (ty + 9.4 * kk) * f)} Tm ${phbPdfStr(l)} Tj `; ty += 15 * kk; }); o += "ET "; }
  return o;
}
function phbOcPdfBubble(st, c, f) {
  const k = st.k, withLine = st.g.lines && isFinite(c.ax), r = 8 * k * Math.max(1, st.g.dot), lw = 2.5 * k * st.g.lineW;
  const x0 = withLine ? Math.min(c.x, c.ax - r) : c.x, x1 = withLine ? Math.max(c.x + c.W, c.ax + r) : c.x + c.W, y0 = withLine ? Math.min(c.y, c.ay - r) : c.y, y1 = withLine ? Math.max(c.y + c.h, c.ay + r) : c.y + c.h; let o = "";
  if (withLine) { const p = phbLeaderStart(c); if (p) { const lx = v => (v - x0) * f, ly = v => (y1 - v) * f;
    o += `${phbRgb(phbOcCol(c))} RG ${phbN(lw * f)} w 1 J ${phbN(lx(p.x))} ${phbN(ly(p.y))} m ${phbN(lx(c.ax))} ${phbN(ly(c.ay))} l S `;
    o += `${phbRgb(phbOcCol(c))} rg 1 G ${phbN(2 * k * f)} w ${phbCirclePdf(lx(c.ax), ly(c.ay), 6 * k * st.g.dot * f)} B `; } }
  o += `q 1 0 0 1 ${phbN((c.x - x0) * f)} ${phbN((y1 - (c.y + c.h)) * f)} cm ${phbOcPdfCard(c, f)} Q`;
  return { stream: o, x0, x1, y0, y1 };
}

/* ---- Skapa bubblor ------------------------------------------------------------------------------------------------------------------------------ */
function phbOcAnchor(st, objs) {
  const bs = objs.map(o => o.box).filter(Boolean); if (!bs.length || !st.camC) return null;
  const lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  bs.forEach(b => ["x", "y", "z"].forEach(k => { lo[k] = Math.min(lo[k], b.min[k]); hi[k] = Math.max(hi[k], b.max[k]); }));
  return phbProject(st.camC, { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: hi.z }, st.W, st.H);
}
/* Kameran tas ur fotots kamera även när inga aktiviteter fanns att räkna ut den med. */
function phbOcEnsureCam(st, objs) {
  if (st.camC || !st.cam) return;
  const pts = objs.map(o => o.box && { x: (o.box.min.x + o.box.max.x) / 2, y: (o.box.min.y + o.box.max.y) / 2, z: (o.box.min.z + o.box.max.z) / 2 }).filter(Boolean);
  if (!pts.length) return;
  try { const c = phbPickCamera(st.cam, pts, st.W, st.H); if (c) st.camC = c; } catch (e) { /* okänd kamera */ }
}
function phbOcGroups(draft) {
  const objs = draft.objs.filter((o, i) => !draft.pick || draft.pick.has(i));
  if (draft.group === "all") return [objs];
  if (draft.group === "code") { const m = new Map(); objs.forEach(o => { const c = phbOcCodes(o)[0], k = c ? c.ref : "(ingen kod)"; (m.get(k) || m.set(k, []).get(k)).push(o); }); return [...m.values()]; }
  return objs.slice(0, 40).map(o => [o]);
}
function phbOcCreate(st, draft) {
  let n = 0;
  phbOcGroups(draft).forEach(g => {
    const oc = { id: (st.nextId = (st.nextId || 1) + 1), objs: g, fields: draft.fields.slice(), text: draft.text || "", title: "", dec: draft.dec == null ? 2 : draft.dec, titleSrc: draft.titleSrc || "", scale: draft.scale || 1, colOver: draft.colOver || null, x: 0, y: 0, ax: NaN, ay: NaN };
    phbOcEnsureCam(st, g); phbOcMeasure(oc, st); const q = phbOcAnchor(st, g), k = st.k;
    if (q && q.x > -0.05 * st.W && q.x < 1.05 * st.W && q.y > -0.05 * st.H && q.y < 1.05 * st.H) { oc.ax = q.x; oc.ay = q.y; oc.x = oc.ax - oc.W / 2; oc.y = oc.ay - oc.h - 56 * oc.kk; }
    else { oc.x = st.W - oc.W - 20 * k; oc.y = 20 * k + (st.ocards.length + n) * (oc.h + 8 * k); }
    oc.x = Math.max(10 * k, Math.min(st.W - oc.W - 10 * k, oc.x)); oc.y = Math.max(10 * k, Math.min(st.H - oc.h - 10 * k, oc.y));
    if (!isFinite(oc.ax)) { oc.ax = oc.x + oc.W / 2; oc.ay = Math.min(st.H - 10 * k, oc.y + oc.h + 60 * k); oc.free = true; } // läget ej känt: punkten dras till objektet
    st.ocards.push(oc); st.sel = oc; n++;
  });
  return n;
}

/* ---- Sidopanelen ------------------------------------------------------------------------------------------------------------------------------ */
/* Fältlistan (valda fält i ordning med ▲ ▼ ✕, och ett fält att lägga till – skriv för att söka bland alla egenskaper). */
function phbOcFieldsHtml(keys, sel, esc, id) {
  const rest = [...PHB_OC_SPECIAL.map(x => x[0]), ...keys].filter(k => !sel.includes(k));
  return `<div class="phb-ocf" data-ocid="${id}">${sel.map((k, i) => `<div class="phb-ocf-r"><span title="${esc(k)}">${esc(phbOcLabel(k))}${k.startsWith("◆") ? "" : ` <small>${esc(String(k).split(" / ").slice(0, -1).join(" / "))}</small>`}</span><button type="button" data-ocf="up" data-i="${i}"${i ? "" : " disabled"}>▲</button><button type="button" data-ocf="down" data-i="${i}"${i < sel.length - 1 ? "" : " disabled"}>▼</button><button type="button" data-ocf="del" data-i="${i}">✕</button></div>`).join("") || `<div class="phb-note">Inga fält valda.</div>`}
    <label class="phb-f"><span>Lägg till fält – skriv för att söka bland ${keys.length} egenskaper</span><input type="text" list="phbOcList${id}" data-ocadd placeholder="t.ex. HPM, Layer, Material …" autocomplete="off"><datalist id="phbOcList${id}">${rest.map(k => `<option value="${esc(k)}">`).join("")}</datalist></label></div>`;
}
function phbOcSide(api) {
  const cur = api.cur, esc = api.esc, d = cur.ocDraft;
  let h = `<div class="phb-sec"><div class="phb-h">Egna bubblor</div>`;
  if (d) {
    h += `<div class="phb-note">${d.objs.length} markerade objekt · ${d.keys.length} egenskaper. Välj vad bubblan ska visa.</div>${phbOcFieldsHtml(d.keys, d.fields, esc, "d")}
      <label class="phb-f"><span>Rubrik hämtas från</span><select id="phbOcDTSrc">${PHB_OC_TSRC.map(([v, l]) => `<option value="${v}"${(d.titleSrc || "") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="phb-f"><span>Decimaler på tal</span><select id="phbOcDDec">${[0, 1, 2, 3, 4].map(n => `<option value="${n}"${(d.dec == null ? 2 : d.dec) === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="phb-f"><span>Egen text <small>(valfritt)</small></span><textarea id="phbOcDText" rows="2">${esc(d.text || "")}</textarea></label>
      <div class="phb-f"><span>Objekt – ${d.pick.size} av ${d.objs.length} valda (en bubbla per valt objekt, högst 40)</span><div class="phb-row"><button type="button" id="phbOcPAll">Alla</button><button type="button" id="phbOcPNone">Inga</button></div>
        <div class="phb-ocf" style="max-height:160px;overflow:auto">${d.objs.map((o, i) => `<label class="phb-c"><input type="checkbox" data-ocp="${i}"${d.pick.has(i) ? " checked" : ""}> ${esc(phbOcName(o))}${o.objectId ? ` <small>${esc(String(o.objectId).slice(-8))}</small>` : ""}</label>`).join("")}</div></div>
      <label class="phb-f"><span>Bubblor</span><select id="phbOcDGroup"><option value="obj"${d.group === "obj" ? " selected" : ""}>En per objekt – varje för sig</option><option value="code"${d.group === "code" ? " selected" : ""}>En per AMA-kod (slår ihop objekten)</option><option value="all"${d.group === "all" ? " selected" : ""}>En gemensam (slår ihop objekten)</option></select></label>
      ${d.preset ? `<div class="phb-note">Ditt förval används (fält, decimaler, rubrik, skala, färg och egen text).</div>` : ""}
      <div class="phb-row"><button type="button" id="phbOcMake" class="primary"${d.pick.size ? "" : " disabled"}>Skapa bubblor</button><button type="button" id="phbOcDSavePre" title="Spara fälten, decimalerna, rubrikkällan, texten och bubbelläget som förval för nya bubblor">Spara som förval</button><button type="button" id="phbOcCancel">Avbryt</button></div>`;
  } else {
    h += `<button type="button" id="phbOcNew" title="Markera först ett eller flera objekt i modellen i Trimble Connect">＋ Bubbla från markerade i TC</button><div class="phb-note">${(cur.ocards || []).length ? `${cur.ocards.length} objektbubbl${cur.ocards.length === 1 ? "a" : "or"} på bilden. ` : ""}Bubblor med valfria egenskaper (UDA) från modellen, egen text och AMA-koden från mängdavtagningen.</div><div id="phbOcMsg" class="phb-note"></div>`;
  }
  h += `<div class="phb-row"><button type="button" id="phbOcQty" title="Läser mängderna och AMA-koderna från mängdavtagningen – samma som Läs in i mängdavtagningen, utan att lämna fotot">Läs in mängder</button></div><div id="phbOcQtyMsg" class="phb-note">${typeof qty !== "undefined" && qty.objs && qty.objs.length ? `${qty.objs.length} objekt inlästa.` : "Mängder är inte inlästa – fälten ◆ Mängd och ◆ AMA-kod behöver dem."}</div>`;
  if (cur.ocards && cur.ocards.some(c => c.free)) h += `<div class="phb-note">Bubblor med lös punkt: dra punkten på objektet i bilden.</div>`;
  return h + `</div>`;
}
function phbOcSelSide(api, oc) {
  const esc = api.esc;
  return `<div class="phb-sec phb-sel-sec"><div class="phb-h">Vald objektbubbla</div>
    <label class="phb-f"><span>Rubrik hämtas från</span><select id="phbOcTSrc">${PHB_OC_TSRC.map(([v, l]) => `<option value="${v}"${(oc.titleSrc || "") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="phb-f"><span>Rubrik <small>(egen text ersätter)</small></span><input type="text" id="phbOcTitle" value="${esc(oc.title || "")}" placeholder="${esc(oc.tl ? oc.tl.join(" ") : "")}"></label>
    ${phbOcFieldsHtml(phbOcKeys(oc.objs), oc.fields, esc, "c")}
    <label class="phb-f"><span>Decimaler på tal</span><select id="phbOcDec">${[0, 1, 2, 3, 4].map(n => `<option value="${n}"${(oc.dec == null ? 2 : oc.dec) === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
    <label class="phb-f"><span>Egen text</span><textarea id="phbOcText" rows="3">${esc(oc.text || "")}</textarea></label>
    ${api.rng("phbOcScale", "Bubblans skala", Math.round(oc.scale * 100), 40, 300, 5)}
    <div class="phb-row"><label class="phb-f"><span>Färg</span><input type="color" id="phbOcCol" value="${phbOcCol(oc)}"></label><button type="button" id="phbOcAuto" title="Färg efter aktivitetens status"${oc.colOver ? "" : " disabled"}>Auto</button></div>
    <div class="phb-row"><button type="button" id="phbOcSaveDef" title="Spara den här bubblans fält, decimaler, rubrikkälla, skala, färg och egna text som förval för nya bubblor från markeringen">Spara som förval</button></div>
    <div class="phb-note">${oc.objs.length} objekt · dra bubblan eller dess punkt för att flytta.</div>
    <button type="button" id="phbOcDel" class="danger">Ta bort bubblan</button></div>`;
}
function phbOcBind(api, side) {
  const cur = api.cur, q = id => side.querySelector("#" + id), on = (id, ev, fn) => { const e = q(id); if (e) e.addEventListener(ev, fn); };
  const bindFields = (arr, keys, after) => {
    side.querySelectorAll(`.phb-ocf[data-ocid="${arr === (cur.ocDraft || {}).fields ? "d" : "c"}"]`).forEach(box => {
      box.querySelectorAll("[data-ocf]").forEach(b => b.addEventListener("click", () => { const i = Number(b.dataset.i), a = b.dataset.ocf;
        if (a === "del") arr.splice(i, 1); else if (a === "up" && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; else if (a === "down" && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; after(); }));
      const add = box.querySelector("[data-ocadd]"); if (add) add.addEventListener("change", () => { const v = add.value.trim(); if (!v) return; const all = [...PHB_OC_SPECIAL.map(x => x[0]), ...keys]; const hit = all.find(k => k === v) || all.find(k => k.toLowerCase() === v.toLowerCase()) || all.find(k => k.toLowerCase().includes(v.toLowerCase())); if (hit && !arr.includes(hit)) { arr.push(hit); after(); } else add.value = ""; });
    });
  };
  on("phbOcNew", "click", async () => {
    const msg = q("phbOcMsg"); if (msg) msg.textContent = "Läser markeringen …";
    try { const objs = await phbOcReadSelection(); if (!objs.length) { if (msg) msg.textContent = "Inget är markerat i Trimble Connect – markera objekt i modellen först."; return; }
      const pre = phbOcPreset(), ks = phbOcKeys(objs);
      cur.ocDraft = { objs, keys: ks, fields: (pre ? pre.fields : phbOcDefaults()).filter(f => f.startsWith("◆") || ks.includes(f)), text: pre ? pre.text : "", group: pre ? pre.group : "obj", dec: pre ? pre.dec : 2, titleSrc: pre ? pre.titleSrc : "", scale: pre ? pre.scale : 1, colOver: pre ? pre.colOver : null, preset: !!pre, pick: new Set(objs.map((o, i) => i).slice(0, 40)) }; api.renderSide();
    } catch (e) { if (msg) msg.textContent = "Kunde inte läsa markeringen: " + ((e && e.message) || e); }
  });
  on("phbOcQty", "click", async () => {
    const b = q("phbOcQty"), m = q("phbOcQtyMsg"); if (typeof qtyRead !== "function") return; b.disabled = true; if (m) m.textContent = "Läser mängder …";
    try { await qtyRead(); (cur.ocards || []).forEach(c => { }); api.remeasure(); api.renderSide(); const m2 = side.querySelector("#phbOcQtyMsg"); if (m2) m2.textContent = qty.objs.length ? `${qty.objs.length} objekt inlästa.` : "Inga objekt lästes – kolla urvalet i mängdavtagningen."; }
    catch (e) { if (m) m.textContent = "Kunde inte läsa mängder: " + ((e && e.message) || e); b.disabled = false; }
  });
  const d = cur.ocDraft;
  if (d) { bindFields(d.fields, d.keys, () => api.renderSide()); on("phbOcDText", "input", e => { d.text = e.target.value; }); on("phbOcDDec", "change", e => { d.dec = Number(e.target.value); }); side.querySelectorAll("[data-ocp]").forEach(c => c.addEventListener("change", () => { const i = Number(c.dataset.ocp); if (c.checked) d.pick.add(i); else d.pick.delete(i); const b = q("phbOcMake"); if (b) b.disabled = !d.pick.size; }));
    on("phbOcPAll", "click", () => { d.pick = new Set(d.objs.map((o, i) => i).slice(0, 40)); api.renderSide(); }); on("phbOcPNone", "click", () => { d.pick = new Set(); api.renderSide(); });
    on("phbOcDTSrc", "change", e => { d.titleSrc = e.target.value; }); on("phbOcDGroup", "change", e => { d.group = e.target.value; });
    on("phbOcDSavePre", "click", () => { phbOcSavePreset(d); d.preset = true; if (typeof modelToast === "function") modelToast("Sparat som förval – nya bubblor får samma inställning"); api.renderSide(); });
    on("phbOcCancel", "click", () => { cur.ocDraft = null; api.renderSide(); });
    on("phbOcMake", "click", () => { phbOcRemember(d.fields); const n = phbOcCreate(cur, d); cur.ocDraft = null; api.remeasure(); api.renderSide(); if (typeof modelToast === "function") modelToast(`${n} bubbl${n === 1 ? "a" : "or"} skapade`); }); }
  const oc = cur.sel && (cur.ocards || []).includes(cur.sel) ? cur.sel : null;
  if (oc) {
    bindFields(oc.fields, phbOcKeys(oc.objs), () => { api.remeasure(); api.renderSide(); });
    on("phbOcDec", "change", e => { oc.dec = Number(e.target.value); api.remeasure(); });
    on("phbOcTSrc", "change", e => { oc.titleSrc = e.target.value; api.remeasure(); api.renderSide(); });
    on("phbOcTitle", "input", e => { oc.title = e.target.value; api.remeasure(); }); on("phbOcText", "input", e => { oc.text = e.target.value; api.remeasure(); });
    on("phbOcScale", "input", e => { oc.scale = Number(e.target.value) / 100; const l = q("phbOcScaleV"); if (l) l.textContent = e.target.value + "%"; api.remeasure(); });
    on("phbOcCol", "input", e => { oc.colOver = e.target.value; const a = q("phbOcAuto"); if (a) a.disabled = false; api.draw(); });
    on("phbOcAuto", "click", () => { oc.colOver = null; api.draw(); api.renderSide(); });
    on("phbOcSaveDef", "click", () => { phbOcSavePreset(oc); if (typeof modelToast === "function") modelToast("Sparat som förval – nya bubblor från markeringen får samma inställning"); });
    on("phbOcDel", "click", () => api.removeObj({ type: "ocard", o: oc }));
  }
}

/* ---- Sparade vyer (hela uppsättningen i bildredigeraren) ------------------------------------------------------------------------------ */
const PHB_VW_KEY = "4ddash-phb-views";
const phbVwLoad = () => { try { const a = JSON.parse(localStorage.getItem(PHB_VW_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
const phbVwStore = a => { try { localStorage.setItem(PHB_VW_KEY, JSON.stringify(a)); return true; } catch (e) { return false; } };
function phbVwSnap(st) {
  const W = st.W, H = st.H, lst = st.list, dt = st.dateObj;
  return {
    g: { ...st.g }, progMode: st.progMode, sharp: st.sharp,
    list: { on: lst.on, title: lst.title, max: lst.max, scale: lst.scale, weeks: lst.weeks, fx: lst.x / W, fy: lst.y / H },
    dateObj: { on: dt.on, scale: dt.scale, fx: dt.x / W, fy: dt.y / H },
    tables: (st.tables || []).map(t => ({ src: t.src, keys: t.keys, area: t.area, cols: t.cols, dec: t.dec, max: t.max, scale: t.scale, title: t.title, col: t.col, fx: t.x / W, fy: t.y / H })),
    texts: st.texts.map(t => { const c = { ...t, fx: t.x / W, fy: t.y / H }; delete c.id; delete c.x; delete c.y; return c; }),
    oc: (st.ocards || []).map(c => { phbOcEnsureCam(st, c.objs); const q = phbOcAnchor(st, c.objs); return ({ ofx: q && isFinite(c.ax) ? (c.ax - q.x) / W : undefined, ofy: q && isFinite(c.ay) ? (c.ay - q.y) / H : undefined, fields: c.fields.slice(), text: c.text, title: c.title, dec: c.dec, titleSrc: c.titleSrc || "", scale: c.scale, colOver: c.colOver, fx: c.x / W, fy: c.y / H, fax: c.ax / W, fay: c.ay / H, free: !!c.free,
      objs: c.objs.slice(0, 60).map(o => ({ modelId: o.modelId, objectId: o.objectId, rid: o.rid, box: o.box, flat: o.flat })) }); })
  };
}
function phbVwApply(st, v) {
  const W = st.W, H = st.H;
  Object.assign(st.g, v.g || {}); if (v.progMode) st.progMode = v.progMode; if (v.sharp != null) st.sharp = v.sharp;
  if (v.list) Object.assign(st.list, { on: v.list.on, title: v.list.title, max: v.list.max, scale: v.list.scale, weeks: v.list.weeks, x: v.list.fx * W, y: v.list.fy * H });
  if (v.dateObj) Object.assign(st.dateObj, { on: v.dateObj.on, scale: v.dateObj.scale, x: v.dateObj.fx * W, y: v.dateObj.fy * H });
  st.texts = (v.texts || []).map(t => { const c = { ...t, id: st.nextId++, x: t.fx * W, y: t.fy * H }; delete c.fx; delete c.fy; if (typeof phbTextMeasure === "function") phbTextMeasure(c, st); return c; });
  st.ocards = (v.oc || []).map(d => {
    const oc = { id: st.nextId++, objs: d.objs, fields: d.fields.slice(), text: d.text || "", title: d.title || "", dec: d.dec == null ? 2 : d.dec, titleSrc: d.titleSrc || "", scale: d.scale || 1, colOver: d.colOver || null, x: d.fx * W, y: d.fy * H, ax: d.fax * W, ay: d.fay * H, free: !!d.free };
    // Insättningspunkten behåller sitt läge: standardläget i bilden plus din justering (så den hoppar inte när vyn läses in).
    phbOcEnsureCam(st, oc.objs); const q = phbOcAnchor(st, oc.objs);
    if (q && d.ofx !== undefined && d.ofy !== undefined) { const ax = q.x + d.ofx * W, ay = q.y + d.ofy * H; if (ax > -0.05 * W && ax < 1.05 * W && ay > -0.05 * H && ay < 1.05 * H) { oc.ax = ax; oc.ay = ay; oc.free = !!d.free; } }
    return oc;
  });
  st.tables = (v.tables || []).map(d => ({ ...d, id: st.nextId++, x: d.fx * W, y: d.fy * H }));
  st.sel = st.ocards[0] || st.tables[0] || null; st.ocDraft = null; st.qtDraft = null;
}
function phbVwSide(api) {
  const esc = api.esc, vs = phbVwLoad(), sel = (api.cur.vwSel != null && vs[api.cur.vwSel]) ? api.cur.vwSel : -1;
  return `<div class="phb-sec"><div class="phb-h">Sparade vyer</div>
    <div class="phb-row"><input type="text" id="phbVwName" placeholder="Namn på vyn" maxlength="60"><button type="button" id="phbVwSave" class="primary">Spara vy</button></div>
    ${vs.length ? `<div class="phb-row"><select id="phbVwSel">${vs.map((v, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>
    <div class="phb-row"><button type="button" id="phbVwUse">Använd</button><button type="button" id="phbVwUpd" title="Skriv över den valda vyn med det som är på bilden nu">Uppdatera</button><button type="button" id="phbVwDel" class="danger">Ta bort</button></div>` : ""}
    <div class="phb-note" id="phbVwMsg">${vs.length ? "" : "Spara bubblor, text, lista, datum och inställningar som en vy och återanvänd dem på nästa foto."} Vyerna sparas i den här webbläsaren.</div></div>`;
}
function phbVwBind(api, side) {
  const q = id => side.querySelector("#" + id), on = (id, fn) => { const e = q(id); if (e) e.addEventListener("click", fn); }, cur = api.cur;
  const say = t => { const m = q("phbVwMsg"); if (m) m.textContent = t; };
  on("phbVwSave", () => { const nm = (q("phbVwName").value || "").trim(); if (!nm) { say("Skriv ett namn först."); return; }
    const vs = phbVwLoad(), i = vs.findIndex(v => v.name === nm), rec = { name: nm, data: phbVwSnap(cur) }; if (i >= 0) vs[i] = rec; else vs.push(rec);
    if (!phbVwStore(vs)) { say("Kunde inte spara – webbläsarens lagring är full eller avstängd."); return; } cur.vwSel = i >= 0 ? i : vs.length - 1; api.renderSide(); if (typeof modelToast === "function") modelToast(`Vyn "${nm}" sparad`); });
  on("phbVwUse", () => { const vs = phbVwLoad(), i = Number(q("phbVwSel").value), v = vs[i]; if (!v) return; phbVwApply(cur, v.data); cur.vwSel = i; api.remeasure(); api.renderSide(); if (typeof modelToast === "function") modelToast(`Vyn "${v.name}" inläst`); });
  on("phbVwUpd", () => { const vs = phbVwLoad(), i = Number(q("phbVwSel").value); if (!vs[i]) return; vs[i].data = phbVwSnap(cur); if (!phbVwStore(vs)) { say("Kunde inte spara."); return; } if (typeof modelToast === "function") modelToast(`Vyn "${vs[i].name}" uppdaterad`); });
  on("phbVwDel", () => { const vs = phbVwLoad(), i = Number(q("phbVwSel").value); if (!vs[i] || !confirm(`Ta bort vyn "${vs[i].name}"?`)) return; vs.splice(i, 1); phbVwStore(vs); cur.vwSel = null; api.renderSide(); });
}
