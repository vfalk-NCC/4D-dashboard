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
function phbCardInfo(ctx, a, at, k, fam) {
  fam = fam || 'Arial, Helvetica, sans-serif';
  const last = x => String(x || "").split("/").map(y => y.trim()).filter(Boolean).pop() || "";
  const fd = d => { const p = parseDate(d); return `${p.getUTCDate()} ${PHB_MON[p.getUTCMonth()]} ${p.getUTCFullYear()}`; };
  const ph = ganttPhaseAt(a, at), W = 250 * k;
  ctx.font = `700 ${15 * k}px ${fam}`;
  const name = phbWrap(ctx, itemLabel(a), W - 30 * k, 2);
  const sub = [];
  if (a.startDate) sub.push(`${fd(a.startDate)} – ${fd(a.actualEndDate && a.actualEndDate > (a.endDate || "") ? a.actualEndDate : a.endDate || a.startDate)}`);
  const ar = String(a.area || "").trim(); if (ar) sub.push(ar);
  const prog = Math.max(0, Math.min(100, Math.round(Number(a.progress) || 0)));
  ctx.font = `${11.5 * k}px ${fam}`; sub.forEach((t, i) => { sub[i] = phbWrap(ctx, t, W - 24 * k, 1)[0] || ""; });
  const h = (name.length * 18 + sub.length * 16 + 34) * k;
  return { a, ph, W, h, name, sub, prog, col: PHB_COL[ph] || PHB_COL.planerad };
}
function phbDrawCard(ctx, c, x, y, k) {
  ctx.save(); ctx.shadowColor = "rgba(15,23,42,.28)"; ctx.shadowBlur = 14 * k; ctx.shadowOffsetY = 3 * k;
  ctx.fillStyle = "#fff"; phbRR(ctx, x, y, c.W, c.h, 5 * k); ctx.fill(); ctx.restore();
  ctx.fillStyle = c.col; ctx.fillRect(x, y + 1, 5 * k, c.h - 2);
  let ty = y + 8 * k; const tx = x + 14 * k;
  ctx.textBaseline = "top"; ctx.fillStyle = "#111827"; ctx.font = `700 ${15 * k}px Arial, Helvetica, sans-serif`;
  c.name.forEach(l => { ctx.fillText(l, tx, ty); ty += 18 * k; });
  ctx.font = `${11.5 * k}px Arial, Helvetica, sans-serif`; ctx.fillStyle = "#4b5563";
  c.sub.forEach(l => { ctx.fillText(l, tx, ty + 1 * k); ty += 16 * k; });
  const by = y + c.h - 14 * k, bw = c.W - 70 * k;
  ctx.fillStyle = "#e5e7eb"; phbRR(ctx, tx, by, bw, 5 * k, 3 * k); ctx.fill();
  ctx.fillStyle = c.ph === "forsenad" ? "#e5262b" : c.col; if (c.prog > 0) { phbRR(ctx, tx, by, Math.max(5 * k, bw * c.prog / 100), 5 * k, 3 * k); ctx.fill(); }
  ctx.fillStyle = "#111827"; ctx.font = `700 ${12 * k}px Arial, Helvetica, sans-serif`; ctx.textBaseline = "middle"; ctx.fillText(`${c.prog} %`, tx + bw + 8 * k, by + 2.5 * k);
}
/* Bubblorna ovanför sina punkter; överlapp trycks isär (enkel avstötning) och hålls inom bilden. */
function phbLayout(cards, W, H, k, anchored) {
  const m = 10 * k, gap = 8 * k;
  if (!anchored) { // ingen position: rader längs högerkanten (och nästa kolumn åt vänster)
    let x = W - m, y = m, colW = 0;
    cards.forEach(c => { if (y + c.h > H - m) { x -= colW + gap; y = m; colW = 0; } c.x = x - c.W; c.y = y; y += c.h + gap; colW = Math.max(colW, c.W); });
    return;
  }
  cards.forEach(c => { c.x = c.ax - c.W / 2; c.y = c.ay - c.h - 56 * k; });
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
function phbDatePlate(ctx, W, k, iso) {
  const d = parseDate(iso), t = `v.${isoWeekNumber(d)} · ${d.getUTCDate()} ${PHB_MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  ctx.font = `700 ${34 * k}px Arial, Helvetica, sans-serif`; const w = ctx.measureText(t).width + 44 * k, h = 62 * k;
  ctx.save(); ctx.fillStyle = "rgba(51,58,72,.92)"; phbRR(ctx, 20 * k, 20 * k, w, h, 10 * k); ctx.fill(); ctx.restore();
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(t, 42 * k, 20 * k + h / 2 + 1 * k);
}

/* En bubbla/bild-uppsättning: fotot, bubblorna (med lägen) och vilket urval de kommer ur. Allt ritas om från den här när en bubbla flyttas. */
async function phbBuild(blob, cam, scopeOverride) {
  const bmp = await createImageBitmap(blob), s = Math.max(1, Math.min(3, Math.round(2400 / bmp.width))), W = bmp.width * s, H = bmp.height * s;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d");
  const k = Math.max(0.9, W / 1500), at = (typeof ganttAsOf !== "undefined" && ganttAsOf) || todayISO();
  const sc0 = bubbleCfg.scope; let acts, scope;
  try { if (scopeOverride && scopeOverride !== "auto") bubbleCfg.scope = scopeOverride; ({ acts, scope } = bubbleActs()); } finally { bubbleCfg.scope = sc0; }
  const anchors = await phbAnchors(acts);
  let note = "", placed = false, cards = anchors.map(o => ({ o, ...phbCardInfo(ctx, o.a, at, k), fam: 0 }));
  if (anchors.length) {
    const c = phbPickCamera(cam, anchors.map(o => o.P), W, H);
    if (c) {
      placed = true;
      cards = cards.map(cd => { const q = phbProject(c, cd.o.P, W, H); return q ? Object.assign(cd, { ax: q.x, ay: q.y }) : null; }).filter(cd => cd && cd.ax > -0.05 * W && cd.ax < 1.05 * W && cd.ay > -0.05 * H && cd.ay < 1.05 * H);
    } else note = "Kunde inte avgöra var objekten ligger i bilden – bubblorna ligger i kanten utan linjer.";
  } else note = scope === "marked" ? "Inga markerade aktiviteter med objekt i modellen." : "Inga aktiviteter med objekt i modellen i det här urvalet – markera med Ctrl-klick eller välj ett annat urval.";
  if (anchors.length && placed && !cards.length) note = "Aktiviteternas objekt syns inte i bilden.";
  cards.sort((a, b) => (a.ax || 0) - (b.ax || 0));
  phbLayout(cards, W, H, k, placed);
  const date = typeof ganttMode !== "undefined" && ganttMode === "time" && at ? at : "";
  return { bmp, s, W, H, k, at, cards, placed, note, scope, date, nAnch: anchors.length };
}
/* Närmaste punkt på kortets kant mot punkten – därifrån går linjen. */
function phbLeaderStart(c) {
  const px = Math.max(c.x + 12, Math.min(c.x + c.W - 12, c.ax));
  if (c.ay > c.y + c.h) return { x: px, y: c.y + c.h };
  if (c.ay < c.y) return { x: px, y: c.y };
  return c.ax < c.x ? { x: c.x, y: c.ay } : c.ax > c.x + c.W ? { x: c.x + c.W, y: c.ay } : null;
}
function phbRender(ctx, st) {
  const { W, H, k } = st;
  ctx.imageSmoothingQuality = "high"; ctx.drawImage(st.bmp, 0, 0, W, H);
  if (st.placed) st.cards.forEach(c => {
    const p = phbLeaderStart(c); if (!p) return;
    ctx.strokeStyle = c.col; ctx.lineWidth = 2.5 * k; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(c.ax, c.ay); ctx.stroke();
    ctx.fillStyle = c.col; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.arc(c.ax, c.ay, 6 * k, 0, 7); ctx.fill(); ctx.stroke();
  });
  st.cards.forEach(c => phbDrawCard(ctx, c, c.x, c.y, k));
  if (st.date) phbDatePlate(ctx, W, k, st.date);
  if (st.ui !== false) { // hanteringsgrafik (syns bara på skärmen, aldrig i sparad PNG/PDF): markering och ✕ för att ta bort
    if (st.sel && st.cards.includes(st.sel)) { const c = st.sel; ctx.save(); ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 2.5 * k; ctx.setLineDash([6 * k, 4 * k]); phbRR(ctx, c.x - 3 * k, c.y - 3 * k, c.W + 6 * k, c.h + 6 * k, 6 * k); ctx.stroke(); ctx.restore(); }
    const hv = st.hover && st.cards.includes(st.hover) ? st.hover : null;
    if (hv) { const b = phbCloseBox(hv, k); ctx.save(); ctx.fillStyle = "#dc2626"; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * k; ctx.stroke(); ctx.beginPath(); const d = b.r * 0.38; ctx.moveTo(b.x - d, b.y - d); ctx.lineTo(b.x + d, b.y + d); ctx.moveTo(b.x + d, b.y - d); ctx.lineTo(b.x - d, b.y + d); ctx.lineWidth = 2.4 * k; ctx.lineCap = "round"; ctx.stroke(); ctx.restore(); }
  }
}
const phbCloseBox = (c, k) => ({ x: c.x + c.W - 2 * k, y: c.y + 2 * k, r: 11 * k });

/* ---- PDF: fotot som bild, linjer/punkter och datumskylt som egna lager, varje bubbla som en flyttbar stämpel ---------------- */
const phbWin = ch => ({ "–": 0x96, "—": 0x97, "…": 0x85, "·": 0xB7, "’": 0x27, "“": 0x22, "”": 0x22 }[ch]);
function phbPdfStr(str) { // PDF-sträng (WinAnsi) med skyddade tecken
  let o = "(";
  for (const ch of String(str)) { let c = ch.charCodeAt(0); if (c > 255) c = phbWin(ch) || 63; else if (phbWin(ch)) c = phbWin(ch); if (c === 40 || c === 41 || c === 92) o += "\\" + String.fromCharCode(c); else if (c < 32) o += " "; else o += String.fromCharCode(c); }
  return o + ")";
}
const phbN = n => (Math.round(n * 100) / 100).toString();
const phbRgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(v => phbN(v)).join(" "); };
function phbRRpdf(x, y, w, h, r) { // rundat hörn (bézier), nedre vänstra hörnet i (x, y)
  const q = r * 0.5523;
  return `${phbN(x + r)} ${phbN(y)} m ${phbN(x + w - r)} ${phbN(y)} l ${phbN(x + w - r + q)} ${phbN(y)} ${phbN(x + w)} ${phbN(y + r - q)} ${phbN(x + w)} ${phbN(y + r)} c ${phbN(x + w)} ${phbN(y + h - r)} l ${phbN(x + w)} ${phbN(y + h - r + q)} ${phbN(x + w - r + q)} ${phbN(y + h)} ${phbN(x + w - r)} ${phbN(y + h)} c ${phbN(x + r)} ${phbN(y + h)} l ${phbN(x + r - q)} ${phbN(y + h)} ${phbN(x)} ${phbN(y + h - r + q)} ${phbN(x)} ${phbN(y + h - r)} c ${phbN(x)} ${phbN(y + r)} l ${phbN(x)} ${phbN(y + r - q)} ${phbN(x + r - q)} ${phbN(y)} ${phbN(x + r)} ${phbN(y)} c h `;
}
function phbPdfCard(c, k, f, h0) { // innehållet i en bubblas utseendeström (lokala koordinater, origo nere till vänster)
  const w = c.W * f, h = c.h * f, tx = 14 * k * f; let o = "";
  o += `1 g ${phbRRpdf(0.5, 0.5, w - 1, h - 1, 4 * k * f)} f 0.85 G ${phbN(0.8 * k * f)} w ${phbRRpdf(0.5, 0.5, w - 1, h - 1, 4 * k * f)} S `;
  o += `${phbRgb(c.col)} rg 0 ${phbN(1 * k * f)} ${phbN(5 * k * f)} ${phbN(h - 2 * k * f)} re f `;
  let ty = 8 * k;
  o += `BT 0.07 0.09 0.15 rg /F2 ${phbN(15 * k * f)} Tf `; c.name.forEach(l => { o += `1 0 0 1 ${phbN(tx)} ${phbN(h - (ty + 12.3 * k) * f)} Tm ${phbPdfStr(l)} Tj `; ty += 18 * k; }); o += "ET ";
  o += `BT 0.29 0.33 0.4 rg /F1 ${phbN(11.5 * k * f)} Tf `; c.sub.forEach(l => { o += `1 0 0 1 ${phbN(tx)} ${phbN(h - (ty + 1 * k + 9.4 * k) * f)} Tm ${phbPdfStr(l)} Tj `; ty += 16 * k; }); o += "ET ";
  const by = c.h - 14 * k, bw = c.W - 70 * k;
  o += `0.9 g ${phbRRpdf(tx, h - (by + 5 * k) * f, bw * f, 5 * k * f, 2.5 * k * f)} f `;
  if (c.prog > 0) o += `${phbRgb(c.ph === "forsenad" ? "#e5262b" : c.col)} rg ${phbRRpdf(tx, h - (by + 5 * k) * f, Math.max(5 * k, bw * c.prog / 100) * f, 5 * k * f, 2.5 * k * f)} f `;
  o += `BT 0.07 0.09 0.15 rg /F2 ${phbN(12 * k * f)} Tf 1 0 0 1 ${phbN(tx + (bw + 8 * k) * f)} ${phbN(h - (by + 2.5 * k + 4.2 * k) * f)} Tm ${phbPdfStr(c.prog + " %")} Tj ET `;
  return o;
}
async function phbPdf(st) {
  const jc = document.createElement("canvas"); jc.width = st.bmp.width; jc.height = st.bmp.height; jc.getContext("2d").drawImage(st.bmp, 0, 0);
  const jpeg = new Uint8Array(await (await new Promise(r => jc.toBlob(r, "image/jpeg", 0.95))).arrayBuffer());
  const f = 0.75 / st.s, PW = st.bmp.width * 0.75, PH = st.bmp.height * 0.75, k = st.k, X = x => x * f, Y = y => PH - y * f;
  const objs = []; // { head: "<<…>>" } eller { head, stream: string | Uint8Array }
  const add = (head, stream) => { objs.push({ head, stream }); return objs.length; };
  // Reserverade nummer: 1 katalog, 2 sidor, 3 sida, 4 innehåll, 5 bild, 6–7 typsnitt, 8–10 lager
  objs.length = 10;
  const annots = [], F = `/Font<</F1 6 0 R/F2 7 0 R>>`;
  st.cards.forEach((c, i) => {
    const ap = add(`<</Type/XObject/Subtype/Form/BBox[0 0 ${phbN(c.W * f)} ${phbN(c.h * f)}]/Resources<<${F}>>>>`, phbPdfCard(c, k, f));
    const rect = `${phbN(X(c.x))} ${phbN(Y(c.y + c.h))} ${phbN(X(c.x + c.W))} ${phbN(Y(c.y))}`;
    annots.push(add(`<</Type/Annot/Subtype/Stamp/Rect[${rect}]/F 4/NM ${phbPdfStr("bubbla" + (i + 1))}/T(4D-planering)/Subj(Bubbla)/Contents ${phbPdfStr(c.name.join(" "))}/OC 10 0 R/AP<</N ${ap} 0 R>>/Name/Draft>>`));
  });
  let ct = `q ${phbN(PW)} 0 0 ${phbN(PH)} 0 0 cm /Im0 Do Q\n`;
  if (st.placed) { ct += "/OC /L1 BDC\n"; st.cards.forEach(c => { const p = phbLeaderStart(c); if (!p) return;
    ct += `${phbRgb(c.col)} RG ${phbN(2.5 * k * f)} w 1 J ${phbN(X(p.x))} ${phbN(Y(p.y))} m ${phbN(X(c.ax))} ${phbN(Y(c.ay))} l S `;
    const r = 6 * k * f, cx = X(c.ax), cy = Y(c.ay), q = r * 0.5523, d = `${phbN(cx + r)} ${phbN(cy)} m ${phbN(cx + r)} ${phbN(cy + q)} ${phbN(cx + q)} ${phbN(cy + r)} ${phbN(cx)} ${phbN(cy + r)} c ${phbN(cx - q)} ${phbN(cy + r)} ${phbN(cx - r)} ${phbN(cy + q)} ${phbN(cx - r)} ${phbN(cy)} c ${phbN(cx - r)} ${phbN(cy - q)} ${phbN(cx - q)} ${phbN(cy - r)} ${phbN(cx)} ${phbN(cy - r)} c ${phbN(cx + q)} ${phbN(cy - r)} ${phbN(cx + r)} ${phbN(cy - q)} ${phbN(cx + r)} ${phbN(cy)} c h `;
    ct += `${phbRgb(c.col)} rg 1 G ${phbN(2 * k * f)} w ${d} B\n`; }); ct += "EMC\n"; }
  if (st.date) {
    const d = parseDate(st.date), t = `v.${isoWeekNumber(d)} · ${d.getUTCDate()} ${PHB_MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`, m = document.createElement("canvas").getContext("2d");
    m.font = `700 ${34 * k}px Arial, Helvetica, sans-serif`; const w = (m.measureText(t).width + 44 * k) * f, h = 62 * k * f, x0 = 20 * k * f, y0 = PH - 20 * k * f - h;
    ct += `/OC /L2 BDC 0.2 0.23 0.28 rg ${phbRRpdf(x0, y0, w, h, 10 * k * f)} f 1 g BT /F2 ${phbN(34 * k * f)} Tf 1 0 0 1 ${phbN(x0 + 22 * k * f)} ${phbN(y0 + h / 2 - 11.5 * k * f)} Tm ${phbPdfStr(t)} Tj ET EMC\n`;
  }
  objs[0] = { head: `<</Type/Catalog/Pages 2 0 R/OCProperties<</OCGs[8 0 R 9 0 R 10 0 R]/D<</Order[8 0 R 9 0 R 10 0 R]/ON[8 0 R 9 0 R 10 0 R]>>>>>>` };
  objs[1] = { head: `<</Type/Pages/Kids[3 0 R]/Count 1>>` };
  objs[2] = { head: `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${phbN(PW)} ${phbN(PH)}]/Resources<</XObject<</Im0 5 0 R>>${F}/Properties<</L1 8 0 R/L2 9 0 R>>>>/Contents 4 0 R${annots.length ? `/Annots[${annots.map(n => n + " 0 R").join(" ")}]` : ""}>>` };
  objs[3] = { head: `<<`, stream: ct };
  objs[4] = { head: `<</Type/XObject/Subtype/Image/Width ${st.bmp.width}/Height ${st.bmp.height}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode`, stream: jpeg };
  objs[5] = { head: `<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>` };
  objs[6] = { head: `<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>` };
  objs[7] = { head: `<</Type/OCG/Name(Linjer och punkter)>>` };
  objs[8] = { head: `<</Type/OCG/Name(Datumskylt)>>` };
  objs[9] = { head: `<</Type/OCG/Name(Bubblor)>>` };
  const parts = [], enc = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
  let len = 0; const push = u => { parts.push(u); len += u.length; }, offs = [];
  push(enc("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n"));
  objs.forEach((o, i) => {
    offs[i] = len; push(enc(`${i + 1} 0 obj\n`));
    if (o.stream !== undefined) { const body = typeof o.stream === "string" ? enc(o.stream) : o.stream; push(enc(`${o.head.replace(/>>$/, "")}${o.head.endsWith(">>") ? "" : ""}/Length ${body.length}>>\nstream\n`)); push(body); push(enc("\nendstream")); }
    else push(enc(o.head));
    push(enc("\nendobj\n"));
  });
  const xr = len; let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`; offs.forEach(o => { x += String(o).padStart(10, "0") + " 00000 n \n"; });
  push(enc(x + `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xr}\n%%EOF\n`));
  return new Blob(parts, { type: "application/pdf" });
}

/* ---- Knappen och förhandsvisningen --------------------------------------------------------------------- */
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
function phbPreview(st) {
  const old = document.getElementById("phbDlg"); if (old) old.remove();
  const d = document.createElement("div"); d.id = "phbDlg"; d.className = "phb-wrap";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
  d.innerHTML = `<div class="phb-box"><div class="phb-img"><canvas id="phbCv" width="${st.W}" height="${st.H}"></canvas></div>
    <div class="phb-bar"><span class="phb-info" id="phbInfo"></span>
    <label class="phb-sel">Visa <select id="phbScope"><option value="auto">Markerade, annars pågående</option><option value="marked">Bara markerade</option><option value="active">Pågående</option><option value="all">Alla i schemat</option></select></label>
    <button type="button" id="phbUndo" class="hidden" title="Ta tillbaka den senast borttagna bubblan (Ctrl+Z)">↶ Ångra borttagning</button><button type="button" id="phbPdf" class="primary" title="Foto + bubblor som flyttbara stämplar och egna lager – flytta dem i PDF-läsaren">Spara PDF</button><button type="button" id="phbPng">Spara PNG</button><button type="button" id="phbClose">Stäng</button></div></div>`;
  (document.fullscreenElement || document.body).appendChild(d);
  const cv = d.querySelector("#phbCv"), ctx = cv.getContext("2d"), info = d.querySelector("#phbInfo"); let cur = st;
  cv._state = () => cur; let removed = [];
  const undoBtn = d.querySelector("#phbUndo");
  const draw = () => { cur.ui = cur.ui !== false; phbRender(ctx, cur); undoBtn.classList.toggle("hidden", !removed.length); info.textContent = `${cur.cards.length} bubbl${cur.cards.length === 1 ? "a" : "or"} – dra för att flytta, ✕ (eller Delete / högerklick) för att ta bort${removed.length ? ` · ${removed.length} ${removed.length === 1 ? "borttagen" : "borttagna"}` : ""}${cur.note ? ". " + cur.note : ""}`; };
  const removeCard = c => { const i = cur.cards.indexOf(c); if (i < 0) return; cur.cards.splice(i, 1); removed.push({ c, i }); if (cur.sel === c) cur.sel = null; if (cur.hover === c) cur.hover = null; draw(); };
  const undoRemove = () => { const r = removed.pop(); if (!r) return; cur.cards.splice(Math.min(r.i, cur.cards.length), 0, r.c); cur.sel = r.c; draw(); };
  const hit = p => [...cur.cards].reverse().find(c => p.x >= c.x && p.x <= c.x + c.W && p.y >= c.y && p.y <= c.y + c.h);
  const onClose = (p, c) => { const b = phbCloseBox(c, cur.k); return Math.hypot(p.x - b.x, p.y - b.y) <= b.r * 1.15; };
  draw();
  // Dra bubblorna direkt i bilden (linjen följer med, punkten sitter kvar på objektet).
  let drag = null; const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cur.W / r.width, y: (e.clientY - r.top) * cur.H / r.height }; };
  cv.addEventListener("pointerdown", e => { if (e.button === 2) return; const p = pos(e), hv = cur.hover && cur.cards.includes(cur.hover) ? cur.hover : null; if (hv && onClose(p, hv)) { removeCard(hv); e.preventDefault(); return; }
    const c = hit(p); if (!c) { cur.sel = null; draw(); return; } cur.sel = c; drag = { c, dx: p.x - c.x, dy: p.y - c.y }; cur.cards.splice(cur.cards.indexOf(c), 1); cur.cards.push(c); cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; draw(); e.preventDefault(); });
  cv.addEventListener("pointermove", e => { const p = pos(e); if (!drag) { const c = hit(p); if (c !== cur.hover) { cur.hover = c || null; draw(); } cv.style.cursor = c ? (onClose(p, c) ? "pointer" : "grab") : ""; return; } drag.c.x = Math.max(0, Math.min(cur.W - drag.c.W, p.x - drag.dx)); drag.c.y = Math.max(0, Math.min(cur.H - drag.c.h, p.y - drag.dy)); draw(); });
  cv.addEventListener("pointerleave", () => { if (!drag && cur.hover) { cur.hover = null; draw(); } });
  cv.addEventListener("contextmenu", e => { e.preventDefault(); const c = hit(pos(e)); if (c) removeCard(c); });
  const keys = e => { if (!document.getElementById("phbDlg")) { document.removeEventListener("keydown", keys, true); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && cur.sel && !/INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || "")) { e.preventDefault(); removeCard(cur.sel); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undoRemove(); } else if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", keys, true);
  undoBtn.onclick = undoRemove;
  const up = () => { drag = null; cv.style.cursor = ""; }; cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  const close = () => { d.remove(); document.removeEventListener("keydown", keys, true); };
  d.querySelector("#phbClose").onclick = close; d.addEventListener("pointerdown", e => { if (e.target === d) close(); });
  d.querySelector("#phbScope").onchange = async e => { try { const n = await phbBuild(phbLast.blob, phbLast.cam, e.target.value); cur = n; removed = []; draw(); } catch (err) { modelToast("Kunde inte byta urval: " + ((err && err.message) || err)); } };
  const dl = (blob, ext) => { const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `4D-foto-${stamp}.${ext}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };
  d.querySelector("#phbPng").onclick = () => { cur.ui = false; phbRender(ctx, cur); cv.toBlob(b => { cur.ui = true; draw(); dl(b, "png"); }, "image/png"); };
  d.querySelector("#phbPdf").onclick = async () => { try { dl(await phbPdf(cur), "pdf"); } catch (err) { console.warn("PDF", err); modelToast("Kunde inte skapa PDF: " + ((err && err.message) || err)); } };
}
function initPhotoBubbles() { const b = document.getElementById("ganttPhotoBtn"); if (b) b.onclick = phbShoot; }
document.addEventListener("DOMContentLoaded", initPhotoBubbles);
if (document.readyState !== "loading") initPhotoBubbles();
