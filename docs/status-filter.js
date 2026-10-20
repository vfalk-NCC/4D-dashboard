/* Statusfiltret (Victor 2026-10-20): bocka i vilka statusar som ska visas – Planerad, Pågående, Försenad, Klar … – och allt i dashboarden följer
   (Gantt, tavla, översikt, utskrift), som de andra filtren. Ingår i Sparade filter och nollställs av Rensa filter. */
const statusOptions = () => STATUS_ORDER.map(v => ({ value: v, label: STATUS_LABELS[v] || v, n: items.filter(it => it.status === v).length }));
function statusFilterLabel() {
  const ss = filters.status || [];
  if (!ss.length) return "Alla statusar";
  if (ss.length === 1) return STATUS_LABELS[ss[0]] || ss[0];
  if (ss.length <= 2) return ss.map(v => STATUS_LABELS[v] || v).join(", ");
  return `${ss.length} statusar`;
}
function renderStatusFilter() {
  const b = document.getElementById("filterStatusBtn");
  if (b) { b.textContent = statusFilterLabel() + " ▾"; b.classList.toggle("on", !!(filters.status || []).length); b.title = (filters.status || []).map(v => STATUS_LABELS[v] || v).join("\n") || "Alla statusar"; }
  const p = document.getElementById("statusFilterPop"); if (p) fillStatusPop(p);
}
function fillStatusPop(p) {
  const sel = new Set(filters.status || []);
  p.querySelector(".ggp-list").innerHTML = statusOptions().map(o => `<label class="ggp-row" title="${escapeHtml(o.label)}"><input type="checkbox" data-v="${o.value}"${sel.has(o.value) ? " checked" : ""} /><i class="sf-dot" style="background:${STATUS_COLORS[o.value] || "#94a3b8"}"></i><span>${escapeHtml(o.label)}</span><small class="hint"> ${o.n}</small></label>`).join("");
}
function openStatusPop(btn) {
  closeStatusPop(); [closeAreaPop, closeActivityPop, closeContractorPop, closeSavedPop].forEach(f => { try { f(); } catch (e) { /* */ } });
  const p = document.createElement("div"); p.id = "statusFilterPop"; p.className = "gantt-group-picker cf-pop sf-status-pop";
  p.innerHTML = `<div class="ggp-acts"><button type="button" data-sf="all" title="Rensa alla val – visa allt">Rensa allt</button><button type="button" data-sf="open" title="Planerad, pågående och försenad">Ej klara</button><button type="button" data-sf="late">Bara försenade</button></div><div class="ggp-list"></div>`;
  document.body.appendChild(p);
  const r = btn.getBoundingClientRect(); p.style.left = Math.max(4, Math.min(r.left, innerWidth - 300)) + "px"; p.style.top = (r.bottom + 4) + "px"; p.style.minWidth = "240px";
  p.querySelector(".ggp-acts").onclick = e => {
    const a = e.target.closest("[data-sf]"); if (!a) return;
    filters.status = a.dataset.sf === "all" ? [] : a.dataset.sf === "open" ? ["planerad", "pagaende", "forsenad"] : ["forsenad"];
    renderStatusFilter(); renderAll();
  };
  p.querySelector(".ggp-list").onchange = e => {
    const c = e.target.closest("input[data-v]"); if (!c) return;
    const set = new Set(filters.status || []); if (c.checked) set.add(c.dataset.v); else set.delete(c.dataset.v);
    filters.status = STATUS_ORDER.filter(v => set.has(v)); renderStatusFilter(); renderAll();
  };
  fillStatusPop(p);
  setTimeout(() => document.addEventListener("mousedown", statusPopOutside, true), 0); document.addEventListener("keydown", statusPopKey, true);
}
function statusPopOutside(e) { const p = document.getElementById("statusFilterPop"); if (p && !p.contains(e.target) && e.target.id !== "filterStatusBtn") closeStatusPop(); }
function statusPopKey(e) { if (e.key === "Escape") { e.stopPropagation(); closeStatusPop(); } }
function closeStatusPop() { document.getElementById("statusFilterPop")?.remove(); document.removeEventListener("mousedown", statusPopOutside, true); document.removeEventListener("keydown", statusPopKey, true); }
function initStatusFilter() {
  const b = document.getElementById("filterStatusBtn"); if (!b || b.dataset.w) return; b.dataset.w = "1";
  b.onclick = e => { e.stopPropagation(); if (document.getElementById("statusFilterPop")) closeStatusPop(); else openStatusPop(b); };
  renderStatusFilter();
}
document.addEventListener("DOMContentLoaded", initStatusFilter);
if (document.readyState !== "loading") initStatusFilter();
