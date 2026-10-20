/* Auto-koppla från koder (Victor 2026-10-20): läser egenskaperna på objekten i de inlästa TC-modellerna, plockar koder ur
   aktivitetsnamnen (t.ex. 7426, 742A, SF1, nivå 2) och föreslår vilka objekt som hör till varje aktivitet. Du ser antal och
   exempel per rad, kan ändra sökorden, och först när du trycker Koppla skrivs kopplingarna (en ändring, kan ångras).
   Sökord: skilj med komma (alla måste finnas i objektets egenskaper), alternativ med snedstreck: "nivå 1/level 1/plan 1". */
const ac = { rows: [], index: [], idxModels: 0, busy: false, cancel: false, skipCoupled: true, scope: "shown", wrap: null };
const acEsc = s => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s == null ? "" : s));
const acNorm = s => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();

/* Förslag på sökord ur aktivitetens text: koder (7426, 742A), SF1, nivå 2. */
function acTermsFrom(text) {
  const t = String(text || ""), out = [], add = x => { if (x && !out.some(o => acNorm(o) === acNorm(x))) out.push(x); };
  (t.match(/\b\d{3,4}[A-Za-z]?\b/g) || []).forEach(c => { if (!/^(19|20)\d\d$/.test(c)) add(c.toUpperCase()); });
  (t.match(/\bSF\s?\d+\b/gi) || []).forEach(c => add(c.replace(/\s/g, "").toUpperCase()));
  (t.match(/\b(nivå|plan|våning)\s?\d+\b/gi) || []).forEach(c => { const m = c.match(/(\d+)/)[1]; add(`nivå ${m}/level ${m}/plan ${m}`); });
  return out;
}
const acParse = s => String(s || "").split(",").map(p => p.split("/").map(acNorm).filter(Boolean)).filter(a => a.length);
const acMatch = (text, terms) => terms.every(alts => alts.some(a => text.includes(a)));

/* All text som hör till ett objekt (namn, klass, alla egenskapsvärden). */
function acTextOf(p) {
  const parts = [];
  if (p && p.class) parts.push(p.class);
  if (p && p.product && p.product.name) parts.push(p.product.name);
  const walk = (o, d) => {
    if (o == null || d > 5) return;
    if (Array.isArray(o)) { o.forEach(x => walk(x, d + 1)); return; }
    if (typeof o === "object") { if (o.set) parts.push(o.set); Object.keys(o).forEach(k => { if (k !== "id" && k !== "set") { if (k === "name" && typeof o[k] === "string" && o.value !== undefined) parts.push(o[k]); walk(o[k], d + 1); } }); return; }
    parts.push(String(o));
  };
  walk(p && p.properties, 0);
  return acNorm(parts.join(" | ")).slice(0, 900);
}
const acNameOf = p => (p && ((p.product && p.product.name) || p.class)) || "";

async function acIndexRids(V, modelId, rids, prog) {
  for (let i = 0; i < rids.length; i += 250) {
    if (ac.cancel) return;
    const chunk = rids.slice(i, i + 250);
    let props = [];
    try { props = await V.getObjectProperties(modelId, chunk); } catch (e) { console.warn("Auto-koppla: egenskaper", e); }
    chunk.forEach((rid, k) => { const p = props && props[k]; if (p) ac.index.push({ modelId, rid, text: acTextOf(p), name: acNameOf(p) }); });
    prog(Math.min(rids.length, i + 250), rids.length);
    await new Promise(r => setTimeout(r, 0));
  }
}
async function acReadModels() {
  const V = API && API.viewer;
  if (!V || typeof V.getObjectProperties !== "function") { modelToast("Auto-koppla kräver Trimble Connect-vyn"); return; }
  if (ac.busy) return;
  ac.busy = true; ac.cancel = false; ac.index = []; acSetStatus("Läser modellerna …");
  try {
    let all = [];
    if (typeof V.getObjects === "function") {
      const res = await V.getObjects();
      (res || []).forEach(m => { const ids = (m.objects || []).map(o => (o && typeof o === "object" ? o.id : o)).filter(x => x !== undefined && x !== null); if (ids.length) all.push({ modelId: m.modelId, rids: ids }); });
    }
    if (!all.length) { acSetStatus("Hittade inga objekt – markera allt i modellen (Ctrl+A) och tryck \"Läs från markering\"."); return; }
    ac.idxModels = all.length;
    for (const m of all) await acIndexRids(V, m.modelId, m.rids, (a, b) => acSetStatus(`Läser egenskaper … ${ac.index.length} objekt (${Math.round(a / b * 100)} % av modellen)`));
  } catch (e) { console.warn("Auto-koppla", e); acSetStatus("Kunde inte läsa modellen: " + ((e && (e.message || e.error)) || "Trimble Connect svarade inte") + " – prova \"Läs från markering\"."); }
  finally { ac.busy = false; }
  acAfterIndex();
}
async function acReadSelection() {
  const V = API && API.viewer;
  if (!V || typeof V.getSelection !== "function") { modelToast("Auto-koppla kräver Trimble Connect-vyn"); return; }
  if (ac.busy) return;
  ac.busy = true; ac.cancel = false; ac.index = []; acSetStatus("Läser markeringen …");
  try {
    const sel = (await V.getSelection()) || [];
    const all = sel.filter(m => (m.objectRuntimeIds || []).length);
    if (!all.length) { acSetStatus("Inget markerat i modellen."); return; }
    ac.idxModels = all.length;
    for (const m of all) await acIndexRids(V, m.modelId, m.objectRuntimeIds, (a, b) => acSetStatus(`Läser egenskaper … ${ac.index.length} objekt (${Math.round(a / b * 100)} %)`));
  } catch (e) { acSetStatus("Kunde inte läsa markeringen: " + ((e && e.message) || e)); }
  finally { ac.busy = false; }
  acAfterIndex();
}
function acAfterIndex() {
  acSetStatus(`${ac.index.length} objekt inlästa från ${ac.idxModels} modell${ac.idxModels === 1 ? "" : "er"}.`);
  ac.rows.forEach(acRecalc); acRenderRows();
}
function acSetStatus(t) { const el = document.getElementById("acStatus"); if (el) el.textContent = t; }

/* Objekt som redan är kopplade (modell|objekt-id) – för att kunna hoppa över dem. Kräver objekt-id, så det görs vid koppling. */
function acRecalc(r) {
  r.terms = acParse(r.termText);
  r.hits = !r.terms.length || !ac.index.length ? [] : ac.index.filter(o => acMatch(o.text, r.terms));
  r.on = r.hits.length >= 1 && r.hits.length <= 500;
}
function acBuildRows() {
  const list = (ac.scope === "all" ? items.filter(x => x.startDate) : (ganttShownItems.length ? ganttShownItems : getFilteredItems()));
  const merged = typeof mergeActivityGroups === "function" ? mergeActivityGroups(list.filter(x => x.startDate || true)) : list;
  const seen = new Set();
  return merged.filter(it => !(it.members || [it]).some(m => m.modelId && m.objectId)).map(it => {
    const key = it.activityKey || it.id; if (seen.has(key)) return null; seen.add(key);
    const text = [it.objectName, it.activity].filter(Boolean).join(" ");
    return { it, name: it.objectName || it.activity || "Aktivitet", termText: acTermsFrom(text).join(", "), terms: [], hits: [], on: false };
  }).filter(Boolean);
}

function acRenderRows() {
  const box = document.getElementById("acRows"); if (!box) return;
  if (!ac.rows.length) { box.innerHTML = `<div class="hint">Alla aktiviteter i urvalet är redan kopplade (eller så filtrerar du bort dem).</div>`; acSum(); return; }
  box.innerHTML = ac.rows.map((r, i) => {
    const n = r.hits.length, ex = r.hits.slice(0, 3).map(h => acEsc(h.name || "?")).join(", ");
    const cls = !r.terms.length ? "none" : !ac.index.length ? "wait" : n === 0 ? "zero" : n > 500 ? "many" : "ok";
    return `<div class="ac-row ${cls}" data-i="${i}"><label class="ac-on"><input type="checkbox" data-on${r.on ? " checked" : ""}${n ? "" : " disabled"} aria-label="Koppla"/></label>
      <div class="ac-nm" title="${acEsc(r.name)}">${acEsc(r.name)}<small>${r.it.area ? acEsc(r.it.area) + " · " : ""}${acEsc((r.it.startDate || "").slice(0, 10))}</small></div>
      <input class="ac-terms" data-terms value="${acEsc(r.termText)}" placeholder="sökord, t.ex. 742A, SF1" aria-label="Sökord" />
      <div class="ac-n">${!ac.index.length ? "–" : n + (n > 500 ? " ⚠" : "")}<small>${ex}</small></div>
      <button type="button" class="ac-show" data-show${n ? "" : " disabled"} title="Markera träffarna i modellen">Visa</button></div>`;
  }).join("");
  acSum();
}
function acSum() {
  const on = ac.rows.filter(r => r.on && r.hits.length), objs = on.reduce((a, r) => a + r.hits.length, 0);
  const b = document.getElementById("acGo"); if (b) { b.disabled = !on.length; b.textContent = on.length ? `Koppla ${on.length} aktiviteter (${objs} objekt)` : "Koppla"; }
}

async function acShow(r) {
  const V = API && API.viewer; if (!V || !r.hits.length) return;
  const by = new Map(); r.hits.forEach(h => (by.get(h.modelId) || by.set(h.modelId, []).get(h.modelId)).push(h.rid));
  const modelObjectIds = [...by].map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds }));
  try { ownModelSelectionUntil = Date.now() + 1500; await V.setSelection({ modelObjectIds }, "set"); if (typeof V.setCamera === "function") await V.setCamera({ modelObjectIds }).catch(() => {}); } catch (e) { console.warn(e); }
}

async function acApply() {
  const todo = ac.rows.filter(r => r.on && r.hits.length);
  if (!todo.length) return;
  const V = API && API.viewer, goBtn = document.getElementById("acGo"); if (goBtn) goBtn.disabled = true;
  try {
    // Externa objekt-id (det som sparas) – en omvandling per modell.
    const need = new Map(); todo.forEach(r => r.hits.forEach(h => (need.get(h.modelId) || need.set(h.modelId, new Set()).get(h.modelId)).add(h.rid)));
    const ext = new Map();
    for (const [modelId, set] of need) { const rids = [...set]; const ids = await V.convertToObjectIds(modelId, rids); rids.forEach((rid, i) => { if (ids && ids[i] !== undefined && ids[i] !== null && ids[i] !== "") ext.set(`${modelId}|${rid}`, String(ids[i])); }); }
    const taken = new Set(items.filter(x => x.modelId && x.objectId).map(x => `${x.modelId}|${x.objectId}`));
    const plan = todo.map(r => {
      const seen = new Set(), objs = [];
      r.hits.forEach(h => { const id = ext.get(`${h.modelId}|${h.rid}`); if (!id) return; const k = `${h.modelId}|${id}`; if (seen.has(k) || (ac.skipCoupled && taken.has(k))) return; seen.add(k); objs.push({ modelId: h.modelId, objectId: id }); });
      const members = r.it.activityKey ? items.filter(x => x.activityKey === r.it.activityKey) : (r.it.members || [r.it]).slice();
      return { r, objs, members, name: r.name };
    }).filter(p => p.objs.length);
    if (!plan.length) { modelToast("Inget nytt att koppla (objekten är redan kopplade)"); return; }
    const total = plan.reduce((a, p) => a + p.objs.length, 0);
    if (!(await dashConfirm(`Koppla ${plan.length} aktiviteter till ${total} objekt?\n\nKopplingarna sparas i en ändring och kan ångras direkt efteråt.`, { ok: "Koppla" }))) return;
    const nowIso = new Date().toISOString();
    let before = [], added = [], subsAdded = [], finalRows = [];
    await ghWriteJSON(settings.githubToken, tablePath("plan_items"), arr => {
      before = []; added = []; const upd = new Map();
      plan.forEach(p => {
        const mine = arr.filter(r => p.members.some(m => String(m.id) === String(r.id)));
        if (!mine.length) return;
        before.push(...mine.map(r => ({ ...r })));
        const groupId = mine.find(r => r.group_id)?.group_id || ghNewId();
        const free = mine.find(r => !r.model_id), base = mine[0];
        mine.forEach(r => upd.set(r.id, { ...r, group_id: groupId, updated_at: nowIso }));
        p.objs.forEach((o, i) => {
          if (i === 0 && free) { upd.set(free.id, { ...upd.get(free.id), model_id: o.modelId, object_id: o.objectId }); return; }
          added.push({ ...base, id: ghNewId(), model_id: o.modelId, object_id: o.objectId, group_id: groupId, created_at: nowIso, updated_at: nowIso, _src: base.id });
        });
      });
      finalRows = [...upd.values(), ...added.map(a => { const { _src, ...r } = a; return r; })];
      return [...arr.map(r => upd.get(r.id) || r), ...added.map(a => { const { _src, ...r } = a; return r; })];
    }, `Auto-koppla från koder: ${plan.length} aktiviteter, ${total} objekt`);
    const addedRows = added.map(a => { const { _src, ...r } = a; return r; });
    const srcOf = new Map(added.map(a => [a.id, a._src]));
    subsAdded = addedRows.flatMap(r => activities.filter(a => String(a.plan_item_id) === String(srcOf.get(r.id))).map(a => ({ ...a, id: ghNewId(), plan_item_id: r.id })));
    if (subsAdded.length) { try { await ghWriteJSON(settings.githubToken, tablePath("plan_item_activities"), arr => [...arr, ...subsAdded], "Delaktiviteter för auto-kopplade objekt"); } catch (e) { console.warn(e); subsAdded = []; } }
    const beforeIds = new Set(before.map(r => String(r.id)));
    items = items.filter(x => !beforeIds.has(String(x.id))).concat(finalRows.map(fromRow));
    activities = activities.concat(subsAdded);
    acClose(); renderAll();
    modelToast(`${plan.length} aktiviteter kopplade till ${total} objekt`, { label: "Ångra", fn: async () => {
      try {
        const addedIds = new Set(addedRows.map(r => r.id)), prev = new Map(before.map(r => [r.id, r]));
        await ghWriteJSON(settings.githubToken, tablePath("plan_items"), arr => arr.filter(r => !addedIds.has(r.id)).map(r => prev.get(r.id) || r), "Ångra auto-koppling");
        if (subsAdded.length) { const sIds = new Set(subsAdded.map(a => a.id)); await ghWriteJSON(settings.githubToken, tablePath("plan_item_activities"), arr => arr.filter(a => !sIds.has(a.id)), "Ångra auto-koppling"); activities = activities.filter(a => !sIds.has(a.id)); }
        items = items.filter(x => !addedIds.has(x.id) && !prev.has(x.id)).concat(before.map(fromRow)); renderAll();
      } catch (e) { alert("Kunde inte ångra: " + e.message); }
    } });
  } catch (e) { alert("Kunde inte koppla: " + ((e && e.message) || e)); }
  finally { acSum(); }
}

function acClose() { ac.cancel = true; if (ac.wrap) { ac.wrap.remove(); ac.wrap = null; } document.removeEventListener("keydown", acKey, true); }
function acKey(e) { if (e.key === "Escape" && ac.wrap) { e.stopPropagation(); acClose(); } }
function acOpen() {
  if (ac.wrap) return;
  ac.rows = acBuildRows();
  const w = document.createElement("div"); w.className = "ac-wrap"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "Auto-koppla från koder");
  w.innerHTML = `<div class="ac-dlg"><div class="ac-h"><b>Auto-koppla från koder</b><button type="button" class="ac-x" data-x aria-label="Stäng">✕</button></div>
    <div class="hint">1. Läs in modellens egenskaper. 2. Kontrollera sökorden per aktivitet (komma = alla ska finnas, snedstreck = eller). 3. Koppla. Inget sparas förrän du trycker Koppla.</div>
    <div class="ac-bar"><button type="button" class="primary" data-read>Läs in modellerna</button><button type="button" data-readsel title="Markera allt i modellen (Ctrl+A) först">Läs från markering</button>
      <label><input type="checkbox" data-scope${ac.scope === "all" ? " checked" : ""}/> Alla aktiviteter (inte bara filtret)</label><label><input type="checkbox" data-skip${ac.skipCoupled ? " checked" : ""}/> Hoppa över objekt som redan är kopplade</label></div>
    <div id="acStatus" class="hint">${ac.index.length ? ac.index.length + " objekt inlästa." : "Inget inläst än."}</div>
    <div class="ac-head"><span></span><span>Aktivitet</span><span>Sökord</span><span>Träffar</span><span></span></div><div id="acRows" class="ac-rows"></div>
    <div class="ac-foot"><button type="button" data-x>Avbryt</button><button type="button" class="primary" id="acGo" disabled>Koppla</button></div></div>`;
  document.body.appendChild(w); ac.wrap = w; document.addEventListener("keydown", acKey, true);
  w.addEventListener("click", e => {
    if (e.target === w || e.target.closest("[data-x]")) return acClose();
    if (e.target.closest("[data-read]")) return acReadModels();
    if (e.target.closest("[data-readsel]")) return acReadSelection();
    if (e.target.closest("#acGo")) return acApply();
    const sh = e.target.closest("[data-show]"); if (sh) { const r = ac.rows[Number(sh.closest(".ac-row").dataset.i)]; if (r) acShow(r); }
  });
  w.addEventListener("change", e => {
    const row = e.target.closest(".ac-row");
    if (e.target.matches("[data-on]") && row) { ac.rows[Number(row.dataset.i)].on = e.target.checked; acSum(); }
    else if (e.target.matches("[data-scope]")) { ac.scope = e.target.checked ? "all" : "shown"; ac.rows = acBuildRows(); ac.rows.forEach(acRecalc); acRenderRows(); }
    else if (e.target.matches("[data-skip]")) ac.skipCoupled = e.target.checked;
  });
  w.addEventListener("input", e => {
    if (!e.target.matches("[data-terms]")) return;
    const row = e.target.closest(".ac-row"), r = ac.rows[Number(row.dataset.i)]; r.termText = e.target.value;
    clearTimeout(r.t); r.t = setTimeout(() => { acRecalc(r); const pos = e.target.selectionStart; acRenderRows(); const n = document.querySelector(`.ac-row[data-i="${row.dataset.i}"] [data-terms]`); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { /* */ } } }, 350);
  });
  w.addEventListener("keydown", e => { if (e.target.matches("[data-terms]")) e.stopPropagation(); });
  ac.rows.forEach(acRecalc); acRenderRows();
}
function initAutoCouple() { const b = document.getElementById("ganttAutoCoupleBtn"); if (b) b.onclick = () => acOpen(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAutoCouple); else initAutoCouple();
