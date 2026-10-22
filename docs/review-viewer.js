/* Granskning – visaren (Victor 2026-10-22). Sidan ritas med pdf.js; markeringarna ligger i ett eget lager ovanpå (canvas) och sparas normaliserade
   (0–1 av sidans bredd/höjd), så de följer med vid zoom. Verktyg: kommentar (pin), pil, rektangel, markering, moln, penna, text, mått (med inställd skala).
   Smarta funktioner: sök i texten (träffarna lyses upp på sidan), jämför revisioner (rött = bara i gamla, grönt = bara i nya), pinch-zoom och drag på surfplatta/telefon,
   helskärm för fältbruk, rapport med bildutsnitt per markering. */

const RVV_COLORS = ["#e5484d", "#f59e0b", "#2da44e", "#0b5fff", "#8250df", "#1f2328"];
const RVV_STATUS = { open: ["Öppen", "#e5484d"], done: ["Åtgärdad", "#f59e0b"], ok: ["Godkänd", "#2da44e"] };
const RVV_TOOLS = [["hand", "✋", "Flytta/markera – dra för att panorera, klicka på en markering för att välja den"], ["pin", "📍", "Kommentar (pin)"], ["arrow", "➜", "Pil"], ["rect", "▭", "Rektangel"], ["hl", "▬", "Överstrykning"], ["cloud", "☁", "Revisionsmoln"], ["pen", "✎", "Penna"], ["text", "T", "Text på ritningen"], ["callout", "💬", "Callout: klicka där den ska peka – dra sedan bubblan och spetsen dit du vill"], ["measure", "📏", "Mät avstånd (kräver skala)"], ["calib", "⚖", "Sätt skala: rita en linje med känd längd"]];
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
const rvvMeasCtx = document.createElement("canvas").getContext("2d");
/* Callout: bubblan (bx,by = övre vänstra hörnet) och spetsen (x,y) sparas var för sig, normaliserade; textstorleken följer sidans bredd. */
function rvvCoBox(m, W, H) {
  const fp = Math.max(7, (m.fs || 13) * W / 900), lines = String(m.text || " ").split("\n"), pad = fp * 0.7; rvvMeasCtx.font = `${fp}px Arial`;
  const w = Math.max(...lines.map(l => rvvMeasCtx.measureText(l || " ").width)) + pad * 2, h = lines.length * fp * 1.3 + pad * 1.4;
  return { x: m.bx * W, y: m.by * H, w, h, fp, pad, lines };
}
function rvvBBox(m, W, H) {
  if (m.type === "callout") { const b = rvvCoBox(m, W, H), x = Math.min(b.x, m.x * W), y = Math.min(b.y, m.y * H); return { x, y, w: Math.max(b.x + b.w, m.x * W) - x, h: Math.max(b.y + b.h, m.y * H) - y }; }
  if (m.type === "pin") return { x: m.x * W - 12, y: m.y * H - 12, w: 24, h: 24 };
  if (m.pts && m.pts.length) { const xs = m.pts.map(p => p[0] * W), ys = m.pts.map(p => p[1] * H), x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; }
  if (m.type === "text") { const lines = String(m.text || "Text").split("\n"), w = Math.max(...lines.map(l => l.length)) * 7 + 12; return { x: m.x * W, y: m.y * H, w, h: lines.length * 17 + 8 }; }
  return { x: Math.min(m.x, m.x + m.w) * W, y: Math.min(m.y, m.y + m.h) * H, w: Math.abs(m.w) * W, h: Math.abs(m.h) * H };
}
function rvvDraw(ctx, marks, W, H, k, o = {}) {
  ctx.save(); ctx.scale(k, k); ctx.lineCap = "round"; ctx.lineJoin = "round";
  (o.links || []).forEach(r => { ctx.fillStyle = "rgba(11,95,255,.10)"; ctx.fillRect(r[0] * W, r[1] * H, r[2] * W, r[3] * H); ctx.fillStyle = "rgba(11,95,255,.85)"; ctx.fillRect(r[0] * W, (r[1] + r[3]) * H - 1, r[2] * W, 1.6); });
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
    else if (m.type === "callout") {
      const b = rvvCoBox(m, W, H), ax = m.x * W, ay = m.y * H, nx = Math.max(b.x, Math.min(b.x + b.w, ax)), ny = Math.max(b.y, Math.min(b.y + b.h, ay)), r = Math.min(8, b.h / 3);
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(ax, ay); ctx.stroke(); ctx.beginPath(); ctx.arc(ax, ay, 4.5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(b.x + r, b.y); ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, r); ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, r); ctx.arcTo(b.x, b.y + b.h, b.x, b.y, r); ctx.arcTo(b.x, b.y, b.x + b.w, b.y, r); ctx.closePath();
      ctx.fillStyle = m.fill == null ? "#ffffff" : m.fill; ctx.fill(); ctx.stroke();
      ctx.fillStyle = m.tcol || "#1f2328"; ctx.font = `${b.fp}px Arial`; ctx.textAlign = "left"; ctx.textBaseline = "top"; b.lines.forEach((l, i) => ctx.fillText(l, b.x + b.pad, b.y + b.pad * 0.7 + i * b.fp * 1.3));
      if (sel) { ctx.strokeStyle = "#0b5fff"; ctx.fillStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ax, ay, 8, 0, 7); ctx.fill(); ctx.stroke(); }
    }
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
    if (m.type === "callout") { const b = rvvCoBox(m, W, H); if (Math.hypot(px - m.x * W, py - m.y * H) <= 12 || (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h)) return m; continue; }
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
  if (!opt.again) { doc.opened = Date.now(); rvPut("docs", doc).catch(() => {}); }
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
  main.innerHTML = `<div class="rv-view" id="rvView"><div class="rv-bar"><button data-v="back" class="rv-backb" title="Tillbaka till listan">‹ Lista</button>${rv.nav.length ? `<button data-v="navback" title="Tillbaka till föregående ritning">↩ ${rvEsc((rv.docs.find(x => x.id === rv.nav[rv.nav.length - 1].id) || {}).no || "Tillbaka")}</button>` : ""}<b class="rv-title" title="${rvEsc(d.name)}">${rvEsc(d.no || d.name)} <small>${rvEsc(d.title)}</small>${d.rev ? ` <i class="rv-rev">rev ${rvEsc(d.rev)}</i>` : ""}</b>
    <span class="rv-grpb"><button data-v="pdoc" title="Föregående ritning i listan (Skift + ←)">⏮</button><button data-v="prev" title="Föregående sida (←). På första sidan: föregående ritning">‹</button><input id="rvPageIn" type="number" min="1" max="${rvv.pdf.numPages}" value="${rvv.num}" aria-label="Sida"><span>/ ${rvv.pdf.numPages}</span><button data-v="next" title="Nästa sida (→). På sista sidan: nästa ritning">›</button><button data-v="ndoc" title="Nästa ritning i listan (Skift + →)">⏭</button><small class="rv-pos">${rv.order.indexOf(rvv.id) >= 0 ? `ritning ${rv.order.indexOf(rvv.id) + 1}/${rv.order.length}` : ""}</small></span>
    <span class="rv-grpb"><button data-v="zout" title="Zooma ut (−)">−</button><button data-v="fit" title="Anpassa till bredden / hela sidan">⤢</button><button data-v="zin" title="Zooma in (+)">＋</button><span id="rvZ">100 %</span></span>
    <span class="rv-grpb rv-tl">${RVV_TOOLS.map(([k, ic, t]) => `<button data-tool="${k}" class="${rvv.tool === k ? "on" : ""}" title="${rvEsc(t)}">${ic}</button>`).join("")}</span>
    <span class="rv-grpb">${RVV_COLORS.map(c => `<button class="rv-sw${rvv.color === c ? " on" : ""}" data-color="${c}" style="background:${c}" title="Färg" aria-label="Färg"></button>`).join("")}</span>
    <span class="rv-grpb"><button data-v="undo" title="Ångra (Ctrl+Z)">↶</button><button data-v="redo" title="Gör om (Ctrl+Y)">↷</button></span>
    <button data-v="links" class="${rvvLinksOn() ? "on" : ""}" title="Visa/dölj hänvisningarna (understrukna ritningsnummer) i ritningen – dölj dem på tillverkningsritningar och detaljer">🔗 Länkar</button><button data-v="cmp" title="Jämför med en annan revision av samma ritning"${older.length ? "" : " disabled"}>Jämför rev</button><button data-v="side" title="Visa/dölj markeringslistan">Markeringar <em id="rvMkN"></em></button>${rvv.fsWant ? `<select id="rvDocSel" title="Byt ritning">${rv.order.map(id => { const x = rv.docs.find(d => d.id === id); return x ? `<option value="${id}"${id === rvv.id ? " selected" : ""}>${rvEsc((x.no || x.name).slice(0, 28))} ${rvEsc((x.title || "").slice(0, 26))}</option>` : ""; }).join("")}</select>` : ""}<button data-v="fs" title="Helskärm (F) – lämnas bara med ⛶ eller F">⛶</button></div>
    <div class="rv-body"><div class="rv-stage" id="rvStage"><div class="rv-pagebox" id="rvBox"><canvas id="rvCv"></canvas><canvas id="rvCmp" hidden></canvas><canvas id="rvOv"></canvas></div><div class="rv-legend" id="rvLegend" hidden></div></div><aside class="rv-marks" id="rvMarks"></aside></div></div>`;
  rvvWire(); rvvMarksPane();
}
function rvvWire() {
  const v = document.getElementById("rvView"), st = document.getElementById("rvStage");
  v.onclick = e => {
    const b = e.target.closest("button"); if (!b) return; const a = b.dataset.v;
    if (b.dataset.tool) { rvv.tool = b.dataset.tool; v.querySelectorAll("[data-tool]").forEach(x => x.classList.toggle("on", x.dataset.tool === rvv.tool)); rvvCursor(); return; }
    if (b.dataset.color) { rvv.color = b.dataset.color; v.querySelectorAll("[data-color]").forEach(x => x.classList.toggle("on", x.dataset.color === rvv.color)); const m = rvv.marks.find(x => x.id === rvv.sel); if (m) { rvvMod(m, { color: rvv.color }); } return; }
    if (a === "links") { try { localStorage.setItem("4ddash-review-links", rvvLinksOn() ? "0" : "1"); } catch (x) { /* */ } b.classList.toggle("on", rvvLinksOn()); rvvOv(); } else if (a === "pdoc") rvvDocStep(-1); else if (a === "ndoc") rvvDocStep(1); else if (a === "prev") rvvGo(rvv.num - 1); else if (a === "next") rvvGo(rvv.num + 1); else if (a === "zin") rvvZoom(rvv.zoom * 1.25); else if (a === "zout") rvvZoom(rvv.zoom / 1.25);
    else if (a === "fit") { rvv.fitMode = rvv.fitMode === "w" ? "p" : "w"; rvv.zoom = 1; rvvRender(); } else if (a === "undo") rvvUndo(); else if (a === "redo") rvvRedo();
    else if (a === "side") { v.classList.toggle("no-side"); setTimeout(() => rvvRender(), 60); } else if (a === "fs") rvvFs();
    else if (a === "cmp") rvvCompareMenu(b); else if (a === "navback") rvvNavBack(); else if (a === "back") { rv.open = null; rv.nav = []; document.querySelector(".rv-wrap").classList.remove("has-doc"); const m = document.getElementById("rvMain"); rvRender(); }
  };
  { const ds = document.getElementById("rvDocSel"); if (ds) ds.onchange = e => rvOpenDoc(e.target.value, {}); }
  document.getElementById("rvPageIn").onchange = e => rvvGo(Number(e.target.value));
  st.addEventListener("contextmenu", e => { if (rvv.fs) e.preventDefault(); });
  st.addEventListener("mousedown", e => { if (e.button === 1 && rvv.fs) e.preventDefault(); });
  st.addEventListener("wheel", e => { if (e.ctrlKey || e.metaKey || rvv.fs) { e.preventDefault(); const r = st.getBoundingClientRect(); rvvZoom(rvv.zoom * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top); } }, { passive: false });
  st.addEventListener("pointerdown", rvvDown); st.addEventListener("pointermove", rvvMove); st.addEventListener("pointerup", rvvUp); st.addEventListener("pointercancel", rvvUp);
  st.addEventListener("dblclick", e => { if (rvv.tool === "hand" && !rvvHit(...rvvLocal(e))) { rvv.zoom = rvv.zoom > 1.05 ? 1 : 2.2; rvvZoom(rvv.zoom, e.clientX - st.getBoundingClientRect().left, e.clientY - st.getBoundingClientRect().top); } });
  rvvCursor();
}
const rvvLocal = e => { const r = document.getElementById("rvOv").getBoundingClientRect(); return [(e.clientX - r.left) * (rvv.W / r.width), (e.clientY - r.top) * (rvv.H / r.height)]; };
function rvvCursor() { const st = document.getElementById("rvStage"); if (st) st.style.cursor = rvv.tool === "hand" ? "grab" : "crosshair"; }
function rvvDocStep(dir, last) { const i = rv.order.indexOf(rvv.id), t = rv.order[i + dir]; if (i < 0 || !t) { rvToast(dir > 0 ? "Det här är sista ritningen i listan" : "Det här är första ritningen i listan"); return; } rvOpenDoc(t, { page: last ? 9999 : 1 }); }
function rvvGo(n) { n = Math.round(n) || 1; if (n > rvv.pdf.numPages) { rvvDocStep(1); return; } if (n < 1) { rvvDocStep(-1, true); return; } if (n === rvv.num) { const i = document.getElementById("rvPageIn"); if (i) i.value = n; return; } rvv.num = n; rvv.sel = null; const i = document.getElementById("rvPageIn"); if (i) i.value = n; rvvRender(true); rvvMarksPane(); }

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
  rvv.hlRects = rvv.hl ? await rvvHlRects(page, vp) : []; if (tok !== rvv.tok) return; rvv.links = await rvvLinkRects(page, vp);
  if (rvv.cmpDoc) await rvvCompareDraw(); rvvOv(); rvvMarksPane(true);
}
/* Ritningsnummer i texten på sidan som finns som egen ritning i biblioteket blir klickbara (understrukna). Funkar bara på PDF:er med riktig text, inte på inskannade. */
async function rvvLinkRects(page, vp) {
  const out = [], cur = rvv.doc, self = rvNorm(cur && cur.no); if (!rv.numIdx || !rv.numIdx.size) return out;
  try {
    const tc = await page.getTextContent();
    tc.items.forEach(it => {
      const s = it.str || ""; if (s.length < 4) return;
      for (const m of s.matchAll(/[A-ZÅÄÖ0-9][A-ZÅÄÖ0-9]*(?:[-._][A-ZÅÄÖ0-9]+){1,5}|[A-ZÅÄÖ]{1,3}\d{3,}|(?<![A-Za-z0-9])\d{5,9}(?![A-Za-z0-9])/gi)) {
        let raw = m[0], n = rvNorm(raw), d = n !== self ? rvLinkDoc(n, cur) : null;
        if (!d) { const parts = raw.split(/[-._]/); if (parts.length > 2) { raw = raw.slice(0, raw.lastIndexOf(raw.match(/[-._]/g).pop())); n = rvNorm(raw); d = n !== self ? rvLinkDoc(n, cur) : null; } }
        if (!d) continue;
        const t = pdfjsLib.Util.transform(vp.transform, it.transform), wd = (it.width || 0) * vp.scale, h = Math.abs(it.height || Math.hypot(it.transform[2], it.transform[3])) * vp.scale;
        out.push({ r: [(t[4] + wd * m.index / s.length) / vp.width, (t[5] - h) / vp.height, (wd * raw.length / s.length) / vp.width, (h * 1.15) / vp.height], id: d.id });
      }
    });
  } catch (e) { /* utan länkar */ }
  return out;
}
const rvvLinksOn = () => { try { return localStorage.getItem("4ddash-review-links") !== "0"; } catch (e) { return true; } };
const rvvLinkAt = (px, py) => !rvvLinksOn() ? null : (rvv.links || []).find(l => px >= l.r[0] * rvv.W - 2 && px <= (l.r[0] + l.r[2]) * rvv.W + 2 && py >= l.r[1] * rvv.H - 2 && py <= (l.r[1] + l.r[3]) * rvv.H + 2);
function rvvJump(id, page) { if (!id || !rv.docs.find(d => d.id === id)) return; if (rvv.id) rv.nav.push({ id: rvv.id, page: rvv.num }); if (rv.nav.length > 30) rv.nav.shift(); rvOpenDoc(id, { page: page || 1 }); }
function rvvNavBack() { const p = rv.nav.pop(); if (p) rvOpenDoc(p.id, { page: p.page }); }
async function rvvHlRects(page, vp) {
  const words = rvv.hl.toLowerCase().split(/\s+/).filter(w => w.length > 1), out = []; if (!words.length) return out;
  try { const tc = await page.getTextContent(); tc.items.forEach(it => { const s = it.str || "", low = s.toLowerCase(); if (!low) return; words.forEach(w => { let at = low.indexOf(w); while (at >= 0) { const t = pdfjsLib.Util.transform(vp.transform, it.transform), wd = (it.width || 0) * vp.scale * 1, h = Math.abs(it.height || Math.hypot(it.transform[2], it.transform[3])) * vp.scale, x = t[4] + wd * at / s.length, wn = wd * w.length / s.length; out.push([x / vp.width, (t[5] - h) / vp.height, wn / vp.width, (h * 1.15) / vp.height]); at = low.indexOf(w, at + w.length); } }); }); } catch (e) { /* utan träffbild */ }
  return out;
}
function rvvOv(draft) {
  const ov = document.getElementById("rvOv"); if (!ov) return; const g = ov.getContext("2d"); g.clearRect(0, 0, ov.width, ov.height);
  rvvDraw(g, rvvMarks(), rvv.W, rvv.H, rvv.k || 1, { sel: rvv.sel, hl: rvv.hlRects, links: rvvLinksOn() ? (rvv.links || []).map(l => l.r) : [], draft });
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
  if (e.button === 1 && rvv.fs) { e.preventDefault(); rvvHubOpen(e); return; }
  if (e.button === 1 || e.button === 2) { rvv.drag = { t: "pan", sx: e.clientX, sy: e.clientY, l: st.scrollLeft, tp: st.scrollTop }; return; }
  const [px, py] = rvvLocal(e), inside = px >= 0 && py >= 0 && px <= rvv.W && py <= rvv.H, tool = rvv.tool;
  if (tool === "hand" || !inside) {
    const hit = inside ? rvvHit(px, py) : null; const lk = inside && !hit && e.pointerType !== "pen" ? rvvLinkAt(px, py) : null; if (lk) { rvv.drag = { t: "link", id: lk.id, sx: e.clientX, sy: e.clientY, l: st.scrollLeft, tp: st.scrollTop }; return; }
    if (hit) { rvv.sel = hit.id; rvv.drag = { t: "move", m: hit, px, py, before: JSON.stringify(hit), moved: false, part: hit.type === "callout" ? (e.shiftKey || e.ctrlKey ? "all" : Math.hypot(px - hit.x * rvv.W, py - hit.y * rvv.H) <= 12 ? "a" : "b") : "" }; rvvOv(); rvvMarksPane(); rvvCursor(); } else { if (rvv.sel) { rvv.sel = null; rvvOv(); rvvMarksPane(); } rvv.drag = { t: "pan", sx: e.clientX, sy: e.clientY, l: st.scrollLeft, tp: st.scrollTop }; st.style.cursor = "grabbing"; }
    return;
  }
  const x = px / rvv.W, y = py / rvv.H;
  if (tool === "callout") { const m = rvvNew("callout", { x, y, bx: Math.min(0.82, x + 0.05), by: Math.max(0.01, y - 0.07), text: "", fs: 13, fill: "#ffffff", tcol: "#1f2328" }); rvvAdd(m); rvv.sel = m.id; rvvOv(); rvvMarksPane(false, true); return; }
  if (tool === "pin" || tool === "text") { const m = rvvNew(tool, { x, y, text: "" }); rvvAdd(m); rvv.sel = m.id; rvvOv(); rvvMarksPane(false, true); return; }
  if (tool === "pen") rvv.drag = { t: "draw", m: rvvNew("pen", { pts: [[x, y]] }) };
  else if (tool === "arrow" || tool === "measure" || tool === "calib") rvv.drag = { t: "draw", m: rvvNew(tool, { pts: [[x, y], [x, y]] }) };
  else rvv.drag = { t: "draw", m: rvvNew(tool, { x, y, w: 0, h: 0 }) };
}
function rvvMove(e) {
  const st = document.getElementById("rvStage"); if (rvv.ptrs.has(e.pointerId)) { rvv.ptrs.get(e.pointerId).x = e.clientX; rvv.ptrs.get(e.pointerId).y = e.clientY; }
  if (rvv.pinch && rvv.ptrs.size >= 2) { const [a, b] = [...rvv.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); rvvZoom(rvv.pinch.z0 * d / Math.max(1, rvv.pinch.d0), rvv.pinch.cx, rvv.pinch.cy); return; }
  if (rvv.hub) { rvvHubMove(e); return; }
  const dr = rvv.drag; if (!dr) { if (!e.buttons && e.pointerType === "mouse" && rvv.tool === "hand" && st) { const [px, py] = rvvLocal(e); st.style.cursor = px >= 0 && py >= 0 && px <= rvv.W && py <= rvv.H && !rvvHit(px, py) && rvvLinkAt(px, py) ? "pointer" : "grab"; } return; }
  if (dr.t === "link") { if (Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) < 6) return; dr.t = "pan"; st.style.cursor = "grabbing"; }
  if (dr.t === "pan") { st.scrollLeft = dr.l - (e.clientX - dr.sx); st.scrollTop = dr.tp - (e.clientY - dr.sy); return; }
  const [px, py] = rvvLocal(e), x = Math.max(0, Math.min(1, px / rvv.W)), y = Math.max(0, Math.min(1, py / rvv.H));
  if (dr.t === "move") { const dx = (px - dr.px) / rvv.W, dy = (py - dr.py) / rvv.H, m = dr.m; if (Math.abs(px - dr.px) + Math.abs(py - dr.py) < 2 && !dr.moved) return; dr.moved = true; const b = JSON.parse(dr.before); if (m.pts) m.pts = b.pts.map(p => [p[0] + dx, p[1] + dy]); else if (m.type === "callout") { if (dr.part !== "b") { m.x = b.x + dx; m.y = b.y + dy; } if (dr.part !== "a") { m.bx = b.bx + dx; m.by = b.by + dy; } } else { m.x = b.x + dx; m.y = b.y + dy; } rvvOv(); return; }
  const m = dr.m; if (m.pts && m.type === "pen") m.pts.push([x, y]); else if (m.pts) m.pts[1] = [x, y]; else { m.w = x - m.x; m.h = y - m.y; } rvvOv(m);
}
async function rvvUp(e) {
  rvv.ptrs.delete(e.pointerId); const st = document.getElementById("rvStage"); if (rvv.pinch && rvv.ptrs.size < 2) { rvv.pinch = null; rvv.drag = null; return; }
  if (rvv.hub) { rvvHubClose(true); return; }
  const dr = rvv.drag; rvv.drag = null; rvvCursor(); if (!dr) return;
  if (dr.t === "link") { rvvJump(dr.id, 1); return; }
  if (dr.t === "move") { if (dr.moved) { rvvPush({ t: "mod", id: dr.m.id, before: JSON.parse(dr.before) }); dr.m.upd = Date.now(); await rvPut("marks", dr.m); rvsSoon(); } return; }
  if (dr.t !== "draw") return; const m = dr.m, W = rvv.W, H = rvv.H;
  const size = m.pts ? (m.type === "pen" ? m.pts.length * 4 : Math.hypot((m.pts[1][0] - m.pts[0][0]) * W, (m.pts[1][1] - m.pts[0][1]) * H)) : Math.hypot(m.w * W, m.h * H);
  if (size < 6) { rvvOv(); return; }
  if (m.type === "calib") { rvvOv(); const len = Math.hypot((m.pts[1][0] - m.pts[0][0]) * W, (m.pts[1][1] - m.pts[0][1]) * H) / W; const ans = await (typeof dashPrompt === "function" ? dashPrompt("Verklig längd för linjen du ritade, i meter", "") : prompt("Verklig längd i meter", "")); const real = parseFloat(String(ans || "").replace(",", ".")); if (real > 0) { rvv.doc.scaleW = real / len; await rvSaveDoc(rvv.doc); rvToast(`Skala satt: sidans bredd är ${rvv.doc.scaleW.toFixed(1).replace(".", ",")} m`); rvv.tool = "measure"; document.querySelectorAll("[data-tool]").forEach(x => x.classList.toggle("on", x.dataset.tool === "measure")); } rvvOv(); return; }
  if (m.type === "measure" && !rvv.doc.scaleW) rvToast("Sätt skalan först med ⚖ (rita en linje med känd längd)");
  rvvAdd(m); rvv.sel = m.id; rvvOv(); rvvMarksPane(false, m.type === "text");
}
document.addEventListener("keydown", e => {
  const v = document.getElementById("rvView"); if (!v || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable) return;
  if (e.shiftKey && e.key === "ArrowRight") rvvDocStep(1); else if (e.shiftKey && e.key === "ArrowLeft") rvvDocStep(-1); else if (e.key === "ArrowRight" || e.key === "PageDown") rvvGo(rvv.num + 1); else if (e.key === "ArrowLeft" || e.key === "PageUp") rvvGo(rvv.num - 1);
  else if (e.key === "+" || e.key === "=") rvvZoom(rvv.zoom * 1.25); else if (e.key === "-") rvvZoom(rvv.zoom / 1.25); else if (e.key === "f") rvvFs();
  else if ((e.key === "Delete" || e.key === "Backspace") && rvv.sel) { e.preventDefault(); rvvDelete(rvv.sel); } else if (e.key === "Escape") { if (rvv.sel) { rvv.sel = null; rvvOv(); rvvMarksPane(); } }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? rvvRedo() : rvvUndo(); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); rvvRedo(); }
});
/* Verktygshubb: håll in scrollhjulet i helskärm, dra åt ett håll och släpp. */
const RVV_HUB = [["hand", "✋", "Flytta"], ["pin", "📍", "Kommentar"], ["callout", "💬", "Callout"], ["arrow", "➜", "Pil"], ["rect", "▭", "Ruta"], ["hl", "▬", "Markera"], ["cloud", "☁", "Moln"], ["pen", "✎", "Penna"], ["text", "T", "Text"], ["measure", "📏", "Mät"]];
function rvvHubOpen(e) {
  const v = document.getElementById("rvView"); if (!v) return; rvvHubClose(); const R = 150, n = RVV_HUB.length;
  const h = document.createElement("div"); h.className = "rv-hub"; h.style.left = e.clientX + "px"; h.style.top = e.clientY + "px";
  h.innerHTML = `<div class="rv-hub-ring"></div>${RVV_HUB.map(([k, ic, t], i) => { const a = i / n * 2 * Math.PI; return `<div class="rv-hub-it${rvv.tool === k ? " cur" : ""}" data-k="${k}" style="left:${(Math.sin(a) * R).toFixed(1)}px;top:${(-Math.cos(a) * R).toFixed(1)}px"><b>${ic}</b>${t}</div>`; }).join("")}<div class="rv-hub-core">Släpp<br>för att<br>välja</div>`;
  v.appendChild(h); rvv.hub = { el: h, x: e.clientX, y: e.clientY, pick: null };
}
function rvvHubMove(e) {
  const hb = rvv.hub; if (!hb) return; const dx = e.clientX - hb.x, dy = e.clientY - hb.y, d = Math.hypot(dx, dy); let pick = null;
  if (d > 55) { const a = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI), i = Math.round(a / (2 * Math.PI) * RVV_HUB.length) % RVV_HUB.length; pick = RVV_HUB[i][0]; }
  if (pick !== hb.pick) { hb.pick = pick; hb.el.querySelectorAll(".rv-hub-it").forEach(x => x.classList.toggle("on", x.dataset.k === pick)); }
  hb.el.style.setProperty("--dx", Math.max(-40, Math.min(40, dx / 4)) + "px"); hb.el.style.setProperty("--dy", Math.max(-40, Math.min(40, dy / 4)) + "px");
}
function rvvHubClose(apply) {
  const hb = rvv.hub; if (!hb) return; rvv.hub = null; hb.el.remove();
  if (apply && hb.pick) { rvv.tool = hb.pick; document.querySelectorAll("[data-tool]").forEach(x => x.classList.toggle("on", x.dataset.tool === rvv.tool)); rvvCursor(); }
}
/* Helskärm: hela PDF-hubben (#revBox) är helskärmsytan, inte själva visaren – så att den överlever när ritningen byts (visaren byggs om då).
   Tangentbordslås (Chrome/Edge) gör att Esc inte lämnar helskärmen: håll Esc nedtryckt en stund, tryck ⛶ eller F. Lämnar webbläsaren helskärmen ändå
   (Firefox/Safari, eller Esc-hållet) ligger visaren kvar som ett stort fönster över sidan tills du själv stänger den. */
function rvvFs(force) {
  const b = document.getElementById("revBox"); if (!b) return; const want = force != null ? force : !rvv.fsWant;
  if (!want) { rvv.fsWant = false; rvv.fs = false; try { if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); } catch (e) { /* */ } if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); b.classList.remove("fsx", "rv-fsm"); }
  else {
    rvv.fsWant = true; rvv.fs = true; b.classList.add("rv-fsm");
    if (b.requestFullscreen) b.requestFullscreen().then(() => { try { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(["Escape"]).catch(() => {}); } catch (e) { /* */ } }).catch(() => b.classList.add("fsx")); else b.classList.add("fsx");
    rvToast("Helskärm: lämna med ⛶ eller F (Esc lämnar inte längre helskärmen)");
  }
  setTimeout(() => { rvvRender(); rvvBarSync(); }, 150);
}
function rvvBarSync() { const v = document.getElementById("rvView"); if (v) v.classList.toggle("is-fs", !!rvv.fsWant); }
document.addEventListener("fullscreenchange", () => {
  rvvHubClose(); const b = document.getElementById("revBox");
  if (b && rvv.fsWant) { if (document.fullscreenElement === b) b.classList.remove("fsx"); else b.classList.add("fsx"); }
  setTimeout(() => rvvRender(), 120);
});

/* ---- Markeringar: skapa, ändra, ångra, lista -------------------------------------------------------------------------------------------------- */
function rvvNew(type, o) { const n = rvv.marks.reduce((a, m) => Math.max(a, m.n || 0), 0) + 1; return { id: rvId(), doc: rvv.id, page: rvv.num, type, color: rvv.color, status: "open", text: "", n, created: new Date().toISOString(), upd: Date.now(), by: (() => { try { return localStorage.getItem("4ddash-review-author") || ""; } catch (e) { return ""; } })(), ...o }; }
async function rvvAdd(m, noUndo) { rvv.marks.push(m); rv.marks.set(rvv.id, rvv.marks); if (!noUndo) rvvPush({ t: "add", id: m.id }); await rvPut("marks", m); rvsSoon(); rvMarksCount().then(() => { const l = document.getElementById("rvList"); if (l) l.innerHTML = rvListHtml(); }); }
async function rvvMod(m, patch, noUndo) { if (!noUndo) rvvPush({ t: "mod", id: m.id, before: JSON.parse(JSON.stringify(m)) }); Object.assign(m, patch); m.upd = Date.now(); await rvPut("marks", m); rvsSoon(); rvvOv(); rvvMarksPane(true); rvMarksCount().then(() => { const l = document.getElementById("rvList"); if (l) l.innerHTML = rvListHtml(); }); }
async function rvvDelete(id, noUndo) { const m = rvv.marks.find(x => x.id === id); if (!m) return; if (!noUndo) rvvPush({ t: "del", m: JSON.parse(JSON.stringify(m)) }); rvv.marks = rvv.marks.filter(x => x.id !== id); rv.marks.set(rvv.id, rvv.marks); if (rvv.sel === id) rvv.sel = null; await rvDel("marks", id); rvsTombAdd(id); rvsSoon(); rvvOv(); rvvMarksPane(); rvMarksCount().then(() => { const l = document.getElementById("rvList"); if (l) l.innerHTML = rvListHtml(); }); }
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
const RVV_TYPE = { pin: "Kommentar", arrow: "Pil", rect: "Ruta", hl: "Överstrykning", cloud: "Moln", pen: "Frihand", text: "Text", measure: "Mått", callout: "Callout" };
function rvvMarksPane(soft, focusText) {
  const el = document.getElementById("rvMarks"); if (!el) return; if (soft && el.contains(document.activeElement) && document.activeElement.tagName === "TEXTAREA" && !focusText) return;
  const sel = rvv.marks.find(x => x.id === rvv.sel), list = [...rvv.marks].sort((a, b) => a.page - b.page || a.n - b.n);
  el.innerHTML = `${sel ? `<div class="rv-edit"><div class="rv-eh"><b>#${sel.n} ${RVV_TYPE[sel.type] || ""}</b><span>sida ${sel.page}</span><button data-mk="del" title="Ta bort (Delete)">🗑</button></div><textarea id="rvMkText" rows="3" placeholder="${sel.type === "text" ? "Text på ritningen" : "Skriv kommentar …"}">${rvEsc(sel.text)}</textarea><div class="rv-es">${Object.entries(RVV_STATUS).map(([k, [l, c]]) => `<button data-st="${k}" class="${sel.status === k ? "on" : ""}" style="--c:${c}">${l}</button>`).join("")}</div>${sel.type === "callout" ? `<div class="rv-co"><label>Textstorlek <select id="rvCoFs">${[9, 11, 13, 16, 20, 26, 34].map(n => `<option value="${n}"${(sel.fs || 13) === n ? " selected" : ""}>${n}</option>`).join("")}</select></label><div>Bubbla ${["#ffffff", "#fff3a3", "#ffd6d6", "#d6f0ff", "#d9f7d9", "rgba(255,255,255,0)"].map(c => `<button class="rv-sw${(sel.fill == null ? "#ffffff" : sel.fill) === c ? " on" : ""}" data-fill="${c}" style="background:${c === "rgba(255,255,255,0)" ? "repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/8px 8px" : c}" title="Bubblans färg" aria-label="Bubblans färg"></button>`).join("")}</div><div>Text ${["#1f2328", "#e5484d", "#0b5fff", "#2da44e", "#ffffff"].map(c => `<button class="rv-sw${(sel.tcol || "#1f2328") === c ? " on" : ""}" data-tcol="${c}" style="background:${c}" title="Textfärg" aria-label="Textfärg"></button>`).join("")}</div><small class="rv-hint">Färgen i verktygsraden styr ram och spets. Dra bubblan för att flytta den, dra spetsen (ringen) för att flytta den. Skift/Ctrl flyttar båda.</small></div>` : ""}${sel.type === "measure" ? `<div class="rv-meas">${rvEsc(rvvFmtLen(sel) || "Skala saknas – använd ⚖")}</div>` : ""}<small class="rv-by">${rvEsc(sel.by || "")} ${rvEsc(String(sel.created || "").slice(0, 16).replace("T", " "))}</small></div>` : `<p class="rv-hint">Välj ett verktyg ovan och markera på ritningen. Klicka på en markering för att kommentera den.</p>`}
    <div class="rv-ml"><div class="rv-mh">${rvv.marks.length} markeringar${rvv.doc && rvv.doc.scaleW ? ` · skala satt` : ""}</div>${list.map(m => `<button class="rv-mi${m.id === rvv.sel ? " on" : ""}" data-mi="${m.id}"><span class="rv-dot" style="background:${RVV_STATUS[m.status] ? RVV_STATUS[m.status][1] : "#999"}"></span><b>#${m.n}</b> <small>s.${m.page}</small> ${rvEsc((m.text || RVV_TYPE[m.type] || "").slice(0, 60))}</button>`).join("")}</div>`;
  const refs = rvRefs(), outs = [...(refs.out.get(rvv.doc.id) || new Map())], ins = [...(refs.inc.get(rvv.doc.id) || new Map())], chip = go => ([id, pg]) => { const t = rv.docs.find(x => x.id === id); return t ? `<button class="rv-lk" data-lk="${id}" data-pg="${pg}" title="${rvEsc(t.title || t.name)} – nämns på sida ${pg}"><b>${rvEsc(t.no || t.name)}</b>${t.rev ? ` <i>${rvEsc(t.rev)}</i>` : ""} <small>s.${pg}</small></button>` : ""; };
  if (outs.length || ins.length) el.insertAdjacentHTML("beforeend", `<div class="rv-links">${outs.length ? `<div class="rv-mh">Hänvisar till (${outs.length})</div><div class="rv-lkl">${outs.slice(0, 40).map(chip(false)).join("")}</div>` : ""}${ins.length ? `<div class="rv-mh">Hänvisas från (${ins.length})</div><div class="rv-lkl">${ins.slice(0, 40).map(chip(true)).join("")}</div>` : ""}</div>`);
  el.onclick = async e => {
    const fl = e.target.closest("[data-fill]"); if (fl && sel) { await rvvMod(sel, { fill: fl.dataset.fill }); return; } const tc = e.target.closest("[data-tcol]"); if (tc && sel) { await rvvMod(sel, { tcol: tc.dataset.tcol }); return; }
    const lk = e.target.closest("[data-lk]"); if (lk) { rvvJump(lk.dataset.lk, Number(lk.dataset.pg) || 1); return; }
    const mi = e.target.closest("[data-mi]"); if (mi) { const m = rvv.marks.find(x => x.id === mi.dataset.mi); if (m) { if (m.page !== rvv.num) { rvv.num = m.page; const i = document.getElementById("rvPageIn"); if (i) i.value = m.page; rvv.sel = m.id; await rvvRender(); } rvv.sel = m.id; rvvOv(); rvvMarksPane(); rvvReveal(m); } return; }
    const s = e.target.closest("[data-st]"); if (s && sel) { await rvvMod(sel, { status: s.dataset.st }); return; }
    if (e.target.closest('[data-mk="del"]') && sel) await rvvDelete(sel.id);
  };
  el.onchange = e => { if (e.target.id === "rvCoFs" && sel) rvvMod(sel, { fs: Number(e.target.value) }); };
  const ta = document.getElementById("rvMkText"); if (ta && sel) { ta.oninput = () => { sel.text = ta.value; sel.upd = Date.now(); clearTimeout(rvv.tt); rvv.tt = setTimeout(async () => { await rvPut("marks", sel); rvsSoon(); rvvOv(); }, 350); }; ta.onchange = () => { rvvPush({ t: "mod", id: sel.id, before: { ...JSON.parse(JSON.stringify(sel)), text: ta.dataset.was || "" } }); }; ta.onfocus = () => { ta.dataset.was = sel.text; }; if (focusText) ta.focus(); }
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
