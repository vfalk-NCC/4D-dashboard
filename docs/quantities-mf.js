/* Mängdavtagning – jämförelse mot mängdförteckningen (Victor 2026-10-14). Läser mängdförteckningen (Excel, .xlsx) direkt i webbläsaren
   (inget bibliotek – en .xlsx är en zip med XML), och jämför per post och byggnad:
     Kontrakt · Prognos · Modell klar (enligt Ganttens regel) · Modell totalt (objekten som är kopplade i planen) · Klart av prognos · Kvar.
   Kopplingen modell → förteckning görs med två små tabeller som sparas i webbläsaren:
     Typ (t.ex. "Basic Wall:Concrete - Cast-in-Place - 700") → post (t.ex. ESE.21), och Område i Gantt (t.ex. "743 Krosshall") → byggnad.
   Förslag fylls i automatiskt (väggar → ESE.21 m.m., byggnad efter namn och områdeskod) men kan ändras. Förteckningen ändras aldrig. */

const QMF_KEY = "4ddash-qty-mf", QMF_MAP = "4ddash-qty-map";
const qmf = { f: { ty: "", po: "", ar: "", by: "" },  posts: [], builds: [], file: "", build: "", typeKey: "", map: { types: {}, areas: {}, obj: {}, mvO: {}, mvT: {} }, groupId: true, open: new Set(), msg: "" };
try { const s = JSON.parse(localStorage.getItem(QMF_KEY) || "null"); if (s && Array.isArray(s.posts)) { qmf.posts = s.posts; qmf.builds = s.builds || []; qmf.file = s.file || ""; } } catch (e) { /* ingen sparad */ }
try { const m = JSON.parse(localStorage.getItem(QMF_MAP) || "null"); if (m) { let ty = m.types || {}; if (Object.values(ty).some(v => typeof v === "string")) ty = { vol: ty }; /* äldre sparning: bara volym */ qmf.map = { types: ty, areas: m.areas || {}, obj: m.obj || {}, mvO: m.mvO || {}, mvT: m.mvT || {} }; qmf.groupId = m.groupId !== false; qmf.typeKey = m.typeKey || ""; qmf.build = m.build || ""; qmf.stamp = m.updated_at || ""; } } catch (e) { /* standard */ }
const qmfSave = () => { try { localStorage.setItem(QMF_MAP, JSON.stringify({ types: qmf.map.types, areas: qmf.map.areas, obj: qmf.map.obj || {}, mvO: qmf.map.mvO || {}, mvT: qmf.map.mvT || {}, groupId: qmf.groupId, typeKey: qmf.typeKey, build: qmf.build, updated_at: qmf.stamp || "" })); } catch (e) { /* ingen lagring */ } qmfSyncSoon("map"); };
const qmfSavePosts = () => { try { localStorage.setItem(QMF_KEY, JSON.stringify({ posts: qmf.posts, builds: qmf.builds, file: qmf.file })); } catch (e) { qmf.msg = "Förteckningen är för stor för att sparas i webbläsaren – den gäller bara tills sidan laddas om."; } qmfSyncSoon("posts"); };

/* ---- Delning via 4D-data (Victor 2026-10-15: "varför skulle vi inte spara det?") ----------------------------------------------
   Kopplingarna (typ/objekt → post, område → byggnad) och mängdförteckningens poster sparas i projektets mapp i det privata datarepot
   (projects/<projekt>/qty_mapping.json och qty_posts.json), så att alla som öppnar projektet ser samma kopplingar. Webbläsaren behåller en lokal kopia.
   Skrivs efter en kort paus; vid skrivning slås fjärrfilens kopplingar ihop med dina (dina ändringar går före). */
const QMF_PATH = k => `projects/${encodeURIComponent(typeof projectId !== "undefined" ? projectId : "_")}/${k === "posts" ? "qty_posts" : "qty_mapping"}.json`;
const qmfSync = { timers: {}, state: "", busy: false };
function qmfSyncState(t, bad) { qmfSync.state = t; const el = document.getElementById("qmfSyncState"); if (el) { el.textContent = t; el.classList.toggle("bad", !!bad); } }
const qmfCanSync = () => typeof settings !== "undefined" && settings.githubToken && typeof projectId !== "undefined" && projectId && typeof ghWriteJSON === "function";
function qmfSyncSoon(kind) {
  if (!qmfCanSync() || qmfSync.loading) return; qmf.stamp = new Date().toISOString();
  try { const m = JSON.parse(localStorage.getItem(QMF_MAP) || "{}"); m.updated_at = qmf.stamp; localStorage.setItem(QMF_MAP, JSON.stringify(m)); } catch (e) { /* */ }
  qmfSyncState("Sparar i 4D-data …"); clearTimeout(qmfSync.timers[kind]); qmfSync.timers[kind] = setTimeout(() => qmfSyncPush(kind), 1500);
}
const qmfMapPayload = () => ({ updated_at: qmf.stamp || new Date().toISOString(), map: { types: qmf.map.types, areas: qmf.map.areas, obj: qmf.map.obj || {}, mvO: qmf.map.mvO || {}, mvT: qmf.map.mvT || {} }, groupId: qmf.groupId, typeKey: qmf.typeKey, build: qmf.build });
function qmfMergeMaps(remote, local) { // dina kopplingar går före fjärrfilens, i övrigt behålls fjärrfilens
  const out = JSON.parse(JSON.stringify(remote || {}));
  ["types", "obj"].forEach(k => { out[k] = out[k] || {}; Object.keys(local[k] || {}).forEach(kind => { out[k][kind] = { ...(out[k][kind] || {}), ...local[k][kind] }; }); });
  out.areas = { ...(out.areas || {}), ...(local.areas || {}) }; ["mvO", "mvT"].forEach(k => { out[k] = { ...(out[k] || {}), ...(local[k] || {}) }; });
  return out;
}
async function qmfSyncPush(kind) {
  if (!qmfCanSync()) return;
  try {
    if (kind === "posts") {
      const payload = { updated_at: qmf.stamp || new Date().toISOString(), posts: qmf.posts, builds: qmf.builds, file: qmf.file };
      if (JSON.stringify(payload).length > 900000) { qmfSyncState("Förteckningen är för stor för att delas i 4D-data – den sparas bara i den här webbläsaren.", true); return; }
      await ghWriteJSON(settings.githubToken, QMF_PATH("posts"), () => [payload], "Mängdförteckning (poster)");
    } else {
      const local = qmfMapPayload();
      if (JSON.stringify(local).length > 900000) { qmfSyncState("Kopplingarna är för många för att delas i 4D-data – de sparas bara i den här webbläsaren.", true); return; }
      await ghWriteJSON(settings.githubToken, QMF_PATH("map"), arr => { const r = (Array.isArray(arr) && arr[0]) || {}; return [{ ...local, map: qmfMergeMaps(r.map, local.map) }]; }, "Mängdkopplingar (typ/objekt → post, område → byggnad)");
    }
    qmfSyncState("✓ Delat i 4D-data");
  } catch (e) { console.warn("Mängdkopplingar kunde inte sparas i 4D-data", e); qmfSyncState("Kunde inte spara i 4D-data (sparas lokalt): " + ((e && e.message) || e), true); }
}
/* Läser fjärrfilerna när projektet öppnats: den nyaste versionen gäller (fjärr om den är nyare än din lokala kopia). */
async function qmfSyncLoad() {
  if (!qmfCanSync()) return; qmfSync.loading = true;
  try {
    const [pr, mr] = await Promise.all([ghReadJSON(settings.githubToken, QMF_PATH("posts")).catch(() => []), ghReadJSON(settings.githubToken, QMF_PATH("map")).catch(() => [])]);
    const rp = pr[0], rm = mr[0]; let localStamp = ""; try { localStamp = (JSON.parse(localStorage.getItem(QMF_MAP) || "{}").updated_at) || ""; } catch (e) { /* */ }
    let changed = false;
    if (rp && Array.isArray(rp.posts) && rp.posts.length && (!qmf.posts.length || String(rp.updated_at || "") > localStamp)) { qmf.posts = rp.posts; qmf.builds = rp.builds || []; qmf.file = rp.file || ""; try { localStorage.setItem(QMF_KEY, JSON.stringify({ posts: qmf.posts, builds: qmf.builds, file: qmf.file })); } catch (e) { /* */ } changed = true; }
    if (rm && rm.map && String(rm.updated_at || "") > localStamp) { qmf.map = { types: rm.map.types || {}, areas: rm.map.areas || {}, obj: rm.map.obj || {}, mvO: rm.map.mvO || {}, mvT: rm.map.mvT || {} }; qmf.groupId = rm.groupId !== false; qmf.typeKey = rm.typeKey || qmf.typeKey; qmf.build = rm.build || ""; qmf.stamp = rm.updated_at; qmfSaveLocalOnly(); changed = true; }
    qmfSync.loading = false;
    if (!rm && (Object.keys(qmf.map.obj || {}).length || Object.keys(qmf.map.types).length)) qmfSyncSoon("map");       // lokalt finns kopplingar som ännu inte delats
    if (!rp && qmf.posts.length) qmfSyncSoon("posts");
    if (changed) { qmfSyncState("✓ Hämtade delade kopplingar från 4D-data"); if (typeof qtyRender === "function") qtyRender(); } else if (rm || rp) qmfSyncState("✓ Delat i 4D-data");
  } catch (e) { console.warn("Mängdkopplingar kunde inte hämtas", e); } finally { qmfSync.loading = false; }
}
function qmfSaveLocalOnly() { try { localStorage.setItem(QMF_MAP, JSON.stringify({ types: qmf.map.types, areas: qmf.map.areas, obj: qmf.map.obj || {}, mvO: qmf.map.mvO || {}, mvT: qmf.map.mvT || {}, groupId: qmf.groupId, typeKey: qmf.typeKey, build: qmf.build, updated_at: qmf.stamp || "" })); } catch (e) { /* */ } }

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
const qmfRawName = o => String(o.flat[qmf.typeKey] === undefined ? "(saknas)" : o.flat[qmf.typeKey]);
/* Typ = namnet utan objektets eget ID (Revit: "Basic Wall:Concrete - 1000:1788329" → "Basic Wall:Concrete - 1000"), så att samma typ blir en rad. */
const qmfTypeVal = o => (qmf.groupId !== false ? qmfRawName(o).replace(/\s*[:#]\s*\d{3,}$/, "") : qmfRawName(o));
const qmfObjKey = o => `${o.modelId}|${o.objectId || o.rid}`;
/* Post för ett objekt i ett mängdslag: objektets egen koppling om den finns, annars typens. */
function qmfEffPost(o, k) { k = k || qtyKind(); const ov = (qmf.map.obj[k] || {})[qmfObjKey(o)]; if (ov !== undefined) return ov; return (qmf.map.types[k] || {})[qmfTypeVal(o)] || ""; }
/* Flyttad till ett annat mängdslag (posten har en annan enhet)? Objektets egen flytt går före typens. */
function qmfMovedOf(o) { const k = (qmf.map.mvO || {})[qmfObjKey(o)] || (qmf.map.mvT || {})[qmfTypeVal(o)]; return k && k !== qtyKind() && qmfEffPost(o, k) ? k : ""; }
/* Vilket mängdslag hanterar en post? Enheten avgör; m² delas mellan Form (posten nämner form) och Yta en sida. */
function qmfKindOfPost(p) { if (p.unit === "m²") return /form/i.test(`${p.ref} ${p.label}`) ? "form" : "area"; return (Object.entries(QTY_KINDS).find(([, v]) => v[1] === p.unit) || [])[0] || ""; }

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
/* Vilket annat mängdslag (om något) en typ är flyttad till – t.ex. en sandwichvägg som listas i m³ men posten är i m². */
/* Fråga med flera knappar; svarar med knappens nyckel ("" = avbryt). */
function qmfAsk(text, buttons) {
  return new Promise(res => {
    const w = document.createElement("div"); w.className = "qmf-ask";
    w.innerHTML = `<div class="qmf-ask-box"><div class="qmf-ask-t">${qtyEsc(text)}</div><div class="qmf-ask-b">${buttons.map(([k, t], i) => `<button type="button" data-k="${qtyEsc(k)}"${i === 0 ? ' class="primary"' : ""}>${qtyEsc(t)}</button>`).join("")}</div></div>`;
    (document.fullscreenElement || document.body).appendChild(w);
    const done = k => { w.remove(); document.removeEventListener("keydown", key, true); res(k); }, key = e => { if (e.key === "Escape") { e.stopPropagation(); done(""); } };
    w.addEventListener("click", e => { const b = e.target.closest("button[data-k]"); if (b) done(b.dataset.k); else if (e.target === w) done(""); }); document.addEventListener("keydown", key, true);
    const f = w.querySelector("button"); if (f) f.focus();
  });
}
/* Söklista (kombinationsruta) i stället för webbläsarens rullgardin: sök/filtrera och välj. groups: [{ label, items: [{ v, t, dis }] }] */
function qmfCombo(se, groups, onPick) {
  document.querySelectorAll(".qmf-combo").forEach(x => x.remove());
  const pop = document.createElement("div"); pop.className = "qmf-combo";
  pop.innerHTML = `<input type="search" class="qmf-combo-q" placeholder="Sök post…  (flera ord, t.ex. väggar betong)" autocomplete="off" /><div class="qmf-combo-list"></div>`;
  (document.fullscreenElement || document.body).appendChild(pop);
  const r = se.getBoundingClientRect(), W = Math.min(innerWidth - 16, Math.max(r.width, 560));
  pop.style.width = W + "px"; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - W - 8)) + "px";
  const list = pop.querySelector(".qmf-combo-list"), qi = pop.querySelector(".qmf-combo-q"), E = qtyEsc;
  let hi = 0;
  const words = () => qi.value.toLowerCase().split(/\s+/).filter(Boolean);
  const draw = () => {
    const w = words(); let n = 0, html = "";
    groups.forEach(g => { const it = g.items.filter(x => w.every(k => (x.t + " " + (g.label || "")).toLowerCase().includes(k))); if (!it.length) return; html += `<div class="qmf-combo-g">${E(g.label)}</div>` + it.map(x => `<div class="qmf-combo-i${x.dis ? " dis" : ""}${x.cur ? " cur" : ""}" data-i="${E(String(x.id))}">${E(x.t)}</div>`).join(""); n += it.length; });
    list.innerHTML = html || `<div class="qmf-combo-g">Inga poster matchar</div>`;
    const els = [...list.querySelectorAll(".qmf-combo-i:not(.dis)")]; hi = Math.min(hi, Math.max(0, els.length - 1)); if (els[hi]) els[hi].classList.add("hi");
  };
  const all = groups.flatMap(g => g.items), byId = new Map(all.map(x => [String(x.id), x]));
  const close = () => { pop.remove(); document.removeEventListener("pointerdown", out, true); };
  const out = e => { if (!pop.contains(e.target) && e.target !== se) close(); };
  const pick = id => { const it = byId.get(String(id)); if (!it || it.dis) return; close(); onPick(it); };
  qi.addEventListener("input", () => { hi = 0; draw(); });
  qi.addEventListener("keydown", e => {
    e.stopPropagation(); const els = [...list.querySelectorAll(".qmf-combo-i:not(.dis)")];
    if (e.key === "Escape") close(); else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (els[hi]) els[hi].classList.remove("hi"); hi = Math.max(0, Math.min(els.length - 1, hi + (e.key === "ArrowDown" ? 1 : -1))); if (els[hi]) { els[hi].classList.add("hi"); els[hi].scrollIntoView({ block: "nearest" }); } }
    else if (e.key === "Enter") { e.preventDefault(); if (els[hi]) pick(els[hi].dataset.i); }
  });
  list.addEventListener("click", e => { const x = e.target.closest(".qmf-combo-i"); if (x) pick(x.dataset.i); });
  const below = innerHeight - r.bottom, up = r.top > below + 120; list.style.maxHeight = Math.max(160, Math.min(380, (up ? r.top : below) - 70)) + "px";
  pop.style.top = up ? "" : r.bottom + 4 + "px"; pop.style.bottom = up ? innerHeight - r.top + 4 + "px" : "";
  draw(); setTimeout(() => { document.addEventListener("pointerdown", out, true); qi.focus(); const c = list.querySelector(".cur"); if (c) c.scrollIntoView({ block: "center" }); }, 0);
}
/* ---- Jämförelsen ------------------------------------------------------------------------------------ */
function qmfCompare() {
  const sel = qmf.build, rows = new Map(), all = typeof qty !== "undefined" ? qty.objs : [], f = qty.factor || 1;
  const sumB = (o, b) => (b ? o[b] || 0 : Object.values(o).reduce((s, v) => s + v, 0));
  qmfPosts().forEach(p => rows.set(p.key, { p, k: sumB(p.k, sel), pr: sumB(p.p, sel), klar: 0, tot: 0, n: 0, objs: [] }));
  let unmapped = 0, unmappedVol = 0, otherBuild = 0, movedOther = 0;
  all.forEach(o => {
    const v = qtyValue(o); if (v === null) return;
    if (!qtyPass(o)) return;
    const post = qmfEffPost(o), r = post && rows.get(post);
    if (!r) { if (!post && qmfMovedOf(o)) { movedOther++; return; } unmapped++; unmappedVol += v; return; }
    const b = qmf.map.areas[qmfAreaOf(o)] || "";
    if (sel && b !== sel) { otherBuild++; return; }
    r.tot += v; r.n++; r.objs.push(o); if (qtyDone(o)) r.klar += v;
  });
  const list = [...rows.values()].filter(r => r.k || r.pr || r.tot);
  return { list, unmapped, unmappedVol, otherBuild, movedOther };
}
const qmfPct = (a, b) => (b ? Math.round(a / b * 100) : null);
function qmfCsv(C) {
  const d = v => String(Math.round(v * 100) / 100).replace(".", ",");
  const lines = [["Post", "Beskrivning", "Enhet", "Kontrakt", "Prognos", "Modell klar", "Modell totalt", "Klart av prognos %", "Kvar (prognos − klar)"], ...C.list.map(r => [r.p.ref, r.p.label, r.p.unit, d(r.k), d(r.pr), d(r.klar), d(r.tot), qmfPct(r.klar, r.pr) ?? "", d(r.pr - r.klar)])];
  return "﻿" + lines.map(l => l.map(x => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\r\n");
}
/* Postlistans grupper (poster i nuvarande mängdslags enhet först, sedan övriga enheter under egna rubriker). */
function qmfPostGroups(selKey) {
  const cur = qtyKind(), curU = QTY_KINDS[cur][1], kname = k => QTY_KINDS[k][0];
  const g = [{ label: `Poster i ${curU} – gäller mängdslaget ${kname(cur)}`, items: [{ id: "", v: "", t: "(ingen post)", cur: !selKey }, ...qmf.posts.filter(p => p.unit === curU).map(p => ({ id: p.key, v: p.key, t: `${p.ref} – ${p.label} [${p.unit}]`, post: p, cur: p.key === selKey }))] }];
  const other = qmf.posts.filter(p => p.unit !== curU), kinds = [...new Set(other.map(p => qmfKindOfPost(p)))].sort();
  kinds.forEach(k => { const ps = other.filter(p => qmfKindOfPost(p) === k), u = ps[0].unit;
    g.push({ label: k ? `Poster i ${u} – väljer du en av dem läggs objekten till i mängdslaget ${kname(k)} (de finns kvar i ${kname(cur)})` : `Poster i ${u} – inget mängdslag för den enheten`, items: ps.map(p => ({ id: p.key, v: p.key, t: `${p.ref} – ${p.label} [${p.unit}]`, post: p, dis: !k })) }); });
  return g;
}
/* Lägg alla objekt som är markerade i TC på en post på en gång (t.ex. 2 000 objekt). */
async function qmfAssignSelection(anchor) {
  const V = API && API.viewer; if (!V || typeof V.getSelection !== "function") { modelToast("Kräver Trimble Connect-vyn"); return; }
  if (!qty.objs.length) { modelToast("Tryck på Läs mängder först"); return; }
  const sel = await V.getSelection(), want = new Set(); let total = 0;
  (sel || []).forEach(x => (x.objectRuntimeIds || []).forEach(r => { want.add(`${x.modelId}|${r}`); total++; }));
  if (!total) { modelToast("Inget är markerat i TC – markera objekten i modellen först"); return; }
  const objs = qty.objs.filter(o => want.has(`${o.modelId}|${o.rid}`)), miss = total - objs.length;
  if (!objs.length) { modelToast(`Inga av de ${total} markerade finns i det inlästa urvalet (kolla Urval och Läs mängder igen)`); return; }
  qmfCombo(anchor, qmfPostGroups(""), async it => {
    if (!it.post && it.v) return;
    const cur = qtyKind(), k = it.post ? qmfKindOfPost(it.post) : cur, what = it.post ? `${it.post.ref} – ${it.post.label.slice(0, 80)}` : "(ingen post)";
    const ok = await qmfAsk(`Lägga ${objs.length} markerade objekt på "${what}" i mängdslaget ${QTY_KINDS[k][0]}?${miss ? ` (${miss} markerade ingår inte i det inlästa urvalet och hoppas över.)` : ""}`, [["ja", "Ja, lägg dem där"], ["", "Avbryt"]]);
    if (!ok) return;
    const m = (qmf.map.obj[k] = qmf.map.obj[k] || {}); objs.forEach(o => { m[qmfObjKey(o)] = it.v; });
    qmfSave(); qmfRender(); modelToast(`${objs.length} objekt lades på ${it.post ? it.post.ref : "ingen post"} (${QTY_KINDS[k][0]})`);
  });
}
/* Poster ett objekt hör till (per mängdslag) – används även i Gantt-schemats aktivitetsdialog. */
function qmfMemberPosts(m) {
  if (!m || !m.modelId || !m.objectId || !qmf.posts.length) return [];
  const ok = `${m.modelId}|${m.objectId}`, out = [];
  if (qmfMemberPosts._src !== qty.objs) { qmfMemberPosts._src = qty.objs; qmfMemberPosts._idx = new Map(qty.objs.map(o => [qmfObjKey(o), o])); }
  const o = qmfMemberPosts._idx.get(ok);
  Object.keys(QTY_KINDS).forEach(k => { const ov = (qmf.map.obj[k] || {})[ok]; const key = ov !== undefined ? ov : (o ? qmfEffPost(o, k) : ""); const p = key && qmf.posts.find(x => x.key === key); if (p) out.push({ kind: k, post: p }); });
  return out;
}
function qmfRender() {
  const host = document.getElementById("qmfBox"); if (!host) return;
  const E = qtyEsc, hasObjs = typeof qty !== "undefined" && qty.objs.length > 0, hasMf = qmf.posts.length > 0;
  let html = `<h3 class="qmf-h">Jämför mot mängdförteckningen <span class="hint">· mängdslag: ${E(QTY_KINDS[qtyKind()][0])} (byts ovan)</span></h3><div class="qty-row"><label>Mängdförteckning (.xlsx) <input type="file" id="qmfFile" accept=".xlsx" /></label>${hasMf ? `<span class="hint">✓ ${E(qmf.file)} · ${qmf.posts.length} poster · ${qmf.builds.length} byggnader</span><button type="button" id="qmfClear">Ta bort</button>` : ""}<span class="hint" id="qmfMsg">${E(qmf.msg)}</span><span class="hint qmf-sync" id="qmfSyncState">${E(qmfSync.state)}</span></div>`;
  if (!hasMf || !hasObjs) { host.innerHTML = html + `<div class="hint">${!hasMf ? "Välj mängdförteckningen (Excel). Filen läses bara i din webbläsare och ändras inte." : "Tryck på Läs mängder ovan först."}</div>`; wire(); return; }
  const types = new Map(), areas = new Map();
  qty.objs.forEach(o => { const t = qmfTypeVal(o), a = qmfAreaOf(o), v = qtyValue(o) ?? 0;
    const te = types.get(t) || { n: 0, v: 0, objs: [] }; te.n++; te.v += v; te.objs.push(o); types.set(t, te); const ae = areas.get(a) || { n: 0, v: 0, objs: [] }; ae.n++; ae.v += v; ae.objs.push(o); areas.set(a, ae); });
  const postLabel = k => { const p = qmf.posts.find(x => x.key === k); return p ? `${p.ref} – ${p.label.slice(0, 100)} [${p.unit}]` : ""; };
  const objPostText = o => { const k = qmfEffPost(o), ex = Object.keys(QTY_KINDS).filter(x => x !== qtyKind() && qmfEffPost(o, x)).map(x => { const p = qmf.posts.find(y => y.key === qmfEffPost(o, x)); return `${QTY_KINDS[x][1]}: ${p ? p.ref : "?"}`; }); return (k ? postLabel(k) : "(ingen post)") + (ex.length ? `  ·  även ${ex.join(", ")}` : ""); };
  const grpRows = ([t, e]) => {
    const texts = [...new Set(e.objs.map(objPostText))], shown = texts.length === 1 ? texts[0] : `Blandat (${texts.length} olika)`, open = qmf.open.has(t);
    let h = `<tr class="qmf-click qmf-grp" data-tyrow="${E(t)}" data-ptxt="${E(texts.join(" | ").toLowerCase())}" title="Klicka för att markera de ${e.n} objekten i TC"><td><button type="button" class="qmf-tog" data-tog="${E(t)}" title="${open ? "Dölj" : "Visa"} objekten i typen – välj post per objekt">${open ? "▾" : "▸"}</button> ${E(t)}</td><td class="num">${e.n}</td><td class="num">${qtyFmt(e.v)}</td><td><select data-ty="${E(t)}"><option>${E(shown)}</option></select></td></tr>`;
    if (open) { const ob = [...e.objs].sort((a, b) => (qtyValue(b) || 0) - (qtyValue(a) || 0)); h += ob.slice(0, 300).map(o => `<tr class="qmf-click qmf-obj" data-og="${E(t)}" data-ok="${E(qmfObjKey(o))}" title="Klicka för att markera objektet i TC"><td class="qmf-objn">${E(qmfRawName(o))}</td><td class="num">1</td><td class="num">${qtyFmt(qtyValue(o) ?? 0)}</td><td><select data-ob="${E(qmfObjKey(o))}" data-og="${E(t)}"><option>${E(objPostText(o))}</option></select></td></tr>`).join("") + (ob.length > 300 ? `<tr class="qmf-obj"><td colspan="4" class="hint">… ${ob.length - 300} objekt till – dra ner antalet med sök eller välj post för hela typen.</td></tr>` : ""); }
    return h;
  };
  const bOpts = sel => `<option value="">(ingen byggnad)</option>${qmf.builds.map(b => `<option value="${E(b)}"${sel === b ? " selected" : ""}>${E(b)}</option>`).join("")}`;
  const C = qmfCompare(), u = QTY_KINDS[qtyKind()][1];
  html += `<details class="qmf-map" open><summary>1. Vilken post är objekten? <span class="hint">(per ${E(qmf.typeKey || "egenskap")})</span></summary>
      <label class="qty-row">Typ-egenskap <select id="qmfTypeKey">${[...qty.keys.keys()].map(k => `<option value="${E(k)}"${qmf.typeKey === k ? " selected" : ""}>${E(k)}</option>`).join("")}</select></label><label class="qmf-chk qty-row" title="Revit-namn slutar ofta på objektets eget ID (…:1788329). Då blir varje objekt en egen typ. Med den här kryssrutan grupperas objekten per typ, och du kan ändå välja post per objekt (▸)."><input type="checkbox" id="qmfGroupId"${qmf.groupId !== false ? " checked" : ""} /> Gruppera bort objektets ID i namnet</label>
      <div class="qty-row"><button type="button" id="qmfSelAssign" class="gantt-toolbar-btn" title="Markera objekten i modellen i Trimble Connect först – lägg sedan alla markerade på en post på en gång">Lägg markerade i TC på post…</button></div>
      <div class="hint">Klicka på ▸ för att se objekten i en typ och välja post för ett enskilt objekt. Ändrar du ett enskilt objekt får du frågan om det ska gälla bara det eller alla i typen.</div>
      <div class="hint qmf-flt-n"></div><table class="qty-table"><thead><tr><th>Typ i modellen<input type="search" class="qmf-flt" data-flt="ty" placeholder="Sök typ…" value="${E(qmf.f.ty)}" /></th><th class="num">Objekt</th><th class="num">${u}</th><th>Post i förteckningen<input type="search" class="qmf-flt" data-flt="po" placeholder="Sök post… (eller ”ingen”)" value="${E(qmf.f.po)}" /></th></tr></thead><tbody>${[...types].sort((a, b) => b[1].v - a[1].v).map(grpRows).join("")}</tbody></table></details>
    <details class="qmf-map" open><summary>2. Vilken byggnad hör området till? <span class="hint">(Områdena i Gantt-schemat)</span></summary>
      <div class="hint qmf-flt-n"></div><table class="qty-table"><thead><tr><th>Område i Gantt<input type="search" class="qmf-flt" data-flt="ar" placeholder="Sök område…" value="${E(qmf.f.ar)}" /></th><th class="num">Objekt</th><th class="num">${u}</th><th>Byggnad i förteckningen<input type="search" class="qmf-flt" data-flt="by" placeholder="Sök byggnad… (eller ”ingen”)" value="${E(qmf.f.by)}" /></th></tr></thead><tbody>${[...areas].sort((a, b) => a[0].localeCompare(b[0], "sv", { numeric: true })).map(([a, e]) => `<tr class="qmf-click" data-arrow="${E(a)}" title="Klicka för att markera de ${e.n} objekten i TC"><td>${E(a)}</td><td class="num">${e.n}</td><td class="num">${qtyFmt(e.v)}</td><td><select data-ar="${E(a)}">${bOpts(qmf.map.areas[a])}</select></td></tr>`).join("")}</tbody></table></details>
    <div class="qty-row"><label>Byggnad <select id="qmfBuild"><option value="">Alla byggnader</option>${qmf.builds.map(b => `<option value="${E(b)}"${qmf.build === b ? " selected" : ""}>${E(b)}</option>`).join("")}</select></label><span class="hint">Klara vid ${E(qtyAt())} enligt Ganttens regel</span></div>
    <table class="qty-table qmf-table"><thead><tr><th>Post</th><th class="num">Kontrakt</th><th class="num">Prognos</th><th class="num">Modell klar</th><th class="num">Modell totalt</th><th class="num">Klart av prognos</th><th class="num">Kvar</th></tr></thead><tbody>${C.list.map(r => { const pc = qmfPct(r.klar, r.pr), dv = qmfPct(r.tot - r.pr, r.pr); return `<tr class="qmf-click" data-postrow="${E(r.p.key)}" title="${E(r.p.label)} – klicka för att markera de ${r.n} objekten i TC"><td><b>${E(r.p.ref)}</b> ${E(r.p.label.slice(0, 60))}</td><td class="num">${qtyFmt(r.k, 0)}</td><td class="num">${qtyFmt(r.pr, 0)}</td><td class="num"><b>${qtyFmt(r.klar)}</b></td><td class="num${dv !== null && Math.abs(dv) > 15 ? " qmf-bad" : dv !== null && Math.abs(dv) > 5 ? " qmf-warn" : ""}" title="Modell totalt mot prognos: ${dv === null ? "–" : (dv > 0 ? "+" : "") + dv + " %"}">${qtyFmt(r.tot)}</td><td class="num">${pc === null ? "–" : pc + " %"}</td><td class="num">${qtyFmt(r.pr - r.klar, 0)}</td></tr>`; }).join("") || `<tr><td colspan="7" class="hint">Inga poster med mängd för valet.</td></tr>`}</tbody></table>
    <div class="hint">${C.unmapped ? `${C.unmapped} objekt (${qtyFmt(C.unmappedVol)} ${u}) har ingen post vald och räknas inte med. ` : ""}${C.otherBuild ? `${C.otherBuild} objekt hör till andra byggnader. ` : ""}${C.movedOther ? `${C.movedOther} objekt är flyttade till ett annat mängdslag (posten har en annan enhet) – byt mängdslag ovan för att se dem. ` : ""}"Modell totalt" är objekten som är kopplade i planen – inte hela modellen. Orange/röd = modell totalt avviker mer än 5 / 15 % från prognosen.</div>
    <div class="qty-row"><button type="button" id="qmfCsv">Exportera jämförelsen (CSV)</button></div>`;
  host.innerHTML = html; wire();
  function wire() {
    const q = s => host.querySelector(s);
    const fi = q("#qmfFile"); if (fi) fi.onchange = () => { if (fi.files && fi.files[0]) qmfLoadFile(fi.files[0]); };
    const cl = q("#qmfClear"); if (cl) cl.onclick = () => { qmf.posts = []; qmf.builds = []; qmf.file = ""; qmf.msg = ""; try { localStorage.removeItem(QMF_KEY); } catch (e) { /* */ } qmfRender(); };
    if (!hasMf || !hasObjs) return;
    if (q("#qmfGroupId")) q("#qmfGroupId").onchange = e => { qmf.groupId = e.target.checked; qmf.open.clear(); qmfSave(); qmfAutoMap(); qmfRender(); };
    if (q("#qmfSelAssign")) q("#qmfSelAssign").onclick = e => qmfAssignSelection(e.currentTarget);
    q("#qmfTypeKey").onchange = e => { qmf.typeKey = e.target.value; qmfSave(); qmfAutoMap(); qmfRender(); };
    // Sök/filtrera raderna (utan omritning): alla ord ska finnas; för Post/Byggnad söks i den valda postens text.
    const applyFlt = () => {
      const words = v => String(v || "").toLowerCase().split(/\s+/).filter(Boolean), ok = (txt, w) => w.every(x => txt.includes(x));
      [["tr[data-tyrow]", "ty", "po"], ["tr[data-arrow]", "ar", "by"]].forEach(([sel, k1, k2]) => {
        const w1 = words(qmf.f[k1]), w2 = words(qmf.f[k2]); let shown = 0, all = 0;
        host.querySelectorAll(sel).forEach(tr => {
          const t1 = (tr.dataset.tyrow || tr.dataset.arrow || "").toLowerCase(), se = tr.querySelector("select"), t2 = tr.dataset.ptxt !== undefined ? tr.dataset.ptxt : (se ? (se.options[se.selectedIndex] ? se.options[se.selectedIndex].text : "").toLowerCase() : "");
          const show = ok(t1, w1) && ok(t2, w2); tr.style.display = show ? "" : "none"; all++; if (show) shown++;
        });
        host.querySelectorAll("tr.qmf-obj").forEach(r => { const g = r.dataset.og ? host.querySelector(`tr[data-tyrow="${CSS.escape(r.dataset.og)}"]`) : null; r.style.display = g && g.style.display === "none" ? "none" : ""; });
        const th = host.querySelector(`[data-flt="${k1}"]`); if (th) { const tb = th.closest("table"); if (tb) tb.classList.toggle("qmf-filtered", w1.length > 0 || w2.length > 0); const c = tb && tb.parentElement.querySelector(".qmf-flt-n"); if (c) c.textContent = w1.length || w2.length ? `${shown} av ${all} rader visas` : ""; }
      });
    };
    host.querySelectorAll("input.qmf-flt").forEach(i => { i.addEventListener("input", () => { qmf.f[i.dataset.flt] = i.value; applyFlt(); }); i.addEventListener("click", e => e.stopPropagation()); i.addEventListener("keydown", e => e.stopPropagation()); });
    host.querySelectorAll("select[data-ty], select[data-ar]").forEach(se => se.addEventListener("change", () => setTimeout(applyFlt, 0)));
    applyFlt();
    // Klick på en rad markerar de objekt som raden räknats på i TC.
    const pick = (list, label) => { if (!list || !list.length) { if (typeof modelToast === "function") modelToast("Inga objekt på den raden"); return; } qtySelectRows(list); if (typeof modelToast === "function") modelToast(`${list.length} objekt markerade i TC${label ? " – " + label : ""}`); };
    host.querySelectorAll("tr[data-tyrow]").forEach(tr => tr.addEventListener("click", e => { if (e.target.closest("select, button")) return; const t = types.get(tr.dataset.tyrow); pick(t && t.objs, tr.dataset.tyrow.split(":")[0]); }));
    const byKey = new Map(qty.objs.map(o => [qmfObjKey(o), o]));
    host.querySelectorAll("tr.qmf-obj[data-ok]").forEach(tr => tr.addEventListener("click", e => { if (e.target.closest("select")) return; const o = byKey.get(tr.dataset.ok); pick(o ? [o] : [], "objekt"); }));
    host.querySelectorAll("[data-tog]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); const y = scrollY; qmf.open.has(b.dataset.tog) ? qmf.open.delete(b.dataset.tog) : qmf.open.add(b.dataset.tog); qmfRender(); scrollTo(0, y); }));
    host.querySelectorAll("tr[data-arrow]").forEach(tr => tr.addEventListener("click", e => { if (e.target.closest("select")) return; const a = areas.get(tr.dataset.arrow); pick(a && a.objs, tr.dataset.arrow); }));
    host.querySelectorAll("tr[data-postrow]").forEach(tr => tr.addEventListener("click", () => { const r = C.list.find(x => x.p.key === tr.dataset.postrow); pick(r && r.objs, r && r.p.ref); }));
    const cur = qtyKind(), curU = QTY_KINDS[cur][1], kname = k => QTY_KINDS[k][0];
    const postGroups = (t, selKey) => qmfPostGroups(selKey);
    /* Välj post: för en hel typ, eller för ett enskilt objekt (då frågar vi om det ska gälla alla i typen). */
    const unitKind = it => (it.post ? qmfKindOfPost(it.post) : cur);
    const delOv = (objs, kinds) => objs.forEach(o => { const ok = qmfObjKey(o); kinds.forEach(k => { if (qmf.map.obj[k]) delete qmf.map.obj[k][ok]; }); });
    /* Mängdslagen lever sina egna liv: en form-post (m²) ligger "ovanpå" objektet, som fortfarande har sin volym (m³) att mängda. Väljer du en post i en annan
       enhet läggs objektet därför TILL i det mängdslaget – det finns kvar i det nuvarande tills du väljer "(ingen post)" där. */
    const applyGroup = (t, objs, it) => {
      const k = unitKind(it);
      if (!it.post || k === cur) { qmfTypes()[t] = it.v; delOv(objs, [cur]); }
      else { qmf.map.types[k] = qmf.map.types[k] || {}; qmf.map.types[k][t] = it.v; delOv(objs, [k]); if (typeof modelToast === "function") modelToast(`Alla ${objs.length} objekt i typen lades till i mängdslaget ${kname(k)} (post ${it.post.ref}). De finns kvar i ${kname(cur)} – välj "(ingen post)" där om de inte ska mängdas som ${QTY_KINDS[cur][1]}.`); }
    };
    const applyObj = (o, it) => {
      const k = unitKind(it), ok = qmfObjKey(o);
      if (!it.post || k === cur) (qmf.map.obj[cur] = qmf.map.obj[cur] || {})[ok] = it.v;
      else { (qmf.map.obj[k] = qmf.map.obj[k] || {})[ok] = it.v; if (typeof modelToast === "function") modelToast(`Objektet lades till i mängdslaget ${kname(k)} (post ${it.post.ref}). Det finns kvar i ${kname(cur)} – välj "(ingen post)" där om det inte ska mängdas som ${QTY_KINDS[cur][1]}.`); }
    };
    host.querySelectorAll("select[data-ty]").forEach(se => se.addEventListener("mousedown", e => {
      e.preventDefault(); const t = se.dataset.ty, objs = (types.get(t) || {}).objs || [], eff = [...new Set(objs.map(o => qmfEffPost(o)))];
      qmfCombo(se, postGroups(t, eff.length === 1 ? eff[0] : "__mixed"), it => { applyGroup(t, objs, it); qmfSave(); qmfRender(); });
    }));
    host.querySelectorAll("select[data-ob]").forEach(se => se.addEventListener("mousedown", e => {
      e.preventDefault(); const o = byKey.get(se.dataset.ob), t = se.dataset.og, objs = (types.get(t) || {}).objs || []; if (!o) return;
      qmfCombo(se, postGroups(t, qmfEffPost(o)), async it => {
        let scope = "obj";
        if (objs.length > 1) { scope = await qmfAsk(`Gäller valet bara det här objektet, eller alla ${objs.length} objekt av typen "${t}"?`, [["obj", "Bara det här objektet"], ["all", `Alla ${objs.length} i typen`], ["", "Avbryt"]]); if (!scope) return; }
        if (scope === "all") applyGroup(t, objs, it); else applyObj(o, it);
        qmfSave(); qmfRender();
      });
    }));
    host.querySelectorAll("select[data-ar]").forEach(se => se.addEventListener("mousedown", e => {
      e.preventDefault(); const a = se.dataset.ar, selB = qmf.map.areas[a] || "";
      qmfCombo(se, [{ label: "Byggnader i förteckningen", items: [{ id: "", v: "", t: "(ingen byggnad)", cur: !selB }, ...qmf.builds.map(b => ({ id: b, v: b, t: b, cur: b === selB }))] }], it => { qmf.map.areas[a] = it.v; qmfSave(); qmfRender(); });
    }));
    q("#qmfBuild").onchange = e => { qmf.build = e.target.value; qmfSave(); qmfRender(); };
    q("#qmfCsv").onclick = () => { const b = new Blob([qmfCsv(qmfCompare())], { type: "text/csv;charset=utf-8" }), url = URL.createObjectURL(b), a = document.createElement("a"); a.href = url; a.download = `Mängdjämförelse ${qmf.build || "alla byggnader"} ${todayISO()}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };
  }
}
/* När mängderna lästs: föreslå kopplingar. */
const qtyRead0 = typeof qtyRead === "function" ? qtyRead : null;
if (qtyRead0) qtyRead = async function () { await qtyRead0(); try { if (qmf.posts.length) qmfAutoMap(); } catch (e) { console.warn(e); } qtyRender(); };
