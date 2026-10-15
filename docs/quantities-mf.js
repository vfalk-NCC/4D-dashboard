/* Mängdavtagning – jämförelse mot mängdförteckningen (Victor 2026-10-14). Läser mängdförteckningen (Excel, .xlsx) direkt i webbläsaren
   (inget bibliotek – en .xlsx är en zip med XML), och jämför per post och byggnad:
     Kontrakt · Prognos · Modell klar (enligt Ganttens regel) · Modell totalt (objekten som är kopplade i planen) · Klart av prognos · Kvar.
   Kopplingen modell → förteckning görs med två små tabeller som sparas i webbläsaren:
     Typ (t.ex. "Basic Wall:Concrete - Cast-in-Place - 700") → post (t.ex. ESE.21), och Område i Gantt (t.ex. "743 Krosshall") → byggnad.
   Förslag fylls i automatiskt (väggar → ESE.21 m.m., byggnad efter namn och områdeskod) men kan ändras. Förteckningen ändras aldrig. */

const QMF_KEY = "4ddash-qty-mf", QMF_MAP = "4ddash-qty-map";
const qmf = { posts: [], builds: [], file: "", build: "", typeKey: "", map: { types: {}, areas: {} }, msg: "" };
try { const s = JSON.parse(localStorage.getItem(QMF_KEY) || "null"); if (s && Array.isArray(s.posts)) { qmf.posts = s.posts; qmf.builds = s.builds || []; qmf.file = s.file || ""; } } catch (e) { /* ingen sparad */ }
try { const m = JSON.parse(localStorage.getItem(QMF_MAP) || "null"); if (m) { let ty = m.types || {}; if (Object.values(ty).some(v => typeof v === "string")) ty = { vol: ty }; /* äldre sparning: bara volym */ qmf.map = { types: ty, areas: m.areas || {} }; qmf.typeKey = m.typeKey || ""; qmf.build = m.build || ""; } } catch (e) { /* standard */ }
const qmfSave = () => { try { localStorage.setItem(QMF_MAP, JSON.stringify({ ...qmf.map ? { types: qmf.map.types, areas: qmf.map.areas } : {}, typeKey: qmf.typeKey, build: qmf.build })); } catch (e) { /* ingen lagring */ } };
const qmfSavePosts = () => { try { localStorage.setItem(QMF_KEY, JSON.stringify({ posts: qmf.posts, builds: qmf.builds, file: qmf.file })); } catch (e) { qmf.msg = "Förteckningen är för stor för att sparas i webbläsaren – den gäller bara tills sidan laddas om."; } };

/* ---- .xlsx utan bibliotek --------------------------------------------------------------------------- */
async function qmfInflate(bytes) { const ds = new DecompressionStream("deflate-raw"), w = ds.writable.getWriter(); w.write(bytes); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
async function qmfUnzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), out = new Map(), dec = new TextDecoder("utf-8");
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("Filen är ingen .xlsx (zip hittades inte)");
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    const ln = dv.getUint16(off + 26, true), lx = dv.getUint16(off + 28, true), data = u8.subarray(off + 30 + ln + lx, off + 30 + ln + lx + csize);
    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) continue;
    out.set(name, dec.decode(method === 8 ? await qmfInflate(data) : data));
  }
  return out;
}
const qmfXml = s => new DOMParser().parseFromString(s, "application/xml");
const qmfCol = ref => { const m = /^([A-Z]+)/.exec(ref) || ["", "A"]; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
/* { name, rows: [[celler]] } per blad. */
async function qmfReadXlsx(buf) {
  const files = await qmfUnzip(buf), wb = qmfXml(files.get("xl/workbook.xml") || ""), rels = qmfXml(files.get("xl/_rels/workbook.xml.rels") || "");
  const sst = []; if (files.has("xl/sharedStrings.xml")) qmfXml(files.get("xl/sharedStrings.xml")).querySelectorAll("si").forEach(si => sst.push([...si.querySelectorAll("t")].map(t => t.textContent).join("")));
  const target = new Map(); rels.querySelectorAll("Relationship").forEach(r => target.set(r.getAttribute("Id"), r.getAttribute("Target")));
  const sheets = [];
  for (const sh of wb.querySelectorAll("sheet")) {
    const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"), t = String(target.get(rid) || "").replace(/^\/?(xl\/)?/, "xl/"), xml = files.get(t); if (!xml) continue;
    const rows = []; qmfXml(xml).querySelectorAll("sheetData > row").forEach(r => {
      const rn = Number(r.getAttribute("r")) - 1, arr = rows[rn] = rows[rn] || [];
      r.querySelectorAll("c").forEach(c => { const ci = qmfCol(c.getAttribute("r") || "A"), ty = c.getAttribute("t"), v = c.querySelector("v"); let val = null;
        if (ty === "s") val = v ? sst[Number(v.textContent)] : null; else if (ty === "inlineStr") val = [...c.querySelectorAll("t")].map(x => x.textContent).join(""); else if (ty === "str" || ty === "e") val = v ? v.textContent : null; else if (ty === "b") val = v ? v.textContent === "1" : null; else if (v && v.textContent !== "") val = Number(v.textContent);
        arr[ci] = val === undefined ? null : val; });
    });
    sheets.push({ name: sh.getAttribute("name"), rows });
  }
  return sheets;
}
/* ---- Mängdförteckningens poster ------------------------------------------------------------------- */
function qmfParse(sheets) {
  const posts = new Map(), builds = new Set(), num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
  sheets.forEach(sh => {
    const hi = sh.rows.findIndex(r => r && String(r[0] || "").trim() === "Ref"); if (hi < 0) return;
    const h = sh.rows[hi], cU = h.findIndex(c => String(c || "").trim() === "Enhet"); if (cU < 0) return;
    const kc = []; let c = cU + 1; while (c < h.length && String(h[c] || "").trim() !== "Mängd") { if (h[c]) kc.push([c, String(h[c]).trim()]); c++; }
    const kTot = c; let p0 = kTot + 1; while (p0 < h.length && !h[p0]) p0++;
    const pc = kc.map(([, b], i) => [p0 + i, b]); // prognosblocket har samma byggnader i samma ordning
    kc.forEach(([, b]) => builds.add(b));
    let lastRef = "", lastText = "";
    for (let i = hi + 1; i < sh.rows.length; i++) {
      const r = sh.rows[i]; if (!r) continue;
      const ref = String(r[0] || "").trim(), text = r.slice(1, cU).filter(x => x !== null && x !== undefined && String(x).trim() !== "").map(x => String(x).trim()).join(" | "), unit = String(r[cU] || "").trim();
      if (ref) { lastRef = ref; lastText = text; }
      if (!unit || unit === "-" || unit === "Enhet") continue;
      const k = {}, pr = {}; let any = false;
      kc.forEach(([ci, b]) => { const v = num(r[ci]); if (v !== null) { k[b] = v; any = true; } });
      pc.forEach(([ci, b]) => { const v = num(r[ci]); if (v !== null) { pr[b] = v; any = true; } });
      if (!any) continue;
      const label = ref ? text : (lastText ? `${lastText} › ${text}` : text), key = `${lastRef}|${label}|${unit}`;
      const post = posts.get(key) || { key, ref: lastRef, label, unit, k: {}, p: {} };
      Object.entries(k).forEach(([b, v]) => { post.k[b] = (post.k[b] || 0) + v; }); Object.entries(pr).forEach(([b, v]) => { post.p[b] = (post.p[b] || 0) + v; });
      posts.set(key, post);
    }
  });
  return { posts: [...posts.values()], builds: [...builds] };
}
async function qmfLoadFile(file) {
  try {
    const sheets = await qmfReadXlsx(await file.arrayBuffer()), r = qmfParse(sheets);
    if (!r.posts.length) { qmf.msg = "Hittade inga poster i filen (letar efter en rad med 'Ref' och 'Enhet')."; qmfRender(); return; }
    qmf.posts = r.posts; qmf.builds = r.builds; qmf.file = file.name; qmf.msg = `${r.posts.length} poster och ${r.builds.length} byggnader inlästa.`; qmfSavePosts(); qmfAutoMap(); qmfRender();
  } catch (e) { console.warn("Mängdförteckning", e); qmf.msg = "Kunde inte läsa filen: " + ((e && e.message) || e); qmfRender(); }
}
/* ---- Kopplingarna ----------------------------------------------------------------------------------- */
/* Poster med enheten för valt mängdslag (betong m³, form m², längd m, armering kg). */
const qmfPosts = () => qmf.posts.filter(p => p.unit === QTY_KINDS[qtyKind()][1]);
const qmfTypes = () => (qmf.map.types[qtyKind()] = qmf.map.types[qtyKind()] || {});
const qmfStem = s => String(s || "").toLowerCase().replace(/[^a-zåäö0-9 ]/g, "").replace(/(huset|hus|et|en|n|t)$/i, "").trim();
const qmfTypeVal = o => String(o.flat[qmf.typeKey] === undefined ? "(saknas)" : o.flat[qmf.typeKey]);
const qmfAreaOf = o => String((o.item && o.item.area) || "").split("/").map(x => x.trim()).filter(Boolean).pop() || "(utan område)";
/* Förslag: typ → post efter namnet (Revit-familjer), område → byggnad efter namn och områdeskod (742A/742B → samma kod som 742 Sikthall …). */
function qmfSuggestPost(t) {
  const kind = qtyKind(), P = qmfPosts(), byRef = ref => (P.find(p => p.ref === ref) || {}).key, byLabel = (ref, re) => (P.find(p => p.ref === ref && re.test(p.label)) || {}).key;
  const wall = /basic wall|vägg|wall/i.test(t), found = /foundation slab|footing|grundsula|plint/i.test(t), floor = /floor|bjälklag|slab/i.test(t), col = /column|pelare/i.test(t), mach = /machine|maskinfundament/i.test(t);
  if (kind === "form") { // formar av valfri typ (ESB.1), yta m²
    if (wall) return byLabel("ESB.1", /väggar/i); if (found) return byLabel("ESB.1", /grundsulor/i); if (col) return byLabel("ESB.1", /pelare/i); if (mach) return byLabel("ESB.1", /maskinfundament/i); return undefined;
  }
  if (kind !== "vol") return undefined;
  if (wall) return byRef("ESE.21"); if (found) return byRef("ESE.15"); if (floor) return byRef("ESE.2431"); if (col) return byRef("ESE.22"); if (mach) return byRef("ESE.182");
  return undefined;
}
function qmfSuggestBuild(area, learned) {
  const a = qmfStem(area.replace(/^\d+[a-z]?\s*/i, "")), code = (area.match(/^(\d{3})/) || [])[1];
  const byName = qmf.builds.find(b => { const s = qmfStem(b); return s && a && (a.includes(s) || s.includes(a) || a.startsWith(s.slice(0, 6))); });
  if (byName) return byName;
  if (code && learned[code]) return learned[code];
  // Områdeskoderna i NSV: 741 Sektionsfickor, 742 Sikthall (även stödmurar 742A/B/C), 743 Krosshall, 744 Fläkthus, 745 Förtjockarhus.
  const NSV = { 741: "Sektionsfickor", 742: "Sikthall", 743: "Krosshall", 744: "Fläkthus", 745: "Förtjockarhus" };
  if (code && NSV[code] && qmf.builds.includes(NSV[code])) return NSV[code];
  return undefined;
}
function qmfAutoMap() {
  const objs = typeof qty !== "undefined" ? qty.objs : []; if (!objs.length) return;
  if (!qmf.typeKey || !qty.keys.has(qmf.typeKey)) qmf.typeKey = [...qty.keys.keys()].find(k => /product\s*object\s*type$/i.test(k)) || [...qty.keys.keys()].find(k => /produkt \/ namn/i.test(k)) || "";
  new Set(objs.map(qmfTypeVal)).forEach(t => { if (qmfTypes()[t] === undefined) { const s = qmfSuggestPost(t); if (s) qmfTypes()[t] = s; } });
  const areas = [...new Set(objs.map(qmfAreaOf))], learned = {};
  areas.forEach(a => { const code = (a.match(/^(\d{3})/) || [])[1], b = qmf.builds.find(x => { const s = qmfStem(x), n = qmfStem(a.replace(/^\d+[a-z]?\s*/i, "")); return s && n && (n.includes(s) || s.includes(n)); }); if (code && b && !learned[code]) learned[code] = b; });
  areas.forEach(a => { if (qmf.map.areas[a] === undefined) { const b = qmfSuggestBuild(a, learned); if (b) qmf.map.areas[a] = b; } });
  qmfSave();
}
/* ---- Jämförelsen ------------------------------------------------------------------------------------ */
function qmfCompare() {
  const sel = qmf.build, rows = new Map(), all = typeof qty !== "undefined" ? qty.objs : [], f = qty.factor || 1;
  const sumB = (o, b) => (b ? o[b] || 0 : Object.values(o).reduce((s, v) => s + v, 0));
  qmfPosts().forEach(p => rows.set(p.key, { p, k: sumB(p.k, sel), pr: sumB(p.p, sel), klar: 0, tot: 0, n: 0 }));
  let unmapped = 0, unmappedVol = 0, otherBuild = 0;
  all.forEach(o => {
    const v = qtyValue(o); if (v === null) return;
    if (!qtyPass(o)) return;
    const post = qmfTypes()[qmfTypeVal(o)], r = post && rows.get(post);
    if (!r) { unmapped++; unmappedVol += v; return; }
    const b = qmf.map.areas[qmfAreaOf(o)] || "";
    if (sel && b !== sel) { otherBuild++; return; }
    r.tot += v; r.n++; if (qtyDone(o)) r.klar += v;
  });
  const list = [...rows.values()].filter(r => r.k || r.pr || r.tot);
  return { list, unmapped, unmappedVol, otherBuild };
}
const qmfPct = (a, b) => (b ? Math.round(a / b * 100) : null);
function qmfCsv(C) {
  const d = v => String(Math.round(v * 100) / 100).replace(".", ",");
  const lines = [["Post", "Beskrivning", "Enhet", "Kontrakt", "Prognos", "Modell klar", "Modell totalt", "Klart av prognos %", "Kvar (prognos − klar)"], ...C.list.map(r => [r.p.ref, r.p.label, r.p.unit, d(r.k), d(r.pr), d(r.klar), d(r.tot), qmfPct(r.klar, r.pr) ?? "", d(r.pr - r.klar)])];
  return "﻿" + lines.map(l => l.map(x => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\r\n");
}
function qmfRender() {
  const host = document.getElementById("qmfBox"); if (!host) return;
  const E = qtyEsc, hasObjs = typeof qty !== "undefined" && qty.objs.length > 0, hasMf = qmf.posts.length > 0;
  let html = `<h3 class="qmf-h">Jämför mot mängdförteckningen <span class="hint">· mängdslag: ${E(QTY_KINDS[qtyKind()][0])} (byts ovan)</span></h3><div class="qty-row"><label>Mängdförteckning (.xlsx) <input type="file" id="qmfFile" accept=".xlsx" /></label>${hasMf ? `<span class="hint">✓ ${E(qmf.file)} · ${qmf.posts.length} poster · ${qmf.builds.length} byggnader</span><button type="button" id="qmfClear">Ta bort</button>` : ""}<span class="hint" id="qmfMsg">${E(qmf.msg)}</span></div>`;
  if (!hasMf || !hasObjs) { host.innerHTML = html + `<div class="hint">${!hasMf ? "Välj mängdförteckningen (Excel). Filen läses bara i din webbläsare och ändras inte." : "Tryck på Läs mängder ovan först."}</div>`; wire(); return; }
  const types = new Map(), areas = new Map();
  qty.objs.forEach(o => { const t = qmfTypeVal(o), a = qmfAreaOf(o), v = qtyValue(o) ?? 0;
    const te = types.get(t) || { n: 0, v: 0 }; te.n++; te.v += v; types.set(t, te); const ae = areas.get(a) || { n: 0, v: 0 }; ae.n++; ae.v += v; areas.set(a, ae); });
  const postOpts = sel => `<option value="">(ingen post)</option>${qmfPosts().map(p => `<option value="${E(p.key)}"${sel === p.key ? " selected" : ""}>${E(p.ref)} – ${E(p.label.slice(0, 100))} [${E(p.unit)}]</option>`).join("")}`;
  const bOpts = sel => `<option value="">(ingen byggnad)</option>${qmf.builds.map(b => `<option value="${E(b)}"${sel === b ? " selected" : ""}>${E(b)}</option>`).join("")}`;
  const C = qmfCompare(), u = QTY_KINDS[qtyKind()][1];
  html += `<details class="qmf-map" open><summary>1. Vilken post är objekten? <span class="hint">(per ${E(qmf.typeKey || "egenskap")})</span></summary>
      <label class="qty-row">Typ-egenskap <select id="qmfTypeKey">${[...qty.keys.keys()].map(k => `<option value="${E(k)}"${qmf.typeKey === k ? " selected" : ""}>${E(k)}</option>`).join("")}</select></label>
      <table class="qty-table"><thead><tr><th>Typ i modellen</th><th class="num">Objekt</th><th class="num">${u}</th><th>Post i förteckningen</th></tr></thead><tbody>${[...types].sort((a, b) => b[1].v - a[1].v).map(([t, e]) => `<tr><td>${E(t)}</td><td class="num">${e.n}</td><td class="num">${qtyFmt(e.v)}</td><td><select data-ty="${E(t)}">${postOpts(qmfTypes()[t])}</select></td></tr>`).join("")}</tbody></table></details>
    <details class="qmf-map" open><summary>2. Vilken byggnad hör området till? <span class="hint">(Områdena i Gantt-schemat)</span></summary>
      <table class="qty-table"><thead><tr><th>Område i Gantt</th><th class="num">Objekt</th><th class="num">${u}</th><th>Byggnad i förteckningen</th></tr></thead><tbody>${[...areas].sort((a, b) => a[0].localeCompare(b[0], "sv", { numeric: true })).map(([a, e]) => `<tr><td>${E(a)}</td><td class="num">${e.n}</td><td class="num">${qtyFmt(e.v)}</td><td><select data-ar="${E(a)}">${bOpts(qmf.map.areas[a])}</select></td></tr>`).join("")}</tbody></table></details>
    <div class="qty-row"><label>Byggnad <select id="qmfBuild"><option value="">Alla byggnader</option>${qmf.builds.map(b => `<option value="${E(b)}"${qmf.build === b ? " selected" : ""}>${E(b)}</option>`).join("")}</select></label><span class="hint">Klara vid ${E(qtyAt())} enligt Ganttens regel</span></div>
    <table class="qty-table qmf-table"><thead><tr><th>Post</th><th class="num">Kontrakt</th><th class="num">Prognos</th><th class="num">Modell klar</th><th class="num">Modell totalt</th><th class="num">Klart av prognos</th><th class="num">Kvar</th></tr></thead><tbody>${C.list.map(r => { const pc = qmfPct(r.klar, r.pr), dv = qmfPct(r.tot - r.pr, r.pr); return `<tr title="${E(r.p.label)}"><td><b>${E(r.p.ref)}</b> ${E(r.p.label.slice(0, 60))}</td><td class="num">${qtyFmt(r.k, 0)}</td><td class="num">${qtyFmt(r.pr, 0)}</td><td class="num"><b>${qtyFmt(r.klar)}</b></td><td class="num${dv !== null && Math.abs(dv) > 15 ? " qmf-bad" : dv !== null && Math.abs(dv) > 5 ? " qmf-warn" : ""}" title="Modell totalt mot prognos: ${dv === null ? "–" : (dv > 0 ? "+" : "") + dv + " %"}">${qtyFmt(r.tot)}</td><td class="num">${pc === null ? "–" : pc + " %"}</td><td class="num">${qtyFmt(r.pr - r.klar, 0)}</td></tr>`; }).join("") || `<tr><td colspan="7" class="hint">Inga poster med mängd för valet.</td></tr>`}</tbody></table>
    <div class="hint">${C.unmapped ? `${C.unmapped} objekt (${qtyFmt(C.unmappedVol)} ${u}) har ingen post vald och räknas inte med. ` : ""}${C.otherBuild ? `${C.otherBuild} objekt hör till andra byggnader. ` : ""}"Modell totalt" är objekten som är kopplade i planen – inte hela modellen. Orange/röd = modell totalt avviker mer än 5 / 15 % från prognosen.</div>
    <div class="qty-row"><button type="button" id="qmfCsv">Exportera jämförelsen (CSV)</button></div>`;
  host.innerHTML = html; wire();
  function wire() {
    const q = s => host.querySelector(s);
    const fi = q("#qmfFile"); if (fi) fi.onchange = () => { if (fi.files && fi.files[0]) qmfLoadFile(fi.files[0]); };
    const cl = q("#qmfClear"); if (cl) cl.onclick = () => { qmf.posts = []; qmf.builds = []; qmf.file = ""; qmf.msg = ""; try { localStorage.removeItem(QMF_KEY); } catch (e) { /* */ } qmfRender(); };
    if (!hasMf || !hasObjs) return;
    q("#qmfTypeKey").onchange = e => { qmf.typeKey = e.target.value; qmfSave(); qmfAutoMap(); qmfRender(); };
    host.querySelectorAll("[data-ty]").forEach(s => { s.onchange = () => { qmfTypes()[s.dataset.ty] = s.value; qmfSave(); qmfRender(); }; });
    host.querySelectorAll("[data-ar]").forEach(s => { s.onchange = () => { qmf.map.areas[s.dataset.ar] = s.value; qmfSave(); qmfRender(); }; });
    q("#qmfBuild").onchange = e => { qmf.build = e.target.value; qmfSave(); qmfRender(); };
    q("#qmfCsv").onclick = () => { const b = new Blob([qmfCsv(qmfCompare())], { type: "text/csv;charset=utf-8" }), url = URL.createObjectURL(b), a = document.createElement("a"); a.href = url; a.download = `Mängdjämförelse ${qmf.build || "alla byggnader"} ${todayISO()}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };
  }
}
/* När mängderna lästs: föreslå kopplingar. */
const qtyRead0 = typeof qtyRead === "function" ? qtyRead : null;
if (qtyRead0) qtyRead = async function () { await qtyRead0(); try { if (qmf.posts.length) qmfAutoMap(); } catch (e) { console.warn(e); } qtyRender(); };
