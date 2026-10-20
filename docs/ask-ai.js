/* Fråga AI (Victor 2026-10-20): utan API och utan extra kostnad. Dashboarden skapar en HTML-fil med det som visas i Gantt-schemat
   (aktiviteter, datum, beroenden, framdrift …) plus instruktioner till Claude. Du matar Claude med filen och ställer din fråga eller
   ber om en omplanering. Svarar Claude med en ändringslista (JSON) klistrar du in den här: dashboarden visar före/efter och
   beroendekrockar, och först när du trycker Tillämpa ändras något – via samma sparning som när du drar i schemat (Ångra fungerar). */
const ASKAI_MAP_KEY = "4ddash-askai-map";
const askAiDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const askAiIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !isNaN(Date.parse(v));
const ASKAI_STATUS = { planerad: "planerad", pagaende: "pågående", forsenad: "försenad", klar: "klar" };

/* Aktiviteterna (en rad per aktivitet, flera objekt slås ihop) med ref A1, A2 … som Claude pekar på i svaret. */
function askAiRows(scope) {
  const src = scope === "all" ? items : getFilteredItems();
  const acts = mergeActivityGroups(src.filter(it => it.startDate && it.endDate));
  acts.sort((a, b) => String(a.area).localeCompare(String(b.area), "sv", { numeric: true }) || String(a.startDate).localeCompare(String(b.startDate)) || String(a.objectName).localeCompare(String(b.objectName), "sv", { numeric: true }));
  const rows = acts.map((a, i) => ({ a, ref: "A" + (i + 1), members: a.members || [a] }));
  const idRef = new Map(); rows.forEach(r => r.members.forEach(m => idRef.set(String(m.id), r.ref)));
  rows.forEach(r => {
    const deps = new Map();
    r.members.forEach(m => (m.dependsOn || []).forEach(pid => { const pr = idRef.get(String(pid)); if (!pr || pr === r.ref) return; const lag = lagOf(m, pid); deps.set(pr, lag !== undefined ? lag : (deps.get(pr) || 0)); }));
    r.deps = [...deps.entries()].map(([p, lag]) => (lag ? `${p} (${lag > 0 ? "+" : "−"}${Math.abs(lag)} d)` : p));
  });
  return rows;
}
function askAiFilterText() {
  const p = [], f = filters || {}, nm = v => (v === FILTER_NONE ? "(saknas)" : v);
  if ((f.area || []).length) p.push("område: " + f.area.map(nm).join(", "));
  if ((f.activity || []).length) p.push("aktivitet: " + f.activity.map(nm).join(", "));
  if ((f.contractor || []).length) p.push("entreprenör: " + f.contractor.map(nm).join(", "));
  return p.join(" · ");
}
function askAiHtml(rows, opts) {
  const E = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), today = todayISO(), withBl = opts.baseline !== false;
  const prompt = `Du hjälper en platschef/produktionsplanerare på ett byggprojekt (NCC). Tabellen längst ner är ett utdrag ur deras tidplan (4D-dashboard, ${today}). Svara på svenska och bygg bara på tabellen – gissa inte det som inte står där, och säg till om underlaget inte räcker.
• Datum är ISO (ÅÅÅÅ-MM-DD) och räknas i kalenderdagar. "Idag" är ${today}.
• Status: planerad / pågående / försenad / klar. Framdrift är i procent. "Föregångare" är aktiviteter (ref) som ska vara klara innan raden startar; "(+3 d)" är väntetid och "(−2 d)" överlapp.
• Är frågan en fråga: svara med en tydlig analys (vad, varför, vilka ref:ar), gärna rangordnad efter vad som är viktigast.
• Ber användaren om en omplanering: föreslå nya datum, håll beroendena (en efterföljare ska inte starta före föregångarens slut plus väntetid), rör inte aktiviteter som är klara om det inte efterfrågas, undvik att lägga start/slut på lördag/söndag om aktiviteten inte redan gör det, och förklara kort varje ändring. Ta med följdeffekter på efterföljare.
• Avsluta ALLTID en omplanering med exakt ett kodblock i detta format (bara de aktiviteter som ändras, ref ur tabellen, nya datum):
\`\`\`json
{"andringar":[{"ref":"A12","start":"ÅÅÅÅ-MM-DD","slut":"ÅÅÅÅ-MM-DD","kommentar":"kort skäl"}]}
\`\`\`
Användaren klistrar in blocket i dashboarden, ser före/efter och godkänner själv.`;
  const th = ["Ref", "Aktivitet", "Område", "Entreprenör", "Start", "Slut", "Dagar", "Framdrift %", "Status", ...(withBl ? ["Baslinje"] : []), "Föregångare", "Objekt"];
  const trs = rows.map(r => { const a = r.a; return `<tr><td>${r.ref}</td><td>${E(a.objectName)}${a.activity && a.activity !== a.objectName ? ` <i>${E(a.activity)}</i>` : ""}</td><td>${E(a.area)}</td><td>${E(a.contractor)}</td><td>${a.startDate}</td><td>${a.endDate}</td><td>${askAiDays(a.startDate, a.endDate) + 1}</td><td>${a.progress || 0}</td><td>${E(ASKAI_STATUS[a.status] || a.status || "")}</td>${withBl ? `<td>${a.baselineStartDate && a.baselineEndDate ? `${a.baselineStartDate} – ${a.baselineEndDate}` : ""}</td>` : ""}<td>${E(r.deps.join(", "))}</td><td>${r.members.length}</td></tr>`; }).join("\n");
  const q = String(opts.question || "").trim(), fl = askAiFilterText();
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fråga AI – planeringsunderlag ${today}</title>
<style>body{font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif;margin:0;background:#f3f5f9;color:#0f172a}.w{max-width:1250px;margin:0 auto;padding:20px 16px 60px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 8px}.s{color:#64748b}.b{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;white-space:pre-wrap}table{border-collapse:collapse;width:100%;background:#fff;font-size:12.5px}th,td{border:1px solid #e2e8f0;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f1f5f9;position:sticky;top:0}i{color:#64748b}@media(prefers-color-scheme:dark){body{background:#0b1220;color:#e5ebf5}.b,table{background:#131c2e;border-color:#243049}th{background:#1b263b}th,td{border-color:#243049}}</style></head><body><div class="w">
<h1>Planeringsunderlag för Claude</h1><div class="s">Skapad ${new Date().toLocaleString("sv-SE")} ur 4D-dashboarden · ${rows.length} aktiviteter${fl ? " · urval – " + E(fl) : opts.scope === "all" ? " · alla aktiviteter" : ""}</div>
<h2>Uppdrag till Claude</h2><div class="b">${E(prompt)}</div>
<h2>Användarens fråga eller önskemål</h2><div class="b">${q ? E(q) : "(Ingen fråga skriven – be användaren om vad hen vill veta eller planera om.)"}</div>
<h2>Tidplanen (${rows.length} aktiviteter)</h2><table><thead><tr>${th.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>
${trs}
</tbody></table></div></body></html>`;
}
function askAiSaveMap(rows) {
  const m = { at: new Date().toISOString(), rows: rows.map(r => ({ ref: r.ref, ids: r.members.map(x => x.id), start: r.a.startDate, end: r.a.endDate, name: itemLabel(r.a) })) };
  try { localStorage.setItem(ASKAI_MAP_KEY, JSON.stringify(m)); return true; } catch (e) { return false; }
}
const askAiLoadMap = () => { try { const m = JSON.parse(localStorage.getItem(ASKAI_MAP_KEY) || "null"); return m && Array.isArray(m.rows) ? m : null; } catch (e) { return null; } };

/* Hittar ändringslistan i Claudes svar: kodblock, annars första JSON-objektet som innehåller "andringar". */
function askAiParse(text) {
  const cands = [], re = /```(?:json)?\s*([\s\S]*?)```/gi; let m;
  while ((m = re.exec(text))) cands.push(m[1]);
  const i = text.search(/\{\s*"(?:andringar|ändringar|changes)"/);
  if (i >= 0) { let d = 0, j = i, inStr = false, esc = false; for (; j < text.length; j++) { const c = text[j]; if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; } else if (c === '"') inStr = true; else if (c === "{") d++; else if (c === "}" && --d === 0) { cands.push(text.slice(i, j + 1)); break; } } }
  for (const c of cands) {
    try { const o = JSON.parse(c.trim()), list = o.andringar || o["ändringar"] || o.changes || (Array.isArray(o) ? o : null); if (Array.isArray(list)) return list; } catch (e) { /* nästa */ }
  }
  return null;
}
/* Före/efter för varje föreslagen ändring, mot dagens data. */
function askAiPreview(list) {
  const map = askAiLoadMap(), byRef = new Map(((map && map.rows) || []).map(r => [r.ref, r])), live = itemsByIdAll();
  return list.map(c => {
    const ref = String(c.ref || "").trim().toUpperCase(), r = byRef.get(ref), ns = c.start || c.startDate, ne = c.slut || c.end || c.endDate, out = { ref, ns, ne, why: c.kommentar || c.comment || "", warn: [], ok: false };
    if (!r) { out.warn.push(map ? "Okänd ref – inte i den senast skapade filen" : "Ingen fil är skapad i den här webbläsaren"); return out; }
    const ms = r.ids.map(id => live.get(id)).filter(Boolean).filter(m => m.startDate && m.endDate);
    if (!ms.length) { out.warn.push("Aktiviteten finns inte längre"); return out; }
    out.name = r.name; out.area = ms[0].area; out.ids = ms.map(m => m.id); out.status = ms[0].status;
    out.os = ms.map(m => m.startDate).sort()[0]; out.oe = ms.map(m => m.endDate).sort().pop();
    if (out.os !== r.start || out.oe !== r.end) out.warn.push("Datumen har ändrats sedan filen skapades");
    if (!askAiIso(ns) || !askAiIso(ne)) { out.warn.push("Ogiltigt datum"); return out; }
    if (ne < ns) { out.warn.push("Slut före start"); return out; }
    if (out.status === "klar") out.warn.push("Aktiviteten är klar");
    out.dS = askAiDays(out.os, ns); out.dE = askAiDays(out.oe, ne); out.same = !out.dS && !out.dE; if (out.same) out.warn.push("Ingen ändring");
    out.ok = !out.same; return out;
  });
}
function askAiPlan(rows) {
  const plan = emptyPlan();
  rows.forEach(r => { const ids = new Set(r.ids); if (r.dS === r.dE) planMove(ids, r.dS, false, plan); else { if (r.dS) planResize(ids, "left", r.dS, false, plan); if (r.dE) planResize(ids, "right", r.dE, false, plan); } });
  return plan;
}

/* ---- Dialogen ------------------------------------------------------------------------------------------------------------------------------------- */
function askAiOpen() {
  document.getElementById("askAi")?.remove();
  const w = document.createElement("div"); w.id = "askAi"; w.className = "print-pick askai";
  const n = getFilteredItems().length;
  w.innerHTML = `<div class="print-pick-box askai-box" role="dialog" aria-label="Fråga AI"><div class="askai-h"><h3>Fråga AI</h3><button type="button" id="askClose" class="askai-x" aria-label="Stäng">✕</button></div>
    <div class="hint">Ingen koppling till AI och ingen kostnad: du skapar en HTML-fil med tidplanen, ger den till Claude (claude.ai eller en session) och ställer din fråga. Vill du omplanera klistrar du in Claudes ändringslista nedan och godkänner själv.</div>
    <div class="askai-sec"><b>1. Skapa fil till Claude</b>
      <label>Urval <select id="askScope"><option value="filter">Det som syns i Gantt (${n} objekt, med dina filter)</option><option value="all">Alla aktiviteter (${items.length} objekt)</option></select></label>
      <label>Din fråga eller ditt önskemål <small>(valfritt – du kan också skriva den till Claude)</small><textarea id="askQ" rows="3" placeholder="t.ex. Vad är försenat i 741 och varför? / Flytta gjutningen i 742A en vecka och visa vad som påverkas."></textarea></label>
      <label class="askai-c"><input type="checkbox" id="askBl" checked> Ta med baslinjens datum</label>
      <div class="print-pick-row"><button type="button" id="askMake" class="primary">Skapa HTML för Claude</button><span id="askInfo" class="hint"></span></div></div>
    <div class="askai-sec"><b>2. Klistra in Claudes svar</b>
      <textarea id="askAns" rows="5" placeholder="Klistra in hela svaret från Claude – ändringslistan (kodblocket med &quot;andringar&quot;) hittas automatiskt."></textarea>
      <div class="print-pick-row"><button type="button" id="askRead">Läs svaret</button><span id="askMsg" class="hint"></span></div>
      <div id="askPrev"></div></div></div>`;
  document.body.appendChild(w);
  const q = id => w.querySelector("#" + id), msg = t => { q("askMsg").textContent = t; };
  q("askClose").onclick = () => w.remove(); w.addEventListener("click", e => { if (e.target === w) w.remove(); });
  q("askMake").onclick = () => {
    const scope = q("askScope").value, rows = askAiRows(scope);
    if (!rows.length) { q("askInfo").textContent = "Inga aktiviteter med datum i urvalet."; return; }
    const html = askAiHtml(rows, { scope, question: q("askQ").value, baseline: q("askBl").checked });
    const saved = askAiSaveMap(rows), a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })); a.download = `Fråga AI ${todayISO()}.html`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    const kb = Math.round(html.length / 1024), tok = Math.round(html.length / 3.2 / 1000);
    q("askInfo").textContent = `Filen är nedladdad: ${rows.length} aktiviteter, ${kb} kB (ca ${tok} tusen tokens).${tok > 150 ? " Stort – filtrera i Gantt först om Claude inte orkar läsa allt." : ""}${saved ? "" : " Obs: kunde inte spara kopplingen för svaret i webbläsaren."}`;
  };
  q("askRead").onclick = () => {
    const list = askAiParse(q("askAns").value || "");
    if (!list) { msg("Hittade ingen ändringslista i svaret – be Claude avsluta med kodblocket (\"andringar\")."); q("askPrev").innerHTML = ""; return; }
    const rows = askAiPreview(list); msg(`${list.length} föreslagna ändringar.`); askAiShowPreview(w, rows);
  };
}
function askAiShowPreview(w, rows) {
  const E = escapeHtml, box = w.querySelector("#askPrev"), sg = d => (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d) + " d", chip = d => `<span class="askai-chip ${d > 0 ? "late" : d < 0 ? "early" : ""}">${sg(d)}</span>`;
  box.innerHTML = `<div class="askai-tw"><table><thead><tr><th></th><th>Ref</th><th>Aktivitet</th><th>Start</th><th>Slut</th><th>Skäl / varning</th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${r.ok ? "" : "bad"}"><td><input type="checkbox" data-ar="${i}"${r.ok ? " checked" : " disabled"}></td><td>${E(r.ref)}</td><td>${E(r.name || "–")}${r.area ? `<br><small>${E(String(r.area).split(" / ").pop())}</small>` : ""}</td>
    <td>${r.os ? `${r.os} → <b>${E(r.ns || "")}</b> ${r.dS !== undefined ? chip(r.dS) : ""}` : "–"}</td><td>${r.oe ? `${r.oe} → <b>${E(r.ne || "")}</b> ${r.dE !== undefined ? chip(r.dE) : ""}` : "–"}</td><td>${E(r.why)}${r.warn.map(x => `<div class="askai-warn">⚠ ${E(x)}</div>`).join("")}</td></tr>`).join("")}</tbody></table></div>
    <div id="askCon" class="askai-con"></div><div class="print-pick-row"><button type="button" id="askAll">Alla</button><button type="button" id="askNone">Inga</button><span class="sp"></span><button type="button" id="askApply" class="primary">Tillämpa valda</button></div>`;
  const picked = () => rows.filter((r, i) => r.ok && box.querySelector(`[data-ar="${i}"]`).checked);
  const refresh = () => {
    const p = picked(), b = box.querySelector("#askApply"); b.disabled = !p.length; b.textContent = `Tillämpa valda (${p.length})`;
    const con = p.length ? planConflicts(new Set(p.flatMap(r => r.ids)), askAiPlan(p)) : [];
    box.querySelector("#askCon").innerHTML = con.length ? `<b>Beroenden som skulle krocka (${con.length}):</b><div>${E(conflictText(con)).replace(/\n/g, "<br>")}</div>` : (p.length ? "Inga beroendekrockar med de valda ändringarna." : "");
  };
  box.querySelectorAll("[data-ar]").forEach(c => c.addEventListener("change", refresh));
  box.querySelector("#askAll").onclick = () => { box.querySelectorAll("[data-ar]:not(:disabled)").forEach(c => { c.checked = true; }); refresh(); };
  box.querySelector("#askNone").onclick = () => { box.querySelectorAll("[data-ar]").forEach(c => { c.checked = false; }); refresh(); };
  box.querySelector("#askApply").onclick = async () => {
    const p = picked(); if (!p.length) return;
    const plan = askAiPlan(p), con = planConflicts(new Set(p.flatMap(r => r.ids)), plan);
    if (con.length && !(await dashConfirm(`Varning – beroende:\n${conflictText(con)}\n\nTillämpa ändå?`, { ok: "Tillämpa ändå" }))) return;
    w.remove();
    await applySchedulePlan(plan, `Fråga AI: ${p.length} aktivitet${p.length === 1 ? "" : "er"} omplanerade`);
  };
  refresh();
}
function initAskAi() { const b = document.getElementById("ganttAskAi"); if (b) b.onclick = askAiOpen; }
document.addEventListener("DOMContentLoaded", initAskAi);
if (document.readyState !== "loading") initAskAi();
