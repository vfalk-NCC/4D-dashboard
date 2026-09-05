/* =========================================================================
   4D-dashboard – Trimble Connect Extension
   ---------------------------------------------------------------------
   Fristående extension som visar nyckeltal, statusfördelning och
   framdrift (uppdelat på område/entreprenör) för samma planeringsdata
   som 4D-planering skriver till (Supabase-tabellen plan_items).
   Läser plan_items/plan_item_comments (skriver aldrig till dem), men
   skriver via små formulär till fem separata tabeller (milstolpar,
   bemanning, leveransplan, säkerhet, besiktningar) – se README.md.
   Bygger på trimble-connect-workspace-api. Se:
   https://developer.trimble.com/docs/connect/workspace-api/
   ========================================================================= */

let API = null;              // Workspace API-instans
let projectId = null;        // Aktuellt Trimble Connect-projekt
let items = [];               // Cache av samtliga planeringsposter (från backend, ofiltrerat)
let settings = {
  supabaseUrl: "",
  supabaseKey: "",
  latitude: "",
  longitude: ""
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
   Nya tabeller (dashboard-funktioner, migration_3_dashboard_features.sql)
   ------------------------------------------------------------------- */
const PROGRESS_HISTORY_FETCH_LIMIT = 20000;
const MILESTONES_FETCH_LIMIT = 500;
const STAFFING_FETCH_LIMIT = 2000;
const DELIVERIES_FETCH_LIMIT = 2000;
const SAFETY_FETCH_LIMIT = 2000;
const INSPECTIONS_FETCH_LIMIT = 5000;

// Hur många veckor (denna vecka + kommande) som visas i bemanningspanelen
// – samma fönster-koncept som "Kommande veckor".
const STAFFING_WEEKS = 3;

let progressHistory = []; // plan_item_progress_history, ofiltrerat på item-filter
let milestones = [];      // plan_milestones
let staffing = [];        // plan_staffing
let deliveries = [];      // plan_deliveries
let safetyEvents = [];    // plan_safety_events
let inspections = [];     // plan_inspections
let weather = null;       // Senaste svar från Open-Meteo (eller null)

const DELIVERY_STATUS_OPTIONS = ["planerad", "på väg", "levererad", "försenad"];
const DELIVERY_STATUS_COLORS = {
  planerad: "#94a3b8",
  "på väg": "#0b5fff",
  levererad: "#3fb950",
  försenad: "#e5484d"
};

const SAFETY_EVENT_TYPES = ["tillbud", "olycka", "skyddsrond", "riskobservation"];
const SAFETY_SEVERITIES = ["låg", "medel", "hög"];
const SEVERITY_COLORS = { "låg": "#3fb950", medel: "#f5a623", hög: "#e5484d" };

const INSPECTION_TYPES = ["egenkontroll", "besiktning", "slutbesiktning", "myndighetsbesiktning"];
const INSPECTION_RESULTS = ["godkänd", "anmärkning", "underkänd"];
const INSPECTION_RESULT_COLORS = { "godkänd": "#3fb950", "anmärkning": "#f5a623", "underkänd": "#e5484d" };

// Swedish korta beskrivningar för WMO weather_code (Open-Meteo).
const WMO_DESCRIPTIONS = {
  0: "Klart", 1: "Mest klart", 2: "Delvis molnigt", 3: "Mulet",
  45: "Dimma", 48: "Rimfrostdimma",
  51: "Lätt duggregn", 53: "Duggregn", 55: "Kraftigt duggregn",
  56: "Lätt underkylt duggregn", 57: "Underkylt duggregn",
  61: "Lätt regn", 63: "Regn", 65: "Kraftigt regn",
  66: "Lätt underkylt regn", 67: "Underkylt regn",
  71: "Lätt snöfall", 73: "Snöfall", 75: "Kraftigt snöfall", 77: "Snökorn",
  80: "Lätta regnskurar", 81: "Regnskurar", 82: "Kraftiga regnskurar",
  85: "Lätta snöbyar", 86: "Kraftiga snöbyar",
  95: "Åska", 96: "Åska med hagel", 99: "Kraftig åska med hagel"
};
function weatherDescription(code) {
  return WMO_DESCRIPTIONS[code] || "Okänt väder";
}

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
  document.getElementById("settingsLatitude").value = settings.latitude || "";
  document.getElementById("settingsLongitude").value = settings.longitude || "";
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
  settings.latitude = document.getElementById("settingsLatitude").value.trim();
  settings.longitude = document.getElementById("settingsLongitude").value.trim();
  window.localStorage.setItem("4ddash-settings", JSON.stringify(settings));
  updateConnectionWarning();
  toggle("settingsDialog", false);
  refreshAll();
}

function isSupabaseConfigured() {
  return Boolean(settings.supabaseUrl && settings.supabaseKey);
}

// Väder kräver bara koordinater (ingen Supabase-koppling).
function isWeatherConfigured() {
  const lat = Number(settings.latitude);
  const lon = Number(settings.longitude);
  return settings.latitude !== "" && settings.longitude !== "" &&
    Number.isFinite(lat) && Number.isFinite(lon);
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
  await Promise.all([
    fetchItems(),
    fetchRecentComments(),
    fetchProgressHistory(),
    fetchMilestones(),
    fetchStaffing(),
    fetchDeliveries(),
    fetchSafetyEvents(),
    fetchInspections(),
    fetchWeather()
  ]);
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
  renderScurve(filtered);
  renderLookahead(filtered);
  renderMilestones();
  renderDelayedList(filtered);
  renderGroupProgress("areaProgress", filtered, it => it.area, NO_AREA_LABEL);
  renderGroupProgress("contractorProgress", filtered, it => it.contractor, NO_CONTRACTOR_LABEL);
  renderStaffing();
  renderDeliveries();
  renderSafety();
  renderInspections();
  renderWeather();
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

// Framdriftshistorik (S-kurva). Fylls på automatiskt av en trigger i
// 4D-planerings databas – dashboarden läser bara. Om tabellen inte finns
// än (migreringen inte körd) ger Supabase ett icke-2xx-svar och vi
// faller tillbaka på en tom lista, precis som för övriga hämtningar.
async function fetchProgressHistory() {
  if (!isSupabaseConfigured()) { progressHistory = []; return; }
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_item_progress_history?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=recorded_at.asc`;
    const res = await fetch(url, {
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        Range: `0-${PROGRESS_HISTORY_FETCH_LIMIT - 1}`
      }
    });
    progressHistory = res.ok ? await res.json() : [];
  } catch (e) {
    console.error("Kunde inte hämta framdriftshistorik", e);
    progressHistory = [];
  }
}

async function fetchMilestones() {
  if (!isSupabaseConfigured()) { milestones = []; return; }
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_milestones?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=target_date.asc`;
    const res = await fetch(url, {
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        Range: `0-${MILESTONES_FETCH_LIMIT - 1}`
      }
    });
    milestones = res.ok ? await res.json() : [];
  } catch (e) {
    console.error("Kunde inte hämta milstolpar", e);
    milestones = [];
  }
}

async function fetchStaffing() {
  if (!isSupabaseConfigured()) { staffing = []; return; }
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_staffing?project_id=eq.${encodeURIComponent(projectId)}&select=*`;
    const res = await fetch(url, {
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        Range: `0-${STAFFING_FETCH_LIMIT - 1}`
      }
    });
    staffing = res.ok ? await res.json() : [];
  } catch (e) {
    console.error("Kunde inte hämta bemanning", e);
    staffing = [];
  }
}

async function fetchDeliveries() {
  if (!isSupabaseConfigured()) { deliveries = []; return; }
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_deliveries?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=planned_date.asc`;
    const res = await fetch(url, {
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        Range: `0-${DELIVERIES_FETCH_LIMIT - 1}`
      }
    });
    deliveries = res.ok ? await res.json() : [];
  } catch (e) {
    console.error("Kunde inte hämta leveransplan", e);
    deliveries = [];
  }
}

async function fetchSafetyEvents() {
  if (!isSupabaseConfigured()) { safetyEvents = []; return; }
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_safety_events?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=event_date.desc`;
    const res = await fetch(url, {
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        Range: `0-${SAFETY_FETCH_LIMIT - 1}`
      }
    });
    safetyEvents = res.ok ? await res.json() : [];
  } catch (e) {
    console.error("Kunde inte hämta säkerhetshändelser", e);
    safetyEvents = [];
  }
}

async function fetchInspections() {
  if (!isSupabaseConfigured()) { inspections = []; return; }
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_inspections?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=inspected_at.desc`;
    const res = await fetch(url, {
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        Range: `0-${INSPECTIONS_FETCH_LIMIT - 1}`
      }
    });
    inspections = res.ok ? await res.json() : [];
  } catch (e) {
    console.error("Kunde inte hämta besiktningar", e);
    inspections = [];
  }
}

// Väder är helt fristående från Supabase (annan origin, inget API-nyckel-
// krav). Ett fel här (nätverk, dåliga koordinater, m.m.) ska aldrig få
// resten av sidan att sluta fungera – därför fångas allt i try/catch och
// vi faller tillbaka på weather = null, vilket renderWeather() visar ett
// hint för.
async function fetchWeather() {
  weather = null;
  if (!isWeatherConfigured()) return;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(settings.latitude)}&longitude=${encodeURIComponent(settings.longitude)}&current=temperature_2m,precipitation,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=4`;
    const res = await fetch(url);
    weather = res.ok ? await res.json() : null;
  } catch (e) {
    console.error("Kunde inte hämta väderdata", e);
    weather = null;
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

// Dagens datum som "YYYY-MM-DD" (UTC), samma format som databasens date-fält.
function todayISO() {
  return todayUTC().toISOString().slice(0, 10);
}

// Formaterar ett date-/timestamp-värde från databasen på svenskt vis
// (t.ex. "2026-09-04" eller en ISO-tidsstämpel).
function formatDateSv(value) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString("sv-SE", { timeZone: "UTC" }) : "";
}

// De N kommande veckofönstren (denna vecka + N-1 framåt), samma
// veckoindelning som "Kommande veckor"-panelen.
function currentWeekWindows(n) {
  const start0 = startOfWeekUTC(todayUTC());
  const weeks = [];
  for (let i = 0; i < n; i++) {
    const start = new Date(start0);
    start.setUTCDate(start.getUTCDate() + i * 7);
    weeks.push({ start, label: i === 0 ? "Denna vecka" : `Vecka ${isoWeekNumber(start)}` });
  }
  return weeks;
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
   S-kurva (framdrift över tid) – "Planerat" = andel objekt vars
   slutdatum har passerat vid respektive veckas slut (kumulativt).
   "Utfall" = genomsnittlig progress vecka för vecka, hämtad ur
   plan_item_progress_history (närmast föregående/samma tidpunkt som
   veckans slut), eller objektets nuvarande progress för innevarande
   vecka. Byggs från tidigaste tillgängliga vecka (start_date eller
   historik, den tidigaste av de två) fram till och med innevarande
   vecka, med samma veckoindelning som "Kommande veckor".
   ------------------------------------------------------------------- */
function computeScurve(list) {
  const currentWeekStart = startOfWeekUTC(todayUTC());

  let earliest = null;
  list.forEach(it => {
    const sd = parseDate(it.startDate);
    if (sd && (!earliest || sd < earliest)) earliest = sd;
  });
  progressHistory.forEach(h => {
    const rd = parseDate(h.recorded_at);
    if (rd && (!earliest || rd < earliest)) earliest = rd;
  });

  let earliestWeekStart;
  if (earliest) {
    earliestWeekStart = startOfWeekUTC(earliest);
  } else {
    earliestWeekStart = new Date(currentWeekStart);
    earliestWeekStart.setUTCDate(earliestWeekStart.getUTCDate() - 8 * 7);
  }
  if (earliestWeekStart > currentWeekStart) earliestWeekStart = new Date(currentWeekStart);

  const weeks = [];
  let cursor = new Date(earliestWeekStart);
  let guard = 0;
  while (cursor <= currentWeekStart && guard < 260) {
    weeks.push(new Date(cursor));
    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
    guard++;
  }
  if (weeks.length === 0) weeks.push(new Date(currentWeekStart));

  const total = list.length;

  const historyByItem = new Map();
  progressHistory.forEach(h => {
    if (!historyByItem.has(h.plan_item_id)) historyByItem.set(h.plan_item_id, []);
    historyByItem.get(h.plan_item_id).push(h);
  });
  historyByItem.forEach(arr => arr.sort((a, b) => parseDate(a.recorded_at) - parseDate(b.recorded_at)));

  return weeks.map((weekStart, idx) => {
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    weekEnd.setUTCHours(23, 59, 59, 999);
    const isCurrentWeek = idx === weeks.length - 1;

    let plannedDone = 0;
    list.forEach(it => {
      const ed = parseDate(it.endDate);
      if (ed && ed <= weekEnd) plannedDone++;
    });
    const planned = total > 0 ? Math.round((plannedDone / total) * 100) : 0;

    let sum = 0, count = 0;
    list.forEach(it => {
      if (isCurrentWeek) {
        sum += it.progress;
        count++;
        return;
      }
      const hist = historyByItem.get(it.id);
      if (!hist) return;
      let best = null;
      for (const h of hist) {
        const rd = parseDate(h.recorded_at);
        if (rd && rd <= weekEnd) best = h;
        else break;
      }
      if (best) { sum += best.progress; count++; }
    });
    const utfall = count > 0 ? Math.round(sum / count) : null;

    return { weekStart, label: `v${isoWeekNumber(weekStart)}`, planned, utfall };
  });
}

function renderScurve(list) {
  const el = document.getElementById("scurveChart");

  if (list.length === 0) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const points = computeScurve(list);
  const W = 640, H = 220, ML = 30, MR = 10, MT = 10, MB = 24;
  const innerW = W - ML - MR, innerH = H - MT - MB;
  const n = points.length;
  const xFor = i => (n <= 1 ? ML + innerW / 2 : ML + (innerW * i) / (n - 1));
  const yFor = v => MT + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH;

  const gridLines = [0, 25, 50, 75, 100].map(v => {
    const y = yFor(v);
    return `<line x1="${ML}" y1="${y}" x2="${W - MR}" y2="${y}" class="scurve-grid" />
      <text x="${ML - 5}" y="${y + 3}" class="scurve-axis-label" text-anchor="end">${v}</text>`;
  }).join("");

  const plannedPts = points.map((p, i) => `${xFor(i)},${yFor(p.planned)}`).join(" ");
  const utfallPts = points
    .map((p, i) => (p.utfall !== null ? `${xFor(i)},${yFor(p.utfall)}` : null))
    .filter(Boolean)
    .join(" ");

  const step = Math.max(1, Math.ceil(n / 8));
  const xLabels = points.map((p, i) => (i % step === 0 || i === n - 1)
    ? `<text x="${xFor(i)}" y="${H - 6}" class="scurve-axis-label" text-anchor="middle">${escapeHtml(p.label)}</text>`
    : "").join("");

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="scurve-svg" role="img" aria-label="Framdrift över tid">
      ${gridLines}
      <polyline points="${plannedPts}" class="scurve-line scurve-line-planned" />
      ${utfallPts ? `<polyline points="${utfallPts}" class="scurve-line scurve-line-utfall" />` : ""}
      ${xLabels}
    </svg>
    <div class="scurve-legend">
      <span class="scurve-legend-item"><span class="scurve-swatch scurve-swatch-planned"></span>Planerat</span>
      <span class="scurve-legend-item"><span class="scurve-swatch scurve-swatch-utfall"></span>Utfall</span>
    </div>`;
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
   Milstolpar – lista sorterad på måldatum, med en kryssruta som PATCHar
   is_done (och sätter/nollställer completed_date) samt ett litet
   formulär för att lägga till nya milstolpar.
   ------------------------------------------------------------------- */
function renderMilestones() {
  const el = document.getElementById("milestonesList");

  if (!isSupabaseConfigured()) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const today = todayUTC();
  const sorted = [...milestones].sort((a, b) => (a.target_date || "").localeCompare(b.target_date || ""));

  const rows = sorted.length === 0
    ? `<div class="hint">Inga milstolpar ännu.</div>`
    : sorted.map(m => {
        const td = parseDate(m.target_date);
        const overdue = !m.is_done && td && td < today;
        return `
          <div class="milestone-row${overdue ? " overdue" : ""}${m.is_done ? " done" : ""}">
            <input type="checkbox" class="milestone-check" data-milestone-id="${m.id}" ${m.is_done ? "checked" : ""} />
            <span class="milestone-name" title="${escapeHtml(m.name || "")}">${escapeHtml(m.name || "")}</span>
            <span class="milestone-date">${formatDateSv(m.target_date)}</span>
          </div>`;
      }).join("");

  el.innerHTML = rows + milestoneFormHtml();

  el.querySelectorAll(".milestone-check").forEach(cb => {
    cb.onchange = () => onToggleMilestone(cb.dataset.milestoneId, cb.checked);
  });
  document.getElementById("btnAddMilestone").onclick = onAddMilestone;
}

function milestoneFormHtml() {
  return `
    <div class="add-form">
      <input type="text" id="newMilestoneName" placeholder="Namn (t.ex. Stomresning klar)" />
      <input type="date" id="newMilestoneDate" />
      <button id="btnAddMilestone">+ Lägg till milstolpe</button>
    </div>`;
}

async function onAddMilestone() {
  const name = document.getElementById("newMilestoneName").value.trim();
  const target_date = document.getElementById("newMilestoneDate").value;
  if (!name || !target_date) return;
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_milestones`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ project_id: projectId, name, target_date })
    });
    if (res.ok) {
      await fetchMilestones();
      renderMilestones();
    }
  } catch (e) {
    console.error("Kunde inte lägga till milstolpe", e);
  }
}

async function onToggleMilestone(id, checked) {
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_milestones?id=eq.${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ is_done: checked, completed_date: checked ? todayISO() : null })
    });
    if (res.ok) {
      await fetchMilestones();
      renderMilestones();
    }
  } catch (e) {
    console.error("Kunde inte uppdatera milstolpe", e);
  }
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
   Bemanning – antal personer per entreprenör och vecka (denna vecka +
   STAFFING_WEEKS - 1 framåt). Formuläret upsertar (unikt på
   project_id+contractor+week_start) så att man kan uppdatera samma
   vecka igen utan att skapa dubbletter.
   ------------------------------------------------------------------- */
function renderStaffing() {
  const el = document.getElementById("staffingChart");

  if (!isSupabaseConfigured()) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const weeks = currentWeekWindows(STAFFING_WEEKS);
  const contractors = uniqueValues(it => it.contractor);
  const byKey = new Map();
  staffing.forEach(s => byKey.set(`${s.contractor}|${s.week_start}`, s.headcount));

  let listHtml;
  if (contractors.length === 0) {
    listHtml = `<div class="hint">Inga entreprenörer hittades i planeringsdatan ännu.</div>`;
  } else {
    const header = `
      <div class="staffing-row header">
        <span></span>
        ${weeks.map(w => `<span class="staffing-cell">${escapeHtml(w.label)}</span>`).join("")}
      </div>`;
    const rows = contractors.map(c => `
      <div class="staffing-row">
        <span class="staffing-label" title="${escapeHtml(c)}">${escapeHtml(c)}</span>
        ${weeks.map(w => {
          const iso = w.start.toISOString().slice(0, 10);
          const v = byKey.get(`${c}|${iso}`);
          return `<span class="staffing-cell">${v !== undefined ? v : "–"}</span>`;
        }).join("")}
      </div>`).join("");
    listHtml = header + rows;
  }

  el.innerHTML = listHtml + staffingFormHtml(contractors, weeks);
  document.getElementById("btnAddStaffing").onclick = onAddStaffing;
}

function staffingFormHtml(contractors, weeks) {
  const contractorField = contractors.length > 0
    ? `<select id="newStaffingContractor">${contractors.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}</select>`
    : `<input type="text" id="newStaffingContractor" placeholder="Entreprenör" />`;
  return `
    <div class="add-form">
      ${contractorField}
      <select id="newStaffingWeek">
        ${weeks.map(w => `<option value="${w.start.toISOString().slice(0, 10)}">${escapeHtml(w.label)}</option>`).join("")}
      </select>
      <input type="number" id="newStaffingHeadcount" min="0" placeholder="Antal personer" />
      <button id="btnAddStaffing">Spara bemanning</button>
    </div>`;
}

async function onAddStaffing() {
  const contractor = (document.getElementById("newStaffingContractor").value || "").trim();
  const week_start = document.getElementById("newStaffingWeek").value;
  const headcount = Number(document.getElementById("newStaffingHeadcount").value);
  if (!contractor || !week_start || !Number.isFinite(headcount) || headcount < 0) return;
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_staffing?on_conflict=project_id,contractor,week_start`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify({ project_id: projectId, contractor, week_start, headcount })
    });
    if (res.ok) {
      await fetchStaffing();
      renderStaffing();
    }
  } catch (e) {
    console.error("Kunde inte spara bemanning", e);
  }
}

/* ---------------------------------------------------------------------
   Leveransplan – lista sorterad på planerat datum, med statusmärke.
   ------------------------------------------------------------------- */
function renderDeliveries() {
  const el = document.getElementById("deliveriesList");

  if (!isSupabaseConfigured()) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const sorted = [...deliveries].sort((a, b) => (a.planned_date || "").localeCompare(b.planned_date || ""));

  const rows = sorted.length === 0
    ? `<div class="hint">Inga leveranser inplanerade ännu.</div>`
    : sorted.map(d => {
        const meta = [d.supplier, d.contractor, d.area].filter(Boolean).join(" · ");
        const status = d.status || "planerad";
        const color = DELIVERY_STATUS_COLORS[status] || "#6b7280";
        return `
          <div class="delivery-row">
            <span class="delivery-desc" title="${escapeHtml(d.description || "")}">${escapeHtml(d.description || "")}</span>
            <span class="delivery-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</span>
            <span class="delivery-date">${formatDateSv(d.planned_date)}</span>
            <span class="badge" style="background:${color}">${escapeHtml(status)}</span>
          </div>`;
      }).join("");

  el.innerHTML = rows + deliveriesFormHtml();
  document.getElementById("btnAddDelivery").onclick = onAddDelivery;
}

function deliveriesFormHtml() {
  const contractors = uniqueValues(it => it.contractor);
  return `
    <div class="add-form">
      <input type="text" id="newDeliveryDesc" placeholder="Beskrivning" />
      <input type="text" id="newDeliverySupplier" placeholder="Leverantör" />
      <input type="text" id="newDeliveryContractor" placeholder="Entreprenör" list="deliveryContractorList" />
      <datalist id="deliveryContractorList">${contractors.map(c => `<option value="${escapeHtml(c)}"></option>`).join("")}</datalist>
      <input type="text" id="newDeliveryArea" placeholder="Område" />
      <input type="date" id="newDeliveryDate" />
      <select id="newDeliveryStatus">
        ${DELIVERY_STATUS_OPTIONS.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
      </select>
      <button id="btnAddDelivery">+ Lägg till leverans</button>
    </div>`;
}

async function onAddDelivery() {
  const description = document.getElementById("newDeliveryDesc").value.trim();
  const supplier = document.getElementById("newDeliverySupplier").value.trim();
  const contractor = document.getElementById("newDeliveryContractor").value.trim();
  const area = document.getElementById("newDeliveryArea").value.trim();
  const planned_date = document.getElementById("newDeliveryDate").value;
  const status = document.getElementById("newDeliveryStatus").value;
  if (!description || !planned_date) return;
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_deliveries`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        project_id: projectId,
        description,
        supplier: supplier || null,
        contractor: contractor || null,
        area: area || null,
        planned_date,
        status
      })
    });
    if (res.ok) {
      await fetchDeliveries();
      renderDeliveries();
    }
  } catch (e) {
    console.error("Kunde inte lägga till leverans", e);
  }
}

/* ---------------------------------------------------------------------
   Säkerhet – logg över tillbud/olyckor/skyddsronder/riskobservationer,
   nyast först.
   ------------------------------------------------------------------- */
function renderSafety() {
  const el = document.getElementById("safetyFeed");

  if (!isSupabaseConfigured()) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const sorted = [...safetyEvents].sort((a, b) => {
    const byDate = (b.event_date || "").localeCompare(a.event_date || "");
    if (byDate !== 0) return byDate;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });

  const rows = sorted.length === 0
    ? `<div class="hint">Inga säkerhetshändelser loggade ännu.</div>`
    : sorted.map(s => {
        const meta = [s.area, s.contractor].filter(Boolean).join(" · ");
        const sevBadge = s.severity
          ? `<span class="badge" style="background:${SEVERITY_COLORS[s.severity] || "#6b7280"}">${escapeHtml(s.severity)}</span>`
          : "";
        return `
          <div class="safety-row">
            <div class="safety-head">
              <span class="badge">${escapeHtml(s.event_type || "")}</span>
              ${sevBadge}
              <span class="safety-date">${formatDateSv(s.event_date)}</span>
            </div>
            ${s.description ? `<div class="safety-desc">${escapeHtml(s.description)}</div>` : ""}
            ${meta ? `<div class="safety-meta">${escapeHtml(meta)}${s.reported_by ? ` · ${escapeHtml(s.reported_by)}` : ""}</div>` : (s.reported_by ? `<div class="safety-meta">${escapeHtml(s.reported_by)}</div>` : "")}
          </div>`;
      }).join("");

  el.innerHTML = rows + safetyFormHtml();
  document.getElementById("btnAddSafety").onclick = onAddSafety;
}

function safetyFormHtml() {
  return `
    <div class="add-form">
      <select id="newSafetyType">
        ${SAFETY_EVENT_TYPES.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
      </select>
      <select id="newSafetySeverity">
        <option value="">Allvarlighetsgrad (valfritt)</option>
        ${SAFETY_SEVERITIES.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
      </select>
      <input type="text" id="newSafetyDesc" placeholder="Beskrivning" />
      <input type="text" id="newSafetyArea" placeholder="Område" />
      <input type="text" id="newSafetyContractor" placeholder="Entreprenör" />
      <input type="date" id="newSafetyDate" value="${todayISO()}" />
      <input type="text" id="newSafetyReportedBy" placeholder="Rapporterad av" />
      <button id="btnAddSafety">+ Logga händelse</button>
    </div>`;
}

async function onAddSafety() {
  const event_type = document.getElementById("newSafetyType").value;
  const severity = document.getElementById("newSafetySeverity").value;
  const description = document.getElementById("newSafetyDesc").value.trim();
  const area = document.getElementById("newSafetyArea").value.trim();
  const contractor = document.getElementById("newSafetyContractor").value.trim();
  const event_date = document.getElementById("newSafetyDate").value || todayISO();
  const reported_by = document.getElementById("newSafetyReportedBy").value.trim();
  if (!event_type) return;
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_safety_events`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        project_id: projectId,
        event_type,
        severity: severity || null,
        description: description || null,
        area: area || null,
        contractor: contractor || null,
        event_date,
        reported_by: reported_by || null
      })
    });
    if (res.ok) {
      await fetchSafetyEvents();
      renderSafety();
    }
  } catch (e) {
    console.error("Kunde inte logga säkerhetshändelse", e);
  }
}

/* ---------------------------------------------------------------------
   Kvalitet / besiktningar – logg, nyast först, kan valfritt kopplas till
   ett specifikt objekt.
   ------------------------------------------------------------------- */
function renderInspections() {
  const el = document.getElementById("inspectionsList");

  if (!isSupabaseConfigured()) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const itemById = new Map(items.map(it => [it.id, it]));
  const sorted = [...inspections].sort((a, b) => (b.inspected_at || "").localeCompare(a.inspected_at || ""));

  const rows = sorted.length === 0
    ? `<div class="hint">Inga besiktningar loggade ännu.</div>`
    : sorted.map(i => {
        const resultBadge = i.result
          ? `<span class="badge" style="background:${INSPECTION_RESULT_COLORS[i.result] || "#6b7280"}">${escapeHtml(i.result)}</span>`
          : "";
        const linked = i.plan_item_id && itemById.has(i.plan_item_id) ? itemLabel(itemById.get(i.plan_item_id)) : "";
        return `
          <div class="inspection-row">
            <div class="inspection-head">
              <span class="badge">${escapeHtml(i.inspection_type || "")}</span>
              ${resultBadge}
              <span class="inspection-date">${formatDateSv(i.inspected_at)}</span>
            </div>
            ${linked ? `<div class="inspection-item" title="${escapeHtml(linked)}">${escapeHtml(linked)}</div>` : ""}
            ${i.comment ? `<div class="inspection-comment">${escapeHtml(i.comment)}</div>` : ""}
            ${i.inspected_by ? `<div class="inspection-meta">${escapeHtml(i.inspected_by)}</div>` : ""}
          </div>`;
      }).join("");

  el.innerHTML = rows + inspectionsFormHtml();
  document.getElementById("btnAddInspection").onclick = onAddInspection;
}

function inspectionsFormHtml() {
  const filtered = getFilteredItems();
  return `
    <div class="add-form">
      <select id="newInspectionType">
        ${INSPECTION_TYPES.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
      </select>
      <select id="newInspectionResult">
        <option value="">Resultat (valfritt)</option>
        ${INSPECTION_RESULTS.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("")}
      </select>
      <input type="text" id="newInspectionComment" placeholder="Kommentar" />
      <input type="text" id="newInspectionBy" placeholder="Besiktigad av" />
      <input type="date" id="newInspectionDate" value="${todayISO()}" />
      <select id="newInspectionItem">
        <option value="">Inget objekt</option>
        ${filtered.map(it => `<option value="${it.id}">${escapeHtml(itemLabel(it))}</option>`).join("")}
      </select>
      <button id="btnAddInspection">+ Logga besiktning</button>
    </div>`;
}

async function onAddInspection() {
  const inspection_type = document.getElementById("newInspectionType").value;
  const result = document.getElementById("newInspectionResult").value;
  const comment = document.getElementById("newInspectionComment").value.trim();
  const inspected_by = document.getElementById("newInspectionBy").value.trim();
  const inspected_at = document.getElementById("newInspectionDate").value || todayISO();
  const plan_item_id = document.getElementById("newInspectionItem").value;
  if (!inspection_type) return;
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_inspections`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        project_id: projectId,
        plan_item_id: plan_item_id ? Number(plan_item_id) : null,
        inspection_type,
        result: result || null,
        comment: comment || null,
        inspected_by: inspected_by || null,
        inspected_at
      })
    });
    if (res.ok) {
      await fetchInspections();
      renderInspections();
    }
  } catch (e) {
    console.error("Kunde inte logga besiktning", e);
  }
}

/* ---------------------------------------------------------------------
   Väder – aktuellt väder + kort prognos från Open-Meteo, baserat på
   koordinater från inställningarna. Ingen databaskoppling.
   ------------------------------------------------------------------- */
function renderWeather() {
  const el = document.getElementById("weatherPanel");

  if (!isWeatherConfigured()) {
    el.innerHTML = `<div class="hint">Ange koordinater i inställningarna (kugghjulet) för att visa väder.</div>`;
    return;
  }
  if (!weather || !weather.current) {
    el.innerHTML = `<div class="hint">Kunde inte hämta väderdata just nu.</div>`;
    return;
  }

  const c = weather.current;
  const daily = weather.daily;

  const currentHtml = `
    <div class="weather-current">
      <div class="weather-temp">${Math.round(c.temperature_2m)}°C</div>
      <div class="weather-desc">${escapeHtml(weatherDescription(c.weather_code))}</div>
      <div class="weather-meta">Vind ${Math.round(c.wind_speed_10m)} m/s · Nederbörd ${c.precipitation ?? 0} mm</div>
    </div>`;

  let forecastHtml = "";
  if (daily && Array.isArray(daily.time)) {
    forecastHtml = `<div class="weather-forecast">` + daily.time.map((t, i) => {
      const d = parseDate(t);
      const dayName = d ? d.toLocaleDateString("sv-SE", { weekday: "short", timeZone: "UTC" }) : "";
      return `
        <div class="weather-day">
          <div class="weather-day-name">${escapeHtml(dayName)}</div>
          <div class="weather-day-desc">${escapeHtml(weatherDescription(daily.weather_code[i]))}</div>
          <div class="weather-day-temp">${Math.round(daily.temperature_2m_max[i])}° / ${Math.round(daily.temperature_2m_min[i])}°</div>
          <div class="weather-day-precip">${daily.precipitation_sum[i] ?? 0} mm</div>
        </div>`;
    }).join("") + `</div>`;
  }

  el.innerHTML = currentHtml + forecastHtml;
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
