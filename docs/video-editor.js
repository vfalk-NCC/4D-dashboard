/* Video editor (Victor 2026-10-13: "bygg in det … som ett block under Gantt-planeringen, kalla det video editor"):
   en film av tidplanen på Trimble Connects egen modell – samma idé som filmen i 3D-editorn.
   – Kameravyer läggs på datum (kamerans läge hämtas ur TC). Mellan två vyer glider kameran, före första och efter sista står den still.
   – Varje bild: datumet sätts i Gantt-schemats Tid-läge (TC färgar/släcker objekten), kameran flyttas, en stillbild hämtas ur TC
     (viewer.getSnapshot) och grafik ritas ovanpå: datumskylt, Pågår nu, förloppsmätare och tidslinje.
   – Stillbilderna samlas först (tar tid – TC ritar en bild i taget), sedan spelas de in till en videofil som sparas på datorn.
   Inget sparas i tidplanen eller i TC. Kameravyer och val sparas i webbläsaren. */

const VID_KEY = "4ddash-video";
const vid = { keys: [], cfg: { from: "", to: "", sec: 20, fps: 15, wait: 300, title: true, now: true, meter: true, miles: true, pearls: true }, run: null, shot: "" };
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
/* Kamerans läge vid en tidpunkt f = dagar efter Från (decimaltal – kameran glider jämnt bild för bild, inte i hela dagssteg). */
function vidCamAtDays(f, from) {
  const ks = vid.keys.map(k => ({ ...k, d: daysBetweenIso(from, k.date) })).sort((x, y) => x.d - y.d);
  if (!ks.length) return null;
  if (f <= ks[0].d) return ks[0].cam;
  const last = ks[ks.length - 1]; if (f >= last.d) return last.cam;
  const i = ks.findIndex(k => k.d > f), a = ks[i - 1], b = ks[i];
  const t = (f - a.d) / Math.max(1e-9, b.d - a.d), k = t * t * (3 - 2 * t); // mjuk start och inbromsning
  return vidLerp(a.cam, b.cam, k);
}
function vidCamAt(date) { const from = vidRange()[0]; return vidCamAtDays(daysBetweenIso(from, date), from); }
/* Kameran för bild i av n i filmen (samma uträkning i förhandsvisning, provbild och rendering). */
function vidCamAtFrame(i, n, from, to) { return vidCamAtDays(daysBetweenIso(from, to) * (i / n), from); }

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
/* Är kamerorna (nästan) samma? Alla tal jämförs. */
function vidCamClose(a, b) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-3 * (1 + Math.abs(b));
  if (a && b && typeof a === "object" && typeof b === "object") return Object.keys(b).every(k => !(k in a) || vidCamClose(a[k], b[k]));
  return true;
}
/* Flyttar kameran. verify: väntar tills Trimble Connect faktiskt står där (annars kan stillbilden tas medan kameran fortfarande rör sig –
   då blir flytten i filmen inte som i förhandsvisningen). */
async function vidSetCam(cam, verify) {
  const V = API && API.viewer; if (!cam || !V || typeof V.setCamera !== "function") return;
  try { await V.setCamera(cam, { animationTime: 0 }); } catch (e) { console.warn("Kamera", e); return; }
  if (!verify || typeof V.getCamera !== "function") return;
  for (let i = 0; i < 40; i++) { // högst ~2 s
    try { const cur = await V.getCamera(); if (vidCamClose(cur, cam)) { await vidSleep(40); return; } } catch (e) { return; }
    await vidSleep(50);
  }
}
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
/* Själva ritningen finns i video-gfx.js (samma som filmen i 3D-editorn). Här: bilden + grafiken för ett datum. */
const vidFxOpts = () => ({ date: !!vid.cfg.title, now: !!vid.cfg.now, meter: !!vid.cfg.meter, miles: vid.cfg.miles !== false });
function vidDraw(ctx, img, W, H, fx, iso, ft) { ctx.drawImage(img, 0, 0, W, H); vgxDraw(ctx, W, H, iso, ft, fx, !!vid.cfg.pearls); }

/* ---- Körning ---------------------------------------------------------------------------------------- */
function vidMime() {
  if (typeof MediaRecorder === "undefined") return null;
  return ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(t => MediaRecorder.isTypeSupported(t)) || "";
}
function vidFrames() { const C = vid.cfg; return Math.max(2, Math.round(Math.max(3, Number(C.sec) || 20) * Math.max(5, Number(C.fps) || 15))); }
function vidDateOfFrame(i, n, from, to) { return addDaysIso(from, Math.round(daysBetweenIso(from, to) * (i / n))); }
function vidMsg(t) { const el = document.getElementById("vidMsg"); if (el) el.textContent = t; }
function vidBusyUi(on) {
  ["vidRender", "vidPreview", "vidShot", "vidShotKeys", "vidAddKey"].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = on; });
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
      await vidSetCam(vidCamAtFrame(i, n, from, to)); await vidSetDate(d);
      vidMsg(`Förhandsvisar ${d} (${Math.round(i / n * 100)} %)`);
      await vidSleep(Math.max(0, step - (performance.now() - t0)));
    }
    vidMsg(run.stop ? "Stoppad." : "Klar.");
  });
}
/* En bild (med grafik) för att kontrollera upplösning och utseende. */
/* Provbilder (Victor 2026-10-14: "ta en specifik sparad provbild … en i taget"): välj en bild i filmen (reglaget eller ◀ ▶) och ta just den,
   eller en på varje kameravy. Bilden har samma kamera, datum och grafik som i den färdiga filmen. De samlas nedan, kan förstoras och sparas. */
async function vidShotFrame(run, i, label) {
  const [from, to] = vidRange(), n = vidFrames(), fps = Math.max(5, Number(vid.cfg.fps) || 15), d = vidDateOfFrame(i, n, from, to);
  await vidSetDate(d); await vidSetCam(vidCamAtFrame(i, n, from, to), true); await vidSleep(Math.max(100, Number(vid.cfg.wait) || 300)); // minst 100 ms: TC ritar om efter datum och kamera
  const blob = await vidSnapshot(), img = await createImageBitmap(blob), c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  // Grafikens läge byggs upp från de närmaste bilderna före (utan nya stillbilder), så att animationerna står som i filmen.
  const fx = vgxStart(from, to, vidFxOpts()), t0ms = vgxDate(from).getTime(), t1ms = vgxDate(to).getTime() + VGX_DAY, j0 = Math.max(0, i - fps * 4);
  for (let j = j0; j <= i; j++) vgxFrame(fx, vidDateOfFrame(j, n, from, to), (j - j0) / fps, t0ms + (t1ms - t0ms) * (j / n));
  vidDraw(c.getContext("2d"), img, c.width, c.height, fx, d, (i - j0) / fps);
  vidAddShot(c, `${label || `Bild ${i + 1} av ${n + 1}`} · ${d}`, i, d);
  vidMsg(`Provbild ${label || `bild ${i + 1} av ${n + 1}`} (${d}): ${img.width}×${img.height} px.`);
}
function vidAddShot(c, caption, i, d) {
  const box = document.getElementById("vidShotBox"); if (!box) return;
  const card = document.createElement("div"); card.className = "vid-card";
  c.className = "vid-shot";
  card.innerHTML = `<div class="vid-card-h"><span></span><span class="vid-card-b"><button type="button" class="vc-big" title="Förstora / förminska">⤢</button><button type="button" class="vc-save" title="Spara bilden som PNG på datorn">⬇ Spara</button><button type="button" class="vc-del" title="Ta bort">✕</button></span></div>`;
  card.querySelector(".vid-card-h span").textContent = caption;
  card.insertBefore(c, card.firstChild.nextSibling);
  card.querySelector(".vc-big").onclick = () => card.classList.toggle("big"); c.onclick = () => card.classList.toggle("big");
  card.querySelector(".vc-del").onclick = () => card.remove();
  card.querySelector(".vc-save").onclick = () => c.toBlob(b => { if (!b) return; const u = URL.createObjectURL(b), a = document.createElement("a"); a.href = u; a.download = `4D-provbild ${d} (bild ${i + 1}).png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }, "image/png");
  box.insertBefore(card, box.firstChild);
  while (box.children.length > 24) box.lastChild.remove();
}
/* Hoppa i TC-vyn till bilden på reglaget: kameran och datumet som bilden har i filmen (Victor 2026-10-14). */
let vidGoSeq = 0, vidGoTimer = null;
function vidGoFrameSoon() { clearTimeout(vidGoTimer); vidGoTimer = setTimeout(() => vidGoFrame(vidFrameSel()), 150); }
async function vidGoFrame(i) {
  if (vid.run || vid.cfg.follow === false) return;
  const seq = ++vidGoSeq, [from, to] = vidRange(), n = vidFrames(), d = vidDateOfFrame(i, n, from, to);
  try {
    const cam = vidCamAtFrame(i, n, from, to);
    if (cam && API && API.viewer && typeof API.viewer.setCamera === "function") await API.viewer.setCamera(cam, { animationTime: 150 });
    if (seq !== vidGoSeq || vid.run) return; // ett nyare hopp har gjorts
    await vidSetDate(d);
  } catch (e) { console.warn("Visa bilden i TC", e); }
}
function vidFrameSel() { const el = document.getElementById("vidFrame"); return el ? Math.max(0, Math.min(vidFrames(), Number(el.value) || 0)) : 0; }
function vidShot() { const i = vidFrameSel(); return vidSession(run => vidShotFrame(run, i)); }
/* En provbild på varje kameravy (närmaste bild till vyns datum), en i taget. */
function vidShotKeys() {
  return vidSession(async run => {
    const [from, to] = vidRange(), n = vidFrames(), keys = vid.keys.slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!keys.length) { vidMsg("Inga kameravyer att ta provbilder på."); return; }
    for (let k = 0; k < keys.length && !run.stop; k++) {
      const span = Math.max(1, daysBetweenIso(from, to)), i = Math.max(0, Math.min(n, Math.round(daysBetweenIso(from, keys[k].date) / span * n)));
      await vidShotFrame(run, i, `Vy ${k + 1}${keys[k].name ? " – " + keys[k].name : ""}`);
    }
  });
}
/* Rendera: samla stillbilder, spela sedan in dem till en videofil. */
function vidRender() {
  return vidSession(async run => {
    const [from, to] = vidRange(), n = vidFrames(), fps = Math.max(5, Number(vid.cfg.fps) || 15), wait = Math.max(100, Number(vid.cfg.wait) || 300);
    if (to < from) { vidMsg("Till-datumet ligger före Från."); return; }
    const mime = vidMime(); if (mime === null) { vidMsg("Webbläsaren kan inte spela in video."); return; }
    const frames = []; const t0 = performance.now(); let lastD = null;
    for (let i = 0; i <= n && !run.stop; i++) {
      const d = vidDateOfFrame(i, n, from, to);
      if (d !== lastD) { await vidSetDate(d); lastD = d; }
      await vidSetCam(vidCamAtFrame(i, n, from, to), true);
      await vidSleep(wait);
      const blob = await vidSnapshot();
      frames.push({ blob, d, i });
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
    const start = performance.now(), fx = vgxStart(from, to, vidFxOpts()), t0ms = vgxDate(from).getTime(), t1ms = vgxDate(to).getTime() + VGX_DAY;
    for (let i = 0; i < frames.length; i++) {
      const img = await createImageBitmap(frames[i].blob), ft = i / fps;
      vgxFrame(fx, frames[i].d, ft, t0ms + (t1ms - t0ms) * (frames[i].i / n)); // animationerna går i takt med filmens tid
      vidDraw(ctx, img, W, H, fx, frames[i].d, ft);
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
  const kept = [...host.querySelectorAll("#vidShotBox .vid-card")]; // provbilderna ligger kvar när blocket ritas om
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
      <div class="vid-row vid-checks"><label><input type="checkbox" id="vidTitle"${C.title ? " checked" : ""} /> Datumskylt</label><label><input type="checkbox" id="vidNow"${C.now ? " checked" : ""} /> Pågår nu-ruta</label><label><input type="checkbox" id="vidMeter"${C.meter ? " checked" : ""} /> Förloppsmätare</label><label><input type="checkbox" id="vidMiles"${C.miles !== false ? " checked" : ""} /> Milstolpar</label><label><input type="checkbox" id="vidPearls"${C.pearls ? " checked" : ""} /> Tidslinje</label></div>
      <div class="vid-row vid-frame"><label>Bild <input type="range" id="vidFrame" min="0" max="${n}" value="${vid.frame == null ? 0 : Math.min(n, vid.frame)}" /></label><label class="vid-follow" title="Flytta TC-vyn till kameran och datumet för bilden när du drar i reglaget"><input type="checkbox" id="vidFollow"${C.follow !== false ? " checked" : ""} /> Visa i TC</label><button type="button" id="vidPrev" title="Föregående bild">◀</button><button type="button" id="vidNext" title="Nästa bild">▶</button><span id="vidFrameLbl" class="hint"></span></div>
      <div class="vid-row"><button type="button" id="vidShot" title="Tar en provbild på vald bild: samma kamera, datum och grafik som i filmen">Provbild på vald bild</button><button type="button" id="vidShotKeys" title="En provbild på varje kameravy">Provbild på varje vy</button><button type="button" id="vidPreview" title="Kamera och datum i TC utan att spela in">▶ Förhandsvisa</button><button type="button" id="vidRender" class="primary" title="Tar alla bilder och sparar videon på datorn">⏺ Rendera video</button><button type="button" id="vidStop" class="hidden" title="Avbryt">■ Stoppa</button>
        <span class="hint">${n + 1} bilder · ${vidMime() ? (/mp4/.test(vidMime()) ? "MP4" : "WebM") : "video stöds inte"} · tar ungefär ${Math.max(1, Math.round((n + 1) * ((Number(C.wait) || 300) + 500) / 60000))} min</span></div>
      <div id="vidMsg" class="hint vid-msg"></div><div id="vidShotBox" class="vid-shotbox"></div></div>`;
  { const bx = host.querySelector("#vidShotBox"); if (bx) kept.forEach(k => bx.appendChild(k)); }
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
  [["vidTitle", "title"], ["vidNow", "now"], ["vidMeter", "meter"], ["vidMiles", "miles"], ["vidPearls", "pearls"]].forEach(([id, k]) => { q("#" + id).onchange = e => put(k, e.target.checked); });
  const fl = () => { const i = vidFrameSel(); vid.frame = i; q("#vidFrameLbl").textContent = `bild ${i + 1} av ${n + 1} · ${vidDateOfFrame(i, n, from, to)} · ${(i / Math.max(5, Number(C.fps) || 15)).toFixed(1).replace(".", ",")} s`; };
  q("#vidFollow").onchange = e => { put("follow", e.target.checked); if (e.target.checked) vidGoFrame(vidFrameSel()); };
  q("#vidFrame").oninput = () => { fl(); vidGoFrameSoon(); }; q("#vidPrev").onclick = () => { q("#vidFrame").value = Math.max(0, vidFrameSel() - 1); fl(); vidGoFrameSoon(); }; q("#vidNext").onclick = () => { q("#vidFrame").value = Math.min(n, vidFrameSel() + 1); fl(); vidGoFrameSoon(); }; fl();
  q("#vidShotKeys").onclick = vidShotKeys;
  q("#vidShot").onclick = vidShot; q("#vidPreview").onclick = vidPreview; q("#vidRender").onclick = vidRender;
  q("#vidStop").onclick = () => { if (vid.run) vid.run.stop = true; };
  if (vid.run) vidBusyUi(true);
}
async function vidSetCamUi(cam) { if (API && API.viewer && typeof API.viewer.setCamera === "function") { try { await API.viewer.setCamera(cam, { animationTime: 600 }); } catch (e) { modelToast("Kunde inte flytta kameran"); } } }
/* Gantt-schemat har ritats om (nytt urval/period): fälten Från/Till följer med, om inget pågår och ingen skriver i blocket. */
function vidRefresh() { const host = document.getElementById("videoEditor"); if (!host || vid.run || host.contains(document.activeElement)) return; const sig = vidRange().join(); if (sig !== vid.sig) { vid.sig = sig; vidRender2(); } }
function initVideoEditor() { if (!document.getElementById("videoEditor")) return; vidRender2(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initVideoEditor); else setTimeout(initVideoEditor, 0);
