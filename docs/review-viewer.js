/* Granskning – visaren (Victor 2026-10-22). Sidan ritas med pdf.js; markeringarna ligger i ett eget lager ovanpå (canvas) och sparas normaliserade
   (0–1 av sidans bredd/höjd), så de följer med vid zoom. Verktyg: kommentar (pin), pil, rektangel, markering, moln, penna, text, mått (med inställd skala).
   Smarta funktioner: sök i texten (träffarna lyses upp på sidan), jämför revisioner (rött = bara i gamla, grönt = bara i nya), pinch-zoom och drag på surfplatta/telefon,
   helskärm för fältbruk, rapport med bildutsnitt per markering. */

const RVV_COLORS = ["#e5484d", "#f59e0b", "#2da44e", "#0b5fff", "#8250df", "#1f2328"];
const RVV_STATUS = { open: ["Öppen", "#e5484d"], done: ["Åtgärdad", "#f59e0b"], ok: ["Godkänd", "#2da44e"] };
const RVV_TOOLS = [["hand", "✋", "Flytta/markera – dra för att panorera, klicka på en markering för att välja den"], ["pin", "📍", "Kommentar (pin)"], ["arrow", "➜", "Pil"], ["rect", "▭", "Rektangel"], ["hl", "▬", "Överstrykning"], ["cloud", "☁", "Revisionsmoln"], ["pen", "✎", "Penna"], ["text", "T", "Text på ritningen"], ["measure", "📏", "Mät avstånd (kräver skala)"], ["calib", "⚖", "Sätt skala: rita en linje med känd längd"]];
const rvv = { id: "", doc: null, pdf: null, pdfs: new Map(), num: 1, zoom: 1, fitMode: "w", tool: "hand", color: RVV_COLORS[0], marks: [], sel: null, undo: [], redo: [], W: 0, H: 0, tok: 0, hl: "", hlRects: [], cmp: null, cmpDoc: null, drag: null, ptrs: new Map(), pinch: null, vp1: null, fs: false };
const rvvMarks = () => rvv.marks.filter(m => m.page === rvv.num);
const rvvFmtLen = m => { const d = rvv.doc && rvv.doc.scaleW; if (!d || !rvv.W) return ""; const [a, b] = m.pts, len = Math.hypot((b[0] - a[0]) * rvv.W, (b[1] - a[1]) * rvv.H) / rvv.W * d; return (len >= 100 ? len.toFixed(1) : len >= 10 ? len.toFixed(2) : len.toFixed(3)).replace(".", ",") + " m"; };

/* ---- Ritning av markeringar (används både för lagret på skärmen och för rapportens bilder) ---------------------------------------------------- */
function rvvCloud(ctx, x, y, w, h) {
  const r = 9, pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]; ctx.beginPath(); ctx.moveTo(x, y);
  for (let e = 0; e < 4; e++) { const [a, b] = [pts[e], pts[e + 1]], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, n = Math.max(1, Math.round(len / (2 * r))), nx = dy / len, ny = -dx / len;
    for (let i = 0; i < n; i++) { const p0 = [a[0] + dx * i / n, a[1] + dy * i / n], p1 = [a[0] + dx * (i + 1) / n, a[1] + dy * (i + 1) / n], mx = (p0[0] + p1[0]) / 2 + nx * r * 1.1, my = (p0[1] + p1[1]) / 2 + ny * r * 1.1; ctx.quadraticCurveTo(mx, my, p1[0], p1[1]); } }
  ctx.closePath();
}
function rvvBBox(m, W, H) {
  if (m.type === "pin") return { x: m.x * W - 12, y: m.y * H - 12, w: 24, h: 24 };
  if (m.pts && m.pts.length) { const xs = m.pts.map(p => p[0] * W), ys = m.pts.map(p => p[1] * H), x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; }
  if (m.type === "text") { const lines = String(m.text || "Text").split("\n"), w = Math.max(...lines.map(l => l.length)) * 7 + 12; return { x: m.x * W, y: m.y * H, w, h: lines.length * 17 + 8 }; }
  return { x: Math.min(m.x, m.x + m.w) * W, y: Math.min(m.y, m.y + m.h) * H, w: Math.abs(m.w) * W, h: Math.abs(m.h) * H };
}
function rvvDraw(ctx, marks, W, H, k, o = {}) {
  ctx.save(); ctx.scale(k, k); ctx.lineCap = "round"; ctx.lineJoin = "round";
  (o.hl || []).forEach(r => { ctx.fillStyle = "rgba(255,214,0,.5)"; ctx.fillRect(r[0] * W, r[1] * H, r[2] * W, r[3] * H); });
  marks.forEach(m => {
    const col = m.color || RVV_COLORS[0], ok = m.status === "ok", sel = o.sel === m.id; ctx.globalAlpha = ok ? 0.55 : 1; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.5;
    if (m.type === "pin") { const x = m.x * W, y = m.y * H; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.fillStyle = "#fff"; ctx.font = "bold 11px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ok ? "✓" : String(m.n), x, y + 0.5); if (m.status === "done") { ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, 15, 0, 7); ctx.stroke(); ctx.setLineDash([]); } }
    else if (m.type === "rect") { const b = rvvBBox(m, W, H); ctx.fillStyle = col + "22"; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeRect(b.x, b.y, b.w, b.h); }
    else if (m.type === "hl") { const b = rvvBBox(m, W, H); ctx.globalAlpha = ok ? 0.2 : 0.35; ctx.fillRect(b.x, b.y, b.w, b.h); }
    else if (m.type === "cloud") { const b = rvvBBox(m, W, H); rvvCloud(ctx, b.x, b.y, b.w, b.h); ctx.stroke(); }
    else if (m.type === "arrow" && m.pts) { const [a, b] = m.pts, x0 = a[0] * W, y0 = a[1] * H, x1 = b[0] * W, y1 = b[1] * H, an = Math.atan2(y1 - y0, x1 - x0); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - 13 * Math.cos(an - 0.4), y1 - 13 * Math.sin(an - 0.4)); ctx.lineTo(x1 - 13 * Math.cos(an + 0.4), y1 - 13 * Math.sin(an + 0.4)); ctx.closePath(); ctx.fill(); }
    else if (m.type === "pen" && m.pts) { ctx.beginPath(); m.pts.forEach((p, i) => (i ? ctx.lineTo(p[0] * W, p[1] * H) : ctx.moveTo(p[0] * W, p[1] * H))); ctx.stroke(); }
    else if (m.type === "measure" && m.pts) { const [a, b] = m.pts, x0 = a[0] * W, y0 = a[1] * H, x1 = b[0] * W, y1 = b[1] * H, an = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(an) * 6, ny = Math.cos(an) * 6; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.moveTo(x0 - nx, y0 - ny); ctx.lineTo(x0 + nx, y0 + ny); ctx.moveTo(x1 - nx, y1 - ny); ctx.lineTo(x1 + nx, y1 + ny); ctx.stroke(); const lab = (o.len || rvvFmtLen)(m) || "ej skala"; ctx.font = "bold 12px Arial"; const tw = ctx.measureText(lab).width + 10, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; ctx.fillStyle = "#fff"; ctx.fillRect(cx - tw / 2, cy - 10, tw, 20); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(cx - tw / 2, cy - 10, tw, 20); ctx.fillStyle = col; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(lab, cx, cy + 0.5); }
    else if (m.type === "calib" && m.pts) { /* hjälplinje, ritas bara tillfälligt */ }
    else if (m.type === "text") { const b = rvvBBox(m, W, H), lines = String(m.text || "Text").split("\n"); ctx.fillStyle = "#fff"; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.lineWidth = 1.5; ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.fillStyle = col; ctx.font = "13px Arial"; ctx.textAlign = "left"; ctx.textBaseline = "top"; lines.forEach((l, i) => ctx.fillText(l, b.x + 6, b.y + 5 + i * 17)); }
    ctx.globalAlpha = 1;
    if (sel) { const b = rvvBBox(m, W, H); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "#0b5fff"; ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8); ctx.setLineDash([]); }
  });
  if (o.draft) rvvDraw(ctx, [o.draft], W, H, 1, { len: o.len });
  ctx.restore();
}
function rvvDist(px, py, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)); return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy)); }
function rvvHit(px, py) {
  const W = rvv.W, H = rvv.H;
  for (const m of [...rvvMarks()].reverse()) {
    if (m.type === "pin") { if (Math.hypot(px - m.x * W, py - m.y * H) <= 15) return m; continue; }
    if ((m.type === "arrow" || m.type === "measure") && m.pts) { if (rvvDist(px, py, [m.pts[0][0] * W, m.pts[0][1] * H], [m.pts[1][0] * W, m.pts[1][1] * H]) <= 9) return m; continue; }
    if (m.type === "pen" && m.pts) { for (let i = 1; i < m.pts.length; i++) if (rvvDist(px, py, [m.pts[i - 1][0] * W, m.pts[i - 1][1] * H], [m.pts[i][0] * W, m.pts[i][1] * H]) <= 8) return m; continue; }
    const b = rvvBBox(m, W, H), edge = m.type === "rect" || m.type === "cloud";
    if (edge) { const inner = px > b.x + 8 && px < b.x + b.w - 8 && py > b.y + 8 && py < b.y + b.h - 8; if (px >= b.x - 8 && px <= b.x + b.w + 8 && py >= b.y - 8 && py <= b.y + b.h + 8 && !inner) return m; }
    else if (px >= b.x - 4 && px <= b.x + b.w + 4 && py >= b.y - 4 && py <= b.y + b.h + 4) return m;
  }
  return null;
}

/* ---- Öppna ritning ------------------------------------------------------------------------------------------------------------------------------------ */
async function rvOpenDoc(id, opt = {}) {
  const doc = rv.docs.find(d => d.id === id), main = document.getElementById("rvMain"); if (!doc || !main) return;
  if (!opt.again) { doc.opened = Date.now(); rvSaveDoc(doc).catch(() => {}); }
  rv.open = id; rvv.doc = doc; rvv.id = id; rvv.num = Math.max(1, opt.page || (rvv.id === id && opt.again ? rvv.num : 1)); rvv.hl = opt.hl || ""; rvv.cmp = null; rvv.cmpDoc = null; rvv.sel = null; rvv.undo = []; rvv.redo = [];
  rvv.zoom = opt.again ? rvv.zoom : 1; document.querySelectorAll(".rv-row").forEach(r => r.classList.toggle("on", r.dataset.doc === id));
  main.innerHTML = `<div class="rv-view"><div class="rv-loading"><span class="rv-spin"></span> Öppnar ${rvEsc(doc.name)} …</div></div>`; document.querySelector(".rv-wrap") && document.querySelector(".rv-wrap").classList.add("has-doc");
  try {
    const lib = await rvPdfjs(); if (!rvv.pdfs.has(id)) { const b = await rvGet("blobs", id); if (!b) throw new Error("Filen saknas i lagringen"); rvv.pdfs.set(id, await lib.getDocument({ data: await b.blob.arrayBuffer() }).promise); if (rvv.pdfs.size > 4) { const k = rvv.pdfs.keys().next().value; try { rvv.pdfs.get(k).destroy(); } catch (e) { /* */ } rvv.pdfs.delete(k); } }
    rvv.pdf = rvv.pdfs.get(id); rvv.marks = await rvAll("marks", "doc", id); rv.marks.set(id, rvv.marks); rvv.num = Math.min(rvv.num, rvv.pdf.numPages);
  } catch (e) { main.innerHTML = `<div class="rv-view"><p class="rv-empty">Kunde inte öppna ritningen: ${rvEsc((e && e.message) || e)}</p></div>`; return; }
  rvvBuild(main); await rvvRender(true);
}
function rvvBuild(main) {
  const d = rvv.doc, older = rv.docs.filter(x => x.key === d.key && x.id !== d.id);
  main.innerHTML = `<div class="rv-view" id="rvView"><div class="rv-bar"><button data-v="back" class="rv-backb" title="Tillbaka till listan">‹ Lista</button><b class="rv-title" title="${rvEsc(d.name)}">${rvEsc(d.no || d.name)} <small>${rvEsc(d.title)}</small>${d.rev ? ` <i class="rv-rev">rev ${rvEsc(d.rev)}</i>` : ""}</b>
    <span class="rv-grpb"><button data-v="prev" title="Föregående sida (←)">‹</button><input id="rvPageIn" type="number" min="1" max="${rvv.pdf.numPages}" value="${rvv.num}" aria-label="Sida"><span>/ ${rvv.pdf.numPages}</span><button data-v="next" title="Nästa sida (→)">›</button></span>
    <span class="rv-grpb"><button data-v="zout" title="Zooma ut (−)">−</button><button data-v="fit" title="Anpassa till bredden / hela sidan">⤢</button><button data-v="zin" title="Zooma in (+)">＋</button><span id="rvZ">100 %</span></span>
    <span class="rv-grpb rv-tl">${RVV_TOOLS.map(([k, ic, t]) => `<button data-tool="${k}" class="${rvv.tool === k ? "on" : ""}" title="${rvEsc(t)}">${ic}</button>`).join("")}</span>
    <span class="rv-grpb">${RVV_COLORS.map(c => `<button class="rv-sw${rvv.color === c ? " on" : ""}" data-color="${c}" style="background:${c}" title="Färg" aria-label="Färg"></button>`).join("")}</span>
    <span class="rv-grpb"><button data-v="undo" title="Ångra (Ctrl+Z)">↶</button><button data-v="redo" title="Gör om (Ctrl+Y)">↷</button></span>
    <button data-v="cmp" title="Jämför med en annan revision av samma ritning"${older.length ? "" : " disabled"}>Jämför rev</button><button data-v="side" title="Visa/dölj markeringslistan">Markeringar <em id="rvMkN"></em></button><button data-v="fs" title="Helskärm (f)">⛶</button></div>
    <div class="rv-body"><div class="rv-stage" id="rvStage"><div class="rv-pagebox" id="rvBox"><canvas id="rvCv"></canvas><canvas id="rvCmp" hidden></canvas><canvas id="rvOv"></canvas></div><div class="rv-legend" id="rvLegend" hidden></div></div><aside class="rv-marks" id="rvMarks"></aside></div></div>`;
  rvvWire(); rvvMarksPane();
}
function rvvWire() {
  const v = document.getElementById("rvView"), st = document.getElementById("rvStage");
  v.onclick = e => {
    const b = e.target.closest("button"); if (!b) return; const a = b.dataset.v;
    if (b.dataset.tool) { rvv.tool = b.dataset.tool; v.querySelectorAll("[data-tool]").forEach(x => x.classList.toggle("on", x.dataset.tool === rvv.tool)); rvvCursor(); return; }
    if (b.dataset.color) { rvv.color = b.dataset.color; v.querySelectorAll("[data-color]").forEach(x => x.classList.toggle("on", x.dataset.color === rvv.color)); const m = rvv.marks.find(x => x.id === rvv.sel); if (m) { rvvMod(m, { color: rvv.color }); } return; }
    if (a === "prev") rvvGo(rvv.num - 1); else if (a === "next") rvvGo(rvv.num + 1); else if (a === "zin") rvvZoom(rvv.zoom * 1.25); else if (a === "zout") rvvZoom(rvv.zoom / 1.25);
    else if (a === "fit") { rvv.fitMode = rvv.fitMode === "w" ? "p" : "w"; rvv.zoom = 1; rvvRender(); } else if (a === "undo") rvvUndo(); else if (a === "redo") rvvRedo();
    else if (a === "side") { v.classList.toggle("no-side"); setTimeout(() => rvvRender(), 60); } else if (a === "fs") rvvFs();
    else if (a === "cmp") rvvCompareMenu(b); else if (a === "back") { rv.open = null; document.querySelector(".rv-wrap").classList.remove("has-doc"); const m = document.getElementById("rvMain"); rvRender(); }
  };
  document.getElementById("rvPageIn").onchange = e => rvvGo(Number(e.target.value));
  st.addEventListener("wheel", e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); const r = st.getBoundingClientRect(); rvvZoom(rvv.zoom * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top); } }, { passive: false });
  st.addEventListener("pointerdown", rvvDown); st.addEventListener("pointermove", rvvMove); st.addEventListener("pointerup", rvvUp); st.addEventListener("pointercancel", rvvUp);
  st.addEventListener("dblclick", e => { if (rvv.tool === "hand" && !rvvHit(...rvvLocal(e))) { rvv.zoom = rvv.zoom > 1.05 ? 1 : 2.2; rvvZoom(rvv.zoom, e.clientX - st.getBoundingClientRect().left, e.clientY - st.getBoundingClientRect().top); } });
  rvvCursor();
}
const rvvLocal = e => { const r = document.getElementById("rvOv").getBoundingClientRect(); return [(e.clientX - r.left) * (rvv.W / r.width), (e.clientY - r.top) * (rvv.H / r.height)]; };
function rvvCursor() { const st = document.getElementById("rvStage"); if (st) st.style.cursor = rvv.tool === "hand" ? "grab" : "crosshair"; }
function rvvGo(n) { n = Math.max(1, Math.min(rvv.pdf.numPages, Math.round(n) || 1)); if (n === rvv.num) { const i = document.getElementById("rvPageIn"); if (i) i.value = n; return; } rvv.num = n; rvv.sel = null; const i = document.getElementById("rvPageIn"); if (i) i.value = n; rvvRender(true); rvvMarksPane(); }

/* ---- Rendering ---------------------------------------------------------------------------------------------------------------------------------------- */
async function rvvRender(reset) {
  const st = document.getElementById("rvStage"), cv = document.getElementById("rvCv"), ov = document.getElementById("rvOv"); if (!st || !cv || !rvv.pdf) return;
  const tok = ++rvv.tok, page = await rvv.pdf.getPage(rvv.num), vp1 = page.getViewport({ scale: 1 }); rvv.vp1 = vp1;
  const aw = Math.max(200, st.clientWidth - 24), ah = Math.max(200, st.clientHeight - 24), fit = rvv.fitMode === "p" ? Math.min(aw / vp1.width, ah / vp1.height) : aw / vp1.width, scale = fit * rvv.zoom;
  rvv.W = vp1.width * scale; rvv.H = vp1.height * scale; rvv.fit = fit;
  const box = document.getElementById("rvBox"); box.style.width = rvv.W + "px"; box.style.height = rvv.H + "px"; [cv, ov, document.getElementById("rvCmp")].forEach(c => { c.style.width = rvv.W + "px"; c.style.height = rvv.H + "px"; });
  const z = document.getElementById("rvZ"); if (z) z.textContent = Math.round(rvv.zoom * 100) + " %";
  const dpr = Math.min(window.devicePixelRatio || 1, 2); let k = scale * dpr; const cw = vp1.width * k, ch = vp1.height * k, f = Math.min(1, 8000 / Math.max(cw, ch), Math.sqrt(40e6 / (cw * ch))); k *= f;
  const vp = page.getViewport({ scale: k }); if (rvv.task) { try { rvv.task.cancel(); } catch (e) { /* */ } }
  const off = document.createElement("canvas"); off.width = Math.round(vp.width); off.height = Math.round(vp.height); const og = off.getContext("2d"); og.fillStyle = "#fff"; og.fillRect(0, 0, off.width, off.height);
  rvv.task = page.render({ canvasContext: og, viewport: vp }); try { await rvv.task.promise; } catch (e) { return; }
  if (tok !== rvv.tok) return;
  cv.width = off.width; cv.height = off.height; cv.getContext("2d").drawImage(off, 0, 0); ov.width = off.width; ov.height = off.height; const cm = document.getElementById("rvCmp"); cm.width = off.width; cm.height = off.height; rvv.k = off.width / rvv.W;
  rvv.hlRects = rvv.hl ? await rvvHlRects(page, vp) : [];
  if (rvv.cmpDoc) await rvvCompareDraw(); rvvOv(); rvvMarksPane(true);
}
async function rvvHlRects(page, vp) {
  const words = rvv.hl.toLowerCase().split(/\s+/).filter(w => w.length > 1), out = []; if (!words.length) return out;
  try { const tc = await page.getTextContent(); tc.items.forEach(it => { const s = it.str || "", low = s.toLowerCase(); if (!low) return; words.forEach(w => { let at = low.indexOf(w); while (at >= 0) { const t = pdfjsLib.Util.transform(vp.transform, it.transform), wd = (it.width || 0) * vp.scale * 1, h = Math.abs(it.height || Math.hypot(it.transform[2], it.transform[3])) * vp.scale, x = t[4] + wd * at / s.length, wn = wd * w.length / s.length; out.push([x / vp.width, (t[5] - h) / vp.height, wn / vp.width, (h * 1.15) / vp.height]); at = low.indexOf(w, at + w.length); } }); }); } catch (e) { /* utan träffbild */ }
  return out;
}
function rvvOv(draft) {
  const ov = document.getElementById("rvOv"); if (!ov) return; const g = ov.getContext("2d"); g.clearRect(0, 0, ov.width, ov.height);
  rvvDraw(g, rvvMarks(), rvv.W, rvv.H, rvv.k || 1, { sel: rvv.sel, hl: rvv.hlRects, draft });
  const n = document.getElementById("rvMkN"); if (n) n.textContent = rvv.marks.length ? `(${rvv.marks.filter(m => m.status === "open").length}/${rvv.marks.length})` : "";
}
function rvvZoom(z, cx, cy) {
  const st = document.getElementById("rvStage"); if (!st) return; z = Math.max(0.2, Math.min(10, z)); const W0 = rvv.W, H0 = rvv.H; cx = cx == null ? st.clientWidth / 2 : cx; cy = cy == null ? st.clientHeight / 2 : cy;
  const fx = (st.scrollLeft + cx - (document.getElementById("rvBox").offsetLeft)) / W0, fy = (st.scrollTop + cy - (document.getElementById("rvBox").offsetTop)) / H0; rvv.zoom = z;
  const vp1 = rvv.vp1, scale = rvv.fit * z, W = vp1.width * scale, H = vp1.height * scale, box = document.getElementById("rvBox"); box.style.width = W + "px"; box.style.height = H + "px";
  ["rvCv", "rvOv", "rvCmp"].forEach(id => { const c = document.getElementById(id); c.style.width = W + "px"; c.style.height = H + "px"; }); rvv.W = W; rvv.H = H;
  st.scrollLeft = fx * W + box.offsetLeft - cx; st.scrollTop = fy * H + box.offsetTop - cy; const zz = document.getElementById("rvZ"); if (zz) zz.textContent = Math.round(z * 100) + " %";
  clearTimeout(rvv.zt); rvv.zt = setTimeout(() => rvvRender(), 160); rvvOv();
}

/* ---- Pekare: panorera, pinch, rita ---------------------------------------------------------------------------------------------------------- */
function rvvDown(e) {
  const st = document.getElementById("rvStage"); if (!st || e.target.closest(".rv-legend")) return; st.setPointerCapture(e.pointerId); rvv.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (rvv.ptrs.size === 2) { rvv.drag = null; const [a, b] = [...rvv.ptrs.values()], r = st.getBoundingClientRect(); rvv.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: rvv.zoom, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top }; return; }
  if (e.button === 1 || e.button === 2) { rvv.drag = { t: "pan", sx: e.clientX, sy: e.clientY, l: st.scrollLeft, tp: st.scrollTop }; return; }
  const [px, py] = rvvLocal(e), inside = px >= 0 && py >= 0 && px <= rvv.W && py <= rvv.H, tool = rvv.tool;
  if (tool === "hand" || !inside) {
    const hit = inside ? rvvHit(px, py) : null; if (hit) { rvv.sel = hit.id; rvv.drag = { t: "move", m: hit, px, py, before: JSON.stringify(hit), moved: false }; rvvOv(); rvvMarksPane(); rvvCursor(); } else { if (rvv.sel) { rvv.sel = null; rvvOv(); rvvMarksPane(); } rvv.drag = { t: "pan", sx: e.clientX, sy: e.clientY, l: st.scrollLeft, tp: st.scrollTop }; st.style.cursor = "grabbing"; }
    return;
  }
  const x = px / rvv.W, y = py / rvv.H;
  if (tool === "pin" || tool === "text") { const m = rvvNew(tool, { x, y, text: "" }); rvvAdd(m); rvv.sel = m.id; rvvOv(); rvvMarksPane(false, true); return; }
  if (tool === "pen") rvv.drag = { t: "draw", m: rvvNew("pen", { pts: [[x, y]] }) };
  else if (tool === "arrow" || tool === "measure" || tool === "calib") rvv.drag = { t: "draw", m: rvvNew(tool, { pts: [[x, y], [x, y]] }) };
  else rvv.drag = { t: "draw", m: rvvNew(tool, { x, y, w: 0, h: 0 }) };
}
function rvvMove(e) {
  const st = document.getElementById("rvStage"); if (rvv.ptrs.has(e.pointerId)) { rvv.ptrs.get(e.pointerId).x = e.clientX; rvv.ptrs.get(e.pointerId).y = e.clientY; }
  if (rvv.pinch && rvv.ptrs.size >= 2) { const [a, b] = [...rvv.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); rvvZoom(rvv.pinch.z0 * d / Math.max(1, rvv.pinch.d0), rvv.pinch.cx, rvv.pinch.cy); return; }
  const dr = rvv.drag; if (!dr) return;
  if (dr.t === "pan") { st.scrollLeft = dr.l - (e.clientX - dr.sx); st.scrollTop = dr.tp - (e.clientY - dr.sy); return; }
  const [px, py] = rvvLocal(e), x = Math.max(0, Math.min(1, px / rvv.W)), y = Math.max(0, Math.min(1, py / rvv.H));
  if (dr.t === "move") { const dx = (px - dr.px) / rvv.W, dy = (py - dr.py) / rvv.H, m = dr.m; if (Math.abs(px - dr.px) + Math.abs(py - dr.py) < 2 && !dr.moved) return; dr.moved = true; const b = JSON.parse(dr.before); if (m.pts) m.pts = b.pts.map(p => [p[0] + dx, p[1] + dy]); else { m.x = b.x + dx; m.y = b.y + dy; } rvvOv(); return; }
  const m = dr.m; if (m.pts && m.type === "pen") m.pts.push([x, y]); else if (m.pts) m.pts[1] = [x, y]; else { m.w = x - m.x; m.h = y - m.y; } rvvOv(m);
}
async function rvvUp(e) {
  rvv.ptrs.delete(e.pointerId); const st = document.getElementById("rvStage"); if (rvv.pinch && rvv.ptrs.size < 2) { rvv.pinch = null; rvv.drag = null; return; }
  const dr = rvv.drag; rvv.drag = null; rvvCursor(); if (!dr) return;
  if (dr.t === "move") { if (dr.moved) { rvvPush({ t: "mod", id: dr.m.id, before: JSON.parse(dr.before) }); await rvPut("marks", dr.m); } return; }
  if (dr.t !== "draw") return; const m = dr.m, W = rvv.W, H = rvv.H;
  const size = m.pts ? (m.type === "pen" ? m.pts.length * 4 : Math.hypot((m.pts[1][0] - m.pts[0][0]) * W, (m.pts[1][1] - m.pts[0][1]) * H)) : Math.hypot(m.w * W, m.h * H);
  if (size < 6) { rvvOv(); return; }
  if (m.type === "calib") { rvvOv(); const len = Math.hypot((m.pts[1][0] - m.pts[0][0]) * W, (m.pts[1][1] - m.pts[0][1]) * H) / W; const ans = await (typeof dashPrompt === "function" ? dashPrompt("Verklig längd för linjen du ritade, i meter", "") : prompt("Verklig längd i meter", "")); const real = parseFloat(String(ans || "").replace(",", ".")); if (real > 0) { rvv.doc.scaleW = real / len; await rvSaveDoc(rvv.doc); rvToast(`Skala satt: sidans bredd är ${rvv.doc.scaleW.toFixed(1).replace(".", ",")} m`); rvv.tool = "measure"; document.querySelectorAll("[data-tool]").forEach(x => x.classList.toggle("on", x.dataset.tool === "measure")); } rvvOv(); return; }
  if (m.type === "measure" && !rvv.doc.scaleW) rvToast("Sätt skalan först med ⚖ (rita en linje med känd längd)");
  rvvAdd(m); rvv.sel = m.id; rvvOv(); rvvMarksPane(false, m.type === "text");
}
document.addEventListener("keydown", e => {
  const v = document.getElementById("rvView"); if (!v || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable) return;
  if (e.key === "ArrowRight" || e.key === "PageDown") rvvGo(rvv.num + 1); else if (e.key === "ArrowLeft" || e.key === "PageUp") rvvGo(rvv.num - 1);
  else if (e.key === "+" || e.key === "=") rvvZoom(rvv.zoom * 1.25); else if (e.key === "-") rvvZoom(rvv.zoom / 1.25); else if (e.key === "f") rvvFs();
  else if ((e.key === "Delete" || e.key === "Backspace") && rvv.sel) { e.preventDefault(); rvvDelete(rvv.sel); } else if (e.key === "Escape") { if (rvv.sel) { rvv.sel = null; rvvOv(); rvvMarksPane(); } else if (rvv.fs) rvvFs(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? rvvRedo() : rvvUndo(); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); rvvRedo(); }
});
function rvvFs() {
  const v = document.getElementById("rvView"); if (!v) return; const on = document.fullscreenElement === v || v.classList.contains("fsx");
  if (on) { if (document.fullscreenElement) document.exitFullscreen(); v.classList.remove("fsx"); rvv.fs = false; } else { rvv.fs = true; if (v.requestFullscreen) v.requestFullscreen().catch(() => v.classList.add("fsx")); else v.classList.add("fsx"); }
  setTimeout(() => rvvRender(), 120);
}
document.addEventListener("fullscreenchange", () => { const v = document.getElementById("rvView"); if (v && document.fullscreenElement !== v) rvv.fs = false; setTimeout(() => rvvRender(), 120); });

/* ---- Markeringar: skapa, ändra, ångra, lista -------------------------------------------------------------------------------------------------- */
function rvvNew(type, o) { const n = rvv.marks.reduce((a, m) => Math.max(a, m.n || 0), 0) + 1; return { id: rvId(), doc: rvv.id, page: rvv.num, type, color: rvv.color, status: "open", text: "", n, created: new Date().toISOString(), by: (() => { try { return localStorage.getItem("4ddash-review-author") || ""; } catch (e) { return ""; } })(), ...o }; }
async function rvvAdd(m, noUndo) { rvv.marks.push(m); rv.marks.set(rvv.id, rvv.marks); if (!noUndo) rvvPush({ t: "add", id: m.id }); await rvPut("marks", m); rvMarksCount().then(() => { const l = document.getElementById("rvList"); if (l) l.innerHTML = rvListHtml(); }); }
async function rvvMod(m, patch, noUndo) { if (!noUndo) rvvPush({ t: "mod", id: m.id, before: JSON.parse(JSON.stringify(m)) }); Object.assign(m, patch); await rvPut("marks", m); rvvOv(); rvvMarksPane(true); rvMarksCount().then(() => { const l = document.getElementById("rvList"); if (l) l.innerHTML = rvListHtml(); }); }
async function rvvDelete(id, noUndo) { const m = rvv.marks.find(x => x.id === id); if (!m) return; if (!noUndo) rvvPush({ t: "del", m: JSON.parse(JSON.stringify(m)) }); rvv.marks = rvv.marks.filter(x => x.id !== id); rv.marks.set(rvv.id, rvv.marks); if (rvv.sel === id) rvv.sel = null; await rvDel("marks", id); rvvOv(); rvvMarksPane(); rvMarksCount().then(() => { const l = document.getElementById("rvList"); if (l) l.innerHTML = rvListHtml(); }); }
function rvvPush(a) { rvv.undo.push(a); if (rvv.undo.length > 40) rvv.undo.shift(); rvv.redo = []; }
async function rvvUndo() {
  const a = rvv.undo.pop(); if (!a) return;
  if (a.t === "add") { const m = rvv.marks.find(x => x.id === a.id); if (m) { rvv.redo.push({ t: "del", m: JSON.parse(JSON.stringify(m)) }); await rvvDelete(a.id, true); } }
  else if (a.t === "del") { await rvvAdd(a.m, true); rvv.redo.push({ t: "add", id: a.m.id }); }
  else if (a.t === "mod") { const m = rvv.marks.find(x => x.id === a.id); if (m) { rvv.redo.push({ t: "mod", id: a.id, before: JSON.parse(JSON.stringify(m)) }); await rvvMod(m, a.before, true); } }
  rvvOv(); rvvMarksPane();
}
async function rvvRedo() {
  const a = rvv.redo.pop(); if (!a) return;
  if (a.t === "add") { const m = rvv.marks.find(x => x.id === a.id); if (m) { rvv.undo.push({ t: "del", m: JSON.parse(JSON.stringify(m)) }); await rvvDelete(a.id, true); } }
  else if (a.t === "del") { await rvvAdd(a.m, true); rvv.undo.push({ t: "add", id: a.m.id }); }
  else if (a.t === "mod") { const m = rvv.marks.find(x => x.id === a.id); if (m) { rvv.undo.push({ t: "mod", id: a.id, before: JSON.parse(JSON.stringify(m)) }); await rvvMod(m, a.before, true); } }
  rvvOv(); rvvMarksPane();
}
const RVV_TYPE = { pin: "Kommentar", arrow: "Pil", rect: "Ruta", hl: "Överstrykning", cloud: "Moln", pen: "Frihand", text: "Text", measure: "Mått" };
function rvvMarksPane(soft, focusText) {
  const el = document.getElementById("rvMarks"); if (!el) return; if (soft && el.contains(document.activeElement) && document.activeElement.tagName === "TEXTAREA" && !focusText) return;
  const sel = rvv.marks.find(x => x.id === rvv.sel), list = [...rvv.marks].sort((a, b) => a.page - b.page || a.n - b.n);
  el.innerHTML = `${sel ? `<div class="rv-edit"><div class="rv-eh"><b>#${sel.n} ${RVV_TYPE[sel.type] || ""}</b><span>sida ${sel.page}</span><button data-mk="del" title="Ta bort (Delete)">🗑</button></div><textarea id="rvMkText" rows="3" placeholder="${sel.type === "text" ? "Text på ritningen" : "Skriv kommentar …"}">${rvEsc(sel.text)}</textarea><div class="rv-es">${Object.entries(RVV_STATUS).map(([k, [l, c]]) => `<button data-st="${k}" class="${sel.status === k ? "on" : ""}" style="--c:${c}">${l}</button>`).join("")}</div>${sel.type === "measure" ? `<div class="rv-meas">${rvEsc(rvvFmtLen(sel) || "Skala saknas – använd ⚖")}</div>` : ""}<small class="rv-by">${rvEsc(sel.by || "")} ${rvEsc(String(sel.created || "").slice(0, 16).replace("T", " "))}</small></div>` : `<p class="rv-hint">Välj ett verktyg ovan och markera på ritningen. Klicka på en markering för att kommentera den.</p>`}
    <div class="rv-ml"><div class="rv-mh">${rvv.marks.length} markeringar${rvv.doc && rvv.doc.scaleW ? ` · skala satt` : ""}</div>${list.map(m => `<button class="rv-mi${m.id === rvv.sel ? " on" : ""}" data-mi="${m.id}"><span class="rv-dot" style="background:${RVV_STATUS[m.status] ? RVV_STATUS[m.status][1] : "#999"}"></span><b>#${m.n}</b> <small>s.${m.page}</small> ${rvEsc((m.text || RVV_TYPE[m.type] || "").slice(0, 60))}</button>`).join("")}</div>`;
  el.onclick = async e => {
    const mi = e.target.closest("[data-mi]"); if (mi) { const m = rvv.marks.find(x => x.id === mi.dataset.mi); if (m) { if (m.page !== rvv.num) { rvv.num = m.page; const i = document.getElementById("rvPageIn"); if (i) i.value = m.page; rvv.sel = m.id; await rvvRender(); } rvv.sel = m.id; rvvOv(); rvvMarksPane(); rvvReveal(m); } return; }
    const s = e.target.closest("[data-st]"); if (s && sel) { await rvvMod(sel, { status: s.dataset.st }); return; }
    if (e.target.closest('[data-mk="del"]') && sel) await rvvDelete(sel.id);
  };
  const ta = document.getElementById("rvMkText"); if (ta && sel) { ta.oninput = () => { sel.text = ta.value; clearTimeout(rvv.tt); rvv.tt = setTimeout(async () => { await rvPut("marks", sel); rvvOv(); }, 350); }; ta.onchange = () => { rvvPush({ t: "mod", id: sel.id, before: { ...JSON.parse(JSON.stringify(sel)), text: ta.dataset.was || "" } }); }; ta.onfocus = () => { ta.dataset.was = sel.text; }; if (focusText) ta.focus(); }
}
function rvvReveal(m) { const st = document.getElementById("rvStage"), b = rvvBBox(m, rvv.W, rvv.H), box = document.getElementById("rvBox"); if (!st || !box) return; st.scrollTo({ left: box.offsetLeft + b.x + b.w / 2 - st.clientWidth / 2, top: box.offsetTop + b.y + b.h / 2 - st.clientHeight / 2, behavior: "smooth" }); }

/* ---- Jämför revisioner ------------------------------------------------------------------------------------------------------------------------- */
function rvvCompareMenu(a) {
  if (rvv.cmpDoc) { rvv.cmpDoc = null; document.getElementById("rvCmp").hidden = true; document.getElementById("rvCv").hidden = false; document.getElementById("rvLegend").hidden = true; a.textContent = "Jämför rev"; return; }
  const others = rv.docs.filter(x => x.key === rvv.doc.key && x.id !== rvv.doc.id).sort((x, y) => rvRevRank(y.rev) - rvRevRank(x.rev));
  rvMenu(a, others.map(o => [`Mot rev ${o.rev || "?"} (${o.name.slice(0, 40)})`, async () => { rvv.cmpDoc = o; a.textContent = "Avsluta jämförelse"; await rvvCompareDraw(); }]));
}
async function rvvCompareDraw() {
  const o = rvv.cmpDoc, cm = document.getElementById("rvCmp"), cv = document.getElementById("rvCv"), lg = document.getElementById("rvLegend"); if (!o || !cm) return;
  try {
    const lib = await rvPdfjs(); if (!rvv.pdfs.has(o.id)) { const b = await rvGet("blobs", o.id); rvv.pdfs.set(o.id, await lib.getDocument({ data: await b.blob.arrayBuffer() }).promise); }
    const pdf2 = rvv.pdfs.get(o.id), pg = await pdf2.getPage(Math.min(rvv.num, pdf2.numPages)), v1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: cv.width / v1.width });
    const oc = document.createElement("canvas"); oc.width = cv.width; oc.height = cv.height; const og = oc.getContext("2d"); og.fillStyle = "#fff"; og.fillRect(0, 0, oc.width, oc.height); await pg.render({ canvasContext: og, viewport: vp }).promise;
    const a = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height), b = og.getImageData(0, 0, oc.width, oc.height), out = cm.getContext("2d").createImageData(cv.width, cv.height), A = a.data, B = b.data, O = out.data;
    for (let i = 0; i < A.length; i += 4) { const na = (A[i] + A[i + 1] + A[i + 2]) / 3 < 170, nb = (B[i] + B[i + 1] + B[i + 2]) / 3 < 170; let r = 255, g = 255, bl = 255; if (na && nb) { r = g = bl = 90; } else if (na) { r = 20; g = 150; bl = 60; } else if (nb) { r = 215; g = 48; bl = 39; } O[i] = r; O[i + 1] = g; O[i + 2] = bl; O[i + 3] = 255; }
    cm.getContext("2d").putImageData(out, 0, 0); cm.hidden = false; cv.hidden = true; lg.hidden = false; lg.innerHTML = `<i style="background:#14963c"></i> nytt (denna rev ${rvEsc(rvv.doc.rev || "")}) <i style="background:#d73027"></i> borttaget (rev ${rvEsc(o.rev || "?")}) <i style="background:#5a5a5a"></i> oförändrat`;
  } catch (e) { rvToast("Kunde inte jämföra: " + ((e && e.message) || e)); rvv.cmpDoc = null; }
}
