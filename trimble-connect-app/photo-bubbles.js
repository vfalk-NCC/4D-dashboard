/* Foto med bubblor (Victor 2026-10-15): en kameraknapp vid 3D-ikonen i Gantt-schemat. Tar en stillbild ur Trimble Connects 3D-vy
   (viewer.getSnapshot) och ritar bubblor för aktiviteterna på bilden efteråt – samma uppgifter som 💬 Bubblor (markerade, annars pågående):
   namn, datum, område, framdrift och en linje ner till objektet. Platsen räknas ut ur kamerans läge och objektens lägen; går det inte
   (okänt kameraformat) läggs bubblorna prydligt i bildens kant utan linjer. Inget sparas i tidplanen eller i TC – bilden hämtas som PNG. */

const PHB_MON = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const phbV3 = p => Array.isArray(p) ? { x: +p[0], y: +p[1], z: +p[2] } : (p && typeof p === "object" && isFinite(+p.x) ? { x: +p.x, y: +p.y, z: +p.z } : null);
const phbSub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const phbDot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const phbCross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const phbNorm = a => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const phbOkVec = a => a && isFinite(a.x) && isFinite(a.y) && isFinite(a.z);

/* Alla rimliga tolkningar av kameran (Trimble Connect-kamerans format och enheter är inte dokumenterade här): läge i m/mm,
   riktning ur mål/riktning eller ur gir/lutning i grader/radianer. Den tolkning där flest objekt hamnar i bilden vinner. */
function phbCamCandidates(cam) {
  const out = []; if (!cam || typeof cam !== "object") return out;
  const pos0 = phbV3(cam.position || cam.eye || cam.pos);
  if (!phbOkVec(pos0)) return out;
  const up = phbV3(cam.up || cam.upVector) || { x: 0, y: 0, z: 1 };
  let fov = Number(cam.fov ?? cam.fovY ?? cam.fieldOfView ?? cam.verticalFov ?? 60); if (!(fov > 0)) fov = 60; if (fov < 3.2) fov = fov * 180 / Math.PI;
  const fovs = [fov]; // (vågrät vinkel provas också, se phbScore)
  const tgt = phbV3(cam.target || cam.lookAt || cam.look_at || cam.center), dir = phbV3(cam.direction || cam.dir || cam.forward);
  const y0 = cam.yaw ?? cam.heading ?? cam.azimuth, p0 = cam.pitch ?? cam.elevation ?? cam.tilt;
  [1, 0.001, 1000].forEach(sc => {
    const pos = { x: pos0.x * sc, y: pos0.y * sc, z: pos0.z * sc };
    fovs.forEach(f => {
      if (tgt && phbOkVec(tgt)) { const t = { x: tgt.x * sc, y: tgt.y * sc, z: tgt.z * sc }; const fw = phbSub(t, pos); if (Math.hypot(fw.x, fw.y, fw.z) > 0) out.push({ pos, fwd: phbNorm(fw), up, fov: f, why: "mål", sc }); }
      if (dir && phbOkVec(dir) && Math.hypot(dir.x, dir.y, dir.z) > 0) out.push({ pos, fwd: phbNorm(dir), up, fov: f, why: "riktning", sc });
      if (typeof y0 === "number" && typeof p0 === "number") {
        [1, Math.PI / 180].forEach(k => [1, -1].forEach(ys => [1, -1].forEach(ps => [0, Math.PI].forEach(off => [0, 1].forEach(conv => {
          const y = y0 * k * ys + off, p = p0 * k * ps;
          const fw = conv === 0 ? { x: Math.cos(p) * Math.sin(y), y: Math.cos(p) * Math.cos(y), z: Math.sin(p) } : { x: Math.cos(p) * Math.cos(y), y: Math.cos(p) * Math.sin(y), z: Math.sin(p) };
          out.push({ pos, fwd: fw, up, fov: f, why: `gir/lutning ${k === 1 ? "rad" : "grader"}`, sc });
        })))));
      }
    });
  });
  return out;
}
function phbProject(c, P, W, H) {
  const right = phbNorm(phbCross(c.fwd, c.up)); if (!phbOkVec(right)) return null;
  const upv = phbCross(right, c.fwd), d = phbSub(P, c.pos), z = phbDot(d, c.fwd);
  if (!(z > 0.05)) return null;
  const f = (H / 2) / Math.tan(c.fov * Math.PI / 360);
  return { x: W / 2 + phbDot(d, right) / z * f, y: H / 2 - phbDot(d, upv) / z * f, z };
}
function phbPickCamera(cam, pts, W, H) {
  let best = null, bs = -1;
  phbCamCandidates(cam).forEach(c => {
    let s = 0; pts.forEach(P => { const q = phbProject(c, P, W, H); if (q && q.x > -0.1 * W && q.x < 1.1 * W && q.y > -0.1 * H && q.y < 1.1 * H) s++; });
    if (s > bs) { bs = s; best = c; }
  });
  return best && bs >= Math.max(1, Math.ceil(pts.length * 0.6)) ? best : null;
}

/* Aktiviteternas lägen i modellen (meter): överkant mitt på objektens samlade box. */
async function phbAnchors(acts) {
  const V = API && API.viewer; const out = [];
  if (!V || typeof V.getObjectBoundingBoxes !== "function") return out;
  const byModel = new Map();
  acts.forEach(a => (a.members || [a]).forEach(m => { if (m.modelId && m.objectId) (byModel.get(m.modelId) || byModel.set(m.modelId, new Set()).get(m.modelId)).add(String(m.objectId)); }));
  const boxOf = new Map();
  for (const [modelId, set] of byModel) {
    const ids = [...set], r = await dashRuntimeIds(V, modelId, ids); if (r.modelFailed) continue;
    const rids = ids.map(id => r.map.get(id)).filter(x => x !== null && x !== undefined); if (!rids.length) continue;
    let boxes = []; try { boxes = await V.getObjectBoundingBoxes(modelId, rids); } catch (e) { continue; }
    const byRid = new Map(boxes.map(b => [b.id, b.boundingBox]));
    ids.forEach(id => { const rid = r.map.get(id); if (rid !== null && rid !== undefined && byRid.has(rid)) boxOf.set(`${modelId}|${id}`, byRid.get(rid)); });
  }
  acts.forEach(a => {
    const bs = (a.members || [a]).map(m => boxOf.get(`${m.modelId}|${m.objectId}`)).filter(Boolean); if (!bs.length) return;
    const lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    bs.forEach(b => ["x", "y", "z"].forEach(k => { lo[k] = Math.min(lo[k], b.min[k]); hi[k] = Math.max(hi[k], b.max[k]); }));
    out.push({ a, P: { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: hi.z } });
  });
  return out;
}

/* ---- Ritning ---------------------------------------------------------------------------------------- */
const phbRR = (ctx, x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };
function phbWrap(ctx, txt, maxW, lines) {
  const words = String(txt || "").replace(/\s+/g, " ").trim().split(" "), out = []; let cur = "";
  words.forEach(w => { const t = cur ? cur + " " + w : w; if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t; });
  if (cur) out.push(cur);
  if (out.length > lines) { const k = out.slice(0, lines); let l = k[lines - 1]; while (l.length > 1 && ctx.measureText(l + "…").width > maxW) l = l.slice(0, -1); k[lines - 1] = l.replace(/\s+$/, "") + "…"; return k; }
  return out;
}
const PHB_COL = { forsenad: "#e5262b", pagaende: "#eadb2b", klar: "#2fa84f", planerad: "#9aa3af" };
const PHB_FAM = "Arial, Helvetica, sans-serif";
const phbMeasure = (() => { let c = null; return () => (c = c || document.createElement("canvas").getContext("2d")); })();
const phbCol = c => c.colOver || c.autoCol;
const phbFmtDate = d => { const p = parseDate(d); return `${p.getUTCDate()} ${PHB_MON[p.getUTCMonth()]} ${p.getUTCFullYear()}`; };

/* ---- Bubblor: innehåll och mått (alla mått i "kk" = bildens grundskala × bubblornas skala × bubblans egen skala) ------------ */
function phbCardMeasure(c, st) {
  const ctx = phbMeasure(), a = c.a, kk = st.k * st.g.bscale * c.scale, W = 250 * kk, sh = c.show;
  ctx.font = `700 ${15 * kk}px ${PHB_FAM}`;
  c.name = phbWrap(ctx, c.text != null && c.text !== "" ? c.text : itemLabel(a), W - 30 * kk, 3);
  const sub = [];
  if (sh.date && a.startDate) sub.push(`${phbFmtDate(a.startDate)} – ${phbFmtDate(a.actualEndDate && a.actualEndDate > (a.endDate || "") ? a.actualEndDate : a.endDate || a.startDate)}`);
  const ar = String(a.area || "").trim(); if (sh.area && ar) sub.push(ar);
  ctx.font = `${11.5 * kk}px ${PHB_FAM}`; c.sub = sub.map(t => phbWrap(ctx, t, W - 24 * kk, 1)[0] || "");
  c.prog = phbProg(a, st);
  c.kk = kk; c.W = W; c.h = (c.name.length * 18 + c.sub.length * 16 + (sh.prog ? 34 : 20)) * kk;
}
function phbNewCard(o, st) {
  const ph = ganttPhaseAt(o.a, st.at);
  const c = { o, a: o.a, ph, autoCol: PHB_COL[ph] || PHB_COL.planerad, colOver: null, text: null, scale: 1, show: { date: true, area: true, prog: true }, x: 0, y: 0, ax: 0, ay: 0 };
  phbCardMeasure(c, st); return c;
}
function phbDrawCard(ctx, c, k) {
  const { x, y } = c, kk = c.kk, col = phbCol(c);
  ctx.save(); ctx.shadowColor = "rgba(15,23,42,.28)"; ctx.shadowBlur = 14 * kk; ctx.shadowOffsetY = 3 * kk;
  ctx.fillStyle = "#fff"; phbRR(ctx, x, y, c.W, c.h, 5 * kk); ctx.fill(); ctx.restore();
  ctx.fillStyle = col; ctx.fillRect(x, y + 1, 5 * kk, c.h - 2);
  let ty = y + 8 * kk; const tx = x + 14 * kk;
  ctx.textBaseline = "top"; ctx.fillStyle = "#111827"; ctx.font = `700 ${15 * kk}px ${PHB_FAM}`;
  c.name.forEach(l => { ctx.fillText(l, tx, ty); ty += 18 * kk; });
  ctx.font = `${11.5 * kk}px ${PHB_FAM}`; ctx.fillStyle = "#4b5563";
  c.sub.forEach(l => { ctx.fillText(l, tx, ty + 1 * kk); ty += 16 * kk; });
  if (c.show.prog) {
    const by = y + c.h - 14 * kk, bw = c.W - 70 * kk;
    ctx.fillStyle = "#e5e7eb"; phbRR(ctx, tx, by, bw, 5 * kk, 3 * kk); ctx.fill();
    ctx.fillStyle = c.ph === "forsenad" ? "#e5262b" : col; if (c.prog > 0) { phbRR(ctx, tx, by, Math.max(5 * kk, bw * c.prog / 100), 5 * kk, 3 * kk); ctx.fill(); }
    ctx.fillStyle = "#111827"; ctx.font = `700 ${12 * kk}px ${PHB_FAM}`; ctx.textBaseline = "middle"; ctx.fillText(`${c.prog} %`, tx + bw + 8 * kk, by + 2.5 * kk);
  }
}

/* ---- "Pågår just nu"-listan: indelad per WBS/område, som i videoeditorn ------------------------------------- */
const phbFold = new Set();
/* Framdrift som redovisas: "entered" = inskriven framdrift (klara = 100 %), "plan" = enligt tidplanen (andel av start–slut som passerat vid fotodatumet). */
function phbProg(a, st, ph) {
  if (st.progMode === "plan") {
    const s0 = a.startDate, e0 = a.endDate || a.startDate; if (!s0) return 0;
    if (st.at <= s0) return 0; if (st.at >= e0) return 100;
    return Math.max(0, Math.min(100, Math.round(100 * daysBetweenIso(s0, st.at) / Math.max(1, daysBetweenIso(s0, e0)))));
  }
  if ((ph || ganttPhaseAt(a, st.at)) === "klar") return 100;
  return Math.max(0, Math.min(100, Math.round(Number(a.progress) || 0)));
}
const phbAreaHead = area => { const parts = String(area || "").replace(/^Excel · /, "").split(/\s+\/\s+/).map(p => p.trim()).filter(Boolean); return parts.length ? parts[parts.length - 1] : "Utan område"; };
const phbKey = a => String(a.activityKey || a.id || itemLabel(a));
function phbActText(a) {
  const head = phbAreaHead(a.area), code = (head.match(/^\d+[A-Za-z]?/) || [""])[0], esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let v = String(itemLabel(a) || "").trim();
  [String(a.area || "").replace(/^Excel · /, ""), head].filter(Boolean).forEach(z => { v = v.replace(new RegExp("^\\s*" + esc(z) + "\\s*[-–—:·,/]?\\s*", "i"), ""); });
  if (code) v = v.replace(new RegExp("^\\s*" + esc(code) + "\\b\\s*[-–—:·,/]?\\s*"), "");
  return v.trim() || itemLabel(a);
}
/* Alla aktiviteter som ligger inom ±span veckor från fotodatumet (även klara och planerade). */
function phbCandidates(at, weeks) {
  const lo = addDaysIso(at, -7 * weeks), hi = addDaysIso(at, 7 * weeks);
  return mergeActivityGroups(ganttShownItems.filter(x => x.startDate)).filter(a => {
    if (a.temporary && a.bubbleOff) return false;
    const e = [a.endDate, a.actualEndDate].filter(Boolean).sort().pop() || a.startDate;
    return a.startDate <= hi && e >= lo;
  }).sort((a, b) => phbAreaHead(a.area).localeCompare(phbAreaHead(b.area), "sv", { numeric: true }) || String(a.startDate).localeCompare(String(b.startDate)) || itemLabel(a).localeCompare(itemLabel(b), "sv", { numeric: true }));
}
function phbActiveList(at) {
  return phbCandidates(at, 2).filter(a => { const ph = ganttPhaseAt(a, at); return ph === "pagaende" || ph === "forsenad"; });
}
function phbListItems(st) { const L = st.list; return L.cands.filter(a => L.sel.has(phbKey(a))); }
function phbListMeasure(st) {
  const L = st.list, kk = st.k * L.scale, ctx = phbMeasure(); L.kk = kk; L.W = 340 * kk;
  const all = phbListItems(st); L.items = all;
  const shown = all.slice(0, Math.max(1, L.max)), groups = new Map();
  shown.forEach(a => { const h = phbAreaHead(a.area); if (!groups.has(h)) groups.set(h, []); groups.get(h).push(a); });
  ctx.font = `${12 * kk}px ${PHB_FAM}`;
  L.lines = []; L.rows = [];
  groups.forEach((list, head) => {
    const phs = list.map(a => ganttPhaseAt(a, st.at)), col = phs.includes("forsenad") ? PHB_COL.forsenad : phs.includes("pagaende") ? PHB_COL.pagaende : phs.every(p => p === "klar") ? PHB_COL.klar : PHB_COL.planerad;
    const pr = list.map((a, i) => phbProg(a, st, phs[i]));
    ctx.font = `700 ${12.5 * kk}px ${PHB_FAM}`;
    L.lines.push({ t: "h", name: phbWrap(ctx, head, L.W - 70 * kk, 1)[0] || head, prog: Math.round(pr.reduce((x, y) => x + y, 0) / pr.length), col });
    ctx.font = `${11.5 * kk}px ${PHB_FAM}`;
    list.forEach((a, i) => { const r = { t: "r", name: phbWrap(ctx, phbActText(a), L.W - 140 * kk, 1)[0] || "", prog: pr[i], klar: phs[i] === "klar", col: PHB_COL[phs[i]] || PHB_COL.planerad }; L.lines.push(r); L.rows.push(r); });
  });
  L.more = Math.max(0, all.length - shown.length);
  L.h = (34 + L.lines.reduce((s, l) => s + (l.t === "h" ? 30 : 20), 0) + (L.more ? 20 : 0) + 8) * kk;
}
function phbDrawList(ctx, st) {
  const L = st.list, kk = L.kk, x = L.x, y = L.y;
  ctx.save(); ctx.shadowColor = "rgba(15,23,42,.28)"; ctx.shadowBlur = 14 * kk; ctx.shadowOffsetY = 3 * kk; ctx.fillStyle = "#fff"; phbRR(ctx, x, y, L.W, L.h, 6 * kk); ctx.fill(); ctx.restore();
  ctx.fillStyle = "#1f2937"; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, L.W, 26 * kk, [6 * kk, 6 * kk, 0, 0]); else ctx.rect(x, y, L.W, 26 * kk); ctx.fill();
  ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.font = `700 ${14 * kk}px ${PHB_FAM}`; ctx.fillText(L.title || "Pågår just nu", x + 12 * kk, y + 13.5 * kk);
  ctx.textAlign = "right"; ctx.font = `${11 * kk}px ${PHB_FAM}`; ctx.fillStyle = "#cbd5e1"; ctx.fillText(String(L.items.length), x + L.W - 10 * kk, y + 13.5 * kk); ctx.textAlign = "left";
  let ty = y + 34 * kk;
  L.lines.forEach(r => {
    if (r.t === "h") {
      ctx.fillStyle = r.col; ctx.fillRect(x + 8 * kk, ty + 2 * kk, 4 * kk, 24 * kk);
      ctx.fillStyle = "#111827"; ctx.font = `700 ${12.5 * kk}px ${PHB_FAM}`; ctx.fillText(r.name, x + 18 * kk, ty + 8 * kk);
      ctx.fillStyle = "#e5e7eb"; phbRR(ctx, x + 18 * kk, ty + 18 * kk, L.W - 28 * kk, 5 * kk, 3 * kk); ctx.fill();
      if (r.prog > 0) { ctx.fillStyle = r.col; phbRR(ctx, x + 18 * kk, ty + 18 * kk, Math.max(5 * kk, (L.W - 28 * kk) * r.prog / 100), 5 * kk, 3 * kk); ctx.fill(); }
      ty += 30 * kk;
    } else {
      ctx.fillStyle = r.col; ctx.beginPath(); ctx.arc(x + 26 * kk, ty + 9 * kk, 4 * kk, 0, 7); ctx.fill();
      ctx.fillStyle = "#111827"; ctx.font = `${11.5 * kk}px ${PHB_FAM}`; ctx.fillText(r.name, x + 36 * kk, ty + 9.5 * kk);
      const bx = x + L.W - 90 * kk;
      ctx.fillStyle = "#e5e7eb"; phbRR(ctx, bx, ty + 7 * kk, 40 * kk, 4 * kk, 2 * kk); ctx.fill();
      if (r.prog > 0) { ctx.fillStyle = r.col; phbRR(ctx, bx, ty + 7 * kk, Math.max(4 * kk, 40 * kk * r.prog / 100), 4 * kk, 2 * kk); ctx.fill(); }
      ctx.fillStyle = r.klar ? "#2fa84f" : "#111827"; ctx.textAlign = "right"; ctx.font = `700 ${11 * kk}px ${PHB_FAM}`; ctx.fillText(r.klar ? "Klar" : `${r.prog} %`, x + L.W - 10 * kk, ty + 9.5 * kk); ctx.textAlign = "left";
      ty += 20 * kk;
    }
  });
  if (L.more) { ctx.fillStyle = "#6b7280"; ctx.font = `italic ${11 * kk}px ${PHB_FAM}`; ctx.fillText(`+ ${L.more} till`, x + 18 * kk, ty + 8 * kk); }
}

/* ---- Fria texter och datumskylten -------------------------------------------------------------------------- */
function phbTextMeasure(t, st) {
  const ctx = phbMeasure(), kk = st.k, sz = t.size * kk; ctx.font = `${t.bold ? 700 : 400} ${sz}px ${PHB_FAM}`;
  t.lines = String(t.text || "").split("\n"); const pad = t.bg ? 9 * kk : 2 * kk;
  t.W = Math.max(...t.lines.map(l => ctx.measureText(l).width), 10 * kk) + 2 * pad; t.h = t.lines.length * sz * 1.28 + 2 * pad; t.pad = pad; t.sz = sz;
}
function phbDrawText(ctx, t) {
  if (t.bg) { ctx.save(); ctx.shadowColor = "rgba(15,23,42,.2)"; ctx.shadowBlur = 8 * (t.sz / 18); ctx.fillStyle = t.bgCol; phbRR(ctx, t.x, t.y, t.W, t.h, 6 * (t.sz / 18)); ctx.fill(); ctx.restore(); }
  ctx.fillStyle = t.col; ctx.textBaseline = "top"; ctx.font = `${t.bold ? 700 : 400} ${t.sz}px ${PHB_FAM}`;
  t.lines.forEach((l, i) => ctx.fillText(l, t.x + t.pad, t.y + t.pad + i * t.sz * 1.28 + t.sz * 0.1));
}
function phbDateText(iso) { const d = parseDate(iso); return `v.${isoWeekNumber(d)} · ${d.getUTCDate()} ${PHB_MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
function phbDateMeasure(st) {
  const D = st.dateObj, kk = st.k * D.scale, ctx = phbMeasure(); ctx.font = `700 ${34 * kk}px ${PHB_FAM}`;
  D.kk = kk; D.text = phbDateText(D.iso); D.W = ctx.measureText(D.text).width + 44 * kk; D.h = 62 * kk;
}
function phbDrawDate(ctx, D) {
  ctx.save(); ctx.fillStyle = "rgba(51,58,72,.92)"; phbRR(ctx, D.x, D.y, D.W, D.h, 10 * D.kk); ctx.fill(); ctx.restore();
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.font = `700 ${34 * D.kk}px ${PHB_FAM}`; ctx.fillText(D.text, D.x + 22 * D.kk, D.y + D.h / 2 + 1 * D.kk);
}

/* Bubblorna ovanför sina punkter; överlapp trycks isär (enkel avstötning) och hålls inom bilden. */
function phbLayout(cards, W, H, k, anchored) {
  const m = 10 * k, gap = 8 * k;
  if (!anchored) { // ingen position: rader längs högerkanten (och nästa kolumn åt vänster)
    let x = W - m, y = m, colW = 0;
    cards.forEach(c => { if (y + c.h > H - m) { x -= colW + gap; y = m; colW = 0; } c.x = x - c.W; c.y = y; y += c.h + gap; colW = Math.max(colW, c.W); });
    return;
  }
  cards.forEach(c => { c.x = c.ax - c.W / 2; c.y = c.ay - c.h - 56 * c.kk; });
  for (let it = 0; it < 80; it++) {
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      const ox = Math.min(a.x + a.W, b.x + b.W) - Math.max(a.x, b.x) + gap, oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
      if (ox > 0 && oy > 0) {
        if (oy < ox) { const s = (a.y + a.h / 2 <= b.y + b.h / 2) ? -1 : 1; a.y += s * oy / 2; b.y -= s * oy / 2; }
        else { const s = (a.x + a.W / 2 <= b.x + b.W / 2) ? -1 : 1; a.x += s * ox / 2; b.x -= s * ox / 2; }
      }
    }
    cards.forEach(c => { c.x = Math.max(m, Math.min(W - c.W - m, c.x)); c.y = Math.max(m, Math.min(H - c.h - m, c.y)); });
  }
}

/* Fotot i arbetsstorlek. TC:s getSnapshot() har ingen storleksinställning (bilden är vyns pixelstorlek), så den förstoras i
   halvstora steg (skarpare än ett enda hopp) och skärps med unsharp mask. amount 0 = ingen skärpning. */
function phbPhoto(st) {
  const { bmp, W, H } = st; let src = bmp, w = bmp.width, h = bmp.height;
  while (w < W) {
    const nw = Math.min(W, Math.round(w * 1.5)), nh = Math.round(nw * H / W), c = document.createElement("canvas"); c.width = nw; c.height = nh;
    const x = c.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, nw, nh); src = c; w = nw; h = nh;
  }
  const out = document.createElement("canvas"); out.width = W; out.height = H; const o = out.getContext("2d"); o.imageSmoothingQuality = "high"; o.drawImage(src, 0, 0, W, H);
  const a = Number(st.sharp) || 0;
  if (a > 0) {
    try {
      const b = document.createElement("canvas"); b.width = W; b.height = H; const bx = b.getContext("2d");
      if (typeof bx.filter === "string") {
        bx.filter = `blur(${Math.max(0.8, st.s * 0.9)}px)`; bx.drawImage(out, 0, 0); bx.filter = "none";
        const A = o.getImageData(0, 0, W, H), B = bx.getImageData(0, 0, W, H), d = A.data, e = B.data;
        for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) { const v = d[i + k] + a * (d[i + k] - e[i + k]); d[i + k] = v < 0 ? 0 : v > 255 ? 255 : v; }
        o.putImageData(A, 0, 0);
      }
    } catch (e) { /* utan skärpning */ }
  }
  st.photo = out; st.photoSharp = a;
}
/* Allt som kan redigeras på bilden: fotot, bubblorna (med lägen), listan, texter och datumskylten. Ritas om från den här. */
async function phbBuild(blob, cam, scopeOverride) {
  const bmp = await createImageBitmap(blob), s = Math.max(1, Math.min(3, Math.round(2400 / bmp.width))), W = bmp.width * s, H = bmp.height * s;
  const k = Math.max(0.9, W / 1500), at = (typeof ganttAsOf !== "undefined" && ganttAsOf) || todayISO();
  const sc0 = bubbleCfg.scope; let acts, scope;
  try { if (scopeOverride && scopeOverride !== "auto") bubbleCfg.scope = scopeOverride; ({ acts, scope } = bubbleActs()); } finally { bubbleCfg.scope = sc0; }
  const anchors = await phbAnchors(acts);
  const st = { bmp, s, W, H, k, at, sharp: 0.6, progMode: "entered", cards: [], placed: false, note: "", scope, g: { bscale: 1, lines: true, lineW: 1, dot: 1 }, texts: [], nextId: 1,
    dateObj: { on: typeof ganttMode !== "undefined" && ganttMode === "time", iso: at, x: 20 * k, y: 20 * k, scale: 1 },
    list: { on: false, title: "Pågår just nu", max: 40, scale: 1, weeks: 2, x: W - 360 * k, y: 20 * k, cands: [], sel: new Set(), items: [] } };
  st.list.cands = phbCandidates(at, 2); phbActiveList(at).forEach(a => st.list.sel.add(phbKey(a)));
  let cards = anchors.map(o => phbNewCard(o, st));
  if (anchors.length) {
    const c = phbPickCamera(cam, anchors.map(o => o.P), W, H);
    if (c) {
      st.placed = true;
      cards = cards.map(cd => { const q = phbProject(c, cd.o.P, W, H); return q ? Object.assign(cd, { ax: q.x, ay: q.y }) : null; }).filter(cd => cd && cd.ax > -0.05 * W && cd.ax < 1.05 * W && cd.ay > -0.05 * H && cd.ay < 1.05 * H);
    } else st.note = "Kunde inte avgöra var objekten ligger i bilden – bubblorna ligger i kanten utan linjer.";
  } else st.note = scope === "marked" ? "Inga markerade aktiviteter med objekt i modellen." : "Inga aktiviteter med objekt i modellen i det här urvalet – markera med Ctrl-klick eller välj ett annat urval.";
  if (anchors.length && st.placed && !cards.length) st.note = "Aktiviteternas objekt syns inte i bilden.";
  cards.sort((a, b) => (a.ax || 0) - (b.ax || 0));
  phbPhoto(st);
  st.cards = cards; phbLayout(cards, W, H, k, st.placed); phbListMeasure(st); phbDateMeasure(st);
  return st;
}
/* Mått om efter en ändring (skala, text, fält). Bubblan behåller sin övre vänstra hörn. */
function phbRemeasure(st) { st.cards.forEach(c => phbCardMeasure(c, st)); st.texts.forEach(t => phbTextMeasure(t, st)); phbListMeasure(st); phbDateMeasure(st); }
/* Närmaste punkt på kortets kant mot punkten – därifrån går linjen. */
function phbLeaderStart(c) {
  const px = Math.max(c.x + 12, Math.min(c.x + c.W - 12, c.ax));
  if (c.ay > c.y + c.h) return { x: px, y: c.y + c.h };
  if (c.ay < c.y) return { x: px, y: c.y };
  return c.ax < c.x ? { x: c.x, y: c.ay } : c.ax > c.x + c.W ? { x: c.x + c.W, y: c.ay } : null;
}
/* Objekten i ritordning (överst sist) för träffyta och markering. */
const phbObjects = st => [...st.cards.map(o => ({ type: "card", o })), ...(st.list.on ? [{ type: "list", o: st.list }] : []), ...st.texts.map(o => ({ type: "text", o })), ...(st.dateObj.on ? [{ type: "date", o: st.dateObj }] : [])];
const phbBox = it => ({ x: it.o.x, y: it.o.y, W: it.o.W, h: it.o.h });
const phbCloseBox = (it, k) => { const b = phbBox(it); return { x: b.x + b.W - 2 * k, y: b.y + 2 * k, r: 11 * k }; };
function phbRender(ctx, st) {
  const { W, H, k } = st;
  ctx.imageSmoothingQuality = "high"; ctx.drawImage(st.photo || st.bmp, 0, 0, W, H);
  if (st.placed && st.g.lines) st.cards.forEach(c => {
    const p = phbLeaderStart(c); if (!p) return;
    ctx.strokeStyle = phbCol(c); ctx.lineWidth = 2.5 * k * st.g.lineW; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(c.ax, c.ay); ctx.stroke();
    ctx.fillStyle = phbCol(c); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.arc(c.ax, c.ay, 6 * k * st.g.dot, 0, 7); ctx.fill(); ctx.stroke();
  });
  st.cards.forEach(c => phbDrawCard(ctx, c, k));
  if (st.list.on) phbDrawList(ctx, st);
  st.texts.forEach(t => phbDrawText(ctx, t));
  if (st.dateObj.on) phbDrawDate(ctx, st.dateObj);
  if (st.ui !== false) { // hanteringsgrafik (syns bara på skärmen, aldrig i sparad PNG/PDF): markering och ✕ för att ta bort
    const items = phbObjects(st), sel = items.find(i => i.o === st.sel), hv = items.find(i => i.o === st.hover);
    if (sel) { const b = phbBox(sel); ctx.save(); ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 2.5 * k; ctx.setLineDash([6 * k, 4 * k]); phbRR(ctx, b.x - 3 * k, b.y - 3 * k, b.W + 6 * k, b.h + 6 * k, 6 * k); ctx.stroke(); ctx.restore(); }
    if (hv) { const b = phbCloseBox(hv, k); ctx.save(); ctx.fillStyle = "#dc2626"; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * k; ctx.stroke(); ctx.beginPath(); const d = b.r * 0.38; ctx.moveTo(b.x - d, b.y - d); ctx.lineTo(b.x + d, b.y + d); ctx.moveTo(b.x + d, b.y - d); ctx.lineTo(b.x - d, b.y + d); ctx.lineWidth = 2.4 * k; ctx.lineCap = "round"; ctx.stroke(); ctx.restore(); }
  }
}

/* ---- PDF: fotot som bild; varje bubbla (kort + linje + punkt), listan och varje text som en flyttbar stämpel i egna lager ------- */
const phbWin = ch => ({ "–": 0x96, "—": 0x97, "…": 0x85, "·": 0xB7, "’": 0x27, "“": 0x22, "”": 0x22 }[ch]);
function phbPdfStr(str) { // PDF-sträng (WinAnsi) med skyddade tecken
  let o = "(";
  for (const ch of String(str)) { let c = ch.charCodeAt(0); if (c > 255) c = phbWin(ch) || 63; else if (phbWin(ch)) c = phbWin(ch); if (c === 40 || c === 41 || c === 92) o += "\\" + String.fromCharCode(c); else if (c < 32) o += " "; else o += String.fromCharCode(c); }
  return o + ")";
}
const phbN = n => (Math.round(n * 100) / 100).toString();
const phbRgb = hex => { const n = parseInt(String(hex).replace("#", "").slice(0, 6), 16) || 0; return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(v => phbN(v)).join(" "); };
function phbRRpdf(x, y, w, h, r) { // rundat hörn (bézier), nedre vänstra hörnet i (x, y)
  const q = r * 0.5523;
  return `${phbN(x + r)} ${phbN(y)} m ${phbN(x + w - r)} ${phbN(y)} l ${phbN(x + w - r + q)} ${phbN(y)} ${phbN(x + w)} ${phbN(y + r - q)} ${phbN(x + w)} ${phbN(y + r)} c ${phbN(x + w)} ${phbN(y + h - r)} l ${phbN(x + w)} ${phbN(y + h - r + q)} ${phbN(x + w - r + q)} ${phbN(y + h)} ${phbN(x + w - r)} ${phbN(y + h)} c ${phbN(x + r)} ${phbN(y + h)} l ${phbN(x + r - q)} ${phbN(y + h)} ${phbN(x)} ${phbN(y + h - r + q)} ${phbN(x)} ${phbN(y + h - r)} c ${phbN(x)} ${phbN(y + r)} l ${phbN(x)} ${phbN(y + r - q)} ${phbN(x + r - q)} ${phbN(y)} ${phbN(x + r)} ${phbN(y)} c h `;
}
function phbCirclePdf(cx, cy, r) { const q = r * 0.5523; return `${phbN(cx + r)} ${phbN(cy)} m ${phbN(cx + r)} ${phbN(cy + q)} ${phbN(cx + q)} ${phbN(cy + r)} ${phbN(cx)} ${phbN(cy + r)} c ${phbN(cx - q)} ${phbN(cy + r)} ${phbN(cx - r)} ${phbN(cy + q)} ${phbN(cx - r)} ${phbN(cy)} c ${phbN(cx - r)} ${phbN(cy - q)} ${phbN(cx - q)} ${phbN(cy - r)} ${phbN(cx)} ${phbN(cy - r)} c ${phbN(cx + q)} ${phbN(cy - r)} ${phbN(cx + r)} ${phbN(cy - q)} ${phbN(cx + r)} ${phbN(cy)} c h `; }
function phbPdfCard(c, f) { // själva kortet (lokala koordinater, origo nere till vänster)
  const kk = c.kk, w = c.W * f, h = c.h * f, tx = 14 * kk * f, col = phbCol(c); let o = "";
  o += `1 g ${phbRRpdf(0.5, 0.5, w - 1, h - 1, 4 * kk * f)} f 0.85 G ${phbN(0.8 * kk * f)} w ${phbRRpdf(0.5, 0.5, w - 1, h - 1, 4 * kk * f)} S `;
  o += `${phbRgb(col)} rg 0 ${phbN(1 * kk * f)} ${phbN(5 * kk * f)} ${phbN(h - 2 * kk * f)} re f `;
  let ty = 8 * kk;
  o += `BT 0.07 0.09 0.15 rg /F2 ${phbN(15 * kk * f)} Tf `; c.name.forEach(l => { o += `1 0 0 1 ${phbN(tx)} ${phbN(h - (ty + 12.3 * kk) * f)} Tm ${phbPdfStr(l)} Tj `; ty += 18 * kk; }); o += "ET ";
  o += `BT 0.29 0.33 0.4 rg /F1 ${phbN(11.5 * kk * f)} Tf `; c.sub.forEach(l => { o += `1 0 0 1 ${phbN(tx)} ${phbN(h - (ty + 1 * kk + 9.4 * kk) * f)} Tm ${phbPdfStr(l)} Tj `; ty += 16 * kk; }); o += "ET ";
  if (c.show.prog) {
    const by = c.h - 14 * kk, bw = c.W - 70 * kk;
    o += `0.9 g ${phbRRpdf(tx, h - (by + 5 * kk) * f, bw * f, 5 * kk * f, 2.5 * kk * f)} f `;
    if (c.prog > 0) o += `${phbRgb(c.ph === "forsenad" ? "#e5262b" : col)} rg ${phbRRpdf(tx, h - (by + 5 * kk) * f, Math.max(5 * kk, bw * c.prog / 100) * f, 5 * kk * f, 2.5 * kk * f)} f `;
    o += `BT 0.07 0.09 0.15 rg /F2 ${phbN(12 * kk * f)} Tf 1 0 0 1 ${phbN(tx + (bw + 8 * kk) * f)} ${phbN(h - (by + 2.5 * kk + 4.2 * kk) * f)} Tm ${phbPdfStr(c.prog + " %")} Tj ET `;
  }
  return o;
}
/* En bubbla = ett kort + linjen och punkten ner till objektet i EN stämpel (så linjen följer med när den flyttas). */
function phbPdfBubble(st, c, f) {
  const k = st.k, withLine = st.placed && st.g.lines, r = 8 * k * Math.max(1, st.g.dot), lw = 2.5 * k * st.g.lineW;
  const x0 = withLine ? Math.min(c.x, c.ax - r) : c.x, x1 = withLine ? Math.max(c.x + c.W, c.ax + r) : c.x + c.W, y0 = withLine ? Math.min(c.y, c.ay - r) : c.y, y1 = withLine ? Math.max(c.y + c.h, c.ay + r) : c.y + c.h;
  let o = "";
  if (withLine) { const p = phbLeaderStart(c); if (p) {
    const lx = v => (v - x0) * f, ly = v => (y1 - v) * f;
    o += `${phbRgb(phbCol(c))} RG ${phbN(lw * f)} w 1 J ${phbN(lx(p.x))} ${phbN(ly(p.y))} m ${phbN(lx(c.ax))} ${phbN(ly(c.ay))} l S `;
    o += `${phbRgb(phbCol(c))} rg 1 G ${phbN(2 * k * f)} w ${phbCirclePdf(lx(c.ax), ly(c.ay), 6 * k * st.g.dot * f)} B `; } }
  o += `q 1 0 0 1 ${phbN((c.x - x0) * f)} ${phbN((y1 - (c.y + c.h)) * f)} cm ${phbPdfCard(c, f)} Q`;
  return { stream: o, x0, x1, y0, y1 };
}
function phbPdfList(L, f) {
  const kk = L.kk, w = L.W * f, h = L.h * f; let o = "";
  const T = (font, size, rgb, px, py, txt, right) => `BT ${rgb} rg /${font} ${phbN(size * kk * f)} Tf 1 0 0 1 ${phbN(px * kk * f - (right ? Math.min(w, txt.length * size * kk * f * 0.56) : 0))} ${phbN(h - py * kk * f)} Tm ${phbPdfStr(txt)} Tj ET `;
  o += `1 g ${phbRRpdf(0.5, 0.5, w - 1, h - 1, 5 * kk * f)} f 0.85 G ${phbN(0.8 * kk * f)} w ${phbRRpdf(0.5, 0.5, w - 1, h - 1, 5 * kk * f)} S `;
  o += `0.12 0.16 0.22 rg ${phbRRpdf(0.5, h - 26 * kk * f, w - 1, 26 * kk * f - 0.5, 5 * kk * f)} f `;
  o += `BT 1 g /F2 ${phbN(14 * kk * f)} Tf 1 0 0 1 ${phbN(12 * kk * f)} ${phbN(h - 18.5 * kk * f)} Tm ${phbPdfStr(L.title || "Pågår just nu")} Tj ET `;
  let ty = 34;
  const bar = (bx, by, bw, bh, prog, col) => `0.9 g ${phbRRpdf(bx * kk * f, h - (by + bh) * kk * f, bw * kk * f, bh * kk * f, bh / 2 * kk * f)} f ` + (prog > 0 ? `${phbRgb(col)} rg ${phbRRpdf(bx * kk * f, h - (by + bh) * kk * f, Math.max(bh, bw * prog / 100) * kk * f, bh * kk * f, bh / 2 * kk * f)} f ` : "");
  L.lines.forEach(r => {
    if (r.t === "h") {
      o += `${phbRgb(r.col)} rg ${phbN(8 * kk * f)} ${phbN(h - (ty + 26) * kk * f)} ${phbN(4 * kk * f)} ${phbN(24 * kk * f)} re f `;
      o += T("F2", 12.5, "0.07 0.09 0.15", 18, ty + 12, r.name) + bar(18, ty + 18, L.W - 28, 5, r.prog, r.col);
      ty += 30;
    } else {
      o += `${phbRgb(r.col)} rg ${phbCirclePdf(26 * kk * f, h - (ty + 9) * kk * f, 4 * kk * f)} f `;
      o += T("F1", 11.5, "0.07 0.09 0.15", 36, ty + 13.2, r.name) + bar(L.W - 90, ty + 7, 40, 4, r.prog, r.col) + T("F2", 11, r.klar ? "0.18 0.66 0.31" : "0.07 0.09 0.15", L.W - 10, ty + 13.2, r.klar ? "Klar" : r.prog + " %", true);
      ty += 20;
    }
  });
  if (L.more) o += T("F1", 11, "0.42 0.45 0.5", 18, ty + 12, "+ " + L.more + " till");
  return o;
}
function phbPdfText(t, f) {
  const w = t.W * f, h = t.h * f; let o = "";
  if (t.bg) o += `${phbRgb(t.bgCol)} rg ${phbRRpdf(0, 0, w, h, 6 * (t.sz / 18) * f)} f `;
  o += `BT ${phbRgb(t.col)} rg /${t.bold ? "F2" : "F1"} ${phbN(t.sz * f)} Tf `;
  t.lines.forEach((l, i) => { o += `1 0 0 1 ${phbN(t.pad * f)} ${phbN(h - (t.pad + i * t.sz * 1.28 + t.sz * 0.88) * f)} Tm ${phbPdfStr(l)} Tj `; });
  return o + "ET ";
}
async function phbPdf(st) {
  const jc = st.photo || Object.assign(document.createElement("canvas"), { width: st.bmp.width, height: st.bmp.height });
  if (!st.photo) jc.getContext("2d").drawImage(st.bmp, 0, 0);
  const jpeg = new Uint8Array(await (await new Promise(r => jc.toBlob(r, "image/jpeg", 0.95))).arrayBuffer());
  const f = 0.75 / st.s, PW = st.bmp.width * 0.75, PH = st.bmp.height * 0.75, X = x => x * f, Y = y => PH - y * f;
  const objs = []; const add = (head, stream) => { objs.push({ head, stream }); return objs.length; };
  // Reserverade nummer: 1 katalog, 2 sidor, 3 sida, 4 innehåll, 5 bild, 6–7 typsnitt, 8 lager Datumskylt, 9 lager Bubblor, 10 lager Lista och texter
  objs.length = 10;
  const annots = [], F = `/Font<</F1 6 0 R/F2 7 0 R>>`;
  const stamp = (name, oc, x0, y0, x1, y1, stream, contents) => {
    const ap = add(`<</Type/XObject/Subtype/Form/BBox[0 0 ${phbN((x1 - x0) * f)} ${phbN((y1 - y0) * f)}]/Resources<<${F}>>>>`, stream);
    annots.push(add(`<</Type/Annot/Subtype/Stamp/Rect[${phbN(X(x0))} ${phbN(Y(y1))} ${phbN(X(x1))} ${phbN(Y(y0))}]/F 4/NM ${phbPdfStr(name)}/T(4D-planering)/Subj(${name.startsWith("bubbla") ? "Bubbla" : name.startsWith("lista") ? "Lista" : "Text"})/Contents ${phbPdfStr(contents)}/OC ${oc} 0 R/AP<</N ${ap} 0 R>>/Name/Draft>>`));
  };
  st.cards.forEach((c, i) => { const b = phbPdfBubble(st, c, f); stamp("bubbla" + (i + 1), 9, b.x0, b.y0, b.x1, b.y1, b.stream, c.name.join(" ")); });
  if (st.list.on) { const L = st.list; stamp("lista", 10, L.x, L.y, L.x + L.W, L.y + L.h, phbPdfList(L, f), L.title || "Pågår just nu"); }
  st.texts.forEach((t, i) => stamp("text" + (i + 1), 10, t.x, t.y, t.x + t.W, t.y + t.h, phbPdfText(t, f), t.text));
  let ct = `q ${phbN(PW)} 0 0 ${phbN(PH)} 0 0 cm /Im0 Do Q\n`;
  if (st.dateObj.on) {
    const D = st.dateObj, w = D.W * f, h = D.h * f, x0 = D.x * f, y0 = PH - D.y * f - h;
    ct += `/OC /L1 BDC 0.2 0.23 0.28 rg ${phbRRpdf(x0, y0, w, h, 10 * D.kk * f)} f 1 g BT /F2 ${phbN(34 * D.kk * f)} Tf 1 0 0 1 ${phbN(x0 + 22 * D.kk * f)} ${phbN(y0 + h / 2 - 11.5 * D.kk * f)} Tm ${phbPdfStr(D.text)} Tj ET EMC\n`;
  }
  objs[0] = { head: `<</Type/Catalog/Pages 2 0 R/OCProperties<</OCGs[8 0 R 9 0 R 10 0 R]/D<</Order[8 0 R 9 0 R 10 0 R]/ON[8 0 R 9 0 R 10 0 R]>>>>>>` };
  objs[1] = { head: `<</Type/Pages/Kids[3 0 R]/Count 1>>` };
  objs[2] = { head: `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${phbN(PW)} ${phbN(PH)}]/Resources<</XObject<</Im0 5 0 R>>${F}/Properties<</L1 8 0 R>>>>/Contents 4 0 R${annots.length ? `/Annots[${annots.map(n => n + " 0 R").join(" ")}]` : ""}>>` };
  objs[3] = { head: `<<`, stream: ct };
  objs[4] = { head: `<</Type/XObject/Subtype/Image/Width ${jc.width}/Height ${jc.height}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode`, stream: jpeg };
  objs[5] = { head: `<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>` };
  objs[6] = { head: `<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>` };
  objs[7] = { head: `<</Type/OCG/Name(Datumskylt)>>` };
  objs[8] = { head: `<</Type/OCG/Name(Bubblor)>>` };
  objs[9] = { head: `<</Type/OCG/Name(Lista och texter)>>` };
  const parts = [], enc = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
  let len = 0; const push = u => { parts.push(u); len += u.length; }, offs = [];
  push(enc("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n"));
  objs.forEach((o, i) => {
    offs[i] = len; push(enc(`${i + 1} 0 obj\n`));
    if (o.stream !== undefined) { const body = typeof o.stream === "string" ? enc(o.stream) : o.stream; push(enc(`${o.head.replace(/>>$/, "")}/Length ${body.length}>>\nstream\n`)); push(body); push(enc("\nendstream")); }
    else push(enc(o.head));
    push(enc("\nendobj\n"));
  });
  const xr = len; let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`; offs.forEach(o => { x += String(o).padStart(10, "0") + " 00000 n \n"; });
  push(enc(x + `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xr}\n%%EOF\n`));
  return new Blob(parts, { type: "application/pdf" });
}

/* ---- Knappen, förhandsvisningen och redigeringen ----------------------------------------------------------------- */
let phbBusy = false, phbLast = null;
async function phbShoot() {
  if (phbBusy) return;
  const V = API && API.viewer;
  if (!V || typeof V.getSnapshot !== "function") { modelToast("Foto kräver Trimble Connect-vyn"); return; }
  phbBusy = true; const btn = document.getElementById("ganttPhotoBtn"); if (btn) btn.disabled = true;
  const hadBubbles = typeof bubbleCfg !== "undefined" && bubbleCfg.on;
  try {
    modelToast("Tar foto …");
    if (hadBubbles) { await bubblesClear(); await new Promise(r => setTimeout(r, 250)); } // TC:s egna textbubblor ska inte ligga med på bilden
    let cam = null; try { cam = await V.getCamera(); } catch (e) { /* okänd kamera */ }
    const blob = await vidSnapshot();
    phbLast = { blob, cam };
    const st = await phbBuild(blob, cam, "auto");
    if (!st.placed && cam) console.info("Foto med bubblor: kamerans format kunde inte tolkas", JSON.stringify(cam));
    phbPreview(st);
  } catch (e) { console.warn("Foto", e); modelToast("Kunde inte ta foto: " + ((e && (e.message || e.error)) || "Trimble Connect svarade inte")); }
  finally { phbBusy = false; if (btn) btn.disabled = false; if (hadBubbles) bubblesSchedule(true); }
}
const phbEsc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function phbPreview(st) {
  const old = document.getElementById("phbDlg"); if (old) old.remove();
  const d = document.createElement("div"); d.id = "phbDlg"; d.className = "phb-wrap";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
  d.innerHTML = `<div class="phb-box"><div class="phb-main"><div class="phb-img"><canvas id="phbCv" width="${st.W}" height="${st.H}"></canvas></div><aside class="phb-side" id="phbSide"></aside></div>
    <div class="phb-bar"><span class="phb-info" id="phbInfo"></span>
    <label class="phb-sel">Visa <select id="phbScope"><option value="auto">Markerade, annars pågående</option><option value="marked">Bara markerade</option><option value="active">Pågående</option><option value="all">Alla i schemat</option></select></label>
    <span class="phb-zoom" title="Zooma i förhandsvisningen (mushjul, Ctrl +/−). Panorera: mellanklick-dra, Mellanslag-dra eller rullningslisterna"><button type="button" id="phbZm" aria-label="Zooma ut">−</button><button type="button" id="phbZv" aria-label="Anpassa till fönstret">100 %</button><button type="button" id="phbZp" aria-label="Zooma in">+</button></span><button type="button" id="phbUndo" class="hidden" title="Ta tillbaka den senast borttagna bubblan (Ctrl+Z)">↶ Ångra borttagning</button><button type="button" id="phbPdf" class="primary" title="Foto + bubblor, lista och texter som flyttbara stämplar i egna lager – flytta dem i PDF-läsaren">Spara PDF</button><button type="button" id="phbPng">Spara PNG</button><button type="button" id="phbClose">Stäng</button></div></div>`;
  (document.fullscreenElement || document.body).appendChild(d);
  const cv = d.querySelector("#phbCv"), ctx = cv.getContext("2d"), info = d.querySelector("#phbInfo"), side = d.querySelector("#phbSide"), undoBtn = d.querySelector("#phbUndo");
  let cur = st, removed = [], drag = null; cv._state = () => cur;
  const draw = () => {
    cur.ui = cur.ui !== false; phbRender(ctx, cur); undoBtn.classList.toggle("hidden", !removed.length);
    info.textContent = `${cur.cards.length} bubbl${cur.cards.length === 1 ? "a" : "or"} – dra bubblan eller dess punkt, klicka för att redigera, ✕ / Delete / högerklick tar bort${removed.length ? ` · ${removed.length} ${removed.length === 1 ? "borttagen" : "borttagna"}` : ""}${cur.note ? ". " + cur.note : ""}`;
  };
  const remeasure = () => { phbRemeasure(cur); draw(); };
  const removeObj = it => {
    if (!it) return;
    if (it.type === "card") { const i = cur.cards.indexOf(it.o); if (i < 0) return; cur.cards.splice(i, 1); removed.push({ c: it.o, i }); }
    else if (it.type === "text") cur.texts.splice(cur.texts.indexOf(it.o), 1);
    else if (it.type === "list") cur.list.on = false; else if (it.type === "date") cur.dateObj.on = false;
    if (cur.sel === it.o) cur.sel = null; if (cur.hover === it.o) cur.hover = null; draw(); renderSide();
  };
  const undoRemove = () => { const r = removed.pop(); if (!r) return; cur.cards.splice(Math.min(r.i, cur.cards.length), 0, r.c); cur.sel = r.c; draw(); renderSide(); };
  const selItem = () => phbObjects(cur).find(i => i.o === cur.sel);
  /* Sidopanelen: allmänt överst, sedan det som är valt. */
  const rng = (id, lbl, v, min, max, step, unit = "%") => `<label class="phb-f"><span>${lbl} <b id="${id}V">${v}${unit}</b></span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
  const chk = (id, lbl, on) => `<label class="phb-c"><input type="checkbox" id="${id}"${on ? " checked" : ""}> ${lbl}</label>`;
  /* Aktiviteterna inom ±veckor från fotodatumet, per WBS/område – kryssa i vilka som ska med (även klara). */
  function phbListPick(L) {
    const by = new Map(); L.cands.forEach(a => { const h = phbAreaHead(a.area); if (!by.has(h)) by.set(h, []); by.get(h).push(a); });
    const ph = { forsenad: "Försenad", pagaende: "Pågår", klar: "Klar", planerad: "Planerad" };
    let h = `<label class="phb-f"><span>Spann ± veckor kring ${phbEsc(phbFmtDate(cur.at))}</span><input type="number" id="phbListWeeks" min="0" max="26" value="${L.weeks}"></label><div class="phb-row"><button type="button" id="phbListAll">Alla</button><button type="button" id="phbListNone">Inga</button><button type="button" id="phbListNow" title="Bara det som pågår vid fotodatumet">Pågår</button></div><div class="phb-pick" id="phbPick">`;
    if (!L.cands.length) h += `<div class="phb-note">Inga aktiviteter i spannet.</div>`;
    by.forEach((list, head) => {
      const n = list.filter(a => L.sel.has(phbKey(a))).length;
      h += `<div class="phb-pg"><label class="phb-c"><input type="checkbox" data-pg="${phbEsc(head)}"${n === list.length ? " checked" : ""}> <b>${phbEsc(head)}</b> <small>${n}/${list.length}</small></label>`;
      list.forEach(a => { const p = ganttPhaseAt(a, cur.at); h += `<label class="phb-c phb-pa"><input type="checkbox" data-pk="${phbEsc(phbKey(a))}"${L.sel.has(phbKey(a)) ? " checked" : ""}> <i class="phb-dot" style="background:${PHB_COL[p]}"></i><span>${phbEsc(phbActText(a))}</span> <small>${ph[p]}</small></label>`; });
      h += `</div>`;
    });
    return h + `</div>`;
  }
  function renderSide() {
    const g = cur.g, g0 = cur, L = cur.list, D = cur.dateObj, it = selItem(), o = it && it.o;
    let h = `<div class="phb-sec"><div class="phb-h">Allmänt</div>${rng("phbGScale", "Bubblornas skala", Math.round(g.bscale * 100), 40, 250, 5)}${chk("phbLines", "Linjer till objekten", g.lines)}${g.lines ? rng("phbLineW", "Linjetjocklek", Math.round(g.lineW * 100), 40, 300, 10) + rng("phbDot", "Punktstorlek", Math.round(g.dot * 100), 40, 300, 10) : ""}
      <label class="phb-f"><span>Framdrift som visas</span><select id="phbProgMode"><option value="entered"${g0.progMode !== "plan" ? " selected" : ""}>Inskriven framdrift</option><option value="plan"${g0.progMode === "plan" ? " selected" : ""}>Enligt tidplanen (datum)</option></select></label>${rng("phbSharp", "Skärpa på fotot", Math.round(g0.sharp * 100), 0, 150, 10)}<div class="phb-note">Fotots källa: ${g0.bmp.width}×${g0.bmp.height} px (TC-vyns storlek), arbetsbild ${g0.W}×${g0.H}. Mer detaljer: gör TC-vyn större innan du tar fotot (dölj sidopaneler, helskärm F11) – API:t har ingen upplösningsinställning.</div>
      <button type="button" id="phbArrange" title="Lägg bubblorna ovanför sina punkter igen, utan överlapp">Ordna om bubblorna</button></div>
      <div class="phb-sec"><div class="phb-h">Pågår just nu</div>${chk("phbListOn", `Visa listan (${L.items.length} aktiviteter)`, L.on)}${L.on ? `<label class="phb-f"><span>Rubrik</span><input type="text" id="phbListTitle" value="${phbEsc(L.title)}" maxlength="60"></label>${phbListPick(L)}<label class="phb-f"><span>Högst antal rader</span><input type="number" id="phbListMax" min="1" max="60" value="${L.max}"></label>${rng("phbListScale", "Skala", Math.round(L.scale * 100), 40, 250, 5)}` : ""}</div>
      <div class="phb-sec"><div class="phb-h">Datumskylt</div>${chk("phbDateOn", "Visa datumskylten", D.on)}${D.on ? `<label class="phb-f"><span>Datum</span><input type="date" id="phbDateVal" value="${D.iso}"></label>${rng("phbDateScale", "Skala", Math.round(D.scale * 100), 40, 250, 5)}` : ""}</div>
      <div class="phb-sec"><button type="button" id="phbAddText">＋ Text</button></div>`;
    if (it && it.type === "card") h += `<div class="phb-sec phb-sel-sec"><div class="phb-h">Vald bubbla</div><label class="phb-f"><span>Rubrik <small>(tomt = aktivitetens namn)</small></span><textarea id="phbCText" rows="3">${phbEsc(o.text != null ? o.text : "")}</textarea></label>${rng("phbCScale", "Bubblans skala", Math.round(o.scale * 100), 40, 300, 5)}<div class="phb-row"><label class="phb-f"><span>Färg</span><input type="color" id="phbCCol" value="${phbCol(o)}"></label><button type="button" id="phbCAuto" title="Färg efter status"${o.colOver ? "" : " disabled"}>Auto</button></div>${chk("phbCDate", "Datum", o.show.date)}${chk("phbCArea", "Område", o.show.area)}${chk("phbCProg", "Framdrift", o.show.prog)}<button type="button" id="phbCDel" class="danger">Ta bort bubblan</button></div>`;
    else if (it && it.type === "text") h += `<div class="phb-sec phb-sel-sec"><div class="phb-h">Vald text</div><label class="phb-f"><span>Text</span><textarea id="phbTText" rows="3">${phbEsc(o.text)}</textarea></label>${rng("phbTSize", "Storlek", o.size, 8, 80, 1, " px")}<div class="phb-row"><label class="phb-f"><span>Textfärg</span><input type="color" id="phbTCol" value="${o.col}"></label>${chk("phbTBold", "Fet", o.bold)}</div><div class="phb-row">${chk("phbTBg", "Bakgrund", o.bg)}${o.bg ? `<input type="color" id="phbTBgCol" value="${o.bgCol}">` : ""}</div><button type="button" id="phbTDel" class="danger">Ta bort texten</button></div>`;
    const pk0 = side.querySelector("#phbPick"), keepSide = side.scrollTop, keepPick = pk0 ? pk0.scrollTop : 0;
    side.innerHTML = h; bindSide();
    /* Samma rullningsläge efter ombyggnaden – klick i en kryssruta ska inte hoppa till toppen. */
    side.scrollTop = keepSide; const pk1 = side.querySelector("#phbPick"); if (pk1) pk1.scrollTop = keepPick;
    /* Alla huvudmenyer kan fällas ihop (valet sparas så länge sidan är öppen). */
    side.querySelectorAll(".phb-sec > .phb-h").forEach(hd => {
      const sec = hd.parentElement, key = hd.textContent.trim();
      hd.setAttribute("role", "button"); hd.tabIndex = 0; hd.classList.add("phb-fold"); sec.classList.toggle("phb-closed", phbFold.has(key));
      hd.setAttribute("aria-expanded", String(!phbFold.has(key)));
      const tog = () => { const c = sec.classList.toggle("phb-closed"); if (c) phbFold.add(key); else phbFold.delete(key); hd.setAttribute("aria-expanded", String(!c)); };
      hd.addEventListener("click", tog); hd.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tog(); } });
    });
  }
  function bindSide() {
    const q = id => side.querySelector("#" + id), on = (id, ev, fn) => { const e = q(id); if (e) e.addEventListener(ev, fn); };
    const range = (id, apply, pct = true) => on(id, "input", e => { const v = Number(e.target.value); const lab = q(id + "V"); if (lab) lab.textContent = v + (pct ? "%" : " px"); apply(pct ? v / 100 : v); });
    range("phbGScale", v => { cur.g.bscale = v; remeasure(); }); range("phbLineW", v => { cur.g.lineW = v; draw(); }); range("phbDot", v => { cur.g.dot = v; draw(); });
    on("phbProgMode", "change", e => { cur.progMode = e.target.value; remeasure(); });
    let shT = 0; range("phbSharp", v => { cur.sharp = v; clearTimeout(shT); shT = setTimeout(() => { phbPhoto(cur); draw(); }, 120); });
    on("phbLines", "change", e => { cur.g.lines = e.target.checked; draw(); renderSide(); });
    on("phbArrange", "click", () => { phbLayout(cur.cards, cur.W, cur.H, cur.k, cur.placed); draw(); });
    on("phbListOn", "change", e => { cur.list.on = e.target.checked; if (cur.list.on) cur.sel = cur.list; draw(); renderSide(); });
    on("phbListTitle", "input", e => { cur.list.title = e.target.value; draw(); });
    on("phbListWeeks", "change", e => { const L = cur.list; L.weeks = Math.max(0, Math.min(26, Number(e.target.value) || 0)); L.cands = phbCandidates(cur.at, L.weeks); const keep = new Set(L.cands.map(phbKey)); [...L.sel].forEach(k => { if (!keep.has(k)) L.sel.delete(k); }); remeasure(); renderSide(); });
    const setSel = fn => { const L = cur.list; fn(L); remeasure(); renderSide(); };
    on("phbListAll", "click", () => setSel(L => L.cands.forEach(a => L.sel.add(phbKey(a)))));
    on("phbListNone", "click", () => setSel(L => L.sel.clear()));
    on("phbListNow", "click", () => setSel(L => { L.sel.clear(); L.cands.forEach(a => { const p = ganttPhaseAt(a, cur.at); if (p === "pagaende" || p === "forsenad") L.sel.add(phbKey(a)); }); }));
    side.querySelectorAll("[data-pk]").forEach(e => e.addEventListener("change", () => setSel(L => { if (e.checked) L.sel.add(e.dataset.pk); else L.sel.delete(e.dataset.pk); })));
    side.querySelectorAll("[data-pg]").forEach(e => e.addEventListener("change", () => setSel(L => L.cands.filter(a => phbAreaHead(a.area) === e.dataset.pg).forEach(a => { if (e.checked) L.sel.add(phbKey(a)); else L.sel.delete(phbKey(a)); }))));
    on("phbListMax", "input", e => { cur.list.max = Math.max(1, Math.min(60, Number(e.target.value) || 1)); remeasure(); });
    range("phbListScale", v => { cur.list.scale = v; remeasure(); });
    on("phbDateOn", "change", e => { cur.dateObj.on = e.target.checked; draw(); renderSide(); });
    on("phbDateVal", "input", e => { if (e.target.value) { cur.dateObj.iso = e.target.value; remeasure(); } });
    range("phbDateScale", v => { cur.dateObj.scale = v; remeasure(); });
    on("phbAddText", "click", () => { const t = { id: cur.nextId++, x: cur.W * 0.35, y: cur.H * 0.08, text: "Text", size: 22, col: "#111827", bg: true, bgCol: "#ffffff", bold: true }; phbTextMeasure(t, cur); cur.texts.push(t); cur.sel = t; draw(); renderSide(); const ta = q("phbTText"); if (ta) { ta.focus(); ta.select(); } });
    const c = cur.sel && cur.cards.includes(cur.sel) ? cur.sel : null, t = cur.sel && cur.texts.includes(cur.sel) ? cur.sel : null;
    if (c) {
      on("phbCText", "input", e => { c.text = e.target.value; remeasure(); });
      range("phbCScale", v => { c.scale = v; remeasure(); });
      on("phbCCol", "input", e => { c.colOver = e.target.value; const a = q("phbCAuto"); if (a) a.disabled = false; draw(); });
      on("phbCAuto", "click", () => { c.colOver = null; draw(); renderSide(); });
      on("phbCDate", "change", e => { c.show.date = e.target.checked; remeasure(); }); on("phbCArea", "change", e => { c.show.area = e.target.checked; remeasure(); }); on("phbCProg", "change", e => { c.show.prog = e.target.checked; remeasure(); });
      on("phbCDel", "click", () => removeObj(selItem()));
    }
    if (t) {
      on("phbTText", "input", e => { t.text = e.target.value; remeasure(); });
      range("phbTSize", v => { t.size = v; remeasure(); }, false);
      on("phbTCol", "input", e => { t.col = e.target.value; draw(); }); on("phbTBold", "change", e => { t.bold = e.target.checked; remeasure(); });
      on("phbTBg", "change", e => { t.bg = e.target.checked; remeasure(); renderSide(); }); on("phbTBgCol", "input", e => { t.bgCol = e.target.value; draw(); });
      on("phbTDel", "click", () => removeObj(selItem()));
    }
  }
  /* Zoom i förhandsvisningen: bara visningen ändras (arbetsytan och exporten är oförändrade). */
  const imgBox = d.querySelector(".phb-img"), zv = d.querySelector("#phbZv"); let zoom = 1, fitW = 0, space = false, pan = null;
  const setZoom = (z, cx, cy) => {
    if (!fitW || zoom === 1) { cv.style.width = ""; const r0 = cv.getBoundingClientRect(); if (zoom === 1) fitW = r0.width; }
    const r = cv.getBoundingClientRect(), nz = Math.max(1, Math.min(8, z));
    const px = cx == null ? r.left + r.width / 2 : cx, py = cy == null ? r.top + r.height / 2 : cy, fx = (px - r.left) / r.width, fy = (py - r.top) / r.height;
    zoom = nz; cv.style.maxWidth = nz === 1 ? "" : "none"; cv.style.maxHeight = nz === 1 ? "" : "none"; cv.style.width = nz === 1 ? "" : (fitW * nz) + "px"; cv.style.height = nz === 1 ? "" : "auto";
    const r2 = cv.getBoundingClientRect(); imgBox.scrollLeft += r2.left + fx * r2.width - px; imgBox.scrollTop += r2.top + fy * r2.height - py;
    zv.textContent = Math.round(nz * 100) + " %"; cv.style.cursor = nz > 1 && space ? "grab" : "";
  };
  requestAnimationFrame(() => { fitW = cv.getBoundingClientRect().width; });
  d.querySelector("#phbZp").onclick = () => setZoom(zoom * 1.25); d.querySelector("#phbZm").onclick = () => setZoom(zoom / 1.25); zv.onclick = () => setZoom(1);
  imgBox.addEventListener("wheel", e => { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY); }, { passive: false });
  d.addEventListener("keydown", e => {
    if (e.key === " " && !/INPUT|TEXTAREA|SELECT|BUTTON/.test((e.target || {}).tagName || "")) { space = true; e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=")) { e.preventDefault(); setZoom(zoom * 1.25); }
    else if ((e.ctrlKey || e.metaKey) && e.key === "-") { e.preventDefault(); setZoom(zoom / 1.25); }
    else if ((e.ctrlKey || e.metaKey) && e.key === "0") { e.preventDefault(); setZoom(1); }
  });
  d.addEventListener("keyup", e => { if (e.key === " ") space = false; });
  cv.addEventListener("pointerdown", e => { if (zoom > 1 && (e.button === 1 || space)) { e.preventDefault(); e.stopImmediatePropagation(); pan = { x: e.clientX, y: e.clientY, l: imgBox.scrollLeft, t: imgBox.scrollTop }; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; } }, true);
  cv.addEventListener("pointermove", e => { if (pan) { e.stopImmediatePropagation(); imgBox.scrollLeft = pan.l - (e.clientX - pan.x); imgBox.scrollTop = pan.t - (e.clientY - pan.y); } }, true);
  const panEnd = () => { if (pan) { pan = null; cv.style.cursor = ""; } }; cv.addEventListener("pointerup", panEnd, true); cv.addEventListener("pointercancel", panEnd, true);
  cv._zoom = () => zoom;
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cur.W / r.width, y: (e.clientY - r.top) * cur.H / r.height }; };
  const hit = p => [...phbObjects(cur)].reverse().find(i => { const b = phbBox(i); return p.x >= b.x && p.x <= b.x + b.W && p.y >= b.y && p.y <= b.y + b.h; });
  const hitDot = p => cur.placed && cur.g.lines ? [...cur.cards].reverse().find(c => Math.hypot(p.x - c.ax, p.y - c.ay) <= (8 * cur.g.dot + 5) * cur.k) : null;
  const onClose = (p, it) => { const b = phbCloseBox(it, cur.k); return Math.hypot(p.x - b.x, p.y - b.y) <= b.r * 1.15; };
  cv.addEventListener("pointerdown", e => {
    if (e.button === 2) return; const p = pos(e), hv = phbObjects(cur).find(i => i.o === cur.hover);
    if (hv && onClose(p, hv)) { removeObj(hv); e.preventDefault(); return; }
    const dot = hitDot(p);
    if (dot && !hit(p)) { const was0 = cur.sel; cur.sel = dot; drag = { dot: true, o: dot, dx: p.x - dot.ax, dy: p.y - dot.ay }; cv.setPointerCapture(e.pointerId); cv.style.cursor = "move"; draw(); if (was0 !== dot) renderSide(); e.preventDefault(); return; }
    const it = hit(p); if (!it) { if (cur.sel) { cur.sel = null; draw(); renderSide(); } return; }
    const was = cur.sel; cur.sel = it.o; drag = { o: it.o, dx: p.x - it.o.x, dy: p.y - it.o.y };
    if (it.type === "card") { cur.cards.splice(cur.cards.indexOf(it.o), 1); cur.cards.push(it.o); }
    cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; draw(); if (was !== it.o) renderSide(); e.preventDefault();
  });
  cv.addEventListener("pointermove", e => {
    const p = pos(e);
    if (!drag) { const it = hit(p), o = it ? it.o : null; if (o !== cur.hover) { cur.hover = o; draw(); } const dt = !it && hitDot(p); cv.style.cursor = it ? (onClose(p, it) ? "pointer" : "grab") : dt ? "move" : ""; return; }
    if (drag.dot) { drag.o.ax = Math.max(0, Math.min(cur.W, p.x - drag.dx)); drag.o.ay = Math.max(0, Math.min(cur.H, p.y - drag.dy)); draw(); return; }
    drag.o.x = Math.max(0, Math.min(cur.W - drag.o.W, p.x - drag.dx)); drag.o.y = Math.max(0, Math.min(cur.H - drag.o.h, p.y - drag.dy)); draw();
  });
  cv.addEventListener("pointerleave", () => { if (!drag && cur.hover) { cur.hover = null; draw(); } });
  const up = () => { drag = null; cv.style.cursor = ""; }; cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  cv.addEventListener("contextmenu", e => { e.preventDefault(); removeObj(hit(pos(e))); });
  const keys = e => {
    if (!document.getElementById("phbDlg")) { document.removeEventListener("keydown", keys, true); return; }
    const typing = /INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || "");
    if ((e.key === "Delete" || e.key === "Backspace") && cur.sel && !typing) { e.preventDefault(); removeObj(selItem()); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); undoRemove(); }
    else if (e.key === "Escape") { e.stopPropagation(); close(); }
  };
  document.addEventListener("keydown", keys, true);
  undoBtn.onclick = undoRemove;
  const close = () => { d.remove(); document.removeEventListener("keydown", keys, true); };
  d.querySelector("#phbClose").onclick = close; d.addEventListener("pointerdown", e => { if (e.target === d) close(); });
  d.querySelector("#phbScope").onchange = async e => { try { const n = await phbBuild(phbLast.blob, phbLast.cam, e.target.value); cur = n; removed = []; draw(); renderSide(); } catch (err) { modelToast("Kunde inte byta urval: " + ((err && err.message) || err)); } };
  const dl = (blob, ext) => { const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `4D-foto-${stamp}.${ext}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };
  d.querySelector("#phbPng").onclick = () => { cur.ui = false; phbRender(ctx, cur); cv.toBlob(b => { cur.ui = true; draw(); dl(b, "png"); }, "image/png"); };
  d.querySelector("#phbPdf").onclick = async () => { try { dl(await phbPdf(cur), "pdf"); } catch (err) { console.warn("PDF", err); modelToast("Kunde inte skapa PDF: " + ((err && err.message) || err)); } };
  draw(); renderSide();
}
function initPhotoBubbles() { const b = document.getElementById("ganttPhotoBtn"); if (b) b.onclick = phbShoot; }
document.addEventListener("DOMContentLoaded", initPhotoBubbles);
if (document.readyState !== "loading") initPhotoBubbles();
