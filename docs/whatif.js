/* Vad händer om? (Victor 2026-10-20): prova flyttar och förlängningar utan att spara något. Beroende aktiviteter följer med
   (samma beräkning som när man drar i schemat), och du ser nytt slutdatum, påverkade aktiviteter, toppbelastning och konflikter.
   Scenarier sparas i webbläsaren och kan jämföras. "Genomför" lägger ändringen på riktigt (med Ångra, som vid dragning). */
const wi = { ops: [], saved: (() => { try { return JSON.parse(localStorage.getItem("4ddash-whatif") || "[]"); } catch (e) { return []; } })(), wrap: null };
const wiEsc = s => (typeof labEsc === "function" ? labEsc(s) : String(s == null ? "" : s));
const wiSave = () => { try { localStorage.setItem("4ddash-whatif", JSON.stringify(wi.saved.slice(-30))); } catch (e) { /* */ } };
const wiKeyOf = it => it.activityKey || String(it.id);
const wiIds = key => new Set(items.filter(x => wiKeyOf(x) === key).map(x => x.id));

function wiPlan(ops) {
  const plan = emptyPlan(), targets = new Set();
  ops.forEach(o => {
    const ids = wiIds(o.key); if (!ids.size) return; ids.forEach(i => targets.add(i));
    if (o.kind === "move") planMove(ids, o.days, o.deps, plan);
    else planResize(ids, "right", o.kind === "shrink" ? -Math.abs(o.days) : o.days, o.deps, plan);
  });
  return { plan, targets };
}
/* Aktiviteter (ihopslagna) med datum enligt planen. */
function wiGroups(plan) {
  const g = new Map();
  items.forEach(it => { if (!it.startDate || !it.endDate) return; const k = wiKeyOf(it), c = curItemDates(it, plan); const e = g.get(k) || { key: k, name: it.objectName || it.activity, s: c.startDate, e: c.endDate, ms: [] }; if (c.startDate < e.s) e.s = c.startDate; if (c.endDate > e.e) e.e = c.endDate; e.ms.push(it); g.set(k, e); });
  return [...g.values()].map(e => ({ ...e, h: typeof labHoursOf === "function" ? labHoursOf({ members: e.ms }) : null }));
}
function wiMetrics(plan, base) {
  const gs = wiGroups(plan), bmap = new Map(base.map(g => [g.key, g]));
  const end = gs.reduce((m, g) => (g.e > m ? g.e : m), ""), changed = gs.filter(g => { const b = bmap.get(g.key); return b && (b.s !== g.s || b.e !== g.e); }).map(g => ({ g, d: labDiff(bmap.get(g.key).e, g.e), b: bmap.get(g.key) })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const mn = gs.reduce((m, g) => (g.s < m ? g.s : m), gs[0] ? gs[0].s : ""), peakOf = list => { let pk = 0, pd = ""; for (let d = mn, n = 0; d <= end && n < 2500; d = labAdd(d, 1), n++) { if (!labIsWork(d)) continue; let p = 0; list.forEach(g => { if (g.h && g.s <= d && g.e >= d) p += g.h / (8 * Math.max(1, labWorkDays(g.s, g.e))); }); if (p > pk) { pk = p; pd = d; } } return { pk, pd }; };
  return { end, changed, peak: peakOf(gs) };
}
function wiEval(ops) {
  const base = wiGroups(emptyPlan()), b = wiMetrics(emptyPlan(), base), { plan, targets } = wiPlan(ops), m = wiMetrics(plan, base);
  return { plan, targets, base: b, now: m, conflicts: typeof planConflicts === "function" ? planConflicts(targets, plan) : [] };
}
const wiLabel = o => { const g = wiGroups(emptyPlan()).find(x => x.key === o.key); return `${o.kind === "move" ? "Flytta" : o.kind === "extend" ? "Förläng" : "Korta"} "${g ? g.name : o.key}" ${o.days > 0 && o.kind === "move" ? "+" : ""}${o.days} d${o.deps ? " (beroende följer med)" : " (bara denna)"}`; };

function wiRender() {
  const w = wi.wrap; if (!w) return;
  const acts = labActs(), r = wiEval(wi.ops), dEnd = r.base.end && r.now.end ? labDiff(r.base.end, r.now.end) : 0;
  w.querySelector(".wi-ops").innerHTML = wi.ops.map((o, i) => `<div class="wi-op"><span>${wiEsc(wiLabel(o))}</span><button type="button" data-rm="${i}" aria-label="Ta bort">✕</button></div>`).join("") || `<p class="hint">Lägg till en ändring ovan.</p>`;
  w.querySelector(".wi-res").innerHTML = wi.ops.length ? `<div class="lab-kpis"><div class="${dEnd > 0 ? "bad" : ""}"><b>${wiEsc(r.now.end)}</b>slutdatum (före ${wiEsc(r.base.end)}${dEnd ? `, ${dEnd > 0 ? "+" : ""}${dEnd} d` : ""})</div><div><b>${r.now.changed.length}</b>aktiviteter påverkas</div><div><b>${labNum(r.now.peak.pk, 1)}</b>toppbelastning pers/dag (före ${labNum(r.base.peak.pk, 1)})</div><div class="${r.conflicts.length ? "bad" : ""}"><b>${r.conflicts.length}</b>konflikter</div></div>
    ${r.conflicts.length ? `<p class="bad">${wiEsc(typeof conflictText === "function" ? conflictText(r.conflicts) : "").replace(/\n/g, "<br>")}</p>` : ""}
    <table class="lab-tbl"><tr><th>Aktivitet</th><th>Slut före</th><th>Slut efter</th><th>Förskjutning</th></tr>${r.now.changed.slice(0, 40).map(c => `<tr><td>${wiEsc(c.g.name)}</td><td>${c.b.e}</td><td>${c.g.e}</td><td class="${c.d > 0 ? "bad" : "ok"}">${c.d > 0 ? "+" : ""}${c.d} d</td></tr>`).join("")}</table>` : "";
  w.querySelector(".wi-saved").innerHTML = wi.saved.length ? `<h4>Sparade scenarier</h4><table class="lab-tbl"><tr><th>Namn</th><th>Slutdatum</th><th>Påverkade</th><th>Konflikter</th><th></th></tr>${wi.saved.map((s, i) => { const e = wiEval(s.ops), d = e.base.end && e.now.end ? labDiff(e.base.end, e.now.end) : 0; return `<tr><td>${wiEsc(s.name)} <small>(${s.ops.length} ändr.)</small></td><td>${wiEsc(e.now.end)} <span class="${d > 0 ? "bad" : "ok"}">${d ? (d > 0 ? "+" : "") + d + " d" : ""}</span></td><td>${e.now.changed.length}</td><td class="${e.conflicts.length ? "bad" : ""}">${e.conflicts.length}</td><td><button type="button" data-load="${i}">Öppna</button> <button type="button" data-del="${i}">✕</button></td></tr>`; }).join("")}</table>` : "";
  w.querySelector("[data-act=apply]").disabled = !wi.ops.length;
  w.querySelector("[data-act=save]").disabled = !wi.ops.length;
  const sel = w.querySelector("#wiAct"); if (!sel.options.length) sel.innerHTML = acts.sort((a, b) => a.s.localeCompare(b.s)).map(a => `<option value="${wiEsc(a.key)}">${wiEsc(a.name)} (${a.s.slice(5)}–${a.e.slice(5)})</option>`).join("");
}
function wiClose() { if (wi.wrap) { wi.wrap.remove(); wi.wrap = null; } document.removeEventListener("keydown", wiKey, true); }
function wiKey(e) { if (e.key === "Escape" && wi.wrap) { e.stopPropagation(); wiClose(); } }
function wiOpen() {
  if (wi.wrap) return;
  if (typeof planMove !== "function" || typeof labActs !== "function") return;
  const w = document.createElement("div"); w.className = "ac-wrap"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "Vad händer om");
  w.innerHTML = `<div class="ac-dlg"><div class="ac-h"><b>Vad händer om …?</b><button type="button" class="ac-x" data-act="close" aria-label="Stäng">✕</button></div>
    <div class="hint">Prova ändringar utan att spara något. Beroende aktiviteter följer med som när du drar i schemat.</div>
    <div class="lab-row"><select id="wiAct" style="max-width:340px" aria-label="Aktivitet"></select><select id="wiKind"><option value="move">Flytta</option><option value="extend">Förläng slutet</option><option value="shrink">Korta slutet</option></select>
    <label>dagar <input id="wiDays" type="number" value="5" style="width:64px"></label><label><input type="checkbox" id="wiDeps" checked> beroende följer med</label><button type="button" class="primary" data-act="add">Lägg till</button></div>
    <div class="wi-ops"></div><div class="wi-res" style="overflow:auto"></div><div class="wi-saved" style="overflow:auto"></div>
    <div class="ac-foot"><input id="wiName" placeholder="Scenariots namn" style="margin-right:auto;font:inherit;padding:5px 8px;border:1px solid #d0d7de;border-radius:6px"><button type="button" data-act="save">Spara scenario</button><button type="button" data-act="apply" title="Lägger ändringarna i planen (kan ångras)">Genomför på riktigt …</button><button type="button" data-act="close">Stäng</button></div></div>`;
  document.body.appendChild(w); wi.wrap = w; document.addEventListener("keydown", wiKey, true);
  w.addEventListener("click", async e => {
    if (e.target === w) return wiClose();
    const a = e.target.closest("[data-act]"), rm = e.target.closest("[data-rm]"), ld = e.target.closest("[data-load]"), dl = e.target.closest("[data-del]");
    if (rm) { wi.ops.splice(Number(rm.dataset.rm), 1); return wiRender(); }
    if (ld) { wi.ops = JSON.parse(JSON.stringify(wi.saved[Number(ld.dataset.load)].ops)); return wiRender(); }
    if (dl) { wi.saved.splice(Number(dl.dataset.del), 1); wiSave(); return wiRender(); }
    if (!a) return;
    const k = a.dataset.act;
    if (k === "close") wiClose();
    else if (k === "add") { const days = Math.round(Number(w.querySelector("#wiDays").value)); if (!days) return; wi.ops.push({ key: w.querySelector("#wiAct").value, kind: w.querySelector("#wiKind").value, days, deps: w.querySelector("#wiDeps").checked }); wiRender(); }
    else if (k === "save") { const n = w.querySelector("#wiName").value.trim() || `Scenario ${wi.saved.length + 1}`; wi.saved.push({ name: n, ops: JSON.parse(JSON.stringify(wi.ops)) }); wiSave(); w.querySelector("#wiName").value = ""; wiRender(); }
    else if (k === "apply") {
      const r = wiEval(wi.ops); if (!(await dashConfirm(`Genomför ${wi.ops.length} ändring${wi.ops.length === 1 ? "" : "ar"} på riktigt?\n\n${r.now.changed.length} aktiviteter får nya datum. Slutdatum ${r.base.end} → ${r.now.end}. Du kan ångra direkt efteråt.`, { ok: "Genomför" }))) return;
      const ok = await applySchedulePlan(r.plan, "Vad händer om: " + wi.ops.map(wiLabel).join(", ").slice(0, 80)); if (ok !== false) { modelToast("Ändringen är genomförd"); wi.ops = []; wiClose(); renderAll(); }
    }
  });
  w.addEventListener("keydown", e => { if (e.target.matches("input")) e.stopPropagation(); });
  wiRender();
}
function initWhatIf() { const b = document.getElementById("ganttWhatIfBtn"); if (b) b.onclick = () => wiOpen(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initWhatIf); else initWhatIf();
