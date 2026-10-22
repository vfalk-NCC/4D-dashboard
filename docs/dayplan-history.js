/* Dagsplaner: historik, släpp mejlet och koppling till modellen (Victor 2026-10-22).
   - Släpp mejlet: .msg (Outlook), .eml, .txt, .html eller markerad text släpps på ytan (eller klistras in). Mejlet läses, raderna kopplas till aktiviteter
     och dagsplanen öppnas färdigifylld; "Spara" och "Exportera HTML" ger den snygga sidan. Flera mejl på en gång läses in som en lista (bra för att fylla
     historiken bakåt).
   - Historik: alla sparade dagsplaner i en lista och ett stapeldiagram över antal personer per dag, med filter. Varje dagsplan sparar sina tidigare
     versioner när den ändras (Versioner i dialogen).
   - Modell: varje rad kan kopplas till objekt i modellen (valfritt, kräver inte Trimble Connect). Via aktivitetens objekt eller egen markering; "Visa i modellen"
     isolerar dagens arbeten i Trimble Connect. */

/* ---- Läsa mejl ------------------------------------------------------------------------------------------------------------------------------------- */
const dpDec = (bytes, cs) => { try { return new TextDecoder(/^(us-ascii|ascii)$/i.test(cs || "") ? "utf-8" : (cs || "utf-8")).decode(bytes); } catch (e) { return new TextDecoder("utf-8").decode(bytes); } };
function dpHtmlToText(h) {
  let s = String(h || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<\s*li[^>]*>/gi, "\n* ").replace(/<\s*(br|\/p|\/div|\/tr|\/h\d|\/ul|\/ol|\/table)\s*\/?>/gi, "\n").replace(/<\s*(p|div|tr)[^>]*>/gi, "\n").replace(/<\/t[dh]>/gi, " ").replace(/<[^>]+>/g, "");
  s = s.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)));
  return s.replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
/* .eml: rubriker och MIME-delar (text/plain föredras, annars text/html), quoted-printable och base64. */
function dpParseEml(buf) {
  const u8 = new Uint8Array(buf), raw = new TextDecoder("latin1").decode(u8);
  const split = s => { const m = /\r?\n\r?\n/.exec(s); return m ? [s.slice(0, m.index), s.slice(m.index + m[0].length)] : [s, ""]; };
  const hdrs = h => { const o = {}; h.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).forEach(l => { const i = l.indexOf(":"); if (i > 0) o[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }); return o; };
  const decodeWords = s => String(s || "").replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (m, cs, enc, txt) => { try { const bytes = enc.toLowerCase() === "b" ? Uint8Array.from(atob(txt), c => c.charCodeAt(0)) : Uint8Array.from(txt.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), c => c.charCodeAt(0)); return dpDec(bytes, cs); } catch (e) { return m; } });
  const body = (head, text) => { const enc = (head["content-transfer-encoding"] || "").toLowerCase(), cs = (/charset="?([\w-]+)/i.exec(head["content-type"] || "") || [])[1]; let bytes;
    if (enc === "base64") { try { bytes = Uint8Array.from(atob(text.replace(/\s+/g, "")), c => c.charCodeAt(0)); } catch (e) { bytes = new TextEncoder().encode(text); } }
    else if (enc === "quoted-printable") { const s = text.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))); bytes = Uint8Array.from(s, c => c.charCodeAt(0) & 255); } else bytes = Uint8Array.from(text, c => c.charCodeAt(0) & 255);
    return dpDec(bytes, cs); };
  const walk = (head, text) => {
    const ct = head["content-type"] || "text/plain", mb = /boundary="?([^";\s]+)"?/i.exec(ct);
    if (/multipart/i.test(ct) && mb) { const parts = text.split("--" + mb[1]).slice(1).filter(x => !/^--/.test(x.trim())).map(x => split(x.replace(/^\r?\n/, ""))); let plain = "", html = ""; parts.forEach(([h, b]) => { const r = walk(hdrs(h), b); plain = plain || r.plain; html = html || r.html; }); return { plain, html }; }
    if (/text\/html/i.test(ct)) return { plain: "", html: body(head, text) }; if (/text\/plain/i.test(ct) || !/\//.test(ct)) return { plain: body(head, text), html: "" }; return { plain: "", html: "" };
  };
  const [h0, b0] = split(raw), head = hdrs(h0), r = walk(head, b0);
  return { subject: decodeWords(head.subject || ""), date: head.date || "", from: decodeWords(head.from || ""), text: (r.plain || dpHtmlToText(r.html) || "").replace(/\r/g, "").trim() };
}
/* .msg (Outlook): sammansatt fil (CFB). Brödtexten ligger i strömmarna __substg1.0_1000001F (Unicode), _1000001E (ANSI) eller _10130102 (HTML). */
function dpParseMsg(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  if (u8.length < 512 || dv.getUint32(0, true) !== 0xE011CFD0 || dv.getUint32(4, true) !== 0xE11AB1A1) throw new Error("Inte en .msg-fil");
  const ss = 1 << dv.getUint16(0x1E, true), mss = 1 << dv.getUint16(0x20, true), cutoff = dv.getUint32(0x38, true), nFat = dv.getUint32(0x2C, true), dirStart = dv.getUint32(0x30, true), mfStart = dv.getUint32(0x3C, true), difStart = dv.getUint32(0x44, true), nDif = dv.getUint32(0x48, true);
  const off = n => (n + 1) * ss, END = 0xFFFFFFFE, FREE = 0xFFFFFFFF;
  const sect = n => u8.subarray(off(n), off(n) + ss);
  const fatSecs = []; for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const s = dv.getUint32(0x4C + i * 4, true); if (s !== FREE) fatSecs.push(s); }
  let d = difStart; for (let k = 0; k < nDif && d < 0xFFFFFFFA; k++) { const dd = new DataView(buf, off(d), ss); for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) { const s = dd.getUint32(i * 4, true); if (s !== FREE) fatSecs.push(s); } d = dd.getUint32(ss - 4, true); }
  const fat = []; fatSecs.forEach(s => { const f = new DataView(buf, off(s), ss); for (let i = 0; i < ss / 4; i++) fat.push(f.getUint32(i * 4, true)); });
  const chain = (start, table) => { const out = []; let s = start, guard = 0; while (s < 0xFFFFFFFA && guard++ < 1e6) { out.push(s); s = table[s]; } return out; };
  const readChain = (start, size) => { const ch = chain(start, fat), out = new Uint8Array(ch.length * ss); ch.forEach((s, i) => out.set(sect(s), i * ss)); return size != null ? out.subarray(0, size) : out; };
  const mfat = []; if (mfStart < 0xFFFFFFFA) { const m = readChain(mfStart), mv = new DataView(m.buffer, m.byteOffset, m.byteLength); for (let i = 0; i < m.length / 4; i++) mfat.push(mv.getUint32(i * 4, true)); }
  const dir = readChain(dirStart), dd = new DataView(dir.buffer, dir.byteOffset, dir.byteLength), ents = [];
  for (let i = 0; i < dir.length / 128; i++) { const o = i * 128, nl = dd.getUint16(o + 64, true); let name = ""; for (let k = 0; k < Math.max(0, nl / 2 - 1); k++) name += String.fromCharCode(dd.getUint16(o + k * 2, true)); ents.push({ i, name, type: dir[o + 66], left: dd.getUint32(o + 68, true), right: dd.getUint32(o + 72, true), child: dd.getUint32(o + 76, true), start: dd.getUint32(o + 116, true), size: dd.getUint32(o + 120, true) }); }
  const root = ents[0], mini = readChain(root.start, root.size);
  const stream = e => { if (e.size < cutoff) { const ch = chain(e.start, mfat), out = new Uint8Array(ch.length * mss); ch.forEach((s, i) => out.set(mini.subarray(s * mss, s * mss + mss), i * mss)); return out.subarray(0, e.size); } return readChain(e.start, e.size); };
  const kids = []; const walk = id => { if (id >= ents.length || id === FREE) return; const e = ents[id]; walk(e.left); kids.push(e); walk(e.right); }; walk(root.child);
  const get = n => kids.find(e => e.type === 2 && e.name.toLowerCase() === n.toLowerCase());
  const uni = n => { const e = get(n); return e ? new TextDecoder("utf-16le").decode(stream(e)) : ""; }, ans = n => { const e = get(n); return e ? new TextDecoder("windows-1252").decode(stream(e)) : ""; };
  let text = uni("__substg1.0_1000001F") || ans("__substg1.0_1000001E"); if (!text.trim()) { const h = get("__substg1.0_10130102"); if (h) text = dpHtmlToText(new TextDecoder("utf-8").decode(stream(h))); }
  return { subject: uni("__substg1.0_0037001F") || ans("__substg1.0_0037001E"), from: uni("__substg1.0_0C1A001F") || ans("__substg1.0_0C1A001E"), date: "", text: text.replace(/\r/g, "").trim() };
}
/* En släppt fil eller text -> { name, text } */
async function dpReadFile(f) {
  const nm = f.name || "", buf = await f.arrayBuffer();
  if (/\.msg$/i.test(nm)) { const m = dpParseMsg(buf); return { name: m.subject || nm, text: m.text, subject: m.subject }; }
  if (/\.eml$/i.test(nm) || /message\/rfc822/i.test(f.type || "")) { const m = dpParseEml(buf); return { name: m.subject || nm, text: m.text, subject: m.subject }; }
  const txt = new TextDecoder("utf-8").decode(new Uint8Array(buf));
  if (/\.html?$/i.test(nm) || /^\s*<(!doctype|html)/i.test(txt)) return { name: nm, text: dpHtmlToText(txt) };
  return { name: nm, text: txt.replace(/\r/g, "").trim() };
}
async function dpReadDrop(dt) {
  const out = [], files = [...(dt.files || [])].filter(f => /\.(msg|eml|txt|html?|text)$/i.test(f.name || "") || /^(text\/|message\/)/.test(f.type || ""));
  for (const f of files) { try { const r = await dpReadFile(f); if (r.text) out.push(r); } catch (e) { console.warn("Dagsplan: kunde inte läsa", f.name, e); if (typeof modelToast === "function") modelToast(`Kunde inte läsa ${f.name}${/\.msg$/i.test(f.name) ? " – spara mejlet som .eml eller markera texten och släpp/klistra in den" : ""}`); } }
  if (!out.length && !files.length) { const html = dt.getData && dt.getData("text/html"), tx = dt.getData && dt.getData("text/plain"); const t = (tx && tx.trim()) || (html ? dpHtmlToText(html) : ""); if (t) out.push({ name: "", text: t }); }
  return out;
}

/* ---- Från text till dagsplan ---------------------------------------------------------------------------------------------------------------- */
function dpFromText(text, name) {
  const p = dpParse(text); if (!p.tasks.length) return null;
  const rec = { id: ghNewId(), date: p.date || addDaysIso(typeof todayISO === "function" ? todayISO() : new Date().toISOString().slice(0, 10), 1), company: p.company, total: p.total, extras: p.extras, source: text, source_name: name || "", tasks: [] };
  const cands = dpCandidates(rec.date);
  rec.tasks = p.tasks.map(t => { const sg = dpSuggest(t.text, rec.date, cands); return { ...t, key: sg ? dpKeyOf(sg.act) : null, label: sg ? itemLabel(sg.act) : "", src: sg ? sg.src : null }; });
  return rec;
}
async function dpIngest(items) {
  await dpLoad(); const recs = items.map(i => dpFromText(i.text, i.name)).filter(Boolean);
  if (!recs.length) { if (typeof modelToast === "function") modelToast("Hittade inga rader – raderna ska börja med * eller - och sluta med antal personer"); return; }
  if (recs.length === 1) { dpOpen({ rec: recs[0] }); return; }
  dpBulkDialog(recs);
}
function dpBulkDialog(recs) {
  const host = typeof overlayHost === "function" ? overlayHost() : document.body, esc = escapeHtml, d = document.createElement("div"); d.className = "dp-dlg";
  const sameOf = r => dayplans.find(p => p.date === r.date && (p.company || "") === (r.company || ""));
  d.innerHTML = `<div class="dp-box"><div class="dp-h"><b>${recs.length} mejl inlästa</b><span class="dp-sp"></span><button type="button" class="dp-x" aria-label="Stäng">✕</button></div><div class="dp-body"><p class="hint">Raderna är kopplade till aktiviteter där det gick. Bocka bort det du inte vill spara. Finns redan en dagsplan för samma dag och företag blir den gamla en version i historiken.</p>
    <table class="dp-t"><thead><tr><th></th><th>Datum</th><th>Företag</th><th>Rader</th><th>Kopplade</th><th>Pers.</th><th>Från</th></tr></thead><tbody>${recs.map((r, i) => { const n = r.tasks.reduce((a, t) => a + (Number(t.workers) || 0), 0), k = r.tasks.filter(t => t.key).length; return `<tr><td><input type="checkbox" data-i="${i}" checked></td><td>${esc(r.date)}</td><td>${esc(r.company || "–")}</td><td>${r.tasks.length}</td><td>${k}/${r.tasks.length}</td><td>${r.total ?? n}</td><td>${esc((r.source_name || "").slice(0, 40))}${sameOf(r) ? ` <em class="hint">ersätter ${esc(sameOf(r).date)}</em>` : ""}</td></tr>`; }).join("")}</tbody></table></div>
    <div class="dp-foot"><span class="dp-sp"></span><button type="button" class="dp-cancel">Avbryt</button><button type="button" class="dp-ok primary">Spara valda</button></div></div>`;
  host.appendChild(d); const close = () => d.remove(); d.querySelector(".dp-x").onclick = close; d.querySelector(".dp-cancel").onclick = close;
  d.querySelector(".dp-ok").onclick = async () => {
    const btn = d.querySelector(".dp-ok"); btn.disabled = true; let n = 0;
    try { for (const cb of d.querySelectorAll("input[data-i]:checked")) { const r = recs[Number(cb.dataset.i)], same = sameOf(r); if (same) { r.id = same.id; r.history = same.history || []; r.created_at = same.created_at; } r.updated_at = new Date().toISOString(); r.updated_by = settings.userName || null; await dpSave(r); n++; } if (typeof renderAll === "function") renderAll(); if (typeof modelToast === "function") modelToast(`${n} dagsplaner sparade`); close(); }
    catch (e) { alert("Kunde inte spara: " + e.message); btn.disabled = false; }
  };
}

/* ---- Koppling till modellen (valfri) ----------------------------------------------------------------------------------------------------------- */
const dpHasModel = () => !!(typeof API !== "undefined" && API && API.viewer);
function dpActObjs(t) { const a = t.key ? mergeActivityGroups(items.filter(x => x.startDate)).find(x => dpKeyOf(x) === String(t.key)) : null; return a ? (a.members || [a]).filter(m => m.modelId && m.objectId).map(m => ({ modelId: m.modelId, objectId: String(m.objectId) })) : []; }
function dpObjCount(t) { const own = (t.objs || []).length, act = dpActObjs(t).length; return { own, act, all: new Set([...(t.objs || []), ...dpActObjs(t)].map(o => o.modelId + "|" + o.objectId)).size }; }
function dpObjBtn(t) { const c = dpObjCount(t), tt = c.own ? `${c.own} egna objekt kopplade${c.act ? ` + ${c.act} via aktiviteten` : ""}` : c.act ? `${c.act} objekt via aktiviteten – klicka för att koppla egna` : "Koppla till objekt i modellen (markera i Trimble Connect först). Valfritt."; return `<button type="button" class="dp-obj${c.own ? " own" : c.act ? " act" : ""}" title="${escapeHtml(tt)}">🧊${c.all ? " " + c.all : ""}</button>`; }
function dpMenu(anchor, items) {
  document.querySelectorAll(".dp-menu").forEach(m => m.remove()); const m = document.createElement("div"); m.className = "dp-menu"; m.innerHTML = items.map((x, i) => `<button type="button" data-mi="${i}"${x[2] ? " disabled" : ""}>${escapeHtml(x[0])}</button>`).join("");
  (typeof overlayHost === "function" ? overlayHost() : document.body).appendChild(m); const r = anchor.getBoundingClientRect(); m.style.left = Math.max(6, Math.min(innerWidth - 250, r.left - 120)) + "px"; m.style.top = Math.min(innerHeight - m.offsetHeight - 8, r.bottom + 4) + "px";
  const off = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("pointerdown", off, true); } }; m.onclick = async e => { const b = e.target.closest("[data-mi]"); if (!b) return; m.remove(); document.removeEventListener("pointerdown", off, true); await items[Number(b.dataset.mi)][1](); }; setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
}
async function dpSelectionObjs() {
  const V = API && API.viewer; if (!V || typeof V.getSelection !== "function") throw new Error("Trimble Connect är inte ansluten");
  const sel = (await V.getSelection()) || [], objs = [];
  for (const m of sel) { const rids = m.objectRuntimeIds || []; if (!rids.length) continue; const ids = await V.convertToObjectIds(m.modelId, rids); ids.forEach(id => { if (id) objs.push({ modelId: m.modelId, objectId: String(id) }); }); }
  return objs;
}
function dpObjMenu(btn, t, rerender, rec) {
  const c = dpObjCount(t), model = dpHasModel();
  dpMenu(btn, [["Koppla markeringen i modellen till raden", async () => { try { const o = await dpSelectionObjs(); if (!o.length) { modelToast("Markera objekt i modellen först"); return; } t.objs = o; rerender(); modelToast(`${o.length} objekt kopplade till raden`); } catch (e) { modelToast("Kunde inte läsa markeringen: " + ((e && e.message) || e)); } }, !model],
    ["Lägg till markeringen", async () => { try { const o = await dpSelectionObjs(); if (!o.length) { modelToast("Markera objekt i modellen först"); return; } const have = new Set((t.objs || []).map(x => x.modelId + "|" + x.objectId)); t.objs = [...(t.objs || []), ...o.filter(x => !have.has(x.modelId + "|" + x.objectId))]; rerender(); } catch (e) { modelToast("Kunde inte läsa markeringen"); } }, !model || !c.own],
    ["Visa raden i modellen", () => dpModelShow({ ...rec, tasks: [t] }), !model || !c.all], ["Ta bort egna kopplingar", () => { t.objs = []; rerender(); }, !c.own]]);
}
async function dpModelShow(rec) {
  if (!dpHasModel()) { modelToast("Kopplingen till modellen kräver Trimble Connect – den här funktionen är valfri"); return; }
  if (typeof modelCtl !== "undefined" && !modelCtl.on) { modelToast("Slå på 3D-styrningen i sidhuvudet först (den är av som standard)"); return; }
  const V = API.viewer, byModel = new Map(); (rec.tasks || []).forEach(t => [...(t.objs || []), ...dpActObjs(t)].forEach(o => (byModel.get(o.modelId) || byModel.set(o.modelId, new Set()).get(o.modelId)).add(o.objectId)));
  if (!byModel.size) { modelToast("Inga objekt är kopplade till dagens rader – koppla via aktiviteten eller med 🧊 på raden"); return; }
  try {
    const ents = [], mo = [];
    for (const [modelId, ids] of byModel) { const r = await dashRuntimeIds(V, modelId, [...ids]); if (r.modelFailed) continue; const rids = [...r.map.values()].filter(x => x !== null && x !== undefined); if (rids.length) { ents.push({ modelId, entityIds: rids }); mo.push({ modelId, objectRuntimeIds: rids }); } }
    if (!ents.length) { modelToast("Objekten finns inte i de tända modellerna"); return; }
    await V.isolateEntities(ents); try { await V.setObjectState(undefined, { color: "reset" }); } catch (e) { /* */ } await V.setObjectState({ modelObjectIds: mo }, { color: { r: 245, g: 158, b: 11, a: 255 } });
    try { await V.setCamera({ modelObjectIds: mo }); } catch (e) { /* utan kamera */ }
    if (typeof modelCtl !== "undefined") modelCtl.touched = true; modelToast(`${ents.reduce((a, e) => a + e.entityIds.length, 0)} objekt för dagens arbeten visas – stäng av 3D-styrningen för att återställa modellen`);
  } catch (e) { modelToast("Kunde inte visa i modellen: " + ((e && (e.message || e.error)) || e)); }
}

/* ---- Historik: lista, diagram och filter -------------------------------------------------------------------------------------------------- */
const dph = { period: "30", company: "", q: "", open: new Set() };
const dpWd = iso => ["sön", "mån", "tis", "ons", "tor", "fre", "lör"][new Date(iso + "T00:00:00").getDay()];
const dpTot = r => (r.total != null && r.total !== "" ? Number(r.total) : r.tasks.reduce((a, t) => a + (Number(t.workers) || 0), 0));
function dpHistRows() {
  const today = typeof todayISO === "function" ? todayISO() : new Date().toISOString().slice(0, 10), from = dph.period === "all" ? "" : addDaysIso(today, -Number(dph.period)), q = dph.q.trim().toLowerCase();
  return dayplans.filter(r => (!from || r.date >= from) && (!dph.company || (r.company || "") === dph.company) && (!q || (r.company + " " + r.date + " " + r.tasks.map(t => t.text + " " + t.label).join(" ")).toLowerCase().includes(q))).sort((a, b) => b.date.localeCompare(a.date) || (a.company || "").localeCompare(b.company || ""));
}
function dpChartSvg(rows) {
  if (!rows.length) return ""; const by = new Map(); rows.forEach(r => by.set(r.date, (by.get(r.date) || 0) + dpTot(r)));
  const days = [...by.keys()].sort(), max = Math.max(1, ...by.values()), W = Math.max(320, Math.min(1100, days.length * 26 + 40)), H = 120, bw = Math.max(6, Math.min(22, (W - 40) / days.length - 4));
  const bars = days.map((d, i) => { const v = by.get(d), h = Math.round(v / max * (H - 34)), x = 30 + i * ((W - 40) / days.length); return `<g data-d="${d}" class="dph-b"><rect x="${x}" y="${H - 18 - h}" width="${bw}" height="${h}" rx="3"><title>${d} ${dpWd(d)}: ${v} personer</title></rect><text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${d.slice(8)}</text>${days.length <= 18 ? `<text x="${x + bw / 2}" y="${H - 21 - h}" text-anchor="middle" class="v">${v}</text>` : ""}</g>`; }).join("");
  return `<svg class="dph-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Personer per dag"><line x1="28" y1="${H - 18}" x2="${W - 6}" y2="${H - 18}" stroke="currentColor" opacity=".25"/>${bars}</svg>`;
}
function dpRenderHistory() {
  const box = document.getElementById("dpBox"); if (!box) return;
  const esc = escapeHtml, rows = dpHistRows(), companies = [...new Set(dayplans.map(r => r.company || "").filter(Boolean))].sort();
  const active = document.activeElement && document.activeElement.id === "dphQ";
  box.innerHTML = `<div class="dph-drop" id="dphDrop" tabindex="0"><b>Släpp mejlet med dagsplanen här</b><span>.msg (Outlook), .eml, .txt, .html eller markerad text – flera mejl på en gång fyller historiken bakåt. Du kan också klistra in med Ctrl+V.</span><span class="dph-btns"><label class="dph-pick">välj filer<input type="file" id="dphFile" accept=".msg,.eml,.txt,.html,.htm,message/rfc822,text/plain" multiple hidden></label><button type="button" id="dphPaste">Klistra in från urklipp</button><button type="button" id="dphNew">Ny dagsplan</button></span></div>
    <div class="dph-bar"><label>Period <select id="dphPeriod">${[["14", "14 dagar"], ["30", "30 dagar"], ["90", "90 dagar"], ["365", "1 år"], ["all", "Alla"]].map(([v, l]) => `<option value="${v}"${dph.period === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>${companies.length > 1 ? `<label>Företag <select id="dphCo"><option value="">Alla</option>${companies.map(c => `<option${dph.company === c ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>` : ""}<input type="search" id="dphQ" placeholder="Sök i arbeten och aktiviteter …" value="${esc(dph.q)}"><span class="dph-sp"></span><span class="hint">${rows.length} av ${dayplans.length} dagsplaner</span><button type="button" id="dphCsv"${rows.length ? "" : " disabled"}>Exportera CSV</button></div>
    ${dpChartSvg(rows)}
    <div class="dph-list">${rows.map(r => { const k = r.tasks.filter(t => t.key).length, o = r.tasks.reduce((a, t) => a + dpObjCount(t).all, 0), open = dph.open.has(r.id); return `<div class="dph-row${open ? " open" : ""}" data-id="${esc(r.id)}"><button class="dph-h" data-tog="${esc(r.id)}"><span class="dph-d"><b>${esc(r.date)}</b> <small>${dpWd(r.date)}</small></span><span class="dph-c">${esc(r.company || "–")}</span><span class="dph-n"><b>${dpTot(r)}</b> pers.</span><span class="dph-t">${r.tasks.length} arbeten</span><span class="dph-k" title="Rader kopplade till aktiviteter i schemat">${k}/${r.tasks.length} kopplade</span>${o ? `<span class="dph-o" title="Objekt kopplade till modellen">🧊 ${o}</span>` : ""}${(r.history || []).length ? `<span class="dph-v" title="Antal tidigare versioner">v${r.history.length + 1}</span>` : ""}</button>
      ${open ? `<div class="dph-x"><table class="dp-t"><thead><tr><th>Arbete</th><th>Pers.</th><th>Aktivitet</th><th>Modell</th></tr></thead><tbody>${r.tasks.map(t => `<tr><td>${esc(t.text)}</td><td>${Number(t.workers) || 0}</td><td>${esc(t.label || "–")}</td><td>${dpObjCount(t).all ? "🧊 " + dpObjCount(t).all : ""}</td></tr>`).join("")}</tbody></table><div class="dph-act"><button data-open="${esc(r.id)}" class="primary">Öppna</button><button data-html="${esc(r.id)}">Exportera HTML</button><button data-copy="${esc(r.id)}">Kopiera text</button><button data-model="${esc(r.id)}"${dpHasModel() ? "" : " disabled title=\"Kräver Trimble Connect\""}>🧊 Visa i modellen</button>${r.source_name ? `<span class="hint">från: ${esc(r.source_name)}</span>` : ""}<span class="dph-sp"></span><button data-del="${esc(r.id)}" class="danger">Ta bort</button></div></div>` : ""}</div>`; }).join("") || `<p class="hint">${dayplans.length ? "Inga dagsplaner med det här filtret." : "Inga dagsplaner sparade än. Släpp ett mejl här ovanför så skapas historiken."}</p>`}</div>`;
  if (active) { const q = document.getElementById("dphQ"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
}
function dpHistCsv() {
  const rows = dpHistRows(), q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"', lines = [["Datum", "Veckodag", "Företag", "Totalt personer", "Arbete", "Personer", "Aktivitet", "Objekt i modellen", "Version"]];
  rows.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(r => r.tasks.forEach(t => lines.push([r.date, dpWd(r.date), r.company || "", dpTot(r), t.text, t.workers, t.label || "", dpObjCount(t).all, (r.history || []).length + 1])));
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + lines.map(l => l.map(q).join(";")).join("\n")], { type: "text/csv;charset=utf-8" })); a.download = `dagsplaner_historik_${typeof todayISO === "function" ? todayISO() : ""}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
(function () {
  const box = document.getElementById("dpBox"); if (!box) return;
  box.addEventListener("click", async e => {
    const t = e.target, tog = t.closest("[data-tog]"); if (tog) { const id = tog.dataset.tog; if (dph.open.has(id)) dph.open.delete(id); else dph.open.add(id); dpRenderHistory(); return; }
    const rec = id => dayplans.find(r => r.id === id), op = t.closest("[data-open]"); if (op) { dpOpen({ rec: rec(op.dataset.open) }); return; }
    const ht = t.closest("[data-html]"); if (ht) { dpExportHtml(rec(ht.dataset.html)); return; }
    const cp = t.closest("[data-copy]"); if (cp) { const tx = dpText(rec(cp.dataset.copy)); try { await navigator.clipboard.writeText(tx); modelToast("Dagsplanen kopierad"); } catch (x) { prompt("Kopiera:", tx); } return; }
    const md = t.closest("[data-model]"); if (md) { dpModelShow(rec(md.dataset.model)); return; }
    const dl = t.closest("[data-del]"); if (dl) { const r = rec(dl.dataset.del); if (r && await dashConfirm(`Ta bort dagsplanen för ${r.date}${r.company ? " (" + r.company + ")" : ""} och dess ${(r.history || []).length} tidigare versioner?`, { danger: true, ok: "Ta bort" })) { try { await dpDelete(r.id); if (typeof renderAll === "function") renderAll(); } catch (x) { alert("Kunde inte ta bort: " + x.message); } } return; }
    if (t.closest("#dphNew")) { dpOpen(); return; } if (t.closest("#dphCsv")) { dpHistCsv(); return; }
    if (t.closest("#dphPaste")) { try { const tx = await navigator.clipboard.readText(); if (tx && tx.trim()) await dpIngest([{ name: "Urklipp", text: tx }]); else modelToast("Urklippet är tomt"); } catch (x) { modelToast("Kunde inte läsa urklippet – markera i rutan och tryck Ctrl+V i stället"); } return; }
    const bar = t.closest(".dph-b[data-d]"); if (bar) { const r = dayplans.find(x => x.date === bar.dataset.d); if (r) { dph.open.add(r.id); dpRenderHistory(); const el = box.querySelector(`[data-id="${r.id}"]`); if (el) el.scrollIntoView({ block: "nearest" }); } }
  });
  box.addEventListener("change", async e => { const t = e.target; if (t.id === "dphPeriod") { dph.period = t.value; dpRenderHistory(); } else if (t.id === "dphCo") { dph.company = t.value; dpRenderHistory(); } else if (t.id === "dphFile") { const files = [...t.files]; t.value = ""; const items2 = []; for (const f of files) { try { const r = await dpReadFile(f); if (r.text) items2.push(r); } catch (x) { modelToast(`Kunde inte läsa ${f.name}${/\.msg$/i.test(f.name) ? " – spara mejlet som .eml eller klistra in texten" : ""}`); } } if (items2.length) await dpIngest(items2); } });
  box.addEventListener("input", e => { if (e.target.id === "dphQ") { dph.q = e.target.value; dpRenderHistory(); } });
  const over = e => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].some(x => x === "Files" || x === "text/plain" || x === "text/html")) { e.preventDefault(); box.classList.add("dph-over"); } };
  box.addEventListener("dragover", over); box.addEventListener("dragenter", over); box.addEventListener("dragleave", e => { if (!box.contains(e.relatedTarget)) box.classList.remove("dph-over"); });
  box.addEventListener("drop", async e => { e.preventDefault(); box.classList.remove("dph-over"); const m = await dpReadDrop(e.dataTransfer); if (m.length) await dpIngest(m); else modelToast("Hittade inget mejl eller ingen text att läsa in"); });
  document.addEventListener("paste", e => { const p = document.querySelector('.panel[data-panel-id="dayplans"]'); if (!p || !p.matches(":hover, :focus-within") || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || document.querySelector(".dp-dlg")) return; const tx = e.clipboardData && e.clipboardData.getData("text/plain"); if (tx && tx.trim().length > 20) { e.preventDefault(); dpIngest([{ name: "Urklipp", text: tx }]); } });
  dpRenderHistory(); setTimeout(() => { if (typeof isBackendConfigured === "function" && isBackendConfigured()) dpLoad().catch(() => {}); }, 1200);
})();
