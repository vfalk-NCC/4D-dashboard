/* Resurskurva (Victors önskemål 2026-10-08): staplar per vecka med personer eller timmar per resurs,
   under Gantt-schemat. Bygger på resurserna per aktivitet (plan_items.resources – från
   Powerproject-importen eller "Avancerat (resurser)" i Redigera aktivitet).
   - Följer filtren, sökningen och de dolda områdena i Gantt-schemat, och Gantt-schemats period
     (Visa från/till) om en sådan är vald.
   - En aktivitet med flera 3D-objekt räknas en gång.
   - Timmarna fördelas jämnt över arbetsdagarna (mån–fre) i resursens period (eller aktivitetens,
     om aktiviteten flyttats så att resursens period inte längre ligger inom den).
     Personer per vecka = antal × andelen av veckans arbetsdagar som resursen är på plats.
   - Färgen följer resursen (de 7 största i hela planen får egna färger, resten "Övriga"), inte
     placeringen i det filtrerade urvalet. */
const RC_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7"];
const RC_OTHER = "#9ca3af", RC_OTHER_NAME = "Övriga";
const RC_PREFS_KEY = "4ddash-rescurve";
let rcPrefs = { mode: "people", only: "", table: false, by: "resource" };
try { rcPrefs = { ...rcPrefs, ...(JSON.parse(localStorage.getItem(RC_PREFS_KEY) || "{}") || {}) }; } catch (e) {}
const rcSave = () => { try { localStorage.setItem(RC_PREFS_KEY, JSON.stringify(rcPrefs)); } catch (e) {} };

const rcDay = iso => Math.floor(Date.parse(iso + "T00:00:00Z") / 86400000);   // dagnummer (UTC)
const rcIso = d => new Date(d * 86400000).toISOString().slice(0, 10);
const rcDow = d => (new Date(d * 86400000).getUTCDay() + 6) % 7;              // 0 = måndag
const rcWork = d => rcDow(d) < 5;
function rcWeekNo(d) { const t = new Date(d * 86400000); const th = new Date(t); th.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); const y0 = new Date(Date.UTC(th.getUTCFullYear(), 0, 4)); return 1 + Math.round(((th - y0) / 86400000 - 3 + ((y0.getUTCDay() + 6) % 7)) / 7); }

/* Aktiviteterna (en per aktivitet) med resurser, efter filter/sök/dolda. */
function rcActivities() {
  let list = typeof getFilteredItems === "function" ? getFilteredItems() : items;
  if (typeof ganttWithoutHidden === "function") list = ganttWithoutHidden(list);
  if (typeof ganttSearch !== "undefined" && ganttSearch && typeof ganttSearchMatch === "function") list = list.filter(ganttSearchMatch);
  const seen = new Set(), out = [];
  list.forEach(it => {
    if (!it.resources || !it.resources.length || !it.startDate || !it.endDate) return;
    const k = it.activityKey || `id:${it.id}`;
    if (seen.has(k)) return;
    seen.add(k); out.push(it);
  });
  return out;
}
/* Vad staplarna delas upp efter (Victor 2026-10-08): resurs, entreprenör eller område. */
const RC_BY = { resource: "Resurs", contractor: "Entreprenör", area: "Område", activity: "Aktivitet" };
const rcBy = () => (rcPrefs.by in RC_BY ? rcPrefs.by : "resource");
const rcNone = by => by === "contractor" ? (typeof NO_CONTRACTOR_LABEL !== "undefined" ? NO_CONTRACTOR_LABEL : "Utan entreprenör") : (typeof NO_AREA_LABEL !== "undefined" ? NO_AREA_LABEL : "Utan område");
const rcKeyOf = (it, r, by) => by === "resource" ? r.name : by === "activity" ? (typeof itemLabel === "function" ? itemLabel(it) : it.objectName || "?") : (it[by] || rcNone(by));
/* Fasta färger efter timmar i hela planen (inte urvalet – färgen följer serien, inte placeringen).
   Resurs: de 7 största får standardpalettens färger. Entreprenör/område: samma färger som lapparna på
   tavlan (även egna valda färger), de 11 största – resten blir Övriga. */
function rcColorMap() {
  const by = rcBy(), tot = new Map(), seen = new Set();
  items.forEach(it => { const k = it.activityKey || `id:${it.id}`; if (seen.has(k) || !it.resources) return; seen.add(k); it.resources.forEach(r => { const s = rcKeyOf(it, r, by); tot.set(s, (tot.get(s) || 0) + (Number(r.hours) || 0)); }); });
  const own = by === "resource" || by === "activity"; // egna färger ur paletten (inga tavelfärger)
  const n = own ? RC_COLORS.length : 11;
  const top = [...tot].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k).sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
  if (own) return new Map(top.map((k, i) => [k, RC_COLORS[i]]));
  // Tavlans färg, men aldrig samma färg på två serier: krockar får nästa lediga färg i tavlans palett.
  const used = new Set(), pal = typeof SOFT_PALETTE !== "undefined" ? SOFT_PALETTE.map(p => p.bd) : RC_COLORS;
  return new Map(top.map(k => {
    let c = typeof softColor === "function" ? softColor(by, k).bd : RC_COLORS[top.indexOf(k) % RC_COLORS.length];
    if (used.has(c)) c = pal.find(x => !used.has(x) && x !== RC_OTHER) || c;
    used.add(c);
    return [k, c];
  }));
}
/* Veckovärden: Map(veckans måndag -> Map(serie -> värde)), serie = resurs eller "Övriga". */
/* Personer (Victor 2026-10-08: "jag förstår inte riktigt" – ett snitt som 0,4 pers. var svårt att tyda):
   för varje dag räknas hur många som är på plats; veckans stapel = den dag med flest (och dess
   fördelning per resurs). Timmar: veckans summa. */
function rcCompute(acts, colors, mode, d0, d1) {
  const weeks = new Map(), daysMap = new Map();
  const add = (wk, s, v) => { if (!weeks.has(wk)) weeks.set(wk, new Map()); const m = weeks.get(wk); m.set(s, (m.get(s) || 0) + v); };
  const addDay = (d, s, v) => { if (!daysMap.has(d)) daysMap.set(d, new Map()); const m = daysMap.get(d); m.set(s, (m.get(s) || 0) + v); };
  acts.forEach(it => {
    const a0 = rcDay(it.startDate), a1 = rcDay(it.endDate);
    it.resources.forEach(r => {
      let p0 = r.start ? rcDay(r.start) : a0, p1 = r.end ? rcDay(r.end) : a1;
      if (!(p0 >= a0 && p1 <= a1 && p0 <= p1)) { p0 = a0; p1 = a1; } // aktiviteten flyttad: följ den
      const days = []; for (let d = p0; d <= p1; d++) if (rcWork(d)) days.push(d);
      if (!days.length) for (let d = p0; d <= p1; d++) days.push(d);
      const key = rcKeyOf(it, r, rcBy()), s = colors.has(key) ? key : RC_OTHER_NAME;
      if (rcPrefs.only && key !== rcPrefs.only && s !== rcPrefs.only) return;
      const hPerDay = (Number(r.hours) || 0) / days.length, qty = Number(r.qty) || 0;
      days.forEach(d => {
        if (d < d0 || d > d1) return;
        if (mode === "hours") add(d - rcDow(d), s, hPerDay); else addDay(d, s, qty);
      });
    });
  });
  if (mode !== "hours") daysMap.forEach((m, d) => {
    const wk = d - rcDow(d), tot = [...m.values()].reduce((a, v) => a + v, 0);
    const cur = weeks.get(wk), curTot = cur ? [...cur.values()].reduce((a, v) => a + v, 0) : -1;
    if (tot > curTot) weeks.set(wk, new Map(m));
  });
  return weeks;
}
/* Sammanfattning (Victor 2026-10-08: "idiotsäkrat och jättelätt att förstå hur många arbetare och
   timmar per akt, område osv."): per vald indelning – personer samtidigt (högsta antalet samma dag),
   timmar och antal aktiviteter i perioden. Alla, inte bara de med egen färg. */
function rcSummary(acts, d0, d1) {
  const by = rcBy(), rows = new Map(), allDays = new Map();
  acts.forEach(it => {
    const a0 = rcDay(it.startDate), a1 = rcDay(it.endDate);
    it.resources.forEach(r => {
      let p0 = r.start ? rcDay(r.start) : a0, p1 = r.end ? rcDay(r.end) : a1;
      if (!(p0 >= a0 && p1 <= a1 && p0 <= p1)) { p0 = a0; p1 = a1; }
      const days = []; for (let d = p0; d <= p1; d++) if (rcWork(d)) days.push(d);
      if (!days.length) for (let d = p0; d <= p1; d++) days.push(d);
      const key = rcKeyOf(it, r, by), hPerDay = (Number(r.hours) || 0) / days.length, qty = Number(r.qty) || 0;
      if (!rows.has(key)) rows.set(key, { key, hours: 0, days: new Map(), acts: new Set(), first: null, last: null });
      const row = rows.get(key);
      let used = false;
      days.forEach(d => {
        if (d < d0 || d > d1) return;
        used = true;
        row.hours += hPerDay;
        row.days.set(d, (row.days.get(d) || 0) + qty);
        allDays.set(d, (allDays.get(d) || 0) + qty);
        if (row.first === null || d < row.first) row.first = d;
        if (row.last === null || d > row.last) row.last = d;
      });
      if (used) row.acts.add(it.activityKey || it.id);
    });
  });
  const list = [...rows.values()].filter(r => r.acts.size).map(r => ({ ...r, max: Math.max(0, ...r.days.values()) })).sort((a, b) => b.hours - a.hours);
  return { list, max: Math.max(0, ...allDays.values()), hours: list.reduce((a, r) => a + r.hours, 0), acts: new Set(acts.map(it => it.activityKey || it.id)).size };
}
function rcSummaryHtml(sum, colorOf) {
  if (!sum.list.length) return "";
  const n1 = v => (Math.round(v * 10) / 10).toLocaleString("sv-SE"), h = v => Math.round(v).toLocaleString("sv-SE");
  const shortDate = d => { const x = new Date(d * 86400000); return `${x.getUTCDate()}/${x.getUTCMonth() + 1}`; };
  const shown = sum.list.slice(0, 40);
  return `<div class="rc-sum"><table class="rc-sumtab"><thead><tr><th>${RC_BY[rcBy()]}</th><th title="Högsta antalet personer/maskiner på plats samma dag">Personer samtidigt (max)</th><th>Timmar</th><th>Aktiviteter</th><th>Period</th></tr></thead><tbody>
    ${shown.map(r => `<tr><td><i style="background:${colorOf(r.key)}"></i>${escapeHtml(r.key)}</td><td><b>${n1(r.max)}</b></td><td>${h(r.hours)} h</td><td>${r.acts.size}</td><td>${shortDate(r.first)} – ${shortDate(r.last)}</td></tr>`).join("")}
    ${sum.list.length > shown.length ? `<tr><td colspan="5" class="rc-dim">+ ${sum.list.length - shown.length} till</td></tr>` : ""}
    </tbody><tfoot><tr><td>Totalt</td><td><b>${n1(sum.max)}</b></td><td><b>${h(sum.hours)} h</b></td><td>${sum.acts}</td><td></td></tr></tfoot></table>
    <div class="hint">Personer samtidigt = flest på plats samma dag. Totalt räknar alla tillsammans (samma dag), inte summan av raderna.</div></div>`;
}
function renderResourceCurve() {
  const el = document.getElementById("resourceCurve");
  if (!el || typeof items === "undefined") return;
  const acts = rcActivities(), colors = rcColorMap(), mode = rcPrefs.mode === "hours" ? "hours" : "people";
  const anyRes = items.some(it => it.resources && it.resources.length);
  const ctrl = `<div class="rc-ctrl"><label class="rc-by">Per <select class="rc-bysel">${Object.entries(RC_BY).map(([k, v]) => `<option value="${k}"${rcBy() === k ? " selected" : ""}>${v}</option>`).join("")}</select></label><div class="rc-seg" role="tablist"><button type="button" data-rc-mode="people" class="${mode === "people" ? "on" : ""}" title="Hur många som är på plats samma dag – den dag i veckan med flest">Personer</button><button type="button" data-rc-mode="hours" class="${mode === "hours" ? "on" : ""}" title="Arbetstimmar den veckan">Timmar</button></div>
    <span class="rc-note">${mode === "hours" ? "Arbetstimmar per vecka" : "Personer på plats – högsta antalet samma dag i veckan"} · ${acts.length} aktivitet${acts.length === 1 ? "" : "er"} med resurser · följer filter, sök och dolda områden</span>
    <button type="button" class="rc-tablebtn">${rcPrefs.table ? "Visa diagram" : "Visa tabell"}</button></div>`;
  if (!anyRes) { el.innerHTML = `<div class="hint">Inga resurser inlagda ännu. Importera Powerproject-tidplanen (resurserna följer med) eller lägg in dem under <b>Avancerat (resurser)</b> när du redigerar en aktivitet.</div>`; return; }
  // Perioden: Gantt-schemats valda period, annars resursernas.
  let d0 = Infinity, d1 = -Infinity;
  acts.forEach(it => { d0 = Math.min(d0, rcDay(it.startDate)); d1 = Math.max(d1, rcDay(it.endDate)); });
  if (typeof ganttRangeStart !== "undefined" && ganttRangeStart) d0 = rcDay(ganttRangeStart);
  if (typeof ganttRangeEnd !== "undefined" && ganttRangeEnd) d1 = rcDay(ganttRangeEnd);
  if (!acts.length || !isFinite(d0) || d1 < d0) { el.innerHTML = ctrl + `<div class="hint">Inga aktiviteter med resurser i urvalet.</div>`; rcBind(el); return; }
  d0 -= rcDow(d0); // från en måndag
  const weeks = rcCompute(acts, colors, mode, d0, d1);
  const wkList = []; for (let w = d0; w <= d1; w += 7) wkList.push(w);
  const series = [...colors.keys(), RC_OTHER_NAME].filter(s => wkList.some(w => (weeks.get(w) || new Map()).get(s)));
  const colorOf = s => colors.get(s) || RC_OTHER;
  const totals = new Map(series.map(s => [s, wkList.reduce((a, w) => a + ((weeks.get(w) || new Map()).get(s) || 0), 0)]));
  const fmt = v => mode === "hours" ? `${Math.round(v).toLocaleString("sv-SE")} h` : `${(Math.round(v * 10) / 10).toLocaleString("sv-SE")} pers.`;
  const legend = `<div class="rc-legend">${series.map(s => `<button type="button" class="rc-chip${rcPrefs.only === s ? " on" : ""}" data-rc-only="${escapeHtml(s)}" title="${rcPrefs.only === s ? "Visa alla" : "Visa bara den här"}"><i style="background:${colorOf(s)}"></i>${escapeHtml(s)} <span>${mode === "hours" ? fmt(totals.get(s)) : "max " + fmt(Math.max(...wkList.map(w => (weeks.get(w) || new Map()).get(s) || 0)))}</span></button>`).join("")}${rcPrefs.only ? `<button type="button" class="rc-all" data-rc-only="">Visa alla</button>` : ""}</div>`;
  if (rcPrefs.table) {
    el.innerHTML = ctrl + legend + `<div class="rc-tablewrap"><table class="rc-table"><thead><tr><th>Vecka</th>${series.map(s => `<th>${escapeHtml(s)}</th>`).join("")}<th>Totalt</th></tr></thead><tbody>${wkList.map(w => {
      const m = weeks.get(w) || new Map(), tot = series.reduce((a, s) => a + (m.get(s) || 0), 0);
      return `<tr><td>v.${rcWeekNo(w)} <span>${rcIso(w)}</span></td>${series.map(s => `<td>${m.get(s) ? fmt(m.get(s)).replace(/ (h|pers\.)$/, "") : ""}</td>`).join("")}<td><b>${tot ? fmt(tot).replace(/ (h|pers\.)$/, "") : ""}</b></td></tr>`;
    }).join("")}</tbody></table></div>` + rcSummaryHtml(rcSummary(acts, d0, d1), colorOf);
    rcBind(el); return;
  }
  // Staplade staplar per vecka (SVG). Bredd efter panelen, minst 12 px per vecka (annars rullning i sidled).
  const H = 230, padL = 46, padB = 26, padT = 10;
  const avail = Math.max(300, (el.clientWidth || 900) - 4);
  const bw = Math.max(12, Math.min(48, (avail - padL - 8) / wkList.length));
  const W = padL + bw * wkList.length + 8;
  const sums = wkList.map(w => series.reduce((a, s) => a + ((weeks.get(w) || new Map()).get(s) || 0), 0));
  const max = Math.max(1, ...sums);
  const step = (() => { const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map(f => f * p).find(v => v >= raw) || raw; })();
  const top = Math.ceil(max / step) * step, y = v => padT + (H - padT - padB) * (1 - v / top);
  const grid = []; for (let v = 0; v <= top + 1e-9; v += step) grid.push(`<line x1="${padL}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" class="rc-grid"/><text x="${padL - 6}" y="${y(v) + 3.5}" class="rc-ytick">${mode === "hours" ? Math.round(v).toLocaleString("sv-SE") : Math.round(v * 10) / 10}</text>`);
  const labEvery = Math.max(1, Math.ceil(28 / bw));
  const today = rcDay(new Date().toISOString().slice(0, 10)), todayW = today - rcDow(today);
  const bars = wkList.map((w, i) => {
    const m = weeks.get(w) || new Map(), x = padL + i * bw;
    let acc = 0;
    const segs = series.map(s => { const v = m.get(s) || 0; if (!v) return ""; const y1 = y(acc), y2 = y(acc + v); acc += v; const h = Math.max(0, y1 - y2 - (acc < sums[i] - 1e-9 ? 2 : 0)); return h > 0 ? `<rect x="${x + 1.5}" y="${y2}" width="${Math.max(1, bw - 3)}" height="${h}" fill="${colorOf(s)}" rx="${acc >= sums[i] - 1e-9 ? 3 : 0}"/>` : ""; }).join("");
    const lab = i % labEvery === 0 ? `<text x="${x + bw / 2}" y="${H - padB + 14}" class="rc-xtick${w === todayW ? " now" : ""}">v.${rcWeekNo(w)}</text>` : "";
    return `<g>${segs}</g>${lab}<rect class="rc-hit" x="${x}" y="${padT}" width="${bw}" height="${H - padT - padB}" data-i="${i}"/>`;
  }).join("");
  const nowLine = todayW >= wkList[0] && todayW <= wkList[wkList.length - 1] ? `<line class="rc-now" x1="${padL + ((todayW - wkList[0]) / 7 + (rcDow(today) + 0.5) / 7) * bw}" x2="${padL + ((todayW - wkList[0]) / 7 + (rcDow(today) + 0.5) / 7) * bw}" y1="${padT}" y2="${H - padB}"/>` : "";
  el.innerHTML = ctrl + legend + `<div class="rc-scroll"><svg class="rc-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Resurskurva per vecka">${grid.join("")}<line x1="${padL}" x2="${W - 4}" y1="${y(0)}" y2="${y(0)}" class="rc-base"/>${bars}${nowLine}</svg><div class="rc-tip" hidden></div></div>` + rcSummaryHtml(rcSummary(acts, d0, d1), colorOf);
  rcBind(el);
  // Tooltip per vecka.
  const tip = el.querySelector(".rc-tip"), sc = el.querySelector(".rc-scroll");
  el.querySelectorAll(".rc-hit").forEach(h => {
    h.addEventListener("mouseenter", () => {
      const i = Number(h.dataset.i), w = wkList[i], m = weeks.get(w) || new Map();
      const rows = series.filter(s => m.get(s)).sort((a, b) => m.get(b) - m.get(a));
      tip.innerHTML = `<b>v.${rcWeekNo(w)}</b> <span class="rc-dim">${rcIso(w)} – ${rcIso(w + 6)}</span><div class="rc-tot">${fmt(sums[i])} <span class="rc-dim">${mode === "hours" ? "den här veckan" : "på plats samma dag (mest i veckan)"}</span></div>${rows.map(s => `<div class="rc-row"><i style="background:${colorOf(s)}"></i><span>${escapeHtml(s)}</span><b>${fmt(m.get(s))}</b></div>`).join("") || `<div class="rc-dim">Inget planerat</div>`}`;
      tip.hidden = false;
      const x = padL + i * bw + bw + 8 - sc.scrollLeft;
      tip.style.left = `${Math.min(x, sc.clientWidth - 240)}px`; tip.style.top = "8px";
      h.classList.add("on");
    });
    h.addEventListener("mouseleave", () => { tip.hidden = true; h.classList.remove("on"); });
  });
}
function rcBind(el) {
  el.querySelectorAll("[data-rc-mode]").forEach(b => { b.onclick = () => { rcPrefs.mode = b.dataset.rcMode; rcSave(); renderResourceCurve(); }; });
  el.querySelectorAll("[data-rc-only]").forEach(b => { b.onclick = () => { rcPrefs.only = rcPrefs.only === b.dataset.rcOnly ? "" : b.dataset.rcOnly; rcSave(); renderResourceCurve(); }; });
  const bs = el.querySelector(".rc-bysel"); if (bs) bs.onchange = () => { rcPrefs.by = bs.value; rcPrefs.only = ""; rcSave(); renderResourceCurve(); };
  const t = el.querySelector(".rc-tablebtn"); if (t) t.onclick = () => { rcPrefs.table = !rcPrefs.table; rcSave(); renderResourceCurve(); };
}
window.addEventListener("resize", () => { clearTimeout(window._rcT); window._rcT = setTimeout(renderResourceCurve, 200); });
