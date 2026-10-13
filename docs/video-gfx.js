/* Video editorns grafik – samma ritning som filmen i 3D-editorn (4D-planering: lagesplan-3dfilmfx.js och tidslinjen i
   lagesplan-3dfilm.js), så att filmerna ser likadana ut: datumskylt med veckan som rullar, förloppsmätare med ring,
   "Pågår nu" per område (nya glider in, klara bockas av) och milstolpsrubrik, samt tidslinjen med månader, veckor och dagar.
   Ritkoden är en kopia; här finns bara anpassningen till dashboardens aktiviteter (vgxStart/vgxFrame/vgxDraw). */

const VGX_DAY = 86400000;
const VGX_MON = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const vgxDate = s => new Date(String(s).slice(0, 10) + "T00:00:00Z");
const vgxIso = d => d.toISOString().slice(0, 10);
const vgxMonday = s => { const d = vgxDate(s); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d; };
const vgxWeekNo = d => isoWeekNumber(d);
const vgxEase = u => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
const vgxRR = (ctx, x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };
const vgxPhaseCol = (a, iso) => STATUS_COLORS[ganttPhaseAt(a, iso)] || "#888888";

/* Förberedelse när filmen startar: aktiviteterna (som Gantt-schemat visar dem), förloppet och milstolparna. */
function vgxStart(from, to, o) {
  const merged = mergeActivityGroups((typeof ganttShownItems !== "undefined" ? ganttShownItems : []).filter(x => x.startDate && x.endDate));
  const acts = merged.map(a => ({ ...a, key: a.activityKey || String(a.id), name: itemLabel(a), area: a.area || "(utan område)", objs: [], rows: [a],
    t0: vgxDate(a.startDate).getTime(), t1: vgxDate(a.actualEndDate && a.actualEndDate > a.endDate ? a.actualEndDate : a.endDate).getTime() + VGX_DAY }));
  const fx = { o: { date: true, meter: true, now: true, miles: true, bl: false, legend: false, etab: false, signs: false, ...o }, acts, seen: new Map(), gone: [], prev: new Set(), week: null, banner: null, passed: new Set(), active: [], t: null, miles: [] };
  fx.miles = fx.o.miles ? (typeof milestones !== "undefined" ? milestones : []).filter(m => m && m.name && m.target_date).map(m => ({ name: String(m.name), date: String(m.target_date).slice(0, 10) })).filter(m => m.date >= from && m.date <= to) : [];
  const W = acts.reduce((s, a) => s + (a.t1 - a.t0), 0) || 1, part = (t, s, e) => (t <= s ? 0 : t >= e ? 1 : (t - s) / (e - s));
  fx.prog = t => acts.reduce((s, a) => s + part(t, a.t0, a.t1) * (a.t1 - a.t0), 0) / W;
  fx.areas = new Map();
  acts.forEach(a => { const e = fx.areas.get(a.area) || { acts: [], W: 0 }; e.acts.push(a); e.W += a.t1 - a.t0; fx.areas.set(a.area, e); });
  fx.areaProg = (area, t) => { const e = fx.areas.get(area); return e ? e.acts.reduce((sm, a) => sm + part(t, a.t0, a.t1) * (a.t1 - a.t0), 0) / (e.W || 1) : 0; };
  fx.hasBl = false; fx.cache = new Map(); fx.toasts = [];
  fx.range = [vgxDate(from).getTime(), Math.max(vgxDate(to).getTime(), vgxDate(from).getTime() + VGX_DAY)];
  return fx;
}
/* Före varje bild i tur och ordning: vilka aktiviteter som pågår (in/ut), veckan som rullar och milstolpar. ft = filmens tid i sekunder. */
function vgxFrame(fx, iso, ft, tms) {
  const t = fx.t = Number.isFinite(tms) ? tms : vgxDate(iso).getTime() + VGX_DAY / 2;
  const act = fx.acts.filter(a => a.t0 <= t && a.t1 > t);
  const keys = new Set(act.map(a => a.key));
  act.forEach(a => { if (!fx.seen.has(a.key)) fx.seen.set(a.key, ft); });
  fx.prev.forEach(k => { if (!keys.has(k)) { const a = fx.acts.find(x => x.key === k); if (a && a.t1 <= t) fx.gone.push({ a, at: ft }); fx.seen.delete(k); } });
  fx.gone = fx.gone.filter(g => ft - g.at < 1.4);
  fx.prev = keys; fx.active = act;
  const wk = vgxWeekNo(vgxDate(iso));
  if (!fx.week) fx.week = { cur: wk, prev: wk, at: -9 };
  else if (fx.week.cur !== wk) fx.week = { cur: wk, prev: fx.week.cur, at: ft };
  fx.miles.forEach(m => { if (m.date <= iso && !fx.passed.has(m.name + m.date)) { fx.passed.add(m.name + m.date); if (ft > 0.05) fx.banner = { m, at: ft }; } });
  if (fx.banner && ft - fx.banner.at > 2.8) fx.banner = null;
}
/* Hela grafiken i en bild. pearls = tidslinjen längst ner. */
function vgxDraw(ctx, W, H, iso, ft, fx, pearls) {
  const s = H / 1080, o = fx.o, t = Number.isFinite(fx.t) ? fx.t : vgxDate(iso).getTime() + VGX_DAY / 2;
  ctx.save(); ctx.textBaseline = "middle";
  if (pearls) vgsDrawFrame(ctx, W, H, iso, fx.range);
  if (o.date) vgxDate2(ctx, s, iso, ft, fx, "");
  if (o.meter) vgxMeter(ctx, W, s, t, fx);
  if (o.now) vgxNow(ctx, W, H, s, iso, ft, fx, pearls, t);
  if (o.miles && fx.banner) vgxBanner(ctx, W, s, ft, fx.banner);
  ctx.restore();
}

/* ---- Ritkoden (kopia från 3D-editorn) ---------------------------------------------------------------------- */
/* Datumskylten: VECKA + numret (rullar vid veckobyte) och datumet. */
function vgxDate2(ctx, s, iso, ft, fx, caption) {
  const d = vgxDate(iso), x = 32 * s, y = 32 * s, h = 112 * s, dateTxt = `${d.getUTCDate()} ${VGX_MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  ctx.font = `600 ${Math.round(30 * s)}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const w = Math.max(250 * s, 150 * s + ctx.measureText(dateTxt).width + 40 * s);
  ctx.fillStyle = "rgba(15,23,42,.78)"; vgxRR(ctx, x, y, w, h, 18 * s); ctx.fill();
  ctx.fillStyle = "#a5b4fc"; ctx.font = `700 ${Math.round(15 * s)}px system-ui, sans-serif`; ctx.fillText("VECKA", x + 24 * s, y + 26 * s);
  // Numret: det gamla glider upp och ut, det nya in underifrån (0,45 s).
  const u = vgxEase((ft - fx.week.at) / 0.45), bx = x + 20 * s, by = y + 38 * s, bw = 110 * s, bh = 66 * s;
  ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
  ctx.font = `800 ${Math.round(62 * s)}px system-ui, sans-serif`; ctx.fillStyle = "#fff";
  if (u < 1) { ctx.globalAlpha = 1 - u; ctx.fillText(String(fx.week.prev), bx + 4 * s, by + bh / 2 - u * bh); }
  ctx.globalAlpha = u; ctx.fillText(String(fx.week.cur), bx + 4 * s, by + bh / 2 + (1 - u) * bh);
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(x + 140 * s, y + 22 * s, 2 * s, h - 44 * s);
  ctx.fillStyle = "#e2e8f0"; ctx.font = `600 ${Math.round(30 * s)}px system-ui, sans-serif`; ctx.fillText(dateTxt, x + 160 * s, y + h / 2 + 2 * s);
  if (caption) { ctx.font = `700 ${Math.round(28 * s)}px system-ui, sans-serif`; ctx.lineWidth = 6 * s; ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineJoin = "round"; ctx.strokeText(caption, x + 4 * s, y + h + 34 * s); ctx.fillStyle = "#0f172a"; ctx.fillText(caption, x + 4 * s, y + h + 34 * s); }
}

/* Förloppsmätaren uppe till höger: ring, andel klart och hur många aktiviteter som är klara
   (valbart: dagar före/efter baslinjen). */
function vgxMeter(ctx, W, s, t, fx) {
  const p = fx.prog(t), ahead = fx.o.bl ? vgxAhead(fx, t) : null, nDone = fx.acts.filter(a => a.t1 <= t).length;
  const bl = ahead == null ? "" : ahead > 0 ? `${ahead} ${ahead === 1 ? "dag" : "dagar"} före baslinjen` : ahead < 0 ? `${-ahead} ${ahead === -1 ? "dag" : "dagar"} efter baslinjen` : "Enligt baslinjen";
  const sub = `${nDone} av ${fx.acts.length} aktiviteter klara`;
  ctx.font = `600 ${Math.round(16 * s)}px system-ui, sans-serif`; const tw = Math.max(ctx.measureText(sub).width, bl ? ctx.measureText(bl).width : 0);
  const h = (bl ? 134 : 112) * s, w = Math.max(300 * s, 128 * s + tw + 28 * s), x = W - 32 * s - w, y = 32 * s, cx = x + 62 * s, cy = y + h / 2, r = 36 * s;
  ctx.fillStyle = "rgba(15,23,42,.8)"; vgxRR(ctx, x, y, w, h, 20 * s); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.lineWidth = 1.5 * s; vgxRR(ctx, x + 0.75 * s, y + 0.75 * s, w - 1.5 * s, h - 1.5 * s, 20 * s); ctx.stroke();
  // Ringen: spår, fyllning med övertoning och en lysande prick i änden; i mitten en bock när allt är klart.
  ctx.lineCap = "round"; ctx.lineWidth = 9 * s;
  ctx.strokeStyle = "rgba(255,255,255,.1)"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  const a1 = -Math.PI / 2 + Math.PI * 2 * Math.max(0.002, p), g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r); g.addColorStop(0, "#6ee7b7"); g.addColorStop(1, "#16a34a");
  ctx.strokeStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, a1); ctx.stroke();
  ctx.save(); ctx.shadowColor = "rgba(52,211,153,.9)"; ctx.shadowBlur = 14 * s; ctx.fillStyle = "#ecfdf5"; ctx.beginPath(); ctx.arc(cx + r * Math.cos(a1), cy + r * Math.sin(a1), 5.5 * s, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.strokeStyle = p >= 0.999 ? "#4ade80" : "rgba(255,255,255,.55)"; ctx.lineWidth = 4 * s;
  if (p >= 0.999) { ctx.beginPath(); ctx.moveTo(cx - 12 * s, cy); ctx.lineTo(cx - 3 * s, cy + 9 * s); ctx.lineTo(cx + 13 * s, cy - 9 * s); ctx.stroke(); }
  else { ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.beginPath(); ctx.arc(cx, cy, 6 * s, 0, Math.PI * 2); ctx.fill(); }
  const tx = x + 124 * s, top = y + (bl ? 30 : 30) * s;
  ctx.font = `700 ${Math.round(13 * s)}px system-ui, sans-serif`; ctx.fillStyle = "#a5b4fc"; ctx.fillText("PROJEKTET KLART", tx, top);
  ctx.font = `800 ${Math.round(34 * s)}px system-ui, sans-serif`; ctx.fillStyle = "#fff"; ctx.fillText(`${(p * 100).toFixed(1).replace(".", ",")} %`, tx, top + 30 * s);
  ctx.font = `600 ${Math.round(16 * s)}px system-ui, sans-serif`; ctx.fillStyle = "#cbd5e1"; ctx.fillText(sub, tx, top + 60 * s);
  if (bl) { ctx.fillStyle = ahead > 0 ? "#86efac" : ahead < 0 ? "#fca5a5" : "#cbd5e1"; ctx.fillText(bl, tx, top + 84 * s); }
}

/* Pågår nu (Victor 2026-10-12: "743 Krosshall som rubrik, sedan pågående akt. under respektive rubrik … aktens
   text på två rader, så små att alla aktiva får plats"): områdena som rubriker med sitt förlopp och under varje
   rubrik alla pågående aktiviteter – texten utan områdets namn, högst två rader, med en liten stapel. Texten
   krymps tills allt får plats; först om det ändå inte räcker bläddras områdena. */
/* Områdets rubrik: bara sista ledet (Victor 2026-10-12: "ta bort Produktion ur rubrik") – "Produktion / 741 Sektionsfickor"
   → "741 Sektionsfickor". "Excel · " behålls när båda planeringarna visas. */
function vgxAreaHead(area) {
  const x = String(area || ""), pre = x.startsWith("Excel · ") ? "Excel · " : "", parts = x.slice(pre.length).split(/\s+\/\s+/).map(p => p.trim()).filter(Boolean);
  return pre + (parts.length ? parts[parts.length - 1] : x.slice(pre.length).trim());
}
function vgxActText(a) {
  let n = String(a.name || "").trim();
  const full = String(a.area || "").replace(/^Excel · /, "").trim(), ar = vgxAreaHead(full).replace(/^Excel · /, "");
  // Områdesnamnet först på raden tas bort ("743 Krosshall – Bergstag" → "Bergstag"): det står redan i rubriken.
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), code = (ar.match(/^\d+[A-Za-z]?/) || [""])[0];
  const strip = t => {
    let v = String(t || "").trim();
    [full, ar].filter(Boolean).forEach(z => { v = v.replace(new RegExp("^\\s*" + esc(z) + "\\s*[-–—:·,/]?\\s*", "i"), ""); });
    if (code) v = v.replace(new RegExp("^\\s*" + esc(code) + "\\b\\s*[-–—:·,/]?\\s*"), "");
    return v.trim();
  };
  n = strip(n);
  // Det som faktiskt pågår: från Powerproject är aktiviteten ofta bara sammanfattningsraden (= området) och
  // uppgifterna ligger i objektnamnen – de visas, med aktivitetens eget namn först om det säger något mer.
  const same = !n || n.toLowerCase() === ar.toLowerCase() || n.toLowerCase() === full.toLowerCase();
  const objs = (a.objs || []).map(o => strip(o) || o).filter(Boolean);
  const parts = [same ? "" : n, objs.length ? objs.join(", ") : ""].filter(Boolean);
  return parts.length ? parts.join(" – ") : (a.rows && a.rows[0] && a.rows[0].object_name) || a.name;
}
function vgxWrap(ctx, txt, maxW, lines = 2) {
  const words = String(txt).split(/\s+/).filter(Boolean), out = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const tryL = cur ? cur + " " + words[i] : words[i];
    if (ctx.measureText(tryL).width <= maxW || !cur) { cur = tryL; continue; }
    out.push(cur); cur = words[i];
    if (out.length === lines - 1) { cur = words.slice(i).join(" "); break; }
  }
  if (cur) out.push(cur);
  const last = out.length - 1;
  if (last >= 0 && ctx.measureText(out[last]).width > maxW) { let t = out[last]; while (t.length > 2 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1); out[last] = t.trim() + "…"; }
  return out.slice(0, lines);
}
function vgxNow(ctx, W, H, s, iso, ft, fx, pearls, t) {
  // Alla pågående aktiviteter syns hela tiden (Victor 2026-10-12): likadana uppgifter i ett område slås ihop
  // (×3), texten krymps, sedan en rad per uppgift och till sist två eller tre kolumner – ingen bläddring.
  const act = fx.active || [];
  const byArea = new Map();
  act.slice().sort((a, b) => a.t0 - b.t0 || a.name.localeCompare(b.name, "sv")).forEach(a => { if (!byArea.has(a.area)) byArea.set(a.area, { area: a.area, acts: [], done: [] }); byArea.get(a.area).acts.push(a); });
  fx.gone.forEach(g => { if (!byArea.has(g.a.area)) byArea.set(g.a.area, { area: g.a.area, acts: [], done: [], fading: g }); byArea.get(g.a.area).done.push(g); });
  const groups = [...byArea.values()].sort((a, b) => a.area.localeCompare(b.area, "sv", { numeric: true })).map(g => {
    const rows = new Map();
    g.acts.forEach(a => { const tx = vgxActText(a); if (!rows.has(tx)) rows.set(tx, { tx, acts: [], done: null }); rows.get(tx).acts.push(a); });
    g.done.forEach(d => { const tx = vgxActText(d.a); if (!rows.has(tx)) rows.set(tx, { tx, acts: [], done: d }); else if (!rows.get(tx).acts.length) rows.get(tx).done = d; });
    return { ...g, rows: [...rows.values()] };
  });
  const bottom = H - (pearls ? 104 : 28) * s, maxH = bottom - 190 * s, gapC = 10 * s, pad = 14 * s;
  const M = k => ({ head: 50 * s, gHead: 46 * s * Math.max(0.7, k), fs: 15 * s * k, lh: 17.5 * s * k, rowPad: 6 * s * k, gap: 7 * s });
  const colW = cols => (cols === 1 ? 520 : cols === 2 ? 420 : 360) * s;
  const lay = (k, lines, cols) => {
    const m = M(k), cw = colW(cols), textW = cw - 2 * pad - 150 * s;
    ctx.font = `600 ${Math.round(m.fs)}px system-ui, sans-serif`;
    const gh = groups.map(g => m.gHead + g.rows.reduce((h, r) => h + Math.max(1, vgxWrap(ctx, r.tx + (r.acts.length > 1 ? ` ×${r.acts.length}` : ""), textW, lines).length) * m.lh + m.rowPad, 0) + 4 * s);
    // Områdena fördelas på kolumnerna i ordning, så jämnt som möjligt.
    const total = gh.reduce((a, b) => a + b + m.gap, 0), target = total / cols, colsOut = [[]]; let acc = 0;
    gh.forEach((h, gi) => { if (acc > 0 && acc + h / 2 > target && colsOut.length < cols) { colsOut.push([]); acc = 0; } colsOut[colsOut.length - 1].push(gi); acc += h + m.gap; });
    const colH = colsOut.map(c => c.reduce((a, gi) => a + gh[gi] + m.gap, 0));
    return { m, k, lines, cols: colsOut, gh, cw, textW, h: m.head + Math.max(0, ...colH) + 6 * s };
  };
  let L = null;
  for (const [lines, cols] of [[2, 1], [1, 1], [1, 2], [1, 3]]) {
    for (let k = 1; k >= 0.5; k -= 0.05) { const l = lay(k, lines, cols); if (l.h <= maxH) { L = l; break; } }
    if (L) break;
  }
  if (!L) L = lay(0.5, 1, 3);
  const m = L.m, w = L.cols.length * L.cw + (L.cols.length - 1) * gapC, h = groups.length ? L.h : m.head + 40 * s, x = W - 28 * s - w, y = bottom - h;
  ctx.fillStyle = "rgba(15,23,42,.84)"; vgxRR(ctx, x - 6 * s, y, w + 12 * s, h, 20 * s); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.lineWidth = 1.5 * s; vgxRR(ctx, x - 5.25 * s, y + 0.75 * s, w + 10.5 * s, h - 1.5 * s, 20 * s); ctx.stroke();
  ctx.fillStyle = "#22c55e"; ctx.beginPath(); ctx.arc(x + 22 * s, y + 26 * s, 5 * s * (0.8 + 0.2 * Math.sin(ft * 5)), 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#a5b4fc"; ctx.font = `700 ${Math.round(15 * s)}px system-ui, sans-serif`; ctx.fillText("PÅGÅR NU", x + 36 * s, y + 27 * s);
  ctx.textAlign = "right"; ctx.fillStyle = "#cbd5e1"; ctx.font = `600 ${Math.round(14 * s)}px system-ui, sans-serif`;
  ctx.fillText(act.length ? `${act.length} ${act.length === 1 ? "aktivitet" : "aktiviteter"} · ${groups.filter(g => g.acts.length).length} områden` : "", x + w - 16 * s, y + 27 * s); ctx.textAlign = "left";
  if (!groups.length) { ctx.fillStyle = "#94a3b8"; ctx.font = `500 ${Math.round(16 * s)}px system-ui, sans-serif`; ctx.fillText("Inga aktiviteter just nu", x + 20 * s, y + m.head + 14 * s); return; }
  L.cols.forEach((col, ci) => {
    let cy = y + m.head;
    const cx0 = x + ci * (L.cw + gapC) - pad + 6 * s;
    col.forEach(gi => {
      const g = groups[gi], gh = L.gh[gi];
      const seen = Math.min(...(g.acts.length ? g.acts.map(a => fx.seen.get(a.key) ?? -9) : [-9]));
      const inA = vgxEase((ft - seen) / 0.5), outA = g.fading ? 1 - vgxEase(((ft - g.fading.at) / 1.4 - 0.4) / 0.6) : 1;
      ctx.save(); ctx.globalAlpha *= Math.min(inA, outA); ctx.translate((1 - inA) * 30 * s, 0);
      ctx.fillStyle = "rgba(255,255,255,.05)"; vgxRR(ctx, cx0 + pad, cy, L.cw - 2 * pad + 4 * s, gh, 12 * s); ctx.fill();
      const ap = fx.areaProg(g.area, t), col = g.acts.length ? vgxPhaseCol(g.acts[0], iso) : "#22c55e";
      ctx.fillStyle = col; vgxRR(ctx, cx0 + pad, cy, 5 * s, gh, 2.5 * s); ctx.fill();
      const hx = cx0 + pad + 16 * s, hw = L.cw - 2 * pad - 26 * s, hfs = Math.round(19 * s * Math.max(0.75, L.k));
      ctx.font = `800 ${hfs}px system-ui, sans-serif`; ctx.fillStyle = "#fff";
      const ah = vgxAreaHead(g.area); let an = ah; while (an.length > 3 && ctx.measureText(an).width > hw - 70 * s) an = an.slice(0, -2); if (an !== ah) an = an.trim() + "…";
      ctx.fillText(an, hx, cy + m.gHead * 0.4);
      ctx.textAlign = "right"; ctx.fillText(`${Math.floor(ap * 100)} %`, hx + hw, cy + m.gHead * 0.4); ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,.12)"; vgxRR(ctx, hx, cy + m.gHead * 0.74, hw, 5 * s, 2.5 * s); ctx.fill();
      ctx.fillStyle = col; vgxRR(ctx, hx, cy + m.gHead * 0.74, Math.max(5 * s, hw * ap), 5 * s, 2.5 * s); ctx.fill();
      let ry = cy + m.gHead + 2 * s;
      g.rows.forEach(r => {
        const done = !r.acts.length && r.done, list = r.acts.length ? r.acts : [r.done.a];
        const p = done ? 1 : list.reduce((sm, a) => sm + Math.max(0, Math.min(1, (t - a.t0) / (a.t1 - a.t0))), 0) / list.length;
        const rc = done ? "#22c55e" : vgxPhaseCol(list[0], iso);
        ctx.font = `600 ${Math.round(m.fs)}px system-ui, sans-serif`;
        const lines = vgxWrap(ctx, r.tx + (r.acts.length > 1 ? ` ×${r.acts.length}` : ""), L.textW, L.lines), rh = lines.length * m.lh;
        ctx.save(); if (done) ctx.globalAlpha *= 1 - vgxEase(((ft - r.done.at) / 1.4 - 0.4) / 0.6);
        ctx.fillStyle = rc; ctx.beginPath(); ctx.arc(hx + 4 * s, ry + m.lh / 2, Math.max(2.5 * s, 4.5 * s * L.k), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#e2e8f0"; lines.forEach((ln, li) => ctx.fillText(ln, hx + 14 * s, ry + m.lh / 2 + li * m.lh));
        const sbw = 64 * s, sbx = hx + hw - sbw - 48 * s, by = ry + rh / 2 - 2.5 * s;
        ctx.fillStyle = "rgba(255,255,255,.12)"; vgxRR(ctx, sbx, by, sbw, 5 * s, 2.5 * s); ctx.fill();
        ctx.fillStyle = rc; vgxRR(ctx, sbx, by, Math.max(5 * s, sbw * p), 5 * s, 2.5 * s); ctx.fill();
        ctx.textAlign = "right"; ctx.fillStyle = done ? "#86efac" : "#cbd5e1"; ctx.font = `700 ${Math.round(Math.max(11 * s, m.fs))}px system-ui, sans-serif`;
        ctx.fillText(done ? "Klar" : `${Math.floor(p * 100)} %`, hx + hw, ry + rh / 2 + 1 * s); ctx.textAlign = "left";
        ctx.restore();
        ry += rh + m.rowPad;
      });
      ctx.restore();
      cy += gh + m.gap;
    });
  });
}

/* Milstolpen: ett kort högt upp mitt i bilden – glider ner och tonas in, ljusskimmer över, tonas ut. */
function vgxBanner(ctx, W, s, ft, b) {
  const u = ft - b.at, inn = vgxEase(u / 0.45), a = inn * (1 - vgxEase((u - 2.3) / 0.5));
  const d = vgxDate(b.m.date), sub = `MILSTOLPE · ${d.getUTCDate()} ${VGX_MON[d.getUTCMonth()].toUpperCase()} ${d.getUTCFullYear()}`;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, 150 * s - (1 - inn) * 24 * s);
  ctx.font = `800 ${Math.round(46 * s)}px system-ui, sans-serif`;
  const tw = ctx.measureText(b.m.name).width, w = Math.max(tw + 190 * s, 460 * s), h = 118 * s;
  ctx.shadowColor = "rgba(15,23,42,.35)"; ctx.shadowBlur = 30 * s; ctx.shadowOffsetY = 10 * s;
  ctx.fillStyle = "rgba(15,23,42,.9)"; vgxRR(ctx, -w / 2, -h / 2, w, h, 22 * s); ctx.fill();
  ctx.shadowColor = "transparent";
  // Kant och skimmer i lila.
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0); g.addColorStop(0, "#6d5efc"); g.addColorStop(1, "#c084fc");
  ctx.strokeStyle = g; ctx.lineWidth = 2.5 * s; vgxRR(ctx, -w / 2, -h / 2, w, h, 22 * s); ctx.stroke();
  ctx.save(); vgxRR(ctx, -w / 2, -h / 2, w, h, 22 * s); ctx.clip();
  const sx = -w / 2 + (w + 300 * s) * vgxEase((u - 0.2) / 1.1) - 150 * s, sh = ctx.createLinearGradient(sx - 90 * s, 0, sx + 90 * s, 0);
  sh.addColorStop(0, "rgba(255,255,255,0)"); sh.addColorStop(0.5, "rgba(255,255,255,.12)"); sh.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sh; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
  // Ikonen: en ruter i en lysande cirkel.
  const ix = -w / 2 + 62 * s; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ix, 0, 32 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.save(); ctx.translate(ix, 0); ctx.rotate(Math.PI / 4); const k = 12 * s * (0.9 + 0.1 * Math.sin(u * 6)); ctx.fillRect(-k, -k, 2 * k, 2 * k); ctx.restore();
  ctx.textAlign = "left"; ctx.fillStyle = "#c4b5fd"; ctx.font = `700 ${Math.round(15 * s)}px system-ui, sans-serif`; ctx.fillText(sub, ix + 52 * s, -24 * s);
  ctx.fillStyle = "#fff"; ctx.font = `800 ${Math.round(46 * s)}px system-ui, sans-serif`; ctx.fillText(b.m.name, ix + 50 * s, 16 * s);
  ctx.restore();
}

/* I filmen: tidslinjen med datum och pärlbandet längst ner i bilden. */
function vgsDrawFrame(ctx, W, H, iso, range) {
  const s = H / 1080, [t0, t1] = range, barH = 84 * s, y0 = H - barH, pad = 40 * s, w = W - 2 * pad, U = t => pad + (t - t0) / (t1 - t0) * w;
  const t = vgxDate(iso).getTime();
  ctx.save();
  const g = ctx.createLinearGradient(0, y0 - 30 * s, 0, H); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.35, "rgba(255,255,255,.88)"); g.addColorStop(1, "rgba(255,255,255,.94)");
  ctx.fillStyle = g; ctx.fillRect(0, y0 - 30 * s, W, barH + 30 * s);
  // Axeln (Victor 2026-10-12: "markera tydligare ut veckor och månader"): månaderna som band med namnet i mitten
  // och en tydlig gräns, veckorna som streck med veckonummer (så tätt som det får plats).
  const ay = H - 34 * s, bandY = ay + 4 * s, bandH = 28 * s;
  const mStart = new Date(t0); mStart.setUTCDate(1);
  for (let m = new Date(mStart), k = 0; m.getTime() < t1; k++) {
    const a = Math.max(t0, m.getTime()), nx = new Date(m); nx.setUTCMonth(nx.getUTCMonth() + 1); const b = Math.min(t1, nx.getTime());
    const xa = U(a), xb = U(b);
    ctx.fillStyle = k % 2 ? "rgba(109,94,252,.07)" : "rgba(15,23,42,.035)"; ctx.fillRect(xa, bandY, xb - xa, bandH);
    if (m.getTime() > t0) { ctx.fillStyle = "rgba(15,23,42,.55)"; ctx.fillRect(xa - 1.25 * s, ay - 14 * s, 2.5 * s, bandH + 18 * s); }
    const lbl = `${VGX_MON[m.getUTCMonth()].toUpperCase()}${m.getUTCMonth() === 0 || k === 0 ? " " + m.getUTCFullYear() : ""}`;
    ctx.font = `800 ${Math.round(15 * s)}px system-ui, sans-serif`; ctx.textBaseline = "middle";
    const lw = ctx.measureText(lbl).width;
    if (xb - xa > lw + 12 * s) { ctx.fillStyle = "#334155"; ctx.fillText(lbl, Math.max(xa + 6 * s, Math.min(xb - lw - 6 * s, (xa + xb) / 2 - lw / 2)), bandY + bandH / 2 + 1); }
    m = nx;
  }
  // Dagarna (Victor 2026-10-12: "markeringar för dagar istället med snygg grafik"): ett litet streck per dag,
  // helgerna som ljusa band; passerade dagar i lila, kommande grå.
  const dayPx = VGX_DAY / (t1 - t0) * w;
  if (dayPx >= 2.5 * s) {
    const dd = new Date(t0); dd.setUTCHours(0, 0, 0, 0);
    for (; dd.getTime() <= t1; dd.setUTCDate(dd.getUTCDate() + 1)) {
      const x = U(dd.getTime()), wd = dd.getUTCDay(), past = dd.getTime() <= t;
      if ((wd === 6 || wd === 0) && dayPx >= 5 * s) { ctx.fillStyle = past ? "rgba(109,94,252,.10)" : "rgba(15,23,42,.05)"; ctx.fillRect(x, ay - 16 * s, dayPx, 16 * s); }
      ctx.fillStyle = past ? "rgba(109,94,252,.75)" : "rgba(15,23,42,.22)";
      const th = dayPx >= 9 * s ? 6 * s : 4 * s; ctx.fillRect(x - 0.6 * s, ay - th, 1.2 * s, th);
    }
  }
  // Veckorna: måndagarna; veckonummer när det finns plats (annars var annan/fjärde vecka).
  const wkPx = 7 * VGX_DAY / (t1 - t0) * w, every = wkPx > 34 * s ? 1 : wkPx > 17 * s ? 2 : wkPx > 8 * s ? 4 : 0;
  if (every) {
    ctx.font = `700 ${Math.round(13 * s)}px system-ui, sans-serif`; ctx.textBaseline = "bottom";
    const wd = vgxMonday(vgxIso(new Date(t0))); if (wd.getTime() < t0) wd.setUTCDate(wd.getUTCDate() + 7);
    for (let n = 0; wd.getTime() <= t1; wd.setUTCDate(wd.getUTCDate() + 7), n++) {
      const x = U(wd.getTime()), no = vgxWeekNo(wd);
      ctx.fillStyle = "rgba(15,23,42,.4)"; ctx.fillRect(x - 1 * s, ay - 10 * s, 2 * s, 14 * s);
      if (no % every === 0 || every === 1) { ctx.fillStyle = "#475569"; ctx.fillText(`v${no}`, x + 4 * s, ay - 4 * s); }
    }
  }
  ctx.strokeStyle = "rgba(15,23,42,.35)"; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(pad, ay); ctx.lineTo(W - pad, ay); ctx.stroke();
  ctx.textBaseline = "top";
  // Avklarad del och huvudet.
  ctx.strokeStyle = "#6d5efc"; ctx.lineWidth = 5 * s; ctx.beginPath(); ctx.moveTo(pad, ay); ctx.lineTo(U(t), ay); ctx.stroke();
  ctx.fillStyle = "rgba(109,94,252,.25)"; ctx.beginPath(); ctx.arc(U(t), ay, 15 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#6d5efc"; ctx.beginPath(); ctx.arc(U(t), ay, 9 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(U(t), ay, 3.5 * s, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

