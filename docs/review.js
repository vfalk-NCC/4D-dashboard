/* Granskning (PDF) – Victor 2026-10-22: "en yta där jag bara kan släppa alla mina PDF:er som jag fått i ett nytt PM, så sorterar den upp och har en visare
   med smarta funktioner … lätt kunna öppna upp ritningarna ute på bygget".

   Det här är listan, sorteringen och lagringen. Visaren med markeringar ligger i review-viewer.js.
   - PM: en granskningsomgång (t.ex. "PM 2026-10 Fläkthuset"). Man släpper PDF:er (eller hela mappar) på ytan.
   - Sortering: disciplin, ritningsnummer och revision läses ur filnamnet (och sidhuvudet på första sidan), nyaste revisionen visas och äldre döljs som "ersatta".
     Allt går att ändra för hand (Flytta till grupp).
   - Lagring: i webbläsarens IndexedDB på den här enheten (PDF:erna, markeringarna och textindex för sökning) – så ritningarna öppnas även utan nät ute på bygget.
   - Markeringar kan exporteras och läsas in som fil, och som granskningsrapport (HTML med bildutsnitt). */

const RV_DB = "4ddash-review", RV_VER = 1;
const rv = { pms: [], pm: "", docs: [], marks: new Map(), q: "", hits: null, showOld: false, sort: "no", grpClosed: new Set(JSON.parse((() => { try { return localStorage.getItem("4ddash-review-closed") || "[]"; } catch (e) { return "[]"; } })())), open: null, queue: [], indexing: 0, msg: "", ready: false, filter: "all" };
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
  const nm = /([A-ZÅÄÖa-zåäö]{1,3}[-. ]?\d{1,4}(?:[-.]\d{1,4}){0,3})/.exec(base) || /(\d{2,}(?:[-.]\d{1,4}){1,3})/.exec(base);
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
  const walk = async en => { if (!en) return; if (en.isFile) { await new Promise(r => en.file(f => { out.push(f); r(); }, r)); } else if (en.isDirectory) { const rd = en.createReader(); let more = true; while (more) { const list = await new Promise(r => rd.readEntries(r, () => r([]))); more = list.length > 0; for (const c of list) await walk(c); } } };
  if (items.length && items[0].webkitGetAsEntry) { const ents = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean); for (const en of ents) await walk(en); }
  if (!out.length) [...(dt.files || [])].forEach(f => out.push(f));
  return out.filter(rvIsPdf);
}
async function rvImport(files) {
  if (!rv.pm) await rvNewPm("Nytt PM", true);
  files = files.filter(rvIsPdf); if (!files.length) { rvToast("Inga PDF-filer att läsa in"); return; }
  let added = 0, dup = 0; rv.msg = `Läser in ${files.length} filer …`; rvRender();
  const have = new Set(rv.docs.map(d => d.name + "|" + d.size));
  for (const f of files) {
    if (have.has(f.name + "|" + f.size)) { dup++; continue; }
    try {
      const id = rvId(), meta = rvParse(f.name), doc = { id, pm: rv.pm, name: f.name, size: f.size, added: Date.now(), pages: 0, text: null, thumb: "", fav: false, opened: 0, grp: "", ...meta };
      await rvTx(["docs", "blobs"], "readwrite", (d, b) => { d.put(doc); b.put({ id, blob: f }); });
      rv.docs.push(doc); have.add(f.name + "|" + f.size); rv.queue.push(id); added++;
      if (added % 20 === 0) { rv.msg = `Läst in ${added} av ${files.length} …`; rvRender(); }
    } catch (e) { console.warn("Granskning: kunde inte spara", f.name, e); rv.msg = "Kunde inte spara " + f.name + ": " + ((e && e.message) || e); }
  }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* */ }
  rvMarkOld(rv.docs); rv.msg = `${added} nya ritningar${dup ? `, ${dup} fanns redan` : ""}.`; rvRender(); rvRunQueue();
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
      rvMarkOld(rv.docs); rvRender(true);
    }
  } catch (e) { rv.msg = (e && e.message) || String(e); } finally { rv.indexing = 0; rvRender(true); }
}

/* ---- PM -------------------------------------------------------------------------------------------------------------------------------------------- */
async function rvNewPm(name, silent) {
  name = name || (typeof dashPrompt === "function" ? await dashPrompt("Namn på PM", "PM " + new Date().toISOString().slice(0, 10)) : prompt("Namn på PM", "PM " + new Date().toISOString().slice(0, 10)));
  if (!name || !String(name).trim()) return; const pm = { id: rvId(), name: String(name).trim(), created: Date.now() };
  await rvPut("pms", pm); rv.pms.push(pm); rv.pm = pm.id; rv.docs = []; rv.open = null; try { localStorage.setItem("4ddash-review-pm", pm.id); } catch (e) { /* */ } if (!silent) rvRender();
}
async function rvSelectPm(id) {
  rv.pm = id; rv.open = null; rv.hits = null; rv.q = ""; try { localStorage.setItem("4ddash-review-pm", id); } catch (e) { /* */ }
  rv.docs = id ? await rvAll("docs", "pm", id) : []; rvMarkOld(rv.docs);
  rv.queue = rv.docs.filter(d => d.text == null).map(d => d.id); rvRender(); if (rv.queue.length) rvRunQueue();
}
async function rvDeletePm() {
  const pm = rv.pms.find(p => p.id === rv.pm); if (!pm) return;
  if (!(await dashConfirm(`Ta bort PM "${pm.name}" med alla ${rv.docs.length} ritningar och markeringar?\n\nDet går inte att ångra. Filerna finns kvar där du hämtade dem.`, { ok: "Ta bort" }))) return;
  for (const d of rv.docs) await rvDeleteDoc(d.id, true);
  await rvDel("pms", pm.id); rv.pms = rv.pms.filter(p => p.id !== pm.id); await rvSelectPm(rv.pms[0] ? rv.pms[0].id : "");
}
async function rvDeleteDoc(id, quiet) {
  const marks = await rvAll("marks", "doc", id); for (const m of marks) await rvDel("marks", m.id);
  await rvDel("blobs", id); await rvDel("docs", id); rv.docs = rv.docs.filter(d => d.id !== id); rv.marks.delete(id); if (rv.open === id) rv.open = null;
  if (!quiet) { rvMarkOld(rv.docs); rvRender(); }
}
async function rvSaveDoc(d) { await rvPut("docs", d); }

/* ---- Lista och sökning -------------------------------------------------------------------------------------------------------------------- */
const rvNum = s => { const m = /(\d+)/g, a = []; let x; while ((x = m.exec(s))) a.push(Number(x[1])); return a; };
function rvCmp(a, b) { const k = rv.sort; if (k === "name") return a.name.localeCompare(b.name, "sv", { numeric: true }); if (k === "date") return b.added - a.added; if (k === "rev") return rvRevRank(b.rev) - rvRevRank(a.rev); return (a.no || a.name).localeCompare(b.no || b.name, "sv", { numeric: true }) || a.name.localeCompare(b.name, "sv", { numeric: true }); }
function rvSearch(q) {
  q = String(q || "").trim().toLowerCase(); rv.q = q; if (q.length < 2) { rv.hits = null; return; }
  const words = q.split(/\s+/).filter(Boolean), hits = [];
  rv.docs.forEach(d => {
    if (d.old && !rv.showOld) return; const head = (d.name + " " + d.no + " " + d.title + " " + d.disc + " " + d.rev).toLowerCase();
    const nameHit = words.every(w => head.includes(w)); const pages = [];
    (d.text || []).forEach((t, i) => { const low = t.toLowerCase(); if (words.every(w => low.includes(w))) { const at = low.indexOf(words[0]); pages.push({ p: i + 1, s: (t.slice(Math.max(0, at - 30), at + 70)) }); } });
    if (nameHit || pages.length) hits.push({ d, nameHit, pages: pages.slice(0, 5), n: pages.length });
  });
  rv.hits = hits;
}
async function rvMarksCount(docs) { const all = await rvAll("marks"); const m = new Map(); all.forEach(x => { const o = m.get(x.doc) || { n: 0, open: 0 }; o.n++; if (x.status === "open") o.open++; m.set(x.doc, o); }); rv.mc = m; }
function rvListHtml() {
  const docs = rv.docs.filter(d => rv.showOld || !d.old).filter(d => rv.filter === "fav" ? d.fav : rv.filter === "open" ? ((rv.mc && rv.mc.get(d.id)) || { open: 0 }).open > 0 : true);
  if (rv.hits) return rv.hits.length ? rv.hits.map(h => `<div class="rv-hit"><button class="rv-doc" data-open="${h.d.id}"><b>${rvEsc(h.d.no || h.d.name)}</b> ${rvEsc(h.d.title)}${h.d.rev ? ` <i class="rv-rev">rev ${rvEsc(h.d.rev)}</i>` : ""}</button>${h.pages.map(p => `<button class="rv-snip" data-open="${h.d.id}" data-page="${p.p}" data-hl="${rvEsc(rv.q)}"><u>s.${p.p}</u> ${rvEsc(p.s)}</button>`).join("")}${h.n > h.pages.length ? `<small>… ${h.n - h.pages.length} träffar till</small>` : ""}</div>`).join("") : `<p class="rv-empty">Inga träffar på "${rvEsc(rv.q)}".</p>`;
  if (!docs.length) return `<p class="rv-empty">${rv.docs.length ? "Inga ritningar att visa med det här filtret." : "Släpp PDF-filer (eller en hel mapp) här så sorteras de upp automatiskt."}</p>`;
  const favs = docs.filter(d => d.fav), recent = docs.filter(d => d.opened).sort((a, b) => b.opened - a.opened).slice(0, 4), by = new Map();
  docs.forEach(d => { const g = d.grp || d.disc || "Övrigt"; (by.get(g) || by.set(g, []).get(g)).push(d); });
  const row = d => { const mc = (rv.mc && rv.mc.get(d.id)) || null; return `<div class="rv-row${rv.open === d.id ? " on" : ""}${d.old ? " old" : ""}" data-doc="${d.id}"><button class="rv-doc" data-open="${d.id}" title="${rvEsc(d.name)}">${d.thumb ? `<img class="rv-th" src="${d.thumb}" alt="">` : `<span class="rv-th ph"></span>`}<span class="rv-t"><b>${rvEsc(d.no || d.name.replace(/\.pdf$/i, ""))}</b><small>${rvEsc(d.title || (d.no ? "" : ""))}</small></span></button>${d.rev ? `<span class="rv-rev" title="Revision">${rvEsc(d.rev)}</span>` : ""}${d.old ? `<span class="rv-badge old" title="Det finns en nyare revision">ersatt</span>` : d.revs > 1 ? `<span class="rv-badge new" title="${d.revs} revisioner finns">ny rev</span>` : ""}${mc && mc.n ? `<span class="rv-badge ${mc.open ? "open" : "ok"}" title="${mc.open} öppna av ${mc.n} markeringar">${mc.open || "✓"}</span>` : ""}<button class="rv-star${d.fav ? " on" : ""}" data-fav="${d.id}" title="Favorit (snabbåtkomst ute på bygget)" aria-label="Favorit">★</button><button class="rv-more" data-more="${d.id}" title="Fler val" aria-label="Fler val">⋯</button></div>`; };
  const order = [...by.keys()].sort((a, b) => (a === "Övrigt") - (b === "Övrigt") || a.localeCompare(b, "sv"));
  return (favs.length || recent.length ? `<div class="rv-grp"><div class="rv-gh">★ Snabbåtkomst</div>${[...favs, ...recent.filter(r => !r.fav)].map(row).join("")}</div>` : "") + order.map(g => { const list = by.get(g).sort(rvCmp), closed = rv.grpClosed.has(g); return `<div class="rv-grp"><button class="rv-gh" data-grp="${rvEsc(g)}">${closed ? "▸" : "▾"} ${rvEsc(g)} <em>${list.length}</em></button>${closed ? "" : list.map(row).join("")}</div>`; }).join("");
}
function rvHtml() {
  const pm = rv.pms.find(p => p.id === rv.pm), nOld = rv.docs.filter(d => d.old).length, tot = rv.docs.length;
  const mcOpen = rv.mc ? [...rv.mc.values()].reduce((a, x) => a + x.open, 0) : 0;
  return `<div class="rv-wrap${rv.open ? " has-doc" : ""}">
    <aside class="rv-side"><div class="rv-pmbar"><select id="rvPm" aria-label="PM">${rv.pms.map(p => `<option value="${p.id}"${p.id === rv.pm ? " selected" : ""}>${rvEsc(p.name)}</option>`).join("") || `<option value="">Inget PM än</option>`}</select><button id="rvNewPm" title="Nytt PM">＋</button>${pm ? `<button id="rvPmMore" title="Fler val för PM">⋯</button>` : ""}</div>
      <div class="rv-drop" id="rvDrop" tabindex="0"><b>Släpp PDF:er här</b><span>eller en hel mapp – <label class="rv-pick">välj filer<input type="file" id="rvFile" accept="application/pdf,.pdf" multiple hidden></label> · <label class="rv-pick">välj mapp<input type="file" id="rvDir" webkitdirectory hidden></label></span></div>
      ${rv.msg ? `<div class="rv-msg">${rvEsc(rv.msg)}${rv.indexing ? ` <span class="rv-spin"></span> läser sidor (${rv.queue.length} kvar)` : ""}</div>` : rv.indexing ? `<div class="rv-msg"><span class="rv-spin"></span> Läser sidor och söker rubriker (${rv.queue.length} kvar)</div>` : ""}
      <div class="rv-tools"><input type="search" id="rvQ" placeholder="Sök i filnamn, rubriker och texten i ritningarna …" value="${rvEsc(rv.q)}" aria-label="Sök"></div>
      <div class="rv-tools"><select id="rvSort" aria-label="Sortera"><option value="no"${rv.sort === "no" ? " selected" : ""}>Ritningsnr</option><option value="name"${rv.sort === "name" ? " selected" : ""}>Filnamn</option><option value="date"${rv.sort === "date" ? " selected" : ""}>Senast tillagd</option><option value="rev"${rv.sort === "rev" ? " selected" : ""}>Revision</option></select><select id="rvFilter" aria-label="Visa"><option value="all"${rv.filter === "all" ? " selected" : ""}>Alla</option><option value="fav"${rv.filter === "fav" ? " selected" : ""}>Favoriter</option><option value="open"${rv.filter === "open" ? " selected" : ""}>Med öppna markeringar</option></select>${nOld ? `<label class="rv-chk" title="Visa även ritningar som ersatts av en nyare revision"><input type="checkbox" id="rvOld"${rv.showOld ? " checked" : ""}> ersatta (${nOld})</label>` : ""}</div>
      <div class="rv-list" id="rvList">${rvListHtml()}</div>
      <div class="rv-foot">${tot} ritningar${rv.store ? ` · lagrat ${rv.store}` : ""}${mcOpen ? ` · <b>${mcOpen}</b> öppna markeringar` : ""} <button id="rvRep" title="Granskningsrapport (HTML) och markeringar som fil">Rapport / export …</button></div></aside>
    <section class="rv-main" id="rvMain">${rv.open ? "" : `<div class="rv-hello"><h3>${pm ? rvEsc(pm.name) : "Granskning"}</h3><p>Välj en ritning i listan för att öppna den. I visaren kan du markera, kommentera, mäta, söka i texten och jämföra revisioner. Allt sparas på den här enheten, så ritningarna fungerar även utan nät ute på bygget.</p><ul><li>Släpp alla PDF:er du fått i PM:et på ytan till vänster – de sorteras på disciplin, ritningsnummer och revision.</li><li>★ lägger en ritning under Snabbåtkomst.</li><li>Sökningen går i filnamn och i själva texten i PDF:erna.</li></ul></div>`}</section>
  </div>`;
}
let rvBind = false, rvPaintT = 0;
function rvRender(soft) {
  const box = document.getElementById("revBox"); if (!box) return;
  if (soft && rv.open && box.querySelector(".rv-view")) { const l = document.getElementById("rvList"); if (l) l.innerHTML = rvListHtml(); const f = box.querySelector(".rv-foot"); return; }
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
    rv.pm = rv.pms.find(p => p.id === want) ? want : (rv.pms[0] ? rv.pms[0].id : ""); rv.docs = rv.pm ? await rvAll("docs", "pm", rv.pm) : []; rvMarkOld(rv.docs); await rvMarksCount(); rv.ready = true;
    rv.queue = rv.docs.filter(d => d.text == null).map(d => d.id);
  } catch (e) { box.innerHTML = `<p class="rv-empty">Granskningen kan inte starta: ${rvEsc((e && e.message) || e)}</p>`; return; }
  if (!rvBind) {
    rvBind = true;
    box.addEventListener("click", rvClick); box.addEventListener("change", rvChange); box.addEventListener("input", e => { if (e.target.id === "rvQ") { rvSearch(e.target.value); const l = document.getElementById("rvList"); if (l) l.innerHTML = rvListHtml(); } });
    const over = e => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files")) { e.preventDefault(); box.classList.add("rv-over"); } };
    box.addEventListener("dragover", over); box.addEventListener("dragenter", over); box.addEventListener("dragleave", e => { if (!box.contains(e.relatedTarget)) box.classList.remove("rv-over"); });
    box.addEventListener("drop", async e => { e.preventDefault(); box.classList.remove("rv-over"); const files = await rvFilesFromDrop(e.dataTransfer); await rvImport(files); await rvMarksCount(); rvRender(); });
  }
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); if (e && e.usage != null) rv.store = (e.usage / 1048576 >= 1024 ? (e.usage / 1073741824).toFixed(1) + " GB" : Math.round(e.usage / 1048576) + " MB") + (e.quota ? " av " + (e.quota / 1073741824 >= 1 ? (e.quota / 1073741824).toFixed(0) + " GB" : Math.round(e.quota / 1048576) + " MB") : ""); } } catch (e) { /* */ }
  rvRender(); if (rv.queue.length) rvRunQueue();
}
async function rvClick(e) {
  const t = e.target, q = s => t.closest(s);
  if (q("#rvNewPm")) { await rvNewPm(); return; }
  if (q("#rvPmMore")) { rvPmMenu(q("#rvPmMore")); return; }
  const op = q("[data-open]"); if (op) { const d = op.dataset; rvOpenDoc(d.open, { page: d.page ? Number(d.page) : 1, hl: d.hl || "" }); return; }
  const fv = q("[data-fav]"); if (fv) { const d = rv.docs.find(x => x.id === fv.dataset.fav); if (d) { d.fav = !d.fav; await rvSaveDoc(d); rvRender(true); const l = document.getElementById("rvList"); if (l) l.innerHTML = rvListHtml(); } return; }
  const mo = q("[data-more]"); if (mo) { rvDocMenu(mo, mo.dataset.more); return; }
  const g = q("[data-grp]"); if (g) { const k = g.dataset.grp; if (rv.grpClosed.has(k)) rv.grpClosed.delete(k); else rv.grpClosed.add(k); try { localStorage.setItem("4ddash-review-closed", JSON.stringify([...rv.grpClosed])); } catch (x) { /* */ } document.getElementById("rvList").innerHTML = rvListHtml(); return; }
  if (q("#rvRep")) { if (typeof rvReportMenu === "function") rvReportMenu(q("#rvRep")); return; }
}
async function rvChange(e) {
  const t = e.target;
  if (t.id === "rvPm") { await rvSelectPm(t.value); await rvMarksCount(); rvRender(); }
  else if (t.id === "rvFile" || t.id === "rvDir") { const files = [...t.files].filter(rvIsPdf); t.value = ""; await rvImport(files); await rvMarksCount(); rvRender(); }
  else if (t.id === "rvSort") { rv.sort = t.value; document.getElementById("rvList").innerHTML = rvListHtml(); }
  else if (t.id === "rvFilter") { rv.filter = t.value; document.getElementById("rvList").innerHTML = rvListHtml(); }
  else if (t.id === "rvOld") { rv.showOld = t.checked; if (rv.q) rvSearch(rv.q); document.getElementById("rvList").innerHTML = rvListHtml(); }
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
function rvPmMenu(a) { rvMenu(a, [["Byt namn på PM …", async () => { const pm = rv.pms.find(p => p.id === rv.pm); const n = await (typeof dashPrompt === "function" ? dashPrompt("Nytt namn på PM", pm.name) : prompt("Nytt namn", pm.name)); if (n && n.trim()) { pm.name = n.trim(); await rvPut("pms", pm); rvRender(); } }], ["Ta bort PM …", rvDeletePm]]); }
function rvDocMenu(a, id) {
  const d = rv.docs.find(x => x.id === id); if (!d) return;
  const groups = [...new Set([...rv.docs.map(x => x.grp || x.disc), ...Object.values(RV_PREFIX), "Övrigt"])].filter(Boolean).sort((x, y) => x.localeCompare(y, "sv"));
  rvMenu(a, [["Öppna", () => rvOpenDoc(id, {})], ...groups.filter(g => g !== (d.grp || d.disc)).slice(0, 9).map(g => ["Flytta till: " + g, async () => { d.grp = g; await rvSaveDoc(d); rvRender(true); document.getElementById("rvList").innerHTML = rvListHtml(); }]), ["Flytta till egen grupp …", async () => { const n = await (typeof dashPrompt === "function" ? dashPrompt("Gruppnamn", d.grp || d.disc) : prompt("Gruppnamn", d.grp || d.disc)); if (n && n.trim()) { d.grp = n.trim(); await rvSaveDoc(d); document.getElementById("rvList").innerHTML = rvListHtml(); } }], ["Redigera ritningsnr/revision …", async () => { const n = await (typeof dashPrompt === "function" ? dashPrompt("Ritningsnummer och revision, t.ex. A-10-001 B", `${d.no} ${d.rev}`.trim()) : prompt("Ritningsnr rev", `${d.no} ${d.rev}`.trim())); if (n == null) return; const m = /^(.*?)(?:\s+([A-Za-z0-9]{1,3}))?$/.exec(String(n).trim()); d.no = (m[1] || "").toUpperCase(); d.rev = (m[2] || "").toUpperCase(); d.key = (d.no || d.title || d.name).toLowerCase().replace(/[^a-z0-9åäö]/g, ""); await rvSaveDoc(d); rvMarkOld(rv.docs); rvRender(true); document.getElementById("rvList").innerHTML = rvListHtml(); }], ["Ta bort ritningen …", async () => { if (await dashConfirm(`Ta bort ${d.name} och dess markeringar?`, { ok: "Ta bort" })) { await rvDeleteDoc(id); await rvMarksCount(); rvRender(); } }]]);
}
document.addEventListener("DOMContentLoaded", () => { rvInit(); });
if (document.readyState !== "loading") setTimeout(rvInit, 0);
