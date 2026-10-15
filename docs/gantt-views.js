/* Sparade vyer av Gantt-schemat (Victor 2026-10-15: "en spara-funktion där precis allt jag har ställt in sparas precis som det ser ut"):
   en namngiven ögonblicksbild av ALLA Gantt-inställningar (vy, gruppering, färger, tidsläge och datum, filter, sökning, markerade,
   bubblor, tidsintervall, färgskala, höjd, dolda knappar, hopfällda block …). Att hämta en vy lägger tillbaka inställningarna och
   laddar om tillägget en gång – då startar allt upp från samma värden som om man ställt in det för hand. Sparas i webbläsaren. */

const GV_RESTORE_KEY = "4ddash-restore";
const GV_EXTRA = ["4ddash-bubbles-cfg", "4ddash-collapsed", "4ddash-hidden-panels", "4ddash-pulse-cfg", "4ddash-status-colors", "4ddash-rescurve", "4ddash-res-open"];
const gvKey = k => typeof k === "string" && (k.startsWith("4ddash-gantt-") || GV_EXTRA.includes(k));
const gvStoreKey = () => `4ddash-views:${typeof projectId !== "undefined" && projectId ? projectId : "_"}`;
function gvGet() { try { const v = JSON.parse(localStorage.getItem(gvStoreKey()) || "[]"); return Array.isArray(v) ? v.filter(x => x && x.name && x.ls) : []; } catch (e) { return []; } }
function gvPut(list) { try { localStorage.setItem(gvStoreKey(), JSON.stringify(list.slice(0, 30))); return true; } catch (e) { modelToast("Kunde inte spara (webbläsarens lagring är avstängd eller full)"); return false; } }

function gvSnapshot() {
  try { if (typeof saveGanttPrefs === "function") saveGanttPrefs(); } catch (e) { /* */ }
  const ls = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (gvKey(k)) ls[k] = localStorage.getItem(k); } } catch (e) { /* */ }
  const chart = document.getElementById("ganttChart");
  const mem = {
    filters: { area: (filters.area || []).slice(), activity: (filters.activity || []).slice(), contractor: (filters.contractor || []).slice() },
    search: typeof ganttSearch === "string" ? ganttSearch : "",
    mode: typeof ganttMode === "string" ? ganttMode : "off",
    asOf: typeof ganttAsOf !== "undefined" ? ganttAsOf : null,
    multi: typeof ganttMultiSel !== "undefined" ? [...ganttMultiSel] : [],
    bubbles: typeof bubbleCfg !== "undefined" && !!bubbleCfg.on,
    scroll: chart ? [chart.scrollLeft, chart.scrollTop] : [0, 0]
  };
  return { ls, mem, at: new Date().toISOString() };
}
function gvSummary(v) {
  const m = v.mem || {}, bits = [], ls = v.ls || {};
  try { const p = JSON.parse(ls["4ddash-gantt-prefs"] || "{}"); bits.push(p.view === "board" ? "Tavla" : "Staplar"); if (p.groupBy) bits.push({ area: "grupp: område", contractor: "grupp: entreprenör", activity: "grupp: aktivitet" }[p.groupBy] || ""); } catch (e) { /* */ }
  if (m.mode && m.mode !== "off") bits.push({ time: "Tid", isolate: "Kopplade", hide: "Okopplade" }[m.mode] || m.mode);
  if (m.asOf) bits.push(m.asOf);
  const n = ((m.filters || {}).area || []).length + ((m.filters || {}).activity || []).length + ((m.filters || {}).contractor || []).length;
  if (n) bits.push(`${n} filterval`); if (m.search) bits.push(`sök "${m.search}"`); if ((m.multi || []).length) bits.push(`${m.multi.length} markerade`); if (m.bubbles) bits.push("bubblor");
  return bits.filter(Boolean).join(" · ");
}
async function gvApply(v) {
  if (!(await dashConfirm(`Hämta vyn "${v.name}"? Gantt-inställningarna ersätts och tillägget laddas om en gång.`))) return;
  try {
    const rm = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (gvKey(k)) rm.push(k); }
    rm.forEach(k => localStorage.removeItem(k));
    Object.keys(v.ls || {}).forEach(k => { if (gvKey(k)) localStorage.setItem(k, v.ls[k]); });
    localStorage.setItem(GV_RESTORE_KEY, JSON.stringify({ mem: v.mem || {}, t: Date.now() }));
  } catch (e) { modelToast("Kunde inte hämta vyn (webbläsarens lagring)"); return; }
  modelToast(`Hämtar vyn "${v.name}" …`);
  setTimeout(() => location.reload(), 150);
}
/* Anropas en gång när tillägget startat och data lästs in: lägger tillbaka det som inte sparas av sig självt. */
async function gvRestore() {
  let r = null;
  try { r = JSON.parse(localStorage.getItem(GV_RESTORE_KEY) || "null"); localStorage.removeItem(GV_RESTORE_KEY); } catch (e) { return; }
  if (!r || !r.mem || Date.now() - (r.t || 0) > 120000) return;
  const m = r.mem, step = async (n, fn) => { try { await fn(); } catch (e) { console.warn("Hämta vy:", n, e); } };
  await step("filter", () => {
    const f = m.filters || {}; filters.area = (f.area || []).slice(); filters.activity = (f.activity || []).slice(); filters.contractor = (f.contractor || []).slice();
    renderAreaFilter(); renderActivityFilter(); renderContractorFilter();
  });
  await step("sök", () => { ganttSearch = m.search || ""; const s = document.getElementById("ganttSearch"); if (s) s.value = ganttSearch; });
  await step("rita", () => renderAll());
  if (m.mode && m.mode !== "off") await step("läge", () => setGanttMode(m.mode, true));
  if (m.asOf) await step("datum", () => setGanttAsOf(m.asOf, { now: true }));
  if ((m.multi || []).length) await step("markerade", () => { m.multi.forEach(id => ganttMultiSel.add(String(id))); applyGanttMultiSel(); });
  if (m.bubbles) await step("bubblor", () => bubblesToggle(true));
  setTimeout(() => { const c = document.getElementById("ganttChart"); if (c && m.scroll) { c.scrollLeft = m.scroll[0] || 0; c.scrollTop = m.scroll[1] || 0; } }, 700);
  modelToast("Vyn är hämtad");
}

function gvClose() { const p = document.getElementById("gvPop"); if (p) p.remove(); document.removeEventListener("pointerdown", gvOut, true); document.removeEventListener("keydown", gvKeyEsc, true); }
const gvOut = e => { const p = document.getElementById("gvPop"); if (p && !p.contains(e.target) && !e.target.closest("#ganttViewsBtn")) gvClose(); };
const gvKeyEsc = e => { if (e.key === "Escape") { e.stopPropagation(); gvClose(); } };
function gvOpen(btn) {
  if (document.getElementById("gvPop")) { gvClose(); return; }
  const p = document.createElement("div"); p.id = "gvPop"; p.className = "gv-pop";
  p.innerHTML = `<div class="gtm-title">Sparade vyer</div>
    <div class="hint gv-hint">Sparar precis hur schemat ser ut nu: vy, gruppering, färger, tidsläge och datum, filter, sökning, markerade, bubblor, höjd, dolda knappar m.m.</div>
    <div class="gv-new"><input type="text" class="gv-name" placeholder="Namn på vyn…" maxlength="60" autocomplete="off"><button type="button" class="gv-save primary">Spara nuvarande</button></div>
    <div class="gv-list"></div>`;
  (document.fullscreenElement || document.body).appendChild(p);
  const r = btn.getBoundingClientRect(); p.style.top = Math.min(innerHeight - 80, r.bottom + 6) + "px"; p.style.left = Math.max(8, Math.min(r.right - 340, innerWidth - 356)) + "px";
  const q = s => p.querySelector(s), name = q(".gv-name");
  const fill = () => {
    const list = gvGet();
    q(".gv-list").innerHTML = list.length ? list.map((v, i) => `<div class="gv-row" data-i="${i}"><div class="gv-t"><b>${escapeHtml(v.name)}</b><span class="hint">${escapeHtml(gvSummary(v))}${v.at ? " · " + escapeHtml(v.at.slice(0, 10)) : ""}</span></div><button type="button" class="gv-use primary" title="Hämta vyn">Hämta</button><button type="button" class="gv-over" title="Ersätt vyn med hur schemat ser ut nu">Ersätt</button><button type="button" class="gv-del" title="Ta bort">✕</button></div>`).join("") : `<div class="hint">Inga sparade vyer ännu.</div>`;
  };
  const save = async () => {
    const list = gvGet(), nm = name.value.trim() || `Vy ${list.length + 1}`, i = list.findIndex(x => x.name.toLowerCase() === nm.toLowerCase());
    if (i >= 0 && !(await dashConfirm(`Det finns redan en vy som heter "${list[i].name}". Ersätta den?`))) return;
    const v = { name: nm, ...gvSnapshot() }; if (i >= 0) list[i] = v; else list.push(v);
    if (gvPut(list)) { name.value = ""; fill(); modelToast(`Vyn "${nm}" sparad`); }
  };
  q(".gv-save").onclick = save; name.onkeydown = e => { e.stopPropagation(); if (e.key === "Enter") save(); else if (e.key === "Escape") gvClose(); };
  q(".gv-list").onclick = async e => {
    const row = e.target.closest(".gv-row"); if (!row) return; const list = gvGet(), i = Number(row.dataset.i), v = list[i]; if (!v) return;
    if (e.target.closest(".gv-del")) { if (await dashConfirm(`Ta bort vyn "${v.name}"?`)) { list.splice(i, 1); gvPut(list); fill(); } return; }
    if (e.target.closest(".gv-over")) { if (await dashConfirm(`Ersätta vyn "${v.name}" med hur schemat ser ut nu?`)) { list[i] = { name: v.name, ...gvSnapshot() }; if (gvPut(list)) { fill(); modelToast(`Vyn "${v.name}" ersatt`); } } return; }
    if (e.target.closest(".gv-use")) { gvClose(); gvApply(v); }
  };
  fill(); setTimeout(() => { document.addEventListener("pointerdown", gvOut, true); document.addEventListener("keydown", gvKeyEsc, true); }, 0); name.focus();
}
function initGanttViews() { const b = document.getElementById("ganttViewsBtn"); if (b) b.onclick = () => gvOpen(b); }
document.addEventListener("DOMContentLoaded", initGanttViews);
if (document.readyState !== "loading") initGanttViews();
