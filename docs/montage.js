/* Montageordning (Victor 2026-10-21): en flik bredvid Staplar/Tavla där byggordningar planeras, sparas och spelas upp i TC.
   En sekvens = steg i en egen ordning. Ett steg är antingen kopplat till en aktivitet i tidplanen (följer den, men kan ha ett eget
   förslag på datum) eller ett fritt steg (eget namn, start, längd, beroenden, objekt markerade i TC). Sekvenserna sparas i 4D-data
   (plan_assembly_sequences) så att teamet ser samma. Läget "Gantt" är en egen ganttvy för sekvensen, och "Skicka" gör en HTML-fil
   och en Microsoft Project-XML med förslagen till den som gör Powerproject-tidplanen. */
const MS_TABLE = "plan_assembly_sequences";
/* Färg och opacitet för klara, aktuellt och kommande steg (väljs i pilen vid "Kommande svagt") samt "tänd nedifrån och upp". Sparas i webbläsaren. */
const MS_COLS_DEF = { done: { c: "#969eaa", o: 59 }, cur: { c: "#f59e0b", o: 100 }, fut: { c: "#93c5fd", o: 16 } };
function msColsLoad() { let o = {}; try { o = JSON.parse(localStorage.getItem("4ddash-montage-cols") || "{}"); } catch (e) { /* */ } const r = {}; Object.keys(MS_COLS_DEF).forEach(k => { r[k] = { ...MS_COLS_DEF[k], ...(o[k] || {}) }; }); r.buildUp = o.buildUp === true; r.buildSec = Number(o.buildSec) > 0 ? Number(o.buildSec) : 3; return r; }
const msColsSave = () => { try { localStorage.setItem("4ddash-montage-cols", JSON.stringify(ms.cols)); } catch (e) { /* */ } };
const msRgba = k => { const c = ms.cols[k], h = String(c.c || "#888888").replace("#", ""); return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0, a: Math.round(Math.max(0, Math.min(100, Number(c.o))) / 100 * 255) }; };
const msLogoLoad = () => { try { return JSON.parse(localStorage.getItem("4ddash-montage-logo") || "null") || { src: "", company: "" }; } catch (e) { return { src: "", company: "" }; } };
const msLogoSave = () => { try { localStorage.setItem("4ddash-montage-logo", JSON.stringify(ms.logo)); } catch (e) { ms.msg = "Kunde inte spara loggan i webbläsaren (för stor?)"; } };
const ms = { exSkip: new Set(), opt: { b3d: true, list: true, props: "", all: true }, cols: msColsLoad(), colPop: false, sub: 1, anim: null, orderCache: new Map(), baseShown: null, multi: new Set(), lastCk: null, logo: msLogoLoad(), seqs: [], loaded: false, loading: false, cur: null, dirty: false, mode: "steps", i: 0, play: false, timer: null, live: true, follow: true, future: false, px: 16, busy: false, pending: false, shown: null, el: null, img: null, msg: "", drag: null };
const msEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const msAdd = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const msDiff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
const msToday = () => (typeof todayISO === "function" ? todayISO() : new Date().toISOString().slice(0, 10));
const msId = () => (typeof ghNewId === "function" ? ghNewId() : "m" + Math.random().toString(36).slice(2, 10));

/* ---- Aktiviteter i tidplanen ----------------------------------------------------------------------------------------------------------------- */
function msActs() { return mergeActivityGroups(items.filter(x => x.startDate && x.endDate)); }
const msActKey = a => a.activityKey || String(a.id);
function msActMap() { const m = new Map(); msActs().forEach(a => m.set(msActKey(a), a)); return m; }

/* ---- Sekvenser: skapa --------------------------------------------------------------------------------------------------------------------- */
const msStepFree = (name, dur, deps = [], note = "") => ({ id: msId(), kind: "free", name, note, start: "", dur, deps, objs: [], cam: null, pS: "", pE: "", hours: "", qty: "", unit: "", depLags: {} });
const msActHours = a => { let b = 0; (a ? (a.members || [a]) : []).forEach(m => { const h = Number.isFinite(m.estimatedHours) ? m.estimatedHours : (m.resources || []).reduce((t, r) => t + (Number(r.hours) || 0), 0); if (h > b) b = h; }); return b || null; };
function msNewSeq(name, steps = [], extra = {}) { const t = new Date().toISOString(); return { id: msId(), name, area: "", desc: "", start: msToday(), steps, created_at: t, updated_at: t, ...extra }; }
function msStepsFromFilter() {
  const list = typeof ganttShownItems !== "undefined" && ganttShownItems.length ? ganttShownItems : getFilteredItems(), seen = new Set(), out = [];
  list.filter(a => a.startDate && a.endDate).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate)).forEach(a => { const k = msActKey(a); if (seen.has(k)) return; seen.add(k); out.push({ id: msId(), kind: "act", key: k, name: a.objectName || a.activity || "Aktivitet", note: "", pS: "", pE: "", start: "", dur: 0, deps: [], objs: [], cam: null }); });
  return out;
}

/* ---- Beräkning: effektiva datum per steg ---------------------------------------------------------------------------------------------- */
function msViews(seq) { return seq.type === "compose" ? msComposeLayout(seq).views : msViewsSeq(seq); }
function msViewsSeq(seq) {
  const am = msActMap(), steps = seq.steps, byId = new Map(steps.map(s => [s.id, s]));
  const v = steps.map((st, i) => {
    const a = st.kind === "act" ? am.get(st.key) : null, ppS = a ? a.startDate : "", ppE = a ? a.endDate : "";
    return { st, i, act: a, missing: st.kind === "act" && !a, ppS, ppE, s: "", e: "" };
  });
  const view = new Map(v.map(x => [x.st.id, x]));
  const base = x => {
    const st = x.st;
    if (x.act) { const d = msDiff(x.ppS, x.ppE); const s = st.pS || x.ppS, e = st.pE || (st.pS ? msAdd(st.pS, d) : x.ppE); return [s, e < s ? s : e]; }
    const s = st.start || seq.start || msToday(); return [s, msAdd(s, Math.max(1, Number(st.dur) || 1) - 1)];
  };
  v.forEach(x => { [x.s, x.e] = base(x); });
  const lagOf = (st, d) => Number((st.depLags || {})[d]) || 0; // glapp i dagar efter föregångaren (+ väntetid, − överlapp)
  for (let pass = 0; pass < 60; pass++) { // steg med beroenden startar tidigast dagen efter föregångaren plus glappet – de följer med när föregångaren flyttas
    let ch = false;
    v.forEach(x => {
      if (!x.st.deps.length) return; let need = null;
      x.st.deps.forEach(d => { const p = view.get(d); if (p && p.e) { const n = msAdd(p.e, 1 + lagOf(x.st, d)); if (need === null || n > need) need = n; } });
      if (need === null) return;
      if (x.act) { if (need > x.s) { const dur = msDiff(x.s, x.e); x.s = need; x.e = msAdd(need, dur); ch = true; } return; } // PP-steg skjuts bara framåt
      const floor = x.st.start || seq.start || msToday(), s2 = need > floor ? need : floor;
      if (s2 !== x.s) { x.s = s2; x.e = msAdd(s2, Math.max(1, Number(x.st.dur) || 1) - 1); ch = true; }
    });
    if (!ch) break;
  }
  v.forEach(x => { x.hours = x.st.hours !== "" && x.st.hours != null ? Number(x.st.hours) : msActHours(x.act); x.qty = x.st.qty !== "" && x.st.qty != null ? Number(x.st.qty) : null; x.changed = !!x.act && (x.s !== x.ppS || x.e !== x.ppE); x.isNew = x.st.kind === "free"; x.shift = x.changed ? msDiff(x.ppE, x.e) : 0; });
  return v;
}


/* Sammansättning: en sekvens av sekvenser. Varje del pekar på en sparad sekvens och startar på eget datum, efter en annan del
   (hela eller efter ett visst steg, med glapp) eller vid sammansättningens start. Stegen är de ursprungliga sekvensernas steg. */
/* Grupper av steg (Kombinera): stegen i en grupp visas och spelas upp tillsammans och binds ihop visuellt i ganttvyn. */
const MS_GCOL = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#f97316"];
const msHexA = (h, a) => { const x = String(h || "#4f46e5").replace("#", ""); return `rgba(${parseInt(x.slice(0, 2), 16) || 0},${parseInt(x.slice(2, 4), 16) || 0},${parseInt(x.slice(4, 6), 16) || 0},${a})`; };
const msGrpMap = seq => new Map(((seq && seq.groups) || []).map(g => [g.id, g]));
function msGrp(views, i) { const v = views[i], gm = msGrpMap(ms.cur); if (!v || !v.st.grp || !gm.has(v.st.grp)) return { a: i, b: i, g: null }; let a = i, b = i; views.forEach(x => { if (x.st.grp === v.st.grp) { a = Math.min(a, x.i); b = Math.max(b, x.i); } }); return { a, b, g: gm.get(v.st.grp) }; }
const msNext = () => { if (ms.cur) msGo(msGrp(msViews(ms.cur), ms.i).b + 1); }, msPrev = () => msGo(ms.i - 1);
function msGroupMake() {
  const s = ms.cur; if (!s || s.type === "compose") return; const ids = [...ms.multi].filter(id => s.steps.some(x => x.id === id));
  if (ids.length < 2) { if (typeof modelToast === "function") modelToast("Välj minst två steg (Ctrl+klick på staplarna)"); return; }
  s.groups = s.groups || []; const touched = new Set(ids.map(id => s.steps.find(x => x.id === id).grp).filter(Boolean)); let gid = [...touched][0];
  if (!gid) { gid = msId(); s.groups.push({ id: gid, name: `Grupp ${s.groups.length + 1}`, color: MS_GCOL[s.groups.length % MS_GCOL.length] }); }
  s.steps.forEach(x => { if (ids.includes(x.id) || (x.grp && touched.has(x.grp))) x.grp = gid; });
  const first = s.steps.findIndex(x => x.grp === gid), moved = s.steps.filter(x => x.grp === gid); s.steps = s.steps.filter(x => x.grp !== gid); s.steps.splice(first, 0, ...moved); // medlemmarna läggs intill varandra
  msGroupClean(s); ms.multi.clear(); ms.i = first; ms.shown = null; msTouch(); ms.msg = `${moved.length} steg kombinerade i "${msGrpMap(s).get(gid).name}"`; msPaint(); msApply();
}
function msGroupClean(s) { const cnt = {}; s.steps.forEach(x => { if (x.grp) cnt[x.grp] = (cnt[x.grp] || 0) + 1; }); s.steps.forEach(x => { if (x.grp && cnt[x.grp] < 2) x.grp = ""; }); s.groups = (s.groups || []).filter(g => cnt[g.id] >= 2); }
function msGroupBreak(ids) { const s = ms.cur; if (!s) return; let n = 0; s.steps.forEach(x => { if (ids.includes(x.id) && x.grp) { x.grp = ""; n++; } }); msGroupClean(s); ms.multi.clear(); ms.shown = null; msTouch(); ms.msg = n ? `${n} steg avgrupperade` : ""; msPaint(); msApply(); }
const msLab = x => (x.part ? `${x.partName} › ${x.st.name}` : x.st.name);
function msComposeLayout(seq) {
  const parts = (seq.parts || []).map(p => ({ p, name: "", seq: ms.seqs.find(x => x.id === p.seqId && x.type !== "compose") || null }));
  parts.forEach(pr => { pr.name = pr.seq ? pr.seq.name : "(saknas)"; pr.start = pr.p.start || seq.start || msToday(); });
  const calc = pr => { pr.views = pr.seq ? msViewsSeq({ ...pr.seq, start: pr.start }) : []; pr.s = pr.views.length ? pr.views.reduce((m, v) => (v.s < m ? v.s : m), pr.views[0].s) : pr.start; pr.e = pr.views.length ? pr.views.reduce((m, v) => (v.e > m ? v.e : m), pr.views[0].e) : pr.start; };
  parts.forEach(calc);
  for (let pass = 0; pass < 20; pass++) {
    let ch = false;
    parts.forEach(pr => {
      if (pr.p.start || !pr.p.after) return; const ref = parts.find(x => x.p.id === pr.p.after); if (!ref || ref === pr) return;
      const st = Number(pr.p.afterStep), rv = st >= 0 && ref.views[st] ? ref.views[st].e : ref.e, n = msAdd(rv, 1 + (Number(pr.p.lag) || 0));
      if (n !== pr.start) { pr.start = n; calc(pr); ch = true; }
    });
    if (!ch) break;
  }
  const views = []; parts.forEach((pr, pi) => { pr.first = views.length; pr.views.forEach(v => views.push({ ...v, i: views.length, part: pr, pi, partName: pr.name })); });
  return { parts, views };
}

/* ---- Lagring (4D-data) ---------------------------------------------------------------------------------------------------------------------- */
const msBackend = () => typeof isBackendConfigured === "function" && isBackendConfigured();
async function msLoad(force) {
  if (ms.loading || (ms.loaded && !force)) return; ms.loading = true;
  try {
    if (msBackend()) ms.seqs = await ghReadJSON(settings.githubToken, tablePath(MS_TABLE));
    else { try { ms.seqs = JSON.parse(localStorage.getItem("4ddash-montage") || "[]"); } catch (e) { ms.seqs = []; } }
    ms.loaded = true; ms.msg = "";
  } catch (e) { console.warn("Montageordning: kunde inte läsa", e); ms.seqs = []; ms.loaded = true; ms.msg = "Kunde inte läsa sparade sekvenser: " + ((e && e.message) || e); }
  finally { ms.loading = false; }
  msPaint();
}
async function msSave(asNew) {
  const s = ms.cur; if (!s) return;
  if (asNew) { const n = prompt("Namn på den nya sekvensen", s.name + " (kopia)"); if (!n) return; s.id = msId(); s.name = n; s.created_at = new Date().toISOString(); }
  s.updated_at = new Date().toISOString();
  const copy = JSON.parse(JSON.stringify(s));
  try {
    if (msBackend()) await ghWriteJSON(settings.githubToken, tablePath(MS_TABLE), arr => { const a = (Array.isArray(arr) ? arr : []).filter(x => x.id !== copy.id); a.push(copy); return a; }, `Montageordning: ${copy.name}`);
    else { const a = ms.seqs.filter(x => x.id !== copy.id); a.push(copy); localStorage.setItem("4ddash-montage", JSON.stringify(a)); }
    ms.seqs = ms.seqs.filter(x => x.id !== copy.id).concat([copy]); ms.dirty = false; ms.msg = "Sparad " + new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) + (msBackend() ? "" : " (bara i den här webbläsaren – ingen anslutning till 4D-data)");
  } catch (e) { console.warn(e); ms.msg = "Kunde inte spara: " + ((e && e.message) || e); }
  msPaint();
}
async function msDelete() {
  const s = ms.cur; if (!s || !(await dashConfirm(`Ta bort sekvensen "${s.name}"?\n\nDen försvinner för alla som använder projektet.`, { danger: true, ok: "Ta bort" }))) return;
  try {
    if (msBackend()) await ghWriteJSON(settings.githubToken, tablePath(MS_TABLE), arr => (Array.isArray(arr) ? arr : []).filter(x => x.id !== s.id), `Ta bort montageordning: ${s.name}`);
    else localStorage.setItem("4ddash-montage", JSON.stringify(ms.seqs.filter(x => x.id !== s.id)));
    ms.seqs = ms.seqs.filter(x => x.id !== s.id); msOpenSeq(null, true);
  } catch (e) { alert("Kunde inte ta bort: " + ((e && e.message) || e)); }
}
async function msOpenSeq(id, force) {
  if (!force && ms.dirty && !(await dashConfirm("Du har osparade ändringar.\n\nLämna sekvensen utan att spara?", { ok: "Lämna" }))) return false;
  msPlay(false); ms.cur = id ? JSON.parse(JSON.stringify(ms.seqs.find(x => x.id === id) || null)) : null; ms.dirty = false; ms.i = 0; ms.shown = null; ms.img = null;
  if (!ms.cur) msRestoreModel(); else msApply(); msPaint(); return true;
}
const msTouch = () => { ms.dirty = true; ms.shown = null; };

/* ---- 3D i TC ------------------------------------------------------------------------------------------------------------------------------------ */
function msTargets(st, am) { const a = st.kind === "act" ? am.get(st.key) : null; return [...(a ? (a.members || [a]) : []).filter(m => m.modelId && m.objectId).map(m => ({ modelId: m.modelId, objectId: String(m.objectId) })), ...(st.objs || [])]; }
async function msGroups(V, views) {
  const am = msActMap(), miss = {}; views.forEach(x => { x.t = msTargets(x.st, am); x.t.forEach(t => { const k = `${t.modelId}|${t.objectId}`; if (!ganttRidCache.has(k)) (miss[t.modelId] = miss[t.modelId] || new Set()).add(t.objectId); }); });
  for (const modelId of Object.keys(miss)) { const r = await dashRuntimeIds(V, modelId, [...miss[modelId]]); if (r.modelFailed) continue; r.map.forEach((rid, id) => ganttRidCache.set(`${modelId}|${id}`, rid)); }
  views.forEach(x => { const by = new Map(); x.t.forEach(t => { const rid = ganttRidCache.get(`${t.modelId}|${t.objectId}`); if (rid !== undefined && rid !== null) (by.get(t.modelId) || by.set(t.modelId, []).get(t.modelId)).push(rid); }); x.g = [...by].map(([modelId, rids]) => ({ modelId, rids })); });
}
const msMerge = list => { const by = new Map(); list.forEach(gs => gs.forEach(g => (by.get(g.modelId) || by.set(g.modelId, []).get(g.modelId)).push(...g.rids))); return [...by].map(([modelId, rids]) => ({ modelId, rids })); };
const msMo = gs => gs.map(g => ({ modelId: g.modelId, objectRuntimeIds: g.rids }));
async function msApply() {
  if (!ms.cur) return;
  if (!ms.live || ms.view !== "montage") return;
  if (ms.busy) { ms.pending = true; return; }
  ms.busy = true;
  try {
    const V = API && API.viewer; if (!V || typeof V.setObjectState !== "function" || typeof V.convertToObjectRuntimeIds !== "function") return;
    const views = msViews(ms.cur); await msGroups(V, views);
    const cur = views[ms.i]; if (!cur) return; const gr = msGrp(views, ms.i);
    const anyObj = views.some(x => x.g.length); if (ms.noObjs !== !anyObj) { ms.noObjs = !anyObj; msPaintSoon(); }
    if (!anyObj) { ms.shown = null; return; } // inget steg har objekt i modellen: rör inte modellen
    const done = msMerge(views.filter(x => x.i < gr.a && !x.st.temp).map(x => x.g)), now = msMerge(views.filter(x => x.i >= gr.a && x.i <= gr.b).map(x => x.g)), fut = ms.future ? msMerge(views.filter(x => x.i > gr.b && !x.st.temp).map(x => x.g)) : []; // temporära steg (t.ex. mobilkran) syns bara medan de pågår
    const nNow = now.reduce((a, g) => a + g.rids.length, 0); if (ms.nNow !== nNow) { ms.nNow = nNow; msPaintSoon(); }
    const build = ms.cols.buildUp && nNow > 1; let nowVis = now, k = nNow;
    if (build) { const ord = await msOrder(V, { st: { id: gr.g ? gr.g.id : cur.st.id }, g: now }); k = Math.max(0, Math.min(ord.length, Math.ceil(ms.sub * ord.length - 1e-9))); nowVis = msGroupsOf(ord.slice(0, k)); }
    const vis = msMerge([done, nowVis, fut]), base = JSON.stringify([ms.cur.id, ms.i, gr.b, ms.future, ms.follow, ms.cols, vis.length ? 1 : 0, done.length, fut.length, nNow]), sig = base + "|" + k + "|" + build;
    if (ms.shown === sig) return;
    const ents = vis.map(g => ({ modelId: g.modelId, entityIds: g.rids })), same = ms.baseShown === base && build;
    // allt som inte hör till klara steg, aktuellt steg (eller kommande vid "svagt") släcks undan – även när det aktuella steget saknar objekt
    if (!ents.length) await V.setObjectState(undefined, { visible: false });
    else { try { await V.isolateEntities(ents); } catch (e1) { await V.setObjectState(undefined, { visible: false }); await V.setObjectState({ modelObjectIds: msMo(vis) }, { visible: true }); } }
    if (!same) { // färger sätts bara när steget byts (vid delvis tändning räcker det att visa fler objekt)
      try { await V.setObjectState(undefined, { color: "reset" }); } catch (e) { /* */ }
      if (done.length) await V.setObjectState({ modelObjectIds: msMo(done) }, { color: msRgba("done") });
      if (fut.length) await V.setObjectState({ modelObjectIds: msMo(fut) }, { color: msRgba("fut") });
      if (now.length) await V.setObjectState({ modelObjectIds: msMo(now) }, { color: msRgba("cur") });
    }
    if (!same && ms.follow && typeof V.setCamera === "function") { try { const cam = msCamOf(cur); if (cam) await V.setCamera(cam); else if (now.length) await V.setCamera({ modelObjectIds: msMo(now) }); } catch (e) { console.warn("Montageordning: kamera", e); } }
    ms.shown = sig; ms.baseShown = base; ms.touched3d = true;
  } catch (e) { console.warn("Montageordning", e); if (typeof modelToast === "function") modelToast("Kunde inte uppdatera 3D: " + ((e && (e.message || e.error)) || "Trimble Connect svarade inte")); }
  finally { ms.busy = false; if (ms.pending) { ms.pending = false; msApply(); } }
}
/* Stegets objekt i den ordning de monteras: nedifrån och upp (mitten av objektets höjd), därefter längs x och y. */
async function msOrder(V, cur) {
  const key = cur.st.id + "|" + cur.g.map(g => g.modelId + ":" + g.rids.length).join(","); if (ms.orderCache.has(key)) return ms.orderCache.get(key);
  const out = [];
  for (const g of cur.g) {
    let boxes = []; try { if (typeof V.getObjectBoundingBoxes === "function") boxes = (await V.getObjectBoundingBoxes(g.modelId, g.rids)) || []; } catch (e) { /* utan höjd: behåll ordningen */ }
    const by = new Map(boxes.map(b => [b.id, b.boundingBox]));
    g.rids.forEach((rid, n) => { const b = by.get(rid); out.push({ modelId: g.modelId, rid, n, z: b ? (b.min.z + b.max.z) / 2 : 0, x: b ? (b.min.x + b.max.x) / 2 : 0, y: b ? (b.min.y + b.max.y) / 2 : 0 }); });
  }
  out.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y || a.n - b.n); ms.orderCache.set(key, out); return out;
}
const msGroupsOf = list => { const by = new Map(); list.forEach(o => (by.get(o.modelId) || by.set(o.modelId, []).get(o.modelId)).push(o.rid)); return [...by].map(([modelId, rids]) => ({ modelId, rids })); };
/* Montagebilden: när ett steg tas fram tänds dess objekt gradvis nedifrån och upp (ms.sub går från 0 till 1). */
function msAnimate() {
  clearInterval(ms.anim); ms.anim = null;
  if (!ms.cols.buildUp) { ms.sub = 1; return; }
  ms.sub = 0; const t0 = performance.now(), dur = Math.max(500, ms.cols.buildSec * 1000);
  ms.anim = setInterval(() => { const f = Math.min(1, (performance.now() - t0) / dur); ms.sub = f; msApply(); const r = document.querySelector(".ms-sub"); if (r) r.value = Math.round(f * 100); if (f >= 1) { clearInterval(ms.anim); ms.anim = null; } }, 140);
}
/* Kameravy för ett steg: sekvensens standardvy (om "samma för alla steg" är på) går först, sedan stegets egen, sedan delens sekvens. Så blir alla bilder tagna likadant. */
function msCamOf(x) {
  const top = ms.cur; if (top && top.cam && top.camAll !== false) return top.cam; if (x.st.cam) return x.st.cam;
  const ps = x.part && x.part.seq; if (ps && ps.cam) return ps.cam; return (top && top.cam) || null;
}
async function msRestoreModel() {
  ms.shown = null; const V = API && API.viewer;
  if (V && typeof V.setObjectState === "function" && ms.touched3d) { ms.touched3d = false; try { await V.setObjectState(undefined, { color: "reset" }); await V.setObjectState(undefined, { visible: "reset" }); } catch (e) { console.warn(e); } }
}
function msLeave() { if (!ms.view) return; ms.view = ""; msPlay(false); document.removeEventListener("keydown", msKey, true); msRestoreModel(); }
const msLen = () => (ms.cur ? msViews(ms.cur).length : 0);
function msPlay(on) { ms.play = on; clearInterval(ms.timer); ms.timer = null; if (on && ms.cur) { if (ms.i >= msLen() - 1) ms.i = 0; ms.timer = setInterval(() => { if (!ms.busy) msNext(); }, Math.max(2500, ms.cols.buildUp ? ms.cols.buildSec * 1000 + 900 : 0)); } }
function msGo(i, instant) {
  if (!ms.cur || !msLen()) return; const n = msLen(), was = ms.i;
  ms.i = Math.max(0, Math.min(n - 1, i)); ms.i = msGrp(msViews(ms.cur), ms.i).a; ms.touched3d = ms.live; if (ms.play && msGrp(msViews(ms.cur), ms.i).b >= n - 1) msPlay(false);
  if (instant || ms.i === was) { if (ms.i !== was) { clearInterval(ms.anim); ms.sub = 1; } } else msAnimate();
  msPaint(); msApply();
}
function msKey(e) {
  if (ms.view !== "montage" || !ms.cur) return; const t = e.target;
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== "range" && t.type !== "checkbox") return;
  if (e.key === "ArrowRight") { e.preventDefault(); msNext(); } else if (e.key === "ArrowLeft") { e.preventDefault(); msPrev(); } else if (e.key === " " && !(t && (t.type === "checkbox" || t.tagName === "BUTTON"))) { e.preventDefault(); msPlay(!ms.play); msPaint(); }
}

/* ---- Skärmen ------------------------------------------------------------------------------------------------------------------------------------ */
function msRender(list, el) {
  if (ms.el === el && el.querySelector(".ms-root") && el.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return true; // skriver just nu – rita inte om
  ms.el = el;
  if (!ms.view) { ms.view = "montage"; document.addEventListener("keydown", msKey, true); try { if (typeof ganttMode !== "undefined" && ganttMode !== "off") setGanttMode("off", true); } catch (e) { /* */ } }
  if (!ms.loaded) { el.innerHTML = `<div class="ms-root"><p class="hint">Läser sparade montageordningar …</p></div>`; msLoad(); return true; }
  msPaint(); return true;
}
let msPaintT = 0;
function msPaintSoon() { clearTimeout(msPaintT); msPaintT = setTimeout(msPaint, 0); }
function msPaint() {
  const el = ms.el; if (!el || ms.view !== "montage") return;
  const scroll = el.querySelector(".ms-left") ? el.querySelector(".ms-left").scrollTop : 0, sx = el.querySelector(".ms-gscroll") ? el.querySelector(".ms-gscroll").scrollLeft : 0;
  const s = ms.cur;
  const top = `<div class="ms-top"><select id="msSel" aria-label="Sekvens"><option value="">– Välj sekvens –</option>${ms.seqs.map(x => `<option value="${msEsc(x.id)}"${s && s.id === x.id ? " selected" : ""}>${x.type === "compose" ? "▦ " : ""}${msEsc(x.name)}${x.area ? " · " + msEsc(x.area) : ""}</option>`).join("")}${s && !ms.seqs.some(x => x.id === s.id) ? `<option value="${msEsc(s.id)}" selected>${msEsc(s.name)} (ny)</option>` : ""}</select>
    <button type="button" data-a="newEmpty" title="Starta en tom sekvens och en tom ganttvy">＋ Ny tom</button><select id="msTpl" aria-label="Ny från mall" title="Skapa en ny sekvens från en färdig mall"><option value="">Ny från mall …</option>${msTplOptions()}</select><button type="button" data-a="newCompose" title="Sätt ihop flera sekvenser i en gantt">＋ Sammansättning</button><button type="button" data-a="newFilter" title="Ett steg per aktivitet i Gantt-filtret, i startordning">Från filtret</button>
    ${s ? `<button type="button" class="primary" data-a="save">Spara</button><button type="button" data-a="saveAs">Spara som …</button><button type="button" data-a="dup">Duplicera</button><button type="button" data-a="del">Ta bort</button>${ms.dirty ? `<b class="ms-dirty">● osparad</b>` : ""}` : ""}
    <span class="ms-msg">${msEsc(ms.msg)}</span></div>`;
  if (!s) {
    el.innerHTML = `<div class="ms-root">${top}<div class="ms-intro"><h3>Montageordning</h3><p class="hint">Planera i vilken ordning något byggs, spara flera varianter (t.ex. ett transportband per sekvens) och spela upp dem i 3D-modellen. Börja med en tom sekvens, mallen eller aktiviteterna i filtret.</p>
      ${ms.seqs.length ? `<div class="ms-cards">${ms.seqs.map(x => `<button type="button" class="ms-card" data-open="${msEsc(x.id)}"><b>${x.type === "compose" ? "▦ " : ""}${msEsc(x.name)}</b><small>${x.type === "compose" ? (x.parts || []).length + " sekvenser" : x.steps.length + " steg"}${x.area ? " · " + msEsc(x.area) : ""} · ${msEsc((x.updated_at || "").slice(0, 10))}</small></button>`).join("")}</div>` : `<p class="hint">Inga sparade sekvenser än.</p>`}</div></div>`;
    msWire(); return;
  }
  const views = msViews(s), n = views.length;
  if (ms.i >= n) ms.i = Math.max(0, n - 1);
  const tabs = `<div class="ms-tabs">${[["steps", "Steg"], ["gantt", "Gantt"], ["send", "Skicka"]].map(([k, t]) => `<button type="button" data-mode="${k}" class="${ms.mode === k ? "on" : ""}">${t}</button>`).join("")}</div>`;
  const meta = `<div class="ms-meta"><label>Namn <input data-f="name" value="${msEsc(s.name)}"></label><label>Område/anläggning <input data-f="area" value="${msEsc(s.area)}" placeholder="t.ex. Band 1"></label><label>Startdatum <input type="date" data-f="start" value="${msEsc(s.start)}"></label><label class="ms-grow">Beskrivning <input data-f="desc" value="${msEsc(s.desc)}"></label></div>
    <div class="ms-camrow"><b>Kameravy för bilder:</b> ${s.cam ? `<span class="ok">sparad ✓</span>` : `<span class="hint">ingen – kameran zoomar till varje stegs objekt, så bilderna blir olika</span>`}<button type="button" data-a="saveSeqCam" title="Ställ in vyn i TC först, tryck sedan här">Spara aktuell vy i TC</button><button type="button" data-a="goSeqCam"${s.cam ? "" : " disabled"}>Gå till vyn</button>${s.cam ? `<button type="button" data-a="clearSeqCam">Rensa</button><label><input type="checkbox" data-sq="camAll"${s.camAll !== false ? " checked" : ""}> Samma vy för alla steg</label>` : ""}</div>`;
  const cmp = s.type === "compose", lay = cmp ? msComposeLayout(s) : null;
  const left = ms.mode === "gantt" ? (cmp ? msComposeGanttHtml(s, lay) : msGanttHtml(s, views)) : ms.mode === "send" ? msSendHtml(s, views) : (cmp ? msPartsHtml(s, lay) : msStepsHtml(s, views));
  const warn = !ms.live ? "" : (typeof modelCtl !== "undefined" && !modelCtl.on) ? `<div class="ms-warn3d">3D-styrningen är av – modellen i Trimble Connect ändras inte. <button type="button" data-a="mgOn">Slå på 3D-styrning</button></div>` : ms.noObjs ? `<div class="ms-warn3d">Inget steg har objekt i modellen, så inget kan visas eller släckas. Markera objekt i TC och tryck <b>Sätt från markering</b> på varje steg (eller koppla stegen till aktiviteter).</div>` : "";
  const cur = views[ms.i], player = n ? `${warn}<div class="ms-player"><button type="button" data-a="first" aria-label="Första">⏮</button><button type="button" data-a="prev" aria-label="Föregående">◀</button><button type="button" class="ms-play" data-a="play" aria-label="Spela">${ms.play ? "⏸" : "▶"}</button><button type="button" data-a="next" aria-label="Nästa">▶︎</button><button type="button" data-a="last" aria-label="Sista">⏭</button>
    <input type="range" class="ms-range" min="1" max="${n}" value="${ms.i + 1}" aria-label="Steg"><span class="ms-cur"><b>${ms.i + 1}/${n}</b> ${msEsc(cur ? msLab(cur) : "")}<small>${cur ? msEsc(cur.s) + " → " + msEsc(cur.e) : ""}</small></span>
    <label title="Visa/färga stegen i 3D-modellen"><input type="checkbox" data-o="live"${ms.live ? " checked" : ""}> 3D</label><label><input type="checkbox" data-o="follow"${ms.follow ? " checked" : ""}> Följ kameran</label><label><input type="checkbox" data-o="future"${ms.future ? " checked" : ""}> Kommande svagt</label><button type="button" class="ms-caret" data-a="colPop" aria-label="Färg och opacitet" aria-expanded="${ms.colPop}" title="Färg, opacitet och tändning nedifrån och upp">▾</button>${msBuildSliderHtml(views)}<button type="button" data-a="reset3d" title="Visa hela modellen igen">Visa allt</button></div>` : "";
  el.innerHTML = `<div class="ms-root">${top}${meta}${tabs}<div class="ms-main"><div class="ms-left">${left}</div><div class="ms-right">${cmp ? msPartEditorHtml(s, lay) : msEditorHtml(s, views)}</div></div>${player}</div>`;
  const l = el.querySelector(".ms-left"); if (l) l.scrollTop = scroll; const g = el.querySelector(".ms-gscroll"); if (g) g.scrollLeft = sx;
  msWire();
}

function msBuildSliderHtml(views) {
  const nObj = ms.nNow || 0;
  return (ms.cols.buildUp && nObj > 1 ? `<label class="ms-subl" title="Dra för att tända stegets objekt nedifrån och upp">Montage <input type="range" class="ms-sub" min="0" max="100" value="${Math.round(ms.sub * 100)}"> <small>${nObj} obj.</small></label>` : "") + (ms.colPop ? msColPopHtml() : "");
}
function msColPopHtml() {
  const row = (k, t) => `<div class="ms-cr"><span>${t}</span><input type="color" data-col="${k}" value="${msEsc(ms.cols[k].c)}" aria-label="Färg ${t}"><input type="range" data-op="${k}" min="0" max="100" step="1" value="${ms.cols[k].o}" aria-label="Opacitet ${t}"><b data-opv="${k}">${ms.cols[k].o} %</b></div>`;
  return `<div class="ms-colpop" role="dialog" aria-label="Färg och opacitet"><div class="ms-ch">Färg och opacitet i modellen</div>${row("done", "Klara")}${row("cur", "Aktuellt steg")}${row("fut", "Kommande")}
    <div class="ms-ch">Montagebild</div><label class="ms-bu" title="Stegets objekt tänds ett i taget nedifrån och upp, som en naturlig montagebild (t.ex. 50 prefabobjekt)"><input type="checkbox" data-bu="on"${ms.cols.buildUp ? " checked" : ""}> Tänd nedifrån och upp</label>
    <label class="ms-bu">Tid per steg <select data-bu="sec">${[1, 2, 3, 5, 8, 12].map(v => `<option value="${v}"${Number(ms.cols.buildSec) === v ? " selected" : ""}>${v} s</option>`).join("")}</select></label><button type="button" data-a="colReset">Återställ</button></div>`;
}
function msStepsHtml(s, views) {
  const rows = views.map(x => `<div class="ms-row${x.i === ms.i ? " cur" : ""}${x.missing ? " miss" : ""}" draggable="true" data-i="${x.i}"${x.st.grp && msGrpMap(s).has(x.st.grp) ? ` style="border-left:5px solid ${msGrpMap(s).get(x.st.grp).color}"` : ""}><span class="ms-h" title="Dra för att flytta">⋮⋮</span><input type="checkbox" class="ms-ck" data-ck="${x.i}"${ms.multi.has(x.st.id) ? " checked" : ""} aria-label="Markera steg ${x.i + 1}" title="Markera (Skift-klick markerar ett intervall)"><b>${x.i + 1}</b>
    <span class="ms-nm">${msEsc(x.st.name)}<small>${x.st.kind === "act" ? (x.missing ? "aktiviteten finns inte längre" : "tidplan: " + msEsc(x.ppS.slice(5)) + "–" + msEsc(x.ppE.slice(5)) + (x.changed ? ` · förslag ${msEsc(x.s.slice(5))}–${msEsc(x.e.slice(5))}` : "")) : "fritt steg · " + msEsc(x.s.slice(5)) + "–" + msEsc(x.e.slice(5))}${x.st.objs.length ? " · " + x.st.objs.length + " obj." : ""}${x.st.cam ? " · 📷" : ""}${x.st.note ? " · 📝" : ""}${x.st.grp && msGrpMap(s).has(x.st.grp) ? " · ⛓ " + msEsc(msGrpMap(s).get(x.st.grp).name) : ""}</small></span>
    <span class="ms-ra"><button type="button" data-up="${x.i}" aria-label="Upp">▲</button><button type="button" data-dn="${x.i}" aria-label="Ner">▼</button></span></div>`).join("");
  return `<div class="ms-bar"><button type="button" data-a="addFree">＋ Fritt steg</button><button type="button" data-a="addAct">＋ Aktivitet ur tidplanen …</button><button type="button" data-a="addSel" title="Markera objekt i TC först">＋ Från markering i TC</button><button type="button" data-a="sortStart" title="Ordna efter start">Sortera efter start</button></div>
    ${views.length ? msCamBarHtml(views) : ""}<div id="msPick" class="ms-pick hidden"></div>${rows || `<p class="hint">Inga steg än. Lägg till ett steg ovan, eller byt till Gantt och bygg planen där.</p>`}`;
}
function msCamBarHtml(views) {
  const n = views.filter(x => ms.multi.has(x.st.id)).length, cur = views[ms.i];
  return `<div class="ms-camact"><span class="hint">📷 Kameravy på flera steg:</span><span class="ms-sel">Markera <button type="button" data-a="ckAll">alla</button><button type="button" data-a="ckNone">inga</button><button type="button" data-a="ckNoCam">utan vy</button><button type="button" data-a="ckCam">med vy</button></span>
    <span class="ms-act"><b>${n}</b> valda:<button type="button" data-a="camSetSel"${n ? "" : " disabled"} title="Ställ in vyn i TC först">Spara aktuell TC-vy på valda</button><button type="button" data-a="camCopySel"${n && cur && cur.st.cam ? "" : " disabled"} title="Kopierar vyn från det markerade steget (${cur ? cur.i + 1 : "–"})">Kopiera vy från steg ${cur ? cur.i + 1 : "–"}</button><button type="button" data-a="camClearSel"${n ? "" : " disabled"}>Rensa vy</button><button type="button" data-a="grpMake"${n > 1 ? "" : " disabled"} title="Låt de valda stegen ingå i samma sekvens">⛓ Kombinera</button><button type="button" data-a="grpBreak"${n ? "" : " disabled"}>Avgruppera</button></span></div>`;
}
function msGanttHtml(s, views) {
  const today = msToday(), px = ms.px, gmap = msGrpMap(s);
  let mn = views.length ? views.reduce((m, x) => (x.s < m ? x.s : m), views[0].s) : today, mx = views.length ? views.reduce((m, x) => (x.e > m ? x.e : m), views[0].e) : msAdd(today, 56);
  views.forEach(x => { if (x.act) { if (x.ppS < mn) mn = x.ppS; if (x.ppE > mx) mx = x.ppE; } });
  mn = msAdd(mn, -((new Date(mn + "T00:00:00Z").getUTCDay() + 6) % 7) - 7); mx = msAdd(mx, 21);
  const W = (msDiff(mn, mx) + 1) * px, H = Math.max(views.length, 1) * 28 + 4, X = d => msDiff(mn, d) * px;
  let head = ""; for (let w = mn; w <= mx; w = msAdd(w, 7)) head += `<span style="left:${X(w)}px;width:${7 * px}px">v${typeof isoWeekNumber === "function" ? isoWeekNumber(new Date(w + "T00:00:00Z")) : ""}</span>`;
  const bars = views.map(x => {
    const y = x.i * 28 + 4, cur = x.i === ms.i ? " cur" : "";
    const pp = x.act ? `<i class="ms-pp" style="left:${X(x.ppS)}px;width:${Math.max(4, (msDiff(x.ppS, x.ppE) + 1) * px)}px;top:${y + 1}px" title="Tidplan: ${msEsc(x.ppS)} → ${msEsc(x.ppE)}"></i>` : "";
    const cls = x.act ? (x.changed ? "prop" : "pl") : "free";
    const sel = ms.multi.has(x.st.id) ? " msel" : "", gc = x.st.grp && gmap.has(x.st.grp) ? gmap.get(x.st.grp).color : "";
    return `${pp}<i class="ms-bar2 ${cls}${cur}${sel}${gc ? " ing" : ""}${x.st.temp ? " tmp" : ""}" data-bar="${x.i}" style="${gc ? "--gc:" + gc + ";" : ""}left:${X(x.s)}px;width:${Math.max(6, (msDiff(x.s, x.e) + 1) * px)}px;top:${y + (x.act && x.changed ? 9 : 4)}px" title="${msEsc(x.st.name)}: ${msEsc(x.s)} → ${msEsc(x.e)}"><u data-edge="l"></u><span>${msEsc(x.st.name)}</span><u data-edge="r"></u></i>`;
  }).join("");
  const pos = new Map(views.map(x => [x.st.id, x])); let arrows = "";
  views.forEach(x => x.st.deps.forEach(d => { const p = pos.get(d); if (!p) return; const x1 = X(p.e) + px, y1 = p.i * 28 + 18, x2 = X(x.s), y2 = x.i * 28 + 18, xm = Math.max(x1 + 4, Math.min(x2 - 4, x1 + 6)); arrows += `<path d="M${x1} ${y1}H${xm}V${y2}H${x2}" />`; }));
  // grupper: tonat band bakom medlemmarnas staplar och en färgad kant i etiketterna
  let bands = "";
  gmap.forEach(g => { const mem = views.filter(v => v.st.grp === g.id); if (mem.length < 2) return; const a = mem[0].i, b = mem[mem.length - 1].i, x0 = Math.min(...mem.map(v => X(v.s))) - 7, x1 = Math.max(...mem.map(v => X(v.e) + px)) + 7;
    bands += `<i class="ms-gband" style="--gc:${g.color};--gb:${msHexA(g.color, 0.1)};left:${x0}px;width:${x1 - x0}px;top:${a * 28 + 1}px;height:${(b - a + 1) * 28 - 2}px"></i><i class="ms-gtag" style="--gc:${g.color};left:${x0 + 4}px;top:${a * 28 - 9}px">⛓ ${msEsc(g.name)} · ${mem.length}</i>`; });
  const labels = views.map(x => { const g = x.st.grp ? gmap.get(x.st.grp) : null; return `<div class="ms-gl${x.i === ms.i ? " cur" : ""}${ms.multi.has(x.st.id) ? " msel" : ""}${g ? " grp" : ""}" data-sel="${x.i}" title="${msEsc(x.st.name)}"${g ? ` style="--gc:${g.color}"` : ""}><b>${x.i + 1}</b> ${msEsc(x.st.name)}</div>`; }).join("");
  const nSel = views.filter(v => ms.multi.has(v.st.id)).length, selBar = `<span class="ms-multi">${nSel ? `<b>${nSel} valda</b><button type="button" class="primary" data-a="grpMake"${nSel > 1 ? "" : " disabled"} title="Låt de valda stegen ingå i samma sekvens – de visas och spelas upp tillsammans">⛓ Kombinera</button><button type="button" data-a="grpBreak" title="Ta de valda stegen ur sin grupp">Avgruppera</button><button type="button" data-a="tmpToggle" title="Temporära steg (t.ex. mobilkranar) visas i modellen bara medan de pågår, och syns därefter inte som klara">⏱ Temporär</button><button type="button" data-a="grpClear">Rensa val</button>` : `<span class="hint">Ctrl+klick på staplar för att välja flera och kombinera dem</span>`}</span>`;
  return `<div class="ms-bar"><button type="button" data-a="addFree">＋ Steg</button><button type="button" data-a="addAct">＋ Aktivitet ur tidplanen …</button><label>Zoom <input type="range" id="msPx" min="6" max="40" value="${px}"></label>${selBar}<span class="hint">Dra en stapel för att flytta, dra i kanten för längd. Orange = ditt förslag mot tidplanen (grå stapel under).</span></div><div id="msPick" class="ms-pick hidden"></div>
    <div class="ms-g"><div class="ms-glabels"><div class="ms-ghead">&nbsp;</div>${labels}</div><div class="ms-gscroll"><div class="ms-gcanvas" style="width:${W}px;height:${H + 22}px"><div class="ms-gh">${head}</div><div class="ms-gb" style="height:${H}px"><div class="ms-today" style="left:${X(today)}px"></div>${bands}${bars}<svg width="${W}" height="${H}">${arrows}</svg></div></div></div></div>${views.length ? "" : `<p class="hint">Tom ganttvy. Tryck ＋ Steg för att börja planera.</p>`}`;
}
function msEditorHtml(s, views) {
  const x = views[ms.i]; if (!x) return `<p class="hint">Välj ett steg för att redigera det.</p>`;
  const st = x.st, others = views.filter(v => v.i !== x.i);
  return `<h4>Steg ${x.i + 1}</h4><label>Namn <input data-sf="name" value="${msEsc(st.name)}" ${st.kind === "act" ? 'title="Eget namn i sekvensen – tidplanens namn ändras inte"' : ""}></label>
    ${(() => { const g = st.grp ? msGrpMap(s).get(st.grp) : null; return g ? `<div class="ms-grpe" style="--gc:${g.color}"><b>⛓ Grupp</b><input data-gn value="${msEsc(g.name)}" aria-label="Gruppens namn"><input type="color" data-gc value="${msEsc(g.color)}" aria-label="Gruppens färg"><button type="button" data-a="grpBreak1">Ta ur gruppen</button><small class="hint">Stegen i gruppen visas och spelas upp tillsammans.</small></div>` : ""; })()}
    ${st.kind === "act" ? `<div class="ms-info">${x.missing ? `<b class="bad">Aktiviteten finns inte längre i tidplanen.</b>` : `Tidplan: ${msEsc(x.ppS)} → ${msEsc(x.ppE)}`}<br><label>Förslag start <input type="date" data-sf="pS" value="${msEsc(st.pS)}"></label> <label>slut <input type="date" data-sf="pE" value="${msEsc(st.pE)}"></label> <button type="button" data-a="clearProp">Rensa förslag</button></div>`
      : `<div class="ms-info"><label>Start <input type="date" data-sf="start" value="${msEsc(st.start)}" title="Tomt = efter föregående steg (eller sekvensens start)"></label> <label>Längd (dagar) <input type="number" min="1" data-sf="dur" value="${st.dur || 1}" style="width:64px"></label>${st.deps.length && !st.start ? `<small class="hint">Startar dagen efter föregående: ${msEsc(x.s)}</small>` : ""}</div>`}
    <label class="ms-tmpl" title="Visas i modellen bara medan steget pågår, och blir inte kvar som klart. Bra för mobilkranar och andra tillfälliga saker som flyttas runt."><input type="checkbox" data-sf="temp"${st.temp ? " checked" : ""}> ⏱ Temporär (t.ex. mobilkran)</label>
    <label>Anteckning <textarea data-sf="note" rows="3">${msEsc(st.note)}</textarea></label>
    <details class="ms-adv"${st.hours !== "" && st.hours != null || st.qty !== "" && st.qty != null ? " open" : ""}><summary>Avancerat</summary><div class="ms-advb"><label>Timmar <input type="number" min="0" step="any" data-sf="hours" value="${msEsc(st.hours)}" placeholder="${x.act && msActHours(x.act) ? msActHours(x.act) + " (tidplan)" : ""}"></label><label>Mängd <input type="number" min="0" step="any" data-sf="qty" value="${msEsc(st.qty)}"></label><label>Enhet <input data-sf="unit" value="${msEsc(st.unit)}" placeholder="m³, m², st …" style="width:80px"></label></div><small class="hint">Visas diskret i rapporten och i CSV-filen.</small></details>
    <label>Väntar på <select data-sf="deps" multiple size="${Math.min(6, Math.max(2, others.length))}">${others.map(o => `<option value="${msEsc(o.st.id)}"${st.deps.includes(o.st.id) ? " selected" : ""}>${o.i + 1}. ${msEsc(o.st.name)}</option>`).join("")}</select></label>
    ${st.deps.length ? `<div class="ms-lags">${st.deps.map(d => { const o = views.find(v => v.st.id === d); return o ? `<label>Glapp efter ${o.i + 1} <input type="number" data-lag="${msEsc(d)}" value="${Number((st.depLags || {})[d]) || 0}" style="width:62px"> d</label>` : ""; }).join("")}<small class="hint">+ = väntetid, − = överlapp. Steget följer med när det föregående flyttas.</small></div>` : ""}
    <div class="ms-ob"><b>3D:</b> ${(x.t || msTargets(st, msActMap())).length} objekt <button type="button" data-a="setObjs" title="Markera objekt i TC först">Sätt från markering</button><button type="button" data-a="showObjs">Visa</button>${st.objs.length ? `<button type="button" data-a="clearObjs">Rensa egna</button>` : ""}<br><button type="button" data-a="saveCam">Spara kameravy</button>${st.cam ? `<button type="button" data-a="clearCam">Ta bort kameravy</button><br><button type="button" data-a="camEmptySteps" title="Kopierar vyn till alla steg som saknar kameravy">Samma vy på steg utan vy</button><button type="button" data-a="camAllSteps" title="Kopierar vyn till alla steg">Samma vy på alla steg</button><small class="hint">kameravy sparad</small>` : `<small class="hint">ingen – zoomar till objekten</small>`}</div>
    <div class="ms-del"><button type="button" data-a="delStep">Ta bort steget</button></div>`;
}

/* ---- Skicka: förslag till den som gör tidplanen ------------------------------------------------------------------------------- */
function msChanges(views) { return views.filter(x => x.isNew || x.changed || x.st.note); }
function msSendHtml(s, views) {
  const ch = views.filter(x => x.isNew || x.changed), nNew = views.filter(x => x.isNew).length, nMov = views.filter(x => x.changed).length;
  return `<p class="hint">Samlar dina förslag mot tidplanen: nya steg, flyttade aktiviteter och anteckningar. Skicka HTML-filen (läsbar, kan skrivas ut som PDF) och/eller XML-filen som kan importeras i Powerproject (Importera från Microsoft Project® XML).</p>
    <div class="ms-kpis"><div><b>${views.length}</b>steg</div><div><b>${nNew}</b>nya steg</div><div><b>${nMov}</b>flyttade mot tidplanen</div><div><b>${views.filter(x => x.st.note).length}</b>anteckningar</div></div>
    <details class="ms-adv ms-logo"${ms.logo.src || ms.logo.company ? " open" : ""}><summary>Logotyp och avsändare i rapporten</summary><div class="ms-advb"><label>Logotyp <input type="file" id="msLogoFile" accept="image/png,image/jpeg,image/svg+xml,image/webp"></label>${ms.logo.src ? `<img class="ms-logoimg" src="${msEsc(ms.logo.src)}" alt="Logotyp"><button type="button" data-a="logoDel">Ta bort</button>` : ""}<label>Företag / avsändare <input data-lg="company" value="${msEsc(ms.logo.company)}" placeholder="t.ex. NCC Sverige" style="width:180px"></label><label>Skapad av <input data-lg="author" value="${msEsc(ms.logo.author === undefined ? "Victor Falk NCC" : ms.logo.author)}" placeholder="Victor Falk NCC" style="width:160px"></label></div><small class="hint">Loggan sparas i den här webbläsaren och visas i rapportens sidhuvud (på en ljus bricka, så den syns oavsett färg).</small></details>
    <div class="ms-bar"><span class="hint">Exporten innehåller alltid 3D-modell, bild per steg (steg för steg) och objektlista.</span><label>Extra kolumner (valfritt) <input id="msProps" value="${msEsc(ms.opt.props)}" placeholder="t.ex. Planning_stack_no, IMPACT*" style="width:230px" title="Egenskapsnamn, kommaseparerade. Skriv t.ex. IMPACT* för alla egenskaper i gruppen IMPACT. Tomma kolumner tas bort."></label><label title="Alla ifyllda egenskaper visas i en detaljruta när man klickar på ett objekt i listan"><input type="checkbox" id="msObAll"${ms.opt.all ? " checked" : ""}> Alla egenskaper i detaljruta</label></div>
    <div class="ms-bar"><label title="Lägre kvalitet ger mycket mindre fil">Bildkvalitet <select id="msImgQ"><option value="high"${ms.imgQ === "high" ? " selected" : ""}>Hög (stor fil)</option><option value="mid"${!ms.imgQ || ms.imgQ === "mid" ? " selected" : ""}>Medel</option><option value="low"${ms.imgQ === "low" ? " selected" : ""}>Låg</option><option value="min"${ms.imgQ === "min" ? " selected" : ""}>Minsta fil</option></select></label></div>
    <div class="ms-bar"><button type="button" class="primary" data-a="exHtml">Exportera</button><span id="msExMsg" class="hint"></span></div>
    <details class="ms-adv ms-more"><summary>Andra format (för planeraren)</summary><div class="ms-advb"><button type="button" data-a="exXml">MS Project-XML (${ms.allXml ? views.length : ch.length} aktiviteter)</button><label><input type="checkbox" id="msAllXml"${ms.allXml ? " checked" : ""}> Alla steg i XML</label><button type="button" data-a="exTxt">Kopiera som text</button></div></details>
    <p class="hint">HTML-filen är redigerbar: texter kan ändras i filen (✎ Redigera texter) och sparas sedan som ny, låst HTML. Objektlistan har bock för monterad och kommentar per objekt.</p>
    <div class="ms-bar"><span class="hint">Bocka i vilka steg som ska med i exporten:</span><button type="button" data-a="exAll">Alla</button><button type="button" data-a="exNone">Inga</button><span class="hint">${views.filter(x => !ms.exSkip.has(x.st.id)).length} av ${views.length} valda</span></div>
    <table class="ms-tbl"><tr><th></th><th>#</th><th>Steg</th><th>Tidplan</th><th>Förslag</th><th>Skillnad</th></tr>${views.map(x => `<tr><td><input type="checkbox" data-ex="${msEsc(x.st.id)}"${ms.exSkip.has(x.st.id) ? "" : " checked"} aria-label="Med i exporten"></td><td>${x.i + 1}</td><td>${msEsc(msLab(x))}${x.st.note ? `<small>📝 ${msEsc(x.st.note)}</small>` : ""}</td><td>${x.act ? msEsc(x.ppS) + " → " + msEsc(x.ppE) : "–"}</td><td>${msEsc(x.s)} → ${msEsc(x.e)}</td><td>${x.isNew ? "nytt steg" : x.changed ? (x.shift > 0 ? "+" : "") + x.shift + " d" : ""}</td></tr>`).join("")}</table>`;
}
function msDownload(name, text, mime) { const a = document.createElement("a"), u = URL.createObjectURL(new Blob([text], { type: mime || "text/html;charset=utf-8" })); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); }
const msSafe = t => String(t || "").replace(/[^\wåäöÅÄÖ.-]+/g, "_").slice(0, 40) || "sekvens";
function msText(s, views) { return `${s.name}${s.area ? " (" + s.area + ")" : ""} – förslag på montageordning\n${s.desc ? s.desc + "\n" : ""}\n` + views.map(x => `${x.i + 1}. ${msLab(x)}: ${x.s} → ${x.e}${x.act ? (x.changed ? ` (tidplan ${x.ppS} → ${x.ppE}, ${x.shift > 0 ? "+" : ""}${x.shift} d)` : " (som tidplan)") : " (nytt steg)"}${x.st.deps.length ? " – väntar på " + x.st.deps.map(d => { const p = views.find(v => v.st.id === d); return p ? p.i + 1 : "?"; }).join(", ") : ""}${x.st.note ? "\n   " + x.st.note : ""}`).join("\n"); }
function msHtmlDoc(s, views, imgs, info) {
  const D = msReportData(s, views, imgs, info), json = JSON.stringify(D).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${msEsc(s.name)} – montageordning</title><style>${MS_MOD_CSS}</style></head><body><noscript><p style="padding:20px">Rapporten kräver JavaScript för att visas.</p></noscript><script>(${msModernRuntime.toString()})(${json});<\/script></body></html>`;
}
function msXml(s, views, all) {
  const use = views.filter(x => all || x.isNew || x.changed), ids = new Set(use.map(x => x.st.id));
  const list = use.map(x => ({ startDate: x.s, endDate: x.e, objectName: x.st.name, activity: "", area: x.part ? s.name + "/" + x.partName : s.name + " (förslag)", members: [{ id: x.st.id, dependsOn: x.st.deps.filter(d => ids.has(d)), depLags: x.st.depLags || {} }] }));
  return list.length ? buildMspXml(list, { project: s.name + " – förslag", resources: false }) : null;
}
const MS_IMGQ = { high: [1600, 0.88], mid: [1000, 0.7], low: [720, 0.55], min: [480, 0.4] };
function msShrink(src, q) {
  const [maxW, quality] = MS_IMGQ[q] || MS_IMGQ.mid;
  return new Promise(res => { const im = new Image(); im.onload = () => { const k = Math.min(1, maxW / im.width), c = document.createElement("canvas"); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k)); const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", quality)); }; im.onerror = () => res(src); im.src = src; });
}
async function msSnapshots(views, note) {
  const V = API && API.viewer, out = {}; if (!V || typeof V.getSnapshot !== "function") return out; const keep = ms.i, keepFollow = ms.follow; ms.follow = true;
  for (const x of views) { ms.i = x.i; ms.shown = null; ms.touched3d = true; note(`3D-bild ${x.i + 1} av ${views.length} …`); await msApply(); await new Promise(r => setTimeout(r, 700)); try { const sn = await V.getSnapshot(); const raw = typeof sn === "string" ? sn : (sn && (sn.data || sn.dataUrl)) || ""; out[x.st.id] = raw ? await msShrink(raw, ms.imgQ || "mid") : ""; } catch (e) { console.warn(e); } }
  ms.follow = keepFollow; ms.i = keep; ms.shown = null; msApply(); return out;
}
/* Objekten per steg ur TC: namn, typ, valda egenskaper och omslutande låda (för 3D-vyn), sorterade nedifrån och upp. */
async function msCollectObjects(views, note, opts) {
  const V = API && API.viewer; if (!V) throw new Error("Trimble Connect-vyn behövs för att hämta objekten");
  await msGroups(V, views); const cols = String(opts.props || "").split(",").map(x => x.trim()).filter(Boolean), byStep = {}, all = []; let n = 0; const tot = views.reduce((a, x) => a + x.g.reduce((b, g) => b + g.rids.length, 0), 0);
  const r2 = v => Math.round(v * 100) / 100;
  for (const x of views) {
    const targets = (x.t || []).map(t => ({ ...t, rid: ganttRidCache.get(`${t.modelId}|${t.objectId}`) })).filter(t => t.rid !== undefined && t.rid !== null), list = [];
    const byModel = new Map(); targets.forEach(t => (byModel.get(t.modelId) || byModel.set(t.modelId, []).get(t.modelId)).push(t));
    for (const [modelId, ts] of byModel) for (let i = 0; i < ts.length; i += 120) {
      const chunk = ts.slice(i, i + 120), rids = chunk.map(t => t.rid); let bb = [], pr = [];
      if (opts.b3d && typeof V.getObjectBoundingBoxes === "function") { try { bb = (await V.getObjectBoundingBoxes(modelId, rids)) || []; } catch (e) { console.warn("Lådor", e); } }
      if (opts.list && typeof V.getObjectProperties === "function") { try { pr = (await V.getObjectProperties(modelId, rids)) || []; } catch (e) { console.warn("Egenskaper", e); } }
      const bm = new Map(bb.map(b => [b.id, b.boundingBox])), pm = new Map(pr.map(p => [p.id, p]));
      chunk.forEach(t => { const p = pm.get(t.rid), flat = p && typeof qtyFlat === "function" ? qtyFlat(p) : {}, bx = bm.get(t.rid);
        list.push({ id: String(t.objectId).slice(-8), g: String(t.objectId), n: (p && ((p.product && p.product.name) || p.class)) || "Objekt " + t.rid, t: p && p.class ? String(p.class).replace(/^Ifc/, "") : "", p: [], _f: flat, b: bx && bx.min && bx.max ? [bx.min.x, bx.min.y, bx.min.z, bx.max.x, bx.max.y, bx.max.z] : null }); });
      n += chunk.length; note(`Hämtar objekt … ${n} av ${tot}`);
    }
    list.sort((a, b) => (a.b ? a.b[2] + a.b[5] : 0) - (b.b ? b.b[2] + b.b[5] : 0) || (a.b ? a.b[0] - b.b[0] : 0) || (a.b ? a.b[1] - b.b[1] : 0)); byStep[x.st.id] = list; list.forEach(o => { if (o.b) all.push(o.b); });
  }
  const has3d = opts.b3d && all.length > 0;
  if (has3d) { const o = [Math.min(...all.map(b => b[0])), Math.min(...all.map(b => b[1])), Math.min(...all.map(b => b[2]))]; Object.values(byStep).forEach(l => l.forEach(ob => { if (ob.b) ob.b = [r2(ob.b[0] - o[0]), r2(ob.b[1] - o[1]), r2(ob.b[2] - o[2]), r2(ob.b[3] - o[0]), r2(ob.b[4] - o[1]), r2(ob.b[5] - o[2])]; })); }
  // Kolumner: "Namn" = egenskap med exakt det namnet (annars namn som innehåller ordet), "IMPACT*" = alla egenskaper i grupper som heter så. Tomma kolumner tas bort.
  const objsAll = Object.values(byStep).flat(), low = s => String(s).toLowerCase(), pn = k => k.includes(" / ") ? k.slice(k.indexOf(" / ") + 3) : k, ps = k => k.includes(" / ") ? k.slice(0, k.indexOf(" / ")) : "";
  const defs = []; cols.forEach(c => { if (c.endsWith("*")) { const w = low(c.slice(0, -1)), seen = new Set(); objsAll.forEach(o => Object.keys(o._f).forEach(k => { if (ps(k) && low(ps(k)).includes(w) && String(o._f[k]).trim() !== "" && !seen.has(k)) { seen.add(k); defs.push({ label: pn(k), key: k }); } })); } else defs.push({ label: c, name: low(c) }); });
  const pick = (f, d) => { let k = d.key && f[d.key] !== undefined ? d.key : null; if (!k) k = Object.keys(f).find(key => low(pn(key)) === d.name && String(f[key]).trim() !== ""); if (!k && d.name) k = Object.keys(f).find(key => low(key).includes(d.name) && String(f[key]).trim() !== ""); return k && String(f[k]).trim() !== "" ? String(f[k]).trim().slice(0, 28) : ""; };
  const num = v => { const n = parseFloat(String(v === undefined ? "" : v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : ""; }, ex = (f, nm) => { const k = Object.keys(f).find(key => low(pn(key)) === nm && String(f[key]).trim() !== ""); return k ? f[k] : ""; };
  // Fasta elementfält (IMPACT): längd/bredd/höjd i heltal mm, vikt i ton (värden från 100 och uppåt tolkas som kg)
  objsAll.forEach(o => { const f = o._f, m = num(ex(f, "element_mass")), q = v => (v === "" ? "" : Math.round(v)); o.f = { m: String(ex(f, "element_mark")).trim().slice(0, 40), k: String(ex(f, "element_type")).trim().slice(0, 20), l: q(num(ex(f, "element_length"))), w: q(num(ex(f, "element_width"))), h: q(num(ex(f, "element_height"))), t: m === "" ? "" : Math.round((m >= 100 ? m / 1000 : m) * 1000) / 1000, f: String(ex(f, "element_lift")).trim().slice(0, 40), p: String(ex(f, "location_phase")).trim().slice(0, 40) }; });
  objsAll.forEach(o => { o.p = defs.map(d => pick(o._f, d)); if (opts.all) o.a = Object.keys(o._f).filter(k => String(o._f[k]).trim() !== "").map(k => [ps(k), pn(k), String(o._f[k]).slice(0, 80)]); delete o._f; });
  const keepC = defs.map((d, i) => objsAll.some(o => o.p[i] !== "")); objsAll.forEach(o => { o.p = o.p.filter((v, i) => keepC[i]); }); const colNames = defs.filter((d, i) => keepC[i]).map(d => d.label);
  if (!opts.list) objsAll.forEach(ob => { ob.p = []; }); // bara 3D: ingen objektlista med egenskaper
  return { byStep, cols: opts.list ? colNames : [], has3d, count: Object.values(byStep).reduce((a, l) => a + l.length, 0) };
}
async function msExport(kind) {
  const s = ms.cur, allViews = msViews(s), views = kind === "xml" || kind === "txt" ? allViews : allViews.filter(x => !ms.exSkip.has(x.st.id)), msg = t => { const e = document.getElementById("msExMsg"); if (e) e.textContent = t; };
  if (!views.length) { msg(allViews.length ? "Inga steg är ibockade i listan nedan." : "Inga steg att skicka."); return; }
  if (kind === "html") {
    ms.opt.b3d = true; ms.opt.list = true; ms.opt.props = (document.getElementById("msProps") || {}).value || ""; ms.opt.all = !!(document.getElementById("msObAll") || {}).checked;
    const wantImg = typeof modelCtl === "undefined" || modelCtl.on, noImgNote = wantImg ? "" : " Bilder per steg hoppades över: slå på 3D-brytaren i sidhuvudet först."; let imgs = null, info = null;
    if (ms.opt.b3d || ms.opt.list) { try { info = await msCollectObjects(views, msg, ms.opt); if (!info.count) { msg("Inga objekt med läge i modellen – koppla stegen till objekt först (Sätt från markering). Skapar ändå filen utan 3D och objektlista."); info = null; } } catch (e) { console.warn(e); msg("Kunde inte hämta objekten: " + ((e && e.message) || e) + " – skapar filen utan 3D och objektlista."); info = null; } }
    if (wantImg) { if (!ms.live) { ms.live = true; } ms.imgQ = (document.getElementById("msImgQ") || {}).value || "mid"; imgs = await msSnapshots(views, msg); }
    const html = msHtmlDoc(s, views, imgs, info); msDownload(`montageordning_${msSafe(s.name)}_${msToday()}.html`, html);
    msg(`HTML-filen är skapad (${html.length > 1048576 ? (html.length / 1048576).toFixed(1) + " MB" : Math.round(html.length / 1024) + " kB"}${info ? ", " + info.count + " objekt" : ""}).${noImgNote}`);
  }
  else if (kind === "xml") { const r = msXml(s, views, !!(document.getElementById("msAllXml") || {}).checked); if (!r) { msg("Inget nytt eller flyttat att exportera."); return; } msDownload(`montageordning_${msSafe(s.name)}_${msToday()}.xml`, r.xml, "application/xml"); msg(`XML med ${r.tasks} aktiviteter (${r.links} kopplingar${r.droppedLinks ? ", " + r.droppedLinks + " utanför exporten utelämnade" : ""}).`); }
  else { const t = msText(s, views); try { await navigator.clipboard.writeText(t); msg("Kopierad."); } catch (e) { msDownload(`montageordning_${msSafe(s.name)}.txt`, t, "text/plain;charset=utf-8"); msg("Kunde inte kopiera – hämtade en textfil i stället."); } }
}

/* ---- Händelser ---------------------------------------------------------------------------------------------------------------------------------- */
function msMove(i, j) { const a = ms.cur.steps; if (j < 0 || j >= a.length || i === j) return; const [x] = a.splice(i, 1); a.splice(j, 0, x); ms.i = j; msTouch(); msPaint(); msApply(); }
function msPickHtml() {
  const used = new Set(ms.cur.steps.filter(x => x.kind === "act").map(x => x.key)), list = msActs().filter(a => !used.has(msActKey(a))).sort((a, b) => a.startDate.localeCompare(b.startDate));
  return `<input id="msPickQ" placeholder="Sök aktivitet …" style="width:100%"><div class="ms-pl">${list.slice(0, 400).map(a => `<div data-pick="${msEsc(msActKey(a))}" data-t="${msEsc((a.objectName + " " + a.area + " " + a.activity).toLowerCase())}">${msEsc(a.objectName || a.activity)} <small>${msEsc(a.area)} · ${a.startDate.slice(5)}–${a.endDate.slice(5)}</small></div>`).join("") || "<p class=hint>Inga fler aktiviteter.</p>"}</div>`;
}
async function msNew(kind) {
  if (ms.dirty && !(await dashConfirm("Du har osparade ändringar.\n\nLämna sekvensen utan att spara?", { ok: "Lämna" }))) return;
  msPlay(false); msRestoreModel();
  if (String(kind).startsWith("tpl:")) { const t = MS_TEMPLATES[Number(kind.slice(4))]; ms.cur = msNewSeq(t.n, msTemplateSteps(t), { area: t.a, desc: t.d }); }
  else if (kind === "compose") ms.cur = msNewSeq("Ny sammansättning", [], { type: "compose", parts: [] });
  else if (kind === "filter") { const st = msStepsFromFilter(); if (!st.length) { alert("Gantt-filtret innehåller inga aktiviteter med datum."); return; } ms.cur = msNewSeq("Från filtret", st); ms.cur.start = (msActMap().get(st[0].key) || {}).startDate || msToday(); }
  else ms.cur = msNewSeq("Ny sekvens", []);
  ms.dirty = true; ms.i = 0; ms.shown = null; ms.mode = kind === "empty" ? "gantt" : "steps"; ms.pi = 0; ms.msg = ""; msPaint(); msApply();
}

/* ---- Sammansättning: skärmar ----------------------------------------------------------------------------------------------------------------- */
function msTplOptions() { const g = {}; MS_TEMPLATES.forEach((t, i) => (g[t.g] = g[t.g] || []).push([t, i])); return Object.entries(g).map(([n, l]) => `<optgroup label="${msEsc(n)}">${l.map(([t, i]) => `<option value="${i}" title="${msEsc(t.d)}">${msEsc(t.n)} (${t.s.length} steg)</option>`).join("")}</optgroup>`).join(""); }
const msPartIdx = (s, lay) => Math.max(0, Math.min((lay.parts.length || 1) - 1, ms.pi || 0));
function msPartsHtml(s, lay) {
  const rows = lay.parts.map((pr, i) => `<div class="ms-row${i === msPartIdx(s, lay) ? " cur" : ""}${!pr.seq ? " miss" : ""}" data-part="${i}"><b>${i + 1}</b><span class="ms-nm">${msEsc(pr.name)}<small>${pr.seq ? msEsc(pr.s) + " → " + msEsc(pr.e) + " · " + pr.views.length + " steg" + (pr.p.start ? " · eget startdatum" : pr.p.after ? " · efter " + msEsc((lay.parts.find(x => x.p.id === pr.p.after) || { name: "?" }).name) : "") : "sekvensen finns inte längre"}</small></span><span class="ms-ra"><button type="button" data-pup="${i}" aria-label="Upp">▲</button><button type="button" data-pdn="${i}" aria-label="Ner">▼</button></span></div>`).join("");
  return `<div class="ms-bar"><button type="button" data-a="addPart">＋ Sekvens …</button><span class="hint">Sätt ihop sparade sekvenser (t.ex. ett transportband per sekvens). Varje del startar på eget datum eller efter en annan del.</span></div><div id="msPick" class="ms-pick hidden"></div>${rows || `<p class="hint">Inga sekvenser i sammansättningen än. Tryck ＋ Sekvens och välj bland de sparade.</p>`}`;
}
function msComposeGanttHtml(s, lay) {
  const today = msToday(), px = ms.px, rows = [];
  lay.parts.forEach((pr, pi) => { rows.push({ sum: pr, pi }); if (!pr.p.collapsed) pr.views.forEach(v => rows.push({ v: lay.views.find(x => x.pi === pi && x.st === v.st), pi })); });
  let mn = lay.parts.length ? lay.parts.reduce((m, p) => (p.s < m ? p.s : m), lay.parts[0].s) : today, mx = lay.parts.length ? lay.parts.reduce((m, p) => (p.e > m ? p.e : m), lay.parts[0].e) : msAdd(today, 56);
  mn = msAdd(mn, -((new Date(mn + "T00:00:00Z").getUTCDay() + 6) % 7) - 7); mx = msAdd(mx, 21);
  const W = (msDiff(mn, mx) + 1) * px, H = Math.max(rows.length, 1) * 28 + 4, X = d => msDiff(mn, d) * px; let head = "";
  for (let w = mn; w <= mx; w = msAdd(w, 7)) head += `<span style="left:${X(w)}px;width:${7 * px}px">v${typeof isoWeekNumber === "function" ? isoWeekNumber(new Date(w + "T00:00:00Z")) : ""}</span>`;
  const rowOf = new Map(); rows.forEach((r, i) => { if (r.sum) rowOf.set("s" + r.pi, i); else if (r.v) rowOf.set(r.v.st.id, i); });
  const bars = rows.map((r, i) => {
    const y = i * 28 + 5;
    if (r.sum) { const pr = r.sum; return `<i class="ms-bar2 sum${r.pi === msPartIdx(s, lay) ? " cur" : ""}" data-sum="${r.pi}" style="left:${X(pr.s)}px;width:${Math.max(6, (msDiff(pr.s, pr.e) + 1) * px)}px;top:${y}px" title="${msEsc(pr.name)}: ${msEsc(pr.s)} → ${msEsc(pr.e)}"><span>${msEsc(pr.name)}</span></i>`; }
    const v = r.v; if (!v) return "";
    return `<i class="ms-bar2 ${v.act ? (v.changed ? "prop" : "pl") : "free"}${v.i === ms.i ? " cur" : ""} ro" style="left:${X(v.s)}px;width:${Math.max(6, (msDiff(v.s, v.e) + 1) * px)}px;top:${y + 2}px;height:12px" title="${msEsc(v.st.name)}: ${msEsc(v.s)} → ${msEsc(v.e)}"></i>`;
  }).join("");
  let arrows = "";
  lay.parts.forEach((pr, pi) => { const ref = pr.p.after && !pr.p.start ? lay.parts.findIndex(x => x.p.id === pr.p.after) : -1; if (ref < 0) return; const st = Number(pr.p.afterStep), rp = lay.parts[ref], rv = st >= 0 && rp.views[st] ? rp.views[st] : null, ri = rv && rowOf.has(rv.st.id) ? rowOf.get(rv.st.id) : rowOf.get("s" + ref), x1 = X(rv ? rv.e : rp.e) + px, y1 = ri * 28 + 18, x2 = X(pr.s), y2 = rowOf.get("s" + pi) * 28 + 18, xm = Math.max(x1 + 4, Math.min(x2 - 4, x1 + 6)); arrows += `<path d="M${x1} ${y1}H${xm}V${y2}H${x2}" />`; });
  const labels = rows.map(r => r.sum ? `<div class="ms-gl sum${r.pi === msPartIdx(s, lay) ? " cur" : ""}" data-psel="${r.pi}" title="${msEsc(r.sum.name)}"><u data-tg="${r.pi}">${r.sum.p.collapsed ? "▸" : "▾"}</u> <b>${msEsc(r.sum.name)}</b></div>` : `<div class="ms-gl sub${r.v && r.v.i === ms.i ? " cur" : ""}" data-sel="${r.v ? r.v.i : 0}" title="${msEsc(r.v ? r.v.st.name : "")}">${msEsc(r.v ? r.v.st.name : "")}</div>`).join("");
  return `<div class="ms-bar"><button type="button" data-a="addPart">＋ Sekvens …</button><label>Zoom <input type="range" id="msPx" min="4" max="40" value="${px}"></label><span class="hint">Dra en sammanfattningsstapel för att flytta hela sekvensen. Stegen ändrar du i sekvensen själv (Öppna sekvensen).</span></div><div id="msPick" class="ms-pick hidden"></div>
    <div class="ms-g"><div class="ms-glabels"><div class="ms-ghead">&nbsp;</div>${labels}</div><div class="ms-gscroll"><div class="ms-gcanvas" style="width:${W}px;height:${H + 22}px"><div class="ms-gh">${head}</div><div class="ms-gb" style="height:${H}px"><div class="ms-today" style="left:${X(today)}px"></div>${bars}<svg width="${W}" height="${H}">${arrows}</svg></div></div></div></div>${rows.length ? "" : `<p class="hint">Tom sammansättning. Tryck ＋ Sekvens och välj bland de sparade.</p>`}`;
}
function msPartEditorHtml(s, lay) {
  const pr = lay.parts[msPartIdx(s, lay)]; if (!pr) return `<p class="hint">Lägg till en sekvens för att redigera dess plats i sammansättningen.</p>`;
  const others = lay.parts.filter(x => x !== pr), ref = lay.parts.find(x => x.p.id === pr.p.after), seqs = ms.seqs.filter(x => x.type !== "compose");
  return `<h4>Del ${lay.parts.indexOf(pr) + 1}</h4><label>Sekvens <select data-pf="seqId">${seqs.map(x => `<option value="${msEsc(x.id)}"${x.id === pr.p.seqId ? " selected" : ""}>${msEsc(x.name)}</option>`).join("")}</select></label>
    <div class="ms-info"><label>Eget startdatum <input type="date" data-pf="start" value="${msEsc(pr.p.start)}"></label><small class="hint">Tomt = efter en annan del, eller sammansättningens start (${msEsc(s.start)}).</small>
    <label>Startar efter <select data-pf="after"><option value="">– ingen –</option>${others.map(o => `<option value="${msEsc(o.p.id)}"${o.p.id === pr.p.after ? " selected" : ""}>${msEsc(o.name)}</option>`).join("")}</select></label>
    ${ref ? `<label>…när <select data-pf="afterStep"><option value="-1">hela sekvensen är klar</option>${ref.views.map((v, i) => `<option value="${i}"${Number(pr.p.afterStep) === i ? " selected" : ""}>steg ${i + 1} är klart: ${msEsc(v.st.name)}</option>`).join("")}</select></label><label>Glapp (dagar) <input type="number" data-pf="lag" value="${Number(pr.p.lag) || 0}" style="width:70px"></label>` : ""}
    <small class="hint">Startar nu: ${msEsc(pr.start)}</small></div>
    <div class="ms-ob"><button type="button" data-a="openPart">Öppna sekvensen</button> <button type="button" data-a="delPart">Ta bort ur sammansättningen</button></div>`;
}
function msPickSeqHtml() {
  const used = new Set((ms.cur.parts || []).map(p => p.seqId)), list = ms.seqs.filter(x => x.type !== "compose");
  return list.length ? `<div class="ms-pl">${list.map(x => `<div data-pickseq="${msEsc(x.id)}">${msEsc(x.name)}${used.has(x.id) ? " ✓" : ""} <small>${x.steps.length} steg${x.area ? " · " + msEsc(x.area) : ""}</small></div>`).join("")}</div>` : `<p class="hint">Inga sparade sekvenser. Skapa och spara sekvenser först (Ny från mall …).</p>`;
}
function msAddPart(seqId) { const s = ms.cur; s.parts = s.parts || []; const prev = s.parts[s.parts.length - 1]; s.parts.push({ id: msId(), seqId, start: "", after: "", afterStep: -1, lag: 0, collapsed: false }); ms.pi = s.parts.length - 1; ms.i = msComposeLayout(s).parts[ms.pi].first || 0; msTouch(); msPaint(); }
function msSumDown(e, bar) {
  e.preventDefault(); const pi = Number(bar.dataset.sum), s = ms.cur, lay = msComposeLayout(s), pr = lay.parts[pi], x0 = e.clientX, px = ms.px; ms.pi = pi; let dd = 0, moved = false; const l0 = parseFloat(bar.style.left);
  const move = ev => { dd = Math.round((ev.clientX - x0) / px); if (Math.abs(ev.clientX - x0) > 3) moved = true; bar.style.left = l0 + dd * px + "px"; };
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (moved && dd) { pr.p.start = msAdd(pr.start, dd); pr.p.after = ""; msTouch(); } ms.i = pr.first || 0; msPaint(); msApply(); };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
}
function msLoadLogo(file) {
  if (!file) return;
  if (file.type === "image/svg+xml") { const r = new FileReader(); r.onload = () => { ms.logo.src = String(r.result); msLogoSave(); msPaint(); }; r.readAsDataURL(file); return; }
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    const k = Math.min(1, 420 / img.width, 140 / img.height), c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    let out = c.toDataURL("image/png"); if (out.length > 150000) { const g = document.createElement("canvas"); g.width = c.width; g.height = c.height; const x = g.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, g.width, g.height); x.drawImage(c, 0, 0); out = g.toDataURL("image/jpeg", 0.85); }
    ms.logo.src = out; msLogoSave(); msPaint();
  };
  img.onerror = () => { URL.revokeObjectURL(url); ms.msg = "Kunde inte läsa bilden"; msPaint(); };
  img.src = url;
}
function msWire() {
  const el = ms.el; if (!el) return; const root = el.querySelector(".ms-root"); if (!root) return;
  root.onclick = async e => {
    if (ms.colPop && !e.target.closest(".ms-colpop") && !e.target.closest('[data-a="colPop"]')) { ms.colPop = false; msPaint(); }
    const ck = e.target.closest("[data-ck]");
    if (ck) { const i = Number(ck.dataset.ck), v = msViews(ms.cur); if (e.shiftKey && ms.lastCk !== null) { const [a, b] = [Math.min(i, ms.lastCk), Math.max(i, ms.lastCk)]; for (let k = a; k <= b; k++) ms.multi[ck.checked ? "add" : "delete"](v[k].st.id); } else ms.multi[ck.checked ? "add" : "delete"](v[i].st.id); ms.lastCk = i; msPaint(); return; }
    const psel = e.target.closest("[data-psel]"); const tg = e.target.closest("[data-tg]");
    if (tg) { const p = ms.cur.parts[Number(tg.dataset.tg)]; p.collapsed = !p.collapsed; msTouch(); msPaint(); return; }
    if (psel) { ms.pi = Number(psel.dataset.psel); ms.i = msComposeLayout(ms.cur).parts[ms.pi].first || 0; msPaint(); msApply(); return; }
    const prow = e.target.closest("[data-part]"); if (prow && !e.target.closest("button")) { ms.pi = Number(prow.dataset.part); ms.i = msComposeLayout(ms.cur).parts[ms.pi].first || 0; msPaint(); msApply(); return; }
    const pu = e.target.closest("[data-pup]"), pd = e.target.closest("[data-pdn]");
    if (pu || pd) { const a = ms.cur.parts, i = Number((pu || pd).dataset[pu ? "pup" : "pdn"]), j = pu ? i - 1 : i + 1; if (j >= 0 && j < a.length) { const [x] = a.splice(i, 1); a.splice(j, 0, x); ms.pi = j; msTouch(); msPaint(); } return; }
    const ps = e.target.closest("[data-pickseq]"); if (ps) { msAddPart(ps.dataset.pickseq); return; }
    const open = e.target.closest("[data-open]"); if (open) { await msOpenSeq(open.dataset.open); return; }
    const mode = e.target.closest("[data-mode]"); if (mode) { ms.mode = mode.dataset.mode; msPaint(); return; }
    const sel = e.target.closest("[data-sel]"); if (sel) { if (e.ctrlKey || e.metaKey) { const vs = msViews(ms.cur), v = vs[Number(sel.dataset.sel)]; if (v) { if (ms.multi.has(v.st.id)) ms.multi.delete(v.st.id); else ms.multi.add(v.st.id); ms.lastCk = v.i; msPaint(); } return; } msGo(Number(sel.dataset.sel)); return; }
    const up = e.target.closest("[data-up]"), dn = e.target.closest("[data-dn]"); if (up) { msMove(Number(up.dataset.up), Number(up.dataset.up) - 1); return; } if (dn) { msMove(Number(dn.dataset.dn), Number(dn.dataset.dn) + 1); return; }
    const row = e.target.closest(".ms-row"); if (row && !e.target.closest("button") && !e.target.closest("input")) { msGo(Number(row.dataset.i)); return; }
    const pick = e.target.closest("[data-pick]"); if (pick) { const a = msActMap().get(pick.dataset.pick); if (a) { ms.cur.steps.splice(ms.i + 1 > ms.cur.steps.length ? ms.cur.steps.length : ms.i + 1, 0, { id: msId(), kind: "act", key: pick.dataset.pick, name: a.objectName || a.activity, note: "", pS: "", pE: "", start: "", dur: 0, deps: [], objs: [], cam: null }); ms.i = Math.min(ms.cur.steps.length - 1, ms.cur.steps.length > 1 ? ms.i + 1 : 0); msTouch(); msPaint(); msApply(); } return; }
    const b = e.target.closest("[data-a]"); if (!b) return; const k = b.dataset.a, s = ms.cur, st = s && s.steps[ms.i];
    if (k === "newCompose") { msNew("compose"); return; }
    if (k === "addPart") { const p = document.getElementById("msPick"); p.classList.toggle("hidden"); if (!p.classList.contains("hidden")) p.innerHTML = msPickSeqHtml(); return; }
    if (k === "delPart") { s.parts.splice(msPartIdx(s, msComposeLayout(s)), 1); s.parts.forEach(p => { if (!s.parts.some(x => x.id === p.after)) p.after = ""; }); ms.pi = 0; ms.i = 0; msTouch(); msPaint(); msApply(); return; }
    if (k === "openPart") { const pr = msComposeLayout(s).parts[msPartIdx(s, msComposeLayout(s))]; if (pr && pr.seq) { ms.mode = "steps"; await msOpenSeq(pr.seq.id); } return; }
    if (k === "newEmpty") msNew("empty"); else if (k === "newTpl") msNew("tpl"); else if (k === "newFilter") msNew("filter");
    else if (k === "save") msSave(false); else if (k === "saveAs") msSave(true); else if (k === "del") msDelete();
    else if (k === "dup") { const c = JSON.parse(JSON.stringify(s)); c.id = msId(); c.name = s.name + " (kopia)"; c.steps.forEach(x => { x.id = msId(); }); const map = new Map(s.steps.map((x, i) => [x.id, c.steps[i].id])); c.steps.forEach((x, i) => { x.deps = s.steps[i].deps.map(d => map.get(d)).filter(Boolean); const dl = s.steps[i].depLags || {}; x.depLags = {}; Object.keys(dl).forEach(k => { const nk = map.get(k); if (nk) x.depLags[nk] = dl[k]; }); }); if (c.parts) { const pm = new Map(c.parts.map(p => [p.id, msId()])); c.parts.forEach(p => { p.after = pm.get(p.after) || ""; p.id = pm.get(p.id) || p.id; }); } ms.cur = c; ms.dirty = true; ms.msg = "Kopia – tryck Spara"; msPaint(); }
    else if (k === "addFree") { const prev = s.steps[ms.i]; const n = msStepFree("Nytt steg", 3, []); const at = s.steps.length ? ms.i + 1 : 0; if (prev && ms.mode === "gantt") { const v = msViews(s)[ms.i]; n.start = v ? msAdd(v.e, 1) : ""; } s.steps.splice(at, 0, n); ms.i = at; msTouch(); msPaint(); msApply(); }
    else if (k === "addAct") { const p = document.getElementById("msPick"); p.classList.toggle("hidden"); if (!p.classList.contains("hidden")) { p.innerHTML = msPickHtml(); const q = document.getElementById("msPickQ"); q.focus(); q.oninput = () => { const t = q.value.toLowerCase(); p.querySelectorAll("[data-pick]").forEach(d => { d.style.display = !t || d.dataset.t.includes(t) ? "" : "none"; }); }; } }
    else if (k === "addSel") { const V = API && API.viewer; if (!V) return; try { const sel = (await V.getSelection()) || [], objs = []; for (const m of sel) { const rids = m.objectRuntimeIds || []; if (!rids.length) continue; const ids = await V.convertToObjectIds(m.modelId, rids); ids.forEach(id => { if (id) objs.push({ modelId: m.modelId, objectId: String(id) }); }); } if (!objs.length) { modelToast("Markera objekt i modellen först"); return; } const n = msStepFree("Nytt steg", 3, []); n.objs = objs; s.steps.splice(ms.i + 1, 0, n); ms.i = Math.min(s.steps.length - 1, ms.i + 1); msTouch(); msPaint(); msApply(); } catch (err) { console.warn(err); modelToast("Kunde inte läsa markeringen"); } }
    else if (k === "sortStart") { const v = msViews(s); s.steps = v.slice().sort((a, b) => a.s.localeCompare(b.s) || a.e.localeCompare(b.e)).map(x => x.st); ms.i = 0; msTouch(); msPaint(); msApply(); }
    else if (k === "delStep" && st) { s.steps.splice(ms.i, 1); s.steps.forEach(x => { x.deps = x.deps.filter(d => d !== st.id); }); ms.i = Math.max(0, ms.i - 1); msTouch(); msPaint(); msApply(); }
    else if (k === "clearProp" && st) { st.pS = ""; st.pE = ""; msTouch(); msPaint(); }
    else if (k === "setObjs" && st) { const V = API && API.viewer; try { const sel = (await V.getSelection()) || [], objs = []; for (const m of sel) { const rids = m.objectRuntimeIds || []; if (!rids.length) continue; const ids = await V.convertToObjectIds(m.modelId, rids); ids.forEach(id => { if (id) objs.push({ modelId: m.modelId, objectId: String(id) }); }); } if (!objs.length) { modelToast("Markera objekt i modellen först"); return; } st.objs = objs; msTouch(); msPaint(); msApply(); } catch (err) { modelToast("Kunde inte läsa markeringen"); } }
    else if (k === "clearObjs" && st) { st.objs = []; msTouch(); msPaint(); msApply(); }
    else if (k === "showObjs" && st) { const V = API && API.viewer, v = msViews(s); await msGroups(V, v); const g = v[ms.i].g; if (g.length) { try { ownModelSelectionUntil = Date.now() + 1500; await V.setSelection({ modelObjectIds: msMo(g) }, "set"); await V.setCamera({ modelObjectIds: msMo(g) }); } catch (err) { console.warn(err); } } else modelToast("Inga objekt i modellen för steget"); }
    else if (k === "saveCam" && st) { try { st.cam = await API.viewer.getCamera(); msTouch(); msPaint(); modelToast("Kameravyn är sparad på steget"); } catch (err) { modelToast("Kunde inte läsa kameran"); } }
    else if (k === "clearCam" && st) { st.cam = null; msTouch(); msPaint(); }
    else if (k === "first") msGo(0); else if (k === "last") msGo((msLen() || 1) - 1); else if (k === "prev") msPrev(); else if (k === "next") msNext();
    else if (k === "play") { msPlay(!ms.play); msPaint(); }
    else if (k === "reset3d") { ms.touched3d = true; ms.live = false; await msRestoreModel(); msPaint(); }
    else if (k === "grpMake") msGroupMake();
    else if (k === "tmpToggle") { const ids = ms.multi.size ? [...ms.multi] : (s && s.steps[ms.i] ? [s.steps[ms.i].id] : []), sel = s.steps.filter(x => ids.includes(x.id)), on = !sel.every(x => x.temp); sel.forEach(x => { x.temp = on; }); ms.shown = null; msTouch(); msPaint(); msApply(); }
    else if (k === "grpBreak") msGroupBreak(ms.multi.size ? [...ms.multi] : (s && s.steps[ms.i] ? [s.steps[ms.i].id] : []));
    else if (k === "grpClear") { ms.multi.clear(); msPaint(); }
    else if (k === "grpBreak1" && st) msGroupBreak([st.id]);
    else if (k === "ckAll") { msViews(s).forEach(x => ms.multi.add(x.st.id)); msPaint(); }
    else if (k === "ckNone") { ms.multi.clear(); msPaint(); }
    else if (k === "ckNoCam") { ms.multi.clear(); s.steps.forEach(x => { if (!x.cam) ms.multi.add(x.id); }); msPaint(); }
    else if (k === "ckCam") { ms.multi.clear(); s.steps.forEach(x => { if (x.cam) ms.multi.add(x.id); }); msPaint(); }
    else if (k === "camSetSel") { try { const cam = await API.viewer.getCamera(); let n = 0; s.steps.forEach(x => { if (ms.multi.has(x.id)) { x.cam = JSON.parse(JSON.stringify(cam)); n++; } }); ms.shown = null; msTouch(); ms.msg = `Kameravyn är satt på ${n} steg (spara sekvensen)`; msPaint(); } catch (err) { modelToast("Kunde inte läsa kameran i TC"); } }
    else if (k === "camCopySel") { const cam = st && st.cam; if (!cam) { modelToast("Det markerade steget har ingen kameravy"); return; } let n = 0; s.steps.forEach(x => { if (ms.multi.has(x.id) && x.id !== st.id) { x.cam = JSON.parse(JSON.stringify(cam)); n++; } }); ms.shown = null; msTouch(); ms.msg = `Vyn är kopierad till ${n} steg (spara sekvensen)`; msPaint(); }
    else if (k === "camClearSel") { let n = 0; s.steps.forEach(x => { if (ms.multi.has(x.id) && x.cam) { x.cam = null; n++; } }); ms.shown = null; msTouch(); ms.msg = `Vyn är rensad på ${n} steg`; msPaint(); }
    else if (k === "camAllSteps" && st) { if (!st.cam) { modelToast("Spara en kameravy på steget först"); return; } s.steps.forEach(x => { x.cam = JSON.parse(JSON.stringify(st.cam)); }); ms.shown = null; msTouch(); ms.msg = "Vyn är kopierad till alla steg (spara sekvensen)"; msPaint(); }
    else if (k === "camEmptySteps" && st) { if (!st.cam) { modelToast("Spara en kameravy på steget först"); return; } let n = 0; s.steps.forEach(x => { if (!x.cam) { x.cam = JSON.parse(JSON.stringify(st.cam)); n++; } }); ms.shown = null; msTouch(); ms.msg = `Vyn är kopierad till ${n} steg utan vy (spara sekvensen)`; msPaint(); }
    else if (k === "saveSeqCam") { try { s.cam = await API.viewer.getCamera(); if (s.camAll === undefined) s.camAll = true; ms.shown = null; msTouch(); ms.msg = "Kameravyn är sparad – alla steg tas nu från samma vy (spara sekvensen)"; msPaint(); } catch (err) { modelToast("Kunde inte läsa kameran i TC"); } }
    else if (k === "goSeqCam") { try { await API.viewer.setCamera(s.cam); } catch (err) { modelToast("Kunde inte flytta kameran"); } }
    else if (k === "clearSeqCam") { s.cam = null; ms.shown = null; msTouch(); msPaint(); }
    else if (k === "colPop") { ms.colPop = !ms.colPop; msPaint(); }
    else if (k === "colReset") { const bu = ms.cols.buildUp, bs = ms.cols.buildSec; localStorage.removeItem("4ddash-montage-cols"); ms.cols = msColsLoad(); ms.cols.buildUp = bu; ms.cols.buildSec = bs; msColsSave(); ms.shown = null; msPaint(); msApply(); }
    else if (k === "mgOn") { if (typeof modelGuardSet === "function") { await modelGuardSet(true); ms.shown = null; msPaint(); msApply(); } }
    else if (k === "logoDel") { ms.logo.src = ""; msLogoSave(); msPaint(); }
    else if (k === "exAll" || k === "exNone") { ms.exSkip = new Set(k === "exAll" ? [] : ms.cur.steps.map(x => x.id)); msPaint(); } else if (k === "exHtml") msExport("html"); else if (k === "exXml") msExport("xml"); else if (k === "exTxt") msExport("txt");
  };
  const tpl = root.querySelector("#msTpl"); if (tpl) tpl.onchange = () => { if (tpl.value !== "") msNew("tpl:" + tpl.value); };
  const sel = root.querySelector("#msSel"); if (sel) sel.onchange = async () => { const ok = await msOpenSeq(sel.value || null); if (ok === false) msPaint(); };
  root.onchange = e => {
    const t = e.target, s = ms.cur;
    if (t.dataset.o) { ms[t.dataset.o] = t.checked; ms.shown = null; if (t.dataset.o === "live" && !t.checked) { ms.touched3d = true; msRestoreModel(); } else msApply(); return; }
    if (!s) return;
    if (t.dataset.pf && s) { const pr = s.parts[msPartIdx(s, msComposeLayout(s))]; if (!pr) return; const f = t.dataset.pf; pr[f] === undefined && (pr[f] = ""); pr[f] = f === "afterStep" || f === "lag" ? Number(t.value) || (f === "afterStep" ? 0 : 0) : t.value; if (f === "afterStep") pr.afterStep = Number(t.value); if (f === "after") { pr.afterStep = -1; if (t.value) pr.start = ""; } if (f === "start" && t.value) pr.after = ""; msTouch(); msPaintSoon(); return; }
    if (t.dataset.f) { s[t.dataset.f] = t.value; msTouch(); if (t.dataset.f === "start") msPaintSoon(); return; }
    if ((t.dataset.gn !== undefined || t.dataset.gc !== undefined) && s) { const st1 = s.steps[ms.i], g = st1 && st1.grp ? msGrpMap(s).get(st1.grp) : null; if (g) { if (t.dataset.gn !== undefined) g.name = t.value || g.name; else g.color = t.value; msTouch(); msPaintSoon(); } return; }
    if (t.dataset.lag && s) { const st0 = s.steps[ms.i]; if (st0) { st0.depLags = st0.depLags || {}; st0.depLags[t.dataset.lag] = Math.round(Number(t.value)) || 0; msTouch(); msPaintSoon(); } return; }
    if (t.dataset.sf) { const st = s.steps[ms.i]; if (!st) return; if (t.dataset.sf === "deps") st.deps = [...t.selectedOptions].map(o => o.value); else if (t.dataset.sf === "hours" || t.dataset.sf === "qty") st[t.dataset.sf] = t.value === "" ? "" : Math.max(0, Number(t.value)); else if (t.dataset.sf === "temp") { st.temp = t.checked; ms.shown = null; msApply(); } else if (t.dataset.sf === "dur") st.dur = Math.max(1, Math.round(Number(t.value)) || 1); else st[t.dataset.sf] = t.value; msTouch(); msPaintSoon(); return; }
    if (t.dataset.bu) { if (t.dataset.bu === "on") { ms.cols.buildUp = t.checked; ms.sub = 1; clearInterval(ms.anim); ms.anim = null; } else ms.cols.buildSec = Number(t.value); msColsSave(); ms.shown = null; ms.baseShown = null; if (t.dataset.bu === "on" && t.checked) msAnimate(); msPaintSoon(); msApply(); return; }
    if (t.dataset.sq && s) { s[t.dataset.sq] = t.checked; ms.shown = null; msTouch(); msApply(); return; }
    if (t.id === "msImgQ") { ms.imgQ = t.value; }
    if (t.dataset.ex) { if (t.checked) ms.exSkip.delete(t.dataset.ex); else ms.exSkip.add(t.dataset.ex); msPaintSoon(); return; }
    if (t.id === "msAllXml") { ms.allXml = t.checked; msPaintSoon(); }
    if (t.id === "msLogoFile") { msLoadLogo(t.files && t.files[0]); }
    if (t.dataset.lg) { ms.logo[t.dataset.lg] = t.value; msLogoSave(); }
  };
  root.oninput = e => { const t = e.target;
    if (t.dataset.col || t.dataset.op) { const k = t.dataset.col || t.dataset.op; if (t.dataset.col) ms.cols[k].c = t.value; else { ms.cols[k].o = Number(t.value); const b = ms.el.querySelector(`[data-opv="${k}"]`); if (b) b.textContent = t.value + " %"; } msColsSave(); clearTimeout(ms.colT); ms.colT = setTimeout(() => { ms.shown = null; msApply(); }, 200); return; }
    if (t.classList.contains("ms-sub")) { clearInterval(ms.anim); ms.anim = null; ms.sub = Number(t.value) / 100; msApply(); return; }
    if (t.classList.contains("ms-range")) { msGo(Number(t.value) - 1, true); const r = ms.el.querySelector(".ms-range"); if (r) r.focus(); } else if (t.id === "msPx") { ms.px = Number(t.value); msPaint(); const r = ms.el.querySelector("#msPx"); if (r) r.focus(); } };
  // dra rader i listan
  root.querySelectorAll(".ms-row").forEach(r => { r.ondragstart = e => { ms.drag = Number(r.dataset.i); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(ms.drag)); } catch (x) { /* */ } }; r.ondragover = e => { e.preventDefault(); }; r.ondrop = e => { e.preventDefault(); if (ms.drag !== null) { const from = ms.drag; ms.drag = null; msMove(from, Number(r.dataset.i)); } }; });
  // dra staplar i ganttvyn
  root.querySelectorAll("[data-bar]").forEach(bar => { bar.onpointerdown = e => msBarDown(e, bar); });
  root.querySelectorAll("[data-sum]").forEach(bar => { bar.onpointerdown = e => msSumDown(e, bar); });
}
function msBarDown(e, bar) {
  if (e.ctrlKey || e.metaKey || e.shiftKey) { // välj flera staplar (Ctrl/Cmd = lägg till/ta bort, Skift = intervall)
    e.preventDefault(); const i0 = Number(bar.dataset.bar), vs = msViews(ms.cur);
    if (e.shiftKey && ms.lastCk !== null && vs[ms.lastCk]) { const [a, b] = [Math.min(i0, ms.lastCk), Math.max(i0, ms.lastCk)]; for (let k = a; k <= b; k++) ms.multi.add(vs[k].st.id); }
    else if (ms.multi.has(vs[i0].st.id)) ms.multi.delete(vs[i0].st.id); else ms.multi.add(vs[i0].st.id);
    ms.lastCk = i0; msPaint(); return; }
  e.preventDefault(); const i = Number(bar.dataset.bar), s = ms.cur, views = msViews(s), x = views[i], edge = e.target.dataset.edge || "m", x0 = e.clientX, px = ms.px;
  msGo(i); let moved = false, dd = 0;
  const c0 = ms.el.querySelector(`[data-bar="${i}"]`), l0 = parseFloat(c0.style.left), w0 = parseFloat(c0.style.width); c0.setPointerCapture && c0.setPointerCapture(e.pointerId);
  const move = ev => { dd = Math.round((ev.clientX - x0) / px); if (Math.abs(ev.clientX - x0) > 3) moved = true; const c = ms.el.querySelector(`[data-bar="${i}"]`); if (!c) return; if (edge === "m") c.style.left = l0 + dd * px + "px"; else if (edge === "r") c.style.width = Math.max(px, w0 + dd * px) + "px"; else { c.style.left = l0 + dd * px + "px"; c.style.width = Math.max(px, w0 - dd * px) + "px"; } };
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (!moved || !dd) { msPaint(); return; } msBarCommit(x, edge, dd); };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
}
function msBarDates(x, edge, dd) { let s = x.s, e = x.e; if (edge === "m") { s = msAdd(s, dd); e = msAdd(e, dd); } else if (edge === "r") { e = msAdd(e, dd); if (e < s) e = s; } else { s = msAdd(s, dd); if (s > e) s = e; } return [s, e]; }
function msBarCommit(x, edge, dd) {
  const [s, e] = msBarDates(x, edge, dd), st = x.st;
  if (x.act) { st.pS = s; st.pE = e; if (s === x.ppS && e === x.ppE) { st.pS = ""; st.pE = ""; } }
  else if (st.deps.length) { // flytt av ett steg som väntar på andra ändrar glappet mot det som styr starten; steget följer sedan med när föregångaren flyttas
    if (edge !== "r") { const vs = msViews(ms.cur), pv = st.deps.map(d => vs.find(v => v.st.id === d)).filter(Boolean); st.depLags = st.depLags || {};
      if (pv.length) { const lag0 = d => Number(st.depLags[d]) || 0, drv = pv.reduce((m, p) => (msAdd(p.e, 1 + lag0(p.st.id)) > msAdd(m.e, 1 + lag0(m.st.id)) ? p : m), pv[0]); st.depLags[drv.st.id] = msDiff(msAdd(drv.e, 1), s); st.start = ""; ms.msg = `Glapp ${st.depLags[drv.st.id] > 0 ? "+" : ""}${st.depLags[drv.st.id]} d efter "${drv.st.name}"`; } else st.start = s; }
    st.dur = Math.max(1, msDiff(s, e) + 1);
  } else { st.start = s; st.dur = Math.max(1, msDiff(s, e) + 1); }
  msTouch(); msPaint(); msApply();
}
function msInit() { const b = document.getElementById("ganttAssemblyBtn"); if (b) b.onclick = () => { const t = document.querySelector('[data-gantt-view="montage"]'); if (t) t.click(); }; }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", msInit); else msInit();
