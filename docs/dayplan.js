/* Dagsplan från underentreprenör (Victor 2026-10-19: "ett alternativ för att importera dagsplanen, justera den i TC-menyn och exportera
   till en snygg html"). Mejlet ("Plan for 19.10.2026 – Procyon: 68+2 crane operators … * Formwork stodmur at J line – 8 workers …")
   klistras in, läses in till rader (text + antal personer), varje rad kopplas till en aktivitet i Gantt-schemat (förslag efter ord och
   platskoder, sparas som regel till nästa dag), justeras och sparas i 4D-data (ue_dayplans.json) och kan exporteras som en fristående
   HTML-sida. På tavlan och i tipsrutan visas antal personer vid aktiviteterna för dagsplanens datum. */

const DP_PATH = () => `projects/${encodeURIComponent(projectId)}/ue_dayplans.json`;
const DP_ALIAS_PATH = () => `projects/${encodeURIComponent(projectId)}/ue_aliases.json`;
let dayplans = [], dpAliases = [], dpLoaded = false, dpLoading = null;

/* ---- Text -> rader ---- */
const dpNorm = s => String(s || "").toLowerCase().replace(/\b([a-z])\s*\/\s*(\d{1,3})\b/g, "$1$2").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s\-./]/g, " ").replace(/\s+/g, " ").trim();
function dpIso(d, m, y) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
/* Punkt på egen rad ("  *" och texten på raden under) slås ihop med texten, som i mejl från Outlook. */
function dpPrepText(text) { return String(text || "").replace(/\r/g, "").replace(/\u00a0/g, " ").replace(/^[ \t]*[*•·●▪–-][ \t]*\n(?:[ \t]*\n)*[ \t]*(?=\S)/gm, "* "); }
/* Skiftrubriker: "First shift:", "Second shift", "Shift 2", "Night shift", "Skift 1", "Nattskift". */
function dpShift(line) {
  const l = String(line || "").trim().replace(/[:\-–]+$/, "").trim(); if (!/shift|skift/i.test(l) || l.length > 30 || /\d+\s*(workers?|pers)/i.test(l)) return 0;
  const m = l.match(/(first|1st|second|2nd|third|3rd|night|morning|day|afternoon|evening|första|andra|tredje|natt|dag|kväll)|(\d)/i); if (!m) return 0;
  const w = (m[1] || m[2]).toLowerCase(); return /^(first|1st|morning|day|första|dag|1)$/.test(w) ? 1 : /^(second|2nd|afternoon|evening|andra|kväll|2)$/.test(w) ? 2 : 3;
}
/* Plats som nämns i raden: <namn i vinkelparentes>, linje (E och F), koder som M12 eller J/10. */
function dpAreaHint(text) {
  const t = String(text || ""), out = [], split = s => s.split(/\s*(?:,|and|&|och|\/)\s*/i).map(x => x.trim().toUpperCase()).filter(Boolean);
  const br = t.match(/<\s*([^<>]{3,60}?)\s*>/); if (br) out.push(br[1].replace(/\s+/g, " "));
  const lm = [...t.matchAll(/\b(?:lines?|linje|linjer)\s+([A-Za-z](?:\s*(?:,|and|&|och)\s*[A-Za-z])*)(?![A-Za-z])/gi)].flatMap(m => split(m[1])); const lm2 = [...t.matchAll(/\b([A-Za-z])\s+line\b/gi)].map(m => m[1].toUpperCase());
  const lm3 = [...t.matchAll(/\b([A-Z])\s+(?:and|&|och)\s+([A-Z])\b/g)].flatMap(m => [m[1], m[2]]);
  const lines = [...new Set([...lm, ...lm2, ...lm3])]; if (lines.length) out.push("Linje " + lines.join(", "));
  const codes = [...t.matchAll(/\b([A-Za-z])\s*\/\s*(\d{1,3})\b/g)].map(m => m[1].toUpperCase() + m[2]).concat([...t.matchAll(/\b([A-Z]\d{2}(?:-\d{2})?)\b/g)].map(m => m[1])); if (codes.length) out.push([...new Set(codes)].join(", "));
  return [...new Set(out)].join(" · ");
}
/* { date, company, total, extras, tasks: [{ text, workers, shift, area }] } */
function dpParse(text) {
  const lines = dpPrepText(text).split("\n").map(l => l.trim()).filter(Boolean);
  const out = { date: "", company: "", total: null, extras: "", tasks: [] };
  const clean = l => l.replace(/^[\s*•\-–·●▪]+/, "").trim();
  let shift = 0;
  for (const l of lines) {
    if (!out.date) { const m = l.match(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/); if (m && /plan|dag|date|datum|temat|subject/i.test(l)) out.date = dpIso(+m[1], +m[2], m[3]); else { const iso = l.match(/(20\d{2})-(\d{2})-(\d{2})/); if (iso && /plan|date|datum/i.test(l)) out.date = iso[0]; } }
  }
  if (!out.date) { const m = String(text).match(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/); if (m) out.date = dpIso(+m[1], +m[2], m[3]); }
  for (const raw of lines) {
    if (/^(od|from|från|wys[łl]ane|sent|do|to|till|temat|subject|cc)\s*:/i.test(raw)) continue;
    if (!/^[*•\-–·●▪]/.test(raw)) { const sh = dpShift(raw); if (sh) { shift = sh; continue; } }
    // Företagsrad: "Procyon :  68+2 crane operators+2sennebogen operator+1manitue operator"
    const head = raw.match(/^([A-Za-zÅÄÖåäö][\w .&-]{1,40}?)\s*:\s*(\d+)\s*((?:\+\s*\d+\s*[^+\n]+)*)\s*$/);
    if (head && !/^[*•\-–]/.test(raw) && out.total === null) { out.company = head[1].trim(); out.total = +head[2]; out.extras = (head[3] || "").split("+").map(x => x.trim()).filter(Boolean).map(x => x.replace(/^(\d+)\s*/, "$1 ")).join(", "); continue; }
    if (!/^[*•\-–·●▪]/.test(raw)) continue;
    const t = clean(raw);
    // Antal sist: "… - 8 workers", "… -10", "… 10 workers"
    let m = t.match(/^(.*?)[\s–\-:,]+(\d+)\s*(?:workers?|worker|pers\.?|persons?|people|man|st)?\.?\s*$/i);
    if (!m) m = t.match(/^(.*?)\s*\(\s*(\d+)\s*(?:workers?|pers\w*)?\s*\)\s*$/i);
    if (m && m[1].trim()) { const tx = m[1].replace(/[\s–\-:,]+$/, "").trim(); out.tasks.push({ text: tx, workers: +m[2], shift, area: dpAreaHint(tx) }); }
    else if (t) out.tasks.push({ text: t, workers: 0, shift, area: dpAreaHint(t) });
  }
  return out;
}

/* ---- Förslag på aktivitet ---- */
const DP_STOP = new Set(["at", "the", "in", "on", "of", "and", "for", "workers", "worker", "line", "plan", "a", "to", "with"]);
const DP_SYN = { formwork: ["form"], form: ["form"], reinforcement: ["armer"], rebar: ["armer"], prefabrication: ["prefab"], prefab: ["prefab"], lean: ["grovbetong", "magerbetong"], concrete: ["betong", "gjut"], casting: ["gjut"], pour: ["gjut"], stodmur: ["stodmur"], kyrkavagen: ["kyrkevagen", "kyrkavagen"], kontrafor: ["kontrafor"], excavation: ["schakt", "grav"], rock: ["berg"], bolting: ["bult"], demolition: ["rivning"], crane: ["kran"], backfill: ["fyll"], wall: ["vagg"], foundation: ["fundament"], slab: ["platta", "bjalklag"], column: ["pelare"], columns: ["pelare"], installation: ["install"], sandwich: ["sandwich"], facade: ["fasad"], roof: ["tak"] };
const DP_GEN = new Set(["form", "armer", "prefab", "betong", "gjut", "grovbetong", "magerbetong", "schakt", "grav", "bult", "rivning", "kran", "fyll", "install", "tak"]);
function dpActHay(a) { return dpNorm(`${itemLabel(a)} ${a.area || ""} ${a.activity || ""}`); }
function dpScore(task, hay, nameHay) {
  const norm = dpNorm(task), toks = norm.split(" ").filter(Boolean);
  let s = 0;
  // Platskoder: "J line" / "line F" -> "linje j"; kodtecken som M12, E17-30 matchas hårt.
  const lm = [...norm.matchAll(/\b([a-z])\s+line\b/g)].map(m => m[1]).concat([...norm.matchAll(/\blines?\s+([a-z](?:\s*(?:,|and|&)\s*[a-z])*)(?![a-z])/g)].flatMap(m => m[1].split(/\s*(?:,|and|&)\s*/).filter(Boolean)));
  lm.forEach(c => { if (new RegExp(`(linje|line)\\s*${c}(?![a-z])`).test(hay)) s += 4; });
  toks.forEach(t => {
    if (DP_STOP.has(t)) return;
    if (/^[a-z]\d+(-\d+)?$/.test(t)) { if (hay.includes(t)) s += 4; return; }
    const roots = DP_SYN[t] || (t.length >= 5 ? [t.slice(0, Math.max(5, t.length - 2))] : []);
    roots.forEach(r => { if (hay.includes(r)) s += DP_GEN.has(r) ? 1 : (nameHay.includes(r) ? 4 : 3); }); // vanliga arbetsord (form, armering …) räcker inte ensamma
  });
  // Annan sorts arbete på samma plats (t.ex. armering mot en formaktivitet) är inte samma aktivitet.
  const roots = r => toks.flatMap(t => DP_SYN[t] || []).filter(x => DP_GEN.has(x) && (r === undefined || true));
  const tg = new Set(roots()), ag = new Set([...DP_GEN].filter(g => hay.includes(g)));
  if (tg.size && ag.size && ![...tg].some(g => ag.has(g))) s -= 3;
  return s;
}
/* Områden ur schemat: "742 Sikthall", "741 Sektionsfickor" … Kod = tre första siffrorna i områdesnamnen (742A Krönlinje J, 7421 Förtjockardel hör till 742). */
function dpZones() {
  const sig = items.length + ":" + (items[0] ? items[0].id : ""); if (dpZones.sig === sig && dpZones.v) return dpZones.v;
  const names = new Map(), subs = new Map();
  items.forEach(it => String(it.area || "").split(" / ").forEach(seg => { seg = seg.trim(); const m = /^(\d{3})(?=\D|$)/.exec(seg) || /^(\d{3})\d/.exec(seg); if (!m) return; subs.set(seg, m[1]); const pure = /^(\d{3})\s+(\S.*)$/.exec(seg); if (pure && !names.has(pure[1])) names.set(pure[1], pure[2].trim()); }));
  dpZones.sig = sig; dpZones.v = { names, subs, codes: [...new Set([...subs.values()])].sort() }; return dpZones.v;
}
const dpZoneLabel = code => { if (!code) return ""; const n = dpZones().names.get(code); return n ? `${code} ${n}` : code; };
function dpZoneOfActivity(a) { if (!a) return ""; const z = dpZones(); for (const seg of String(a.area || "").split(" / ").reverse()) { const c = z.subs.get(seg.trim()); if (c) return c; } return ""; }
function dpZoneInfer(text) {
  const z = dpZones(); let best = "", sc = 0;
  z.subs.forEach((code, seg) => { const n = dpNorm(seg); const s = dpScore(text, n, n); if (s > sc) { sc = s; best = code; } });
  return sc >= 3 ? best : "";
}
/* Område för en rad: aktivitetens (om kopplad), annars gissat ur texten. Ett område som valts för hand rörs inte. */
function dpAssignZone(t, act) { if (t.zoneManual) return; const z = (act ? dpZoneOfActivity(act) : "") || dpZoneInfer(t.text); if (z) t.zone = z; else if (!t.zone) t.zone = ""; }
function dpCandidates(date) {
  const merged = mergeActivityGroups(items.filter(x => x.startDate));
  const near = a => { const e = a.endDate || a.startDate; return a.startDate <= addDaysIso(date, 21) && e >= addDaysIso(date, -21); };
  return merged.filter(near).concat(merged.filter(a => !near(a)));
}
const dpKeyOf = a => String(a.activityKey || a.id);
function dpSuggest(task, date, cands) {
  const al = dpAliases.find(x => x.text === dpAliasKey(task));
  if (al) { const a = cands.find(c => dpKeyOf(c) === al.key); if (a) return { act: a, src: "alias", score: 99 }; }
  let best = null, sc = 0;
  cands.forEach(a => { const s = dpScore(task, dpActHay(a), dpNorm(itemLabel(a))) + (a.startDate <= date && (a.endDate || a.startDate) >= date ? 0.5 : 0); if (s > sc) { sc = s; best = a; } });
  return best && sc >= 4 ? { act: best, src: "förslag", score: sc } : null;
}
const dpAliasKey = t => dpNorm(t).replace(/\b\d+\b/g, "").replace(/\s+/g, " ").trim();

/* ---- Lagring ---- */
async function dpLoad(force) {
  if (dpLoaded && !force) return dayplans;
  if (!dpLoading) dpLoading = (async () => {
    try { dayplans = await ghReadJSON(settings.githubToken, DP_PATH()); } catch (e) { dayplans = []; console.warn("Kunde inte läsa ue_dayplans.json", e); }
    try { dpAliases = await ghReadJSON(settings.githubToken, DP_ALIAS_PATH()); } catch (e) { dpAliases = []; }
    dpLoaded = true; dpLoading = null; if (typeof dpRenderHistory === "function") dpRenderHistory();
    return dayplans;
  })();
  return dpLoading;
}
/* En tidigare version sparas kompakt i posten (högst 25), så att historiken visar vad som ändrats och går att återställa. */
const dpSnap = r => ({ at: r.updated_at || r.created_at || "", by: r.updated_by || "", date: r.date, company: r.company || "", total: r.total, extras: r.extras || "", tasks: (r.tasks || []).map(t => ({ text: t.text, workers: t.workers, key: t.key || null, label: t.label || "", shift: t.shift || undefined, area: t.area || undefined, zone: t.zone || undefined, objs: t.objs && t.objs.length ? t.objs : undefined })) });
const dpSame = (a, b) => JSON.stringify(dpSnap({ ...a, updated_at: "", updated_by: "" })) === JSON.stringify(dpSnap({ ...b, updated_at: "", updated_by: "" }));
async function dpSave(rec) {
  const prev = dayplans.find(r => r.id === rec.id);
  if (prev && !dpSame(prev, rec)) rec.history = [...(prev.history || []), dpSnap(prev)].slice(-25); else if (prev) rec.history = prev.history || [];
  if (!rec.created_at) rec.created_at = (prev && prev.created_at) || new Date().toISOString();
  await ghWriteJSON(settings.githubToken, DP_PATH(), arr => [...arr.filter(r => r.id !== rec.id), rec], `Dagsplan ${rec.date} ${rec.company || ""}`.trim());
  dayplans = [...dayplans.filter(r => r.id !== rec.id), rec]; if (typeof dpRenderHistory === "function") dpRenderHistory();
  const learned = rec.tasks.filter(t => t.key && t.text).map(t => ({ text: dpAliasKey(t.text), key: t.key, label: t.label || "" })).filter(x => x.text);
  if (learned.length) {
    await ghWriteJSON(settings.githubToken, DP_ALIAS_PATH(), arr => { const m = new Map(arr.map(x => [x.text, x])); learned.forEach(x => m.set(x.text, x)); return [...m.values()]; }, "Regler för dagsplanens rader");
    const m = new Map(dpAliases.map(x => [x.text, x])); learned.forEach(x => m.set(x.text, x)); dpAliases = [...m.values()];
  }
}
async function dpDelete(id) {
  await ghWriteJSON(settings.githubToken, DP_PATH(), arr => arr.filter(r => r.id !== id), "Ta bort dagsplan");
  dayplans = dayplans.filter(r => r.id !== id); if (typeof dpRenderHistory === "function") dpRenderHistory();
}

/* ---- Vid aktiviteterna ---- */
function dpPlanFor(iso) {
  if (!dayplans.length) return null;
  const same = dayplans.filter(p => p.date === iso); if (same.length) return same;
  const up = dayplans.filter(p => p.date >= (typeof todayISO === "function" ? todayISO() : iso)).sort((a, b) => a.date.localeCompare(b.date));
  return up.length ? dayplans.filter(p => p.date === up[0].date) : null;
}
/* Antal personer för en (sammanslagen) aktivitet enligt dagsplanen för det visade datumet. */
function dpWorkersFor(it) {
  const plans = dpPlanFor((typeof ganttAsOf !== "undefined" && ganttAsOf) || (typeof todayISO === "function" ? todayISO() : ""));
  if (!plans) return null;
  const keys = new Set([String(it.activityKey || it.id), ...(it.members || []).map(m => String(m.activityKey || m.id)), String(it.id)]);
  let n = 0, hit = null;
  plans.forEach(p => p.tasks.forEach(t => { if (t.key && keys.has(String(t.key))) { n += Number(t.workers) || 0; hit = p; } }));
  return hit ? { n, date: hit.date, company: hit.company } : null;
}

function dpChip(it) { const w = dpWorkersFor(it); return w ? `<span class="pnote-ue" title="Dagsplan ${escapeHtml(w.date)}${w.company ? " – " + escapeHtml(w.company) : ""}: ${w.n} personer">👷 ${w.n}</span>` : ""; }

/* ---- Dialog ---- */
let dpDlg = null;
function dpClose() { if (dpDlg) { dpDlg.remove(); dpDlg = null; } }
async function dpOpen(opts = {}) {
  dpClose();
  await dpLoad();
  const today = typeof todayISO === "function" ? todayISO() : new Date().toISOString().slice(0, 10);
  let rec = opts.rec || { id: ghNewId(), date: addDaysIso(today, 1), company: "", total: null, extras: "", tasks: [], source: "" };
  rec = JSON.parse(JSON.stringify(rec));
  const host = (typeof overlayHost === "function" ? overlayHost() : document.body);
  const d = document.createElement("div"); d.className = "dp-dlg"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "Dagsplan");
  dpDlg = d; host.appendChild(d);
  const esc = escapeHtml;
  const saved = () => dayplans.slice().sort((a, b) => b.date.localeCompare(a.date));
  const render = () => {
    const byKey = new Map(mergeActivityGroups(items.filter(x => x.startDate)).map(a => [dpKeyOf(a), a]));
    d.innerHTML = `<div class="dp-box">
      <div class="dp-h"><b>👷 Dagsplan från underentreprenör</b><span class="dp-sp"></span>${saved().length ? `<select class="dp-load" aria-label="Sparade dagsplaner"><option value="">Sparade dagsplaner …</option>${saved().map(p => `<option value="${esc(p.id)}"${p.id === rec.id ? " selected" : ""}>${esc(p.date)} · ${esc(p.company || "")} · ${p.tasks.length} rader</option>`).join("")}</select>` : ""}${(rec.history || []).length ? `<select class="dp-ver" aria-label="Tidigare versioner"><option value="">Versioner (${rec.history.length + 1}) …</option>${rec.history.map((h, i) => `<option value="${i}">${esc(String(h.at || "").slice(0, 16).replace("T", " ") || "äldre")} · ${h.tasks.length} rader · ${h.tasks.reduce((a, x) => a + (Number(x.workers) || 0), 0)} pers.</option>`).reverse().join("")}</select>` : ""}<button type="button" class="dp-x" aria-label="Stäng">✕</button></div>
      <div class="dp-body">${rec.source_name ? `<div class="dp-from">Inläst från: <b>${esc(rec.source_name)}</b></div>` : ""}
        <details class="dp-paste"${rec.tasks.length ? "" : " open"}><summary>Klistra in mejlet</summary><textarea class="dp-text" rows="7" placeholder="Plan for 19.10.2026&#10;Procyon : 68+2 crane operators&#10;   * Formwork stodmur at J line - 8 workers&#10;   * Reinforcement prefabrication - 16 workers">${esc(rec.source || "")}</textarea><div class="dp-row"><button type="button" class="dp-read primary">Läs in</button><span class="hint">Raderna läses in och kopplas till aktiviteter. Du justerar allt nedan innan du sparar.</span></div></details>
        <div class="dp-fields"><label>Datum <input type="date" class="dp-date" value="${esc(rec.date)}"></label><label>Underentreprenör <input type="text" class="dp-co" value="${esc(rec.company || "")}"></label><label>Totalt antal <input type="number" class="dp-tot" min="0" value="${rec.total ?? ""}"></label><label class="dp-ex">Övrigt (kranförare m.m.) <input type="text" class="dp-extras" value="${esc(rec.extras || "")}"></label></div>
        <div class="dp-tw"><table class="dp-t"><thead><tr><th>Arbete (enligt mejlet)</th><th>Pers.</th><th title="Skift enligt mejlet">Skift</th><th>Aktivitet i schemat</th><th title="Område: enligt aktiviteten i schemat, annars det som nämns i raden">Område</th><th title="Koppling till modellen (valfri, kräver inte Trimble Connect)">Modell</th><th></th></tr></thead><tbody>${rec.tasks.map((t, i) => `<tr data-i="${i}"><td><input type="text" class="dp-tx" value="${esc(t.text)}"></td><td><input type="number" class="dp-wk" min="0" value="${Number(t.workers) || 0}"></td><td><select class="dp-shift" aria-label="Skift"><option value="0"${!t.shift ? " selected" : ""}>–</option>${[1, 2, 3].map(n => `<option value="${n}"${Number(t.shift) === n ? " selected" : ""}>${n}</option>`).join("")}</select></td><td><input type="text" class="dp-act${t.key ? " ok" : ""}" value="${esc(t.label || "")}" placeholder="Sök aktivitet …">${t.src ? `<small class="dp-src">${esc(t.src === "alias" ? "enligt tidigare val" : "förslag")}</small>` : ""}</td><td class="dp-ar"><select class="dp-zone" aria-label="Område"><option value="">–</option>${dpZones().codes.map(c => `<option value="${c}"${t.zone === c ? " selected" : ""}>${esc(dpZoneLabel(c))}</option>`).join("")}</select>${t.area ? `<small title="Plats enligt mejlet">${esc(t.area)}</small>` : ""}</td><td class="dp-mo">${typeof dpObjBtn === "function" ? dpObjBtn(t) : ""}</td><td><button type="button" class="dp-del" aria-label="Ta bort raden">✕</button></td></tr>`).join("") || `<tr><td colspan="7" class="hint">Inga rader – klistra in mejlet eller lägg till en rad.</td></tr>`}</tbody></table></div>
        <div class="dp-sum"></div>
      </div>
      <div class="dp-foot"><button type="button" class="dp-add">＋ Rad</button><span class="dp-sp"></span><button type="button" class="dp-del-all danger"${saved().some(p => p.id === rec.id) ? "" : " hidden"}>Ta bort dagsplanen</button><button type="button" class="dp-model" title="Visa dagens arbeten i modellen i Trimble Connect (kräver att 3D-styrningen är på)">🧊 Visa i modellen</button><button type="button" class="dp-copy">Kopiera text</button><button type="button" class="dp-html">Exportera HTML</button><button type="button" class="dp-save primary">Spara</button></div></div>`;
    bind();
  };
  const sum = () => { const n = rec.tasks.reduce((a, t) => a + (Number(t.workers) || 0), 0), un = rec.tasks.filter(t => !t.key).length; const el = d.querySelector(".dp-sum"); if (el) el.textContent = `${rec.tasks.length} rader · ${n} personer på raderna${rec.total ? ` av ${rec.total}` : ""}${un ? ` · ${un} utan kopplad aktivitet` : ""}`; };
  const pull = () => {
    rec.date = d.querySelector(".dp-date").value || rec.date; rec.company = d.querySelector(".dp-co").value.trim();
    const tot = d.querySelector(".dp-tot").value; rec.total = tot === "" ? null : Number(tot); rec.extras = d.querySelector(".dp-extras").value.trim();
    const ta = d.querySelector(".dp-text"); if (ta) rec.source = ta.value;
    d.querySelectorAll(".dp-t tbody tr[data-i]").forEach(tr => { const t = rec.tasks[Number(tr.dataset.i)]; if (!t) return; t.text = tr.querySelector(".dp-tx").value.trim(); t.workers = Number(tr.querySelector(".dp-wk").value) || 0; t.shift = Number(tr.querySelector(".dp-shift").value) || 0; const zs = tr.querySelector(".dp-zone").value; if (zs !== (t.zone || "")) t.zoneManual = true; t.zone = zs; });
  };
  function bind() {
    d.querySelector(".dp-x").onclick = dpClose;
    const ld = d.querySelector(".dp-load"); if (ld) ld.onchange = () => { const p = dayplans.find(x => x.id === ld.value); if (p) { rec = JSON.parse(JSON.stringify(p)); render(); } };
    const readNow = () => {
      pull(); const p = dpParse(rec.source);
      if (!p.tasks.length) { modelToast("Hittade inga rader – raderna ska börja med * eller - och sluta med antal personer"); return; }
      if (p.date) rec.date = p.date; if (p.company) rec.company = p.company; if (p.total !== null) rec.total = p.total; if (p.extras) rec.extras = p.extras;
      const cands = dpCandidates(rec.date);
      rec.tasks = p.tasks.map(t => { const sg = dpSuggest(t.text, rec.date, cands), r = { ...t, key: sg ? dpKeyOf(sg.act) : null, label: sg ? itemLabel(sg.act) : "", src: sg ? sg.src : null }; dpAssignZone(r, sg && sg.act); return r; });
      render(); modelToast(`${rec.tasks.length} rader inlästa – ${rec.tasks.filter(t => t.key).length} kopplade till aktiviteter`);
    };
    d.querySelector(".dp-read").onclick = readNow;
    // Släpp mejlet (.msg, .eml, .txt, .html) eller markerad text direkt i dialogen
    d.addEventListener("dragover", e => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].some(x => x === "Files" || x === "text/plain" || x === "text/html")) { e.preventDefault(); d.classList.add("dp-over"); } });
    d.addEventListener("dragleave", e => { if (!d.contains(e.relatedTarget)) d.classList.remove("dp-over"); });
    d.addEventListener("drop", async e => { e.preventDefault(); d.classList.remove("dp-over"); if (typeof dpReadDrop !== "function") return; const m = await dpReadDrop(e.dataTransfer); if (m && m.length) { pull(); rec.source = m[0].text; rec.source_name = m[0].name || ""; readNow(); } else modelToast("Hittade inget mejl eller ingen text att läsa in"); });
    d.addEventListener("paste", e => { const ta = d.querySelector(".dp-text"); if (ta && e.target === ta) return; const tx = e.clipboardData && e.clipboardData.getData("text/plain"); if (tx && tx.length > 20 && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { e.preventDefault(); pull(); rec.source = tx; readNow(); } });
    const vs = d.querySelector(".dp-ver"); if (vs) vs.onchange = () => { if (vs.value === "") return; const h = rec.history[Number(vs.value)]; if (h) { pull(); rec.total = h.total; rec.extras = h.extras; rec.company = h.company || rec.company; rec.tasks = h.tasks.map(x => ({ ...x, src: null })); render(); modelToast("Tidigare version inläst – spara för att ersätta den nuvarande"); } };
    d.querySelectorAll(".dp-obj").forEach(b => { b.onclick = ev => { ev.stopPropagation(); pull(); const t = rec.tasks[Number(b.closest("tr").dataset.i)]; if (t && typeof dpObjMenu === "function") dpObjMenu(b, t, render, rec); }; });
    const mb = d.querySelector(".dp-model"); if (mb) mb.onclick = () => { pull(); if (typeof dpModelShow === "function") dpModelShow(rec); };
    d.querySelector(".dp-add").onclick = () => { pull(); rec.tasks.push({ text: "", workers: 0, key: null, label: "", shift: 0, area: "" }); render(); };
    d.querySelectorAll(".dp-del").forEach(b => b.onclick = () => { pull(); rec.tasks.splice(Number(b.closest("tr").dataset.i), 1); render(); });
    d.querySelectorAll(".dp-t tbody tr[data-i]").forEach(tr => {
      const t = rec.tasks[Number(tr.dataset.i)], inp = tr.querySelector(".dp-act");
      attachCombo(inp, () => dpCandidates(rec.date).map(a => ({ value: dpKeyOf(a), label: itemLabel(a), sub: [a.area, a.startDate && a.endDate ? tipRange(a.startDate, a.endDate) : ""].filter(Boolean).join(" · "), act: a })), { empty: "Ingen aktivitet matchar", onPick: o => { t.key = o.value; t.label = o.label; t.src = null; dpAssignZone(t, o.act); { const zs = tr.querySelector(".dp-zone"); if (zs) zs.value = t.zone || ""; } inp.value = o.label; inp.classList.add("ok"); const s = tr.querySelector(".dp-src"); if (s) s.remove(); sum(); } });
      inp.addEventListener("input", () => { if (!inp.value.trim()) { t.key = null; t.label = ""; inp.classList.remove("ok"); sum(); } });
      tr.querySelector(".dp-wk").addEventListener("input", () => { pull(); sum(); });
      tr.addEventListener("click", ev => { if (ev.target.closest("input,select,button,textarea,.cb-list,a")) return; pull(); const tk = rec.tasks[Number(tr.dataset.i)]; if (tk && typeof dpModelPick === "function") dpModelPick([tk]); }); tr.title = "Klicka på raden för att markera dess objekt i modellen";
    });
    d.querySelector(".dp-save").onclick = async () => {
      pull(); if (!rec.date) { alert("Ange datum."); return; }
      const btn = d.querySelector(".dp-save"); btn.disabled = true;
      try {
        const same = dayplans.find(p => p.date === rec.date && (p.company || "") === (rec.company || "") && p.id !== rec.id);
        if (same && !(await dashConfirm(`Det finns redan en dagsplan för ${rec.date} (${rec.company || "utan namn"}). Ersätta den?`, { ok: "Ersätt" }))) { btn.disabled = false; return; }
        if (same) { rec.id = same.id; rec.history = same.history || []; rec.created_at = same.created_at; dayplans = dayplans.filter(p => p.id !== rec.id).concat([same]); } // den gamla blir en version i historiken
        rec.updated_at = new Date().toISOString(); rec.updated_by = settings.userName || null; rec.tasks = rec.tasks.filter(t => t.text || t.key);
        await dpSave(rec); modelToast(`Dagsplanen för ${rec.date} är sparad`); if (typeof renderAll === "function") renderAll(); render();
      } catch (e) { alert("Kunde inte spara dagsplanen: " + e.message); btn.disabled = false; }
    };
    d.querySelector(".dp-del-all").onclick = async () => { if (!(await dashConfirm(`Ta bort dagsplanen för ${rec.date}?`, { danger: true, ok: "Ta bort" }))) return; try { await dpDelete(rec.id); if (typeof renderAll === "function") renderAll(); dpClose(); } catch (e) { alert("Kunde inte ta bort: " + e.message); } };
    d.querySelector(".dp-copy").onclick = async () => { pull(); const tx = dpText(rec); try { await navigator.clipboard.writeText(tx); modelToast("Dagsplanen kopierad"); } catch (e) { prompt("Kopiera:", tx); } };
    d.querySelector(".dp-html").onclick = () => { pull(); dpExportHtml(rec); };
    sum();
  }
  d.addEventListener("pointerdown", e => { if (e.target === d) dpClose(); });
  d.addEventListener("keydown", e => { if (e.key === "Escape" && !e.defaultPrevented && !d.querySelector(".cb-list:not([hidden])")) { e.stopPropagation(); dpClose(); } });
  render();
}
function dpText(rec) { return `Dagsplan ${rec.date}${rec.company ? " – " + rec.company : ""}${rec.total ? `: ${rec.total}${rec.extras ? " + " + rec.extras : ""} personer` : ""}\n` + rec.tasks.map(t => `• ${t.shift ? `[Skift ${t.shift}] ` : ""}${t.text} – ${t.workers} pers.${t.label ? `  [${t.label}]` : ""}${t.zone ? `  {${dpZoneLabel(t.zone)}}` : ""}${t.area ? `  (${t.area})` : ""}`).join("\n"); }

/* ---- HTML-export ---- */
function dpExportHtml(rec) {
  const esc = escapeHtml, MON = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"], WD = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
  const fd = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${+iso.slice(8)} ${MON[+iso.slice(5, 7) - 1]}` : "–";
  const dt = new Date(rec.date + "T00:00:00"), head = isNaN(dt) ? rec.date : `${WD[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]} ${dt.getFullYear()}`;
  const merged = mergeActivityGroups(items.filter(x => x.startDate)), byKey = new Map(merged.map(a => [dpKeyOf(a), a]));
  const rows = rec.tasks.map(t => { const a = t.key ? byKey.get(String(t.key)) : null; return { t, a, area: t.zone ? dpZoneLabel(t.zone) : a ? String(a.area || "").split(" / ").pop() : "Ej kopplad", ph: a ? (typeof ganttPhaseAt === "function" ? ganttPhaseAt(a, rec.date) : a.status) : "" }; });
  const groups = new Map(); rows.forEach(r => { if (!groups.has(r.area)) groups.set(r.area, []); groups.get(r.area).push(r); });
  const col = { pagaende: "#d4a90a", forsenad: "#e5262b", klar: "#2fa84f", planerad: "#9aa3af" };
  const sumW = rec.tasks.reduce((a, t) => a + (Number(t.workers) || 0), 0), max = Math.max(1, ...rec.tasks.map(t => Number(t.workers) || 0));
  const css = `:root{--bg:#f3f5f9;--card:#fff;--ink:#0f172a;--mut:#64748b;--line:#e2e8f0;--acc:#2563eb}@media(prefers-color-scheme:dark){:root{--bg:#0b1220;--card:#131c2e;--ink:#e5ebf5;--mut:#94a3b8;--line:#243049;--acc:#60a5fa}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}.w{max-width:960px;margin:0 auto;padding:22px 16px 50px}h1{margin:0;font-size:24px}.sub{color:var(--mut);margin:2px 0 14px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0 18px}.c{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.c b{display:block;font-size:26px;line-height:1.1}.c span{color:var(--mut);font-size:12.5px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);margin:20px 0 8px}.row{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--l,#9aa3af);border-radius:10px;padding:10px 14px;margin:0 0 8px;display:grid;grid-template-columns:1fr auto;gap:2px 14px;align-items:center}.row b{font-size:15px}.row small{color:var(--mut);grid-column:1}.n{grid-row:1/3;grid-column:2;text-align:right;font-size:24px;font-weight:700}.n small{display:block;font-size:11px;font-weight:400;color:var(--mut)}.bar{grid-column:1/3;height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin-top:6px}.bar i{display:block;height:100%;background:var(--acc)}.pg{display:inline-block;width:70px;height:5px;border-radius:3px;background:var(--line);vertical-align:middle;margin:0 6px 0 4px;overflow:hidden}.pg i{display:block;height:100%;background:var(--l)}.un{opacity:.85;border-left-color:var(--line)}@media print{body{background:#fff}.row{break-inside:avoid}}`;
  const body = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "sv", { numeric: true })).map(([area, list]) => `<h2>${esc(area)}</h2>` + list.map(({ t, a, ph }) => { const l = col[ph] || "#9aa3af", p = a ? Math.round(Number(a.progress) || 0) : 0; const tg = `${t.shift ? `<span class="tag">Skift ${t.shift}</span>` : ""}${t.area ? `<span class="tag ar">📍 ${esc(t.area)}</span>` : ""}`; return `<div class="row${a ? "" : " un"}" style="--l:${l}"><b>${esc(t.text)}</b><div class="n">${Number(t.workers) || 0}<small>personer</small></div>${a ? `<small>${tg}${esc(itemLabel(a))} · ${esc(fd(a.startDate))}–${esc(fd(a.endDate))} · framdrift ${p} %<span class="pg" style="--l:${l}"><i style="width:${p}%"></i></span></small>` : `<small>${tg}Ingen kopplad aktivitet</small>`}<div class="bar"><i style="width:${Math.round(100 * (Number(t.workers) || 0) / max)}%"></i></div></div>`; }).join("")).join("");
  const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dagsplan ${esc(rec.date)}${rec.company ? " – " + esc(rec.company) : ""}</title><style>${css}.tag{display:inline-block;font-size:11px;font-weight:600;border:1px solid var(--line);border-radius:99px;padding:0 8px;margin-right:6px;color:var(--mut)}.tag.ar{color:var(--acc)}</style></head><body><div class="w"><h1>Dagsplan ${esc(head)}</h1><div class="sub">${esc(rec.company || "Underentreprenör")} · ${esc((typeof projectName !== "undefined" && projectName) || "")}</div>
<div class="cards"><div class="c"><b>${rec.total ?? sumW}</b><span>personer totalt${rec.extras ? " + " + esc(rec.extras) : ""}</span></div><div class="c"><b>${rec.tasks.length}</b><span>arbeten</span></div><div class="c"><b>${sumW}</b><span>personer på raderna</span></div>${[1, 2, 3].filter(n => rec.tasks.some(x => Number(x.shift) === n)).map(n => `<div class="c"><b>${rec.tasks.filter(x => Number(x.shift) === n).reduce((a, x) => a + (Number(x.workers) || 0), 0)}</b><span>skift ${n}</span></div>`).join("")}<div class="c"><b>${groups.size}</b><span>områden</span></div></div>${body}</div></body></html>`;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })); a.download = `Dagsplan ${rec.date}${rec.company ? " " + rec.company : ""}.html`.replace(/[\\/:*?"<>|]/g, "-");
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---- Start ---- */
(function () {
  const b = document.getElementById("dpOpenBtn"); if (b) b.addEventListener("click", () => dpOpen());
  // Läser dagsplanerna i bakgrunden efter start så att tavlan kan visa antal personer.
  setTimeout(() => { if (typeof isBackendConfigured === "function" && isBackendConfigured()) dpLoad().then(() => { if (dayplans.length && typeof renderAll === "function") renderAll(); }).catch(() => {}); }, 2500);
})();
