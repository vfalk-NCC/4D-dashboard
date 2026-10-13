/* Video editor (Victor 2026-10-13: "bygg in det … som ett block under Gantt-planeringen, kalla det video editor"):
   en film av tidplanen på Trimble Connects egen modell – samma idé som filmen i 3D-editorn.
   – Kameravyer läggs på datum (kamerans läge hämtas ur TC). Mellan två vyer glider kameran, före första och efter sista står den still.
   – Varje bild: datumet sätts i Gantt-schemats Tid-läge (TC färgar/släcker objekten), kameran flyttas, en stillbild hämtas ur TC
     (viewer.getSnapshot) och grafik ritas ovanpå: datumskylt, Pågår nu, förloppsmätare och tidslinje.
   – Stillbilderna samlas först (tar tid – TC ritar en bild i taget), sedan spelas de in till en videofil som sparas på datorn.
   Inget sparas i tidplanen eller i TC. Kameravyer och val sparas i webbläsaren. */

const VID_KEY = "4ddash-video";
const vid = { keys: [], cfg: { from: "", to: "", sec: 20, fps: 15, wait: 300, title: true, now: true, meter: true, pearls: true }, run: null, shot: "" };
try { const s = JSON.parse(localStorage.getItem(VID_KEY) || "{}"); if (Array.isArray(s.keys)) vid.keys = s.keys.filter(k => k && k.date && k.cam); Object.assign(vid.cfg, s.cfg || {}); } catch (e) { /* standard */ }
const vidSave = () => { try { localStorage.setItem(VID_KEY, JSON.stringify({ keys: vid.keys, cfg: vid.cfg })); } catch (e) { /* ingen lagring */ } };
const vidSleep = ms => new Promise(r => setTimeout(r, ms));
const vidEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---- Kameran mellan vyerna ------------------------------------------------------------------------ */
function vidLerp(a, b, k) {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * k;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a)) { const o = {}; Object.keys(a).forEach(key => { o[key] = key in b ? vidLerp(a[key], b[key], k) : a[key]; }); return o; }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v, i) => vidLerp(v, b[i], k));
  return a;
}
function vidCamAt(date) {
  const ks = vid.keys.slice().sort((x, y) => x.date.localeCompare(y.date));
  if (!ks.length) return null;
  if (date <= ks[0].date) return ks[0].cam;
  const last = ks[ks.length - 1]; if (date >= last.date) return last.cam;
  const i = ks.findIndex(k => k.date > date), a = ks[i - 1], b = ks[i];
  const t = daysBetweenIso(a.date, date) / Math.max(1, daysBetweenIso(a.date, b.date)), k = t * t * (3 - 2 * t); // mjuk start och inbromsning
  return vidLerp(a.cam, b.cam, k);
}

/* ---- Datum och 3D ------------------------------------------------------------------------------------- */
function vidRange() {
  const r = typeof ganttTimeRange === "function" ? ganttTimeRange() : null;
  return [vid.cfg.from || (r && r[0]) || todayISO(), vid.cfg.to || (r && r[1]) || todayISO()];
}
async function vidSetDate(d) {
  if (ganttMode !== "time") await setGanttMode("time", true);
  setGanttAsOf(d, { now: true });
  await vidSleep(0);
  for (let i = 0; (ganttTimeBusy || ganttTimePending) && i < 400; i++) await vidSleep(25);
}
async function vidSetCam(cam) { if (cam && API && API.viewer && typeof API.viewer.setCamera === "function") { try { await API.viewer.setCamera(cam, { animationTime: 0 }); } catch (e) { console.warn("Kamera", e); } } }
/* En stillbild ur TC som Blob. */
async function vidSnapshot() {
  const V = API && API.viewer;
  if (!V || typeof V.getSnapshot !== "function") throw new Error("Trimble Connect-vyn kan inte ta stillbilder här");
  let s = await V.getSnapshot();
  if (s && typeof s === "object" && !(s instanceof Blob)) s = s.data || s.image || s.dataUrl || s.url || s;
  if (s instanceof Blob) return s;
  if (typeof s !== "string") throw new Error("Oväntat svar från Trimble Connect (stillbild)");
  return await (await fetch(s.startsWith("data:") || /^(blob|https?):/.test(s) ? s : "data:image/png;base64," + s)).blob();
}

/* ---- Grafik ----------------------------------------------------------------------------------------- */
/* Det som ritas för ett datum (räknas när bilden tas): klar-andel och pågående aktiviteter. */
function vidInfoAt(d) {
  const its = (typeof ganttShownItems !== "undefined" ? ganttShownItems : []).filter(x => x.startDate);
  const acts = mergeActivityGroups(its);
  let done = 0; const now = [];
  acts.forEach(a => { const ph = ganttPhaseAt(a, d); if (ph === "klar") done++; else if (ph === "pagaende" || ph === "forsenad") now.push({ name: itemLabel(a), pct: Math.round(Number(a.progress) || 0), late: ph === "forsenad" }); });
  return { pct: acts.length ? Math.round(done / acts.length * 100) : 0, done, total: acts.length, now: now.slice(0, 6), more: Math.max(0, now.length - 6) };
}
function vidRound(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function vidDraw(ctx, img, W, H, fr, from, to) {
  ctx.drawImage(img, 0, 0, W, H);
  const s = H / 1080, C = vid.cfg, dt = parseDate(fr.d);
  const font = (px, w = 600) => `${w} ${Math.round(px * s)}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.save(); ctx.textBaseline = "middle";
  if (C.title) {
    const lbl = `v.${isoWeekNumber(dt)} · ${shortDateSv(dt)} ${dt.getUTCFullYear()}`;
    ctx.font = font(40, 700); const w = ctx.measureText(lbl).width + 44 * s;
    ctx.fillStyle = "rgba(15,23,42,.74)"; vidRound(ctx, 30 * s, 30 * s, w, 70 * s, 14 * s); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(lbl, 52 * s, 66 * s);
  }
  if (C.meter) {
    const w = 330 * s, x = W - w - 30 * s, y = 30 * s;
    ctx.fillStyle = "rgba(15,23,42,.74)"; vidRound(ctx, x, y, w, 82 * s, 14 * s); ctx.fill();
    ctx.font = font(24, 600); ctx.fillStyle = "#fff"; ctx.fillText(`Klart ${fr.info.pct} %`, x + 20 * s, y + 26 * s);
    ctx.font = font(18, 500); ctx.fillStyle = "#cbd5e1"; ctx.textAlign = "right"; ctx.fillText(`${fr.info.done} av ${fr.info.total}`, x + w - 20 * s, y + 26 * s); ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,.25)"; vidRound(ctx, x + 20 * s, y + 50 * s, w - 40 * s, 14 * s, 7 * s); ctx.fill();
    ctx.fillStyle = STATUS_COLORS.klar || "#3fb950"; vidRound(ctx, x + 20 * s, y + 50 * s, Math.max(14 * s, (w - 40 * s) * fr.info.pct / 100), 14 * s, 7 * s); ctx.fill();
  }
  if (C.now && fr.info.now.length) {
    const rows = fr.info.now, rh = 38 * s, w = 460 * s, h = 54 * s + rows.length * rh + (fr.info.more ? 26 * s : 0), x = W - w - 30 * s, y = H - h - (C.pearls ? 120 : 30) * s;
    ctx.fillStyle = "rgba(15,23,42,.78)"; vidRound(ctx, x, y, w, h, 14 * s); ctx.fill();
    ctx.font = font(22, 700); ctx.fillStyle = "#fff"; ctx.fillText("Pågår nu", x + 20 * s, y + 28 * s);
    rows.forEach((r, i) => {
      const yy = y + 54 * s + i * rh;
      ctx.fillStyle = r.late ? STATUS_COLORS.forsenad || "#e5484d" : STATUS_COLORS.pagaende || "#f5a623"; vidRound(ctx, x + 20 * s, yy + 8 * s, 8 * s, 22 * s, 4 * s); ctx.fill();
      ctx.font = font(19, 500); ctx.fillStyle = "#f1f5f9";
      let t = r.name; const maxW = w - 130 * s; while (t.length > 4 && ctx.measureText(t).width > maxW) t = t.slice(0, -2); if (t !== r.name) t = t.replace(/\s+$/, "") + "…";
      ctx.fillText(t, x + 38 * s, yy + 19 * s); ctx.textAlign = "right"; ctx.fillStyle = "#cbd5e1"; ctx.fillText(`${r.pct} %`, x + w - 20 * s, yy + 19 * s); ctx.textAlign = "left";
    });
    if (fr.info.more) { ctx.font = font(17, 500); ctx.fillStyle = "#94a3b8"; ctx.fillText(`+ ${fr.info.more} till`, x + 38 * s, y + h - 16 * s); }
  }
  if (C.pearls) {
    const x0 = 60 * s, x1 = W - 60 * s, y = H - 52 * s, span = Math.max(1, daysBetweenIso(from, to));
    ctx.fillStyle = "rgba(15,23,42,.6)"; vidRound(ctx, 30 * s, H - 100 * s, W - 60 * s, 76 * s, 14 * s); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.3)"; ctx.fillRect(x0, y - 2 * s, x1 - x0, 4 * s);
    const px = x0 + (x1 - x0) * Math.max(0, Math.min(1, daysBetweenIso(from, fr.d) / span));
    ctx.fillStyle = "#60a5fa"; ctx.fillRect(x0, y - 2 * s, px - x0, 4 * s);
    ctx.beginPath(); ctx.arc(px, y, 9 * s, 0, 7); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.font = font(18, 500); ctx.fillStyle = "#cbd5e1"; ctx.textAlign = "left"; ctx.fillText(shortDateSv(parseDate(from)), x0, y + 24 * s); ctx.textAlign = "right"; ctx.fillText(shortDateSv(parseDate(to)), x1, y + 24 * s); ctx.textAlign = "left";
  }
  ctx.restore();
}

/* ---- Körning ---------------------------------------------------------------------------------------- */
function vidMime() {
  if (typeof MediaRecorder === "undefined") return null;
  return ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(t => MediaRecorder.isTypeSupported(t)) || "";
}
function vidFrames() { const C = vid.cfg; return Math.max(2, Math.round(Math.max(3, Number(C.sec) || 20) * Math.max(5, Number(C.fps) || 15))); }
function vidDateOfFrame(i, n, from, to) { return addDaysIso(from, Math.round(daysBetweenIso(from, to) * (i / n))); }
function vidMsg(t) { const el = document.getElementById("vidMsg"); if (el) el.textContent = t; }
function vidBusyUi(on) {
  ["vidRender", "vidPreview", "vidShot", "vidAddKey"].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = on; });
  const st = document.getElementById("vidStop"); if (st) st.classList.toggle("hidden", !on);
}
async function vidSession(fn) {
  if (vid.run) return;
  const V = API && API.viewer;
  if (!V || typeof V.setCamera !== "function") { modelToast("Video editor kräver Trimble Connect-vyn"); return; }
  const run = vid.run = { stop: false, mode0: ganttMode, asOf0: ganttAsOf, cam0: null };
  try { run.cam0 = await V.getCamera(); } catch (e) { /* okänd kamera */ }
  vidBusyUi(true);
  try { await fn(run); }
  catch (e) { console.warn("Video editor", e); vidMsg("Avbröts: " + ((e && (e.message || e.error)) || e)); modelToast("Video editor: " + ((e && (e.message || e.error)) || "Trimble Connect svarade inte")); }
  finally {
    if (run.cam0) await vidSetCam(run.cam0);
    vid.run = null; vidBusyUi(false);
  }
}
/* Förhandsvisning: kamera och datum, utan stillbilder och utan grafik. */
function vidPreview() {
  return vidSession(async run => {
    const [from, to] = vidRange(), n = vidFrames(), step = 1000 / Math.max(5, Number(vid.cfg.fps) || 15);
    for (let i = 0; i <= n && !run.stop; i++) {
      const d = vidDateOfFrame(i, n, from, to), t0 = performance.now();
      await vidSetCam(vidCamAt(d)); await vidSetDate(d);
      vidMsg(`Förhandsvisar ${d} (${Math.round(i / n * 100)} %)`);
      await vidSleep(Math.max(0, step - (performance.now() - t0)));
    }
    vidMsg(run.stop ? "Stoppad." : "Klar.");
  });
}
/* En bild (med grafik) för att kontrollera upplösning och utseende. */
function vidShot() {
  return vidSession(async run => {
    const [from, to] = vidRange(), d = ganttAsOf && ganttAsOf >= from && ganttAsOf <= to ? ganttAsOf : from;
    await vidSetCam(vidCamAt(d)); await vidSetDate(d); await vidSleep(Number(vid.cfg.wait) || 300);
    const blob = await vidSnapshot(), img = await createImageBitmap(blob), c = document.createElement("canvas");
    c.width = img.width; c.height = img.height; vidDraw(c.getContext("2d"), img, c.width, c.height, { d, i: 0, info: vidInfoAt(d) }, from, to);
    const box = document.getElementById("vidShotBox"); if (box) { box.innerHTML = ""; c.className = "vid-shot"; box.appendChild(c); }
    vidMsg(`Provbild ${d}: ${img.width}×${img.height} px.`);
  });
}
/* Rendera: samla stillbilder, spela sedan in dem till en videofil. */
function vidRender() {
  return vidSession(async run => {
    const [from, to] = vidRange(), n = vidFrames(), fps = Math.max(5, Number(vid.cfg.fps) || 15), wait = Math.max(0, Number(vid.cfg.wait) || 300);
    if (to < from) { vidMsg("Till-datumet ligger före Från."); return; }
    const mime = vidMime(); if (mime === null) { vidMsg("Webbläsaren kan inte spela in video."); return; }
    const frames = []; const t0 = performance.now(); let lastD = null;
    for (let i = 0; i <= n && !run.stop; i++) {
      const d = vidDateOfFrame(i, n, from, to);
      await vidSetCam(vidCamAt(d));
      if (d !== lastD) { await vidSetDate(d); lastD = d; }
      await vidSleep(wait);
      const blob = await vidSnapshot();
      frames.push({ blob, d, i, info: vidInfoAt(d) });
      const el = (performance.now() - t0) / 1000, left = el / (i + 1) * (n - i);
      vidMsg(`Tar bilder: ${i + 1} av ${n + 1} (${d}) – ca ${Math.max(1, Math.round(left / 60))} min kvar. Avbryt med ■.`);
    }
    if (run.stop && frames.length < 2) { vidMsg("Stoppad."); return; }
    // Spela in: bilderna ritas med grafik i takt med bildfrekvensen.
    vidMsg("Spelar in videon…");
    const img0 = await createImageBitmap(frames[0].blob), W = img0.width & ~1, H = img0.height & ~1;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d");
    const stream = cv.captureStream(0), track = stream.getVideoTracks()[0], chunks = [];
    const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: Math.round(W * H * fps * 0.12) });
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start(1000);
    const start = performance.now();
    for (let i = 0; i < frames.length; i++) {
      const img = await createImageBitmap(frames[i].blob);
      vidDraw(ctx, img, W, H, frames[i], from, to);
      if (track.requestFrame) track.requestFrame();
      const wt = start + (i + 1) * 1000 / fps - performance.now(); await vidSleep(Math.max(0, wt));
    }
    await new Promise(r => { rec.onstop = r; rec.stop(); });
    const ext = /mp4/.test(mime) ? "mp4" : "webm", blob = new Blob(chunks, { type: mime || "video/webm" }), name = `4D-film ${from} – ${to}.${ext}`;
    if (!blob.size) { vidMsg("Filmen blev tom – försök igen."); return; }
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 8000);
    vidMsg(`Sparad: ${name} (${(blob.size / 1e6).toFixed(1).replace(".", ",")} MB, ${W}×${H} px${run.stop ? ", avbruten" : ""}).`);
    vid.last = { name, size: blob.size, frames: frames.length, W, H };
  });
}

/* ---- Gränssnittet ---------------------------------------------------------------------------------- */
function vidRender2() {
  const host = document.getElementById("videoEditor"); if (!host) return;
  const C = vid.cfg, [from, to] = vidRange(), n = vidFrames();
  const keys = vid.keys.slice().sort((a, b) => a.date.localeCompare(b.date));
  host.innerHTML = `<div class="vid-hint">Gör en film av tidplanen på modellen i Trimble Connect. Lägg kameravyer på datum – kameran glider mellan dem medan datumet räknas fram och objekten färgas efter läget. Bilderna tas en i taget (det tar en stund) och sätts sedan ihop till en videofil som sparas på datorn. Inget ändras i tidplanen eller i modellen.</div>
    <div class="vid-sec"><b>Kameravyer</b>
      <div class="vid-keys">${keys.map((k, i) => `<div class="vid-key" data-i="${i}"><input type="date" class="vk-date" value="${vidEsc(k.date)}" /><input type="text" class="vk-name" value="${vidEsc(k.name || "")}" placeholder="Namn (valfritt)" /><button type="button" class="vk-go" title="Flytta kameran till vyn">▶</button><button type="button" class="vk-set" title="Ersätt vyn med kamerans nuvarande läge">⟳</button><button type="button" class="vk-del" title="Ta bort vyn">✕</button></div>`).join("") || `<div class="hint">Inga vyer ännu – flytta kameran i modellen och tryck på knappen nedan. Utan vyer står kameran still där den är när du startar.</div>`}</div>
      <div class="vid-row"><label>Datum <input type="date" id="vidKeyDate" value="${vidEsc(ganttAsOf || from)}" /></label><button type="button" id="vidAddKey" title="Spara kamerans nuvarande läge som en vy på datumet">＋ Lägg till vy från kameran</button></div></div>
    <div class="vid-sec"><b>Film</b>
      <div class="vid-row"><label>Från <input type="date" id="vidFrom" value="${vidEsc(C.from || from)}" /></label><label>Till <input type="date" id="vidTo" value="${vidEsc(C.to || to)}" /></label><button type="button" id="vidAuto" title="Hela tidplanens spann">Auto</button>
        <label>Längd <input type="number" id="vidSec" min="3" max="600" value="${C.sec}" /> s</label>
        <label>Bilder/s <select id="vidFps">${[10, 15, 24, 30].map(v => `<option value="${v}"${Number(C.fps) === v ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <label title="Hur länge TC får rita om efter att datum och kamera ändrats, innan bilden tas. Längre = säkrare men långsammare.">Väntetid <input type="number" id="vidWait" min="0" max="5000" step="50" value="${C.wait}" /> ms</label></div>
      <div class="vid-row vid-checks"><label><input type="checkbox" id="vidTitle"${C.title ? " checked" : ""} /> Datumskylt</label><label><input type="checkbox" id="vidNow"${C.now ? " checked" : ""} /> Pågår nu-ruta</label><label><input type="checkbox" id="vidMeter"${C.meter ? " checked" : ""} /> Förloppsmätare</label><label><input type="checkbox" id="vidPearls"${C.pearls ? " checked" : ""} /> Tidslinje</label></div>
      <div class="vid-row"><button type="button" id="vidShot" title="Tar en bild med grafik så att du ser utseendet och upplösningen">Provbild</button><button type="button" id="vidPreview" title="Kamera och datum i TC utan att spela in">▶ Förhandsvisa</button><button type="button" id="vidRender" class="primary" title="Tar alla bilder och sparar videon på datorn">⏺ Rendera video</button><button type="button" id="vidStop" class="hidden" title="Avbryt">■ Stoppa</button>
        <span class="hint">${n + 1} bilder · ${vidMime() ? (/mp4/.test(vidMime()) ? "MP4" : "WebM") : "video stöds inte"} · tar ungefär ${Math.max(1, Math.round((n + 1) * ((Number(C.wait) || 300) + 500) / 60000))} min</span></div>
      <div id="vidMsg" class="hint vid-msg"></div><div id="vidShotBox" class="vid-shotbox"></div></div>`;
  const q = s => host.querySelector(s), put = (k, v) => { vid.cfg[k] = v; vidSave(); };
  host.querySelectorAll(".vid-key").forEach(row => {
    const k = keys[Number(row.dataset.i)], upd = () => { vidSave(); };
    row.querySelector(".vk-date").onchange = e => { k.date = e.target.value || k.date; upd(); vidRender2(); };
    row.querySelector(".vk-name").oninput = e => { k.name = e.target.value; upd(); };
    row.querySelector(".vk-go").onclick = () => vidSetCamUi(k.cam);
    row.querySelector(".vk-set").onclick = async () => { try { k.cam = await API.viewer.getCamera(); vidSave(); modelToast("Vyn ersatt med kamerans läge"); } catch (e) { modelToast("Kunde inte läsa kameran"); } };
    row.querySelector(".vk-del").onclick = () => { vid.keys.splice(vid.keys.indexOf(k), 1); vidSave(); vidRender2(); };
  });
  q("#vidAddKey").onclick = async () => {
    const d = q("#vidKeyDate").value || todayISO();
    try { const cam = await API.viewer.getCamera(); vid.keys = vid.keys.filter(k => k.date !== d); vid.keys.push({ date: d, name: "", cam }); vidSave(); vidRender2(); modelToast(`Kameravy sparad på ${d}`); }
    catch (e) { modelToast("Kunde inte läsa kameran: " + ((e && e.message) || "Trimble Connect svarade inte")); }
  };
  q("#vidFrom").onchange = e => { put("from", e.target.value); vidRender2(); }; q("#vidTo").onchange = e => { put("to", e.target.value); vidRender2(); };
  q("#vidAuto").onclick = () => { put("from", ""); put("to", ""); vidRender2(); };
  q("#vidSec").onchange = e => { put("sec", Math.max(3, Math.min(600, Number(e.target.value) || 20))); vidRender2(); };
  q("#vidFps").onchange = e => { put("fps", Number(e.target.value)); vidRender2(); };
  q("#vidWait").onchange = e => { put("wait", Math.max(0, Math.min(5000, Number(e.target.value) || 300))); vidRender2(); };
  [["vidTitle", "title"], ["vidNow", "now"], ["vidMeter", "meter"], ["vidPearls", "pearls"]].forEach(([id, k]) => { q("#" + id).onchange = e => put(k, e.target.checked); });
  q("#vidShot").onclick = vidShot; q("#vidPreview").onclick = vidPreview; q("#vidRender").onclick = vidRender;
  q("#vidStop").onclick = () => { if (vid.run) vid.run.stop = true; };
  if (vid.run) vidBusyUi(true);
}
async function vidSetCamUi(cam) { if (API && API.viewer && typeof API.viewer.setCamera === "function") { try { await API.viewer.setCamera(cam, { animationTime: 600 }); } catch (e) { modelToast("Kunde inte flytta kameran"); } } }
/* Gantt-schemat har ritats om (nytt urval/period): fälten Från/Till följer med, om inget pågår och ingen skriver i blocket. */
function vidRefresh() { const host = document.getElementById("videoEditor"); if (!host || vid.run || host.contains(document.activeElement)) return; const sig = vidRange().join(); if (sig !== vid.sig) { vid.sig = sig; vidRender2(); } }
function initVideoEditor() { if (!document.getElementById("videoEditor")) return; vidRender2(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initVideoEditor); else setTimeout(initVideoEditor, 0);
