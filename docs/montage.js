/* Montageordning (Victor 2026-10-21): en flik bredvid Staplar/Tavla där byggordningar planeras, sparas och spelas upp i TC.
   En sekvens = steg i en egen ordning. Ett steg är antingen kopplat till en aktivitet i tidplanen (följer den, men kan ha ett eget
   förslag på datum) eller ett fritt steg (eget namn, start, längd, beroenden, objekt markerade i TC). Sekvenserna sparas i 4D-data
   (plan_assembly_sequences) så att teamet ser samma. Läget "Gantt" är en egen ganttvy för sekvensen, och "Skicka" gör en HTML-fil
   och en Microsoft Project-XML med förslagen till den som gör Powerproject-tidplanen. */
const MS_TABLE = "plan_assembly_sequences";
const ms = { seqs: [], loaded: false, loading: false, cur: null, dirty: false, mode: "steps", i: 0, play: false, timer: null, live: true, follow: true, future: false, px: 16, busy: false, pending: false, shown: null, el: null, img: null, msg: "", drag: null };
const msEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const msAdd = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const msDiff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
const msToday = () => (typeof todayISO === "function" ? todayISO() : new Date().toISOString().slice(0, 10));
const msId = () => (typeof ghNewId === "function" ? ghNewId() : "m" + Math.random().toString(36).slice(2, 10));
const msColor = { done: { r: 150, g: 158, b: 170, a: 150 }, cur: { r: 245, g: 158, b: 11, a: 255 }, fut: { r: 147, g: 197, b: 253, a: 40 } };

/* ---- Aktiviteter i tidplanen ----------------------------------------------------------------------------------------------------------------- */
function msActs() { return mergeActivityGroups(items.filter(x => x.startDate && x.endDate)); }
const msActKey = a => a.activityKey || String(a.id);
function msActMap() { const m = new Map(); msActs().forEach(a => m.set(msActKey(a), a)); return m; }

/* ---- Sekvenser: skapa --------------------------------------------------------------------------------------------------------------------- */
const msStepFree = (name, dur, deps = [], note = "") => ({ id: msId(), kind: "free", name, note, start: "", dur, deps, objs: [], cam: null, pS: "", pE: "" });
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
  for (let pass = 0; pass < 60; pass++) { // fria steg med beroenden startar tidigast dagen efter föregångaren
    let ch = false;
    v.forEach(x => {
      if (x.act || !x.st.deps.length) return;
      let need = x.st.start || seq.start || msToday();
      x.st.deps.forEach(d => { const p = view.get(d); if (p && p.e) { const n = msAdd(p.e, 1); if (n > need) need = n; } });
      if (need !== x.s) { const dur = Math.max(1, Number(x.st.dur) || 1); x.s = need; x.e = msAdd(need, dur - 1); ch = true; }
    });
    if (!ch) break;
  }
  v.forEach(x => { x.changed = !!x.act && (x.s !== x.ppS || x.e !== x.ppE); x.isNew = x.st.kind === "free"; x.shift = x.changed ? msDiff(x.ppE, x.e) : 0; });
  return v;
}


/* Sammansättning: en sekvens av sekvenser. Varje del pekar på en sparad sekvens och startar på eget datum, efter en annan del
   (hela eller efter ett visst steg, med glapp) eller vid sammansättningens start. Stegen är de ursprungliga sekvensernas steg. */
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
    const cur = views[ms.i]; if (!cur) return;
    const done = msMerge(views.filter(x => x.i < ms.i).map(x => x.g)), now = cur.g, fut = ms.future ? msMerge(views.filter(x => x.i > ms.i).map(x => x.g)) : [], vis = msMerge([done, now, fut]);
    const sig = JSON.stringify([ms.cur.id, ms.i, ms.future, ms.follow, vis.map(g => g.modelId + g.rids.length)]); if (ms.shown === sig) return;
    const ents = vis.map(g => ({ modelId: g.modelId, entityIds: g.rids }));
    if (!ents.length && !done.length && !now.length) { await V.setObjectState(undefined, { visible: "reset" }); await V.setObjectState(undefined, { color: "reset" }); }
    else {
      try { await V.isolateEntities(ents); } catch (e1) { await V.setObjectState(undefined, { visible: false }); if (ents.length) await V.setObjectState({ modelObjectIds: msMo(vis) }, { visible: true }); }
      try { await V.setObjectState(undefined, { color: "reset" }); } catch (e) { /* */ }
      if (done.length) await V.setObjectState({ modelObjectIds: msMo(done) }, { color: msColor.done });
      if (fut.length) await V.setObjectState({ modelObjectIds: msMo(fut) }, { color: msColor.fut });
      if (now.length) await V.setObjectState({ modelObjectIds: msMo(now) }, { color: msColor.cur });
    }
    if (ms.follow && typeof V.setCamera === "function") { try { if (cur.st.cam) await V.setCamera(cur.st.cam); else if (now.length) await V.setCamera({ modelObjectIds: msMo(now) }); } catch (e) { console.warn("Montageordning: kamera", e); } }
    ms.shown = sig; ms.touched3d = true;
  } catch (e) { console.warn("Montageordning", e); if (typeof modelToast === "function") modelToast("Kunde inte uppdatera 3D: " + ((e && (e.message || e.error)) || "Trimble Connect svarade inte")); }
  finally { ms.busy = false; if (ms.pending) { ms.pending = false; msApply(); } }
}
async function msRestoreModel() {
  ms.shown = null; const V = API && API.viewer;
  if (V && typeof V.setObjectState === "function" && ms.touched3d) { ms.touched3d = false; try { await V.setObjectState(undefined, { color: "reset" }); await V.setObjectState(undefined, { visible: "reset" }); } catch (e) { console.warn(e); } }
}
function msLeave() { if (!ms.view) return; ms.view = ""; msPlay(false); document.removeEventListener("keydown", msKey, true); msRestoreModel(); }
const msLen = () => (ms.cur ? msViews(ms.cur).length : 0);
function msPlay(on) { ms.play = on; clearInterval(ms.timer); ms.timer = null; if (on && ms.cur) { if (ms.i >= msLen() - 1) ms.i = 0; ms.timer = setInterval(() => { if (!ms.busy) msGo(ms.i + 1); }, 2500); } }
function msGo(i) {
  if (!ms.cur || !msLen()) return; const n = msLen();
  ms.i = Math.max(0, Math.min(n - 1, i)); ms.touched3d = ms.live; if (ms.play && ms.i >= n - 1) msPlay(false); msPaint(); msApply();
}
function msKey(e) {
  if (ms.view !== "montage" || !ms.cur) return; const t = e.target;
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== "range" && t.type !== "checkbox") return;
  if (e.key === "ArrowRight") { e.preventDefault(); msGo(ms.i + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); msGo(ms.i - 1); } else if (e.key === " " && !(t && (t.type === "checkbox" || t.tagName === "BUTTON"))) { e.preventDefault(); msPlay(!ms.play); msPaint(); }
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
  const meta = `<div class="ms-meta"><label>Namn <input data-f="name" value="${msEsc(s.name)}"></label><label>Område/anläggning <input data-f="area" value="${msEsc(s.area)}" placeholder="t.ex. Band 1"></label><label>Startdatum <input type="date" data-f="start" value="${msEsc(s.start)}"></label><label class="ms-grow">Beskrivning <input data-f="desc" value="${msEsc(s.desc)}"></label></div>`;
  const cmp = s.type === "compose", lay = cmp ? msComposeLayout(s) : null;
  const left = ms.mode === "gantt" ? (cmp ? msComposeGanttHtml(s, lay) : msGanttHtml(s, views)) : ms.mode === "send" ? msSendHtml(s, views) : (cmp ? msPartsHtml(s, lay) : msStepsHtml(s, views));
  const cur = views[ms.i], player = n ? `<div class="ms-player"><button type="button" data-a="first" aria-label="Första">⏮</button><button type="button" data-a="prev" aria-label="Föregående">◀</button><button type="button" class="ms-play" data-a="play" aria-label="Spela">${ms.play ? "⏸" : "▶"}</button><button type="button" data-a="next" aria-label="Nästa">▶︎</button><button type="button" data-a="last" aria-label="Sista">⏭</button>
    <input type="range" class="ms-range" min="1" max="${n}" value="${ms.i + 1}" aria-label="Steg"><span class="ms-cur"><b>${ms.i + 1}/${n}</b> ${msEsc(cur ? msLab(cur) : "")}<small>${cur ? msEsc(cur.s) + " → " + msEsc(cur.e) : ""}</small></span>
    <label title="Visa/färga stegen i 3D-modellen"><input type="checkbox" data-o="live"${ms.live ? " checked" : ""}> 3D</label><label><input type="checkbox" data-o="follow"${ms.follow ? " checked" : ""}> Följ kameran</label><label><input type="checkbox" data-o="future"${ms.future ? " checked" : ""}> Kommande svagt</label><button type="button" data-a="reset3d" title="Visa hela modellen igen">Visa allt</button></div>` : "";
  el.innerHTML = `<div class="ms-root">${top}${meta}${tabs}<div class="ms-main"><div class="ms-left">${left}</div><div class="ms-right">${cmp ? msPartEditorHtml(s, lay) : msEditorHtml(s, views)}</div></div>${player}</div>`;
  const l = el.querySelector(".ms-left"); if (l) l.scrollTop = scroll; const g = el.querySelector(".ms-gscroll"); if (g) g.scrollLeft = sx;
  msWire();
}

function msStepsHtml(s, views) {
  const rows = views.map(x => `<div class="ms-row${x.i === ms.i ? " cur" : ""}${x.missing ? " miss" : ""}" draggable="true" data-i="${x.i}"><span class="ms-h" title="Dra för att flytta">⋮⋮</span><b>${x.i + 1}</b>
    <span class="ms-nm">${msEsc(x.st.name)}<small>${x.st.kind === "act" ? (x.missing ? "aktiviteten finns inte längre" : "tidplan: " + msEsc(x.ppS.slice(5)) + "–" + msEsc(x.ppE.slice(5)) + (x.changed ? ` · förslag ${msEsc(x.s.slice(5))}–${msEsc(x.e.slice(5))}` : "")) : "fritt steg · " + msEsc(x.s.slice(5)) + "–" + msEsc(x.e.slice(5))}${x.st.objs.length ? " · " + x.st.objs.length + " obj." : ""}${x.st.note ? " · 📝" : ""}</small></span>
    <span class="ms-ra"><button type="button" data-up="${x.i}" aria-label="Upp">▲</button><button type="button" data-dn="${x.i}" aria-label="Ner">▼</button></span></div>`).join("");
  return `<div class="ms-bar"><button type="button" data-a="addFree">＋ Fritt steg</button><button type="button" data-a="addAct">＋ Aktivitet ur tidplanen …</button><button type="button" data-a="addSel" title="Markera objekt i TC först">＋ Från markering i TC</button><button type="button" data-a="sortStart" title="Ordna efter start">Sortera efter start</button></div>
    <div id="msPick" class="ms-pick hidden"></div>${rows || `<p class="hint">Inga steg än. Lägg till ett steg ovan, eller byt till Gantt och bygg planen där.</p>`}`;
}
function msGanttHtml(s, views) {
  const today = msToday(), px = ms.px;
  let mn = views.length ? views.reduce((m, x) => (x.s < m ? x.s : m), views[0].s) : today, mx = views.length ? views.reduce((m, x) => (x.e > m ? x.e : m), views[0].e) : msAdd(today, 56);
  views.forEach(x => { if (x.act) { if (x.ppS < mn) mn = x.ppS; if (x.ppE > mx) mx = x.ppE; } });
  mn = msAdd(mn, -((new Date(mn + "T00:00:00Z").getUTCDay() + 6) % 7) - 7); mx = msAdd(mx, 21);
  const W = (msDiff(mn, mx) + 1) * px, H = Math.max(views.length, 1) * 28 + 4, X = d => msDiff(mn, d) * px;
  let head = ""; for (let w = mn; w <= mx; w = msAdd(w, 7)) head += `<span style="left:${X(w)}px;width:${7 * px}px">v${typeof isoWeekNumber === "function" ? isoWeekNumber(new Date(w + "T00:00:00Z")) : ""}</span>`;
  const bars = views.map(x => {
    const y = x.i * 28 + 4, cur = x.i === ms.i ? " cur" : "";
    const pp = x.act ? `<i class="ms-pp" style="left:${X(x.ppS)}px;width:${Math.max(4, (msDiff(x.ppS, x.ppE) + 1) * px)}px;top:${y + 1}px" title="Tidplan: ${msEsc(x.ppS)} → ${msEsc(x.ppE)}"></i>` : "";
    const cls = x.act ? (x.changed ? "prop" : "pl") : "free";
    return `${pp}<i class="ms-bar2 ${cls}${cur}" data-bar="${x.i}" style="left:${X(x.s)}px;width:${Math.max(6, (msDiff(x.s, x.e) + 1) * px)}px;top:${y + (x.act && x.changed ? 9 : 4)}px" title="${msEsc(x.st.name)}: ${msEsc(x.s)} → ${msEsc(x.e)}"><u data-edge="l"></u><span>${msEsc(x.st.name)}</span><u data-edge="r"></u></i>`;
  }).join("");
  const pos = new Map(views.map(x => [x.st.id, x])); let arrows = "";
  views.forEach(x => x.st.deps.forEach(d => { const p = pos.get(d); if (!p) return; const x1 = X(p.e) + px, y1 = p.i * 28 + 18, x2 = X(x.s), y2 = x.i * 28 + 18, xm = Math.max(x1 + 4, Math.min(x2 - 4, x1 + 6)); arrows += `<path d="M${x1} ${y1}H${xm}V${y2}H${x2}" />`; }));
  const labels = views.map(x => `<div class="ms-gl${x.i === ms.i ? " cur" : ""}" data-sel="${x.i}" title="${msEsc(x.st.name)}"><b>${x.i + 1}</b> ${msEsc(x.st.name)}</div>`).join("");
  return `<div class="ms-bar"><button type="button" data-a="addFree">＋ Steg</button><button type="button" data-a="addAct">＋ Aktivitet ur tidplanen …</button><label>Zoom <input type="range" id="msPx" min="6" max="40" value="${px}"></label><span class="hint">Dra en stapel för att flytta, dra i kanten för längd. Orange = ditt förslag mot tidplanen (grå stapel under).</span></div><div id="msPick" class="ms-pick hidden"></div>
    <div class="ms-g"><div class="ms-glabels"><div class="ms-ghead">&nbsp;</div>${labels}</div><div class="ms-gscroll"><div class="ms-gcanvas" style="width:${W}px;height:${H + 22}px"><div class="ms-gh">${head}</div><div class="ms-gb" style="height:${H}px"><div class="ms-today" style="left:${X(today)}px"></div>${bars}<svg width="${W}" height="${H}">${arrows}</svg></div></div></div></div>${views.length ? "" : `<p class="hint">Tom ganttvy. Tryck ＋ Steg för att börja planera.</p>`}`;
}
function msEditorHtml(s, views) {
  const x = views[ms.i]; if (!x) return `<p class="hint">Välj ett steg för att redigera det.</p>`;
  const st = x.st, others = views.filter(v => v.i !== x.i);
  return `<h4>Steg ${x.i + 1}</h4><label>Namn <input data-sf="name" value="${msEsc(st.name)}" ${st.kind === "act" ? 'title="Eget namn i sekvensen – tidplanens namn ändras inte"' : ""}></label>
    ${st.kind === "act" ? `<div class="ms-info">${x.missing ? `<b class="bad">Aktiviteten finns inte längre i tidplanen.</b>` : `Tidplan: ${msEsc(x.ppS)} → ${msEsc(x.ppE)}`}<br><label>Förslag start <input type="date" data-sf="pS" value="${msEsc(st.pS)}"></label> <label>slut <input type="date" data-sf="pE" value="${msEsc(st.pE)}"></label> <button type="button" data-a="clearProp">Rensa förslag</button></div>`
      : `<div class="ms-info"><label>Start <input type="date" data-sf="start" value="${msEsc(st.start)}" title="Tomt = efter föregående steg (eller sekvensens start)"></label> <label>Längd (dagar) <input type="number" min="1" data-sf="dur" value="${st.dur || 1}" style="width:64px"></label>${st.deps.length && !st.start ? `<small class="hint">Startar dagen efter föregående: ${msEsc(x.s)}</small>` : ""}</div>`}
    <label>Anteckning <textarea data-sf="note" rows="3">${msEsc(st.note)}</textarea></label>
    <label>Väntar på <select data-sf="deps" multiple size="${Math.min(6, Math.max(2, others.length))}">${others.map(o => `<option value="${msEsc(o.st.id)}"${st.deps.includes(o.st.id) ? " selected" : ""}>${o.i + 1}. ${msEsc(o.st.name)}</option>`).join("")}</select></label>
    <div class="ms-ob"><b>3D:</b> ${(x.t || msTargets(st, msActMap())).length} objekt <button type="button" data-a="setObjs" title="Markera objekt i TC först">Sätt från markering</button><button type="button" data-a="showObjs">Visa</button>${st.objs.length ? `<button type="button" data-a="clearObjs">Rensa egna</button>` : ""}<br><button type="button" data-a="saveCam">Spara kameravy</button>${st.cam ? `<button type="button" data-a="clearCam">Ta bort kameravy</button><small class="hint">kameravy sparad</small>` : `<small class="hint">ingen – zoomar till objekten</small>`}</div>
    <div class="ms-del"><button type="button" data-a="delStep">Ta bort steget</button></div>`;
}

/* ---- Skicka: förslag till den som gör tidplanen ------------------------------------------------------------------------------- */
function msChanges(views) { return views.filter(x => x.isNew || x.changed || x.st.note); }
function msSendHtml(s, views) {
  const ch = views.filter(x => x.isNew || x.changed), nNew = views.filter(x => x.isNew).length, nMov = views.filter(x => x.changed).length;
  return `<p class="hint">Samlar dina förslag mot tidplanen: nya steg, flyttade aktiviteter och anteckningar. Skicka HTML-filen (läsbar, kan skrivas ut som PDF) och/eller XML-filen som kan importeras i Powerproject (Importera från Microsoft Project® XML).</p>
    <div class="ms-kpis"><div><b>${views.length}</b>steg</div><div><b>${nNew}</b>nya steg</div><div><b>${nMov}</b>flyttade mot tidplanen</div><div><b>${views.filter(x => x.st.note).length}</b>anteckningar</div></div>
    <div class="ms-bar"><label><input type="checkbox" id="msImg"> 3D-bild per steg i HTML-filen (tar en stund)</label><label><input type="checkbox" id="msAllXml"> Alla steg i XML (annars bara nya och flyttade)</label></div>
    <div class="ms-bar"><button type="button" class="primary" data-a="exHtml">Ladda ner HTML</button><button type="button" data-a="exXml">Ladda ner MS Project-XML (${ms.allXml ? views.length : ch.length} aktiviteter)</button><button type="button" data-a="exTxt">Kopiera som text</button><span id="msExMsg" class="hint"></span></div>
    <table class="ms-tbl"><tr><th>#</th><th>Steg</th><th>Tidplan</th><th>Förslag</th><th>Skillnad</th></tr>${views.map(x => `<tr><td>${x.i + 1}</td><td>${msEsc(msLab(x))}${x.st.note ? `<small>📝 ${msEsc(x.st.note)}</small>` : ""}</td><td>${x.act ? msEsc(x.ppS) + " → " + msEsc(x.ppE) : "–"}</td><td>${msEsc(x.s)} → ${msEsc(x.e)}</td><td>${x.isNew ? "nytt steg" : x.changed ? (x.shift > 0 ? "+" : "") + x.shift + " d" : ""}</td></tr>`).join("")}</table>`;
}
function msDownload(name, text, mime) { const a = document.createElement("a"), u = URL.createObjectURL(new Blob([text], { type: mime || "text/html;charset=utf-8" })); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); }
const msSafe = t => String(t || "").replace(/[^\wåäöÅÄÖ.-]+/g, "_").slice(0, 40) || "sekvens";
function msText(s, views) { return `${s.name}${s.area ? " (" + s.area + ")" : ""} – förslag på montageordning\n${s.desc ? s.desc + "\n" : ""}\n` + views.map(x => `${x.i + 1}. ${msLab(x)}: ${x.s} → ${x.e}${x.act ? (x.changed ? ` (tidplan ${x.ppS} → ${x.ppE}, ${x.shift > 0 ? "+" : ""}${x.shift} d)` : " (som tidplan)") : " (nytt steg)"}${x.st.deps.length ? " – väntar på " + x.st.deps.map(d => { const p = views.find(v => v.st.id === d); return p ? p.i + 1 : "?"; }).join(", ") : ""}${x.st.note ? "\n   " + x.st.note : ""}`).join("\n"); }
function msHtmlDoc(s, views, imgs) {
  const mn = views.reduce((m, x) => (x.s < m ? x.s : m), views[0].s), mx = views.reduce((m, x) => (x.e > m ? x.e : m), views[0].e), span = Math.max(1, msDiff(mn, mx) + 1);
  const bars = views.map(x => `<div class="r"><span>${x.i + 1}. ${msEsc(msLab(x))}</span><div class="t">${x.act ? `<i class="pp" style="left:${msDiff(mn, x.ppS) / span * 100}%;width:${Math.max(0.8, (msDiff(x.ppS, x.ppE) + 1) / span * 100)}%"></i>` : ""}<i class="b ${x.isNew ? "n" : x.changed ? "c" : ""}" style="left:${msDiff(mn, x.s) / span * 100}%;width:${Math.max(0.8, (msDiff(x.s, x.e) + 1) / span * 100)}%"></i></div></div>`).join("");
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${msEsc(s.name)} – förslag</title><style>body{font:14px/1.45 system-ui,Arial,sans-serif;margin:0;padding:18px;color:#1f2328;max-width:980px;margin:auto}h1{margin:0}small,.m{color:#6b7280}table{width:100%;border-collapse:collapse;margin:14px 0}td,th{border:1px solid #d8dee4;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f6f8fa}.g .r{display:grid;grid-template-columns:34% 1fr;gap:6px;align-items:center;font-size:12px;margin:2px 0}.t{position:relative;height:14px;background:#f0f2f5}.t i{position:absolute;top:0;height:14px}.pp{background:#cbd5e1}.b{background:#3b82f6;top:3px!important;height:8px!important}.b.n{background:#22c55e}.b.c{background:#f59e0b}img{width:100%;max-width:520px;border-radius:8px}.leg i{display:inline-block;width:10px;height:10px;margin:0 4px 0 10px}@media print{body{padding:0}}</style></head><body>
    <h1>${msEsc(s.name)}</h1><p class="m">${s.area ? msEsc(s.area) + " · " : ""}Förslag på montageordning · ${msEsc(new Date().toISOString().slice(0, 10))}</p>${s.desc ? `<p>${msEsc(s.desc)}</p>` : ""}
    <p class="leg"><i style="background:#cbd5e1"></i>Tidplan <i style="background:#f59e0b"></i>Flyttad förslag <i style="background:#22c55e"></i>Nytt steg <i style="background:#3b82f6"></i>Som tidplan</p><div class="g">${bars}</div>
    <table><tr><th>#</th><th>Steg</th><th>Tidplan</th><th>Förslag</th><th>Skillnad</th><th>Väntar på</th></tr>${views.map(x => `<tr><td>${x.i + 1}</td><td><b>${msEsc(msLab(x))}</b>${x.st.note ? `<br><small>${msEsc(x.st.note)}</small>` : ""}${imgs && imgs[x.st.id] ? `<br><img src="${imgs[x.st.id]}" alt="">` : ""}</td><td>${x.act ? msEsc(x.ppS) + " → " + msEsc(x.ppE) : "–"}</td><td>${msEsc(x.s)} → ${msEsc(x.e)}</td><td>${x.isNew ? "nytt steg" : x.changed ? (x.shift > 0 ? "+" : "") + x.shift + " d" : "som tidplan"}</td><td>${x.st.deps.map(d => { const p = views.find(v => v.st.id === d); return p ? p.i + 1 : ""; }).join(", ")}</td></tr>`).join("")}</table></body></html>`;
}
function msXml(s, views, all) {
  const use = views.filter(x => all || x.isNew || x.changed), ids = new Set(use.map(x => x.st.id));
  const list = use.map(x => ({ startDate: x.s, endDate: x.e, objectName: x.st.name, activity: "", area: x.part ? s.name + "/" + x.partName : s.name + " (förslag)", members: [{ id: x.st.id, dependsOn: x.st.deps.filter(d => ids.has(d)), depLags: {} }] }));
  return list.length ? buildMspXml(list, { project: s.name + " – förslag", resources: false }) : null;
}
async function msSnapshots(views, note) {
  const V = API && API.viewer, out = {}; if (!V || typeof V.getSnapshot !== "function") return out; const keep = ms.i;
  for (const x of views) { ms.i = x.i; ms.shown = null; ms.touched3d = true; note(`3D-bild ${x.i + 1} av ${views.length} …`); await msApply(); await new Promise(r => setTimeout(r, 700)); try { const sn = await V.getSnapshot(); out[x.st.id] = typeof sn === "string" ? sn : (sn && (sn.data || sn.dataUrl)) || ""; } catch (e) { console.warn(e); } }
  ms.i = keep; ms.shown = null; msApply(); return out;
}
async function msExport(kind) {
  const s = ms.cur, views = msViews(s), msg = t => { const e = document.getElementById("msExMsg"); if (e) e.textContent = t; };
  if (!views.length) { msg("Inga steg att skicka."); return; }
  if (kind === "html") { const wantImg = document.getElementById("msImg") && document.getElementById("msImg").checked; let imgs = null; if (wantImg) { if (!ms.live) { ms.live = true; } imgs = await msSnapshots(views, msg); } msDownload(`montageordning_${msSafe(s.name)}_${msToday()}.html`, msHtmlDoc(s, views, imgs)); msg("HTML-filen är skapad."); }
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
function msWire() {
  const el = ms.el; if (!el) return; const root = el.querySelector(".ms-root"); if (!root) return;
  root.onclick = async e => {
    const psel = e.target.closest("[data-psel]"); const tg = e.target.closest("[data-tg]");
    if (tg) { const p = ms.cur.parts[Number(tg.dataset.tg)]; p.collapsed = !p.collapsed; msTouch(); msPaint(); return; }
    if (psel) { ms.pi = Number(psel.dataset.psel); ms.i = msComposeLayout(ms.cur).parts[ms.pi].first || 0; msPaint(); msApply(); return; }
    const prow = e.target.closest("[data-part]"); if (prow && !e.target.closest("button")) { ms.pi = Number(prow.dataset.part); ms.i = msComposeLayout(ms.cur).parts[ms.pi].first || 0; msPaint(); msApply(); return; }
    const pu = e.target.closest("[data-pup]"), pd = e.target.closest("[data-pdn]");
    if (pu || pd) { const a = ms.cur.parts, i = Number((pu || pd).dataset[pu ? "pup" : "pdn"]), j = pu ? i - 1 : i + 1; if (j >= 0 && j < a.length) { const [x] = a.splice(i, 1); a.splice(j, 0, x); ms.pi = j; msTouch(); msPaint(); } return; }
    const ps = e.target.closest("[data-pickseq]"); if (ps) { msAddPart(ps.dataset.pickseq); return; }
    const open = e.target.closest("[data-open]"); if (open) { await msOpenSeq(open.dataset.open); return; }
    const mode = e.target.closest("[data-mode]"); if (mode) { ms.mode = mode.dataset.mode; msPaint(); return; }
    const sel = e.target.closest("[data-sel]"); if (sel) { msGo(Number(sel.dataset.sel)); return; }
    const up = e.target.closest("[data-up]"), dn = e.target.closest("[data-dn]"); if (up) { msMove(Number(up.dataset.up), Number(up.dataset.up) - 1); return; } if (dn) { msMove(Number(dn.dataset.dn), Number(dn.dataset.dn) + 1); return; }
    const row = e.target.closest(".ms-row"); if (row && !e.target.closest("button")) { msGo(Number(row.dataset.i)); return; }
    const pick = e.target.closest("[data-pick]"); if (pick) { const a = msActMap().get(pick.dataset.pick); if (a) { ms.cur.steps.splice(ms.i + 1 > ms.cur.steps.length ? ms.cur.steps.length : ms.i + 1, 0, { id: msId(), kind: "act", key: pick.dataset.pick, name: a.objectName || a.activity, note: "", pS: "", pE: "", start: "", dur: 0, deps: [], objs: [], cam: null }); ms.i = Math.min(ms.cur.steps.length - 1, ms.cur.steps.length > 1 ? ms.i + 1 : 0); msTouch(); msPaint(); msApply(); } return; }
    const b = e.target.closest("[data-a]"); if (!b) return; const k = b.dataset.a, s = ms.cur, st = s && s.steps[ms.i];
    if (k === "newCompose") { msNew("compose"); return; }
    if (k === "addPart") { const p = document.getElementById("msPick"); p.classList.toggle("hidden"); if (!p.classList.contains("hidden")) p.innerHTML = msPickSeqHtml(); return; }
    if (k === "delPart") { s.parts.splice(msPartIdx(s, msComposeLayout(s)), 1); s.parts.forEach(p => { if (!s.parts.some(x => x.id === p.after)) p.after = ""; }); ms.pi = 0; ms.i = 0; msTouch(); msPaint(); msApply(); return; }
    if (k === "openPart") { const pr = msComposeLayout(s).parts[msPartIdx(s, msComposeLayout(s))]; if (pr && pr.seq) { ms.mode = "steps"; await msOpenSeq(pr.seq.id); } return; }
    if (k === "newEmpty") msNew("empty"); else if (k === "newTpl") msNew("tpl"); else if (k === "newFilter") msNew("filter");
    else if (k === "save") msSave(false); else if (k === "saveAs") msSave(true); else if (k === "del") msDelete();
    else if (k === "dup") { const c = JSON.parse(JSON.stringify(s)); c.id = msId(); c.name = s.name + " (kopia)"; c.steps.forEach(x => { x.id = msId(); }); const map = new Map(s.steps.map((x, i) => [x.id, c.steps[i].id])); c.steps.forEach((x, i) => { x.deps = s.steps[i].deps.map(d => map.get(d)).filter(Boolean); }); if (c.parts) { const pm = new Map(c.parts.map(p => [p.id, msId()])); c.parts.forEach(p => { p.after = pm.get(p.after) || ""; p.id = pm.get(p.id) || p.id; }); } ms.cur = c; ms.dirty = true; ms.msg = "Kopia – tryck Spara"; msPaint(); }
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
    else if (k === "first") msGo(0); else if (k === "last") msGo((msLen() || 1) - 1); else if (k === "prev") msGo(ms.i - 1); else if (k === "next") msGo(ms.i + 1);
    else if (k === "play") { msPlay(!ms.play); msPaint(); }
    else if (k === "reset3d") { ms.touched3d = true; ms.live = false; await msRestoreModel(); msPaint(); }
    else if (k === "exHtml") msExport("html"); else if (k === "exXml") msExport("xml"); else if (k === "exTxt") msExport("txt");
  };
  const tpl = root.querySelector("#msTpl"); if (tpl) tpl.onchange = () => { if (tpl.value !== "") msNew("tpl:" + tpl.value); };
  const sel = root.querySelector("#msSel"); if (sel) sel.onchange = async () => { const ok = await msOpenSeq(sel.value || null); if (ok === false) msPaint(); };
  root.onchange = e => {
    const t = e.target, s = ms.cur;
    if (t.dataset.o) { ms[t.dataset.o] = t.checked; ms.shown = null; if (t.dataset.o === "live" && !t.checked) { ms.touched3d = true; msRestoreModel(); } else msApply(); return; }
    if (!s) return;
    if (t.dataset.pf && s) { const pr = s.parts[msPartIdx(s, msComposeLayout(s))]; if (!pr) return; const f = t.dataset.pf; pr[f] === undefined && (pr[f] = ""); pr[f] = f === "afterStep" || f === "lag" ? Number(t.value) || (f === "afterStep" ? 0 : 0) : t.value; if (f === "afterStep") pr.afterStep = Number(t.value); if (f === "after") { pr.afterStep = -1; if (t.value) pr.start = ""; } if (f === "start" && t.value) pr.after = ""; msTouch(); msPaintSoon(); return; }
    if (t.dataset.f) { s[t.dataset.f] = t.value; msTouch(); if (t.dataset.f === "start") msPaintSoon(); return; }
    if (t.dataset.sf) { const st = s.steps[ms.i]; if (!st) return; if (t.dataset.sf === "deps") st.deps = [...t.selectedOptions].map(o => o.value); else if (t.dataset.sf === "dur") st.dur = Math.max(1, Math.round(Number(t.value)) || 1); else st[t.dataset.sf] = t.value; msTouch(); msPaintSoon(); return; }
    if (t.id === "msAllXml") { ms.allXml = t.checked; msPaintSoon(); }
  };
  root.oninput = e => { const t = e.target; if (t.classList.contains("ms-range")) { msGo(Number(t.value) - 1); const r = ms.el.querySelector(".ms-range"); if (r) r.focus(); } else if (t.id === "msPx") { ms.px = Number(t.value); msPaint(); const r = ms.el.querySelector("#msPx"); if (r) r.focus(); } };
  // dra rader i listan
  root.querySelectorAll(".ms-row").forEach(r => { r.ondragstart = e => { ms.drag = Number(r.dataset.i); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(ms.drag)); } catch (x) { /* */ } }; r.ondragover = e => { e.preventDefault(); }; r.ondrop = e => { e.preventDefault(); if (ms.drag !== null) { const from = ms.drag; ms.drag = null; msMove(from, Number(r.dataset.i)); } }; });
  // dra staplar i ganttvyn
  root.querySelectorAll("[data-bar]").forEach(bar => { bar.onpointerdown = e => msBarDown(e, bar); });
  root.querySelectorAll("[data-sum]").forEach(bar => { bar.onpointerdown = e => msSumDown(e, bar); });
}
function msBarDown(e, bar) {
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
  else { st.start = s; st.dur = Math.max(1, msDiff(s, e) + 1); }
  msTouch(); msPaint(); msApply();
}
function msInit() { const b = document.getElementById("ganttAssemblyBtn"); if (b) b.onclick = () => { const t = document.querySelector('[data-gantt-view="montage"]'); if (t) t.click(); }; }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", msInit); else msInit();
