/* Kommentarsbubblor i 3D (Victor 2026-10-13): en bubbla per aktivitet vid dess objekt i Trimble Connect, med samma info som
   Gantt-schemat visar – datum, framdrift, område och aktivitet. Använder Trimble Connects textmarkeringar (som etiketterna i
   4D-planering). Följer markeringen (Ctrl-klick), tidslinjens datum och schemats urval. */

const BUBBLE_CFG_KEY = "4ddash-bubbles-cfg";
let bubbleCfg = { on: false, scope: "auto", max: 30, name: true, date: true, progress: true, area: true, activity: true };
try { Object.assign(bubbleCfg, JSON.parse(localStorage.getItem(BUBBLE_CFG_KEY) || "{}")); } catch (e) { /* standard */ }
bubbleCfg.on = false; // startar alltid av – bubblor ska inte dyka upp av sig själva
const bubbleSave = () => { try { localStorage.setItem(BUBBLE_CFG_KEY, JSON.stringify({ ...bubbleCfg, on: false })); } catch (e) {} };
let bubbleIds = [], bubbleBusy = false, bubblePending = false, bubbleTimer = null;

/* Aktiviteterna som ska få bubbla (sammanslagna, som schemat visar dem). */
function bubbleActs() {
  const at = (typeof ganttAsOf !== "undefined" && ganttAsOf) || todayISO();
  const merged = list => mergeActivityGroups(list.filter(x => x.startDate));
  const marked = typeof ganttMultiSel !== "undefined" && ganttMultiSel.size ? merged(ganttMultiMembers()) : [];
  const shown = merged(ganttShownItems);
  let scope = bubbleCfg.scope;
  if (scope === "auto") scope = marked.length ? "marked" : "active";
  let acts = scope === "marked" ? marked : scope === "all" ? shown : shown.filter(a => { const ph = ganttPhaseAt(a, at); return ph === "pagaende" || ph === "forsenad"; });
  // Tidslinjen: det som inte startat är släckt i 3D och får ingen bubbla.
  if (typeof ganttMode !== "undefined" && ganttMode === "time" && typeof ganttAsOf !== "undefined" && ganttAsOf && !ganttTimeFuture) acts = acts.filter(a => ganttPhaseAt(a, ganttAsOf) !== "planerad");
  return { acts: acts.filter(a => (a.members || [a]).some(m => m.modelId && m.objectId)).slice(0, Math.max(1, Math.min(100, Number(bubbleCfg.max) || 30))), scope };
}
function bubbleText(a) {
  const f = bubbleCfg, L = [], fd = d => (d ? shortDateSv(parseDate(d)) : "");
  if (f.name) L.push(itemLabel(a));
  if (f.date && a.startDate) L.push(`${fd(a.startDate)} – ${fd(a.actualEndDate && a.actualEndDate > (a.endDate || "") ? a.actualEndDate : a.endDate || a.startDate)}`);
  if (f.progress) L.push(`Framdrift ${Math.round(Number(a.progress) || 0)} %`);
  if (f.area && a.area) L.push(a.area);
  if (f.activity && a.activity && a.activity !== a.objectName) L.push(a.activity);
  return L.join("\n") || itemLabel(a);
}
async function bubblesClear() {
  const ids = bubbleIds; bubbleIds = [];
  if (!ids.length || !API || !API.markup) return;
  try { await API.markup.removeMarkups(ids); } catch (e) { console.warn("Kunde inte ta bort bubblorna", e); }
}
async function bubblesRebuild() {
  if (bubbleBusy) { bubblePending = true; return; }
  bubbleBusy = true;
  try {
    await bubblesClear();
    if (!bubbleCfg.on) return;
    const V = API && API.viewer;
    if (!V || !API.markup || typeof API.markup.addTextMarkup !== "function" || typeof V.getObjectBoundingBoxes !== "function") { modelToast("Bubblor kräver Trimble Connect-vyn"); bubbleCfg.on = false; bubblesSyncUi(); return; }
    const { acts } = bubbleActs();
    if (!acts.length) { bubblesInfo("Inga aktiviteter att visa bubblor för – markera med Ctrl-klick eller välj en annan urval"); return; }
    // Runtime-id och lägen per modell (ett anrop per modell).
    const byModel = new Map();
    acts.forEach(a => (a.members || [a]).forEach(m => { if (m.modelId && m.objectId) (byModel.get(m.modelId) || byModel.set(m.modelId, new Set()).get(m.modelId)).add(String(m.objectId)); }));
    const boxOf = new Map(); // "modell|objekt" -> { rid, box }
    for (const [modelId, set] of byModel) {
      const ids = [...set]; const r = await dashRuntimeIds(V, modelId, ids);
      if (r.modelFailed) continue;
      const rids = ids.map(id => r.map.get(id)).filter(x => x !== null && x !== undefined);
      if (!rids.length) continue;
      let boxes = []; try { boxes = await V.getObjectBoundingBoxes(modelId, rids); } catch (e) { console.warn("Bounding boxes", e); continue; }
      const byRid = new Map(boxes.map(b => [b.id, b.boundingBox]));
      ids.forEach(id => { const rid = r.map.get(id); if (rid !== null && rid !== undefined && byRid.has(rid)) boxOf.set(`${modelId}|${id}`, { rid, box: byRid.get(rid) }); });
    }
    const marks = [];
    acts.forEach(a => {
      const bs = (a.members || [a]).map(m => boxOf.get(`${m.modelId}|${m.objectId}`)).filter(Boolean);
      if (!bs.length) return;
      const lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity };
      bs.forEach(({ box }) => ["x", "y", "z"].forEach(k => { lo[k] = Math.min(lo[k], box.min[k]); hi[k] = Math.max(hi[k], box.max[k]); }));
      const p = { positionX: (lo.x + hi.x) / 2 * 1000, positionY: (lo.y + hi.y) / 2 * 1000, positionZ: hi.z * 1000, modelId: (a.members || [a]).find(m => boxOf.has(`${m.modelId}|${m.objectId}`)).modelId, objectId: bs[0].rid };
      marks.push({ text: bubbleText(a), start: p, end: p });
    });
    if (!marks.length) { bubblesInfo("Objekten finns inte i de inlästa modellerna"); return; }
    const created = await API.markup.addTextMarkup(marks);
    bubbleIds = (created || []).map(m => m.id).filter(id => id !== undefined);
    bubblesInfo(`${marks.length} bubblor`);
  } catch (e) { console.warn("Bubblor", e); modelToast("Kunde inte skapa bubblor: " + ((e && (e.message || e.error)) || "Trimble Connect svarade inte")); }
  finally { bubbleBusy = false; if (bubblePending) { bubblePending = false; bubblesSchedule(true); } }
}
/* Räknas om en kort stund efter att urvalet, datumet eller schemat ändrats. */
function bubblesSchedule(now) {
  if (!bubbleCfg.on) return;
  clearTimeout(bubbleTimer); bubbleTimer = setTimeout(bubblesRebuild, now ? 0 : 600);
}
function bubblesInfo(t) { const el = document.getElementById("bubbleInfo"); if (el) el.textContent = t; }
function bubblesSyncUi() { const b = document.getElementById("bubbleBtn"); if (b) b.setAttribute("aria-pressed", String(!!bubbleCfg.on)); if (!bubbleCfg.on) bubblesInfo(""); }
function bubblesToggle(on) {
  bubbleCfg.on = on === undefined ? !bubbleCfg.on : !!on; bubblesSyncUi();
  clearTimeout(bubbleTimer);
  if (bubbleCfg.on) bubblesRebuild(); else bubblesRebuild(); // av: rensar
}
function openBubbleCfg(anchor) {
  const old = document.getElementById("bubblePop"); if (old) { old.remove(); return; }
  const c = bubbleCfg, pop = document.createElement("div"); pop.id = "bubblePop"; pop.className = "board-pop bubble-pop";
  pop.innerHTML = `<div class="board-pop-title">Info-bubblor i 3D</div>
    <label>Vilka <select class="bb-scope"><option value="auto"${c.scope === "auto" ? " selected" : ""}>Markerade, annars pågående</option><option value="marked"${c.scope === "marked" ? " selected" : ""}>Bara markerade (Ctrl-klick)</option><option value="active"${c.scope === "active" ? " selected" : ""}>Pågående och försenade</option><option value="all"${c.scope === "all" ? " selected" : ""}>Alla som visas i schemat</option></select></label>
    <label>Högst <input type="number" class="bb-max" min="1" max="100" value="${c.max}" /> st</label>
    <div class="bb-fields">${[["name", "Namn"], ["date", "Datum"], ["progress", "Framdrift"], ["area", "Område"], ["activity", "Aktivitet"]].map(([k, l]) => `<label class="bb-f"><input type="checkbox" data-bf="${k}"${c[k] ? " checked" : ""} /> ${l}</label>`).join("")}</div>
    <div class="board-pop-actions"><button type="button" class="bb-close primary">Klar</button></div>`;
  overlayHost().appendChild(pop);
  const r = anchor.getBoundingClientRect(); pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 290, r.left))}px`; pop.style.top = `${Math.min(window.innerHeight - 330, r.bottom + 6)}px`; pop.style.width = "280px";
  const upd = () => { bubbleSave(); bubblesSchedule(); };
  pop.querySelector(".bb-scope").onchange = e => { bubbleCfg.scope = e.target.value; upd(); };
  pop.querySelector(".bb-max").onchange = e => { bubbleCfg.max = Math.max(1, Math.min(100, Number(e.target.value) || 30)); upd(); };
  pop.querySelectorAll("[data-bf]").forEach(i => { i.onchange = () => { bubbleCfg[i.dataset.bf] = i.checked; upd(); }; });
  pop.querySelector(".bb-close").onclick = () => pop.remove();
}
function initBubbles() {
  const b = document.getElementById("bubbleBtn"); if (!b || b.dataset.wired) return; b.dataset.wired = "1";
  b.onclick = () => bubblesToggle();
  const c = document.getElementById("bubbleCfgBtn"); if (c) c.onclick = () => openBubbleCfg(c);
}
