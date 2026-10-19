/* Mängdtabeller på fotot (Victor 2026-10): en tabell per område/byggnad med AMA-koder och mängder, flyttbar i bildredigeraren.
   Siffrorna kommer ur mängdavtagningen (alla inlästa objekt) eller bara ur det som är markerat i TC – samma beräkning som matrisen (xlCompute).
   Tabellen räknas om vid varje ritning från qty, så "Läs in mängder" uppdaterar den. Ritas på skärmen och som vektorstämpel i PDF:en. */
const PHB_QT_COLS = [["tot", "Modell"], ["klar", "Klart"], ["kvar", "Kvar"], ["k", "Kontrakt"], ["pr", "Prognos"]];
const phbQtObjKeys = o => [`${o.modelId}|${o.objectId}`, `${o.modelId}|r${o.rid}`].filter(k => !/\|(r?undefined|r?)$/.test(k));
function phbQtObjs(t) {
  if (typeof qty === "undefined" || !qty.objs || !qty.objs.length) return [];
  if (t.src !== "sel") return qty.objs;
  const set = new Set(t.keys || []); return qty.objs.filter(o => phbQtObjKeys(o).some(k => set.has(k)));
}
/* Områden (matrisens kolumner) som har mängder för ett urval. */
function phbQtAreas(objs) {
  if (!objs.length || typeof xlCompute !== "function") return [];
  const M = xlCompute(objs), has = new Set(); M.cells.forEach(m => m.forEach((c, b) => has.add(b)));
  return M.cols.filter(b => has.has(b));
}
function phbQtVal(M, p, b, mode, src) {
  if (src === "sel" && (mode === "k" || mode === "pr")) return null;
  if (mode === "kvar") { const c = (M.cells.get(p.key) || new Map()).get(b) || { tot: 0, klar: 0 }; return src === "sel" ? c.tot - c.klar : xlVal(M, p, b, "kvar"); }
  return xlVal(M, p, b, mode);
}
function phbQtData(t) {
  const objs = phbQtObjs(t); if (!objs.length) return { rows: [], msg: typeof qty !== "undefined" && qty.objs && qty.objs.length ? "Inga av de markerade finns bland de inlästa mängderna" : "Mängder är inte inlästa" };
  const M = xlCompute(objs), posts = new Map(qmfAllPosts().map(p => [p.key, p])), ord = new Map(); (qmf.layout || []).forEach((e, i) => { if (e.p) ord.set(e.p, i); });
  const rows = [];
  posts.forEach(p => {
    const vals = t.cols.map(m => phbQtVal(M, p, t.area, m, t.src)); if (!vals.some(v => v)) return;
    rows.push({ p, vals });
  });
  rows.sort((a, b) => (ord.has(a.p.key) ? ord.get(a.p.key) : 1e6) - (ord.has(b.p.key) ? ord.get(b.p.key) : 1e6) || String(a.p.ref).localeCompare(String(b.p.ref), "sv", { numeric: true }));
  return { rows, msg: rows.length ? "" : "Inga mängder i området" };
}
const phbQtColLab = m => (PHB_QT_COLS.find(c => c[0] === m) || [0, m])[1];

/* ---- Mått och ritning ------------------------------------------------------------------------------------------------------------------------ */
function phbQtMeasure(t, st) {
  const ctx = phbMeasure(), kk = st.k * st.g.bscale * t.scale, pad = 10 * kk, gap = 8 * kk, dec = t.dec == null ? 1 : t.dec;
  t.kk = kk; const D = phbQtData(t), max = Math.max(1, t.max || 12), shown = D.rows.slice(0, max), more = D.rows.length - shown.length;
  const fm = v => v === null ? "" : v ? v.toLocaleString("sv-SE", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "–";
  const fR = `${11.5 * kk}px ${PHB_FAM}`, fB = `700 ${10.5 * kk}px ${PHB_FAM}`, fT = `700 ${14 * kk}px ${PHB_FAM}`;
  const wid = (font, txt) => { ctx.font = font; return ctx.measureText(txt).width; };
  const refW = Math.min(80 * kk, Math.max(...shown.map(r => wid(fR, String(r.p.ref))), 0)), uW = shown.length ? Math.max(wid(fB, "Enhet"), ...shown.map(r => wid(fR, String(r.p.unit || "")))) : 0, labW = 150 * kk;
  const vW = t.cols.map((m, i) => Math.max(wid(fB, phbQtColLab(m)), ...shown.map(r => wid(fR, fm(r.vals[i])))) + 2 * kk);
  const cells = []; let y = 8 * kk;
  ctx.font = fT; const title = phbWrap(ctx, t.title || t.area, 270 * kk, 2); title.forEach(l => { cells.push({ x: pad + 4 * kk, y, s: l, font: fT, col: "#111827" }); y += 17 * kk; });
  y += 3 * kk;
  const x0 = pad + 4 * kk, xl = x0 + refW + (refW ? gap : 0), xu = xl + labW + gap, xv0 = xu + uW + (uW ? gap : 0); let xs = [], xr = xv0; vW.forEach(w => { xr += w; xs.push(xr); xr += gap; });
  const W = Math.max(xr - gap + pad, 150 * kk);
  if (shown.length) { cells.push({ x: xl, y, s: "Benämning", font: fB, col: "#6b7280" }); if (uW) cells.push({ x: xu, y, s: "Enhet", font: fB, col: "#6b7280" });
    t.cols.forEach((m, i) => { const l = phbQtColLab(m); cells.push({ x: xs[i] - wid(fB, l), y, s: l, font: fB, col: "#6b7280" }); }); y += 15 * kk; }
  const trunc = (txt, w, font) => { let s = String(txt); if (wid(font, s) <= w) return s; while (s.length > 1 && wid(font, s + "…") > w) s = s.slice(0, -1); return s.replace(/\s+$/, "") + "…"; };
  const lines = [];
  shown.forEach(r => { lines.push({ y: y - 2 * kk });
    cells.push({ x: x0, y, s: String(r.p.ref), font: fR, col: "#111827" });
    cells.push({ x: xl, y, s: trunc(String(r.p.label).split("|")[0].trim(), labW, fR), font: fR, col: "#374151" });
    if (uW) cells.push({ x: xu, y, s: trunc(r.p.unit || "", uW, fR), font: fR, col: "#6b7280" });
    r.vals.forEach((v, i) => { const s = fm(v); if (s) cells.push({ x: xs[i] - wid(fR, s), y, s, font: fR, col: "#111827" }); }); y += 15.5 * kk; });
  if (more > 0) { cells.push({ x: xl, y, s: `+ ${more} rader till`, font: `italic ${11 * kk}px ${PHB_FAM}`, col: "#6b7280" }); y += 15 * kk; }
  if (D.msg) { cells.push({ x: x0, y, s: D.msg, font: `italic ${11 * kk}px ${PHB_FAM}`, col: "#6b7280" }); y += 15 * kk; }
  t.W = W; t.h = y + 8 * kk; t.cells = cells; t.lines = lines; t.n = D.rows.length;
  if (t.x === undefined || !isFinite(t.x)) { t.x = 20 * st.k; t.y = 20 * st.k; }
}
const phbQtMeasureAll = st => (st.tables || []).forEach(t => phbQtMeasure(t, st));
const phbQtCol = t => t.col || "#2563eb";
function phbQtDraw(ctx, t) {
  const kk = t.kk, { x, y } = t;
  ctx.save(); ctx.shadowColor = "rgba(15,23,42,.28)"; ctx.shadowBlur = 14 * kk; ctx.shadowOffsetY = 3 * kk; ctx.fillStyle = "#fff"; phbRR(ctx, x, y, t.W, t.h, 5 * kk); ctx.fill(); ctx.restore();
  ctx.fillStyle = phbQtCol(t); ctx.fillRect(x, y + 1, 5 * kk, t.h - 2);
  ctx.textBaseline = "top"; t.cells.forEach(c => { ctx.font = c.font; ctx.fillStyle = c.col; ctx.fillText(c.s, x + c.x, y + c.y); });
  ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = Math.max(1, 0.8 * kk); t.lines.forEach(l => { ctx.beginPath(); ctx.moveTo(x + 10 * kk, y + l.y); ctx.lineTo(x + t.W - 8 * kk, y + l.y); ctx.stroke(); });
}
const phbQtRender = (ctx, st) => (st.tables || []).forEach(t => phbQtDraw(ctx, t));
/* PDF: samma tabell som vektorer. Texten är utmätt på skärmen, så vänsterkanten per cell räcker. */
function phbQtPdf(t, f) {
  const kk = t.kk, w = t.W * f, h = t.h * f; let o = "";
  o += `1 g ${phbRRpdf(0.5, 0.5, w - 1, h - 1, 4 * kk * f)} f 0.85 G ${phbN(0.8 * kk * f)} w ${phbRRpdf(0.5, 0.5, w - 1, h - 1, 4 * kk * f)} S `;
  o += `${phbRgb(phbQtCol(t))} rg 0 ${phbN(1 * kk * f)} ${phbN(5 * kk * f)} ${phbN(h - 2 * kk * f)} re f 0.9 G ${phbN(0.8 * kk * f)} w `;
  t.lines.forEach(l => { o += `${phbN(10 * kk * f)} ${phbN(h - l.y * f)} m ${phbN((t.W - 8 * kk) * f)} ${phbN(h - l.y * f)} l S `; });
  t.cells.forEach(c => { const m = /(\d+(?:\.\d+)?)px/.exec(c.font), size = m ? Number(m[1]) : 11, bold = /^700/.test(c.font), col = /#([0-9a-f]{6})/i.exec(c.col)[1], r = [0, 2, 4].map(i => parseInt(col.substr(i, 2), 16) / 255);
    o += `BT ${phbN(r[0])} ${phbN(r[1])} ${phbN(r[2])} rg /${bold ? "F2" : "F1"} ${phbN(size * f)} Tf 1 0 0 1 ${phbN(c.x * f)} ${phbN(h - (c.y + size * 0.82) * f)} Tm ${phbPdfStr(c.s)} Tj ET `; });
  return o;
}

/* ---- Skapa tabeller ---------------------------------------------------------------------------------------------------------------------------- */
const PHB_QT_DEF = "4ddash-phb-qt-cols";
const phbQtDefCols = () => { try { const a = JSON.parse(localStorage.getItem(PHB_QT_DEF) || "null"); if (Array.isArray(a) && a.length) return a; } catch (e) { /* standard */ } return ["tot", "klar", "kvar"]; };
function phbQtPlace(st, t, i) {
  const k = st.k; phbQtMeasure(t, st);
  const per = Math.max(1, Math.floor((st.W - 40 * k) / (t.W + 10 * k))); t.x = 20 * k + (i % per) * (t.W + 10 * k); t.y = Math.max(10 * k, st.H - t.h - 20 * k - Math.floor(i / per) * (t.h + 10 * k));
  t.x = Math.max(10 * k, Math.min(st.W - t.W - 10 * k, t.x)); t.y = Math.max(10 * k, Math.min(st.H - t.h - 10 * k, t.y));
}
function phbQtCreate(st, d) {
  let n = 0; st.tables = st.tables || [];
  d.areas.filter(a => a.on).forEach(a => {
    const t = { id: (st.nextId = (st.nextId || 1) + 1), area: a.name, src: d.src, keys: d.src === "sel" ? d.keys.slice() : [], cols: d.cols.slice(), dec: d.dec, max: d.max, scale: 1, title: "", col: null, x: NaN, y: NaN };
    phbQtPlace(st, t, st.tables.length); st.tables.push(t); st.sel = t; n++;
  });
  return n;
}

/* ---- Sidopanelen ------------------------------------------------------------------------------------------------------------------------------ */
const phbQtColsHtml = (cols, id, sel) => `<div class="phb-row" style="flex-wrap:wrap">${PHB_QT_COLS.filter(([m]) => sel !== "sel" || (m !== "k" && m !== "pr")).map(([m, l]) => `<label class="phb-c"><input type="checkbox" data-qtc="${id}" value="${m}"${cols.includes(m) ? " checked" : ""}> ${l}</label>`).join("")}</div>`;
const phbQtDecHtml = (id, v) => `<label class="phb-f"><span>Decimaler</span><select id="${id}">${[0, 1, 2, 3].map(n => `<option value="${n}"${v === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>`;
function phbQtSide(api) {
  const cur = api.cur, d = cur.qtDraft, esc = api.esc;
  let h = `<div class="phb-sec"><div class="phb-h">Mängdtabeller</div>`;
  if (d) {
    h += `<div class="phb-note">${d.src === "sel" ? `${d.keys.length} markerade objekt` : "Alla inlästa objekt"}. Välj områden och kolumner – en tabell skapas per område.</div>
      <div class="phb-ocf">${d.areas.map((a, i) => `<label class="phb-c"><input type="checkbox" data-qta="${i}"${a.on ? " checked" : ""}> ${esc(a.name)}</label>`).join("") || `<div class="phb-note">Inga områden med mängder.</div>`}</div>
      ${phbQtColsHtml(d.cols, "d", d.src)}${phbQtDecHtml("phbQtDDec", d.dec)}
      <label class="phb-f"><span>Högst antal rader per tabell</span><input type="number" id="phbQtDMax" min="1" max="60" value="${d.max}"></label>
      <div class="phb-row"><button type="button" id="phbQtMake" class="primary"${d.areas.some(a => a.on) ? "" : " disabled"}>Skapa tabeller</button><button type="button" id="phbQtCancel">Avbryt</button></div>`;
  } else {
    h += `<label class="phb-f"><span>Siffror från</span><select id="phbQtSrc"><option value="qty">Mängdavtagningen (alla inlästa)</option><option value="sel">Markeringen i TC</option></select></label>
      <button type="button" id="phbQtNew">＋ Tabeller per område</button><div class="phb-note">${(cur.tables || []).length ? `${cur.tables.length} tabell${cur.tables.length === 1 ? "" : "er"} på bilden. ` : ""}En flyttbar tabell per område med AMA-koder och mängder.</div><div id="phbQtMsg" class="phb-note"></div>`;
  }
  return h + `</div>`;
}
function phbQtSelSide(api, t) {
  const esc = api.esc, areas = typeof qmf !== "undefined" ? [...qmf.builds, XL_NOB] : [t.area];
  return `<div class="phb-sec phb-sel-sec"><div class="phb-h">Vald mängdtabell</div>
    <label class="phb-f"><span>Område</span><select id="phbQtArea">${[...new Set([...areas, t.area])].map(a => `<option value="${esc(a)}"${a === t.area ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></label>
    <label class="phb-f"><span>Rubrik <small>(tomt = områdets namn)</small></span><input type="text" id="phbQtTitle" value="${esc(t.title || "")}" placeholder="${esc(t.area)}"></label>
    ${phbQtColsHtml(t.cols, "c", t.src)}${phbQtDecHtml("phbQtDec", t.dec == null ? 1 : t.dec)}
    <label class="phb-f"><span>Högst antal rader</span><input type="number" id="phbQtMax" min="1" max="60" value="${t.max || 12}"></label>
    ${api.rng("phbQtScale", "Tabellens skala", Math.round(t.scale * 100), 40, 300, 5)}
    <div class="phb-row"><label class="phb-f"><span>Färg</span><input type="color" id="phbQtCol" value="${phbQtCol(t)}"></label></div>
    <div class="phb-note">${t.src === "sel" ? `Siffror ur ${t.keys.length} markerade objekt.` : "Siffror ur mängdavtagningen."} ${t.n || 0} rader · dra tabellen för att flytta.</div>
    <div class="phb-row">${t.src === "sel" ? `<button type="button" id="phbQtResel" title="Byt ut objekten mot det som är markerat i TC nu">Uppdatera från markering</button>` : ""}<button type="button" id="phbQtDel" class="danger">Ta bort tabellen</button></div></div>`;
}
function phbQtBind(api, side) {
  const cur = api.cur, q = id => side.querySelector("#" + id), on = (id, ev, fn) => { const e = q(id); if (e) e.addEventListener(ev, fn); };
  const say = m => { const e = q("phbQtMsg"); if (e) e.textContent = m; };
  on("phbQtNew", "click", async () => {
    const src = q("phbQtSrc").value; say("Läser …");
    try {
      let keys = [];
      if (src === "sel") { const so = await phbOcReadSelection(); if (!so.length) { say("Inget är markerat i Trimble Connect – markera objekt först."); return; } so.forEach(o => phbQtObjKeys(o).forEach(k => keys.push(k))); }
      if (typeof qty === "undefined" || !qty.objs.length) { say("Läser mängder …"); if (typeof qtyRead === "function") await qtyRead(); }
      if (!qty.objs.length) { say("Inga mängder inlästa – kolla urvalet i mängdavtagningen."); return; }
      const objs = phbQtObjs({ src, keys }); if (!objs.length) { say("De markerade objekten finns inte bland de inlästa mängderna."); return; }
      const areas = phbQtAreas(objs); cur.qtDraft = { src, keys, areas: areas.map(name => ({ name, on: true })), cols: phbQtDefCols().filter(m => src !== "sel" || (m !== "k" && m !== "pr")), dec: 1, max: 12 }; api.renderSide();
    } catch (e) { say("Kunde inte skapa: " + ((e && e.message) || e)); }
  });
  const d = cur.qtDraft;
  if (d) {
    side.querySelectorAll("[data-qta]").forEach(c => c.addEventListener("change", () => { d.areas[Number(c.dataset.qta)].on = c.checked; const b = q("phbQtMake"); if (b) b.disabled = !d.areas.some(a => a.on); }));
    side.querySelectorAll('[data-qtc="d"]').forEach(c => c.addEventListener("change", () => { d.cols = PHB_QT_COLS.map(x => x[0]).filter(m => side.querySelector(`[data-qtc="d"][value="${m}"]`)?.checked); }));
    on("phbQtDDec", "change", e => { d.dec = Number(e.target.value); }); on("phbQtDMax", "input", e => { d.max = Math.max(1, Math.min(60, Number(e.target.value) || 12)); });
    on("phbQtCancel", "click", () => { cur.qtDraft = null; api.renderSide(); });
    on("phbQtMake", "click", () => { if (!d.cols.length) d.cols = ["tot"]; try { localStorage.setItem(PHB_QT_DEF, JSON.stringify(d.cols)); } catch (e) { /* */ } const n = phbQtCreate(cur, d); cur.qtDraft = null; api.draw(); api.renderSide(); if (typeof modelToast === "function") modelToast(`${n} tabell${n === 1 ? "" : "er"} skapade`); });
  }
  const t = cur.sel && (cur.tables || []).includes(cur.sel) ? cur.sel : null;
  if (t) {
    const re = () => { phbQtMeasure(t, cur); api.draw(); };
    on("phbQtArea", "change", e => { t.area = e.target.value; re(); api.renderSide(); }); on("phbQtTitle", "input", e => { t.title = e.target.value; re(); });
    side.querySelectorAll('[data-qtc="c"]').forEach(c => c.addEventListener("change", () => { const l = PHB_QT_COLS.map(x => x[0]).filter(m => side.querySelector(`[data-qtc="c"][value="${m}"]`)?.checked); t.cols = l.length ? l : ["tot"]; re(); api.renderSide(); }));
    on("phbQtDec", "change", e => { t.dec = Number(e.target.value); re(); }); on("phbQtMax", "input", e => { t.max = Math.max(1, Math.min(60, Number(e.target.value) || 12)); re(); });
    on("phbQtScale", "input", e => { t.scale = Number(e.target.value) / 100; const l = q("phbQtScaleV"); if (l) l.textContent = e.target.value + "%"; re(); });
    on("phbQtCol", "input", e => { t.col = e.target.value; api.draw(); });
    on("phbQtResel", "click", async () => { try { const so = await phbOcReadSelection(); if (!so.length) { if (typeof modelToast === "function") modelToast("Inget är markerat i Trimble Connect"); return; } t.keys = []; so.forEach(o => phbQtObjKeys(o).forEach(k => t.keys.push(k))); re(); api.renderSide(); } catch (e) { if (typeof modelToast === "function") modelToast("Kunde inte läsa markeringen"); } });
    on("phbQtDel", "click", () => api.removeObj({ type: "qtable", o: t }));
  }
}
