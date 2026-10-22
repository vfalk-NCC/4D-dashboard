/* Granskning – export och import (Victor 2026-10-22): granskningsrapport som HTML med bildutsnitt per markering, CSV, och markeringar som fil
   (för att flytta dem mellan datorer/telefon eller skicka till en kollega, som statusfilen i montage-rapporten). */

const rvrDl = (name, data, type) => { const a = document.createElement("a"); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: type || "text/plain;charset=utf-8" })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
const rvrSafe = s => String(s || "granskning").replace(/[^\wåäöÅÄÖ.-]+/g, "_").slice(0, 50);
async function rvrAllMarks() { const docs = new Map(rvScope().map(d => [d.id, d])), all = (await rvAll("marks")).filter(m => docs.has(m.doc)); return all.map(m => ({ m, d: docs.get(m.doc) })).sort((a, b) => (a.d.no || a.d.name).localeCompare(b.d.no || b.d.name, "sv", { numeric: true }) || a.m.page - b.m.page || a.m.n - b.m.n); }
function rvReportMenu(anchor) {
  rvMenu(anchor, [["Exportera huvudmappen (ZIP, senaste ritningarna) …", rvExportMain], ["Granskningsrapport (HTML med bilder) …", rvReport], ["Markeringar som CSV (Excel)", rvrCsv], ["Spara markeringar som fil", rvrSave], ["Läs in markeringar från fil …", rvrLoad]]);
}
async function rvrCsv() {
  const rows = await rvrAllMarks(); if (!rows.length) { rvToast("Inga markeringar att exportera"); return; }
  const head = ["Ritning", "Revision", "Sida", "Nr", "Typ", "Status", "Kommentar", "Av", "Skapad"], q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  rvrDl(`granskning_${rvrSafe((rv.pms.find(p => p.id === rv.pm) || {}).name)}.csv`, "﻿" + [head, ...rows.map(({ m, d }) => [d.no || d.name, d.rev, m.page, m.n, RVV_TYPE[m.type] || m.type, (RVV_STATUS[m.status] || [m.status])[0], m.text, m.by, String(m.created || "").slice(0, 16).replace("T", " ")])].map(r => r.map(q).join(";")).join("\n"), "text/csv;charset=utf-8");
}
async function rvrSave() {
  const rows = await rvrAllMarks(); if (!rows.length) { rvToast("Inga markeringar att spara"); return; }
  const by = new Map(); rows.forEach(({ m, d }) => { (by.get(d.id) || by.set(d.id, { name: d.name, size: d.size, no: d.no, rev: d.rev, scaleW: d.scaleW || null, marks: [] }).get(d.id)).marks.push(m); });
  rvrDl(`granskning_markeringar_${rvrSafe((rv.pms.find(p => p.id === rv.pm) || {}).name)}.json`, JSON.stringify({ kind: "granskning-markeringar", version: 1, saved: new Date().toISOString(), pm: (rv.pms.find(p => p.id === rv.pm) || {}).name, docs: [...by.values()] }), "application/json");
}
function rvrLoad() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text()); if (j.kind !== "granskning-markeringar") throw new Error("Det är inte en markeringsfil från Granskning");
      const have = new Set((await rvAll("marks")).map(m => m.id)); let added = 0, skipped = 0, missing = 0;
      for (const dd of j.docs || []) { const d = rv.docs.find(x => x.name === dd.name && x.size === dd.size) || rv.docs.find(x => x.name === dd.name); if (!d) { missing += (dd.marks || []).length; continue; } if (dd.scaleW && !d.scaleW) { d.scaleW = dd.scaleW; await rvSaveDoc(d); } for (const m of dd.marks || []) { if (have.has(m.id)) { skipped++; continue; } await rvPut("marks", { ...m, doc: d.id }); added++; } }
      await rvMarksCount(); rvRender(); if (rv.open) rvOpenDoc(rv.open, { again: true }); rvToast(`${added} markeringar inlästa${skipped ? `, ${skipped} fanns redan` : ""}${missing ? `, ${missing} hörde till ritningar som inte finns i det här PM:et` : ""}`);
    } catch (e) { rvToast("Kunde inte läsa filen: " + ((e && e.message) || e)); }
  };
  inp.click();
}
/* Bildutsnitt: hela sidan ritas med alla markeringar, sedan klipps området runt markeringen ut. */
async function rvrCrop(d, m, cache) {
  const lib = await rvPdfjs(); let pdf = cache.pdfs.get(d.id); if (!pdf) { const b = await rvGet("blobs", d.id); pdf = await lib.getDocument({ data: await b.blob.arrayBuffer() }).promise; cache.pdfs.set(d.id, pdf); }
  const key = d.id + ":" + m.page; let pg = cache.pages.get(key);
  if (!pg) { const page = await pdf.getPage(m.page), v1 = page.getViewport({ scale: 1 }), k = Math.min(2.6, 2600 / v1.width), vp = page.getViewport({ scale: k }), cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height); const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); await page.render({ canvasContext: g, viewport: vp }).promise; pg = { cv, W: v1.width * 1, H: v1.height * 1, k }; cache.pages.set(key, pg); if (cache.pages.size > 3) cache.pages.delete(cache.pages.keys().next().value); }
  const W = pg.cv.width, H = pg.cv.height, marks = (cache.marks.get(d.id) || []).filter(x => x.page === m.page);
  const sc = document.createElement("canvas"); sc.width = W; sc.height = H; const sg = sc.getContext("2d"); sg.drawImage(pg.cv, 0, 0); const keep = rvv.doc, keepW = rvv.W, keepH = rvv.H, keepS = rvv.doc && rvv.doc.scaleW; rvv.doc = d; rvv.W = W; rvv.H = H;
  try { rvvDraw(sg, marks, W, H, 1, { sel: null, len: mm => { const sw = d.scaleW; if (!sw) return ""; const [a, b] = mm.pts, len = Math.hypot((b[0] - a[0]) * W, (b[1] - a[1]) * H) / W * sw; return len.toFixed(2).replace(".", ",") + " m"; } }); } finally { rvv.doc = keep; rvv.W = keepW; rvv.H = keepH; }
  const b = rvvBBox(m, W, H), mx = Math.max(160, b.w * 0.7), my = Math.max(110, b.h * 0.7), x = Math.max(0, b.x - mx), y = Math.max(0, b.y - my), w = Math.min(W - x, b.w + 2 * mx), h = Math.min(H - y, b.h + 2 * my);
  const out = document.createElement("canvas"), s = Math.min(1, 760 / w); out.width = Math.round(w * s); out.height = Math.round(h * s); const og = out.getContext("2d"); og.drawImage(sc, x, y, w, h, 0, 0, out.width, out.height);
  const ring = document.createElement("canvas"); return out.toDataURL("image/jpeg", 0.72);
}
async function rvReport() {
  const rows = await rvrAllMarks(); if (!rows.length) { rvToast("Inga markeringar att rapportera"); return; }
  const pm = (rv.pms.find(p => p.id === rv.pm) || {}).name || "Granskning", cache = { pdfs: new Map(), pages: new Map(), marks: new Map() }; rows.forEach(({ m }) => { (cache.marks.get(m.doc) || cache.marks.set(m.doc, []).get(m.doc)).push(m); });
  const items = []; let i = 0;
  for (const { m, d } of rows) { i++; rv.msg = `Skapar rapport … ${i} av ${rows.length}`; const box = document.querySelector(".rv-msg"); if (box) box.textContent = rv.msg; else rvRender(true); let img = ""; try { img = await rvrCrop(d, m, cache); } catch (e) { console.warn("Rapportbild", e); } items.push({ m, d, img }); }
  cache.pdfs.forEach(p => { try { p.destroy(); } catch (e) { /* */ } }); rv.msg = ""; rvRender(true);
  const cnt = k => items.filter(x => x.m.status === k).length, E = rvEsc, today = new Date().toISOString().slice(0, 10), by = new Map(); items.forEach(x => { (by.get(x.d.id) || by.set(x.d.id, []).get(x.d.id)).push(x); });
  const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Granskning ${E(pm)}</title><style>
    :root{--ln:#e4e7f0;--mu:#64748b}*{box-sizing:border-box}body{margin:0;font:14px/1.5 Inter,"Segoe UI",system-ui,Arial,sans-serif;color:#0f172a;background:#f4f5fa}.w{max-width:1000px;margin:auto;padding:22px 18px 40px}h1{margin:0;font-size:26px;letter-spacing:-.02em}.sub{color:var(--mu);margin:4px 0 14px}.sum{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 18px}.sum b{display:inline-block;min-width:34px;text-align:center;padding:4px 12px;border-radius:99px;color:#fff;margin-right:4px}
    h2{margin:26px 0 6px;font-size:18px}.card{background:#fff;border:1px solid var(--ln);border-radius:14px;padding:14px;margin:10px 0;display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px;break-inside:avoid}.card img{width:100%;border-radius:8px;border:1px solid var(--ln)}.st{display:inline-block;font-size:11px;font-weight:700;color:#fff;border-radius:99px;padding:2px 10px}.mu{color:var(--mu);font-size:12px}.tx{white-space:pre-wrap;margin:6px 0}
    @media(max-width:760px){.card{grid-template-columns:1fr}}@media print{body{background:#fff}.card{box-shadow:none}}</style></head><body><div class="w"><h1>Granskning – ${E(pm)}</h1><div class="sub">${today} · ${items.length} markeringar på ${by.size} ritningar</div>
    <div class="sum">${Object.entries(RVV_STATUS).map(([k, [l, c]]) => `<span><b style="background:${c}">${cnt(k)}</b>${l}</span>`).join("")}</div>
    ${[...by.values()].map(list => { const d = list[0].d; return `<h2>${E(d.no || d.name)} <span class="mu">${E(d.title)}${d.rev ? " · rev " + E(d.rev) : ""}</span></h2>` + list.map(({ m, img }) => `<div class="card"><div><span class="st" style="background:${(RVV_STATUS[m.status] || ["", "#999"])[1]}">${E((RVV_STATUS[m.status] || [m.status])[0])}</span> <b>#${m.n}</b> <span class="mu">${E(RVV_TYPE[m.type] || m.type)} · sida ${m.page}${m.by ? " · " + E(m.by) : ""} · ${E(String(m.created || "").slice(0, 10))}</span><div class="tx">${E(m.text || "(ingen kommentar)")}</div></div>${img ? `<img src="${img}" alt="Utsnitt ur ritningen">` : ""}</div>`).join(""); }).join("")}</div></body></html>`;
  rvrDl(`granskningsrapport_${rvrSafe(pm)}_${today}.html`, html, "text/html;charset=utf-8");
  rvToast(`Rapport skapad (${(html.length / 1048576).toFixed(1)} MB)`);
}

/* Exportera huvudmappen: senaste revisionen av varje ritning som ZIP, en mapp per delområde. Ren "lagra"-ZIP (ingen komprimering, PDF är redan packat) utan bibliotek. */
const rvzCrc = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = t[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }; })();
async function rvExportMain(list, label) {
  const docs = Array.isArray(list) ? list : rvScope().filter(d => !d.old && d.type === "Bygghandling"); if (!docs.length) { rvToast("Inget att exportera"); return; }
  const enc = new TextEncoder(), parts = [], central = [], used = new Set(); let off = 0; const clean = x => String(x).replace(/[\\/:*?"<>|]+/g, "_").trim() || "x";
  const dt = new Date(), dosT = (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1), dosD = ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate();
  let i = 0;
  for (const d of docs) {
    i++; rv.msg = `Packar ${label || "huvudmappen"} … ${i} av ${docs.length}`; const bx = document.querySelector(".rv-msg"); if (bx) bx.textContent = rv.msg; else rvRender(true);
    const b = await rvGet("blobs", d.id); if (!b) continue; const data = new Uint8Array(await b.blob.arrayBuffer());
    let name = clean(rvZoneName(rvZoneOf(d))) + "/" + clean(d.name); while (used.has(name.toLowerCase())) name = name.replace(/(\.pdf)?$/i, "_" + i + "$1"); used.add(name.toLowerCase());
    const nm = enc.encode(name), crc = rvzCrc(data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    central.push(c.buffer, nm); parts.push(h.buffer, nm, data); off += 30 + nm.length + data.length;
  }
  const cs = central.reduce((a, x) => a + (x.byteLength != null ? x.byteLength : x.length), 0), e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, used.size, true); e.setUint16(10, used.size, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
  rv.msg = ""; rvRender(true);
  rvrDl(`${label ? rvrSafe(label) : "huvudmapp"}_${new Date().toISOString().slice(0, 10)}.zip`, new Blob([...parts, ...central, e.buffer], { type: "application/zip" }), "application/zip");
  rvToast(`${label ? "Valda filer" : "Huvudmappen"} exporterad: ${used.size} filer`);
}
