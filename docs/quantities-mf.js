/* Mängdavtagning – data och Excel (Victor 2026-10-14, omgjord 2026-10-19). Läser mängdförteckningen (Excel, .xlsx) direkt i webbläsaren (inget bibliotek – en .xlsx är en
   zip med XML): koder (Ref), specifikation, enhet, byggnadskolumner med kontrakt och prognos, samt rubriker och radordning som i Excel. Kopplingen modell → kod sparas som
     typ → kod (t.ex. "Basic Wall:Concrete - 700" → ESE.21) och objekt → kod (undantag för enskilda objekt), per mängdslag, samt område i Gantt → byggnad.
   Förslag fylls i automatiskt men kan ändras. Förteckningen ändras aldrig. Gränssnittet (matris, koppla, inställningar) ligger i quantities-ui.js. */

const QMF_KEY = "4ddash-qty-mf", QMF_MAP = "4ddash-qty-map";
const QMF_CUSTOM = "4ddash-qty-custom";
const qmf = { posts: [], custom: [], builds: [], layout: [], file: "", typeKey: "", map: { types: {}, areas: {}, obj: {}, mvO: {}, mvT: {} }, groupId: true, msg: "" };
try { const s = JSON.parse(localStorage.getItem(QMF_KEY) || "null"); if (s && Array.isArray(s.posts)) { qmf.posts = s.posts; qmf.builds = s.builds || []; qmf.file = s.file || ""; qmf.layout = s.layout || []; } } catch (e) { /* ingen sparad */ }
try { const m = JSON.parse(localStorage.getItem(QMF_MAP) || "null"); if (m) { let ty = m.types || {}; if (Object.values(ty).some(v => typeof v === "string")) ty = { vol: ty }; /* äldre sparning: bara volym */ qmf.map = { types: ty, areas: m.areas || {}, obj: m.obj || {}, mvO: m.mvO || {}, mvT: m.mvT || {} }; qmf.groupId = m.groupId !== false; qmf.typeKey = m.typeKey || ""; qmf.build = m.build || ""; qmf.stamp = m.updated_at || ""; } } catch (e) { /* standard */ }
try { const c = JSON.parse(localStorage.getItem(QMF_CUSTOM) || "null"); if (Array.isArray(c)) qmf.custom = c; } catch (e) { /* inga egna poster */ }
/* Egna poster (Victor 2026-10-19: "skapa egna kategorier i mängdavtagningen om jag saknar en kod"): koder som inte finns i förteckningen.
   De ligger skilda från den inlästa förteckningen (en ny Excel-fil ersätter inte dem), delas i 4D-data (qty_custom_posts.json) och
   fungerar överallt som vanliga poster – i listorna, kopplingarna, jämförelsen och Gantt-dialogen. Förteckningens mängder saknas (–). */
const qmfAllPosts = () => qmf.posts.concat(qmf.custom);
const qmfSaveCustom = () => { try { localStorage.setItem(QMF_CUSTOM, JSON.stringify(qmf.custom)); } catch (e) { /* ingen lagring */ } qmfSyncSoon("custom"); };
const qmfSave = () => { try { localStorage.setItem(QMF_MAP, JSON.stringify({ types: qmf.map.types, areas: qmf.map.areas, obj: qmf.map.obj || {}, mvO: qmf.map.mvO || {}, mvT: qmf.map.mvT || {}, groupId: qmf.groupId, typeKey: qmf.typeKey, build: qmf.build, updated_at: qmf.stamp || "" })); } catch (e) { /* ingen lagring */ } qmfSyncSoon("map"); };
const qmfSavePosts = () => { try { localStorage.setItem(QMF_KEY, JSON.stringify({ posts: qmf.posts, builds: qmf.builds, file: qmf.file, layout: qmf.layout || [] })); } catch (e) { qmf.msg = "Förteckningen är för stor för att sparas i webbläsaren – den gäller bara tills sidan laddas om."; } qmfSyncSoon("posts"); };

/* ---- Delning via 4D-data (Victor 2026-10-15: "varför skulle vi inte spara det?") ----------------------------------------------
   Kopplingarna (typ/objekt → post, område → byggnad) och mängdförteckningens poster sparas i projektets mapp i det privata datarepot
   (projects/<projekt>/qty_mapping.json och qty_posts.json), så att alla som öppnar projektet ser samma kopplingar. Webbläsaren behåller en lokal kopia.
   Skrivs efter en kort paus; vid skrivning slås fjärrfilens kopplingar ihop med dina (dina ändringar går före). */
const QMF_PATH = k => `projects/${encodeURIComponent(typeof projectId !== "undefined" ? projectId : "_")}/${k === "posts" ? "qty_posts" : k === "custom" ? "qty_custom_posts" : "qty_mapping"}.json`;
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
    if (kind === "custom") {
      await ghWriteJSON(settings.githubToken, QMF_PATH("custom"), arr => { const m = new Map((Array.isArray(arr) ? arr : []).map(x => [x.key, x])); qmf.custom.forEach(x => m.set(x.key, x)); (qmf.customGone || []).forEach(k => m.delete(k)); return [...m.values()]; }, "Egna poster i mängdavtagningen");
      qmf.customGone = [];
    } else if (kind === "posts") {
      const payload = { updated_at: qmf.stamp || new Date().toISOString(), posts: qmf.posts, builds: qmf.builds, file: qmf.file, layout: qmf.layout || [] };
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
    try { const cr = await ghReadJSON(settings.githubToken, QMF_PATH("custom")); if (Array.isArray(cr) && cr.length) { const m = new Map(cr.map(x => [x.key, x])); qmf.custom.forEach(x => m.set(x.key, x)); const before = qmf.custom.length; qmf.custom = [...m.values()]; try { localStorage.setItem(QMF_CUSTOM, JSON.stringify(qmf.custom)); } catch (e) { /* */ } if (qmf.custom.length !== before && typeof qtyRender === "function") setTimeout(qtyRender, 0); } else if (qmf.custom.length) qmfSyncSoon("custom"); } catch (e) { /* ingen delad fil */ }
    const [pr, mr] = await Promise.all([ghReadJSON(settings.githubToken, QMF_PATH("posts")).catch(() => []), ghReadJSON(settings.githubToken, QMF_PATH("map")).catch(() => [])]);
    const rp = pr[0], rm = mr[0]; let localStamp = ""; try { localStamp = (JSON.parse(localStorage.getItem(QMF_MAP) || "{}").updated_at) || ""; } catch (e) { /* */ }
    let changed = false;
    if (rp && Array.isArray(rp.posts) && rp.posts.length && (!qmf.posts.length || String(rp.updated_at || "") > localStamp)) { qmf.posts = rp.posts; qmf.builds = rp.builds || []; qmf.file = rp.file || ""; qmf.layout = rp.layout || qmf.layout || []; try { localStorage.setItem(QMF_KEY, JSON.stringify({ posts: qmf.posts, builds: qmf.builds, file: qmf.file, layout: qmf.layout })); } catch (e) { /* */ } changed = true; }
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
  const posts = new Map(), builds = new Set(), layout = [], seenP = new Set(), num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
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
      // Radordning och rubriker som i Excel (Victor 2026-10-19): rader utan mängder sparas som rubrik/textrad med indrag.
      const first = r.slice(1, cU).findIndex(x => x !== null && x !== undefined && String(x).trim() !== ""), lvl = ref ? 0 : first < 0 ? 1 : 1 + first;
      if (!unit || unit === "-" || unit === "Enhet") { if (ref || text) layout.push({ h: 1, ref, text, lvl }); continue; }
      const k = {}, pr = {}; let any = false;
      kc.forEach(([ci, b]) => { const v = num(r[ci]); if (v !== null) { k[b] = v; any = true; } });
      pc.forEach(([ci, b]) => { const v = num(r[ci]); if (v !== null) { pr[b] = v; any = true; } });
      const label = ref ? text : (lastText ? `${lastText} › ${text}` : text), key = `${lastRef}|${label}|${unit}`;
      if (!any) { if (ref || text) layout.push({ h: 1, ref, text, lvl }); continue; }
      const post = posts.get(key) || { key, ref: lastRef, label, unit, k: {}, p: {} };
      Object.entries(k).forEach(([b, v]) => { post.k[b] = (post.k[b] || 0) + v; }); Object.entries(pr).forEach(([b, v]) => { post.p[b] = (post.p[b] || 0) + v; });
      posts.set(key, post);
      if (!seenP.has(key)) { seenP.add(key); layout.push({ p: key, lvl }); }
    }
  });
  return { posts: [...posts.values()], builds: [...builds], layout };
}
async function qmfLoadFile(file) {
  try {
    const sheets = await qmfReadXlsx(await file.arrayBuffer()), r = qmfParse(sheets);
    if (!r.posts.length) { qmf.msg = "Hittade inga poster i filen (letar efter en rad med 'Ref' och 'Enhet')."; qtyRender(); return; }
    qmf.posts = r.posts; qmf.builds = r.builds; qmf.layout = r.layout; qmf.file = file.name; qmf.msg = `${r.posts.length} poster och ${r.builds.length} byggnader inlästa.`; qmfSavePosts(); qmfAutoMap(); qtyRender();
  } catch (e) { console.warn("Mängdförteckning", e); qmf.msg = "Kunde inte läsa filen: " + ((e && e.message) || e); qtyRender(); }
}

/* ---- Kopplingarna ----------------------------------------------------------------------------------- */
/* Koder i ett mängdslag (kodens enhet avgör mängdslaget). */
const qmfPosts = kind => qmfAllPosts().filter(p => qmfKindOfPost(p) === kind);
const qmfTypes = kind => (qmf.map.types[kind] = qmf.map.types[kind] || {});

const qmfStem = s => String(s || "").toLowerCase().replace(/[^a-zåäö0-9 ]/g, "").replace(/(huset|hus|et|en|n|t)$/i, "").trim();
const qmfRawName = o => String(o.flat[qmf.typeKey] === undefined ? "(saknas)" : o.flat[qmf.typeKey]);
/* Typ = namnet utan objektets eget ID (Revit: "Basic Wall:Concrete - 1000:1788329" → "Basic Wall:Concrete - 1000"), så att samma typ blir en rad. */
const qmfTypeVal = o => (qmf.groupId !== false ? qmfRawName(o).replace(/\s*[:#]\s*\d{3,}$/, "") : qmfRawName(o));
const qmfObjKey = o => `${o.modelId}|${o.objectId || o.rid}`;
/* Post för ett objekt i ett mängdslag: objektets egen koppling om den finns, annars typens. */
function qmfEffPost(o, k) { const ov = (qmf.map.obj[k] || {})[qmfObjKey(o)]; if (ov !== undefined) return ov; return (qmf.map.types[k] || {})[qmfTypeVal(o)] || ""; }
/* Vilket mängdslag hanterar en post? Enheten avgör; m² delas mellan Form (posten nämner form) och Yta en sida. */
function qmfKindOfPost(p) { if (p.unit === "m²") return /form/i.test(`${p.ref} ${p.label}`) ? "form" : "area"; return (Object.entries(QTY_KINDS).find(([, v]) => v[1] === p.unit) || [])[0] || ""; }

const qmfAreaOf = o => String((o.item && o.item.area) || "").split("/").map(x => x.trim()).filter(Boolean).pop() || "(utan område)";
/* Förslag: typ → post efter namnet (Revit-familjer), område → byggnad efter namn och områdeskod (742A/742B → samma kod som 742 Sikthall …). */

/* ---- Koppla: skriv och ångra ---------------------------------------------------------------------------------------------- */
/* Lägg typer (och/eller enskilda objekt) på en kod, eller ta bort kopplingen (key = ""). Mängdslaget följer kodens enhet; "kind" anges bara vid borttagning. */
function qmfSnapshot() { qmf.undoSnap = JSON.stringify(qmf.map); }
function qmfUndo() { if (!qmf.undoSnap) return false; qmf.map = JSON.parse(qmf.undoSnap); qmf.undoSnap = ""; qmfSave(); return true; }
function qmfSetLink({ types = [], objs = [] }, key, kind) {
  const post = key ? qmfAllPosts().find(p => p.key === key) : null, k = post ? qmfKindOfPost(post) : kind; if (!k) return 0;
  qmfSnapshot();
  const T = (qmf.map.types[k] = qmf.map.types[k] || {}), O = (qmf.map.obj[k] = qmf.map.obj[k] || {});
  types.forEach(t => { if (key) T[t] = key; else delete T[t]; Object.keys(O).forEach(ok => { const o = qty.objs.find(x => qmfObjKey(x) === ok); if (o && qmfTypeVal(o) === t) delete O[ok]; }); });
  objs.forEach(o => { if (key) O[qmfObjKey(o)] = key; else O[qmfObjKey(o)] = ""; });
  qmfSave(); return types.length + objs.length;
}

function qmfSuggestPost(t, kind) {
  const P = qmfPosts(kind), byRef = ref => (P.find(p => p.ref === ref) || {}).key, byLabel = (ref, re) => (P.find(p => p.ref === ref && re.test(p.label)) || {}).key;
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
  ["vol", "form"].forEach(kind => new Set(objs.map(qmfTypeVal)).forEach(t => { if (qmfTypes(kind)[t] === undefined) { const s = qmfSuggestPost(t, kind); if (s) qmfTypes(kind)[t] = s; } }));
  const areas = [...new Set(objs.map(qmfAreaOf))], learned = {};
  areas.forEach(a => { const code = (a.match(/^(\d{3})/) || [])[1], b = qmf.builds.find(x => { const s = qmfStem(x), n = qmfStem(a.replace(/^\d+[a-z]?\s*/i, "")); return s && n && (n.includes(s) || s.includes(n)); }); if (code && b && !learned[code]) learned[code] = b; });
  areas.forEach(a => { if (qmf.map.areas[a] === undefined) { const b = qmfSuggestBuild(a, learned); if (b) qmf.map.areas[a] = b; } });
  qmfSave();
}

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
  pop.innerHTML = `<div class="qmf-combo-top"><input type="search" class="qmf-combo-q" placeholder="Sök post…  (flera ord, t.ex. väggar betong)" autocomplete="off" /><button type="button" class="qmf-combo-new" title="Saknar du koden? Skapa en egen post (kod, beskrivning och enhet)">＋ Egen post</button></div><div class="qmf-combo-list"></div>`;
  (document.fullscreenElement || document.body).appendChild(pop);
  const r = se.getBoundingClientRect(), W = Math.min(innerWidth - 16, Math.max(r.width, 560));
  pop.style.width = W + "px"; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - W - 8)) + "px";
  const list = pop.querySelector(".qmf-combo-list"), qi = pop.querySelector(".qmf-combo-q"), E = qtyEsc;
  let hi = 0;
  const words = () => qi.value.toLowerCase().split(/\s+/).filter(Boolean);
  const draw = () => {
    const w = words(); let n = 0, html = "";
    groups.forEach(g => { const it = g.items.filter(x => w.every(k => (x.t + " " + (g.label || "")).toLowerCase().includes(k))); if (!it.length) return; html += `<div class="qmf-combo-g">${E(g.label)}</div>` + it.map(x => `<div class="qmf-combo-i${x.dis ? " dis" : ""}${x.cur ? " cur" : ""}" data-i="${E(String(x.id))}">${E(x.t)}</div>`).join(""); n += it.length; });
    list.innerHTML = html || `<div class="qmf-combo-g">Inga poster matchar – ${w.length ? "tryck på ＋ Egen post för att skapa " + E(qi.value.trim()) : "skapa en egen post med knappen ovan"}</div>`;
    const els = [...list.querySelectorAll(".qmf-combo-i:not(.dis)")]; hi = Math.min(hi, Math.max(0, els.length - 1)); if (els[hi]) els[hi].classList.add("hi");
  };
  const all = groups.flatMap(g => g.items), byId = new Map(all.map(x => [String(x.id), x]));
  const close = () => { pop.remove(); document.removeEventListener("pointerdown", out, true); };
  const out = e => { if (!pop.contains(e.target) && e.target !== se) close(); };
  const pick = id => { const it = byId.get(String(id)); if (!it || it.dis) return; close(); onPick(it); };
  pop.querySelector(".qmf-combo-new").onclick = () => { const pre = qi.value.trim(); close(); qmfNewPost(pre, post => { if (post) onPick({ id: post.key, v: post.key, t: `${post.ref} – ${post.label} [${post.unit}]`, post }); }); };
  qi.addEventListener("input", () => { hi = 0; draw(); });
  qi.addEventListener("keydown", e => {
    e.stopPropagation(); const els = [...list.querySelectorAll(".qmf-combo-i:not(.dis)")];
    if (e.key === "Escape") close(); else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (els[hi]) els[hi].classList.remove("hi"); hi = Math.max(0, Math.min(els.length - 1, hi + (e.key === "ArrowDown" ? 1 : -1))); if (els[hi]) { els[hi].classList.add("hi"); els[hi].scrollIntoView({ block: "nearest" }); } }
    else if (e.key === "Enter") { e.preventDefault(); if (els[hi]) pick(els[hi].dataset.i); }
  });
  list.addEventListener("click", e => { const x = e.target.closest(".qmf-combo-i"); if (x) pick(x.dataset.i); });
  const below = innerHeight - r.bottom, up = r.top > below + 120; list.style.maxHeight = Math.max(160, Math.min(380, (up ? r.top : below) - 70)) + "px";
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v)); // listan hålls alltid inom fönstret (även om fältet scrollats utom synhåll)
  pop.style.top = up ? "" : cl(r.bottom + 4, 8, innerHeight - 200) + "px"; pop.style.bottom = up ? cl(innerHeight - r.top + 4, 8, innerHeight - 200) + "px" : "";
  draw(); setTimeout(() => { document.addEventListener("pointerdown", out, true); qi.focus(); const c = list.querySelector(".cur"); if (c) c.scrollIntoView({ block: "center" }); }, 0);
}
/* ---- Jämförelsen ------------------------------------------------------------------------------------ */

/* Poster ett objekt hör till (per mängdslag) – används även i Gantt-schemats aktivitetsdialog. */
function qmfMemberPosts(m) {
  if (!m || !m.modelId || !m.objectId || !qmfAllPosts().length) return [];
  const ok = `${m.modelId}|${m.objectId}`, out = [];
  if (qmfMemberPosts._src !== qty.objs) { qmfMemberPosts._src = qty.objs; qmfMemberPosts._idx = new Map(qty.objs.map(o => [qmfObjKey(o), o])); }
  const o = qmfMemberPosts._idx.get(ok);
  Object.keys(QTY_KINDS).forEach(k => { const ov = (qmf.map.obj[k] || {})[ok]; const key = ov !== undefined ? ov : (o ? qmfEffPost(o, k) : ""); const p = key && qmfAllPosts().find(x => x.key === key); if (p) out.push({ kind: k, post: p }); });
  return out;
}
const QMF_UNITS = ["m³", "m²", "m", "st", "kg", "ton"];
const qmfCustomKey = (ref, label, unit) => `egen|${ref}|${label}|${unit}`;
/* Skapa (eller ändra) en egen post. pre = det som skrevs i sökrutan; done(post | null). */
function qmfNewPost(pre, done, edit) {
  const E = qtyEsc, looksCode = /^[A-Za-zÅÄÖåäö]{2,5}[.\-]?\d/.test(String(pre || "").trim()) && String(pre || "").trim().length <= 14;
  const unit0 = edit ? edit.unit : "m³";
  const w = document.createElement("div"); w.className = "qmf-ask";
  w.innerHTML = `<div class="qmf-ask-box qmf-np"><div class="qmf-ask-t">${edit ? "Ändra egen post" : "Ny egen post"}</div>
    <label>Kod <input type="text" class="np-ref" value="${E(edit ? edit.ref : looksCode ? pre : "")}" placeholder="t.ex. EGEN.1 eller ESB.7" /></label>
    <label>Beskrivning <input type="text" class="np-label" value="${E(edit ? edit.label : looksCode ? "" : pre || "")}" placeholder="t.ex. Väggar av prefab betong" /></label>
    <label>Enhet <select class="np-unit">${QMF_UNITS.map(u => `<option value="${E(u)}"${u === unit0 ? " selected" : ""}>${E(u)}</option>`).join("")}</select></label>
    <div class="hint np-hint">Posten sparas i 4D-data och finns i alla listor. Mängden i förteckningen saknas, så jämförelsen visar bara vad modellen räknar.</div>
    <div class="qmf-ask-b"><button type="button" class="primary np-ok">${edit ? "Spara" : "Skapa post"}</button><button type="button" class="np-cancel">Avbryt</button></div></div>`;
  (document.fullscreenElement || document.body).appendChild(w);
  const q = c => w.querySelector(c), fin = r => { w.remove(); document.removeEventListener("keydown", key, true); done(r); };
  const key = e => { if (e.key === "Escape") { e.stopPropagation(); fin(null); } else if (e.key === "Enter" && e.target.tagName !== "BUTTON") { e.preventDefault(); q(".np-ok").click(); } };
  document.addEventListener("keydown", key, true);
  q(".np-cancel").onclick = () => fin(null);
  w.addEventListener("pointerdown", e => { if (e.target === w) fin(null); });
  q(".np-ok").onclick = () => {
    const ref = q(".np-ref").value.trim(), label = q(".np-label").value.trim(), unit = q(".np-unit").value;
    if (!ref && !label) { q(".np-hint").textContent = "Ange en kod eller en beskrivning."; q(".np-ref").focus(); return; }
    const r = ref || "EGEN", l = label || ref;
    if (edit) {
      const oldKey = edit.key, key2 = qmfCustomKey(r, l, unit);
      if (key2 !== oldKey && qmfAllPosts().some(p => p.key === key2)) { q(".np-hint").textContent = "Det finns redan en post med samma kod, beskrivning och enhet."; return; }
      Object.assign(edit, { key: key2, ref: r, label: l, unit });
      if (key2 !== oldKey) qmfRekey(oldKey, key2); // kopplingarna följer med
      qmfSaveCustom(); fin(edit); return;
    }
    const key2 = qmfCustomKey(r, l, unit), ex = qmfAllPosts().find(p => p.key === key2 || (p.ref === r && p.label === l && p.unit === unit));
    if (ex) { fin(ex); return; } // finns redan – använd den
    const post = { key: key2, ref: r, label: l, unit, k: {}, p: {}, custom: true };
    qmf.custom.push(post); qmfSaveCustom(); qmf.msg = `Egen post ${r} skapad.`; fin(post);
  };
  setTimeout(() => { const f = q(looksCode || edit ? ".np-label" : ".np-ref"); if (f) { f.focus(); f.select && f.select(); } }, 0);
}
/* Byter nyckel på en post i alla kopplingar (typ, objekt). */
function qmfRekey(oldKey, newKey) {
  ["types", "obj"].forEach(k => Object.values(qmf.map[k] || {}).forEach(m => Object.keys(m).forEach(x => { if (m[x] === oldKey) m[x] = newKey; })));
  qmfSave();
}

const qmfCustomUse = key => { let n = 0; ["types", "obj"].forEach(k => Object.values(qmf.map[k] || {}).forEach(m => Object.values(m).forEach(v => { if (v === key) n++; }))); return n; };