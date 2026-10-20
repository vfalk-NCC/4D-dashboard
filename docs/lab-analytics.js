/* Test-fliken, del 2 (Victor 2026-10-20): 5 Prognos, 6 Mängd→tid, 8 Platsdiagram, 9 Trängsel, 10 Logistik. Läser bara – skriver inget. */
const labColorOf = s => { let h = 0; String(s).split("").forEach(c => { h = (h * 31 + c.charCodeAt(0)) % 360; }); return `hsl(${h} 62% 50%)`; };
const labMedian = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const labPct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
function labRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const labToday = () => (typeof todayISO === "function" ? todayISO() : new Date().toISOString().slice(0, 10));

/* ============ 5. Prognos ============ */
/* Takt ur historiken: förhållandet verklig/planerad längd för klara aktiviteter (och pågående, efter hur långt de kommit), per entreprenör. */
function labForecastModel(acts, today) {
  const dur = a => labDiff(a.s, a.e) + 1, by = {}, all = [];
  acts.forEach(a => {
    let r = null;
    if ((a.st === "klar" || a.p >= 100) && a.as && a.ae) r = (labDiff(a.as, a.ae) + 1) / dur(a);
    else if (a.p > 5 && a.p < 100 && (a.as || a.s) <= today) { const el = labDiff(a.as || a.s, today) + 1; r = (el / (a.p / 100)) / dur(a); }
    if (r === null || !Number.isFinite(r)) return;
    r = Math.max(0.4, Math.min(3, r)); all.push(r); (by[a.contractor] = by[a.contractor] || []).push(r);
  });
  return { by, all };
}
function labForecast(acts, runs = 400, today = labToday()) {
  const model = labForecastModel(acts, today), idOf = new Map();
  acts.forEach(a => a.members.forEach(m => idOf.set(String(m.id), a.key)));
  const byKey = new Map(acts.map(a => [a.key, a]));
  const preds = new Map(acts.map(a => [a.key, [...new Set(a.members.flatMap(m => (m.dependsOn || []).map(p => idOf.get(String(p))).filter(k => k && k !== a.key)))]]));
  const order = acts.slice().sort((a, b) => a.s.localeCompare(b.s) || a.e.localeCompare(b.e));
  const rng = labRng(20261020), ends = new Map(acts.map(a => [a.key, []])), proj = [];
  const sample = (a, det) => {
    const pool = (model.by[a.contractor] && model.by[a.contractor].length >= 3 ? model.by[a.contractor] : model.all);
    if (det) return pool.length ? labMedian(pool) : 1;
    if (pool.length >= 3) return pool[Math.floor(rng() * pool.length)];
    return Math.exp((rng() + rng() + rng() - 1.5) * 0.5); // för lite historik: spridning ±25 % runt plan
  };
  const once = det => {
    const E = new Map(); let last = "";
    order.forEach(a => {
      const d = labDiff(a.s, a.e) + 1;
      let s = a.as || a.s, e;
      if (a.st === "klar" || a.p >= 100) e = a.ae || a.e;
      else if (a.p > 0 || a.s <= today) { const rem = Math.ceil((1 - a.p / 100) * d * sample(a, det)); e = labAdd(today > s ? today : s, Math.max(0, rem - 1)); }
      else { (preds.get(a.key) || []).forEach(p => { const pe = E.get(p); if (pe && labAdd(pe, 1) > s) s = labAdd(pe, 1); }); e = labAdd(s, Math.max(0, Math.ceil(d * sample(a, det)) - 1)); }
      E.set(a.key, e); if (e > last) last = e;
    });
    return { E, last };
  };
  const det = once(true);
  for (let i = 0; i < runs; i++) { const r = once(false); proj.push(r.last); r.E.forEach((e, k) => ends.get(k).push(e)); }
  const planEnd = acts.reduce((m, a) => (a.e > m ? a.e : m), "");
  const rows = acts.filter(a => !(a.st === "klar" || a.p >= 100)).map(a => { const arr = ends.get(a.key).slice().sort(), p50 = arr[arr.length >> 1], p80 = arr[Math.floor(arr.length * 0.8)]; return { a, p50, p80, slip: labDiff(a.e, p50) }; });
  return { planEnd, detEnd: det.last, p10: labPct(proj, 0.1), p50: labPct(proj, 0.5), p80: labPct(proj, 0.8), p90: labPct(proj, 0.9), onTime: proj.filter(x => x <= planEnd).length / Math.max(1, proj.length), proj, rows, samples: model.all.length, model };
}
function labTabForecast(b, acts) {
  const f = labForecast(acts), sl = f.rows.slice().sort((x, y) => y.slip - x.slip).slice(0, 15);
  const lo = f.proj.reduce((m, d) => (d < m ? d : m), f.proj[0] || ""), hi = f.proj.reduce((m, d) => (d > m ? d : m), ""), daily = lo && labDiff(lo, hi) <= 60, bins = {};
  f.proj.forEach(d => { const w = daily ? d : labAdd(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7)); bins[w] = (bins[w] || 0) + 1; });
  if (daily) for (let d = lo; d <= hi; d = labAdd(d, 1)) bins[d] = bins[d] || 0;
  const ks = Object.keys(bins).sort(), mx = Math.max(...ks.map(k => bins[k]), 1);
  b.innerHTML = `<p class="hint">Simulerar planen 400 gånger med den takt som faktiskt uppnåtts (klara och pågående aktiviteter, per entreprenör) och följer beroendena. ${f.samples} aktiviteter ligger till grund${f.samples < 5 ? " – för lite historik, spridningen är en grov uppskattning" : ""}.</p>
    <div class="lab-kpis"><div><b>${labEsc(f.planEnd)}</b>planerat slut</div><div><b>${labEsc(f.p50)}</b>troligt slut (P50)</div><div><b>${labEsc(f.p80)}</b>säkert slut (P80)</div><div class="${f.onTime < 0.5 ? "bad" : ""}"><b>${Math.round(f.onTime * 100)} %</b>chans att hålla planen</div><div><b>${f.p50 && f.planEnd ? (labDiff(f.planEnd, f.p50) > 0 ? "+" : "") + labDiff(f.planEnd, f.p50) : "–"} d</b>P50 mot plan</div></div>
    <h4>Fördelning av slutdatum (per ${daily ? "dag" : "vecka"})</h4><div class="lab-hist">${ks.map(k => `<i style="height:${Math.round(bins[k] / mx * 100)}%" title="${k}: ${bins[k]} av ${f.proj.length}" class="${labAdd(k, daily ? 0 : 6) <= f.planEnd ? "ok" : ""}"></i>`).join("")}</div><small class="hint">Grönt = före/vid planerat slut.</small>
    <h4>Aktiviteter som troligen glider mest</h4><table class="lab-tbl"><tr><th>Aktivitet</th><th>Entreprenör</th><th>Plan slut</th><th>Troligt (P50)</th><th>Säkert (P80)</th><th>Glidning</th></tr>${sl.map(r => `<tr><td>${labEsc(r.a.name)}</td><td>${labEsc(r.a.contractor)}</td><td>${r.a.e}</td><td>${r.p50}</td><td>${r.p80}</td><td class="${r.slip > 0 ? "bad" : ""}">${r.slip > 0 ? "+" : ""}${r.slip} d</td></tr>`).join("")}</table>
    <h4>Takt per entreprenör (verklig ÷ planerad längd)</h4><table class="lab-tbl"><tr><th>Entreprenör</th><th>Underlag</th><th>Median</th></tr>${Object.entries(f.model.by).map(([c, v]) => `<tr><td>${labEsc(c)}</td><td>${v.length}</td><td>${labNum(labMedian(v), 2)}${labMedian(v) > 1.1 ? " (långsammare än plan)" : labMedian(v) < 0.9 ? " (snabbare)" : ""}</td></tr>`).join("") || "<tr><td colspan=3>Ingen historik än.</td></tr>"}</table>`;
}

/* ============ 6. Mängd → tid ============ */
function labProductivity(acts, q) {
  const types = {};
  acts.forEach(a => {
    const e = q && q.get(a.key); if (!e) return;
    const kind = e.vol > 0 ? "vol" : e.form > 0 ? "form" : null; if (!kind) return;
    const t = a.activity || a.name, T = types[t] = types[t] || { kind: {}, rows: [] };
    T.kind[kind] = (T.kind[kind] || 0) + 1;
    const done = (a.st === "klar" || a.p >= 100) && a.as && a.ae, s = done ? a.as : a.s, e2 = done ? a.ae : a.e, wd = Math.max(1, labWorkDays(s, e2));
    T.rows.push({ a, kind, qty: e[kind], wd, done, perDay: e[kind] / wd, perHour: a.h ? e[kind] / a.h : null });
  });
  Object.values(types).forEach(T => { T.kind = Object.entries(T.kind).sort((x, y) => y[1] - x[1])[0][0]; T.rows = T.rows.filter(r => r.kind === T.kind); const d = T.rows.filter(r => r.done); T.n = d.length; T.use = d.length >= 2 ? d : T.rows; T.med = labMedian(T.use.map(r => r.perDay)); T.medH = labMedian(T.use.map(r => r.perHour).filter(x => x)); T.basis = d.length >= 2 ? "utfall" : "plan"; });
  return types;
}
function labTabQtyTime(b, acts) {
  const q = labQtyByKey();
  if (!q) {
    b.innerHTML = `<p class="hint">Mängd→tid behöver mängderna från Mängdavtagningen.</p><div class="lab-row"><button type="button" class="primary" id="labQtyRead">Läs in mängder (alla aktiviteter)</button><span id="labQtyMsg" class="hint"></span></div>`;
    b.querySelector("#labQtyRead").onclick = async () => { if (typeof qty === "undefined" || typeof qtyRead !== "function") { modelToast("Mängdavtagningen är inte inläst"); return; } b.querySelector("#labQtyMsg").textContent = "Läser … (kan ta en stund)"; qty.cfg.scope = "all"; await qtyRead(); labBody(); };
    return;
  }
  const T = labProductivity(acts, q), names = Object.keys(T).sort((x, y) => x.localeCompare(y, "sv")), unit = k => (k === "vol" ? "m³" : "m²");
  const sug = [];
  names.forEach(n => { const t = T[n]; if (!t.med) return; t.rows.filter(r => !r.done).forEach(r => { const need = Math.max(1, Math.ceil(r.qty / t.med)), diff = need - r.wd; if (Math.abs(diff) >= 2 && Math.abs(diff) / r.wd > 0.3) sug.push({ n, r, need, diff }); }); });
  b.innerHTML = `<p class="hint">Lär sig takten ur klara aktiviteter (mängd ÷ arbetsdagar). Där det saknas utfall används planerad längd som underlag – då speglar takten planen, inte verkligheten.</p>
    <table class="lab-tbl"><tr><th>Aktivitetstyp</th><th>Mängd</th><th>Underlag</th><th>Takt / arbetsdag</th><th>Takt / timme</th></tr>${names.map(n => { const t = T[n]; return `<tr><td>${labEsc(n)}</td><td>${unit(t.kind)}</td><td>${t.use.length} (${t.basis})</td><td>${labNum(t.med, 1)} ${unit(t.kind)}</td><td>${t.medH ? labNum(t.medH, 2) + " " + unit(t.kind) : "–"}</td></tr>`; }).join("") || "<tr><td colspan=5>Inga aktiviteter med mängd.</td></tr>"}</table>
    <h4>Kalkylator</h4><div class="lab-row"><label>Typ <select id="labCt">${names.map(n => `<option>${labEsc(n)}</option>`).join("")}</select></label><label>Mängd <input id="labCq" type="number" min="0" step="any" value="100" style="width:90px"></label><b id="labCr"></b></div>
    <h4>Längder som avviker från takten</h4><table class="lab-tbl"><tr><th>Aktivitet</th><th>Mängd</th><th>Planerat</th><th>Taktförslag</th></tr>${sug.slice(0, 40).map(s => `<tr><td>${labEsc(s.r.a.name)}</td><td>${labNum(s.r.qty, 1)} ${unit(s.r.kind)}</td><td>${s.r.wd} d</td><td class="${s.diff > 0 ? "bad" : ""}">${s.need} d (${s.diff > 0 ? "+" : ""}${s.diff})</td></tr>`).join("") || "<tr><td colspan=4>Inga tydliga avvikelser.</td></tr>"}</table>
    <div class="lab-row"><button type="button" id="labExp">Exportera nyckeltal (JSON) till nästa projekt</button></div>`;
  const calc = () => { const t = T[b.querySelector("#labCt").value], v = Number(b.querySelector("#labCq").value); b.querySelector("#labCr").textContent = t && t.med && v > 0 ? `≈ ${Math.max(1, Math.ceil(v / t.med))} arbetsdagar` : ""; };
  b.querySelector("#labCt").onchange = calc; b.querySelector("#labCq").oninput = calc; calc();
  b.querySelector("#labExp").onclick = () => labDownload(`nyckeltal_${labStamp()}.json`, JSON.stringify(names.map(n => ({ typ: n, enhet: unit(T[n].kind), per_arbetsdag: T[n].med, per_timme: T[n].medH, underlag: T[n].use.length, grund: T[n].basis })), null, 1), "application/json");
}

/* ============ 8. Platsdiagram ============ */
function labTabPlace(b, acts) {
  const st = lab.state.place = lab.state.place || { by: "area", px: 6 };
  const key = a => (st.by === "activity" ? a.activity || "–" : a.area);
  const lanes = {}; acts.forEach(a => (lanes[key(a)] = lanes[key(a)] || []).push(a));
  const names = Object.keys(lanes).sort((x, y) => x.localeCompare(y, "sv", { numeric: true }));
  const mn = acts.reduce((m, a) => (a.s < m ? a.s : m), acts[0].s), mx = acts.reduce((m, a) => (a.e > m ? a.e : m), acts[0].e), px = st.px, W = (labDiff(mn, mx) + 2) * px;
  let collisions = 0;
  const html = names.map(n => {
    const rows = [], list = lanes[n].slice().sort((x, y) => x.s.localeCompare(y.s));
    list.forEach(a => { let r = rows.findIndex(end => end < a.s); if (r < 0) { r = rows.length; rows.push(""); } rows[r] = a.e; a._r = r; });
    const bad = new Set();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].s <= list[i].e; j++) if (list[i].contractor !== list[j].contractor && list[j].s <= list[i].e) { bad.add(list[i].key); bad.add(list[j].key); collisions++; }
    return `<div class="lab-lane"><div class="lab-ln" title="${labEsc(n)}">${labEsc(n)}</div><div class="lab-lt" style="width:${W}px;height:${rows.length * 20 + 4}px">${list.map(a => `<i class="lab-pb${bad.has(a.key) ? " bad" : ""}" data-k="${labEsc(a.key)}" style="left:${labDiff(mn, a.s) * px}px;width:${Math.max(3, (labDiff(a.s, a.e) + 1) * px)}px;top:${a._r * 20 + 2}px;background:${labColorOf(a.contractor)}" title="${labEsc(a.name + " · " + a.contractor + " · " + a.s + " → " + a.e)}">${(labDiff(a.s, a.e) + 1) * px > 50 ? labEsc(a.name) : ""}</i>`).join("")}<u style="left:${Math.max(0, labDiff(mn, labToday())) * px}px"></u></div></div>`;
  }).join("");
  const cons = [...new Set(acts.map(a => a.contractor))];
  b.innerHTML = `<p class="hint">Plats på höjden, tid på bredden. Röd kant = två entreprenörer arbetar på samma plats samtidigt. Klicka en stapel för att markera den i 3D.</p>
    <div class="lab-row"><label>Plats <select id="labBy"><option value="area"${st.by === "area" ? " selected" : ""}>Område</option><option value="activity"${st.by === "activity" ? " selected" : ""}>Aktivitet</option></select></label><label>Zoom <input id="labPx" type="range" min="2" max="16" value="${st.px}"></label><b>${collisions} överlapp mellan entreprenörer</b>
    <span class="lab-leg">${cons.slice(0, 12).map(c => `<i style="background:${labColorOf(c)}"></i>${labEsc(c)}`).join(" ")}</span></div><div class="lab-scroll">${html}</div>`;
  b.querySelector("#labBy").onchange = e => { st.by = e.target.value; labTabPlace(b, acts); };
  b.querySelector("#labPx").onchange = e => { st.px = Number(e.target.value); labTabPlace(b, acts); };
  b.querySelector(".lab-scroll").onclick = e => { const bar = e.target.closest("[data-k]"); if (!bar) return; const a = acts.find(x => x.key === bar.dataset.k); if (a && typeof selectActivityInModel === "function") selectActivityInModel(a.it); };
}

/* ============ 9. Trängsel ============ */
function labLoadAt(acts, d, useOne) {
  const by = {};
  acts.forEach(a => { if (a.s > d || a.e < d || !labIsWork(d)) return; const wd = Math.max(1, labWorkDays(a.s, a.e)), ppl = a.h ? a.h / (8 * wd) : (useOne ? 1 : 0); if (ppl) by[a.area] = (by[a.area] || 0) + ppl; });
  return by;
}
const labHeat = (v, mx) => { const t = mx ? Math.min(1, v / mx) : 0; return `hsl(${Math.round(120 - 120 * t)} 70% ${Math.round(92 - 40 * t)}%)`; };
function labTabCrowd(b, acts) {
  const st = lab.state.crowd = lab.state.crowd || { one: true, at: "" };
  const mn = acts.reduce((m, a) => (a.s < m ? a.s : m), acts[0].s), mx = acts.reduce((m, a) => (a.e > m ? a.e : m), acts[0].e), areas = labAreas(acts);
  const weeks = []; for (let w = labAdd(mn, -((new Date(mn + "T00:00:00Z").getUTCDay() + 6) % 7)), g = 0; w <= mx && g < 120; w = labAdd(w, 7), g++) weeks.push(w);
  const grid = areas.map(ar => weeks.map(w => { let s = 0, n = 0; for (let k = 0; k < 5; k++) { s += labLoadAt(acts.filter(a => a.area === ar), labAdd(w, k), st.one)[ar] || 0; n++; } return s / n; }));
  const top = Math.max(...grid.flat(), 0.001), at = st.at || (labToday() >= mn && labToday() <= mx ? labToday() : mn), now = labLoadAt(acts, at, st.one), nowMax = Math.max(...Object.values(now), 0.001);
  b.innerHTML = `<p class="hint">Personer per dag och område ur planerade timmar (timmar ÷ arbetsdagar ÷ 8). Aktiviteter utan timmar räknas som 1 person om rutan är ibockad.</p>
    <div class="lab-row"><label><input type="checkbox" id="labOne"${st.one ? " checked" : ""}> Räkna 1 person när timmar saknas</label><label>Datum <input type="date" id="labAt" value="${at}"></label><button type="button" class="primary" id="lab3d">Färga 3D efter belastning detta datum</button><button type="button" id="labReset">Återställ 3D</button><span id="labMsg" class="hint"></span></div>
    <div class="lab-scroll"><table class="lab-heat"><tr><th></th>${weeks.map(w => `<th title="${w}">v${typeof isoWeekNumber === "function" ? isoWeekNumber(new Date(w + "T00:00:00Z")) : ""}</th>`).join("")}</tr>${areas.map((ar, i) => `<tr><th>${labEsc(ar)}</th>${grid[i].map((v, j) => `<td style="background:${v ? labHeat(v, top) : "#f6f8fa"}" title="${labEsc(ar)} · ${weeks[j]} · ${labNum(v, 1)} pers/dag">${v ? labNum(v, 1) : ""}</td>`).join("")}</tr>`).join("")}</table></div>
    <h4>${at}</h4><div class="lab-leg">${Object.entries(now).sort((x, y) => y[1] - x[1]).map(([a, v]) => `<span style="background:${labHeat(v, nowMax)}">${labEsc(a)}: ${labNum(v, 1)}</span>`).join(" ") || "Ingen belastning detta datum."}</div>`;
  b.querySelector("#labOne").onchange = e => { st.one = e.target.checked; labTabCrowd(b, acts); };
  b.querySelector("#labAt").onchange = e => { st.at = e.target.value; labTabCrowd(b, acts); };
  b.querySelector("#labReset").onclick = async () => { try { await API.viewer.setObjectState(undefined, { color: "reset" }); b.querySelector("#labMsg").textContent = "Återställd."; } catch (e) { modelToast("Kunde inte återställa"); } };
  b.querySelector("#lab3d").onclick = async () => {
    const V = API && API.viewer, msg = b.querySelector("#labMsg");
    if (!V || typeof V.setObjectState !== "function") { modelToast("Kräver Trimble Connect-vyn"); return; }
    const active = acts.filter(a => a.s <= at && a.e >= at && now[a.area]), steps = active.map(a => ({ a, targets: a.members.filter(m => m.modelId && m.objectId) }));
    if (!steps.some(s => s.targets.length)) { msg.textContent = "Inga kopplade aktiviteter detta datum."; return; }
    msg.textContent = "Färgar …";
    try {
      await asmRids(V, steps);
      await V.setObjectState(undefined, { color: { r: 190, g: 196, b: 205, a: 70 } });
      const byColor = new Map();
      steps.forEach(s => { const t = Math.min(1, now[s.a.area] / nowMax), col = { r: Math.round(60 + 195 * t), g: Math.round(200 - 150 * t), b: 70, a: 255 }, k = JSON.stringify(col); (byColor.get(k) || byColor.set(k, { col, gs: [] }).get(k)).gs.push(...(s.groups || [])); });
      for (const { col, gs } of byColor.values()) { const m = asmMerge([gs]); if (m.length) await V.setObjectState({ modelObjectIds: asmMo(m) }, { color: col }); }
      msg.textContent = `${steps.filter(s => s.targets.length).length} aktiviteter färgade (grön = lugnt, röd = trångt).`;
    } catch (e) { console.warn(e); msg.textContent = "Kunde inte färga: " + ((e && e.message) || e); }
  };
}

/* ============ 10. Logistik ============ */
function labTabLogi(b, acts) {
  const st = lab.state.logi = lab.state.logi || { lead: 3, win: 14 }, q = labQtyByKey(), dl = typeof deliveries !== "undefined" ? deliveries : [], today = labToday();
  const need = acts.filter(a => !(a.st === "klar" || a.p >= 100) && a.e >= today).map(a => ({ a, by: labAdd(a.s, -st.lead) })).sort((x, y) => x.by.localeCompare(y.by));
  const match = n => dl.filter(d => { const dt = d.actual_date || d.planned_date; return dt && (!d.area || !n.a.area || String(d.area).toLowerCase() === n.a.area.toLowerCase()) && dt <= n.by && dt >= labAdd(n.by, -st.win); });
  const rows = need.map(n => { const m = match(n), later = dl.filter(d => { const dt = d.actual_date || d.planned_date; return dt && dt > n.by && dt <= labAdd(n.a.s, 7) && (!d.area || String(d.area).toLowerCase() === n.a.area.toLowerCase()); }); return { n, m, state: m.length ? "ok" : later.length ? "sen" : "saknas" }; });
  const cnt = s => rows.filter(r => r.state === s).length, byWeek = {};
  need.forEach(n => { const w = labAdd(n.by, -((new Date(n.by + "T00:00:00Z").getUTCDay() + 6) % 7)), e = q && q.get(n.a.key); byWeek[w] = byWeek[w] || { n: 0, v: 0 }; byWeek[w].n++; if (e) byWeek[w].v += e.vol; });
  const spaceBy = {}; dl.forEach(d => { const dt = d.planned_date || d.actual_date; if (!dt) return; const w = labAdd(dt, -((new Date(dt + "T00:00:00Z").getUTCDay() + 6) % 7)); spaceBy[w] = (spaceBy[w] || 0) + (Number(d.space_m2) || 0); });
  const ws = [...new Set([...Object.keys(byWeek), ...Object.keys(spaceBy)])].sort();
  b.innerHTML = `<p class="hint">Räknar baklänges från byggordningen: allt ska finnas på plats ${st.lead} dagar före montagestart. En leverans räknas som matchande om den gäller samma område och ligger inom ${st.win} dagar före behovet.</p>
    <div class="lab-row"><label>Ledtid före start (dagar) <input id="labLead" type="number" min="0" max="60" value="${st.lead}" style="width:60px"></label><label>Fönster (dagar) <input id="labWin" type="number" min="1" max="90" value="${st.win}" style="width:60px"></label>
    <b class="ok">${cnt("ok")} täckta</b> <b class="warn">${cnt("sen")} för sena</b> <b class="bad">${cnt("saknas")} saknar leverans</b></div>
    <h4>Behov och leveranser per vecka</h4><table class="lab-tbl"><tr><th>Vecka (måndag)</th><th>Aktiviteter som behöver material</th>${q ? "<th>Betong m³</th>" : ""}<th>Planerad upplagsyta (leveranser) m²</th></tr>${ws.map(w => `<tr><td>${w}</td><td>${byWeek[w] ? byWeek[w].n : ""}</td>${q ? `<td>${byWeek[w] && byWeek[w].v ? labNum(byWeek[w].v, 1) : ""}</td>` : ""}<td>${spaceBy[w] ? labNum(spaceBy[w], 0) : ""}</td></tr>`).join("")}</table>
    <h4>Behov per aktivitet</h4><table class="lab-tbl"><tr><th>Aktivitet</th><th>Område</th><th>Start</th><th>Ska vara på plats</th><th>Läge</th></tr>${rows.slice(0, 120).map(r => `<tr><td>${labEsc(r.n.a.name)}</td><td>${labEsc(r.n.a.area)}</td><td>${r.n.a.s}</td><td>${r.n.by}</td><td class="${r.state === "ok" ? "ok" : r.state === "sen" ? "warn" : "bad"}">${r.state === "ok" ? "✔ " + labEsc(String(r.m[0].description || r.m[0].supplier || "leverans")).slice(0, 30) : r.state === "sen" ? "⚠ leverans finns men för sent" : "✖ ingen leverans planerad"}</td></tr>`).join("")}</table>`;
  b.querySelector("#labLead").onchange = e => { st.lead = Math.max(0, Number(e.target.value) || 0); labTabLogi(b, acts); };
  b.querySelector("#labWin").onchange = e => { st.win = Math.max(1, Number(e.target.value) || 14); labTabLogi(b, acts); };
}
Object.assign(window, { labTabForecast, labTabQtyTime, labTabPlace, labTabCrowd, labTabLogi });
