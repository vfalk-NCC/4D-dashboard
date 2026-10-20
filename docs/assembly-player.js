/* Montageordning – "IKEA-läget" (Victor 2026-10-20): stega genom aktiviteterna i byggordning, ett steg i taget.
   Steg = aktiviteterna i den filtrerade Gantten, sorterade på start. Vid steg N visas i 3D: klara steg i grått, det aktuella
   steget markerat och inzoomat, kommande dolt (eller svagt). Panelen visar text, datum och en stegtabell. Piltangenter/mellanslag styr. */
const asm = { on: false, steps: [], i: 0, play: false, timer: null, busy: false, pending: false, future: false, follow: true, skipUncoupled: true, listOpen: false, shown: null, seq: 0 };
const ASM_COL = { done: { r: 150, g: 158, b: 170, a: 150 }, cur: { r: 245, g: 158, b: 11, a: 255 }, fut: { r: 147, g: 197, b: 253, a: 40 } };
const asmEsc = s => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s == null ? "" : s));

function asmBuildSteps() {
  const list = (typeof ganttShownItems !== "undefined" && ganttShownItems.length ? ganttShownItems : (typeof getFilteredItems === "function" ? getFilteredItems() : []));
  let steps = list.map(it => {
    const ms = (it.members || [it]);
    const start = ms.map(m => m.startDate || "").filter(Boolean).sort()[0] || "";
    const end = ms.map(m => m.endDate || "").filter(Boolean).sort().pop() || "";
    const targets = ms.filter(m => m.modelId && m.objectId);
    return { it, name: it.objectName || it.activity || "Aktivitet", start, end, targets, n: ms.length };
  }).filter(s => s.start || s.end);
  if (asm.skipUncoupled) steps = steps.filter(s => s.targets.length);
  steps.sort((a, b) => (a.start || "").localeCompare(b.start || "") || (a.end || "").localeCompare(b.end || "") || a.name.localeCompare(b.name, "sv"));
  return steps;
}

/* Runtime-id för stegets objekt (cache i ganttRidCache, som tidslinjen i 3D). */
async function asmRids(V, steps) {
  const miss = {};
  steps.forEach(s => s.targets.forEach(t => { const k = `${t.modelId}|${t.objectId}`; if (!ganttRidCache.has(k)) (miss[t.modelId] = miss[t.modelId] || new Set()).add(String(t.objectId)); }));
  for (const modelId of Object.keys(miss)) {
    const r = await dashRuntimeIds(V, modelId, [...miss[modelId]]);
    if (r.modelFailed) continue;
    r.map.forEach((rid, id) => ganttRidCache.set(`${modelId}|${id}`, rid));
  }
  steps.forEach(s => {
    const by = new Map();
    s.targets.forEach(t => { const rid = ganttRidCache.get(`${t.modelId}|${t.objectId}`); if (rid !== undefined && rid !== null) (by.get(t.modelId) || by.set(t.modelId, []).get(t.modelId)).push(rid); });
    s.groups = [...by].map(([modelId, rids]) => ({ modelId, rids }));
  });
}
const asmMo = gs => gs.map(g => ({ modelId: g.modelId, objectRuntimeIds: g.rids }));
function asmMerge(list) { const by = new Map(); list.forEach(gs => gs.forEach(g => (by.get(g.modelId) || by.set(g.modelId, []).get(g.modelId)).push(...g.rids))); return [...by].map(([modelId, rids]) => ({ modelId, rids })); }

async function asmApply() {
  if (!asm.on) return;
  if (asm.busy) { asm.pending = true; return; }
  asm.busy = true;
  const seq = ++asm.seq;
  try {
    const V = API && API.viewer;
    if (!V || typeof V.setObjectState !== "function" || typeof V.convertToObjectRuntimeIds !== "function") { modelToast("Modellen är inte ansluten"); return; }
    if (!asm.steps.every(s => s.groups)) await asmRids(V, asm.steps);
    const idx = asm.steps.map((s, k) => k);
    const done = asmMerge(idx.filter(k => k < asm.i).map(k => asm.steps[k].groups));
    const cur = asm.steps[asm.i] ? asm.steps[asm.i].groups : [];
    const fut = asm.future ? asmMerge(idx.filter(k => k > asm.i).map(k => asm.steps[k].groups)) : [];
    const vis = asmMerge([done, cur, fut]);
    const sig = JSON.stringify([asm.i, asm.future, vis.map(g => g.modelId + g.rids.length)]);
    if (asm.shown === sig) return;
    const ents = vis.map(g => ({ modelId: g.modelId, entityIds: g.rids }));
    try { if (!ents.length) await V.setObjectState(undefined, { visible: false }); else await V.isolateEntities(ents); }
    catch (e1) {
      await V.setObjectState(undefined, { visible: false });
      if (ents.length) await V.setObjectState({ modelObjectIds: asmMo(vis) }, { visible: true });
    }
    try { await V.setObjectState(undefined, { color: "reset" }); } catch (e) { /* ignorera */ }
    if (done.length) await V.setObjectState({ modelObjectIds: asmMo(done) }, { color: ASM_COL.done });
    if (fut.length) await V.setObjectState({ modelObjectIds: asmMo(fut) }, { color: ASM_COL.fut });
    if (cur.length) {
      await V.setObjectState({ modelObjectIds: asmMo(cur) }, { color: ASM_COL.cur });
      if (asm.follow && typeof V.setCamera === "function") { try { await V.setCamera({ modelObjectIds: asmMo(cur) }); } catch (e) { console.warn("Montageordning: kunde inte zooma", e); } }
    }
    asm.shown = sig;
  } catch (e) { console.warn("Montageordning", e); modelToast("Kunde inte uppdatera 3D: " + ((e && (e.message || e.error)) || "Trimble Connect svarade inte")); }
  finally { asm.busy = false; if (asm.pending) { asm.pending = false; asmApply(); } }
}

const asmDate = d => d ? String(d).slice(0, 10) : "–";
function asmRender() {
  const p = document.getElementById("asmPanel"); if (!p) return;
  const n = asm.steps.length, s = asm.steps[asm.i];
  if (!n) { p.querySelector(".asm-body").innerHTML = `<div class="hint">Inga aktiviteter att stega genom. Ändra filtret (eller koppla aktiviteterna till modellen).</div>`; return; }
  const meta = [asmDate(s.start) + " → " + asmDate(s.end), s.it.contractor, s.it.area, s.it.activity && s.it.activity !== s.name ? s.it.activity : "", s.n > 1 ? s.n + " delar" : "", (STATUS_LABELS && STATUS_LABELS[s.it.status]) || ""].filter(Boolean);
  p.querySelector(".asm-body").innerHTML =
    `<div class="asm-top"><span class="asm-step">Steg <b>${asm.i + 1}</b> / ${n}</span><button type="button" class="asm-x" data-a="close" title="Stäng (Esc)" aria-label="Stäng">✕</button></div>` +
    `<div class="asm-title">${asmEsc(s.name)}</div><div class="asm-meta">${meta.map(asmEsc).join(" · ")}</div>` +
    (s.targets.length ? "" : `<div class="asm-warn">Inte kopplad till modellen – inget att visa i 3D</div>`) +
    `<input type="range" class="asm-range" min="1" max="${n}" value="${asm.i + 1}" aria-label="Steg" />` +
    `<div class="asm-btns"><button type="button" data-a="first" title="Första">⏮</button><button type="button" data-a="prev" title="Föregående (←)">◀</button>` +
    `<button type="button" data-a="play" class="asm-play" title="Spela (mellanslag)">${asm.play ? "⏸" : "▶"}</button><button type="button" data-a="next" title="Nästa (→)">▶︎</button><button type="button" data-a="last" title="Sista">⏭</button></div>` +
    `<div class="asm-opts"><label><input type="checkbox" data-o="follow"${asm.follow ? " checked" : ""}/> Följ med kameran</label><label><input type="checkbox" data-o="future"${asm.future ? " checked" : ""}/> Visa kommande svagt</label><label><input type="checkbox" data-o="skip"${asm.skipUncoupled ? " checked" : ""}/> Bara kopplade</label><button type="button" data-a="list" class="asm-lt">${asm.listOpen ? "Dölj lista" : "Visa lista"}</button></div>` +
    (asm.listOpen ? `<div class="asm-list">${asm.steps.map((x, k) => `<div class="asm-row${k === asm.i ? " cur" : k < asm.i ? " done" : ""}" data-k="${k}"><b>${k + 1}</b><span>${asmEsc(x.name)}</span><small>${asmDate(x.start).slice(5)}</small></div>`).join("")}</div>` : "");
  const cur = p.querySelector(".asm-row.cur"); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
}

function asmGo(i) {
  if (!asm.steps.length) return;
  asm.i = Math.max(0, Math.min(asm.steps.length - 1, i));
  asmRender(); asmApply();
  if (asm.play && asm.i >= asm.steps.length - 1) asmPlay(false);
}
function asmPlay(on) {
  asm.play = on; clearInterval(asm.timer); asm.timer = null;
  if (on) { if (asm.i >= asm.steps.length - 1) asm.i = 0; asm.timer = setInterval(() => { if (!asm.busy) asmGo(asm.i + 1); }, 2500); }
  asmRender();
}
function asmKey(e) {
  if (!asm.on) return;
  const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== "range" && t.type !== "checkbox") return;
  if (e.key === "Escape") { e.stopPropagation(); asmClose(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); asmGo(asm.i + 1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); asmGo(asm.i - 1); }
  else if (e.key === " " && !(t && t.type === "checkbox")) { e.preventDefault(); asmPlay(!asm.play); }
}

async function asmOpen() {
  if (asm.on) { asmClose(); return; }
  if (!API || !API.viewer || typeof API.viewer.setObjectState !== "function") { modelToast("Montageordning kräver Trimble Connect-vyn"); return; }
  try { if (typeof ganttMode !== "undefined" && ganttMode !== "off") await setGanttMode("off", true); } catch (e) { /* ignorera */ }
  asm.steps = asmBuildSteps(); asm.i = 0; asm.shown = null; asm.on = true;
  if (!asm.steps.length && asm.skipUncoupled) { asm.skipUncoupled = false; asm.steps = asmBuildSteps(); }
  let p = document.getElementById("asmPanel");
  if (!p) {
    p = document.createElement("div"); p.id = "asmPanel"; p.className = "asm-panel"; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Montageordning");
    p.innerHTML = `<div class="asm-body"></div>`; document.body.appendChild(p);
    p.addEventListener("click", e => {
      const a = e.target.closest("[data-a]"), r = e.target.closest(".asm-row");
      if (r) return asmGo(Number(r.dataset.k));
      if (!a) return;
      const k = a.dataset.a;
      if (k === "close") asmClose(); else if (k === "first") asmGo(0); else if (k === "last") asmGo(asm.steps.length - 1);
      else if (k === "prev") asmGo(asm.i - 1); else if (k === "next") asmGo(asm.i + 1); else if (k === "play") asmPlay(!asm.play);
      else if (k === "list") { asm.listOpen = !asm.listOpen; asmRender(); }
    });
    p.addEventListener("input", e => { if (e.target.classList.contains("asm-range")) { asmGo(Number(e.target.value) - 1); const r = p.querySelector(".asm-range"); if (r) r.focus(); } });
    p.addEventListener("change", e => {
      const o = e.target.dataset && e.target.dataset.o; if (!o) return;
      if (o === "follow") asm.follow = e.target.checked;
      else if (o === "future") { asm.future = e.target.checked; asm.shown = null; asmApply(); }
      else if (o === "skip") { const cur = asm.steps[asm.i]; asm.skipUncoupled = e.target.checked; asm.steps = asmBuildSteps(); asm.shown = null; const k = cur ? asm.steps.indexOf(asm.steps.find(s => s.it === cur.it)) : -1; asm.i = k >= 0 ? k : 0; asmRender(); asmApply(); }
    });
  }
  p.classList.remove("hidden"); document.addEventListener("keydown", asmKey, true);
  const b = document.getElementById("ganttAssemblyBtn"); if (b) b.setAttribute("aria-pressed", "true");
  asmRender(); asmApply();
}
async function asmClose() {
  asmPlay(false); asm.on = false; asm.shown = null; asm.seq++;
  document.removeEventListener("keydown", asmKey, true);
  const p = document.getElementById("asmPanel"); if (p) p.classList.add("hidden");
  const b = document.getElementById("ganttAssemblyBtn"); if (b) b.setAttribute("aria-pressed", "false");
  const V = API && API.viewer;
  if (V && typeof V.setObjectState === "function") {
    try { await V.setObjectState(undefined, { color: "reset" }); await V.setObjectState(undefined, { visible: "reset" }); modelToast("Hela modellen visas igen"); } catch (e) { console.warn("Montageordning: kunde inte återställa modellen", e); }
  }
}
function initAssemblyPlayer() { const b = document.getElementById("ganttAssemblyBtn"); if (b) b.onclick = () => asmOpen(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAssemblyPlayer); else initAssemblyPlayer();
