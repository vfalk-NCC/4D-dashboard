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
function phbCardInfo(ctx, a, at, k) {
  const last = x => String(x || "").split("/").map(y => y.trim()).filter(Boolean).pop() || "";
  const fd = d => { const p = parseDate(d); return `${p.getUTCDate()} ${PHB_MON[p.getUTCMonth()]} ${p.getUTCFullYear()}`; };
  const ph = ganttPhaseAt(a, at), W = 250 * k;
  ctx.font = `700 ${15 * k}px "Segoe UI", Arial, sans-serif`;
  const name = phbWrap(ctx, itemLabel(a), W - 30 * k, 2);
  const sub = [];
  if (a.startDate) sub.push(`${fd(a.startDate)} – ${fd(a.actualEndDate && a.actualEndDate > (a.endDate || "") ? a.actualEndDate : a.endDate || a.startDate)}`);
  const ar = String(a.area || "").trim(); if (ar) sub.push(ar);
  const prog = Math.max(0, Math.min(100, Math.round(Number(a.progress) || 0)));
  const h = (name.length * 18 + sub.length * 16 + 34) * k;
  return { a, ph, W, h, name, sub, prog, col: PHB_COL[ph] || PHB_COL.planerad };
}
function phbDrawCard(ctx, c, x, y, k) {
  ctx.save(); ctx.shadowColor = "rgba(15,23,42,.28)"; ctx.shadowBlur = 14 * k; ctx.shadowOffsetY = 3 * k;
  ctx.fillStyle = "#fff"; phbRR(ctx, x, y, c.W, c.h, 5 * k); ctx.fill(); ctx.restore();
  ctx.fillStyle = c.col; ctx.fillRect(x, y + 1, 5 * k, c.h - 2);
  let ty = y + 8 * k; const tx = x + 14 * k;
  ctx.textBaseline = "top"; ctx.fillStyle = "#111827"; ctx.font = `700 ${15 * k}px "Segoe UI", Arial, sans-serif`;
  c.name.forEach(l => { ctx.fillText(l, tx, ty); ty += 18 * k; });
  ctx.font = `${11.5 * k}px "Segoe UI", Arial, sans-serif`; ctx.fillStyle = "#4b5563";
  c.sub.forEach(l => { ctx.fillText(phbWrap(ctx, l, c.W - 24 * k, 1)[0] || "", tx, ty + 1 * k); ty += 16 * k; });
  const by = y + c.h - 14 * k, bw = c.W - 70 * k;
  ctx.fillStyle = "#e5e7eb"; phbRR(ctx, tx, by, bw, 5 * k, 3 * k); ctx.fill();
  ctx.fillStyle = c.ph === "forsenad" ? "#e5262b" : c.col; if (c.prog > 0) { phbRR(ctx, tx, by, Math.max(5 * k, bw * c.prog / 100), 5 * k, 3 * k); ctx.fill(); }
  ctx.fillStyle = "#111827"; ctx.font = `700 ${12 * k}px "Segoe UI", Arial, sans-serif`; ctx.textBaseline = "middle"; ctx.fillText(`${c.prog} %`, tx + bw + 8 * k, by + 2.5 * k);
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
  ctx.font = `700 ${34 * k}px "Segoe UI", Arial, sans-serif`; const w = ctx.measureText(t).width + 44 * k, h = 62 * k;
  ctx.save(); ctx.fillStyle = "rgba(51,58,72,.92)"; phbRR(ctx, 20 * k, 20 * k, w, h, 10 * k); ctx.fill(); ctx.restore();
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(t, 42 * k, 20 * k + h / 2 + 1 * k);
}

async function phbCompose(blob, cam, opts) {
  const bmp = await createImageBitmap(blob), s = Math.max(1, Math.min(3, Math.round(2400 / bmp.width))), W = bmp.width * s, H = bmp.height * s;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d");
  ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, 0, 0, W, H);
  const k = Math.max(0.9, W / 1500), at = (typeof ganttAsOf !== "undefined" && ganttAsOf) || todayISO();
  const { acts, scope } = bubbleActs();
  const anchors = await phbAnchors(acts);
  let cams = null, note = "";
  const cardsAll = anchors.map(o => ({ o, ...phbCardInfo(ctx, o.a, at, k) }));
  let cardsOut = cardsAll, placed = false;
  if (anchors.length) {
    const c = phbPickCamera(cam, anchors.map(o => o.P), W, H);
    if (c) {
      cams = c; placed = true;
      cardsOut = cardsAll.map(cd => { const q = phbProject(c, cd.o.P, W, H); return q ? Object.assign(cd, { ax: q.x, ay: q.y }) : null; }).filter(Boolean);
      cardsOut = cardsOut.filter(cd => cd.ax > -0.05 * W && cd.ax < 1.05 * W && cd.ay > -0.05 * H && cd.ay < 1.05 * H);
    } else note = "Kunde inte avgöra var objekten ligger i bilden – bubblorna ligger i kanten utan linjer.";
  }
  if (!anchors.length) note = "Inga aktiviteter med objekt i modellen att göra bubblor för – markera med Ctrl-klick eller välj period.";
  cardsOut.sort((a, b) => (a.ax || 0) - (b.ax || 0));
  phbLayout(cardsOut, W, H, k, placed);
  if (placed) cardsOut.forEach(c => { // linjer och punkter först, kort ovanpå
    const sx = Math.max(c.x + 14 * k, Math.min(c.x + c.W - 14 * k, c.ax)), sy = c.y + c.h;
    ctx.strokeStyle = c.col; ctx.lineWidth = 2.5 * k; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(c.ax, c.ay); ctx.stroke();
    ctx.fillStyle = c.col; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.arc(c.ax, c.ay, 6 * k, 0, 7); ctx.fill(); ctx.stroke();
  });
  cardsOut.forEach(c => phbDrawCard(ctx, c, c.x, c.y, k));
  if (opts.date && typeof ganttMode !== "undefined" && ganttMode === "time" && at) phbDatePlate(ctx, W, k, at);
  const png = await new Promise(r => cv.toBlob(r, "image/png"));
  return { png, n: cardsOut.length, placed, note, scope, cam: cams };
}

/* ---- Knappen och förhandsvisningen --------------------------------------------------------------------- */
let phbBusy = false;
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
    const res = await phbCompose(blob, cam, { date: true });
    if (!res.placed && cam) console.info("Foto med bubblor: kamerans format kunde inte tolkas", JSON.stringify(cam));
    phbPreview(res);
  } catch (e) { console.warn("Foto", e); modelToast("Kunde inte ta foto: " + ((e && (e.message || e.error)) || "Trimble Connect svarade inte")); }
  finally { phbBusy = false; if (btn) btn.disabled = false; if (hadBubbles) bubblesSchedule(true); }
}
function phbPreview(res) {
  const url = URL.createObjectURL(res.png), old = document.getElementById("phbDlg"); if (old) old.remove();
  const d = document.createElement("div"); d.id = "phbDlg"; d.className = "phb-wrap";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
  d.innerHTML = `<div class="phb-box"><div class="phb-img"><img alt="Foto med bubblor" src="${url}"></div>
    <div class="phb-bar"><span class="phb-info">${res.n} bubbl${res.n === 1 ? "a" : "or"} (${res.scope === "marked" ? "markerade" : res.scope === "all" ? "alla" : "pågående"})${res.note ? " – " + escapeHtml(res.note) : ""}</span>
    <button type="button" id="phbSave" class="primary">Spara bild</button><button type="button" id="phbClose">Stäng</button></div></div>`;
  (document.fullscreenElement || document.body).appendChild(d);
  const close = () => { d.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  d.querySelector("#phbClose").onclick = close; d.addEventListener("pointerdown", e => { if (e.target === d) close(); });
  d.querySelector("#phbSave").onclick = () => { const a = document.createElement("a"); a.href = url; a.download = `4D-foto-${stamp}.png`; document.body.appendChild(a); a.click(); a.remove(); };
}
function initPhotoBubbles() { const b = document.getElementById("ganttPhotoBtn"); if (b) b.onclick = phbShoot; }
document.addEventListener("DOMContentLoaded", initPhotoBubbles);
if (document.readyState !== "loading") initPhotoBubbles();
