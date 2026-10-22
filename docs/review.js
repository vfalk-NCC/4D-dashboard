/* Granskning (PDF) – Victor 2026-10-22: "en yta där jag bara kan släppa alla mina PDF:er som jag fått i ett nytt PM, så sorterar den upp och har en visare
   med smarta funktioner … lätt kunna öppna upp ritningarna ute på bygget".

   Det här är listan, sorteringen och lagringen. Visaren med markeringar ligger i review-viewer.js.
   - PM: en granskningsomgång (t.ex. "PM 2026-10 Fläkthuset"). Man släpper PDF:er (eller hela mappar) på ytan.
   - Sortering: disciplin, ritningsnummer och revision läses ur filnamnet (och sidhuvudet på första sidan), nyaste revisionen visas och äldre döljs som "ersatta".
     Allt går att ändra för hand (Flytta till grupp).
   - Lagring: i webbläsarens IndexedDB på den här enheten (PDF:erna, markeringarna och textindex för sökning) – så ritningarna öppnas även utan nät ute på bygget.
   - Markeringar kan exporteras och läsas in som fil, och som granskningsrapport (HTML med bildutsnitt). */

const RV_DB = "4ddash-review", RV_VER = 1;
const rv = { pms: [], pm: "", view: (() => { try { const v = localStorage.getItem("4ddash-review-view"); return ["main", "valid", "pm", "zone", "disc", "pkg"].includes(v) ? v : "main"; } catch (e) { return "main"; } })(), numIdx: new Map(), docs: [], marks: new Map(), q: "", hits: null, showOld: false, sort: "no", grpClosed: new Set(JSON.parse((() => { try { return localStorage.getItem("4ddash-review-closed") || "[]"; } catch (e) { return "[]"; } })())), open: null, nav: [], order: [], selSet: new Set(), selAnchor: "", queue: [], indexing: 0, msg: "", ready: false, filter: "all" };
const rvEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rvId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const rvToast = t => { if (typeof modelToast === "function") modelToast(t); else console.info(t); };

/* ---- IndexedDB ------------------------------------------------------------------------------------------------------------------------------------ */
let rvDbP = null;
function rvDb() {
  if (rvDbP) return rvDbP;
  rvDbP = new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") return rej(new Error("Webbläsaren saknar IndexedDB"));
    const q = indexedDB.open(RV_DB, RV_VER);
    q.onupgradeneeded = () => { const d = q.result; d.createObjectStore("pms", { keyPath: "id" }); d.createObjectStore("docs", { keyPath: "id" }).createIndex("pm", "pm"); d.createObjectStore("blobs", { keyPath: "id" }); d.createObjectStore("marks", { keyPath: "id" }).createIndex("doc", "doc"); };
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  return rvDbP;
}
async function rvTx(stores, mode, fn) { const db = await rvDb(); return new Promise((res, rej) => { const tx = db.transaction(stores, mode); let out; Promise.resolve(fn(...[].concat(stores).map(s => tx.objectStore(s)))).then(v => { out = v; }, rej); tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); }
const rvReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const rvAll = (store, index, key) => rvTx(store, "readonly", s => rvReq(index ? s.index(index).getAll(key) : s.getAll()));
const rvGet = (store, id) => rvTx(store, "readonly", s => rvReq(s.get(id)));
const rvPut = (store, v) => rvTx(store, "readwrite", s => rvReq(s.put(v)));
const rvDel = (store, id) => rvTx(store, "readwrite", s => rvReq(s.delete(id)));

/* ---- Sortering ur filnamn ---------------------------------------------------------------------------------------------------------------------- */
const RV_PREFIX = { A: "Arkitekt", AR: "Arkitekt", K: "Konstruktion", KO: "Konstruktion", KR: "Konstruktion", B: "Byggnad", E: "El", EL: "El", V: "VVS", VV: "VVS", VS: "VVS", R: "VVS", F: "Ventilation", VE: "Ventilation", VA: "VA", L: "Landskap", M: "Mark", T: "Tele/Data", S: "Sprinkler", G: "Geoteknik", BR: "Brand" };
const RV_WORDS = [["Arkitekt", /arkitekt/], ["Konstruktion", /konstruktion|konstr\b|bärande|stomme/], ["VVS", /\bvvs\b|värme|sanitet|\brör\b/], ["Ventilation", /ventilation|\bvent\b|luftbehandling/], ["El", /\bel\b|elkraft|belysning|starkström/], ["Tele/Data", /tele|svagström|datanät/], ["VA", /\bva\b|vatten|avlopp|dagvatten/], ["Mark", /\bmark\b|markplan|väg|schakt/], ["Landskap", /landskap|planteringsplan/], ["Brand", /brand/], ["Geoteknik", /geo|bergteknik|markteknik/], ["Sprinkler", /sprinkler/], ["Akustik", /akustik/], ["Hiss", /\bhiss/]];
function rvParse(file) {
  const raw = String(file || "").replace(/\.pdf$/i, ""), out = { no: "", title: "", disc: "Övrigt", rev: "", date: "", key: "" };
  let base = raw.replace(/[_]+/g, " ");
  const dm = /(20\d{2})[-. ]?(\d{2})[-. ]?(\d{2})(?!\d)/.exec(base) || /(?:^|[^\d])(\d{2})(\d{2})(\d{2})(?!\d)/.exec(base);
  if (dm) { const y = dm[1].length === 4 ? dm[1] : "20" + dm[1]; if (+dm[2] >= 1 && +dm[2] <= 12 && +dm[3] >= 1 && +dm[3] <= 31) { out.date = `${y}-${dm[2]}-${dm[3]}`; base = base.replace(dm[0], dm[0][0] && /\D/.test(dm[0][0]) ? dm[0][0] : " "); } }
  const rm = /(?:^|[\s\-.(])(?:rev(?:ision)?|rv|utg(?:åva)?)[\s\-.:]*([A-Za-z0-9]{1,3})(?![A-Za-z0-9])/i.exec(base) || /(?:^|[\s\-])r([0-9]{1,2})(?![A-Za-z0-9])/i.exec(base);
  if (rm) { out.rev = rm[1].toUpperCase(); base = base.replace(rm[0], " "); }
  else { const tm = /\d[-.\s]([A-Z])$/.exec(base.trim()); if (tm) { out.rev = tm[1]; base = base.trim().slice(0, -2); } }
  base = base.replace(/\s+/g, " ").trim();
  const nm = /^(\d{5,9})(?!\d)/.exec(base) || /([A-ZÅÄÖa-zåäö]{1,3}[-. ]?\d{1,4}(?:[-.]\d{1,4}){0,3})/.exec(base) || /(\d{2,}(?:[-.]\d{1,4}){1,3})/.exec(base) || /(?<!\d)(\d{5,9})(?!\d)/.exec(base);
  if (nm) { out.no = nm[1].replace(/\s+/g, "").toUpperCase(); out.title = base.replace(nm[1], "").replace(/^[\s\-.:]+|[\s\-.:]+$/g, ""); } else out.title = base;
  const low = raw.toLowerCase(), w = RV_WORDS.find(([, re]) => re.test(low));
  if (w) out.disc = w[0]; else { const pm = /^([A-Za-zÅÄÖ]{1,2})[-_. ]?\d/.exec(raw.trim()); if (pm && RV_PREFIX[pm[1].toUpperCase()]) out.disc = RV_PREFIX[pm[1].toUpperCase()]; }
  out.key = (out.no || out.title || raw).toLowerCase().replace(/[^a-z0-9åäö]/g, "");
  return out;
}
/* Sidhuvudet på första sidan: ritningsnummer och revision när filnamnet saknar dem. */
function rvParseText(txt, meta) {
  const m = { ...meta }, t = String(txt || "");
  if (!m.no) { const x = /(?:rit(?:ningsnr|\.?\s?nr|ningsnummer)|drawing\s?(?:no|number))\D{0,12}([A-ZÅÄÖ0-9][\w.\-/]{3,})/i.exec(t); if (x) m.no = x[1].toUpperCase(); }
  if (!m.rev) { const x = /(?:\brev(?:ision)?\.?|\butg\.?)\s*[:.]?\s*([A-Z0-9]{1,3})\b/i.exec(t); if (x) m.rev = x[1].toUpperCase(); }
  m.key = (m.no || m.title || m.key || "").toLowerCase().replace(/[^a-z0-9åäö]/g, "") || m.key;
  return m;
}
const rvRevRank = r => { r = String(r || ""); if (!r) return -1; if (/^\d+$/.test(r)) return 100 + Number(r); return [...r].reduce((a, c) => a * 30 + (c.charCodeAt(0) - 64), 0); };
/* Per ritning (samma nyckel): den nyaste revisionen gäller, övriga är "ersatta". */
function rvMarkOld(docs) {
  const by = new Map(); docs.forEach(d => { d.old = false; d.newer = null; (by.get(d.key || d.id) || by.set(d.key || d.id, []).get(d.key || d.id)).push(d); });
  by.forEach(list => { if (list.length < 2) return; list.sort((a, b) => rvRevRank(b.rev) - rvRevRank(a.rev) || String(b.date || "").localeCompare(String(a.date || "")) || b.added - a.added); list.slice(1).forEach(d => { d.old = true; d.newer = list[0].id; }); list.forEach(d => { d.revs = list.length; }); });
}

/* ---- Inläsning ---------------------------------------------------------------------------------------------------------------------------------- */
let rvPdfP = null;
function rvPdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (rvPdfP) return rvPdfP;
  rvPdfP = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"; s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; res(window.pdfjsLib); }; s.onerror = () => { rvPdfP = null; rej(new Error("Kunde inte läsa in PDF-läsaren (pdf.js). Kontrollera nätverket.")); }; document.head.appendChild(s); });
  return rvPdfP;
}
const rvIsPdf = f => /\.pdf$/i.test(f.name || "") || f.type === "application/pdf";
/* Släppta filer och mappar (webkitGetAsEntry läser mappar rekursivt). */
async function rvFilesFromDrop(dt) {
  const out = [], items = dt.items ? [...dt.items] : [];
  const walk = async (en, root) => { if (!en) return; if (en.isFile) { await new Promise(r => en.file(f => { try { f.rvRoot = root || ""; } catch (e) { /* */ } out.push(f); r(); }, r)); } else if (en.isDirectory) { root = root || en.name; const rd = en.createReader(); let more = true; while (more) { const list = await new Promise(r => rd.readEntries(r, () => r([]))); more = list.length > 0; for (const c of list) await walk(c, root); } } };
  if (items.length && items[0].webkitGetAsEntry) { const ents = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean); for (const en of ents) await walk(en); }
  if (!out.length) [...(dt.files || [])].forEach(f => out.push(f));
  return out.filter(rvIsPdf);
}
async function rvImport(files) {
  files = files.filter(rvIsPdf); if (!files.length) { rvToast("Inga PDF-filer att läsa in"); return; }
  const roots = new Set(); let added = 0, dup = 0; rv.msg = `Läser in ${files.length} filer …`; rvRender();
  const have = new Set(rv.docs.map(d => d.name + "|" + d.size));
  for (const f of files) {
    if (have.has(f.name + "|" + f.size)) { dup++; continue; }
    try {
      const root = f.rvRoot || (f.webkitRelativePath ? f.webkitRelativePath.split("/")[0] : ""), pmId = root ? await rvPmByName(root) : (rv.pm || await rvAutoPm()); if (root) roots.add(root); const pmo = rv.pms.find(p => p.id === pmId), id = rvId(), meta = rvParse(f.name), doc = { id, pm: pmId, cat: (pmo && pmo.cat) || "", name: f.name, size: f.size, added: Date.now(), pages: 0, text: null, thumb: "", fav: false, opened: 0, grp: "", ...meta };
      await rvTx(["docs", "blobs"], "readwrite", (d, b) => { d.put(doc); b.put({ id, blob: f }); });
      rv.docs.push(doc); have.add(f.name + "|" + f.size); rv.queue.push(id); added++;
      if (added % 20 === 0) { rv.msg = `Läst in ${added} av ${files.length} …`; rvRender(); }
    } catch (e) { console.warn("Granskning: kunde inte spara", f.name, e); rv.msg = "Kunde inte spara " + f.name + ": " + ((e && e.message) || e); }
  }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* */ }
  rvPrep(); rv.msg = `${added} nya ritningar${roots.size ? " i paketet " + [...roots].join(", ") : ""}${dup ? `, ${dup} fanns redan` : ""}.`; rvsSoon && rvsSoon(); rvRender(); rvRunQueue();
}
/* Bakgrund: antal sidor, miniatyr, textindex och sidhuvud. */
async function rvRunQueue() {
  if (rv.indexing) return; rv.indexing = 1;
  try {
    const lib = await rvPdfjs();
    while (rv.queue.length) {
      const id = rv.queue.shift(), doc = rv.docs.find(d => d.id === id); if (!doc) continue;
      try {
        const b = await rvGet("blobs", id); if (!b) continue;
        const pdf = await lib.getDocument({ data: await b.blob.arrayBuffer() }).promise, text = []; let total = 0;
        for (let p = 1; p <= pdf.numPages && total < 400000; p++) { const pg = await pdf.getPage(p), tc = await pg.getTextContent(), s = tc.items.map(i => i.str).join(" ").replace(/\s+/g, " ").trim(); text.push(s); total += s.length; if (p === 1) { try { const vp = pg.getViewport({ scale: 1 }), k = 220 / vp.width, cv = document.createElement("canvas"); cv.width = Math.round(vp.width * k); cv.height = Math.round(vp.height * k); const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); await pg.render({ canvasContext: g, viewport: pg.getViewport({ scale: k }) }).promise; doc.thumb = cv.toDataURL("image/jpeg", 0.6); } catch (e) { /* utan miniatyr */ } } }
        doc.pages = pdf.numPages; doc.text = text; Object.assign(doc, rvParseText(text[0] || "", doc)); if (doc.disc === "Övrigt") { const w = RV_WORDS.find(([, re]) => re.test((text[0] || "").toLowerCase())); if (w) doc.disc = w[0]; }
        await rvPut("docs", doc); try { pdf.destroy(); } catch (e) { /* */ }
      } catch (e) { console.warn("Granskning: kunde inte indexera", doc.name, e); doc.pages = doc.pages || 0; doc.text = doc.text || []; try { await rvPut("docs", doc); } catch (x) { /* */ } }
      rvPrep(); rvRender(true);
    }
  } catch (e) { rv.msg = (e && e.message) || String(e); } finally { rv.indexing = 0; rvRender(true); }
}

/* ---- Paket (PM) ------------------------------------------------------------------------------------------------------------------------------ */
/* Ett paket är bara en etikett för "det här kom i samma utskick". Biblioteket visar alla paket tillsammans; paketet är ett filter. */
async function rvAutoPm() {
  const name = "Import " + new Date().toISOString().slice(0, 10); let pm = rv.pms.find(p => p.name === name);
  if (!pm) { pm = { id: rvId(), name, created: Date.now() }; await rvPut("pms", pm); rv.pms.push(pm); }
  return pm.id;
}
async function rvPmByName(name) { if (!name) return ""; let pm = rv.pms.find(p => p.name === name); if (!pm) { pm = { id: rvId(), name, created: Date.now() }; await rvPut("pms", pm); rv.pms.push(pm); } return pm.id; }
async function rvNewPm(name, silent) {
  name = name || (typeof dashPrompt === "function" ? await dashPrompt("Namn på paketet (t.ex. PM 2026-10 Fläkthuset)", "PM " + new Date().toISOString().slice(0, 10)) : prompt("Namn på paketet", "PM " + new Date().toISOString().slice(0, 10)));
  if (!name || !String(name).trim()) return; const pm = { id: rvId(), name: String(name).trim(), created: Date.now() };
  await rvPut("pms", pm); rv.pms.push(pm); rv.pm = pm.id; try { localStorage.setItem("4ddash-review-pm", pm.id); } catch (e) { /* */ } if (!silent) rvRender();
}
async function rvSelectPm(id) { rv.pm = id; rv.hits = null; rv.q = ""; try { localStorage.setItem("4ddash-review-pm", id); } catch (e) { /* */ } rvRender(); }
async function rvSetPmCat(c) {
  const pm = rv.pms.find(p => p.id === rv.pm); if (!pm) { rvToast("Välj ett paket i rullistan först"); return; }
  pm.cat = c; await rvPut("pms", pm); for (const d of rv.docs.filter(x => x.pm === pm.id)) { d.cat = c; await rvSaveDoc(d); } rvPrep(); rvRender(); rvToast(c ? `Paketet ligger nu under ${c}` : "Kategorin borttagen");
}
async function rvDeletePm() {
  const pm = rv.pms.find(p => p.id === rv.pm); if (!pm) return; const mine = rv.docs.filter(d => d.pm === pm.id);
  if (!(await dashConfirm(`Ta bort paketet "${pm.name}" med alla ${mine.length} ritningar och markeringar?\n\nDet går inte att ångra. Filerna finns kvar där du hämtade dem.`, { ok: "Ta bort" }))) return;
  for (const d of mine) await rvDeleteDoc(d.id, true);
  await rvDel("pms", pm.id); rv.pms = rv.pms.filter(p => p.id !== pm.id); rv.open = null; await rvSelectPm(""); rvPrep(); await rvMarksCount(); rvRender();
}
async function rvDeleteDoc(id, quiet) {
  { const d0 = rv.docs.find(d => d.id === id); if (d0 && typeof rvsTombAdd === "function") rvsTombAdd("doc:" + rvSid(d0)); }
  const marks = await rvAll("marks", "doc", id); for (const m of marks) await rvDel("marks", m.id);
  await rvDel("blobs", id); await rvDel("docs", id); rv.docs = rv.docs.filter(d => d.id !== id); rv.marks.delete(id); if (rv.open === id) rv.open = null;
  if (!quiet) { rvPrep(); rvRender(); }
}
async function rvSaveDoc(d) { d.upd = Date.now(); await rvPut("docs", d); if (typeof rvsOn === "function" && rvsOn()) { try { clearTimeout(rvsSaveT); } catch (e) { /* */ } rvsSaveT = setTimeout(() => rvsSync(false), 5000); } }
let rvsSaveT = 0;

/* ---- Hubb: handlingstyp, delområde och ritningslänkar ------------------------------------------------------------------------------- */
/* Handlingstyp: Bygghandling (ritningar), PM, Gällande handlingar (förteckningar, beskrivningar, kontrollplaner …). Gissas ur filnamn och första sidan, kan ändras för hand. */
const RV_TYPES = ["Bygghandling", "PM", "Gällande handlingar", "Övrigt"];
const RV_PM_RE = /\bpm\b|promemoria|protokoll|mötesanteckning|\bbeslut\b|\bändringsmeddelande\b|\bämne\b/, RV_VALID_RE = /gällande|förteckning|\bbeskrivning|kontrollplan|egenkontroll|\bama\b|\bmer\b|bygglov|startbesked|förfrågningsunderlag|\bpbl\b|riskanalys|arbetsmiljöplan|\bbas-?[pu]\b/, RV_DRAW_RE = /bygghandling|ritning|\bplan\b|sektion|fasad|detalj|elevation|\bbh\b|\bbyggnad\b|montage|\bschema\b/;
function rvTypeOf(d) {
  if (d.dtype && RV_TYPES.includes(d.dtype)) return d.dtype;
  const head = (d.name + " " + (d.title || "")).toLowerCase(), p1 = String((d.text && d.text[0]) || "").slice(0, 700).toLowerCase();
  if (RV_VALID_RE.test(head)) return "Gällande handlingar";
  if (RV_PM_RE.test(head)) return "PM";
  if (d.no && /\d/.test(d.no) && d.no.length >= 4) return "Bygghandling";
  if (RV_DRAW_RE.test(head)) return "Bygghandling";
  if (RV_VALID_RE.test(p1)) return "Gällande handlingar";
  if (RV_PM_RE.test(p1)) return "PM";
  return "Övrigt";
}
/* Delområde: kod (741, 742 …) ur filnamn/rubrik; namnen (Sektionsfickor, Sikthall …) hämtas ur tidplanens områden när den är inläst. */
const rvZoneKnown = () => { try { return typeof dpZones === "function" ? dpZones() : null; } catch (e) { return null; } };
const rvZoneName = code => { if (!code) return "Utan delområde"; try { if (typeof dpZoneLabel === "function") { const l = dpZoneLabel(code); if (l && l !== code) return l; } } catch (e) { /* */ } const n = rv.zoneNames && rv.zoneNames[code]; return n ? `${code} ${n}` : code; };
function rvZoneAuto(d, known, freq) {
  const head = (d.name + " " + (d.title || "")), low = head.toLowerCase(), p1 = String((d.text && d.text[0]) || "");
  const codes = [...head.matchAll(/(?<![\d])([1-9]\d{2})[A-Za-z]?(?![\d])/g)].map(m => m[1]);
  const ok = c => known && known.codes.length ? known.codes.includes(c) : (freq.get(c) || 0) >= 2;
  const c1 = codes.find(ok); if (c1) return c1;
  const m = /(?:delområde|område|omr\.?|zon)\s*[:\-]?\s*([1-9]\d{2})(?!\d)/i.exec(p1); if (m && (!known || !known.codes.length || known.codes.includes(m[1]))) return m[1];
  const names = known && known.names ? [...known.names] : []; for (const [code, nm] of names) { const w = nm.toLowerCase().split(/\s+/)[0]; if (w.length >= 5 && (low.includes(w) || p1.toLowerCase().includes("delområde " + w))) return code; }
  return "";
}
const rvZoneOf = d => d.zone || d.zoneAuto || "";
/* Ritningsnummer → dokument (senaste revisionen). Nummer normaliseras: A-10-001, A10001 och a 10 001 är samma. */
const rvNorm = s => String(s || "").toUpperCase().replace(/[^A-Z0-9ÅÄÖ]/g, "");
function rvNumbers(text) {
  const out = new Set(), t = String(text || "");
  for (const m of t.matchAll(/[A-ZÅÄÖ0-9][A-ZÅÄÖ0-9]*(?:[-._][A-ZÅÄÖ0-9]+){1,5}|[A-ZÅÄÖ]{1,3}\d{3,}|(?<![A-Za-z0-9])\d{5,9}(?![A-Za-z0-9])/gi)) { const raw = m[0], parts = raw.split(/[-._]/); out.add(rvNorm(raw)); if (parts.length > 2) out.add(rvNorm(parts.slice(0, -1).join("-"))); }
  return out;
}
function rvPrep() {
  rvMarkOld(rv.docs);
  const known = rvZoneKnown(), freq = new Map(); rv.docs.forEach(d => new Set([...(d.name + " " + (d.title || "")).matchAll(/(?<![\d])([1-9]\d{2})[A-Za-z]?(?![\d])/g)].map(m => m[1])).forEach(c => freq.set(c, (freq.get(c) || 0) + 1)));
  rv.docs.forEach(d => { d.zoneAuto = rvZoneAuto(d, known, freq); d.type = rvTypeOf(d); });
  rv.numIdx = new Map(); rv.docs.forEach(d => { const keys = new Set([rvNorm(d.no)]); String(d.name).replace(/\.pdf$/i, "").split(/[\s_]+/).forEach(tk => rvNumbers(tk).forEach(k => keys.add(k))); keys.forEach(n => { if (n.length < 4 || !/\d/.test(n) || /^20\d{6}$/.test(n)) return; const cur = rv.numIdx.get(n); if (!cur || (cur.old && !d.old)) rv.numIdx.set(n, d); }); });
  rv.refs = null;
}
const rvLinkDoc = (norm, from) => { const d = rv.numIdx.get(norm); return d && (!from || d.key !== from.key) ? d : null; };
/* Hänvisningar: vilka ritningar den här texten nämner, och vilka som nämner den. Läses ur textindexet (så det kräver ingen ny inläsning). */
function rvRefs() {
  if (rv.refs) return rv.refs;
  const out = new Map(), inc = new Map(); rv.docs.forEach(d => { const set = new Map(); (d.text || []).forEach((t, i) => rvNumbers(t).forEach(n => { const to = rvLinkDoc(n, d); if (to && !set.has(to.id)) set.set(to.id, i + 1); })); out.set(d.id, set); if (!d.old) set.forEach((pg, id) => { (inc.get(id) || inc.set(id, new Map()).get(id)).set(d.id, pg); }); });
  rv.refs = { out, inc }; return rv.refs;
}
const rvScope = () => rv.pm ? rv.docs.filter(d => d.pm === rv.pm) : rv.docs;

/* ---- Lista och sökning -------------------------------------------------------------------------------------------------------------------- */
const rvNum = s => { const m = /(\d+)/g, a = []; let x; while ((x = m.exec(s))) a.push(Number(x[1])); return a; };
function rvCmp(a, b) { const k = rv.sort; if (k === "name") return a.name.localeCompare(b.name, "sv", { numeric: true }); if (k === "date") return b.added - a.added; if (k === "rev") return rvRevRank(b.rev) - rvRevRank(a.rev); return (a.no || a.name).localeCompare(b.no || b.name, "sv", { numeric: true }) || a.name.localeCompare(b.name, "sv", { numeric: true }); }
function rvSearch(q) {
  q = String(q || "").trim().toLowerCase(); rv.q = q; if (q.length < 2) { rv.hits = null; return; }
  const words = q.split(/\s+/).filter(Boolean), hits = [];
  rvScope().forEach(d => {
    if (d.old && !rv.showOld) return; const head = (d.name + " " + d.no + " " + d.title + " " + d.disc + " " + d.rev + " " + d.type + " " + rvZoneName(rvZoneOf(d))).toLowerCase();
    const nameHit = words.every(w => head.includes(w)); const pages = [];
    (d.text || []).forEach((t, i) => { const low = t.toLowerCase(); if (words.every(w => low.includes(w))) { const at = low.indexOf(words[0]); pages.push({ p: i + 1, s: (t.slice(Math.max(0, at - 30), at + 70)) }); } });
    if (nameHit || pages.length) hits.push({ d, nameHit, pages: pages.slice(0, 5), n: pages.length });
  });
  rv.hits = hits;
}
async function rvMarksCount(docs) { const all = await rvAll("marks"); const m = new Map(); all.forEach(x => { const o = m.get(x.doc) || { n: 0, open: 0 }; o.n++; if (x.status === "open") o.open++; m.set(x.doc, o); }); rv.mc = m; }
function rvListHtml() {
  const docs = rvScope().filter(d => (rv.showOld && rv.view !== "main" && rv.view !== "valid") || !d.old).filter(d => rv.view === "main" ? d.type === "Bygghandling" : rv.view === "valid" ? d.type === "Gällande handlingar" : rv.view === "pm" ? (d.type === "PM" || !!d.cat || !!(rv.pms.find(p => p.id === d.pm) || {}).cat) : true).filter(d => rv.filter === "fav" ? d.fav : rv.filter === "open" ? ((rv.mc && rv.mc.get(d.id)) || { open: 0 }).open > 0 : true);
  if (rv.hits) rv.order = rv.hits.map(h => h.d.id);
  if (rv.hits) return rv.hits.length ? rv.hits.map(h => `<div class="rv-hit"><button class="rv-doc" data-open="${h.d.id}"><b>${rvEsc(h.d.no || h.d.name)}</b> ${rvEsc(h.d.title)}${h.d.rev ? ` <i class="rv-rev">rev ${rvEsc(h.d.rev)}</i>` : ""}</button>${h.pages.map(p => `<button class="rv-snip" data-open="${h.d.id}" data-page="${p.p}" data-hl="${rvEsc(rv.q)}"><u>s.${p.p}</u> ${rvEsc(p.s)}</button>`).join("")}${h.n > h.pages.length ? `<small>… ${h.n - h.pages.length} träffar till</small>` : ""}</div>`).join("") : `<p class="rv-empty">Inga träffar på "${rvEsc(rv.q)}".</p>`;
  if (!docs.length) return `<p class="rv-empty">${rv.docs.length ? (rv.view === "main" ? "Inga ritningar att visa i huvudmappen – byt vy ovan för att se PM och övriga handlingar." : "Inget att visa med det här filtret.") : "Släpp PDF-filer (eller en hel mapp) här så sorteras de upp automatiskt."}</p>`;
  rv.order = [];
  const favs = docs.filter(d => d.fav), recent = docs.filter(d => d.opened).sort((a, b) => b.opened - a.opened).slice(0, 4);
  const row = (d, noOrd) => { if (!noOrd) rv.order.push(d.id); const mc = (rv.mc && rv.mc.get(d.id)) || null, pk = rv.pms.find(p => p.id === d.pm); return `<div class="rv-row${rv.open === d.id ? " on" : ""}${d.old ? " old" : ""}${rv.selSet.has(d.id) ? " sel" : ""}" data-doc="${d.id}"><button class="rv-doc" data-open="${d.id}" title="${rvEsc(d.name)}${pk ? " · " + rvEsc(pk.name) : ""}">${d.thumb ? `<img class="rv-th" src="${d.thumb}" alt="">` : `<span class="rv-th ph"></span>`}<span class="rv-t"><b>${rvEsc(d.no || d.name.replace(/\.pdf$/i, ""))}</b><small>${rvEsc(d.title || "")}</small></span></button>${d.rev ? `<span class="rv-rev" title="Revision">${rvEsc(d.rev)}</span>` : ""}${d.old ? `<span class="rv-badge old" title="Det finns en nyare revision">ersatt</span>` : d.revs > 1 ? `<span class="rv-badge new" title="${d.revs} revisioner finns">ny rev</span>` : ""}${mc && mc.n ? `<span class="rv-badge ${mc.open ? "open" : "ok"}" title="${mc.open} öppna av ${mc.n} markeringar">${mc.open || "✓"}</span>` : ""}<button class="rv-star${d.fav ? " on" : ""}" data-fav="${d.id}" title="Favorit (snabbåtkomst ute på bygget)" aria-label="Favorit">★</button><button class="rv-more" data-more="${d.id}" title="Fler val" aria-label="Fler val">⋯</button></div>`; };
  const zoneKey = d => rvZoneOf(d), pkgName = d => (rv.pms.find(p => p.id === d.pm) || { name: "Utan paket" }).name;
  const LV = { cat: d => rvCatOf(d), type: d => d.type, zone: d => zoneKey(d), disc: d => d.grp || d.disc || "Övrigt", pkg: pkgName };
  const plan = { main: ["zone"], valid: ["zone"], pm: ["cat", "pkg"], zone: ["zone", "type"], disc: ["disc"], pkg: ["pkg", "type"] }[rv.view] || ["zone"];
  const label = (lv, k) => lv === "zone" ? rvZoneName(k) : k;
  const pkgAge = n => { const p = rv.pms.find(x => x.name === n); return p ? p.created || 0 : 0; };
  const order = (lv, keys) => keys.sort((a, b) => lv === "cat" ? (a === "Okategoriserade") - (b === "Okategoriserade") || rvCatList().indexOf(a) - rvCatList().indexOf(b) : lv === "pkg" ? pkgAge(b) - pkgAge(a) || a.localeCompare(b, "sv", { numeric: true }) : lv === "type" ? RV_TYPES.indexOf(a) - RV_TYPES.indexOf(b) : (lv === "zone" ? (!a) - (!b) : (a === "Övrigt") - (b === "Övrigt")) || label(lv, a).localeCompare(label(lv, b), "sv", { numeric: true }));
  const tree = (list, lvls, path) => {
    if (!lvls.length) return list.sort(rvCmp).map(d => row(d)).join("");
    const lv = lvls[0], by = new Map(); list.forEach(d => { const k = LV[lv](d) || ""; (by.get(k) || by.set(k, []).get(k)).push(d); });
    return order(lv, [...by.keys()]).map(k => { const sub = by.get(k), id = path + "/" + k, closed = rv.grpClosed.has(id), depth = path.split("/").length - 1; return `<div class="rv-grp rv-d${depth}"><button class="rv-gh" data-grp="${rvEsc(id)}">${closed ? "▸" : "▾"} <span class="rv-fi">${depth === 0 ? (closed ? "📁" : "📂") : "📄"}</span>${rvEsc(label(lv, k))} <em>${sub.length}</em></button>${closed ? "" : tree(sub, lvls.slice(1), id)}</div>`; }).join("");
  };
  const NOTE = { main: "", valid: "Gällande handlingar: förteckningar, beskrivningar, kontrollplaner m.m. – senaste versionen av varje.", pm: "PM: sorterade i STÅL, BYGG och MARK & VA, sedan en mapp per utskick. Sätt kategori på ett paket via ⋯ bredvid paketlistan, eller på markerade filer (Kategori).", zone: "Delområden: varje område med sina ritningar och handlingar.", disc: "Discipliner: arkitekt, konstruktion, el, VVS …", pkg: "Utskick: allt precis som det kom, en mapp per paket (senaste överst)." };
  const mainHint = rv.view !== "main" && NOTE[rv.view] ? `<div class="rv-note">${NOTE[rv.view]}</div>` : rv.view === "main" ? `<div class="rv-note">Huvudmapp: senaste revisionen av varje ritning${rv.docs.some(d => d.old) ? `, ${rv.docs.filter(d => d.old).length} äldre revisioner ligger kvar under "ersatta"` : ""}.</div>` : "";
  return rvSelBar() + mainHint + (favs.length || recent.length ? `<div class="rv-grp"><div class="rv-gh">★ Snabbåtkomst</div>${[...favs, ...recent.filter(r => !r.fav)].map(d => row(d, true)).join("")}</div>` : "") + tree(docs, plan, "");
}
/* Listan finns på två ställen: i vänstermenyn och (i helskärm) under hänvisningarna till höger. */
function rvListPaint() { const h = rvListHtml(); ["rvList", "rvList2"].forEach(id => { const l = document.getElementById(id); if (l) l.innerHTML = h; }); }
/* PM-kategorier: STÅL, BYGG, MARK & VA (kan utökas). Sätts per paket (och därmed dess filer) eller per fil; gissas ur namnet tills du valt. */
const RV_CAT_DEF = ["STÅL", "BYGG", "MARK & VA"];
const rvCatList = () => { try { const v = JSON.parse(localStorage.getItem("4ddash-review-cats") || "null"); return Array.isArray(v) && v.length ? v : RV_CAT_DEF; } catch (e) { return RV_CAT_DEF; } };
function rvCatAdd(n) { const l = rvCatList().slice(); if (n && !l.includes(n)) { l.push(n); try { localStorage.setItem("4ddash-review-cats", JSON.stringify(l)); } catch (e) { /* */ } } }
function rvCatOf(d) {
  if (d.cat) return d.cat; const pm = rv.pms.find(p => p.id === d.pm); if (pm && pm.cat) return pm.cat;
  const hay = (d.name + " " + (pm ? pm.name : "")).toLowerCase(), list = rvCatList();
  const hit = list.find(c => hay.includes(c.toLowerCase())); if (hit) return hit;
  if (/\bstål\b|\bstal\b/.test(hay) && list.includes("STÅL")) return "STÅL"; if (/\bmark\b|\bva\b|vatten|avlopp|dagvatten|\bväg\b/.test(hay) && list.includes("MARK & VA")) return "MARK & VA"; if (/\bbygg\b|betong|stomme|bjälklag/.test(hay) && list.includes("BYGG")) return "BYGG";
  return "Okategoriserade";
}
function rvSelBar() {
  if (!rv.selSet.size) return "";
  return `<div class="rv-selbar"><b>${rv.selSet.size} valda</b><button data-bulk="type">Typ</button><button data-bulk="zone">Delområde</button><button data-bulk="pkg">Paket</button><button data-bulk="cat">Kategori</button><button data-bulk="fav">★</button><button data-bulk="zip">ZIP</button><button data-bulk="del">Ta bort</button><button data-bulk="clear">Avmarkera</button></div>`;
}
const rvSelDocs = () => rv.docs.filter(d => rv.selSet.has(d.id));
function rvSelClick(id, e) {
  if (e.shiftKey && rv.selAnchor && rv.order.includes(rv.selAnchor)) { const a = rv.order.indexOf(rv.selAnchor), b = rv.order.indexOf(id), [x, y] = a < b ? [a, b] : [b, a]; if (!(e.ctrlKey || e.metaKey)) rv.selSet.clear(); rv.order.slice(x, y + 1).forEach(i => rv.selSet.add(i)); }
  else { if (rv.selSet.has(id)) rv.selSet.delete(id); else rv.selSet.add(id); rv.selAnchor = id; }
  rvListPaint();
}
async function rvBulk(kind, anchor) {
  const docs = rvSelDocs(); if (!docs.length) return; const ask = async (t, v) => typeof dashPrompt === "function" ? dashPrompt(t, v) : prompt(t, v);
  const done = async () => { rvPrep(); rvRender(true); rvListPaint(); };
  const setAll = (patch) => async () => { for (const d of docs) { Object.assign(d, patch); await rvSaveDoc(d); } await done(); rvToast(`${docs.length} ändrade`); };
  if (kind === "clear") { rv.selSet.clear(); rv.selAnchor = ""; await done(); return; }
  if (kind === "type") rvMenu(anchor, [["Handlingstyp: automatiskt", setAll({ dtype: "" })], ...RV_TYPES.map(t => ["Handlingstyp: " + t, setAll({ dtype: t })])]);
  else if (kind === "zone") { const codes = [...new Set([...(rvZoneKnown() || { codes: [] }).codes, ...rv.docs.map(rvZoneOf).filter(Boolean)])].sort(); rvMenu(anchor, [["Delområde: automatiskt", setAll({ zone: "" })], ...codes.slice(0, 14).map(c => ["Delområde: " + rvZoneName(c), setAll({ zone: c })]), ["Annat delområde …", async () => { const n = await ask("Delområde (kod, t.ex. 742)", ""); if (n != null) await setAll({ zone: String(n).trim() })(); }]]); }
  else if (kind === "pkg") rvMenu(anchor, [...rv.pms.slice(0, 14).map(p => ["Flytta till paket: " + p.name, setAll({ pm: p.id })]), ["Nytt paket …", async () => { const n = await ask("Namn på paketet", ""); if (n && n.trim()) await setAll({ pm: await rvPmByName(n.trim()) })(); }]]);
  else if (kind === "cat") rvMenu(anchor, [...rvCatList().map(c => ["PM-kategori: " + c, setAll({ cat: c })]), ["Ingen / automatiskt", setAll({ cat: "" })], ["Egen kategori …", async () => { const n = await ask("Namn på kategorin (t.ex. EL)", ""); if (n && n.trim()) { rvCatAdd(n.trim()); await setAll({ cat: n.trim() })(); } }]]);
  else if (kind === "fav") { const on = docs.some(d => !d.fav); await setAll({ fav: on })(); }
  else if (kind === "zip") { if (typeof rvExportMain === "function") await rvExportMain(docs, "valda_ritningar"); }
  else if (kind === "del") { if (!(await dashConfirm(`Ta bort ${docs.length} filer och deras markeringar?\n\nDet går inte att ångra. Filerna finns kvar där du hämtade dem.`, { ok: "Ta bort" }))) return; for (const d of docs) await rvDeleteDoc(d.id, true); rv.selSet.clear(); await rvMarksCount(); await done(); }
}
function rvTabsHtml() {
  const sc = rvScope(), cnt = { main: sc.filter(d => !d.old && d.type === "Bygghandling").length, valid: sc.filter(d => !d.old && d.type === "Gällande handlingar").length, pm: sc.filter(d => d.type === "PM" || !!d.cat || !!(rv.pms.find(p => p.id === d.pm) || {}).cat).length, zone: sc.filter(d => !d.old).length, disc: sc.filter(d => !d.old).length, pkg: sc.length };
  const T = [["main", "📁", "Huvudmapp", "Senaste revisionen av alla ritningar"], ["valid", "📜", "Gällande handlingar", "Förteckningar, beskrivningar, kontrollplaner"], ["pm", "📝", "PM", "PM, en mapp per utskick"], ["zone", "🗂", "Delområden", "Per område: 741, 742 …"], ["disc", "🛠", "Discipliner", "Arkitekt, konstruktion, el, VVS …"], ["pkg", "📦", "Utskick", "Alla filer per paket, senaste överst"]];
  return `<div class="rv-tabs" role="tablist">${T.map(([k, ic, l, t]) => `<button type="button" role="tab" class="rv-tab${rv.view === k ? " on" : ""}" data-view="${k}" title="${rvEsc(t)}">${ic} ${l} <em>${cnt[k]}</em></button>`).join("")}</div><div class="rv-fold"><button type="button" data-fold="close">Fäll ihop alla</button><button type="button" data-fold="open">Öppna alla</button></div>`;
}
function rvHtml() {
  const pm = rv.pms.find(p => p.id === rv.pm), nOld = rvScope().filter(d => d.old).length, tot = rvScope().length;
  const mcOpen = rv.mc ? [...rv.mc.values()].reduce((a, x) => a + x.open, 0) : 0;
  return `<div class="rv-wrap${rv.open ? " has-doc" : ""}">
    <aside class="rv-side"><div class="rv-pmbar"><select id="rvPm" aria-label="Paket"><option value="">Alla paket (${rv.docs.length})</option>${rv.pms.map(p => `<option value="${p.id}"${p.id === rv.pm ? " selected" : ""}>${rvEsc(p.name)} (${rv.docs.filter(d => d.pm === p.id).length})</option>`).join("")}</select><button id="rvNewPm" title="Nytt paket (t.ex. ett PM du fått)">＋</button>${pm ? `<button id="rvPmMore" title="Fler val för paketet">⋯</button>` : ""}</div>
      <div class="rv-drop" id="rvDrop" tabindex="0"><b>Släpp PDF:er här</b><span>eller en hel mapp – <label class="rv-pick">välj filer<input type="file" id="rvFile" accept="application/pdf,.pdf" multiple hidden></label> · <label class="rv-pick">välj mapp<input type="file" id="rvDir" webkitdirectory hidden></label></span></div>
      ${rv.msg ? `<div class="rv-msg">${rvEsc(rv.msg)}${rv.indexing ? ` <span class="rv-spin"></span> läser sidor (${rv.queue.length} kvar)` : ""}</div>` : rv.indexing ? `<div class="rv-msg"><span class="rv-spin"></span> Läser sidor och söker rubriker (${rv.queue.length} kvar)</div>` : ""}
      ${rvTabsHtml()}
      <div class="rv-tools"><input type="search" id="rvQ" placeholder="Sök i filnamn, rubriker och texten i ritningarna …" value="${rvEsc(rv.q)}" aria-label="Sök"></div>
      <div class="rv-tools"><select id="rvSort" aria-label="Sortera"><option value="no"${rv.sort === "no" ? " selected" : ""}>Ritningsnr</option><option value="name"${rv.sort === "name" ? " selected" : ""}>Filnamn</option><option value="date"${rv.sort === "date" ? " selected" : ""}>Senast tillagd</option><option value="rev"${rv.sort === "rev" ? " selected" : ""}>Revision</option></select><select id="rvFilter" aria-label="Visa"><option value="all"${rv.filter === "all" ? " selected" : ""}>Alla</option><option value="fav"${rv.filter === "fav" ? " selected" : ""}>Favoriter</option><option value="open"${rv.filter === "open" ? " selected" : ""}>Med öppna markeringar</option></select>${nOld && rv.view !== "main" ? `<label class="rv-chk" title="Visa även ritningar som ersatts av en nyare revision"><input type="checkbox" id="rvOld"${rv.showOld ? " checked" : ""}> ersatta (${nOld})</label>` : ""}</div>
      <div class="rv-list" id="rvList">${rvListHtml()}</div>
      <div class="rv-foot">${tot} ritningar${rv.store ? ` · <span title="Webbläsarens lagring för den här sidan på den här enheten (IndexedDB): PDF:erna, miniatyrer, textindex och markeringar. Siffran efter \"av\" är utrymmet webbläsaren tillåter, inte något som är fullt. Ingenting ligger i Trimble Connect, och rensar du webbläsarens webbplatsdata försvinner det.">lagrat på den här enheten: ${rv.store.replace(" av ", " (utrymme ")}${rv.store.includes(" av ") ? ")" : ""}</span>` : ""}${mcOpen ? ` · <b>${mcOpen}</b> öppna markeringar` : ""} ${typeof rvsOn === "function" && rvsOn() ? `<button id="rvSync" title="Synka PDF:er, markeringar och inställningar med 4D-data (delas med alla som använder projektet)">Synka${rv.remoteOnly ? ` (${rv.remoteOnly} nya)` : ""}</button> ` : ""}<button id="rvMainZip" title="Senaste revisionen av alla ritningar som ZIP, en mapp per delområde">Exportera huvudmapp</button> <button id="rvRep" title="Granskningsrapport (HTML) och markeringar som fil">Rapport / export …</button></div></aside>
    <section class="rv-main" id="rvMain">${rv.open ? "" : `<div class="rv-hello"><h3>${pm ? rvEsc(pm.name) : "PDF-hubb"}</h3><p>Välj en ritning i listan för att öppna den. I visaren kan du markera, kommentera, mäta, söka i texten och jämföra revisioner. Allt sparas på den här enheten, så ritningarna fungerar även utan nät ute på bygget.</p><ul><li>Släpp alla PDF:er (ritningar, PM, förteckningar) på ytan till vänster – de sorteras på handlingstyp, delområde, disciplin, ritningsnummer och revision.</li><li>Huvudmappen visar senaste revisionen av varje ritning. Ritningsnummer som nämns i en ritning eller ett PM blir länkar.</li><li>★ lägger en ritning under Snabbåtkomst.</li><li>Sökningen går i filnamn och i själva texten i PDF:erna.</li></ul></div>`}</section>
  </div>`;
}
let rvBind = false, rvPaintT = 0;
function rvRender(soft) {
  const box = document.getElementById("revBox"); if (!box) return;
  const zs = (() => { const k = rvZoneKnown(); return k ? k.codes.join(",") : ""; })(); if (zs !== rv.zsig) { rv.zsig = zs; if (rv.ready) rvPrep(); }
  if (soft && rv.open && box.querySelector(".rv-view")) { rvListPaint(); const f = box.querySelector(".rv-foot"); return; }
  const keepQ = document.activeElement && document.activeElement.id === "rvQ";
  const view = rv.open ? box.querySelector(".rv-view") : null;
  box.innerHTML = rvHtml();
  if (view) { const m = document.getElementById("rvMain"); if (m) { m.innerHTML = ""; m.appendChild(view); } } else if (rv.open && typeof rvOpenDoc === "function") rvOpenDoc(rv.open, { again: true });
  if (keepQ) { const q = document.getElementById("rvQ"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
}
async function rvInit() {
  const box = document.getElementById("revBox"); if (!box) return;
  try {
    rv.pms = await rvAll("pms"); const want = (() => { try { return localStorage.getItem("4ddash-review-pm") || ""; } catch (e) { return ""; } })();
    rv.pm = rv.pms.find(p => p.id === want) ? want : ""; rv.docs = await rvAll("docs"); rvPrep(); await rvMarksCount(); rv.ready = true;
    rv.queue = rv.docs.filter(d => d.text == null).map(d => d.id);
  } catch (e) { box.innerHTML = `<p class="rv-empty">Granskningen kan inte starta: ${rvEsc((e && e.message) || e)}</p>`; return; }
  if (!rvBind) {
    rvBind = true;
    box.addEventListener("click", rvClick); box.addEventListener("change", rvChange); box.addEventListener("input", e => { if (e.target.id === "rvQ") { rvSearch(e.target.value); rvListPaint(); } });
    const over = e => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files")) { e.preventDefault(); box.classList.add("rv-over"); } };
    box.addEventListener("dragover", over); box.addEventListener("dragenter", over); box.addEventListener("dragleave", e => { if (!box.contains(e.relatedTarget)) box.classList.remove("rv-over"); });
    box.addEventListener("drop", async e => { e.preventDefault(); box.classList.remove("rv-over"); const files = await rvFilesFromDrop(e.dataTransfer); await rvImport(files); await rvMarksCount(); rvRender(); });
  }
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); if (e && e.usage != null) rv.store = (e.usage / 1048576 >= 1024 ? (e.usage / 1073741824).toFixed(1) + " GB" : Math.round(e.usage / 1048576) + " MB") + (e.quota ? " av " + (e.quota / 1073741824 >= 1 ? (e.quota / 1073741824).toFixed(0) + " GB" : Math.round(e.quota / 1048576) + " MB") : ""); } } catch (e) { /* */ }
  rvRender(); if (rv.queue.length) rvRunQueue();
  if (typeof rvsOn === "function" && rvsOn()) setTimeout(() => rvsSync(false), 2500);
  [3000, 9000].forEach(ms => setTimeout(() => { const k = rvZoneKnown(), z = k ? k.codes.join(",") : ""; if (z !== rv.zsig) rvRender(true); }, ms));
}
async function rvClick(e) {
  const t = e.target, q = s => t.closest(s);
  if (q("#rvNewPm")) { await rvNewPm(); return; }
  if (q("#rvPmMore")) { rvPmMenu(q("#rvPmMore")); return; }
  const bk = q("[data-bulk]"); if (bk) { await rvBulk(bk.dataset.bulk, bk); return; }
  const op = q("[data-open]"); if (op && (e.ctrlKey || e.metaKey || e.shiftKey) && op.closest(".rv-row")) { e.preventDefault(); rvSelClick(op.dataset.open, e); return; }
  if (op && rv.selSet.size && op.closest(".rv-row")) { rv.selSet.clear(); rvListPaint(); }
  if (op) { const d = op.dataset; rvOpenDoc(d.open, { page: d.page ? Number(d.page) : 1, hl: d.hl || "" }); return; }
  const fv = q("[data-fav]"); if (fv) { const d = rv.docs.find(x => x.id === fv.dataset.fav); if (d) { d.fav = !d.fav; await rvSaveDoc(d); rvRender(true); rvListPaint(); } return; }
  const mo = q("[data-more]"); if (mo) { rvDocMenu(mo, mo.dataset.more); return; }
  const g = q("[data-grp]"); if (g) { const k = g.dataset.grp; if (rv.grpClosed.has(k)) rv.grpClosed.delete(k); else rv.grpClosed.add(k); try { localStorage.setItem("4ddash-review-closed", JSON.stringify([...rv.grpClosed])); } catch (x) { /* */ } rvListPaint(); return; }
  const vt = q("[data-view]"); if (vt) { rv.view = vt.dataset.view; try { localStorage.setItem("4ddash-review-view", rv.view); } catch (x) { /* */ } rvRender(); if (rvv.fsWant && document.getElementById("rvMarks") && typeof rvvMarksPane === "function") rvvMarksPane(); return; }
  const fd = q("[data-fold]"); if (fd) { if (fd.dataset.fold === "open") rv.grpClosed.clear(); else document.querySelectorAll("#rvList [data-grp]").forEach(b => rv.grpClosed.add(b.dataset.grp)); try { localStorage.setItem("4ddash-review-closed", JSON.stringify([...rv.grpClosed])); } catch (x) { /* */ } rvListPaint(); return; }
  if (q("#rvSync")) { await rvsSync(true); return; }
  if (q("#rvMainZip")) { if (typeof rvExportMain === "function") await rvExportMain(); return; }
  if (q("#rvRep")) { if (typeof rvReportMenu === "function") rvReportMenu(q("#rvRep")); return; }
}
async function rvChange(e) {
  const t = e.target;
  if (t.id === "rvPm") { await rvSelectPm(t.value); }
  else if (t.id === "rvFile" || t.id === "rvDir") { const files = [...t.files].filter(rvIsPdf); t.value = ""; await rvImport(files); await rvMarksCount(); rvRender(); }
  else if (t.id === "rvSort") { rv.sort = t.value; rvListPaint(); }
  else if (t.id === "rvFilter") { rv.filter = t.value; rvListPaint(); }
  else if (t.id === "rvOld") { rv.showOld = t.checked; if (rv.q) rvSearch(rv.q); rvListPaint(); }
}
/* Små menyer (PM och ritning). */
function rvMenu(anchor, items) {
  document.querySelectorAll(".rv-menu").forEach(m => m.remove());
  const m = document.createElement("div"); m.className = "rv-menu"; m.innerHTML = items.map((x, i) => `<button data-mi="${i}">${rvEsc(x[0])}</button>`).join(""); document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(); m.style.left = Math.max(6, Math.min(innerWidth - 230, r.left)) + "px"; m.style.top = Math.min(innerHeight - m.offsetHeight - 8, r.bottom + 4) + "px";
  const off = ev => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("pointerdown", off, true); } };
  m.onclick = async ev => { const b = ev.target.closest("[data-mi]"); if (!b) return; m.remove(); document.removeEventListener("pointerdown", off, true); await items[Number(b.dataset.mi)][1](); };
  setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
}
function rvPmMenu(a) { rvMenu(a, [["Sätt PM-kategori (STÅL, BYGG, MARK & VA) …", () => setTimeout(() => rvMenu(a, [...rvCatList().map(c => ["Kategori: " + c, async () => { await rvSetPmCat(c); }]), ["Ingen kategori", async () => { await rvSetPmCat(""); }], ["Egen kategori …", async () => { const n = await (typeof dashPrompt === "function" ? dashPrompt("Namn på kategorin", "") : prompt("Kategori", "")); if (n && n.trim()) { rvCatAdd(n.trim()); await rvSetPmCat(n.trim()); } }]]), 0)], ["Byt namn på PM …", async () => { const pm = rv.pms.find(p => p.id === rv.pm); const n = await (typeof dashPrompt === "function" ? dashPrompt("Nytt namn på PM", pm.name) : prompt("Nytt namn", pm.name)); if (n && n.trim()) { pm.name = n.trim(); await rvPut("pms", pm); rvRender(); } }], ["Ta bort PM …", rvDeletePm]]); }
function rvDocMenu(a, id) {
  const d = rv.docs.find(x => x.id === id); if (!d) return; const refresh = () => { rvPrep(); rvRender(true); rvListPaint(); };
  const ask = async (t, v) => typeof dashPrompt === "function" ? dashPrompt(t, v) : prompt(t, v);
  const typeMenu = () => rvMenu(a, [["Handlingstyp: automatiskt", async () => { d.dtype = ""; await rvSaveDoc(d); refresh(); }], ...RV_TYPES.map(t => ["Handlingstyp: " + t + (rvTypeOf(d) === t ? " ✓" : ""), async () => { d.dtype = t; await rvSaveDoc(d); refresh(); }])]);
  const zoneMenu = () => { const codes = [...new Set([...(rvZoneKnown() || { codes: [] }).codes, ...rv.docs.map(rvZoneOf).filter(Boolean)])].sort(); rvMenu(a, [["Delområde: automatiskt", async () => { d.zone = ""; await rvSaveDoc(d); refresh(); }], ...codes.slice(0, 14).map(c => ["Delområde: " + rvZoneName(c), async () => { d.zone = c; await rvSaveDoc(d); refresh(); }]), ["Annat delområde …", async () => { const n = await ask("Delområde (kod, t.ex. 742)", rvZoneOf(d)); if (n != null) { d.zone = String(n).trim(); await rvSaveDoc(d); refresh(); } }]]); };
  const pkgMenu = () => rvMenu(a, rv.pms.filter(p => p.id !== d.pm).slice(0, 14).map(p => ["Flytta till paket: " + p.name, async () => { d.pm = p.id; await rvSaveDoc(d); refresh(); }]));
  const discMenu = () => { const groups = [...new Set([...rv.docs.map(x => x.grp || x.disc), ...Object.values(RV_PREFIX), "Övrigt"])].filter(Boolean).sort((x, y) => x.localeCompare(y, "sv")); rvMenu(a, [...groups.filter(g => g !== (d.grp || d.disc)).slice(0, 12).map(g => ["Disciplin: " + g, async () => { d.grp = g; await rvSaveDoc(d); refresh(); }]), ["Egen disciplin/grupp …", async () => { const n = await ask("Gruppnamn", d.grp || d.disc); if (n && n.trim()) { d.grp = n.trim(); await rvSaveDoc(d); refresh(); } }]]); };
  rvMenu(a, [["Öppna", () => rvOpenDoc(id, {})], ["Ange handlingstyp …", () => setTimeout(typeMenu, 0)], ["Ange delområde …", () => setTimeout(zoneMenu, 0)], ["Ange PM-kategori …", () => setTimeout(() => rvMenu(a, [...rvCatList().map(c => ["PM-kategori: " + c, async () => { d.cat = c; await rvSaveDoc(d); refresh(); }]), ["Ingen / automatiskt", async () => { d.cat = ""; await rvSaveDoc(d); refresh(); }]]), 0)], ["Ange disciplin …", () => setTimeout(discMenu, 0)], ["Flytta till annat paket …", () => setTimeout(pkgMenu, 0)], ["Redigera ritningsnr/revision …", async () => { const n = await ask("Ritningsnummer och revision, t.ex. A-10-001 B", `${d.no} ${d.rev}`.trim()); if (n == null) return; const m = /^(.*?)(?:\s+([A-Za-z0-9]{1,3}))?$/.exec(String(n).trim()); d.no = (m[1] || "").toUpperCase(); d.rev = (m[2] || "").toUpperCase(); d.key = (d.no || d.title || d.name).toLowerCase().replace(/[^a-z0-9åäö]/g, ""); await rvSaveDoc(d); refresh(); }], ["Ta bort ritningen …", async () => { if (await dashConfirm(`Ta bort ${d.name} och dess markeringar?`, { ok: "Ta bort" })) { await rvDeleteDoc(id); await rvMarksCount(); rvRender(); } }]]);
}
document.addEventListener("DOMContentLoaded", () => { rvInit(); });
/* Områdesnamnen kommer från tidplanen, som kan läsas in efter PDF-listan: räkna om delområdena när den blir klar. */
window.rvRezone = () => { if (!rv.ready) return; rvPrep(); const l = document.getElementById("rvList"); if (l && !rv.q) l.innerHTML = rvListHtml(); };
if (document.readyState !== "loading") setTimeout(rvInit, 0);
