/* Tidslinjen i Gantt-schemat (Staplar) – portad ur Planeringskoll 4D (Victor 2026-10-20) och inkopplad på dashboardens egna data.
   En rad per AKTIVITET (objekt i samma aktivitet slås ihop – inte en rad per 3D-objekt). Lapparna (Tavla) är oförändrade.
   Det här ersätter de gamla staplarna; de gamla finns kvar som reserv (Visning → "Ny tidslinje" av). Utskriften använder fortfarande den gamla vyn.
   Det som kommer från Planeringskoll: datumhuvud med månad/vecka/dag, grupper som kan fällas, framdrift med "så långt borde den vara",
   kritisk väg, kedja framåt/bakåt, beroendepilar, översiktskarta, mätning av dagar, snabbval/zoom, kortkommandon och bilder per aktivitet.
   Det som är kvar från dashboarden: dra för att flytta/ändra (redigerbart läge, med Ångra), dubbelklick = redigera, klick på namnet = markera i 3D,
   Ctrl-klick = flerval, baslinjer, tidslinjens datumstreck, filter, sök, gruppering, färg efter och zoom. */
const TL = { sel: null, hl: [], chain: null, m: [], crit: false, behind: false, last: null, order: [], rows: [], by: {}, active: false, imgRef: null, lb: { ref: null, i: 0 }, list: null, el: null, raf: 0, lastClick: { id: null, t: 0 } };
try { TL.crit = localStorage.getItem("4ddash-tl-crit") === "1"; } catch (e) { /* ingen lagring */ }
let ganttClassic = false;
try { ganttClassic = localStorage.getItem("4ddash-gantt-classic") === "1"; } catch (e) { /* ingen lagring */ }

const tlEsc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tlDay = s => { const p = String(s).split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5; };
const tlIso = d => new Date(d * 864e5).toISOString().slice(0, 10);
const tlShort = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const tlSg = n => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n);
const TL_WD = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"], TL_MN = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const tlFmtDay = d => { const t = new Date(d * 864e5); return TL_WD[t.getUTCDay()] + " " + t.getUTCDate() + " " + TL_MN[t.getUTCMonth()] + " " + t.getUTCFullYear(); };
const tlIsoWeek = d => { const t = new Date(d * 864e5); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); const y0 = Date.UTC(t.getUTCFullYear(), 0, 1); return Math.ceil(((t - y0) / 864e5 + 1) / 7); };
const tlToday = () => (typeof ganttMode !== "undefined" && ganttMode === "time" && ganttAsOf) ? ganttAsOf : todayISO();
const tlOn = () => typeof ganttView !== "undefined" && ganttView === "bars" && !ganttClassic;
const tlQ = (root, sel) => root.querySelector(sel);

/* ---- Data: aktiviteter (en rad per aktivitet) -------------------------------------------------------------------------------------------------- */
function tlModel(acts) {
  const rows = acts.map(a => {
    const members = a.members || [a], bl = typeof blOf === "function" ? blOf(a) : null, bl2 = typeof blOf === "function" && ganttBaseline2Id ? blOf(a, ganttBaseline2Id) : null;
    return { key: String(a.id), it: a, members, name: itemLabel(a), s: tlDay(a.startDate), e: tlDay(a.endDate), status: a.status || "planerad", pct: Math.max(0, Math.min(100, Number(a.progress) || 0)),
      contr: a.contractor || "", area: a.area || "", ms: /^milstolpe$/i.test(a.activity || ""), preds: [], imgKey: (typeof projectId !== "undefined" && projectId ? projectId : "_") + "|" + (a.activityKey || String(a.id)),
      bs: bl ? tlDay(bl[0]) : undefined, be: bl ? tlDay(bl[1]) : undefined, b2s: bl2 ? tlDay(bl2[0]) : undefined, b2e: bl2 ? tlDay(bl2[1]) : undefined };
  });
  const idRow = new Map(); rows.forEach(r => r.members.forEach(m => idRow.set(String(m.id), r.key)));
  rows.forEach(r => {
    const seen = new Map();
    r.members.forEach(m => (m.dependsOn || []).forEach(pid => { const pk = idRow.get(String(pid)); if (!pk || pk === r.key) return; const lag = typeof lagOf === "function" ? lagOf(m, pid) : undefined; if (!seen.has(pk) || lag !== undefined) seen.set(pk, lag || 0); }));
    r.preds = [...seen.entries()].map(([ref, lag]) => ({ ref, lag }));
  });
  return rows;
}
/* Kritisk väg: marginal = minsta glapp längs kedjan fram till slutdatumet (överlapp räknas som 0). */
function tlCritPath(rows) {
  const by = {}, succ = {}; rows.forEach(r => { by[r.key] = r; delete r.flt; delete r.crit; });
  rows.forEach(r => r.preds.forEach(p => { if (by[p.ref]) (succ[p.ref] = succ[p.ref] || []).push({ r, lag: p.lag }); }));
  const end = Math.max(...rows.map(r => r.e)), TF = {}, vis = {}; let any = false;
  const tf = r => {
    if (TF[r.key] !== undefined) return TF[r.key];
    if (vis[r.key]) return end - r.e;
    vis[r.key] = 1; let v = end - r.e;
    (succ[r.key] || []).forEach(x => { any = true; const c = tf(x.r) + Math.max(0, x.r.s - x.lag - r.e); if (c < v) v = c; });
    vis[r.key] = 0; return (TF[r.key] = v);
  };
  rows.forEach(r => { r.flt = tf(r); });
  rows.forEach(r => { if (r.status !== "klar" && r.flt <= 0 && (r.preds.length || (succ[r.key] || []).length)) r.crit = true; });
  return any;
}
function tlChainOf(ref, dir, rows) {
  const nx = {}, by = {}; rows.forEach(r => { by[r.key] = r; });
  rows.forEach(r => r.preds.forEach(p => { if (by[p.ref]) { if (dir === "fw") (nx[p.ref] = nx[p.ref] || []).push(r.key); else (nx[r.key] = nx[r.key] || []).push(p.ref); } }));
  const seen = { [ref]: 1 }, st = [ref];
  while (st.length) { const x = st.pop(); (nx[x] || []).forEach(y => { if (!seen[y]) { seen[y] = 1; st.push(y); } }); }
  return seen;
}
function tlPace(r, T) {
  if (r.ms || r.status === "klar") return { pp: null, dv: 0, late: false, ahead: false };
  const pp = Math.max(0, Math.min(100, (T - r.s + 1) / (r.e - r.s + 1) * 100)), dv = r.pct - pp;
  return { pp, dv, late: pp > 0 && dv < -15, ahead: r.pct > 0 && dv > 15 && r.pct < 100 };
}
const tlPhase = (r, T) => (typeof ganttMode !== "undefined" && ganttMode === "time" && ganttAsOf && typeof ganttPhaseAt === "function") ? ganttPhaseAt(r.it, ganttAsOf) : r.status;

/* ---- Rendering ----------------------------------------------------------------------------------------------------------------------------------------- */
function tlRender(list, el) {
  if (!el) return false;
  const old = tlQ(el, ".tl-wrap"), sl = old ? old.scrollLeft : 0, st = old ? old.scrollTop : 0;
  TL.el = el; TL.list = list; tlWire(el);
  const withDates = list.filter(it => it.startDate && it.endDate);
  el.className = "gantt-chart tl";
  if (typeof ganttScrubInfo !== "undefined") ganttScrubInfo = null;
  if (!withDates.length) { el.innerHTML = `<div class="hint">${isBackendConfigured() ? "Inga objekt med både start- och slutdatum att visa ännu." : emptyMessage()}</div>`; if (typeof ganttInRangeItems !== "undefined") ganttInRangeItems = []; return true; }
  let acts = mergeActivityGroups(withDates);
  let a0, a1;
  const hasRange = !!(ganttRangeStart && ganttRangeEnd);
  const allRows = tlModel(acts);
  const chainSet = TL.chain && allRows.find(r => r.key === TL.chain.ref) ? tlChainOf(TL.chain.ref, TL.chain.dir, allRows) : null;
  if (TL.chain && !chainSet) TL.chain = null;
  const ghostOn = !!ganttShowBaseline;
  if (hasRange) { a0 = tlDay(ganttRangeStart); a1 = tlDay(ganttRangeEnd); }
  else { a0 = Math.min(...allRows.map(r => ghostOn && r.bs !== undefined ? Math.min(r.s, r.bs) : r.s)); a1 = Math.max(...allRows.map(r => ghostOn && r.be !== undefined ? Math.max(r.e, r.be) : r.e)); }
  const T = tlDay(tlToday());
  let rows = allRows.filter(r => r.s <= a1 && r.e >= a0);
  const skipped = allRows.length - rows.length;
  if (typeof ganttInRangeItems !== "undefined") ganttInRangeItems = rows.flatMap(r => r.members);
  if (chainSet) {
    // Kedjan visas över filtren (hela vägen), med datumspannet för kedjans aktiviteter.
    rows = allRows.filter(r => chainSet[r.key]);
    a0 = Math.min(...rows.map(r => r.s)); a1 = Math.max(...rows.map(r => r.e));
  } else if (TL.behind) rows = rows.filter(r => tlPace(r, T).late);
  const cmp = typeof ganttComparator === "function" ? ganttComparator(ganttSortBy) : (a, b) => String(a.it.startDate).localeCompare(String(b.it.startDate));
  rows.sort((a, b) => cmp(a.it, b.it) || a.s - b.s || a.e - b.e);
  TL.rows = rows; TL.by = {}; allRows.forEach(r => { TL.by[r.key] = r; }); TL.order = [];
  const critAny = tlCritPath(allRows), critOn = TL.crit && critAny;
  if (!rows.length) { el.innerHTML = `<div class="tl-root">${tlTools(false)}<div class="hint">${TL.behind ? "Inga aktiviteter ligger efter plan." : `Inga objekt inom ${tlIso(a0)} – ${tlIso(a1)}.`}</div></div>`; return true; }
  const LIM = 2500;
  if (rows.length > LIM) { el.innerHTML = `<div class="tl-root">${tlTools(false)}<div class="hint">Det är ${rows.length} aktiviteter, för många för en läsbar tidslinje. Välj område, entreprenör eller period.</div></div>`; return true; }
  const tot = a1 - a0 + 1, LW = window.innerWidth <= 760 ? 140 : 230, avail = Math.max(320, el.clientWidth - LW - 18);
  const ppd = ganttZoomPxPerDay === null ? Math.max(1, avail / tot) : ganttZoomPxPerDay, tw = Math.ceil(tot * ppd), X = d => (d - a0) * ppd;
  const HEAD = 44, RH = 26, GH = 24;
  // Grupper (Gruppera efter i verktygsraden)
  let groups;
  if (!ganttGroupBy) groups = [{ name: null, rows }];
  else {
    const map = new Map(); rows.forEach(r => { const k = ganttGroupKeyFor(r.it); if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
    groups = [...map.entries()].map(([name, rs]) => ({ name, rows: rs })).sort((a, b) => a.rows[0].s - b.rows[0].s);
  }
  const d0 = new Date(a0 * 864e5); let y = d0.getUTCFullYear(), mo = d0.getUTCMonth() + 1, k = 0; const step = ppd * 30 >= 44 ? 1 : (ppd * 30 >= 16 ? 3 : 6), ticks = [];
  for (; ; mo++, k++) { const t = Date.UTC(y, mo, 1) / 864e5; if (t > a1) break; if (t >= a0 && k % step === 0) { const dt = new Date(t * 864e5); ticks.push([t, TL_MN[dt.getUTCMonth()] + " " + String(dt.getUTCFullYear()).slice(2)]); } }
  let mon = a0; while (new Date(mon * 864e5).getUTCDay() !== 1) mon++;
  const wk = ppd >= 4 ? 7 * ppd : 0, wko = X(mon);
  const vis = {}; let y0 = HEAD, body = "";
  const flagged = {};
  const sc = TL.sel && TL.by[TL.sel] ? TL.by[TL.sel] : null;
  const noneFor = { area: NO_AREA_LABEL, contractor: NO_CONTRACTOR_LABEL, activity: NO_ACTIVITY_LABEL };
  groups.forEach(gr => {
    const ck = `${ganttGroupBy}:${gr.name}`, closed = gr.name !== null && ganttCollapsedGroups.has(ck);
    if (gr.name !== null) {
      const gs = Math.min(...gr.rows.map(r => r.s)), ge = Math.max(...gr.rows.map(r => r.e));
      body += `<div class="g-row g-group" data-grp="${tlEsc(ck)}" style="height:${GH}px"><div class="g-lab" title="Klicka för att fälla ihop eller visa"><b class="gl"><span class="chev">${closed ? "▸" : "▾"}</span>${tlEsc(gr.name)}</b><span class="cnt">${gr.rows.length}</span></div><div class="g-track" style="height:${GH}px"><div class="g-span" style="left:${X(gs)}px;width:${Math.max(3, (ge - gs + 1) * ppd)}px"></div></div></div>`;
      y0 += GH;
    }
    (closed ? [] : gr.rows).forEach(r => {
      vis[r.key] = y0 + RH / 2; y0 += RH; TL.order.push(r.key);
      const ph = tlPhase(r, T), pc = tlPace(r, T), stc = (STATUS_COLORS[ph] || STATUS_COLORS.planerad || "#a9bccb");
      let cls = "g-bar " + ph + (r.it.temporary ? " temp" : "") + (r.ms ? " ms" : "") + (TL.hl.includes(r.key) ? " hl" : "") + (TL.sel === r.key ? " sel" : "") + (critOn && r.crit ? " crit" : "") + (pc.late ? " pace-late" : pc.ahead ? " pace-ahead" : "") + (chainSet && r.key !== TL.chain.ref ? (TL.chain.dir === "fw" ? " cf" : " cb") : "");
      if (sc) { if (sc.preds.some(p => p.ref === r.key)) cls += " pr"; if (r.preds.some(p => p.ref === sc.key)) cls += " su"; }
      const label = r.it.members ? `${r.name} (${r.members.length} objekt)` : r.name;
      const tip = `${label} · ${r.it.startDate} till ${r.it.endDate} · ${Math.round(r.pct)} %${pc.pp !== null ? ` (borde vara ${Math.round(pc.pp)} %)` : ""} · ${ph}${r.contr ? " · " + r.contr : ""}${r.bs !== undefined ? ` · baslinje ${tlIso(r.bs)} till ${tlIso(r.be)} (start ${tlSg(r.s - r.bs)} d, slut ${tlSg(r.e - r.be)} d)` : ""}${critOn && r.crit ? " · kritisk väg" : ""}`;
      const left = X(r.s), w = Math.max(3, (r.e - r.s + 1) * ppd), sw = softColor(ganttColorBy, r.it[ganttColorBy] || noneFor[ganttColorBy] || "");
      const nImg = tlImgList(r.imgKey).length, shd = ghostOn && ganttBaselineDaysOnly && typeof baselineShiftDays === "function" ? baselineShiftDays(r.it) : null;
      body += `<div class="g-row${TL.sel === r.key ? " sel" : ""}" data-row="${tlEsc(r.key)}" style="height:${RH}px"><div class="g-lab${critOn && r.crit ? " crit" : ""}" data-item-id="${tlEsc(r.key)}" data-members="${tlEsc(r.members.map(m => m.id).join(","))}" title="${tlEsc(tip)}" style="box-shadow:inset 4px 0 0 ${sw.bd}"><span class="nm">${tlEsc(tlShort(r.name, 44))}</span>${r.it.temporary ? `<span class="mc" title="Temporär – syns bara mellan start och slut">⏱</span>` : ""}${shd !== null ? `<span class="g-sh ${shd > 0 ? "late" : shd < 0 ? "early" : ""}" title="Förskjutning mot baslinjen">${shd > 0 ? "+" : shd < 0 ? "−" : "±"}${Math.abs(shd)} d</span>` : ""}${r.members.length > 1 ? `<span class="mc">⛓${r.members.length}</span>` : ""}</div>` +
        `<div class="g-track"><div class="${cls}" data-ref="${tlEsc(r.key)}" data-item-id="${tlEsc(r.key)}" data-members="${tlEsc(r.members.map(m => m.id).join(","))}" style="left:${r.ms ? left + ppd / 2 - 5 : left}px;${r.ms ? "" : "width:" + w + "px;"}background:${stc}" title="${tlEsc(tip)}">${tlBarInner(r, w, T, pc)}${nImg ? `<span class="g-ph" data-ph="${tlEsc(r.key)}" title="${nImg} bild${nImg > 1 ? "er" : ""} kopplade, klicka för att visa">${TL_ICON_CAM}${nImg}</span>` : ""}</div>` +
        (ghostOn && !ganttBaselineDaysOnly && r.bs !== undefined && (r.bs !== r.s || r.be !== r.e) ? `<div class="g-ghost" style="left:${X(r.bs)}px;width:${Math.max(4, (r.be - r.bs + 1) * ppd)}px;background:${ganttBaselineColor || "#6b7280"}"></div>` : "") +
        (ghostOn && !ganttBaselineDaysOnly && ganttBaseline2Id && r.b2s !== undefined && (r.b2s !== r.s || r.b2e !== r.e) ? `<div class="g-ghost g2" style="left:${X(r.b2s)}px;width:${Math.max(4, (r.b2e - r.b2s + 1) * ppd)}px;background:${ganttBaselineColor2 || "#a855f7"}"></div>` : "") + `</div></div>`;
    });
  });
  const totalH = y0;
  // Beroendepilar för den valda aktiviteten (eller hela kedjan)
  let dep = "";
  const arrow = (from, to) => {
    if (vis[from.key] === undefined || vis[to.key] === undefined) return "";
    const x1 = X(from.e + 1), y1 = vis[from.key], x2 = X(to.s), y2 = vis[to.key], bad = x2 < x1 - 0.5, xm = x1 + 4;
    return `<path d="M${x1} ${y1} H${xm} V${y2} H${x2}" class="dp${bad ? " bad" : ""}" marker-end="url(#${bad ? "tlab" : "tlao"})"/>`;
  };
  if (chainSet) rows.forEach(r => r.preds.forEach(p => { if (chainSet[p.ref] && TL.by[p.ref]) dep += arrow(TL.by[p.ref], r); }));
  else if (sc && vis[sc.key] !== undefined) { sc.preds.forEach(p => { if (TL.by[p.ref]) dep += arrow(TL.by[p.ref], sc); }); allRows.forEach(r => { if (r.preds.some(p => p.ref === sc.key)) dep += arrow(sc, r); }); }
  const svg = `<svg class="g-dep" width="${tw}" height="${totalH}" aria-hidden="true"><defs><marker id="tlao" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7z" class="ah"/></marker><marker id="tlab" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7z" class="ah bad"/></marker></defs>${dep}</svg>`;
  let wkd = a0; while (new Date(wkd * 864e5).getUTCDay() !== 6) wkd++;
  const showT = T >= a0 && T <= a1, asOfOn = typeof ganttMode !== "undefined" && ganttMode === "time" && ganttAsOf, A = asOfOn ? tlDay(ganttAsOf) : null;
  const lines = `<div class="g-lines" style="width:${tw}px">` +
    (ppd >= 5 ? `<div class="g-wkend" style="left:${X(wkd)}px;width:${Math.max(0, tw - X(wkd))}px;background-image:repeating-linear-gradient(90deg,color-mix(in srgb,var(--tl-fg) 6%,transparent) 0 ${2 * ppd}px,transparent ${2 * ppd}px ${7 * ppd}px)"></div>` : "") +
    (ppd >= 14 ? `<div class="g-wkend" style="left:0;width:${tw}px;background-image:repeating-linear-gradient(90deg,var(--tl-line) 0 1px,transparent 1px ${ppd}px)"></div>` : "") +
    ticks.map(t => `<div class="g-grid" style="left:${X(t[0])}px"></div>`).join("") +
    (showT ? `<div class="g-tband" style="left:${X(T)}px;width:${Math.max(3, ppd)}px"></div><div class="g-today" style="left:${X(T) + Math.max(0, (Math.max(3, ppd) - 2) / 2)}px"></div>` : "") +
    (A !== null && A >= a0 && A <= a1 ? `<div class="g-asof" style="left:${X(A) + Math.max(0, ppd / 2 - 1)}px"></div>` : "") + `</div>`;
  const ms = TL.m.slice().sort((p, q) => p - q); let meas = "";
  if (ms.length) {
    if (ms.length === 2) { const nd = ms[1] - ms[0]; let wd = 0; for (let q = ms[0]; q < ms[1]; q++) { const w = new Date(q * 864e5).getUTCDay(); if (w !== 0 && w !== 6) wd++; }
      meas += `<div class="g-mband" style="left:${X(ms[0])}px;width:${nd * ppd}px"></div><div class="g-mlab" style="left:${X(ms[0]) + nd * ppd / 2}px;top:${HEAD + 6}px">${nd} dagar · ${wd} arbetsdagar · ${(Math.round(nd / 7 * 10) / 10).toString().replace(".", ",")} v</div>`; }
    else meas += `<div class="g-mlab" style="left:${X(ms[0])}px;top:${HEAD + 6}px">${tlIso(ms[0])} · klicka igen för att mäta</div>`;
    ms.forEach(d => { meas += `<div class="g-mk" style="left:${X(d)}px"></div>`; });
  }
  let wnl = ""; if (ppd * 7 >= 24) for (let mw = mon; mw <= a1; mw += 7) wnl += `<span class="wn" style="left:${X(mw)}px">v${tlIsoWeek(mw)}</span>`;
  let dnl = ""; if (ppd >= 14) for (let dd = a0; dd <= a1; dd++) { const dw = new Date(dd * 864e5).getUTCDay(); dnl += `<span class="dn${dw === 0 || dw === 6 ? " we" : ""}" style="left:${X(dd)}px">${new Date(dd * 864e5).getUTCDate()}</span>`; }
  const head = `<div class="g-row g-head"><div class="g-lab" style="background:var(--tl-bg)">Aktivitet (${rows.length})</div><div class="g-track" style="height:${HEAD}px">${ticks.map(t => `<span style="left:${X(t[0])}px">${t[1]}</span>`).join("")}${wnl}${dnl}${showT ? `<span class="tl" style="left:${X(T)}px">idag</span>` : ""}${A !== null && A >= a0 && A <= a1 ? `<span class="asof-h" data-asof="1" title="Dra för att byta datum" style="left:${X(A) + Math.max(0, ppd / 2 - 1)}px">${tlEsc(ganttAsOf)}</span>` : ""}</div></div>`;
  const note = skipped > 0 && !chainSet ? `<div class="hint">${skipped} aktiviteter utanför det valda datumintervallet visas inte.</div>` : "";
  el.innerHTML = `<div class="tl-root">${tlTools(true)}<div class="gmode" id="tlMode"></div>${note}<div class="gmap" id="tlMap" title="Översikt: klicka eller dra för att flytta"></div>
    <div class="tl-wrap"><div class="tl-gantt${wk ? " wk" : ""}" id="tlGantt" style="--lw:${LW}px;--tw:${tw}px;--wk:${wk}px;--wko:${wko}px;width:calc(${LW}px + ${tw}px)">${head}${body}<div class="g-over" style="left:${LW}px;top:0;height:${totalH}px;width:${tw}px">${lines}${svg}${meas}<div class="g-cross" id="tlCross"></div></div></div></div>
    <div class="ginfo" id="tlInfo"></div></div>`;
  TL.last = { a0, a1, tot, tw, ppd, LW, T, hasRange };
  const wrap = tlQ(el, ".tl-wrap"); wrap.scrollLeft = sl; wrap.scrollTop = st;
  wrap.addEventListener("scroll", () => { if (!TL.raf) TL.raf = requestAnimationFrame(() => { TL.raf = 0; tlUpdateVp(); }); });
  tlMode(); tlMap(); tlInfo();
  if (typeof applyGanttModelSel === "function") applyGanttModelSel(false);
  if (typeof applyGanttMultiSel === "function") setTimeout(applyGanttMultiSel, 0);
  return true;
}
function tlBarInner(r, w, T, pc) {
  if (r.ms) return "";
  let h = `<div class="g-fill" style="width:${Math.min(100, r.pct)}%"></div>`;
  if (pc.pp !== null && pc.pp > 0 && pc.pp < 100 && w >= 24) h += `<div class="g-pt" style="left:calc(${pc.pp}% - 1px)" title="Borde ha nått ${Math.round(pc.pp)} % idag"></div>`;
  if (w >= 34 && (r.pct > 0 || r.status === "pagaende" || r.status === "forsenad")) h += `<span class="g-pc">${Math.round(r.pct)} %</span>`;
  return h;
}
function tlTools(full) {
  return `<div class="tl-tools"><button type="button" class="chip" data-tl="crit" aria-pressed="${TL.crit}" title="Markerar den kritiska vägen (aktiviteter utan marginal mot slutdatum)">Kritisk väg</button>
    <button type="button" class="chip" data-tl="behind" aria-pressed="${TL.behind}" title="Visar bara aktiviteter vars framdrift ligger efter plan">Bara de som ligger efter plan</button>
    <button type="button" class="chip" data-tl="today" title="Hoppa till dagens datum (t)">Hoppa till idag</button>
    <button type="button" class="chip" data-tl="help" title="Kortkommandon (?)">?</button>
    <span class="sp"></span><button type="button" class="chip" data-tl="classic" title="Byt tillbaka till de gamla staplarna (kan slås på igen under Tid och färg → Visning)">Klassiska staplar</button>
    <span class="tl-hint">${full ? "Klicka på en stapel för detaljer och pilar · klicka på namnet för att markera i 3D · dubbelklicka för att redigera · klicka i datumlisten för att mäta dagar" : ""}</span></div>`;
}
function tlMode() {
  const el = document.getElementById("tlMode"); if (!el) return; let h = "";
  if (TL.chain) h += `<button class="chip" data-tl="endchain" aria-pressed="true">Kedjevy: ${TL.chain.dir === "fw" ? "framåt" : "bakåt"} från ${tlEsc(tlShort((TL.by[TL.chain.ref] || {}).name, 40))} (${Object.keys(tlChainOf(TL.chain.ref, TL.chain.dir, Object.values(TL.by))).length - 1} aktiviteter) · avsluta</button>`;
  if (TL.m.length) h += `<button class="chip" data-tl="endm" aria-pressed="true">Rensa mätning</button>`;
  el.innerHTML = h;
}
function tlMap() {
  const el = document.getElementById("tlMap"), L = TL.last; if (!el || !L) return;
  const W = el.clientWidth || 600, n = Math.max(20, Math.floor(W / 3)), bk = new Array(n).fill(0), bl = new Array(n).fill(0), cr = new Array(n).fill(0);
  TL.rows.forEach(r => { const i0 = Math.max(0, Math.floor((r.s - L.a0) / L.tot * n)), i1 = Math.min(n - 1, Math.floor((r.e - L.a0) / L.tot * n)); for (let i = i0; i <= i1; i++) { bk[i]++; if (r.status === "forsenad") bl[i]++; if (r.crit && TL.crit) cr[i]++; } });
  const mx = Math.max(...bk) || 1, bw = W / n; let svg = `<svg preserveAspectRatio="none" viewBox="0 0 ${W} 38">`;
  for (let i = 0; i < n; i++) {
    if (!bk[i]) continue; const h = Math.max(2, bk[i] / mx * 32);
    svg += `<rect x="${i * bw + 0.5}" y="${37 - h}" width="${Math.max(1, bw - 1)}" height="${h}" fill="var(--tl-plan)" opacity=".55"/>`;
    if (bl[i]) svg += `<rect x="${i * bw + 0.5}" y="${37 - bl[i] / mx * 32}" width="${Math.max(1, bw - 1)}" height="${bl[i] / mx * 32}" fill="var(--tl-bad)"/>`;
    if (cr[i]) svg += `<rect x="${i * bw + 0.5}" y="${37 - cr[i] / mx * 32}" width="${Math.max(1, bw - 1)}" height="${Math.max(2, cr[i] / mx * 32)}" fill="var(--tl-crit)"/>`;
  }
  svg += `</svg><div class="td" style="left:${(L.T - L.a0) / L.tot * W}px"></div><div class="vp" id="tlVp"></div>`;
  el.innerHTML = svg; tlUpdateVp();
}
function tlUpdateVp() {
  const vp = document.getElementById("tlVp"), L = TL.last, m = document.getElementById("tlMap"), w = TL.el && tlQ(TL.el, ".tl-wrap"); if (!vp || !L || !w) return;
  const W = m.clientWidth, x0 = w.scrollLeft / L.ppd / L.tot * W, ww = Math.min(W, (w.clientWidth - L.LW) / L.ppd / L.tot * W);
  vp.style.left = Math.max(0, x0) + "px"; vp.style.width = Math.max(8, ww) + "px";
}
function tlInfo() {
  const el = document.getElementById("tlInfo"), r = TL.sel && TL.by[TL.sel]; if (!el) return;
  if (!r) { el.innerHTML = '<div class="empty">Ingen aktivitet vald. Klicka på en stapel för detaljer och beroenden.</div>'; return; }
  const chip = x => `<button class="ref" data-tlsel="${tlEsc(x)}">${tlEsc(tlShort((TL.by[x] || {}).name || x, 30))}</button>`;
  const preds = r.preds.map(p => { const q = TL.by[p.ref]; if (!q) return ""; const ov = q.e + p.lag - r.s;
    return `<li>${chip(p.ref)} <span class="cat">slutar ${q.it.endDate}${p.lag ? ` (${tlSg(p.lag)} d)` : ""}</span> ${ov > 0 ? `<span class="sev hog">överlapp ${ov} d</span>` : '<span class="sev lag">ok</span>'}</li>`; }).join("") || '<li class="cat">Inga föregångare</li>';
  const succ = Object.values(TL.by).filter(x => x.preds.some(p => p.ref === r.key));
  const sl = succ.map(x => { const p = x.preds.find(q => q.ref === r.key), ov = r.e + p.lag - x.s; return `<li>${chip(x.key)} <span class="cat">startar ${x.it.startDate}</span> ${ov > 0 ? `<span class="sev hog">överlapp ${ov} d</span>` : '<span class="sev lag">ok</span>'}</li>`; }).join("") || '<li class="cat">Inga efterföljare</li>';
  const pc = tlPace(r, tlDay(tlToday()));
  el.innerHTML = `<div class="gi-head"><h3>${tlEsc(r.name)}</h3></div><div class="gi-meta"><span>${tlEsc(r.contr || "Entreprenör saknas")}</span><span>${r.it.startDate} till ${r.it.endDate} (${r.e - r.s + 1} d)</span><span>${Math.round(r.pct)} % · ${tlEsc(r.status)}${pc.pp !== null && pc.pp > 0 ? ` · borde vara ${Math.round(pc.pp)} % idag (${pc.dv >= 0 ? "+" : "−"}${Math.abs(Math.round(pc.dv))} pp)` : ""}</span>${r.members.length > 1 ? `<span>${r.members.length} objekt</span>` : ""}<span>${tlEsc(String(r.area).split(" / ").pop())}</span></div>
    <div class="gi-cols"><div><div class="eyebrow">Föregångare</div><ul>${preds}</ul></div><div><div class="eyebrow">Efterföljare (${succ.length})</div><ul>${sl}</ul></div></div>
    ${r.bs !== undefined ? `<div class="gi-meta"><span>Baslinje: ${tlIso(r.bs)} till ${tlIso(r.be)}</span><span>Start ${tlSg(r.s - r.bs)} d</span><span>Slut ${tlSg(r.e - r.be)} d</span></div>` : ""}
    <div class="eyebrow" style="margin-top:6px">Bilder</div>${tlThumbs(r.imgKey, r.key)}<button class="chip" data-act="img" data-ref="${tlEsc(r.key)}">Lägg till bild</button>
    ${r.flt !== undefined ? `<div class="gi-meta"><span>${r.crit ? "På kritisk väg" : "Marginal mot slutdatum: " + r.flt + " d"}</span></div>` : ""}`;
}

/* ---- Interaktion ---------------------------------------------------------------------------------------------------------------------------------------- */
const tlRedraw = keep => { if (typeof renderGantt === "function") renderGantt(getFilteredItems()); };
const tlWrap = () => TL.el && tlQ(TL.el, ".tl-wrap");
function tlDayAt(e) { const L = TL.last, g = document.getElementById("tlGantt"); if (!L || !g) return null; const x = e.clientX - g.getBoundingClientRect().left - L.LW; if (x < 0 || x >= L.tw) return null; return Math.floor(L.a0 + x / L.ppd); }
function tlReveal(key, center) {
  const w = tlWrap(), L = TL.last, bar = TL.el && TL.el.querySelector(`.g-bar[data-ref="${CSS.escape(key)}"]`); if (!w || !L || !bar) return;
  const row = bar.closest(".g-row"), left = parseFloat(bar.style.left) || 0, wd = bar.offsetWidth || 10, vw = w.clientWidth - L.LW;
  if (center || left < w.scrollLeft || left + wd > w.scrollLeft + vw) w.scrollLeft = Math.max(0, left + wd / 2 - vw / 2);
  const t = row.offsetTop, hh = row.offsetHeight;
  if (center || t < w.scrollTop + 48 || t + hh > w.scrollTop + w.clientHeight) w.scrollTop = Math.max(0, t - w.clientHeight / 2);
}
function tlZoomTo(key) {
  const r = TL.by[key], L = TL.last, w = tlWrap(); if (!r || !L) return;
  const avail = w.clientWidth - L.LW, ppd = Math.min(60, Math.max(2.5, avail * 0.6 / Math.max(1, r.e - r.s + 1)));
  ganttZoomPxPerDay = ppd; TL.sel = key; TL.hl = []; saveGanttPrefs(); tlRedraw(); tlReveal(key, true);
}
function tlZoomBy(f) {
  const L = TL.last, w = tlWrap(); if (!L) return; const vw = w.clientWidth - L.LW, cd = L.a0 + (w.scrollLeft + vw / 2) / L.ppd;
  ganttZoomPxPerDay = Math.min(60, Math.max(0.5, L.ppd * f)); saveGanttPrefs(); tlRedraw();
  const N = TL.last, w2 = tlWrap(); if (N && w2) w2.scrollLeft = Math.max(0, (cd - N.a0) * N.ppd - vw / 2);
}
function tlSetSel(key, pop) { TL.sel = key; TL.hl = []; tlRedraw(); tlReveal(key, false); if (pop) tlShowPop(key); else tlHidePop(); }
const tlDrivingPred = r => { let best = null, bv = -1e9; r.preds.forEach(p => { const q = TL.by[p.ref]; if (q && q.e + p.lag > bv) { bv = q.e + p.lag; best = q; } }); return best; };
const tlFirstSucc = r => { let best = null; Object.values(TL.by).forEach(x => { if (x.preds.some(p => p.ref === r.key) && (!best || x.s < best.s)) best = x; }); return best; };
function tlStartChain(key, dir) { if (TL.chain && TL.chain.ref === key && TL.chain.dir === dir) TL.chain = null; else TL.chain = { ref: key, dir }; TL.sel = key; TL.hl = []; tlHidePop(); tlRedraw(); if (TL.chain) tlReveal(key, true); }
function tlCopy(t, done) {
  const fb = () => { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done && done(); } catch (e) { /* ingen */ } document.body.removeChild(ta); };
  try { navigator.clipboard.writeText(t).then(() => done && done(), fb); } catch (e) { fb(); }
}
const tlHidePop = () => { const p = document.getElementById("tlPop"); if (p) p.hidden = true; };
function tlFloat() {
  let f = document.getElementById("tlFloat"); if (f) return f;
  f = document.createElement("div"); f.id = "tlFloat"; f.className = "tl-root tl-float";
  f.innerHTML = `<div class="gpop" id="tlPop" hidden></div><div class="gtip" id="tlTip" hidden></div><input type="file" id="tlImgIn" accept="image/*" multiple hidden>
    <div class="glb" id="tlLb"><div class="lbin"><div class="lbt" id="tlLbT"></div><img id="tlLbImg" alt=""><div class="lbbar"><button class="chip" id="tlLbPrev">← Föregående</button><input type="text" id="tlLbCap" placeholder="Bildtext (sparas)" aria-label="Bildtext"><button class="chip" id="tlLbNext">Nästa →</button><button class="chip" id="tlLbDel">Ta bort bilden</button><button class="chip primary" id="tlLbClose">Stäng</button></div></div></div>
    <div class="ghelp" id="tlHelp"><div class="card2"><h3>Kortkommandon i tidslinjen</h3><ul>
      <li><kbd>↑</kbd> <kbd>↓</kbd> eller <kbd>k</kbd> <kbd>j</kbd> Föregående och nästa aktivitet</li><li><kbd>←</kbd> Gå till den föregångare som styr · <kbd>→</kbd> första efterföljaren</li>
      <li><kbd>[</kbd> Kedja bakåt · <kbd>]</kbd> kedja framåt (hela vägen över områden)</li><li><kbd>Enter</kbd> eller <kbd>f</kbd> Zooma till vald aktivitet</li>
      <li><kbd>+</kbd> <kbd>−</kbd> Zooma · <kbd>t</kbd> Hoppa till idag</li><li><kbd>c</kbd> Kopiera namnet · <kbd>/</kbd> Sök</li>
      <li>Släpp eller klistra in (Ctrl+V) en bild för att koppla den till vald aktivitet</li><li><kbd>m</kbd> Rensa mätning · <kbd>Esc</kbd> Rensa val, kedja och mätning</li>
      <li>Skift+klick eller klick i datumlisten sätter mätpunkter (två punkter ger antal dagar)</li></ul><p class="note">Tryck <kbd>?</kbd> eller <kbd>Esc</kbd> för att stänga.</p></div></div>`;
  document.body.appendChild(f); tlWireFloat(f); return f;
}
function tlShowPop(key) {
  tlFloat(); const r = TL.by[key], p = document.getElementById("tlPop"); if (!r) { tlHidePop(); return; }
  const pr = tlDrivingPred(r), sc = tlFirstSucc(r), pc = tlPace(r, tlDay(tlToday()));
  p.innerHTML = `<h4>${tlEsc(tlShort(r.name, 70))}</h4><div class="m">${r.it.startDate} till ${r.it.endDate} (${r.e - r.s + 1} d) · ${tlEsc(r.status)} ${Math.round(r.pct)} %${pc.pp !== null && pc.pp > 0 ? ` (borde vara ${Math.round(pc.pp)} %)` : ""}${r.contr ? " · " + tlEsc(r.contr) : ""}${r.bs !== undefined ? ` · start ${tlSg(r.s - r.bs)} d, slut ${tlSg(r.e - r.be)} d mot baslinje` : ""}${r.crit && TL.crit ? " · kritisk väg" : ""}</div>${tlThumbs(r.imgKey, key)}<div class="acts">
    <button class="chip" data-act="3d" data-ref="${tlEsc(key)}">Visa i 3D</button><button class="chip" data-act="edit" data-ref="${tlEsc(key)}">Redigera</button>
    <button class="chip" data-act="img" data-ref="${tlEsc(key)}">Lägg till bild</button><button class="chip" data-act="zoom" data-ref="${tlEsc(key)}">Zooma hit</button>
    <button class="chip" data-act="fw" data-ref="${tlEsc(key)}">Kedja framåt</button><button class="chip" data-act="bw" data-ref="${tlEsc(key)}">Kedja bakåt</button>
    ${pr ? `<button class="chip" data-act="go" data-ref="${tlEsc(pr.key)}">← Styrande: ${tlEsc(tlShort(pr.name, 22))}</button>` : ""}${sc ? `<button class="chip" data-act="go" data-ref="${tlEsc(sc.key)}">Nästa: ${tlEsc(tlShort(sc.name, 22))} →</button>` : ""}
    ${r.contr ? `<button class="chip" data-act="contr" data-ref="${tlEsc(key)}">Bara ${tlEsc(tlShort(r.contr, 18))}</button>` : ""}<button class="chip" data-act="copy" data-ref="${tlEsc(key)}">Kopiera</button><button class="chip" data-act="close">Stäng</button></div>`;
  p.setAttribute("data-ref", key); p.hidden = false;
}
function tlAct(e) {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.getAttribute("data-act"), ref = b.getAttribute("data-ref"), r = TL.by[ref];
  if (a === "zoom") { tlHidePop(); tlZoomTo(ref); }
  else if (a === "fw" || a === "bw") tlStartChain(ref, a);
  else if (a === "go") tlSetSel(ref, true);
  else if (a === "3d" && r) selectGanttItemInModel(r.it);
  else if (a === "edit" && r) { tlHidePop(); openEditActivityDialog(r.it); }
  else if (a === "contr" && r) { filters.contractor = [r.contr]; if (typeof renderContractorFilter === "function") renderContractorFilter(); tlHidePop(); renderAll(); }
  else if (a === "copy" && r) tlCopy(r.name + " (" + r.it.startDate + " till " + r.it.endDate + ")", () => { b.textContent = "Kopierat"; });
  else if (a === "close") tlHidePop();
  else if (a === "img") { TL.imgRef = ref; document.getElementById("tlImgIn").click(); }
  else if (a === "lb") tlOpenLb(b.getAttribute("data-key") || ref, parseInt(b.getAttribute("data-i"), 10) || 0);
}
function tlClearAll() { const had = TL.sel || TL.chain || TL.m.length; TL.sel = null; TL.hl = []; TL.chain = null; TL.m = []; tlHidePop(); if (had) tlRedraw(); }
function tlMoveSel(dx) { if (!TL.order.length) return; let i = TL.order.indexOf(TL.sel); i = i < 0 ? (dx > 0 ? 0 : TL.order.length - 1) : Math.max(0, Math.min(TL.order.length - 1, i + dx)); tlSetSel(TL.order[i], false); }
const tlHelp = () => { tlFloat(); document.getElementById("tlHelp").classList.toggle("on"); };

/* Drag för att flytta/ändra (redigerbart läge) – samma planering, beroendekrockar och Ångra som de gamla staplarna. Klick = välj. */
function tlBarDown(e, bar, el) {
  if (e.button !== undefined && e.button !== 0) return;
  const key = bar.getAttribute("data-ref"), r = TL.by[key]; if (!r) return;
  const L = TL.last, startX = e.clientX, rect = bar.getBoundingClientRect(), wr = tlWrap().getBoundingClientRect();
  const vl = Math.max(rect.left, wr.left + L.LW), vr = Math.min(rect.right, wr.right), EDGE = 8; let mode = "move";
  if (ganttEditable && !r.ms && vr > vl) { if (e.clientX <= vl + EDGE) mode = "resize-left"; else if (e.clientX >= vr - EDGE) mode = "resize-right"; }
  const targets = new Set(r.members.map(m => m.id)); let moved = false, delta = 0, shift = false; const w0 = bar.style.width;
  const plan = (dd, deps) => mode === "move" ? planMove(targets, dd, deps) : planResize(targets, mode === "resize-left" ? "left" : "right", dd, deps);
  const onMove = ev => {
    const dx = ev.clientX - startX; if (Math.abs(dx) >= 4) moved = true;
    if (!ganttEditable || !moved || !L.ppd) return;
    delta = Math.round(dx / L.ppd); shift = ev.shiftKey; bar.classList.add("dragging");
    if (mode === "move") bar.style.transform = `translateX(${delta * L.ppd}px)`;
    else if (mode === "resize-right") bar.style.width = Math.max(3, rect.width + delta * L.ppd) + "px";
    else { const d = Math.min(delta * L.ppd, rect.width - 3); bar.style.transform = `translateX(${d}px)`; bar.style.width = Math.max(3, rect.width - d) + "px"; }
  };
  const onUp = async () => {
    document.removeEventListener("pointermove", onMove); bar.style.transform = ""; bar.style.width = w0; bar.classList.remove("dragging");
    if (!moved) {
      const now = Date.now();
      if (TL.lastClick.id === key && now - TL.lastClick.t < 450) { TL.lastClick.id = null; tlHidePop(); openEditActivityDialog(r.it); return; }
      TL.lastClick = { id: key, t: now };
      TL.sel = TL.sel === key && !document.getElementById("tlPop").hidden ? null : key; TL.hl = []; tlRedraw();
      if (TL.sel) tlShowPop(key); else tlHidePop();
      return;
    }
    if (!ganttEditable || !delta) { tlRedraw(); return; }
    const p = plan(delta, !shift), conflicts = planConflicts(targets, p);
    if (conflicts.length && !(await dashConfirm(`Varning – beroende:\n${conflictText(conflicts)}\n\nFlytta ändå?`, { ok: "Flytta ändå" }))) { tlRedraw(); return; }
    const deps = [...p.items.keys()].filter(id => !targets.has(id)).length, verb = mode === "move" ? `Flyttade ${itemLabel(r.it)} ${delta > 0 ? "+" : ""}${delta} d` : `${mode === "resize-left" ? "Ny start" : "Nytt slut"} för ${itemLabel(r.it)}`;
    applySchedulePlan(p, deps ? `${verb} (${deps} beroende framskjutna)` : verb);
  };
  document.addEventListener("pointermove", onMove); document.addEventListener("pointerup", onUp, { once: true });
}
function tlWire(el) {
  if (el.dataset.tlWired) return; el.dataset.tlWired = "1";
  tlFloat();
  el.addEventListener("pointerdown", e => {
    if (!tlOn()) return;
    const as = e.target.closest("[data-asof]");
    if (as) { e.preventDefault(); e.stopPropagation(); const L = TL.last; const g = document.getElementById("tlGantt");
      const mv = ev => { const x = ev.clientX - g.getBoundingClientRect().left - L.LW; let d = tlIso(Math.max(L.a0, Math.min(L.a1, Math.floor(L.a0 + x / L.ppd)))); const rg = typeof ganttTimeRange === "function" ? ganttTimeRange() : null; if (rg) d = d < rg[0] ? rg[0] : d > rg[1] ? rg[1] : d; if (d !== ganttAsOf) { setGanttAsOf(d, { noRender: true }); as.textContent = d; const line = el.querySelector(".g-asof"); if (line) line.style.left = ((tlDay(d) - L.a0) * L.ppd + Math.max(0, L.ppd / 2 - 1)) + "px"; as.style.left = line ? line.style.left : as.style.left; } };
      const up = () => { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); tlRedraw(); if (typeof updateGanttTimeUi === "function") updateGanttTimeUi(); };
      document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up); return; }
    if (e.ctrlKey || e.metaKey) return;
    const bar = e.target.closest(".g-bar"); if (bar && !e.target.closest(".g-ph")) tlBarDown(e, bar, el);
  });
  el.addEventListener("click", e => {
    if (!tlOn()) return;
    const t = e.target, tool = t.closest("[data-tl]");
    if (tool) {
      const a = tool.getAttribute("data-tl");
      if (a === "crit") { TL.crit = !TL.crit; try { localStorage.setItem("4ddash-tl-crit", TL.crit ? "1" : "0"); } catch (x) { /* */ } tlRedraw(); }
      else if (a === "behind") { TL.behind = !TL.behind; tlRedraw(); }
      else if (a === "today") tlToday2();
      else if (a === "help") tlHelp();
      else if (a === "classic") tlSetClassic(true);
      else if (a === "endchain") { TL.chain = null; tlRedraw(); } else if (a === "endm") { TL.m = []; tlRedraw(); }
      return;
    }
    const ph = t.closest(".g-ph"); if (ph) { tlOpenLb(TL.by[ph.getAttribute("data-ph")].imgKey, 0, ph.getAttribute("data-ph")); return; }
    if (e.ctrlKey || e.metaKey) return; // flerval hanteras av dashboardens egen Ctrl-klick
    if (t.closest(".g-head") || e.shiftKey) { const d = tlDayAt(e); if (d !== null) { TL.m = TL.m.length >= 2 ? [d] : TL.m.concat(d); tlRedraw(); return; } if (t.closest(".g-head")) return; }
    const gh = t.closest("[data-grp]"); if (gh && !t.closest(".g-head")) { const k = gh.getAttribute("data-grp"); if (ganttCollapsedGroups.has(k)) ganttCollapsedGroups.delete(k); else ganttCollapsedGroups.add(k); saveGanttPrefs(); tlRedraw(); return; }
    const sel = t.closest("[data-tlsel]"); if (sel) { const k = sel.getAttribute("data-tlsel"); TL.sel = k; TL.hl = []; tlRedraw(); tlReveal(k, true); return; }
    const lab = t.closest(".g-lab[data-item-id]"); if (lab) { const key = lab.getAttribute("data-item-id"), r = TL.by[key]; TL.sel = key; TL.hl = []; tlRedraw(); if (r) selectGanttItemInModel(r.it); return; }
    const act = t.closest("[data-act]"); if (act) tlAct(e);
  });
  el.addEventListener("mousemove", e => {
    if (!tlOn()) return; const c = document.getElementById("tlCross"), tip = document.getElementById("tlTip"), L = TL.last, d = tlDayAt(e);
    if (d === null || !c) { if (c) c.style.display = "none"; if (tip) tip.hidden = true; return; }
    c.style.display = "block"; c.style.left = ((d - L.a0) * L.ppd) + "px"; c.style.width = Math.max(1, L.ppd) + "px";
    let txt = tlFmtDay(d) + " · v" + tlIsoWeek(d); const dt = d - L.T; txt += dt === 0 ? " · idag" : " · " + tlSg(dt) + " d från idag";
    const rw = e.target.closest("[data-row]"), r = rw && TL.by[rw.getAttribute("data-row")];
    if (r) { txt += " · " + tlShort(r.name, 28); txt += d >= r.s && d <= r.e ? ` dag ${d - r.s + 1} av ${r.e - r.s + 1}` : d < r.s ? ` startar om ${r.s - d} d` : ` slutade för ${d - r.e} d sedan`; }
    tip.textContent = txt; tip.hidden = false; tip.style.left = Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, e.clientX + 14)) + "px"; tip.style.top = (e.clientY + 18) + "px";
  });
  el.addEventListener("mouseleave", () => { const c = document.getElementById("tlCross"), tip = document.getElementById("tlTip"); if (c) c.style.display = "none"; if (tip) tip.hidden = true; TL.active = false; });
  el.addEventListener("mouseenter", () => { TL.active = true; });
  el.addEventListener("contextmenu", e => { if (!tlOn()) return; const gh = e.target.closest("[data-grp]"); if (gh && typeof openGanttGroupMenu === "function") { e.preventDefault(); openGanttGroupMenu(e, gh.getAttribute("data-grp")); } });
  let down = false;
  el.addEventListener("pointerdown", e => { const m = e.target.closest("#tlMap"); if (!m) return; down = true; try { m.setPointerCapture(e.pointerId); } catch (x) { /* */ } tlMapJump(e); });
  el.addEventListener("pointermove", e => { if (down && e.target.closest("#tlMap")) tlMapJump(e); });
  el.addEventListener("pointerup", () => { down = false; });
  // dra bilder till en rad
  let lastRow = null; const clr = () => { if (lastRow) { lastRow.classList.remove("dz"); lastRow = null; } };
  el.addEventListener("dragover", e => { if (!tlOn() || !e.dataTransfer || ![].includes.call(e.dataTransfer.types || [], "Files")) return; e.preventDefault(); const rw = e.target.closest("[data-row]"); if (rw !== lastRow) { clr(); if (rw) { rw.classList.add("dz"); lastRow = rw; } } });
  el.addEventListener("dragleave", e => { if (!el.contains(e.relatedTarget)) clr(); });
  el.addEventListener("drop", e => { if (!tlOn() || !e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); const rw = e.target.closest("[data-row]"), ref = rw ? rw.getAttribute("data-row") : TL.sel; clr(); if (ref) { TL.sel = ref; tlAttach(ref, e.dataTransfer.files); } });
}
function tlToday2() { const w = tlWrap(), L = TL.last; if (L && w && L.T >= L.a0 && L.T <= L.a1) w.scrollLeft = Math.max(0, (L.T - L.a0) * L.ppd - (w.clientWidth - L.LW) / 2); }
function tlMapJump(e) { const L = TL.last, m = document.getElementById("tlMap"), w = tlWrap(); if (!L || !m || !w) return; const x = e.clientX - m.getBoundingClientRect().left, d = L.a0 + x / m.clientWidth * L.tot; w.scrollLeft = Math.max(0, (d - L.a0) * L.ppd - (w.clientWidth - L.LW) / 2); }
function tlSetClassic(on) {
  ganttClassic = !!on; try { localStorage.setItem("4ddash-gantt-classic", on ? "1" : "0"); } catch (e) { /* */ }
  const cb = document.getElementById("ganttTimelineOn"); if (cb) cb.checked = !on;
  tlHidePop(); document.getElementById("tlFloat")?.querySelector("#tlHelp")?.classList.remove("on"); renderGantt(getFilteredItems());
}
function tlWireFloat(f) {
  f.querySelector("#tlPop").addEventListener("click", tlAct);
  document.addEventListener("click", e => { if (!e.target.closest("#tlPop") && !e.target.closest(".g-bar")) tlHidePop(); });
  f.querySelector("#tlImgIn").addEventListener("change", function () { tlAttach(TL.imgRef, this.files); this.value = ""; });
  f.querySelector("#tlLbClose").onclick = tlCloseLb; f.querySelector("#tlLbPrev").onclick = () => tlLbStep(-1); f.querySelector("#tlLbNext").onclick = () => tlLbStep(1);
  f.querySelector("#tlLb").addEventListener("click", e => { if (e.target.id === "tlLb") tlCloseLb(); });
  f.querySelector("#tlLbDel").onclick = () => { const l = tlImgList(TL.lb.key), o = l[TL.lb.i]; if (!o) return; const key = TL.lb.key, i = TL.lb.i; tlImgDel(o); if (tlImgList(key).length) tlOpenLb(key, Math.min(i, tlImgList(key).length - 1), TL.lb.ref); else tlCloseLb(); tlRedraw(); };
  f.querySelector("#tlLbCap").addEventListener("change", function () { const o = tlImgList(TL.lb.key)[TL.lb.i]; if (o) { o.caption = this.value; tlImgPut(o); } });
  f.querySelector("#tlHelp").addEventListener("click", e => { if (e.target.id === "tlHelp") tlHelp(); });
  document.addEventListener("paste", e => {
    const tg = e.target && e.target.tagName; if (tg === "INPUT" || tg === "TEXTAREA" || !tlOn() || !TL.sel || !TL.active) return;
    const fl = [].filter.call((e.clipboardData && e.clipboardData.files) || [], x => /^image\//.test(x.type)); if (fl.length) { e.preventDefault(); tlAttach(TL.sel, fl); }
  });
  document.addEventListener("keydown", tlKey);
}
function tlKey(e) {
  if (!tlOn() || e.ctrlKey || e.metaKey || e.altKey) return;
  const tg = e.target && e.target.tagName, lb = document.getElementById("tlLb");
  if (tg === "INPUT" || tg === "TEXTAREA" || tg === "SELECT") { if (e.key === "Escape" && lb && lb.classList.contains("on")) tlCloseLb(); return; }
  const k = e.key;
  if (lb && lb.classList.contains("on")) { if (k === "Escape") { tlCloseLb(); e.preventDefault(); } else if (k === "ArrowLeft") { tlLbStep(-1); e.preventDefault(); } else if (k === "ArrowRight") { tlLbStep(1); e.preventDefault(); } return; }
  const help = document.getElementById("tlHelp");
  if (!TL.active) return;
  if (k === "?") { tlHelp(); e.preventDefault(); return; }
  if (k === "Escape") { if (help && help.classList.contains("on")) tlHelp(); else if (TL.sel || TL.chain || TL.m.length) tlClearAll(); return; }
  const r = TL.sel && TL.by[TL.sel]; let handled = true;
  if (k === "ArrowDown" || k === "j") tlMoveSel(1); else if (k === "ArrowUp" || k === "k") tlMoveSel(-1);
  else if ((k === "ArrowLeft" || k === "h") && r) { const p = tlDrivingPred(r); if (p) tlSetSel(p.key, false); }
  else if ((k === "ArrowRight" || k === "l") && r) { const n = tlFirstSucc(r); if (n) tlSetSel(n.key, false); }
  else if (k === "]" && r) tlStartChain(r.key, "fw"); else if (k === "[" && r) tlStartChain(r.key, "bw");
  else if ((k === "Enter" || k === "f") && r) tlZoomTo(r.key);
  else if (k === "+" || k === "=") tlZoomBy(1.5); else if (k === "-" || k === "_") tlZoomBy(1 / 1.5);
  else if (k === "t") tlToday2(); else if (k === "c" && r) tlCopy(r.name, () => {});
  else if (k === "m") { TL.m = []; tlRedraw(); } else if (k === "/") { const s = document.getElementById("ganttSearch"); if (s) s.focus(); }
  else handled = false;
  if (handled) e.preventDefault();
}

/* ---- Bilder per aktivitet (sparas i webbläsaren, IndexedDB) -------------------------------------------------------------------------------- */
const TL_ICON_CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.6"/></svg>';
const TLIMG = { db: null, by: {}, n: 0 };
function tlImgOpen(cb) {
  try {
    const q = indexedDB.open("4ddash-tl-img", 1);
    q.onupgradeneeded = () => { q.result.createObjectStore("img", { keyPath: "id", autoIncrement: true }); };
    q.onsuccess = () => { TLIMG.db = q.result; try { const rq = TLIMG.db.transaction("img", "readonly").objectStore("img").getAll(); rq.onsuccess = () => { TLIMG.by = {}; rq.result.forEach(o => { (TLIMG.by[o.ref] = TLIMG.by[o.ref] || []).push(o); }); cb && cb(); }; rq.onerror = () => cb && cb(); } catch (e) { cb && cb(); } };
    q.onerror = () => { TLIMG.db = null; cb && cb(); };
  } catch (e) { TLIMG.db = null; cb && cb(); }
}
const tlImgList = key => TLIMG.by[key] || [];
function tlImgAdd(key, name, data) {
  const o = { ref: key, name, caption: "", data, ts: Date.now() }, mem = () => { o.id = "m" + (++TLIMG.n); (TLIMG.by[key] = TLIMG.by[key] || []).push(o); return o; };
  return new Promise(res => {
    if (!TLIMG.db) { res(mem()); return; }
    try { const rq = TLIMG.db.transaction("img", "readwrite").objectStore("img").add(o); rq.onsuccess = () => { o.id = rq.result; (TLIMG.by[key] = TLIMG.by[key] || []).push(o); res(o); }; rq.onerror = () => res(mem()); } catch (e) { res(mem()); }
  });
}
const tlImgPut = o => { if (TLIMG.db && typeof o.id === "number") { try { TLIMG.db.transaction("img", "readwrite").objectStore("img").put(o); } catch (e) { /* */ } } };
function tlImgDel(o) { TLIMG.by[o.ref] = tlImgList(o.ref).filter(x => x !== o); if (TLIMG.db && typeof o.id === "number") { try { TLIMG.db.transaction("img", "readwrite").objectStore("img").delete(o.id); } catch (e) { /* */ } } }
function tlImgPrep(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader(); fr.onerror = () => rej(new Error("Kunde inte läsa bilden."));
    fr.onload = () => { const im = new Image(); im.onerror = () => rej(new Error("Kunde inte läsa bilden.")); im.onload = () => { const k = Math.min(1, 1280 / Math.max(im.width, im.height)), c = document.createElement("canvas"); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k)); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", 0.8)); }; im.src = fr.result; };
    fr.readAsDataURL(file);
  });
}
function tlAttach(ref, files) {
  const r = TL.by[ref], list = [].filter.call(files || [], f => /^image\//.test(f.type)); if (!r || !list.length) return;
  let p = Promise.resolve(); list.forEach(f => { p = p.then(() => tlImgPrep(f).then(d => tlImgAdd(r.imgKey, f.name || "bild", d))); });
  p.then(() => { tlRedraw(); if (TL.sel === ref) tlShowPop(ref); if (typeof modelToast === "function") modelToast(`${list.length} bild${list.length > 1 ? "er" : ""} kopplade${TLIMG.db ? "" : " (sparas inte, webbläsaren saknar lagring)"}`); })
    .catch(e => { if (typeof modelToast === "function") modelToast(e.message || "Kunde inte lägga till bilden."); });
}
const tlThumbs = (imgKey, ref) => { const l = tlImgList(imgKey); return l.length ? `<div class="thumbs">${l.map((o, i) => `<img src="${o.data}" alt="${tlEsc(o.caption || o.name)}" data-act="lb" data-ref="${tlEsc(ref)}" data-key="${tlEsc(imgKey)}" data-i="${i}">`).join("")}</div>` : ""; };
function tlOpenLb(key, i, ref) {
  tlFloat(); const l = tlImgList(key); if (!l.length) { tlCloseLb(); return; }
  TL.lb = { key, ref: ref || TL.lb.ref, i: Math.max(0, Math.min(l.length - 1, i)) };
  const o = l[TL.lb.i], r = TL.by[TL.lb.ref] || Object.values(TL.by).find(x => x.imgKey === key);
  document.getElementById("tlLbImg").src = o.data; document.getElementById("tlLbCap").value = o.caption || "";
  document.getElementById("tlLbT").textContent = (r ? tlShort(r.name, 60) + " · " : "") + "bild " + (TL.lb.i + 1) + " av " + l.length; document.getElementById("tlLb").classList.add("on");
}
const tlCloseLb = () => { document.getElementById("tlLb")?.classList.remove("on"); };
const tlLbStep = d => { const l = tlImgList(TL.lb.key); if (l.length) tlOpenLb(TL.lb.key, (TL.lb.i + d + l.length) % l.length, TL.lb.ref); };

/* Visning → "Ny tidslinje" (på som standard; av = de gamla staplarna). */
function initTimeline() {
  const cb = document.getElementById("ganttTimelineOn"); if (cb && !cb.dataset.w) { cb.dataset.w = "1"; cb.checked = !ganttClassic; cb.onchange = () => tlSetClassic(!cb.checked); }
  tlImgOpen(() => { if (tlOn() && TL.el && typeof renderGantt === "function") tlRedraw(); });
}
document.addEventListener("DOMContentLoaded", initTimeline);
if (document.readyState !== "loading") initTimeline();
