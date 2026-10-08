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
let rcPrefs = { mode: "people", only: "", table: false };
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
/* Fasta färger: de 7 största resurserna (timmar) i hela planen. */
function rcColorMap() {
  const tot = new Map();
  const seen = new Set();
  items.forEach(it => { const k = it.activityKey || `id:${it.id}`; if (seen.has(k) || !it.resources) return; seen.add(k); it.resources.forEach(r => tot.set(r.name, (tot.get(r.name) || 0) + (Number(r.hours) || 0))); });
  const top = [...tot].sort((a, b) => b[1] - a[1]).slice(0, RC_COLORS.length).map(([n]) => n).sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
  return new Map(top.map((n, i) => [n, RC_COLORS[i]]));
}
/* Veckovärden: Map(veckans måndag -> Map(serie -> värde)), serie = resurs eller "Övriga". */
function rcCompute(acts, colors, mode, d0, d1) {
  const weeks = new Map();
  const add = (wk, s, v) => { if (!weeks.has(wk)) weeks.set(wk, new Map()); const m = weeks.get(wk); m.set(s, (m.get(s) || 0) + v); };
  acts.forEach(it => {
    const a0 = rcDay(it.startDate), a1 = rcDay(it.endDate);
    it.resources.forEach(r => {
      let p0 = r.start ? rcDay(r.start) : a0, p1 = r.end ? rcDay(r.end) : a1;
      if (!(p0 >= a0 && p1 <= a1 && p0 <= p1)) { p0 = a0; p1 = a1; } // aktiviteten flyttad: följ den
      const days = []; for (let d = p0; d <= p1; d++) if (rcWork(d)) days.push(d);
      if (!days.length) for (let d = p0; d <= p1; d++) days.push(d);
      const s = colors.has(r.name) ? r.name : RC_OTHER_NAME;
      if (rcPrefs.only && r.name !== rcPrefs.only && s !== rcPrefs.only) return;
      const hPerDay = (Number(r.hours) || 0) / days.length, qty = Number(r.qty) || 0;
      days.forEach(d => {
        if (d < d0 || d > d1) return;
        const wk = d - rcDow(d);
        add(wk, s, mode === "hours" ? hPerDay : qty / 5);
      });
    });
  });
  return weeks;
}
function renderResourceCurve() {
  const el = document.getElementById("resourceCurve");
  if (!el || typeof items === "undefined") return;
  const acts = rcActivities(), colors = rcColorMap(), mode = rcPrefs.mode === "hours" ? "hours" : "people";
  const anyRes = items.some(it => it.resources && it.resources.length);
  const ctrl = `<div class="rc-ctrl"><div class="rc-seg" role="tablist"><button type="button" data-rc-mode="people" class="${mode === "people" ? "on" : ""}">Personer</button><button type="button" data-rc-mode="hours" class="${mode === "hours" ? "on" : ""}">Timmar</button></div>
    <span class="rc-note">${acts.length} aktivitet${acts.length === 1 ? "" : "er"} med resurser · följer filter, sök och dolda områden</span>
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
    }).join("")}</tbody></table></div>`;
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
  el.innerHTML = ctrl + legend + `<div class="rc-scroll"><svg class="rc-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Resurskurva per vecka">${grid.join("")}<line x1="${padL}" x2="${W - 4}" y1="${y(0)}" y2="${y(0)}" class="rc-base"/>${bars}${nowLine}</svg><div class="rc-tip" hidden></div></div>`;
  rcBind(el);
  // Tooltip per vecka.
  const tip = el.querySelector(".rc-tip"), sc = el.querySelector(".rc-scroll");
  el.querySelectorAll(".rc-hit").forEach(h => {
    h.addEventListener("mouseenter", () => {
      const i = Number(h.dataset.i), w = wkList[i], m = weeks.get(w) || new Map();
      const rows = series.filter(s => m.get(s)).sort((a, b) => m.get(b) - m.get(a));
      tip.innerHTML = `<b>v.${rcWeekNo(w)}</b> <span class="rc-dim">${rcIso(w)} – ${rcIso(w + 6)}</span><div class="rc-tot">${fmt(sums[i])}</div>${rows.map(s => `<div class="rc-row"><i style="background:${colorOf(s)}"></i><span>${escapeHtml(s)}</span><b>${fmt(m.get(s))}</b></div>`).join("") || `<div class="rc-dim">Inget planerat</div>`}`;
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
  const t = el.querySelector(".rc-tablebtn"); if (t) t.onclick = () => { rcPrefs.table = !rcPrefs.table; rcSave(); renderResourceCurve(); };
}
window.addEventListener("resize", () => { clearTimeout(window._rcT); window._rcT = setTimeout(renderResourceCurve, 200); });
