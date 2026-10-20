/* Test-fliken (Victor 2026-10-20): ett labb bredvid Staplar/Tavla där idéer provas innan de ev. byggs in i appen.
   Här: 1 Projektkapsel, 2 Mitt-vecka per entreprenör, 3 QR på plats, 4 Dossier per delområde (lab.js) samt
   5 Prognos, 6 Mängd→tid, 8 Platsdiagram, 9 Trängsel, 10 Logistik (lab-analytics.js). Allt är läsande – inget skrivs till projektet. */
const LAB_TABS = [["capsule", "1 Kapsel"], ["week", "2 Mitt-vecka"], ["qr", "3 QR"], ["dossier", "4 Dossier"], ["forecast", "5 Prognos"], ["qtytime", "6 Mängd→tid"], ["place", "8 Platsdiagram"], ["crowd", "9 Trängsel"], ["logi", "10 Logistik"]];
const lab = { tab: (() => { try { return localStorage.getItem("4ddash-lab-tab") || "capsule"; } catch (e) { return "capsule"; } })(), el: null, state: {} };
const labEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const labNum = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString("sv-SE", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
const labDiff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
const labAdd = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const labIsWork = s => { const w = new Date(s + "T00:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };
const labWorkDays = (a, b) => { let n = 0; for (let d = a, g = 0; d <= b && g < 4000; d = labAdd(d, 1), g++) if (labIsWork(d)) n++; return n; };

/* Aktiviteterna som visas i schemat (filter och sökning följs), ihopslagna per aktivitet. */
function labHoursOf(a) {
  const ms = a.members || [a]; let best = 0;
  ms.forEach(m => { const h = Number.isFinite(m.estimatedHours) ? m.estimatedHours : (m.resources || []).reduce((s, r) => s + (Number(r.hours) || 0), 0); if (h > best) best = h; });
  return best || null;
}
function labActs() {
  const list = (typeof ganttShownItems !== "undefined" && ganttShownItems.length ? ganttShownItems : getFilteredItems());
  const seen = new Set();
  return list.filter(a => a.startDate && a.endDate).filter(a => { const k = a.activityKey || a.id; if (seen.has(k)) return false; seen.add(k); return true; }).map(a => ({
    id: a.id, key: a.activityKey || String(a.id), name: a.objectName || a.activity || "Aktivitet", area: a.area || "–", activity: a.activity || "", contractor: a.contractor || "–",
    s: a.startDate, e: a.endDate, as: a.actualStartDate || "", ae: a.actualEndDate || "", bs: a.baselineStartDate || "", be: a.baselineEndDate || "", p: Number(a.progress) || 0,
    st: a.status || "planerad", h: labHoursOf(a), deps: (a.dependsOn || []).slice(), it: a, members: a.members || [a]
  }));
}
/* Mängder per aktivitet ur mängdavtagningen (om den är inläst): { aktivitetsnyckel: { vol, form, len, cnt } } */
function labQtyByKey() {
  if (typeof qty === "undefined" || !qty.objs || !qty.objs.length || typeof qtyValue !== "function") return null;
  const out = new Map();
  qty.objs.forEach(o => {
    const it = o.item || {}, k = it.activityKey || String(it.id); if (!k || k === "undefined") return;
    const e = out.get(k) || { vol: 0, form: 0, len: 0, cnt: 0 };
    ["vol", "form", "len", "cnt"].forEach(q => { const v = qtyValue(o, q); if (Number.isFinite(v)) e[q] += v; });
    out.set(k, e);
  });
  return out;
}
function labDownload(name, text, mime) {
  const a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type: mime || "text/html;charset=utf-8" }));
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const labStamp = () => new Date().toISOString().slice(0, 10);
const labSafe = s => String(s || "").replace(/[^\wåäöÅÄÖ.-]+/g, "_").slice(0, 40) || "fil";
const labAreas = acts => [...new Set(acts.map(a => a.area))].sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
const labCons = acts => [...new Set(acts.map(a => a.contractor))].sort((a, b) => a.localeCompare(b, "sv"));

/* ---- Det som exporteras: data + en liten fristående sida (ingen server, ingen TC) --------------------------------------------------- */
function labData(opts = {}) {
  const acts = labActs(), q = opts.qty === false ? null : labQtyByKey();
  return {
    title: opts.title || "Projektkapsel", generated: new Date().toISOString().slice(0, 16).replace("T", " "), defaultHash: opts.hash || "",
    acts: acts.map(a => ({ n: a.name, a: a.area, c: a.contractor, t: a.activity, s: a.s, e: a.e, as: a.as, ae: a.ae, be: a.be, p: a.p, st: a.st, h: a.h, q: q && q.get(a.key) ? { v: +q.get(a.key).vol.toFixed(1), f: +q.get(a.key).form.toFixed(1), l: +q.get(a.key).len.toFixed(1), k: Math.round(q.get(a.key).cnt) } : null })),
    deliveries: opts.deliveries === false ? [] : (typeof deliveries !== "undefined" ? deliveries : []).map(d => ({ d: d.actual_date || d.planned_date || "", u: d.until_date || "", t: d.description || d.name || d.supplier || "Leverans", a: d.area || "", s: d.supplier || "", ok: !!d.actual_date })),
    blockers: opts.blockers === false ? [] : (typeof blockers !== "undefined" ? blockers : []).filter(b => !b.resolved).map(b => ({ t: b.title || b.description || "Hinder", due: b.deadline || b.due_date || "", o: b.owner || b.responsible || "" })),
    image: opts.image || ""
  };
}
function labRuntime(D) {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const iso = d => d.toISOString().slice(0, 10), today = iso(new Date());
  const add = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const diff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
  const COL = { planerad: "#cbd5e1", pagaende: "#3b82f6", forsenad: "#ef4444", klar: "#22c55e" }, LAB = { planerad: "Planerad", pagaende: "Pågående", forsenad: "Försenad", klar: "Klar" };
  const hp = () => new URLSearchParams(location.hash.slice(1));
  const st = { omr: "", ue: "", q: "", at: today, play: null };
  const init = new URLSearchParams((D.defaultHash || "").replace(/^#/, "")), cur = hp();
  st.omr = cur.get("omr") || init.get("omr") || ""; st.ue = cur.get("ue") || init.get("ue") || "";
  const all = D.acts.filter(a => a.s && a.e);
  const mn = all.reduce((m, a) => (a.s < m ? a.s : m), all[0] ? all[0].s : today), mx = all.reduce((m, a) => (a.e > m ? a.e : m), all[0] ? all[0].e : today);
  if (today >= mn && today <= mx) st.at = today; else st.at = mn;
  const phase = (a, d) => (a.st === "klar" || (a.ae && a.ae <= d) ? "klar" : a.e < d ? (a.p >= 100 ? "klar" : "forsenad") : a.s > d ? "planerad" : "pagaende");
  const vis = () => all.filter(a => (!st.omr || a.a === st.omr) && (!st.ue || a.c === st.ue) && (!st.q || (a.n + " " + a.t + " " + a.a).toLowerCase().includes(st.q.toLowerCase())));
  const opt = (arr, v, label) => `<select data-f="${label}"><option value="">${label === "omr" ? "Alla områden" : "Alla entreprenörer"}</option>${arr.map(x => `<option${x === v ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  const card = a => `<div class="c"><b>${esc(a.n)}</b><small>${esc(a.a)} · ${esc(a.c)} · ${a.s.slice(5)} → ${a.e.slice(5)}</small><div class="pb"><i style="width:${Math.min(100, a.p)}%;background:${COL[phase(a, st.at)]}"></i></div>${a.q ? `<small>${a.q.v ? a.q.v + " m³ " : ""}${a.q.f ? a.q.f + " m² " : ""}${a.q.k ? a.q.k + " st" : ""}</small>` : ""}</div>`;
  function render() {
    const rows = vis(), areas = [...new Set(all.map(a => a.a))].sort(), cons = [...new Set(all.map(a => a.c))].sort();
    const wk = add(today, 7), prev = add(today, -7);
    const nowL = rows.filter(a => a.s <= today && a.e >= today && a.st !== "klar"), nextL = rows.filter(a => a.s > today && a.s <= wk), doneL = rows.filter(a => (a.ae || a.e) >= prev && (a.ae || a.e) < today && (a.st === "klar" || a.p >= 100));
    const late = rows.filter(a => phase(a, today) === "forsenad");
    const near = st.ue ? [...new Set(all.filter(a => a.c !== st.ue && a.s <= wk && a.e >= today && rows.some(r => r.a === a.a)).map(a => a.c + " – " + a.a))] : [];
    const dl = D.deliveries.filter(d => d.d >= prev && d.d <= add(today, 14) && (!st.omr || !d.a || d.a === st.omr));
    let h = `<header><h1>${esc(D.title)}</h1><small>Skapad ${esc(D.generated)} · ${all.length} aktiviteter</small></header>
      <div class="bar">${opt(areas, st.omr, "omr")}${opt(cons, st.ue, "ue")}<input data-f="q" placeholder="Sök …" value="${esc(st.q)}"></div>
      <div class="kpi"><div><b>${nowL.length}</b>pågår idag</div><div><b>${nextL.length}</b>startar inom 7 d</div><div class="${late.length ? "bad" : ""}"><b>${late.length}</b>försenade</div><div><b>${rows.length ? Math.round(rows.reduce((s, a) => s + a.p, 0) / rows.length) : 0} %</b>snitt framsteg</div></div>`;
    if (D.image) h += `<img class="img" src="${D.image}" alt="3D-vy">`;
    h += `<section><h2>Pågår idag</h2>${nowL.map(card).join("") || "<p class=m>Inget pågår idag.</p>"}</section>
      <section><h2>Startar de närmaste 7 dagarna</h2>${nextL.map(card).join("") || "<p class=m>Inget.</p>"}</section>
      ${late.length ? `<section><h2>Försenade</h2>${late.map(card).join("")}</section>` : ""}
      ${near.length ? `<section><h2>Bredvid dig den här veckan</h2><p>${near.map(esc).join("<br>")}</p></section>` : ""}
      <section><h2>Klart senaste veckan</h2>${doneL.map(card).join("") || "<p class=m>Inget.</p>"}</section>
      ${dl.length ? `<section><h2>Leveranser</h2><table>${dl.map(d => `<tr><td>${esc(d.d)}${d.u && d.u !== d.d ? "–" + esc(d.u.slice(5)) : ""}</td><td>${esc(d.t)}</td><td>${esc(d.s)}</td><td>${d.ok ? "✔ levererad" : ""}</td></tr>`).join("")}</table></section>` : ""}
      ${D.blockers.length ? `<section><h2>Öppna hinder</h2><table>${D.blockers.map(b => `<tr><td>${esc(b.t)}</td><td>${esc(b.o)}</td><td>${esc(b.due)}</td></tr>`).join("")}</table></section>` : ""}
      <section><h2>Tidslinje</h2><div class="sc"><button data-a="play">▶</button><input type="range" data-f="at" min="0" max="${Math.max(1, diff(mn, mx))}" value="${Math.max(0, diff(mn, st.at))}"><b>${esc(st.at)}</b></div><div class="g">${rows.slice(0, 400).map(a => { const sp = Math.max(1, diff(mn, mx)), l = diff(mn, a.s) / sp * 100, w = Math.max(0.6, (diff(a.s, a.e) + 1) / sp * 100), p = phase(a, st.at); return `<div class="r"><span title="${esc(a.n)}">${esc(a.n)}</span><div class="t"><i class="b" style="left:${l}%;width:${w}%;background:${COL[p]}" title="${esc(LAB[p])} · ${a.s} → ${a.e}"></i><u style="left:${diff(mn, st.at) / sp * 100}%"></u></div></div>`; }).join("")}</div></section>`;
    document.getElementById("app").innerHTML = h;
  }
  document.body.innerHTML = `<div id="app"></div>`;
  document.addEventListener("change", e => { const f = e.target.dataset.f; if (f === "omr" || f === "ue") { st[f] = e.target.value; render(); } });
  document.addEventListener("input", e => { const f = e.target.dataset.f; if (f === "q") { st.q = e.target.value; const p = e.target.selectionStart; render(); const n = document.querySelector("[data-f=q]"); n.focus(); n.setSelectionRange(p, p); } else if (f === "at") { st.at = add(mn, Number(e.target.value)); render(); const n = document.querySelector("[data-f=at]"); n.focus(); } });
  document.addEventListener("click", e => { if (e.target.dataset.a !== "play") return; if (st.play) { clearInterval(st.play); st.play = null; e.target.textContent = "▶"; return; } st.play = setInterval(() => { st.at = add(st.at, 3); if (st.at > mx) { st.at = mn; } render(); const b = document.querySelector("[data-a=play]"); if (b) b.textContent = "⏸"; }, 200); });
  render();
}
const LAB_CSS = `body{font:15px/1.4 system-ui,Segoe UI,Arial,sans-serif;margin:0;padding:12px 14px 40px;background:#f6f8fa;color:#1f2328;max-width:900px;margin:auto}h1{margin:0;font-size:22px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#57606a;margin:20px 0 6px}small{color:#6b7280;display:block}.bar{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}select,input[data-f=q]{font:inherit;padding:6px 8px;border:1px solid #d0d7de;border-radius:8px;background:#fff;max-width:100%}.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}.kpi div{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:8px 10px;font-size:12px;color:#57606a}.kpi b{display:block;font-size:22px;color:#1f2328}.kpi .bad b{color:#cf222e}.c{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:8px 10px;margin:6px 0}.pb{height:6px;background:#eef0f3;border-radius:3px;margin-top:5px;overflow:hidden}.pb i{display:block;height:100%}.m{color:#8c959f}table{width:100%;border-collapse:collapse;font-size:13px;background:#fff}td,th{border-bottom:1px solid #eef0f3;padding:5px 6px;text-align:left}.img{width:100%;border-radius:10px;margin:10px 0}.sc{display:flex;gap:8px;align-items:center}.sc input{flex:1}.sc button{padding:4px 12px;border:1px solid #d0d7de;border-radius:8px;background:#fff}.g .r{display:grid;grid-template-columns:minmax(90px,28%) 1fr;gap:6px;align-items:center;font-size:11px;height:18px}.g span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.t{position:relative;height:10px;background:#eef0f3;border-radius:5px}.b{position:absolute;top:0;height:10px;border-radius:5px}.t u{position:absolute;top:-3px;bottom:-3px;width:2px;background:#1f2328}@media print{body{background:#fff}.bar,.sc{display:none}}`;
function labCapsuleHtml(opts) {
  const D = labData(opts), json = JSON.stringify(D).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${labEsc(D.title)}</title><style>${LAB_CSS}</style></head><body><script>(${labRuntime.toString()})(${json});<\/script></body></html>`;
}

/* ---- Dossier per delområde (utskriftsvänlig HTML) -------------------------------------------------------------------------------------- */
function labDossierHtml(areas, title) {
  const acts = labActs(), q = labQtyByKey(), dl = typeof deliveries !== "undefined" ? deliveries : [], bl = typeof blockers !== "undefined" ? blockers : [];
  const late = a => (a.ae || (a.st === "klar" ? a.e : "")) && a.be ? labDiff(a.be, a.ae || a.e) : null;
  const pages = areas.map(ar => {
    const rows = acts.filter(a => a.area === ar).sort((a, b) => a.s.localeCompare(b.s));
    const done = rows.filter(a => a.st === "klar" || a.p >= 100).length, tot = { v: 0, f: 0 };
    rows.forEach(a => { const e = q && q.get(a.key); if (e) { tot.v += e.vol; tot.f += e.form; } });
    const d = dl.filter(x => x.area === ar);
    return `<section><h1>${labEsc(ar)}</h1><p class=m>${labEsc(title)} · ${labStamp()} · ${rows.length} aktiviteter, ${done} klara${q ? ` · ${labNum(tot.v, 1)} m³ betong, ${labNum(tot.f, 0)} m² form` : ""}</p>
      <table><tr><th>Aktivitet</th><th>Entreprenör</th><th>Planerat</th><th>Utfall</th><th>Avvikelse</th><th>%</th>${q ? "<th>m³</th><th>m²</th>" : ""}</tr>${rows.map(a => { const l = late(a), e = q && q.get(a.key); return `<tr><td>${labEsc(a.name)}</td><td>${labEsc(a.contractor)}</td><td>${a.s} → ${a.e}</td><td>${a.as || a.ae ? `${a.as || "–"} → ${a.ae || "–"}` : "–"}</td><td class="${l > 0 ? "bad" : ""}">${l === null ? "" : (l > 0 ? "+" : "") + l + " d"}</td><td>${a.p}</td>${q ? `<td>${e ? labNum(e.vol, 1) : ""}</td><td>${e ? labNum(e.form, 0) : ""}</td>` : ""}</tr>`; }).join("")}</table>
      ${d.length ? `<h3>Leveranser</h3><table>${d.map(x => `<tr><td>${labEsc(x.planned_date || "")}</td><td>${labEsc(x.description || x.name || x.supplier || "")}</td><td>${x.actual_date ? "levererad " + labEsc(x.actual_date) : "ej levererad"}</td></tr>`).join("")}</table>` : ""}
      <p class=m>Foton och kontroller läggs till här när de finns kopplade till området.</p></section>`;
  });
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>${labEsc(title)} – dossier</title><style>body{font:13px/1.4 system-ui,Arial,sans-serif;margin:0;padding:18px;color:#1f2328}section{page-break-after:always;margin-bottom:30px}h1{margin:0 0 2px}h3{margin:16px 0 4px}.m{color:#6b7280}table{width:100%;border-collapse:collapse;margin-top:8px}td,th{border:1px solid #d8dee4;padding:4px 6px;text-align:left}th{background:#f6f8fa}.bad{color:#cf222e;font-weight:700}@media print{body{padding:0}}</style></head><body>${pages.join("")}</body></html>`;
}

/* ---- Fliken ---------------------------------------------------------------------------------------------------------------------------------- */
function labRender(list, el, target) {
  if (target) return false;
  el.innerHTML = `<div class="lab-root"><div class="lab-tabs" role="tablist">${LAB_TABS.map(([k, t]) => `<button type="button" role="tab" data-lab="${k}" class="${k === lab.tab ? "on" : ""}">${labEsc(t)}</button>`).join("")}</div><div id="labBody" class="lab-body"></div></div>`;
  lab.el = el;
  el.querySelector(".lab-tabs").onclick = e => { const b = e.target.closest("[data-lab]"); if (!b) return; lab.tab = b.dataset.lab; try { localStorage.setItem("4ddash-lab-tab", lab.tab); } catch (x) { /* */ } labRender(null, el); };
  labBody();
  return true;
}
function labBody() {
  const b = document.getElementById("labBody"); if (!b) return;
  const acts = labActs(), fn = { capsule: labTabCapsule, week: labTabWeek, qr: labTabQr, dossier: labTabDossier, forecast: window.labTabForecast, qtytime: window.labTabQtyTime, place: window.labTabPlace, crowd: window.labTabCrowd, logi: window.labTabLogi }[lab.tab];
  if (!acts.length && lab.tab !== "qtytime") { b.innerHTML = `<p class="hint">Inga aktiviteter med datum i urvalet. Ändra filtren ovanför.</p>`; return; }
  try { if (typeof fn === "function") fn(b, acts); else b.innerHTML = `<p class="hint">Fliken är inte inläst.</p>`; } catch (e) { console.warn("Test", e); b.innerHTML = `<p class="hint">Fel: ${labEsc(e.message)}</p>`; }
}
function labPreview(host, html) {
  const f = document.createElement("iframe"); f.className = "lab-frame"; f.setAttribute("sandbox", "allow-scripts"); f.srcdoc = html; host.innerHTML = ""; host.appendChild(f);
}
const labQtyNote = () => (labQtyByKey() ? `<span class="hint">Mängder från Mängdavtagningen tas med.</span>` : `<span class="hint">Mängder tas med om du först läst in dem i Mängdavtagningen.</span>`);

function labTabCapsule(b, acts) {
  b.innerHTML = `<p class="hint">En enda HTML-fil med aktiviteter, tidslinje med play, leveranser och hinder. Den öppnas på mobil och dator utan Trimble Connect – skicka den eller lägg den i en TC-mapp. 3D-modellen följer inte med (ännu).</p>
    <div class="lab-row"><label>Titel <input id="labTitle" value="${labEsc(lab.state.title || "Projektkapsel")}"></label>
    <label><input type="checkbox" id="labDl" checked> Leveranser</label><label><input type="checkbox" id="labBl" checked> Hinder</label><label><input type="checkbox" id="labImg"> Bild från 3D-vyn</label> ${labQtyNote()}</div>
    <div class="lab-row"><button type="button" class="primary" id="labMake">Skapa och ladda ner</button><button type="button" id="labPrev">Förhandsgranska här</button><span id="labInfo" class="hint"></span></div><div id="labPv"></div>`;
  const opts = async () => { lab.state.title = b.querySelector("#labTitle").value; const o = { title: lab.state.title, deliveries: b.querySelector("#labDl").checked, blockers: b.querySelector("#labBl").checked }; if (b.querySelector("#labImg").checked) { try { const s = await API.viewer.getSnapshot(); o.image = typeof s === "string" ? s : (s && (s.data || s.dataUrl)) || ""; } catch (e) { modelToast("Kunde inte ta bild av 3D-vyn"); } } return o; };
  b.querySelector("#labMake").onclick = async () => { const h = labCapsuleHtml(await opts()); labDownload(`kapsel_${labStamp()}.html`, h); b.querySelector("#labInfo").textContent = `Skapad (${Math.round(h.length / 1024)} kB)`; };
  b.querySelector("#labPrev").onclick = async () => labPreview(b.querySelector("#labPv"), labCapsuleHtml(await opts()));
}
function labTabWeek(b, acts) {
  const cons = labCons(acts);
  b.innerHTML = `<p class="hint">Samma fil som kapseln, men öppnad direkt på en entreprenörs vecka: det som pågår, det som startar, försenat, vilka som arbetar bredvid och leveranser.</p>
    <div class="lab-row"><label>Entreprenör <select id="labUe">${cons.map(c => `<option>${labEsc(c)}</option>`).join("")}</select></label>
    <button type="button" class="primary" id="labOne">Skapa fil</button><button type="button" id="labAll">En fil per entreprenör (${cons.length})</button><button type="button" id="labPrev">Förhandsgranska</button></div><div id="labPv"></div>`;
  const mk = ue => labCapsuleHtml({ title: `Vecka – ${ue}`, hash: "ue=" + encodeURIComponent(ue) });
  b.querySelector("#labOne").onclick = () => { const ue = b.querySelector("#labUe").value; labDownload(`vecka_${labSafe(ue)}_${labStamp()}.html`, mk(ue)); };
  b.querySelector("#labAll").onclick = () => cons.forEach((ue, i) => setTimeout(() => labDownload(`vecka_${labSafe(ue)}_${labStamp()}.html`, mk(ue)), i * 400));
  b.querySelector("#labPrev").onclick = () => labPreview(b.querySelector("#labPv"), mk(b.querySelector("#labUe").value));
}
function labTabQr(b, acts) {
  const areas = labAreas(acts), key = "4ddash-lab-qrbase";
  let base = ""; try { base = localStorage.getItem(key) || ""; } catch (e) { /* */ }
  b.innerHTML = `<p class="hint">1. Skapa kapseln (flik 1) och lägg filen där mobilerna kan öppna den (t.ex. en TC-mapp med delningslänk, eller en webbserver). 2. Klistra in filens webbadress här. 3. Skriv ut QR-bladen – varje QR öppnar kapseln direkt på just det delområdet.</p>
    <div class="lab-row"><label style="flex:1">Webbadress till kapseln <input id="labBase" style="width:100%" placeholder="https://…/kapsel.html" value="${labEsc(base)}"></label><button type="button" class="primary" id="labQrPrint">Skriv ut / spara QR-blad</button></div><div id="labQrs" class="lab-qrs"></div>`;
  const draw = () => {
    const bs = b.querySelector("#labBase").value.trim(); try { localStorage.setItem(key, bs); } catch (e) { /* */ }
    b.querySelector("#labQrs").innerHTML = areas.map(a => { const url = (bs || "https://exempel.se/kapsel.html") + "#omr=" + encodeURIComponent(a); let svg = ""; try { svg = qrSvg(url, 150); } catch (e) { svg = "<small>För lång adress</small>"; } return `<figure class="${bs ? "" : "off"}">${svg}<figcaption><b>${labEsc(a)}</b><small>${acts.filter(x => x.area === a).length} akt.</small></figcaption></figure>`; }).join("");
  };
  b.querySelector("#labBase").oninput = draw; draw();
  b.querySelector("#labQrPrint").onclick = () => {
    const bs = b.querySelector("#labBase").value.trim(); if (!bs) { modelToast("Skriv in kapselns webbadress först"); return; }
    const pages = areas.map(a => { const rows = acts.filter(x => x.area === a).sort((x, y) => x.s.localeCompare(y.s)).slice(0, 8); return `<section><h1>${labEsc(a)}</h1><div class=q>${qrSvg(bs + "#omr=" + encodeURIComponent(a), 520)}</div><p>Skanna för dagens uppgifter, leveranser och tidplan för området.</p><ul>${rows.map(r => `<li>${labEsc(r.name)} <small>${r.s.slice(5)}–${r.e.slice(5)} · ${labEsc(r.contractor)}</small></li>`).join("")}</ul></section>`; }).join("");
    labDownload(`qr-blad_${labStamp()}.html`, `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>QR-blad</title><style>body{font:16px system-ui,Arial,sans-serif;margin:0}section{page-break-after:always;text-align:center;padding:30px}h1{font-size:44px;margin:0 0 10px}.q svg{width:70%;max-width:520px;height:auto}small{color:#6b7280}ul{display:inline-block;text-align:left}</style></head><body>${pages}</body></html>`);
  };
}
function labTabDossier(b, acts) {
  const areas = labAreas(acts);
  b.innerHTML = `<p class="hint">Samlad dokumentation per delområde: planerat mot utfall, avvikelser, mängder och leveranser. Öppna filen och välj Skriv ut → Spara som PDF.</p>
    <div class="lab-row"><label>Område <select id="labAr"><option value="*">Alla (en sida per område)</option>${areas.map(a => `<option>${labEsc(a)}</option>`).join("")}</select></label><button type="button" class="primary" id="labDo">Skapa och ladda ner</button><button type="button" id="labPrev">Förhandsgranska</button> ${labQtyNote()}</div><div id="labPv"></div>`;
  const mk = () => { const v = b.querySelector("#labAr").value; return labDossierHtml(v === "*" ? areas : [v], "Dossier"); };
  b.querySelector("#labDo").onclick = () => labDownload(`dossier_${labSafe(b.querySelector("#labAr").value === "*" ? "alla" : b.querySelector("#labAr").value)}_${labStamp()}.html`, mk());
  b.querySelector("#labPrev").onclick = () => labPreview(b.querySelector("#labPv"), mk());
}
