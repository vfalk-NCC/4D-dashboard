/* =========================================================================
   4D-dashboard – Trimble Connect Extension
   ---------------------------------------------------------------------
   Fristående extension som visar nyckeltal, statusfördelning och
   framdrift (uppdelat på område/entreprenör) för samma planeringsdata
   som 4D-planering skriver till (Supabase-tabellen plan_items).
   Läser bara data – skriver aldrig något till databasen.
   Bygger på trimble-connect-workspace-api. Se:
   https://developer.trimble.com/docs/connect/workspace-api/
   ========================================================================= */

let API = null;              // Workspace API-instans
let projectId = null;        // Aktuellt Trimble Connect-projekt
let items = [];               // Cache av samtliga planeringsposter (från backend, ofiltrerat)
let settings = {
  supabaseUrl: "",
  supabaseKey: ""
};
// Aktiv filtrering – tomt värde ("") betyder "alla" för respektive fält.
let filters = {
  area: "",
  activity: "",
  contractor: ""
};

// Svenska visningsnamn och färger per statusvärde - samma som i
// 4D-planering, så de två apparna känns igen som en helhet.
const STATUS_LABELS = {
  ej_planerad: "Ej planerad",
  planerad: "Planerad",
  pagaende: "Pågående",
  forsenad: "Försenad",
  klar: "Klar",
  pausad: "Pausad"
};
const STATUS_COLORS = {
  ej_planerad: "#cbd5e1",
  planerad: "#94a3b8",
  pagaende: "#f5a623",
  forsenad: "#e5484d",
  klar: "#3fb950",
  pausad: "#a1a1aa"
};
const STATUS_ORDER = ["ej_planerad", "planerad", "pagaende", "forsenad", "klar", "pausad"];

const NO_AREA_LABEL = "Utan område";
const NO_ACTIVITY_LABEL = "Utan aktivitet";
const NO_CONTRACTOR_LABEL = "Utan entreprenör";

// Max antal rader att hämta från Supabase per anrop (se samma resonemang
// som i 4D-planering: PostgRESTs/Supabase-projektets egen "Max Rows"
// sätter också ett tak).
const ITEMS_FETCH_LIMIT = 50000;

// Hur många veckor framåt (denna vecka + kommande) som visas i
// "Kommande veckor"-panelen.
const LOOKAHEAD_WEEKS = 3;

// Max antal rader att visa i "Försenade objekt"-listan.
const DELAYED_LIST_MAX = 15;

// plan_item_comments delas av alla Trimble Connect-projekt som pekar mot
// samma Supabase-databas (tabellen har ingen egen project_id-kolumn, bara
// plan_item_id). Vi hämtar därför de N senaste kommentarerna totalt och
// filtrerar client-side mot de objekt-id:n som hör till det här projektet
// – enklare och mer robust än att bygga en lång "in.(id1,id2,...)"-fråga.
const COMMENTS_FETCH_LIMIT = 500;
const COMMENTS_SHOWN = 20;
let recentComments = []; // Cache av senast hämtade kommentarer (ofiltrerat på projekt)

/* ---------------------------------------------------------------------
   Init
   ------------------------------------------------------------------- */
window.addEventListener("DOMContentLoaded", init);

async function init() {
  loadLocalSettings();
  bindUI();

  API = await TrimbleConnectWorkspace.connect(window.parent, () => {}, 30000);

  const project = await API.project.getProject();
  projectId = project.id;

  await refreshAll();
}

function bindUI() {
  document.getElementById("btnRefresh").onclick = refreshAll;
  document.getElementById("btnSettings").onclick = () => toggle("settingsDialog", true);
  document.getElementById("btnCloseSettings").onclick = () => toggle("settingsDialog", false);
  document.getElementById("btnSaveSettings").onclick = onSaveSettings;

  document.getElementById("supabaseUrl").value = settings.supabaseUrl;
  document.getElementById("supabaseKey").value = settings.supabaseKey;
  updateConnectionWarning();

  document.getElementById("filterArea").onchange = onFilterChange;
  document.getElementById("filterActivity").onchange = onFilterChange;
  document.getElementById("filterContractor").onchange = onFilterChange;
  document.getElementById("btnResetFilters").onclick = onResetFilters;
}

function toggle(id, show) {
  document.getElementById(id).classList.toggle("hidden", !show);
}

/* ---------------------------------------------------------------------
   Filtrering (område / aktivitet / entreprenör)
   ------------------------------------------------------------------- */
function onFilterChange() {
  filters.area = document.getElementById("filterArea").value;
  filters.activity = document.getElementById("filterActivity").value;
  filters.contractor = document.getElementById("filterContractor").value;
  renderAll();
}

function onResetFilters() {
  filters = { area: "", activity: "", contractor: "" };
  document.getElementById("filterArea").value = "";
  document.getElementById("filterActivity").value = "";
  document.getElementById("filterContractor").value = "";
  renderAll();
}

function getFilteredItems() {
  return items.filter(it => {
    if (filters.area && it.area !== filters.area) return false;
    if (filters.activity && it.activity !== filters.activity) return false;
    if (filters.contractor && it.contractor !== filters.contractor) return false;
    return true;
  });
}

// Fyller filtrets tre <select>-fält med de värden som faktiskt finns i
// datan just nu. Behåller vald filtrering om värdet fortfarande finns
// kvar i listan efter en omhämtning, annars nollställs det.
function populateFilterOptions() {
  fillSelect("filterArea", "area", uniqueValues(it => it.area), "Alla områden");
  fillSelect("filterActivity", "activity", uniqueValues(it => it.activity), "Alla aktiviteter");
  fillSelect("filterContractor", "contractor", uniqueValues(it => it.contractor), "Alla entreprenörer");
}

function uniqueValues(keyFn) {
  const set = new Set();
  items.forEach(it => {
    const v = keyFn(it);
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "sv"));
}

function fillSelect(id, filterKey, values, allLabel) {
  const el = document.getElementById(id);
  const current = filters[filterKey];

  el.innerHTML = [`<option value="">${escapeHtml(allLabel)}</option>`]
    .concat(values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`))
    .join("");

  if (current && values.includes(current)) {
    el.value = current;
  } else {
    filters[filterKey] = "";
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

/* ---------------------------------------------------------------------
   Inställningar (lagras lokalt i webbläsaren för denna extension)
   ------------------------------------------------------------------- */
function loadLocalSettings() {
  try {
    const raw = window.localStorage.getItem("4ddash-settings");
    if (raw) settings = { ...settings, ...JSON.parse(raw) };
  } catch (e) { /* ignorera */ }
}

function onSaveSettings() {
  settings.supabaseUrl = document.getElementById("supabaseUrl").value.trim().replace(/\/$/, "");
  settings.supabaseKey = document.getElementById("supabaseKey").value.trim();
  window.localStorage.setItem("4ddash-settings", JSON.stringify(settings));
  updateConnectionWarning();
  toggle("settingsDialog", false);
  refreshAll();
}

function isSupabaseConfigured() {
  return Boolean(settings.supabaseUrl && settings.supabaseKey);
}

function updateConnectionWarning() {
  const el = document.getElementById("connectionWarning");
  if (!el) return;
  if (isSupabaseConfigured()) {
    el.classList.add("hidden");
    el.innerText = "";
  } else {
    el.classList.remove("hidden");
    el.innerText = "⚠️ Ingen databas ansluten – öppna inställningarna (kugghjulet) och ange samma Supabase-URL och nyckel som i 4D-planering.";
  }
}

/* ---------------------------------------------------------------------
   Hämta data + rita om allt
   ------------------------------------------------------------------- */
async function refreshAll() {
  await Promise.all([fetchItems(), fetchRecentComments()]);
  populateFilterOptions();
  renderAll();
  updateLastUpdated();
}

// Ritar om alla paneler utifrån den aktuella filtreringen. Anropas både
// efter en ny hämtning och varje gång användaren ändrar ett filter (utan
// att hämta om data från Supabase).
function renderAll() {
  renderKpis();
  renderStatusChart();
  const filtered = getFilteredItems();
  renderGroupProgress("areaProgress", filtered, it => it.area, NO_AREA_LABEL);
  renderGroupProgress("contractorProgress", filtered, it => it.contractor, NO_CONTRACTOR_LABEL);
  renderLookahead(filtered);
  renderDelayedList(filtered);
  renderComments(filtered);
}

async function fetchItems() {
  if (!isSupabaseConfigured()) {
    items = [];
    return;
  }
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_items?project_id=eq.${encodeURIComponent(projectId)}&select=*`;
    const res = await fetch(url, {
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        Range: `0-${ITEMS_FETCH_LIMIT - 1}`
      }
    });
    items = res.ok ? (await res.json()).map(fromRow) : [];
  } catch (e) {
    console.error("Kunde inte hämta planeringsdata", e);
    items = [];
  }
}

function fromRow(row) {
  return {
    id: row.id,
    objectName: (row.object_name || "").trim(),
    status: row.status || "planerad",
    progress: Number.isFinite(row.progress) ? row.progress : 0,
    area: (row.area || "").trim(),
    activity: (row.activity || "").trim(),
    contractor: (row.contractor || "").trim(),
    startDate: row.start_date || null,
    endDate: row.end_date || null
  };
}

// Hämtar de senaste kommentarerna (över alla projekt som delar databasen,
// se kommentaren vid COMMENTS_FETCH_LIMIT ovan) från 4D-planerings
// kommentarstabell. Läser bara – dashboarden skriver aldrig kommentarer.
async function fetchRecentComments() {
  if (!isSupabaseConfigured()) {
    recentComments = [];
    return;
  }
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_item_comments?select=*&order=created_at.desc`;
    const res = await fetch(url, {
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        Range: `0-${COMMENTS_FETCH_LIMIT - 1}`
      }
    });
    recentComments = res.ok ? await res.json() : [];
  } catch (e) {
    console.error("Kunde inte hämta kommentarer", e);
    recentComments = [];
  }
}

/* ---------------------------------------------------------------------
   Datumhjälpfunktioner (UTC-baserade så att "idag" och datumfält från
   databasen jämförs konsekvent, oavsett webbläsarens tidszon).
   ------------------------------------------------------------------- */
function parseDate(value) {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfWeekUTC(date) {
  const day = (date.getUTCDay() + 6) % 7; // Måndag = 0
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}

function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // torsdag samma vecka
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((d - firstThursday) / (7 * 24 * 60 * 60 * 1000));
}

function relativeTime(value) {
  const d = parseDate(value);
  if (!d) return "";
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "just nu";
  if (diffMin < 60) return `${diffMin} min sedan`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} tim sedan`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD} dygn sedan`;
  return d.toLocaleDateString("sv-SE");
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

// Namnet att visa för ett objekt i listor – objektnamnet om det finns,
// annars område + aktivitet som fallback.
function itemLabel(it) {
  return it.objectName || [it.area, it.activity].filter(Boolean).join(" · ") || "Okänt objekt";
}

function updateLastUpdated() {
  const el = document.getElementById("lastUpdated");
  if (!el) return;
  if (!isSupabaseConfigured()) {
    el.innerText = "";
    return;
  }
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  el.innerText = `Senast uppdaterad: ${pad(now.getHours())}:${pad(now.getMinutes())} (${items.length} objekt)`;
}

// Meddelande att visa i en panel när det inte finns något att rita.
// Skiljer mellan "ingen databas", "tomt projekt" och "filtret gav träff
// på noll objekt", så det alltid är tydligt varför panelen är tom.
function emptyMessage() {
  if (!isSupabaseConfigured()) return "Ingen databas ansluten ännu.";
  if (items.length === 0) return "Inga planerade objekt hittades för det här projektet.";
  return "Inga objekt matchar den valda filtreringen.";
}

/* ---------------------------------------------------------------------
   Statistik
   ------------------------------------------------------------------- */
function computeStats(list) {
  const total = list.length;
  const byStatus = {};
  STATUS_ORDER.forEach(s => { byStatus[s] = 0; });
  let progressSum = 0;

  list.forEach(it => {
    if (byStatus[it.status] === undefined) byStatus[it.status] = 0;
    byStatus[it.status]++;
    progressSum += it.progress;
  });

  const done = byStatus.klar || 0;
  const delayed = byStatus.forsenad || 0;
  const notPlanned = byStatus.ej_planerad || 0;
  const avgProgress = total > 0 ? Math.round(progressSum / total) : 0;

  return { total, byStatus, done, delayed, notPlanned, avgProgress };
}

/* ---------------------------------------------------------------------
   Översikt (KPI-rutnät)
   ------------------------------------------------------------------- */
function renderKpis() {
  const el = document.getElementById("kpiGrid");
  const list = getFilteredItems();
  const s = computeStats(list);

  if (s.total === 0) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const donePct = Math.round((s.done / s.total) * 100);
  const delayedPct = Math.round((s.delayed / s.total) * 100);

  const tiles = [
    { value: s.total, label: "Objekt totalt", accent: "" },
    { value: `${donePct}%`, label: "Klara", accent: "accent-done" },
    { value: `${delayedPct}%`, label: "Försenade", accent: "accent-delayed" },
    { value: `${s.avgProgress}%`, label: "Snittframdrift", accent: "accent-progress" },
    { value: s.notPlanned, label: "Ej planerade", accent: "" }
  ];

  el.innerHTML = tiles.map(t => `
    <div class="kpi-tile ${t.accent}">
      <div class="kpi-value">${t.value}</div>
      <div class="kpi-label">${t.label}</div>
    </div>`).join("");
}

/* ---------------------------------------------------------------------
   Statusfördelning
   ------------------------------------------------------------------- */
function renderStatusChart() {
  const el = document.getElementById("statusChart");
  const list = getFilteredItems();
  const s = computeStats(list);

  if (s.total === 0) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const maxCount = Math.max(...STATUS_ORDER.map(status => s.byStatus[status] || 0), 1);

  el.innerHTML = STATUS_ORDER.map(status => {
    const count = s.byStatus[status] || 0;
    const widthPct = Math.round((count / maxCount) * 100);
    return `
      <div class="status-row">
        <span class="status-label">${STATUS_LABELS[status]}</span>
        <span class="status-track"><span class="status-fill" style="width:${widthPct}%;background:${STATUS_COLORS[status]}"></span></span>
        <span class="status-count">${count} (${Math.round((count / s.total) * 100)}%)</span>
      </div>`;
  }).join("");
}

/* ---------------------------------------------------------------------
   Framdrift per grupp (område / entreprenör) – genomsnittlig progress
   (%) inom gruppen, ritad som en horisontell stapel, plus antal objekt
   och antal försenade i gruppen.
   ------------------------------------------------------------------- */
function computeGroupProgress(list, keyFn, fallbackLabel) {
  const map = new Map();

  list.forEach(it => {
    const raw = keyFn(it);
    const key = raw ? raw : fallbackLabel;
    if (!map.has(key)) map.set(key, { count: 0, progressSum: 0, delayed: 0 });
    const g = map.get(key);
    g.count++;
    g.progressSum += it.progress;
    if (it.status === "forsenad") g.delayed++;
  });

  const groups = Array.from(map.entries()).map(([label, g]) => ({
    label,
    count: g.count,
    avgProgress: g.count ? Math.round(g.progressSum / g.count) : 0,
    delayed: g.delayed
  }));

  // Alfabetisk (svensk) sortering, men "Utan område"/"Utan entreprenör"
  // hamnar alltid sist eftersom den gruppen är minst relevant att titta på.
  groups.sort((a, b) => {
    if (a.label === fallbackLabel) return 1;
    if (b.label === fallbackLabel) return -1;
    return a.label.localeCompare(b.label, "sv");
  });

  return groups;
}

function renderGroupProgress(containerId, list, keyFn, fallbackLabel) {
  const el = document.getElementById(containerId);

  if (list.length === 0) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const groups = computeGroupProgress(list, keyFn, fallbackLabel);

  el.innerHTML = groups.map(g => `
    <div class="progress-row">
      <span class="progress-label" title="${escapeHtml(g.label)}">${escapeHtml(g.label)}</span>
      <span class="progress-track"><span class="progress-fill" style="width:${g.avgProgress}%"></span></span>
      <span class="progress-value">${g.avgProgress}%</span>
      <span class="progress-meta">${g.count} obj${g.delayed ? ` · ${g.delayed} försenade` : ""}</span>
    </div>`).join("");
}

/* ---------------------------------------------------------------------
   Kommande veckor (lookahead) – "Denna vecka" + kommande veckor: hur
   många objekt som ska starta respektive vara klara, och hur många av
   de sistnämnda som redan ligger som försenade.
   ------------------------------------------------------------------- */
function computeLookahead(list) {
  const weekStart = startOfWeekUTC(todayUTC());
  const weeks = [];

  for (let i = 0; i < LOOKAHEAD_WEEKS; i++) {
    const start = new Date(weekStart);
    start.setUTCDate(start.getUTCDate() + i * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    weeks.push({
      start, end,
      label: i === 0 ? "Denna vecka" : `Vecka ${isoWeekNumber(start)}`,
      starting: 0, due: 0, done: 0, delayed: 0
    });
  }

  list.forEach(it => {
    const sd = parseDate(it.startDate);
    const ed = parseDate(it.endDate);
    weeks.forEach(w => {
      if (sd && sd >= w.start && sd <= w.end) w.starting++;
      if (ed && ed >= w.start && ed <= w.end) {
        w.due++;
        if (it.status === "klar") w.done++;
        else if (it.status === "forsenad") w.delayed++;
      }
    });
  });

  return weeks;
}

function renderLookahead(list) {
  const el = document.getElementById("lookaheadChart");

  if (list.length === 0) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const weeks = computeLookahead(list);
  const header = `
    <div class="lookahead-row header">
      <span></span>
      <span class="lookahead-cell">Startar</span>
      <span class="lookahead-cell">Ska vara klara</span>
      <span class="lookahead-cell">Klara</span>
      <span class="lookahead-cell">Försenade</span>
    </div>`;

  el.innerHTML = header + weeks.map(w => `
    <div class="lookahead-row">
      <span class="lookahead-label">${escapeHtml(w.label)}</span>
      <span class="lookahead-cell">${w.starting}</span>
      <span class="lookahead-cell">${w.due}</span>
      <span class="lookahead-cell">${w.done}</span>
      <span class="lookahead-cell${w.delayed ? " delayed" : ""}">${w.delayed}</span>
    </div>`).join("");
}

/* ---------------------------------------------------------------------
   Försenade objekt – sorterad lista på antal dagar över planerat
   slutdatum (baserat på slutdatum, inte bara status, så listan även
   fångar objekt vars status inte hunnit uppdateras manuellt).
   ------------------------------------------------------------------- */
function computeDelayedList(list) {
  const today = todayUTC();

  return list
    .map(it => {
      const ed = parseDate(it.endDate);
      if (it.status === "klar" || !ed || ed >= today) return null;
      const overdueDays = Math.round((today - ed) / (24 * 60 * 60 * 1000));
      return { it, overdueDays };
    })
    .filter(Boolean)
    .sort((a, b) => b.overdueDays - a.overdueDays);
}

function renderDelayedList(list) {
  const el = document.getElementById("delayedList");

  if (list.length === 0) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const delayed = computeDelayedList(list);
  if (delayed.length === 0) {
    el.innerHTML = `<div class="hint">Inga försenade objekt just nu.</div>`;
    return;
  }

  const shown = delayed.slice(0, DELAYED_LIST_MAX);
  const rows = shown.map(({ it, overdueDays }) => {
    const meta = [it.area || NO_AREA_LABEL, it.contractor].filter(Boolean).join(" · ");
    return `
      <div class="delayed-row">
        <span class="delayed-label" title="${escapeHtml(itemLabel(it))}">${escapeHtml(itemLabel(it))}</span>
        <span class="delayed-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</span>
        <span class="delayed-days">${overdueDays} dagar</span>
      </div>`;
  }).join("");

  const more = delayed.length > DELAYED_LIST_MAX
    ? `<div class="hint">+ ${delayed.length - DELAYED_LIST_MAX} till</div>`
    : "";

  el.innerHTML = rows + more;
}

/* ---------------------------------------------------------------------
   Senaste kommentarer – de senaste kommentarerna (från 4D-planering)
   på objekt som hör till den aktuella filtreringen.
   ------------------------------------------------------------------- */
function renderComments(list) {
  const el = document.getElementById("commentsFeed");

  if (!isSupabaseConfigured()) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const itemById = new Map(list.map(it => [it.id, it]));
  const relevant = recentComments
    .filter(c => itemById.has(c.plan_item_id))
    .slice(0, COMMENTS_SHOWN);

  if (relevant.length === 0) {
    el.innerHTML = `<div class="hint">Inga kommentarer på matchande objekt ännu.</div>`;
    return;
  }

  el.innerHTML = relevant.map(c => {
    const it = itemById.get(c.plan_item_id);
    const label = itemLabel(it);
    return `
      <div class="comment-row">
        <div class="comment-head">
          <span class="comment-author">${escapeHtml(c.author || "Anonym")}</span>
          <span class="comment-time">${relativeTime(c.created_at)}</span>
        </div>
        <div class="comment-object" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
        <div class="comment-body">${escapeHtml(truncate(c.body || "", 160))}</div>
      </div>`;
  }).join("");
}
