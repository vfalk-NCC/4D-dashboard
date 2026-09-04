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
  await fetchItems();
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
    status: row.status || "planerad",
    progress: Number.isFinite(row.progress) ? row.progress : 0,
    area: (row.area || "").trim(),
    activity: (row.activity || "").trim(),
    contractor: (row.contractor || "").trim()
  };
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
