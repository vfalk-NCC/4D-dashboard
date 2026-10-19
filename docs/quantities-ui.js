/* Mängdavtagning – gränssnittet (Victor 2026-10-19: "tänk nytt, behåll grundprincipen att vi läser från Excel, förenkla").
   Allt utgår från mängdförteckningen (Excel): en matris i Excel-layouten (koder × byggnader) är huvudvyn. Klick på en siffra markerar objekten som den räknas på i TC.
   Klick på en kod öppnar "Koppla": där väljer du modellens typer eller objekt (en enda sökruta, t.ex. HPM) och lägger dem på koden. Resten (typ-egenskap, byggnader per område,
   armeringsschablon, egna koder) ligger under ⚙ Inställningar. Mängdslaget följer kodens enhet, så form och betong kan kopplas var för sig utan att välja något. */

const XL_NOB = "(ingen byggnad)";
const XL_MODES = [["k", "Kontrakt"], ["pr", "Prognos"], ["tot", "Modell"], ["klar", "Klart"], ["kvar", "Kvar"]];
const XL_CLOSED = "4ddash-qty-closed";
const xl = { closed: new Set((() => { try { return JSON.parse(localStorage.getItem(XL_CLOSED) || "[]"); } catch (e) { return []; } })()), mode: "tot", q: "", active: "", settings: false, sel: new Set(), find: "", open: new Set(), onlyUnlinked: true, last: null, toast: "" };
const xlKindsAll = () => Object.keys(QTY_KINDS);
const xlPost = key => qmfAllPosts().find(p => p.key === key);
const xlKindOf = p => (p ? qmfKindOfPost(p) : "");

/* ---- Beräkning: koder × byggnader -------------------------------------------------------------------------------------------------------------- */
function xlCompute(objsIn) {
  const cells = new Map(), posts = new Map(qmfAllPosts().map(p => [p.key, p])), kinds = xlKindsAll(), colSet = new Set(), unlinked = [], noValue = [];
  (objsIn || qty.objs).forEach(o => {
    const b = qmf.map.areas[qmfAreaOf(o)] || XL_NOB; let any = false; const done = qtyDone(o);
    kinds.forEach(k => {
      const key = qmfEffPost(o, k); if (!key) return; const p = posts.get(key); if (!p || qmfKindOfPost(p) !== k) return;
      any = true; const v = qtyValue(o, k); if (v === null) { noValue.push(o); return; }
      colSet.add(b); const m = cells.get(key) || cells.set(key, new Map()).get(key), c = m.get(b) || m.set(b, { tot: 0, klar: 0, n: 0, objs: [] }).get(b);
      c.tot += v; c.n++; c.objs.push(o); if (done) c.klar += v;
    });
    if (!any) unlinked.push(o);
  });
  const cols = [...qmf.builds]; if (colSet.has(XL_NOB) || !cols.length) cols.push(XL_NOB);
  return { cells, cols, unlinked, noValue };
}
/* Radernas ordning: som i Excel (med rubriker) om filen lästs med radordning, annars kodernas ordning. En rubrik visas bara om något under den visas. */
function xlRows(M, collapse) {
  const w = xl.q.toLowerCase().split(/\s+/).filter(Boolean), posts = qmfAllPosts();
  const has = p => (M.cells.has(p.key)) || Object.values(p.k || {}).some(Boolean) || Object.values(p.p || {}).some(Boolean);
  const match = p => !w.length || w.every(x => `${p.ref} ${p.label} ${p.unit}`.toLowerCase().includes(x));
  const vis = new Map(posts.filter(p => has(p) && match(p)).map(p => [p.key, p]));
  if (!qmf.layout || !qmf.layout.length) return posts.filter(p => vis.has(p.key)).map(p => ({ p }));
  const rows = []; qmf.layout.forEach((e, i) => { if (e.h) rows.push({ h: e, i }); else if (vis.has(e.p)) rows.push({ p: vis.get(e.p) }); });
  const inLayout = new Set(qmf.layout.filter(e => e.p).map(e => e.p)); const extra = [...vis.values()].filter(p => !inLayout.has(p.key));
  if (extra.length) { rows.push({ h: { ref: "", text: "Egna koder", lvl: 0 }, i: -1 }); extra.forEach(p => rows.push({ p })); }
  const keep = rows.map(r => !!r.p);
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].h) { const lv = rows[i].h.lvl; for (let j = i + 1; j < rows.length; j++) { if (keep[j] && rows[j].p) { keep[i] = true; break; } if (rows[j].h && rows[j].h.lvl <= lv) break; } }
  const out = rows.filter((r, i) => keep[i]);
  if (!collapse || w.length) return out; // vid sökning visas alla träffar
  const res = []; let hideLv = null;   // hopfällda rubriker döljer raderna under sig, tills en rubrik på samma eller högre nivå kommer
  out.forEach(r => { if (r.h) { if (hideLv !== null && r.h.lvl > hideLv) return; hideLv = null; res.push(r); if (xl.closed.has(xlHKey(r))) hideLv = r.h.lvl; } else if (hideLv === null) res.push(r); });
  return res;
}
const xlHKey = r => `${r.i}|${r.h.ref}|${r.h.text}`;
function xlSaveClosed() { try { localStorage.setItem(XL_CLOSED, JSON.stringify([...xl.closed])); } catch (e) { /* */ } }
const xlMxFilter = (objs, mode) => (mode === "klar" ? objs.filter(qtyDone) : mode === "kvar" ? objs.filter(o => !qtyDone(o)) : objs);
function xlVal(M, p, b, mode) {
  const c = (M.cells.get(p.key) || new Map()).get(b) || { tot: 0, klar: 0 }, pr = (p.p || {})[b] || 0, k = (p.k || {})[b] || 0;
  return mode === "klar" ? c.klar : mode === "pr" ? pr : mode === "kvar" ? Math.max(0, pr - c.klar) : mode === "k" ? k : c.tot;
}
const xlFmt = v => (v ? qtyFmt(v, Math.abs(v) < 100 ? 1 : 0) : "–");

/* ---- Huvudvyn ------------------------------------------------------------------------------------------------------------------------------------- */
function qtyMsg(t) { qty.msgText = t; const el = document.getElementById("qtyMsg"); if (el) el.textContent = t; }
function qtyBusyUi(on) { const b = document.getElementById("qtyRead"); if (b) { b.disabled = on; b.textContent = on ? "Läser…" : "Läs mängder"; } }
function qtyRender() { qtyKeepScroll(xlRender); }
function xlSeg(attr, cur, opts) { return `<div class="gantt-seg qty-seg" role="group">${opts.map(([v, t, tip]) => `<button type="button" class="gantt-seg-btn${cur === v ? " active" : ""}" ${attr}="${v}"${tip ? ` title="${qtyEsc(tip)}"` : ""}>${t}</button>`).join("")}</div>`; }
function xlRender() {
  const host = document.getElementById("qtyBox"); if (!host) return;
  const E = qtyEsc, hasMf = qmfAllPosts().length > 0, hasObjs = qty.objs.length > 0, C = qty.cfg;
  const M = hasObjs ? xlCompute() : { cells: new Map(), cols: [...qmf.builds], unlinked: [], noValue: [] };
  xl.last = M;
  const bar = `<div class="xl-bar">
      <div class="xl-grp"><span class="gantt-sub-label">Mängdförteckning</span>${qmf.file ? `<span class="xl-file" title="${E(qmf.file)}">📄 ${E(qmf.file)}</span><label class="gantt-toolbar-btn xl-btn">Byt fil<input type="file" id="qmfFile" accept=".xlsx" hidden /></label><button type="button" id="qmfClear" class="gantt-toolbar-btn xl-btn" title="Ta bort förteckningen (kopplingarna behålls)">✕</button>` : `<label class="gantt-toolbar-btn xl-btn primary">Välj Excel-fil…<input type="file" id="qmfFile" accept=".xlsx" hidden /></label>`}</div>
      <div class="xl-grp"><span class="gantt-sub-label">Urval</span>${xlSeg("data-qscope", C.scope, [["gantt", "Gantt-schemat", "Det som visas i Gantt-schemat"], ["all", "Hela planen"], ["sel", "Markerat i TC"]])}</div>
      <div class="xl-grp"><label class="gantt-toolbar-field" title="Klart enligt Ganttens regel vid det här datumet">Klart vid <input type="date" id="qtyDate" value="${E(qtyAt())}" /></label><label class="gantt-toolbar-field qty-follow" title="Datumet följer tidslinjen i Gantt-schemat. Skriver du ett eget datum stängs det av."><input type="checkbox" id="qtyFollow"${qtyFollow() ? " checked" : ""} /> Följ tidslinjen</label></div>
      <span class="gantt-head-spacer"></span><span id="qtyMsg" class="hint">${E(qty.msgText || "")}</span>
      <button type="button" id="qtyRead" class="gantt-toolbar-btn qty-read primary">Läs mängder</button><button type="button" id="xlSettingsBtn" class="gantt-toolbar-btn xl-btn${xl.settings ? " on" : ""}" title="Inställningar">⚙ Inställningar</button></div>`;
  let html = bar;
  if (qmf.msg) html += `<div class="hint">${E(qmf.msg)}</div>`;
  if (xl.settings) html += xlSettingsHtml();
  if (!hasMf) html += `<div class="xl-empty"><b>Börja med mängdförteckningen.</b> Välj Excel-filen ovan så läggs koderna ut i samma layout som i Excel, och du kopplar modellens objekt till dem. Saknar du förteckning kan du skapa egna koder under ⚙ Inställningar.<br><span class="hint">Filen läses bara i din webbläsare och ändras inte.</span></div>`;
  else if (!hasObjs) html += `<div class="xl-empty">Tryck <b>Läs mängder</b> så hämtas objektens mått ur modellen.</div>`;
  html += xlMatrixHtml(M);
  if (xl.active) html += xlLinkHtml(M);
  host.innerHTML = html; xlWire(host, M);
}
function xlMatrixHtml(M) {
  const E = qtyEsc, hasObjs = qty.objs.length > 0, rows = xlRows(M, true), canFold = !xl.q.trim() && !!(qmf.layout && qmf.layout.length);
  if (!qmfAllPosts().length) return "";
  const nc = M.cols.length + 4, un = M.unlinked.length;
  const body = rows.map(r => {
    if (r.h) { const h = r.h, shut = xl.closed.has(xlHKey(r)); return `<tr class="mx-head${h.ref ? " top" : ""}${canFold ? " fold" : ""}" data-hk="${E(xlHKey(r))}"><td class="mx-ref"><b>${canFold ? `<span class="mx-caret">${shut ? "▸" : "▾"}</span> ` : ""}${E(h.ref)}</b></td><td colspan="${nc - 1}" style="padding-left:${6 + Math.max(0, h.lvl - 1) * 10}px">${h.ref || h.lvl <= 1 ? `<b>${E(h.text)}</b>` : E(h.text)}</td></tr>`; }
    const p = r.p, byB = M.cells.get(p.key) || new Map(); let tot = 0;
    const tds = M.cols.map(b => { const c = byB.get(b), v = xlVal(M, p, b, xl.mode); tot += v; const done = c && c.tot > 0 && c.klar >= c.tot * 0.999, nm = c ? xlMxFilter(c.objs, xl.mode).length : 0;
      return `<td class="num mx-c${c ? " has" : ""}${done ? " done" : ""}"${c ? ` data-mp="${E(p.key)}" data-mb="${E(b)}" title="${nm} objekt räknas i ${E((XL_MODES.find(m => m[0] === xl.mode) || [])[1])} – klicka för att markera dem i TC"` : ""}>${xlFmt(v)}</td>`; }).join("");
    return `<tr class="${xl.active === p.key ? "mx-act" : ""}"><td class="mx-ref" data-mp="${E(p.key)}" title="Markera hela koden i TC och koppla objekt till den"><b>${E(p.ref)}</b></td><td class="mx-spec" title="${E(p.label)}">${E(p.label.slice(0, 80))}</td><td class="mx-u">${E(p.unit)}</td>${tds}<td class="num mx-t"><b>${xlFmt(tot)}</b></td></tr>`;
  }).join("");
  return `<div class="xl-mx">
    <div class="xl-tools">${xlSeg("data-mxmode", xl.mode, XL_MODES.map(([v, t]) => [v, t, { k: "Mängd enligt kontraktet (Excel)", pr: "Prognos (Excel)", tot: "Alla objekt i modellen som är kopplade till koden", klar: "Det som är klart enligt Ganttens regel vid valt datum", kvar: "Prognos minus klart" }[v]]))}
      <input type="search" id="xlQ" class="xl-q" placeholder="Sök kod eller text…" value="${E(xl.q)}" autocomplete="off" />
      ${canFold ? `<button type="button" id="xlFoldAll" class="gantt-toolbar-btn xl-btn" title="Fäll ihop alla rubriker">▸ Fäll ihop</button><button type="button" id="xlUnfoldAll" class="gantt-toolbar-btn xl-btn" title="Fäll ut alla rubriker">▾ Fäll ut</button>` : ""}
      <span class="gantt-head-spacer"></span>
      ${hasObjs ? `<button type="button" id="xlUnl" class="gantt-toolbar-btn xl-btn${un ? " warn" : ""}" title="Modellens objekt som inte har någon kod ännu">${un ? `${un.toLocaleString("sv-SE")} objekt saknar kod` : "Alla objekt har kod"}</button>` : ""}
      <button type="button" id="xlHtml" class="gantt-toolbar-btn xl-btn" title="Spara matrisen som en fristående HTML-sida">HTML</button><button type="button" id="xlCsv" class="gantt-toolbar-btn xl-btn" title="Spara matrisen som CSV (Excel)">CSV</button></div>
    ${qmf.layout && qmf.layout.length ? "" : `<div class="hint">Läs in Excel-filen igen för att få med rubrikerna och radordningen från Excel.</div>`}
    <div class="qmf-mx-w"><table class="qmf-mxt"><thead><tr><th>Ref</th><th>Specifikation</th><th>Enhet</th>${M.cols.map(b => `<th class="mx-h" data-mb="${E(b)}" title="Markera allt i ${E(b)} i TC"><span>${E(b)}</span></th>`).join("")}<th class="num mx-h"><span>Totalt</span></th></tr></thead><tbody>${body || `<tr><td colspan="${nc}" class="hint">Inga rader${xl.q ? " matchar sökningen" : ""}.</td></tr>`}</tbody></table></div>
    ${M.noValue.length ? `<div class="hint">${M.noValue.length} koppling${M.noValue.length > 1 ? "ar" : ""} saknar mängd i modellen (egenskapen finns inte på objektet) och räknas inte med.</div>` : ""}</div>`;
}

/* ---- Koppla ------------------------------------------------------------------------------------------------------------------------------------- */
function xlCodeChips(o) {
  const posts = new Map(qmfAllPosts().map(p => [p.key, p]));
  return xlKindsAll().map(k => { const key = qmfEffPost(o, k), p = key && posts.get(key); return p && qmfKindOfPost(p) === k ? p.ref : ""; }).filter(Boolean);
}
function xlLinkHtml(M) {
  const E = qtyEsc, post = xlPost(xl.active); if (!post) return "";
  const k = xlKindOf(post), words = xl.find.toLowerCase().split(/\s+/).filter(Boolean);
  const mine = []; // det som redan är kopplat till koden (typer)
  const typeMap = new Map(); qty.objs.forEach(o => { const t = qmfTypeVal(o), e = typeMap.get(t) || typeMap.set(t, { t, objs: [] }).get(t); e.objs.push(o); });
  const linkedHere = o => qmfEffPost(o, k) === post.key;
  let list = "", shown = 0;
  if (words.length) { // sökning: enskilda objekt
    const hits = qty.objs.filter(o => { const h = qmfHay(o); return words.every(x => h.includes(x)); }), vis = hits.slice(0, 200);
    list = vis.map(o => { const ok = qmfObjKey(o), chips = xlCodeChips(o), v = qtyValue(o, k); return `<label class="xl-li${linkedHere(o) ? " here" : ""}"><input type="checkbox" data-xo="${E(ok)}"${xl.sel.has("o:" + ok) ? " checked" : ""} /><span class="xl-n" data-xsel="${E(ok)}" title="Markera i TC">${E(qmfRawName(o))}</span><span class="xl-t">${E(qmfTypeVal(o).slice(0, 36))}</span><span class="num">${v === null ? "–" : qtyFmt(v)} ${E(post.unit)}</span><span class="xl-c">${chips.map(c => `<i>${E(c)}</i>`).join("")}</span></label>`; }).join("");
    shown = hits.length; if (hits.length > 200) list += `<div class="hint">… ${hits.length - 200} till – lägg till fler ord för att snäva in.</div>`;
  } else { // typer
    let ts = [...typeMap.values()]; if (xl.onlyUnlinked) ts = ts.filter(e => e.objs.some(o => !linkedHere(o)));
    ts.sort((a, b) => a.t.localeCompare(b.t, "sv", { numeric: true }));
    list = ts.map(e => { const v = e.objs.reduce((s, o) => s + (qtyValue(o, k) || 0), 0), n = e.objs.length, here = e.objs.filter(linkedHere).length, chips = [...new Set(e.objs.flatMap(xlCodeChips))];
      return `<label class="xl-li${here === n ? " here" : ""}"><input type="checkbox" data-xt="${E(e.t)}"${xl.sel.has("t:" + e.t) ? " checked" : ""} /><span class="xl-n" data-xtsel="${E(e.t)}" title="Markera de ${n} objekten i TC">${E(e.t)}</span><span class="xl-t">${n} objekt${here && here < n ? ` (${here} här)` : ""}</span><span class="num">${qtyFmt(v)} ${E(post.unit)}</span><span class="xl-c">${chips.slice(0, 5).map(c => `<i>${E(c)}</i>`).join("")}${chips.length > 5 ? "…" : ""}</span></label>`; }).join("");
    shown = ts.length; if (!ts.length) list = `<div class="hint">${xl.onlyUnlinked ? "Allt i modellen är redan kopplat till den här koden." : "Inga objekt lästa."}</div>`;
  }
  const nsel = xl.sel.size;
  return `<div class="xl-link"><div class="xl-lh"><b>Koppla till ${E(post.ref)}</b> <span class="hint">${E(post.label.slice(0, 90))} [${E(post.unit)}] · mängdslag: ${E(QTY_KINDS[k][0])}</span><span class="gantt-head-spacer"></span><button type="button" id="xlPick" class="gantt-toolbar-btn xl-btn">Byt kod…</button><button type="button" id="xlClose" class="gantt-toolbar-btn xl-btn">Stäng</button></div>
    <div class="xl-ls"><input type="search" id="xlFind" class="xl-q" placeholder="Sök objekt i alla egenskaper, t.ex. HPM …" value="${E(xl.find)}" autocomplete="off" />${words.length ? "" : `<label class="qmf-chk"><input type="checkbox" id="xlOnlyUn"${xl.onlyUnlinked ? " checked" : ""} /> Dölj det som redan ligger här</label>`}<span class="hint">${words.length ? `${shown.toLocaleString("sv-SE")} objekt matchar` : `${shown} ${shown === 1 ? "typ" : "typer"}`}</span></div>
    <div class="xl-list">${list}</div>
    <div class="xl-lf"><button type="button" id="xlApply" class="gantt-toolbar-btn primary"${nsel ? "" : " disabled"}>Koppla ${nsel || ""} valda till ${E(post.ref)}</button><button type="button" id="xlApplySel" class="gantt-toolbar-btn" title="Markera objekten i modellen i Trimble Connect först">Koppla markerade i TC</button>${qmf.undoSnap ? `<button type="button" id="xlUndo" class="gantt-toolbar-btn">↩ Ångra senaste</button>` : ""}<span class="hint">${E(xl.toast)}</span></div></div>`;
}
/* Sökning i alla egenskaper (namn, typ, material, UDA …): alla ord ska finnas i någon egenskap. */
const qmfHay = o => o._hay !== undefined ? o._hay : (o._hay = (qmfRawName(o) + "\u0001" + Object.values(o.flat || {}).map(v => String(v)).join("\u0001")).toLowerCase());

/* ---- Inställningar ----------------------------------------------------------------------------------------------------------------------------------- */
function xlSettingsHtml() {
  const E = qtyEsc, C = qty.cfg, areas = [...new Set(qty.objs.map(qmfAreaOf))].sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
  const bOpts = sel => `<option value="">${XL_NOB}</option>${qmf.builds.map(b => `<option value="${E(b)}"${sel === b ? " selected" : ""}>${E(b)}</option>`).join("")}`;
  return `<div class="xl-set">
    <div class="xl-sg"><b>Modellens typer</b><label>Typ-egenskap <select id="qmfTypeKey">${[...qty.keys.keys()].map(k => `<option value="${E(k)}"${qmf.typeKey === k ? " selected" : ""}>${E(k)}</option>`).join("")}</select></label>
      <label class="qmf-chk" title="Revit lägger objektets id sist i namnet – slå ihop så blir samma typ en rad"><input type="checkbox" id="qmfGroupId"${qmf.groupId !== false ? " checked" : ""} /> Slå ihop objekt-id i namnet</label></div>
    <div class="xl-sg"><b>Armering</b><label>Räkna <select id="xlRebarMode"><option value="schablon"${C.rebarMode !== "modell" ? " selected" : ""}>på schablon (kg per m³ betong)</option><option value="modell"${C.rebarMode === "modell" ? " selected" : ""}>med vikten i modellen</option></select></label>
      <label>Schablon <input type="number" id="xlRebarKg" min="0" step="5" value="${E(String(C.rebarKg ?? 100))}" style="width:70px" /> kg/m³</label><span class="hint">Gäller koder i kg eller ton. 100 kg/m³ = 0,10 ton/m³.</span></div>
    <div class="xl-sg"><b>Mängd</b><label class="qmf-chk"><input type="checkbox" id="qtyFormTop"${C.formTop ? " checked" : ""} /> Form med över-/underyta</label>
      <label>Enhet i modellen <select id="qtyUnit">${[["auto", "Auto"], ["1", "som i modellen"], ["1000", "÷ 1 000"], ["1000000", "÷ 1 000 000 (mm² → m²)"], ["1000000000", "÷ 1 000 000 000 (mm³ → m³)"]].map(([v, t]) => `<option value="${v}"${String(C.unit) === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <label title="Bara det som blev klart från och med det här datumet (valfritt)">Klart från <input type="date" id="qtyFrom" value="${E(C.from || "")}" /></label><span class="hint">${E((qty.notes || []).join(" "))}</span></div>
    <div class="xl-sg"><b>Område i Gantt → byggnad</b>${areas.length ? `<table class="qty-table xl-ar"><tbody>${areas.map(a => `<tr><td>${E(a)}</td><td><select data-ar="${E(a)}">${bOpts(qmf.map.areas[a] || "")}</select></td></tr>`).join("")}</tbody></table>` : `<span class="hint">Läs mängder för att se områdena.</span>`}</div>
    <div class="xl-sg"><b>Egna koder</b><span class="hint">Koder som saknas i förteckningen. De delas i 4D-data och fungerar som vanliga koder.</span>${qmf.custom.map(p => `<div class="xl-cu" data-ck="${E(p.key)}"><b>${E(p.ref)}</b> ${E(p.label)} <span class="hint">[${E(p.unit)}] · ${qmfCustomUse(p.key)} koppl.</span><button type="button" class="xl-cedit gantt-toolbar-btn xl-btn">Ändra</button><button type="button" class="xl-cdel gantt-toolbar-btn xl-btn">Ta bort</button></div>`).join("")}<div><button type="button" id="qmfNewPost" class="gantt-toolbar-btn xl-btn">＋ Ny egen kod…</button></div></div>
    ${qty.keys.size ? `<details class="xl-sg"><summary>Egenskaper som hittades (${qty.keys.size})</summary><div class="qty-proplist">${[...qty.keys].map(([k, e]) => `<div><b>${E(k)}</b> <span class="hint">${e.n} obj · ex: ${E(String(e.sample).slice(0, 60))}</span></div>`).join("")}</div></details>` : ""}
    <div class="hint" id="qmfSyncState">${E(qmfSync.state || "")}</div></div>`;
}

/* ---- Export -------------------------------------------------------------------------------------------------------------------------------------------- */
function xlTable(M) {
  const rows = xlRows(M), out = [];
  rows.forEach(r => { if (r.h) out.push({ h: r.h }); else out.push({ p: r.p, vals: M.cols.map(b => xlVal(M, r.p, b, xl.mode)) }); });
  return { cols: M.cols, rows: out };
}
function xlCsv(M) {
  const T = xlTable(M), d = v => (v ? String(Math.round(v * 100) / 100).replace(".", ",") : "");
  const lines = [["Ref", "Specifikation", "Enhet", ...T.cols, "Totalt"], ...T.rows.map(r => r.h ? [r.h.ref, r.h.text] : [r.p.ref, r.p.label, r.p.unit, ...r.vals.map(d), d(r.vals.reduce((s, v) => s + v, 0))])];
  return "﻿" + lines.map(l => l.map(x => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\r\n");
}
function xlHtml(M) {
  const E = qtyEsc, T = xlTable(M), name = (XL_MODES.find(m => m[0] === xl.mode) || [])[1], today = todayISO();
  const rows = T.rows.map(r => r.h ? `<tr class="hd${r.h.ref ? " tp" : ""}"><td class="r">${E(r.h.ref)}</td><td colspan="${T.cols.length + 3}" style="padding-left:${8 + Math.max(0, r.h.lvl - 1) * 12}px">${r.h.ref || r.h.lvl <= 1 ? "<b>" + E(r.h.text) + "</b>" : E(r.h.text)}</td></tr>`
    : `<tr><td class="r">${E(r.p.ref)}</td><td>${E(r.p.label)}</td><td>${E(r.p.unit)}</td>${r.vals.map((v, i) => { const c = (M.cells.get(r.p.key) || new Map()).get(T.cols[i]); const done = c && c.tot > 0 && c.klar >= c.tot * 0.999; return `<td class="n${c ? (done ? " d" : " h") : ""}">${xlFmt(v)}</td>`; }).join("")}<td class="n t">${xlFmt(r.vals.reduce((s, v) => s + v, 0))}</td></tr>`).join("");
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mängdavtagning ${E(today)}</title><style>
  body{font:13px/1.4 Helvetica,Arial,sans-serif;margin:24px;color:#0f172a}h1{font-size:18px;margin:0 0 4px}p{color:#64748b;margin:0 0 14px}
  table{border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:4px 8px;white-space:nowrap}th{background:#f1f5f9;position:sticky;top:0}th.v{height:120px;vertical-align:bottom}th.v span{writing-mode:vertical-rl;transform:rotate(180deg);display:inline-block}
  td.r{font-weight:700}td.n{text-align:right}td.h{background:#bfe3f0}td.d{background:#c6efce}td.t{background:#f1f5f9;font-weight:700}tr.hd td{background:#f8fafc}tr.tp td{background:#e2e8f0;font-weight:700}@media print{body{margin:8mm}th{position:static}}</style></head><body>
  <h1>Mängdavtagning</h1><p>${E(name)} per kod och byggnad · ${E(today)}${xl.mode === "klar" || xl.mode === "kvar" ? " · klart vid " + E(qtyAt()) : ""}${qmf.file ? " · förteckning " + E(qmf.file) : ""}</p>
  <table><thead><tr><th>Ref</th><th>Specifikation</th><th>Enhet</th>${T.cols.map(b => `<th class="v"><span>${E(b)}</span></th>`).join("")}<th class="v"><span>Totalt</span></th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}
function xlDownload(text, mime, name) { const url = URL.createObjectURL(new Blob([text], { type: mime })), a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }

/* ---- Kopplingar till händelser -------------------------------------------------------------------------------------------------------------- */
function xlPostGroups(selKey) {
  const order = ["m³", "m²", "m", "st", "kg", "ton"], posts = qmfAllPosts();
  return order.filter(u => posts.some(p => p.unit === u)).map(u => ({ label: `Koder i ${u}`, items: posts.filter(p => p.unit === u && qmfKindOfPost(p)).map(p => ({ id: p.key, v: p.key, t: `${p.ref} – ${p.label} [${p.unit}]`, post: p, cur: p.key === selKey })) }));
}
function xlPickCode(anchor, cb) { qmfCombo(anchor, xlPostGroups(xl.active), it => { if (it.post) cb(it.post); }); }
const xlToast = (t) => { xl.toast = t; if (typeof modelToast === "function") modelToast(t); };
async function xlAfterLink(n, post) { if (qtyNeedsBoxes()) await qtyLoadBoxes(); xl.sel.clear(); xlToast(`${n} lades på ${post.ref} (${QTY_KINDS[qmfKindOfPost(post)][0]}).`); qtyRender(); }
function xlSelectedTargets() {
  const types = [], objs = [], byKey = new Map(qty.objs.map(o => [qmfObjKey(o), o]));
  xl.sel.forEach(s => { if (s.startsWith("t:")) types.push(s.slice(2)); else { const o = byKey.get(s.slice(2)); if (o) objs.push(o); } });
  return { types, objs };
}
async function xlAssign(post, targets) {
  const n = qmfSetLink(targets, post.key);
  const cnt = targets.objs.length + qty.objs.filter(o => targets.types.includes(qmfTypeVal(o))).length;
  await xlAfterLink(cnt || n, post);
}
function xlWire(host, M) {
  const $ = s => host.querySelector(s), sel = (objs, what) => { const o2 = xlMxFilter(objs, xl.mode), nm = (XL_MODES.find(m => m[0] === xl.mode) || [])[1]; if (!o2.length) { if (typeof modelToast === "function") modelToast(`Inga objekt räknas här i läget ${nm}`); return; } qtySelectRows(o2); if (typeof modelToast === "function") modelToast(`${o2.length} objekt markerade i TC – ${what} (${nm})`); };
  const fi = $("#qmfFile"); if (fi) fi.onchange = () => { if (fi.files && fi.files[0]) qmfLoadFile(fi.files[0]); };
  const cl = $("#qmfClear"); if (cl) cl.onclick = () => { qmf.posts = []; qmf.layout = []; qmf.builds = []; qmf.file = ""; qmf.msg = ""; xl.active = ""; try { localStorage.removeItem(QMF_KEY); } catch (e) { /* */ } qtyRender(); };
  host.querySelectorAll("[data-qscope]").forEach(b => b.onclick = () => { qty.cfg.scope = b.dataset.qscope; qtySave(); qtyRender(); });
  $("#qtyRead").onclick = () => qtyRead();
  $("#xlSettingsBtn").onclick = () => { xl.settings = !xl.settings; qtyRender(); };
  const d = $("#qtyDate"); if (d) d.onchange = () => { qty.cfg.date = d.value; qty.cfg.follow = false; qtySave(); qtyRender(); };
  const f = $("#qtyFollow"); if (f) f.onchange = () => { qty.cfg.follow = f.checked; if (f.checked) qty.cfg.date = ""; qtySave(); qtyRender(); };
  // matrisen
  host.querySelectorAll("[data-mxmode]").forEach(b => b.onclick = () => { xl.mode = b.dataset.mxmode; qtyRender(); });
  host.querySelectorAll(".qmf-mxt tr.mx-head.fold").forEach(tr => tr.addEventListener("click", () => { const k = tr.dataset.hk; if (xl.closed.has(k)) xl.closed.delete(k); else xl.closed.add(k); xlSaveClosed(); qtyRender(); }));
  const fa = $("#xlFoldAll"); if (fa) fa.onclick = () => { xlRows(M, false).forEach(r => { if (r.h) xl.closed.add(xlHKey(r)); }); xlSaveClosed(); qtyRender(); };
  const ua = $("#xlUnfoldAll"); if (ua) ua.onclick = () => { xl.closed.clear(); xlSaveClosed(); qtyRender(); };
  const q = $("#xlQ"); if (q) { let t = null; q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { xl.q = q.value; qtyRender(); const q2 = document.getElementById("xlQ"); if (q2) { q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); } }, 250); }); q.addEventListener("keydown", e => e.stopPropagation()); }
  host.querySelectorAll(".qmf-mxt td.mx-c[data-mp]").forEach(td => td.addEventListener("click", () => { const c = (M.cells.get(td.dataset.mp) || new Map()).get(td.dataset.mb), p = xlPost(td.dataset.mp); sel(c ? c.objs : [], `${p ? p.ref : ""} i ${td.dataset.mb}`); }));
  host.querySelectorAll(".qmf-mxt td.mx-ref[data-mp]").forEach(td => td.addEventListener("click", () => { const p = xlPost(td.dataset.mp); xl.active = td.dataset.mp; xl.find = ""; xl.sel.clear(); sel([...(M.cells.get(td.dataset.mp) || new Map()).values()].flatMap(c => c.objs), p ? p.ref : "kod"); qtyRender(); }));
  host.querySelectorAll(".qmf-mxt th[data-mb]").forEach(th => th.addEventListener("click", () => sel([...M.cells.values()].flatMap(m => (m.get(th.dataset.mb) || { objs: [] }).objs), th.dataset.mb)));
  const un = $("#xlUnl"); if (un) un.onclick = () => { if (!M.unlinked.length) return; qtySelectRows(M.unlinked); if (typeof modelToast === "function") modelToast(`${M.unlinked.length} objekt utan kod markerade i TC`); xlPickCode(un, post => { xl.active = post.key; xl.find = ""; xl.onlyUnlinked = true; qtyRender(); }); };
  $("#xlCsv") && ($("#xlCsv").onclick = () => xlDownload(xlCsv(M), "text/csv;charset=utf-8", `Mängdavtagning ${todayISO()}.csv`));
  $("#xlHtml") && ($("#xlHtml").onclick = () => xlDownload(xlHtml(M), "text/html;charset=utf-8", `Mängdavtagning ${todayISO()}.html`));
  // koppla
  const cb = $("#xlClose"); if (cb) cb.onclick = () => { xl.active = ""; xl.find = ""; xl.sel.clear(); qtyRender(); };
  const pk = $("#xlPick"); if (pk) pk.onclick = () => xlPickCode(pk, post => { xl.active = post.key; xl.sel.clear(); qtyRender(); });
  const fd = $("#xlFind"); if (fd) { let t = null; fd.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { xl.find = fd.value; qtyRender(); const f2 = document.getElementById("xlFind"); if (f2) { f2.focus(); f2.setSelectionRange(f2.value.length, f2.value.length); } }, 250); }); fd.addEventListener("keydown", e => e.stopPropagation()); }
  const ou = $("#xlOnlyUn"); if (ou) ou.onchange = () => { xl.onlyUnlinked = ou.checked; qtyRender(); };
  host.querySelectorAll("input[data-xt]").forEach(c => c.onchange = () => { const k = "t:" + c.dataset.xt; if (c.checked) xl.sel.add(k); else xl.sel.delete(k); xlSyncApply(host); });
  host.querySelectorAll("input[data-xo]").forEach(c => c.onchange = () => { const k = "o:" + c.dataset.xo; if (c.checked) xl.sel.add(k); else xl.sel.delete(k); xlSyncApply(host); });
  host.querySelectorAll("[data-xtsel]").forEach(s => s.addEventListener("click", e => { e.preventDefault(); const objs = qty.objs.filter(o => qmfTypeVal(o) === s.dataset.xtsel); qtySelectRows(objs); if (typeof modelToast === "function") modelToast(`${objs.length} objekt markerade i TC`); }));
  host.querySelectorAll("[data-xsel]").forEach(s => s.addEventListener("click", e => { e.preventDefault(); const o = qty.objs.find(x => qmfObjKey(x) === s.dataset.xsel); if (o) qtySelectRows([o]); }));
  const ap = $("#xlApply"); if (ap) ap.onclick = () => { const post = xlPost(xl.active); if (post && xl.sel.size) xlAssign(post, xlSelectedTargets()); };
  const as = $("#xlApplySel"); if (as) as.onclick = async () => {
    const V = API && API.viewer, post = xlPost(xl.active); if (!V || typeof V.getSelection !== "function" || !post) { xlToast("Kräver Trimble Connect-vyn"); return; }
    const s = await V.getSelection(), want = new Set(); let total = 0; (s || []).forEach(x => (x.objectRuntimeIds || []).forEach(r => { want.add(`${x.modelId}|${r}`); total++; }));
    if (!total) { xlToast("Inget är markerat i TC – markera objekten i modellen först"); qtyRender(); return; }
    const objs = qty.objs.filter(o => want.has(`${o.modelId}|${o.rid}`));
    if (!objs.length) { xlToast(`Inga av de ${total} markerade finns i det inlästa urvalet (kolla Urval och Läs mängder igen)`); qtyRender(); return; }
    const ok = await qmfAsk(`Lägga ${objs.length} markerade objekt på ${post.ref} – ${post.label.slice(0, 80)}?${total - objs.length ? ` (${total - objs.length} ingår inte i det inlästa urvalet och hoppas över.)` : ""}`, [["ja", "Ja, lägg dem där"], ["", "Avbryt"]]);
    if (ok) { qmfSetLink({ objs }, post.key); await xlAfterLink(objs.length, post); }
  };
  const ud = $("#xlUndo"); if (ud) ud.onclick = async () => { if (qmfUndo()) { if (qtyNeedsBoxes()) await qtyLoadBoxes(); xlToast("Senaste kopplingen ångrad."); qtyRender(); } };
  // inställningar
  const tk = $("#qmfTypeKey"); if (tk) tk.onchange = () => { qmf.typeKey = tk.value; qmfSave(); qmfAutoMap(); qtyRender(); };
  const gi = $("#qmfGroupId"); if (gi) gi.onchange = () => { qmf.groupId = gi.checked; qmfSave(); qmfAutoMap(); qtyRender(); };
  const rm = $("#xlRebarMode"); if (rm) rm.onchange = () => { qty.cfg.rebarMode = rm.value; qtySave(); qtyRender(); };
  const rk = $("#xlRebarKg"); if (rk) rk.onchange = () => { const v = Number(String(rk.value).replace(",", ".")); qty.cfg.rebarKg = isFinite(v) && v >= 0 ? v : 100; qtySave(); qtyRender(); };
  const ft = $("#qtyFormTop"); if (ft) ft.onchange = () => { qty.cfg.formTop = ft.checked; qtySave(); qtyRender(); };
  const un2 = $("#qtyUnit"); if (un2) un2.onchange = async () => { qty.cfg.unit = un2.value; qtySave(); await qtyPrepare(); qtyRender(); };
  const fr = $("#qtyFrom"); if (fr) fr.onchange = () => { qty.cfg.from = fr.value; qtySave(); qtyRender(); };
  host.querySelectorAll("select[data-ar]").forEach(se => se.onchange = () => { if (se.value) qmf.map.areas[se.dataset.ar] = se.value; else delete qmf.map.areas[se.dataset.ar]; qmfSave(); qtyRender(); });
  const np = $("#qmfNewPost"); if (np) np.onclick = () => qmfNewPost("", p => { if (p) qtyRender(); });
  host.querySelectorAll(".xl-cu").forEach(row => {
    const p = qmf.custom.find(x => x.key === row.dataset.ck); if (!p) return;
    row.querySelector(".xl-cedit").onclick = () => qmfNewPost("", r => { if (r) qtyRender(); }, p);
    row.querySelector(".xl-cdel").onclick = async () => {
      const n = qmfCustomUse(p.key), ok = await qmfAsk(`Ta bort den egna koden "${p.ref} – ${p.label}"?${n ? ` ${n} koppling${n > 1 ? "ar" : ""} till den tas bort.` : ""}`, [["ja", "Ta bort"], ["", "Avbryt"]]);
      if (!ok) return;
      ["types", "obj"].forEach(k => Object.values(qmf.map[k] || {}).forEach(m => Object.keys(m).forEach(x => { if (m[x] === p.key) delete m[x]; })));
      qmf.custom = qmf.custom.filter(x => x !== p); (qmf.customGone = qmf.customGone || []).push(p.key); if (xl.active === p.key) xl.active = ""; qmfSave(); qmfSaveCustom(); qtyRender();
    };
  });
}
function xlSyncApply(host) { const b = host.querySelector("#xlApply"), post = xlPost(xl.active); if (!b || !post) return; b.disabled = !xl.sel.size; b.textContent = `Koppla ${xl.sel.size || ""} valda till ${post.ref}`; }
function initQuantities() { if (document.getElementById("qtyBox")) qtyRender(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initQuantities); else setTimeout(initQuantities, 0);
