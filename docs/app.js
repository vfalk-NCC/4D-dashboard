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
// "Kommande veckor"-panelen (4-veckors lookahead).
const LOOKAHEAD_WEEKS = 4;

// Max antal objektnamn som visas per kategori i en lookahead-veckas kort
// innan resten döljs bakom "+ N till".
const LOOKAHEAD_LIST_MAX = 6;

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

/* ---------------------------------------------------------------------
   Nya tabeller (Hinder + Leveransplan handlingar, migration_5)
   ------------------------------------------------------------------- */
const BLOCKERS_FETCH_LIMIT = 2000;
const BLOCKER_COMMENTS_FETCH_LIMIT = 2000;
const DOCUMENT_DELIVERIES_FETCH_LIMIT = 2000;

let progressHistory = []; // plan_item_progress_history, ofiltrerat på item-filter
let milestones = [];      // plan_milestones
let staffing = [];        // plan_staffing
let deliveries = [];      // plan_deliveries
let documentDeliveries = []; // plan_document_deliveries
let safetyEvents = [];    // plan_safety_events
let inspections = [];     // plan_inspections
let blockers = [];        // plan_blockers
let blockerComments = []; // plan_blocker_comments (alla hinders kommentarer, ofiltrerat)
let expandedBlockerId = null; // Vilket hinder som just nu har sin kommentarstråd öppen
let weather = null;       // Senaste svar från Open-Meteo (eller null)
let weatherError = null;  // Läsbar felorsak om väderhämtningen misslyckas

// Håller reda på om en rad just nu redigeras inline (id, eller null om
// inget redigeras) – ett fält per panel som stödjer redigering.
let editingState = {
  milestone: null,
  staffing: null,
  delivery: null,
  documentDelivery: null,
  safety: null,
  inspection: null,
  blocker: null
};

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

// Påverkan på produktion – fritextfält på Hinder, men med förslag precis
// som säkerhets-/besiktningstyperna (se categoryOptions nedan).
const BLOCKER_IMPACT_SUGGESTIONS = ["Ingen påverkan", "Mindre försening", "Stopp i aktivitet", "Stopp i flera aktiviteter"];

// Namnet ovan (SAFETY_EVENT_TYPES/INSPECTION_TYPES) är bara förslag i en
// datalist – fältet är fritext i både databasen och UI:t, så vem som helst
// kan skriva in en egen kategori som sedan också dyker upp som förslag
// nästa gång (se categoryOptions nedan).
function categoryOptions(fixedList, dataList, keyFn) {
  const set = new Set(fixedList);
  dataList.forEach(item => {
    const v = keyFn(item);
    if (v) set.add(v);
  });
  return [...set];
}

// Supabase Storage-bucket för bilagor (PDF/bilder) på säkerhetshändelser
// och besiktningar. Skapas + policys sätts av migration_4_attachments.sql.
const ATTACHMENTS_BUCKET = "dashboard-attachments";

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
  document.getElementById("btnExportExcel").onclick = onExportExcel;
  document.getElementById("btnExportPdf").onclick = onExportPdf;

  initPanelCollapse();

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
   Minimera/expandera block – varje panel får en liten "−"/"+"-knapp i
   sin rubrik, plus en global knapp i headern som minimerar/expanderar
   alla block på en gång. Läget sparas per panel i localStorage så att
   det inte nollställs vid nästa uppdatering/inläsning.
   ------------------------------------------------------------------- */
const PANEL_COLLAPSE_KEY = "4ddash-collapsed";

function loadCollapsedPanels() {
  try {
    const raw = window.localStorage.getItem(PANEL_COLLAPSE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) {
    return new Set();
  }
}

function saveCollapsedPanels(set) {
  try {
    window.localStorage.setItem(PANEL_COLLAPSE_KEY, JSON.stringify([...set]));
  } catch (e) { /* ignorera */ }
}

function initPanelCollapse() {
  const collapsed = loadCollapsedPanels();
  const panels = document.querySelectorAll(".panel[data-panel-id]");

  panels.forEach(panel => {
    const id = panel.dataset.panelId;
    const h2 = panel.querySelector("h2");
    if (!h2) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "panel-collapse-btn";
    btn.title = "Minimera/expandera det här blocket";
    h2.appendChild(btn);

    const apply = () => {
      const isCollapsed = collapsed.has(id);
      panel.classList.toggle("collapsed", isCollapsed);
      btn.textContent = isCollapsed ? "+" : "−";
    };
    apply();

    btn.onclick = () => {
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      saveCollapsedPanels(collapsed);
      apply();
      updateCollapseAllLabel();
    };
  });

  document.getElementById("btnCollapseAll").onclick = () => {
    const panelIds = [...panels].map(p => p.dataset.panelId);
    const allCollapsed = panelIds.every(id => collapsed.has(id));
    panelIds.forEach(id => {
      if (allCollapsed) collapsed.delete(id); else collapsed.add(id);
    });
    saveCollapsedPanels(collapsed);
    panels.forEach(panel => {
      const isCollapsed = collapsed.has(panel.dataset.panelId);
      panel.classList.toggle("collapsed", isCollapsed);
      const btn = panel.querySelector(".panel-collapse-btn");
      if (btn) btn.textContent = isCollapsed ? "+" : "−";
    });
    updateCollapseAllLabel();
  };

  function updateCollapseAllLabel() {
    const btnAll = document.getElementById("btnCollapseAll");
    const panelIds = [...panels].map(p => p.dataset.panelId);
    const allCollapsed = panelIds.length > 0 && panelIds.every(id => collapsed.has(id));
    btnAll.title = allCollapsed ? "Expandera alla block" : "Minimera alla block";
    btnAll.textContent = allCollapsed ? "⊞" : "⊟";
  }
  updateCollapseAllLabel();
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
  // Normalisera ev. gammalt sparat decimalkomma (se normalizeCoord).
  settings.latitude = normalizeCoord(settings.latitude);
  settings.longitude = normalizeCoord(settings.longitude);
}

function onSaveSettings() {
  settings.supabaseUrl = document.getElementById("supabaseUrl").value.trim().replace(/\/$/, "");
  settings.supabaseKey = document.getElementById("supabaseKey").value.trim();
  // Normalisera decimalkomma till punkt direkt vid sparande – annars
  // tolkas t.ex. "63,82" som ogiltigt tal (Number("63,82") === NaN) och
  // väderpanelen visar bara "ange koordinater", även om användaren har
  // fyllt i fälten. Skriv tillbaka det normaliserade värdet i fälten så
  // att det syns vad som faktiskt sparades.
  const latRaw = document.getElementById("settingsLatitude").value.trim();
  const lonRaw = document.getElementById("settingsLongitude").value.trim();
  settings.latitude = normalizeCoord(latRaw);
  settings.longitude = normalizeCoord(lonRaw);
  document.getElementById("settingsLatitude").value = settings.latitude;
  document.getElementById("settingsLongitude").value = settings.longitude;
  window.localStorage.setItem("4ddash-settings", JSON.stringify(settings));
  updateConnectionWarning();
  toggle("settingsDialog", false);
  refreshAll();
}

// Byter ut ett svenskt decimalkomma mot punkt och trimmar whitespace,
// utan att på annat sätt ändra värdet (så "63,82" blir "63.82" men
// "63.82" lämnas orörd).
function normalizeCoord(value) {
  return String(value || "").trim().replace(",", ".");
}

function isSupabaseConfigured() {
  return Boolean(settings.supabaseUrl && settings.supabaseKey);
}

// Väder kräver bara koordinater (ingen Supabase-koppling). Tolererar
// svenskt decimalkomma (se normalizeCoord) och validerar att värdena
// faktiskt ligger inom giltigt lat/long-intervall.
function parsedCoords() {
  const lat = Number(normalizeCoord(settings.latitude));
  const lon = Number(normalizeCoord(settings.longitude));
  return { lat, lon };
}

function isWeatherConfigured() {
  if (settings.latitude === "" || settings.longitude === "" ||
      settings.latitude === undefined || settings.longitude === undefined) return false;
  const { lat, lon } = parsedCoords();
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
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
    fetchDocumentDeliveries(),
    fetchSafetyEvents(),
    fetchInspections(),
    fetchBlockers(),
    fetchBlockerComments(),
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
  renderDocumentDeliveries();
  renderSafety();
  renderInspections();
  renderBlockers();
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
  weatherError = null;
  if (!isWeatherConfigured()) return;
  const { lat, lon } = parsedCoords();
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,precipitation,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=4`;
    const res = await fetch(url);
    if (res.ok) {
      weather = await res.json();
    } else {
      let detail = "";
      try { detail = (await res.json()).reason || ""; } catch (_) { /* ignorera */ }
      weatherError = `Open-Meteo svarade ${res.status}${detail ? ": " + detail : ""}.`;
      weather = null;
    }
  } catch (e) {
    console.error("Kunde inte hämta väderdata", e);
    weatherError = "Nätverksfel vid hämtning av väderdata (kontrollera internetuppkopplingen).";
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
   Kommande veckor (4-veckors lookahead) – "Denna vecka" + 3 kommande
   veckor, med objektnamn (inte bara antal) uppdelat på: aktiva objekt,
   planerade starter, klara aktiviteter, försenade aktiviteter och
   aktiviteter med ett öppet hinder (korsreferens mot Hinder-panelen).
   ------------------------------------------------------------------- */
function itemHasOpenBlocker(it) {
  return blockers.some(b => !b.is_resolved && (
    Number(b.plan_item_id) === it.id ||
    (Array.isArray(b.affected_item_ids) && b.affected_item_ids.map(Number).includes(it.id))
  ));
}

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
      active: [], starting: [], done: [], delayed: [], blocked: []
    });
  }

  list.forEach(it => {
    const sd = parseDate(it.startDate);
    const ed = parseDate(it.endDate);
    weeks.forEach(w => {
      const activeThisWeek = sd && ed && sd <= w.end && ed >= w.start;
      const startingThisWeek = sd && sd >= w.start && sd <= w.end;
      const dueThisWeek = ed && ed >= w.start && ed <= w.end;

      if (activeThisWeek || startingThisWeek || dueThisWeek) w.active.push(it);
      if (startingThisWeek) w.starting.push(it);
      if (dueThisWeek && it.status === "klar") w.done.push(it);
      if (dueThisWeek && it.status === "forsenad") w.delayed.push(it);
      if ((activeThisWeek || startingThisWeek || dueThisWeek) && itemHasOpenBlocker(it)) w.blocked.push(it);
    });
  });

  return weeks;
}

function lookaheadCategoryHtml(label, list, extraClass) {
  const names = [...new Set(list.map(itemLabel))];
  return `
    <div class="lookahead-category${extraClass ? " " + extraClass : ""}">
      <div class="lookahead-category-head">
        <span class="lookahead-category-label">${escapeHtml(label)}</span>
        <span class="lookahead-category-count">${names.length}</span>
      </div>
      ${names.length === 0
        ? `<div class="lookahead-empty">–</div>`
        : `<ul class="lookahead-item-list">
            ${names.slice(0, LOOKAHEAD_LIST_MAX).map(n => `<li title="${escapeHtml(n)}">${escapeHtml(n)}</li>`).join("")}
            ${names.length > LOOKAHEAD_LIST_MAX ? `<li class="lookahead-more">+ ${names.length - LOOKAHEAD_LIST_MAX} till</li>` : ""}
          </ul>`}
    </div>`;
}

function renderLookahead(list) {
  const el = document.getElementById("lookaheadChart");

  if (list.length === 0) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const weeks = computeLookahead(list);

  el.innerHTML = weeks.map(w => `
    <div class="lookahead-week-card">
      <div class="lookahead-week-title">${escapeHtml(w.label)}</div>
      <div class="lookahead-categories">
        ${lookaheadCategoryHtml("Aktiviteter denna period", w.active)}
        ${lookaheadCategoryHtml("Planerade starter", w.starting)}
        ${lookaheadCategoryHtml("Klara aktiviteter", w.done)}
        ${lookaheadCategoryHtml("Försenade aktiviteter", w.delayed, w.delayed.length ? "has-issues" : "")}
        ${lookaheadCategoryHtml("Aktiviteter med hinder", w.blocked, w.blocked.length ? "has-issues" : "")}
      </div>
    </div>`).join("");
}

/* ---------------------------------------------------------------------
   Generella CRUD-hjälpfunktioner mot Supabase (används av Milstolpar,
   Bemanning, Leveransplan, Säkerhet och Kvalitet/besiktningar nedan) –
   samlar ihop headers/felhantering på ett ställe istället för att
   upprepa dem i varje sektion.
   ------------------------------------------------------------------- */
function supaHeaders(extra) {
  return {
    apikey: settings.supabaseKey,
    Authorization: `Bearer ${settings.supabaseKey}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function supaInsert(table, body) {
  try {
    const res = await fetch(`${settings.supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: supaHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      alert(`Kunde inte spara (${res.status}). Kontrollera att alla obligatoriska fält är ifyllda.`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`Kunde inte lägga till i ${table}`, e);
    alert("Kunde inte spara – nätverksfel. Försök igen.");
    return false;
  }
}

async function supaUpdate(table, id, body) {
  try {
    const res = await fetch(`${settings.supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: supaHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      alert(`Kunde inte spara ändringen (${res.status}).`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`Kunde inte uppdatera i ${table}`, e);
    alert("Kunde inte spara ändringen – nätverksfel. Försök igen.");
    return false;
  }
}

async function supaDelete(table, id, confirmMsg) {
  if (!window.confirm(confirmMsg || "Ta bort den här raden?")) return false;
  try {
    const res = await fetch(`${settings.supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: supaHeaders({ Prefer: "return=minimal" })
    });
    if (!res.ok) {
      alert(`Kunde inte ta bort raden (${res.status}).`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`Kunde inte ta bort från ${table}`, e);
    alert("Kunde inte ta bort raden – nätverksfel. Försök igen.");
    return false;
  }
}

// Rå SVG-ikoner för redigera/ta bort, återanvänds i varje panel som
// stödjer det. currentColor gör att de ärver textfärgen (funkar i
// både ljust och eventuellt mörkt tema).
const ICON_EDIT = `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M13.5 3.5l3 3L7 16l-3.5 1 1-3.5 9-9z"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6M6 6l.6 10.2A1.5 1.5 0 0 0 8.1 17.6h3.8a1.5 1.5 0 0 0 1.5-1.4L14 6"/></svg>`;
const ICON_SAVE = `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10.5l3.5 3.5L16 5"/></svg>`;
const ICON_CANCEL = `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 5l10 10M15 5L5 15"/></svg>`;
const ICON_ATTACHMENT = `<svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14.5 7.5l-6 6a2.5 2.5 0 0 1-3.5-3.5l6.5-6.5a1.7 1.7 0 0 1 2.4 2.4L7.4 12.4a.9.9 0 0 1-1.3-1.3l5.6-5.6"/></svg>`;

function rowActionsHtml(type, id) {
  return `
    <span class="row-actions">
      <button type="button" class="icon-btn row-edit-btn" data-type="${type}" data-id="${id}" title="Redigera">${ICON_EDIT}</button>
      <button type="button" class="icon-btn row-delete-btn" data-type="${type}" data-id="${id}" title="Ta bort">${ICON_TRASH}</button>
    </span>`;
}

/* ---------------------------------------------------------------------
   Bilagor (PDF/bilder) på Säkerhet och Kvalitet/besiktningar – laddas
   upp direkt till Supabase Storage (bucket ATTACHMENTS_BUCKET) via
   REST-API:t, på samma sätt som tabelldata skrivs via PostgREST ovan.
   ------------------------------------------------------------------- */
function isImageAttachment(name) {
  return /\.(png|jpe?g|gif|webp|heic|bmp)$/i.test(name || "");
}

function attachmentPathFromUrl(url) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${ATTACHMENTS_BUCKET}/`;
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

async function uploadAttachment(file, folder) {
  if (!file) return null;
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${folder}/${Date.now()}_${safeName}`;
  try {
    const res = await fetch(`${settings.supabaseUrl}/storage/v1/object/${ATTACHMENTS_BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        "Content-Type": file.type || "application/octet-stream"
      },
      body: file
    });
    if (!res.ok) {
      alert(`Kunde inte ladda upp filen (${res.status}). Kontrollera att bucketen "${ATTACHMENTS_BUCKET}" finns (se migration_4_attachments.sql).`);
      return null;
    }
    return {
      url: `${settings.supabaseUrl}/storage/v1/object/public/${ATTACHMENTS_BUCKET}/${path}`,
      name: file.name
    };
  } catch (e) {
    console.error("Kunde inte ladda upp bilaga", e);
    alert("Kunde inte ladda upp filen – nätverksfel. Försök igen.");
    return null;
  }
}

async function deleteAttachmentBestEffort(url) {
  const path = attachmentPathFromUrl(url);
  if (!path) return;
  try {
    await fetch(`${settings.supabaseUrl}/storage/v1/object/${ATTACHMENTS_BUCKET}/${path}`, {
      method: "DELETE",
      headers: supaHeaders()
    });
  } catch (e) {
    console.warn("Kunde inte ta bort bilagan (ignoreras)", e);
  }
}

function renderAttachment(url, name) {
  if (!url) return "";
  if (isImageAttachment(name || url)) {
    return `<a class="attachment attachment-image" href="${escapeHtml(url)}" target="_blank" rel="noopener">
      <img src="${escapeHtml(url)}" alt="${escapeHtml(name || "Bilaga")}" />
    </a>`;
  }
  return `<a class="attachment attachment-file" href="${escapeHtml(url)}" target="_blank" rel="noopener">${ICON_ATTACHMENT}${escapeHtml(name || "Bilaga")}</a>`;
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
        if (editingState.milestone !== null && String(editingState.milestone) === String(m.id)) return milestoneEditRowHtml(m);
        const td = parseDate(m.target_date);
        const overdue = !m.is_done && td && td < today;
        return `
          <div class="milestone-row${overdue ? " overdue" : ""}${m.is_done ? " done" : ""}">
            <div class="milestone-head">
              <input type="checkbox" class="milestone-check" data-milestone-id="${m.id}" ${m.is_done ? "checked" : ""} />
              <span class="milestone-name" title="${escapeHtml(m.name || "")}">${escapeHtml(m.name || "")}</span>
              ${rowActionsHtml("milestone", m.id)}
            </div>
            <span class="milestone-date">${formatDateSv(m.target_date)}</span>
          </div>`;
      }).join("");

  el.innerHTML = rows + milestoneFormHtml();

  el.querySelectorAll(".milestone-check").forEach(cb => {
    cb.onchange = () => onToggleMilestone(cb.dataset.milestoneId, cb.checked);
  });
  document.getElementById("btnAddMilestone").onclick = onAddMilestone;
  bindRowActions(el, "milestone", {
    getItem: id => milestones.find(m => String(m.id) === String(id)),
    render: renderMilestones,
    remove: id => supaDelete("plan_milestones", id, "Ta bort milstolpen?").then(ok => {
      if (ok) { fetchMilestones().then(renderMilestones); }
    })
  });
  if (editingState.milestone !== null) bindMilestoneEditForm(el);
}

function milestoneEditRowHtml(m) {
  return `
    <div class="milestone-row editing add-form" data-editing-id="${m.id}">
      <input type="text" class="edit-name" value="${escapeHtml(m.name || "")}" placeholder="Namn" />
      <input type="date" class="edit-date" value="${escapeHtml(m.target_date || "")}" />
      <span class="row-actions">
        <button type="button" class="icon-btn row-save-btn" title="Spara">${ICON_SAVE}</button>
        <button type="button" class="icon-btn row-cancel-btn" title="Avbryt">${ICON_CANCEL}</button>
      </span>
    </div>`;
}

function bindMilestoneEditForm(el) {
  const row = el.querySelector(`[data-editing-id="${editingState.milestone}"]`);
  if (!row) return;
  row.querySelector(".row-save-btn").onclick = async () => {
    const name = row.querySelector(".edit-name").value.trim();
    const target_date = row.querySelector(".edit-date").value;
    if (!name || !target_date) { alert("Namn och måldatum måste vara ifyllda."); return; }
    const ok = await supaUpdate("plan_milestones", editingState.milestone, { name, target_date });
    if (ok) {
      editingState.milestone = null;
      await fetchMilestones();
      renderMilestones();
    }
  };
  row.querySelector(".row-cancel-btn").onclick = () => {
    editingState.milestone = null;
    renderMilestones();
  };
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
  if (!name || !target_date) {
    alert("Ange både namn och måldatum för milstolpen.");
    return;
  }
  const ok = await supaInsert("plan_milestones", { project_id: projectId, name, target_date });
  if (ok) {
    await fetchMilestones();
    renderMilestones();
  }
}

async function onToggleMilestone(id, checked) {
  const ok = await supaUpdate("plan_milestones", id, { is_done: checked, completed_date: checked ? todayISO() : null });
  if (ok) {
    await fetchMilestones();
    renderMilestones();
  }
}

// Kopplar klick på redigera-/ta bort-knapparna för en panel. `opts.getItem`
// hämtar dataobjektet för en rad-id (används inte här men lämnas öppet
// för framtida bruk), `opts.render` ritar om panelen (t.ex. efter att
// redigeringsläge slagits på), `opts.remove` utför själva borttagningen.
function bindRowActions(el, type, opts) {
  el.querySelectorAll(`.row-edit-btn[data-type="${type}"]`).forEach(btn => {
    btn.onclick = () => {
      editingState[type] = btn.dataset.id;
      opts.render();
    };
  });
  el.querySelectorAll(`.row-delete-btn[data-type="${type}"]`).forEach(btn => {
    btn.onclick = () => opts.remove(btn.dataset.id);
  });
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
  staffing.forEach(s => byKey.set(`${s.contractor}|${s.week_start}`, s));

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
          const rec = byKey.get(`${c}|${iso}`);
          if (!rec) return `<span class="staffing-cell staffing-empty">–</span>`;
          if (editingState.staffing !== null && String(editingState.staffing) === String(rec.id)) {
            return `
              <span class="staffing-cell staffing-cell-editing" data-editing-id="${rec.id}">
                <label class="staffing-edit-field">Planerad
                  <input type="number" min="0" class="edit-planned-headcount" value="${rec.planned_headcount ?? ""}" />
                </label>
                <label class="staffing-edit-field">Faktisk
                  <input type="number" min="0" class="edit-headcount" value="${rec.headcount}" />
                </label>
                <span class="row-actions">
                  <button type="button" class="icon-btn row-save-btn" title="Spara">${ICON_SAVE}</button>
                  <button type="button" class="icon-btn row-cancel-btn" title="Avbryt">${ICON_CANCEL}</button>
                </span>
              </span>`;
          }
          const hasPlanned = rec.planned_headcount !== null && rec.planned_headcount !== undefined;
          const deviation = hasPlanned ? rec.headcount - rec.planned_headcount : null;
          const devClass = deviation === null ? "" : deviation < 0 ? "negative" : deviation > 0 ? "positive" : "neutral";
          const devText = deviation === null ? "–" : (deviation > 0 ? `+${deviation}` : String(deviation));
          return `
            <span class="staffing-cell staffing-cell-filled">
              <span class="staffing-stat"><span class="staffing-stat-label">Planerad</span><span class="staffing-stat-value">${hasPlanned ? rec.planned_headcount : "–"}</span></span>
              <span class="staffing-stat"><span class="staffing-stat-label">Faktisk</span><span class="staffing-stat-value">${rec.headcount}</span></span>
              <span class="staffing-stat staffing-deviation ${devClass}"><span class="staffing-stat-label">Avvikelse</span><span class="staffing-stat-value">${devText}</span></span>
              ${rowActionsHtml("staffing", rec.id)}
            </span>`;
        }).join("")}
      </div>`).join("");
    listHtml = header + rows;
  }

  el.innerHTML = listHtml + staffingFormHtml(contractors, weeks);
  document.getElementById("btnAddStaffing").onclick = onAddStaffing;
  bindRowActions(el, "staffing", {
    render: renderStaffing,
    remove: id => supaDelete("plan_staffing", id, "Ta bort bemanningsposten?").then(ok => {
      if (ok) { fetchStaffing().then(renderStaffing); }
    })
  });
  if (editingState.staffing !== null) bindStaffingEditForm(el);
}

function bindStaffingEditForm(el) {
  const cell = el.querySelector(`[data-editing-id="${editingState.staffing}"]`);
  if (!cell) return;
  cell.querySelector(".row-save-btn").onclick = async () => {
    const headcount = Number(cell.querySelector(".edit-headcount").value);
    const plannedRaw = cell.querySelector(".edit-planned-headcount").value;
    const planned_headcount = plannedRaw === "" ? null : Number(plannedRaw);
    if (!Number.isFinite(headcount) || headcount < 0) { alert("Ange ett giltigt antal personer (0 eller mer)."); return; }
    if (planned_headcount !== null && (!Number.isFinite(planned_headcount) || planned_headcount < 0)) {
      alert("Ange en giltig planerad bemanning (0 eller mer), eller lämna fältet tomt.");
      return;
    }
    const ok = await supaUpdate("plan_staffing", editingState.staffing, { headcount, planned_headcount });
    if (ok) {
      editingState.staffing = null;
      await fetchStaffing();
      renderStaffing();
    }
  };
  cell.querySelector(".row-cancel-btn").onclick = () => {
    editingState.staffing = null;
    renderStaffing();
  };
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
      <input type="number" id="newStaffingPlanned" min="0" placeholder="Planerad bemanning" />
      <input type="number" id="newStaffingHeadcount" min="0" placeholder="Faktisk bemanning (antal personer)" />
      <button id="btnAddStaffing">Spara bemanning</button>
    </div>`;
}

async function onAddStaffing() {
  const contractor = (document.getElementById("newStaffingContractor").value || "").trim();
  const week_start = document.getElementById("newStaffingWeek").value;
  const headcount = Number(document.getElementById("newStaffingHeadcount").value);
  const plannedRaw = document.getElementById("newStaffingPlanned").value;
  const planned_headcount = plannedRaw === "" ? null : Number(plannedRaw);
  if (!contractor || !week_start || !Number.isFinite(headcount) || headcount < 0) {
    alert("Ange entreprenör, vecka och ett giltigt antal personer (0 eller mer).");
    return;
  }
  if (planned_headcount !== null && (!Number.isFinite(planned_headcount) || planned_headcount < 0)) {
    alert("Ange en giltig planerad bemanning (0 eller mer), eller lämna fältet tomt.");
    return;
  }
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
      body: JSON.stringify({ project_id: projectId, contractor, week_start, headcount, planned_headcount })
    });
    if (res.ok) {
      await fetchStaffing();
      renderStaffing();
    } else {
      alert(`Kunde inte spara bemanningen (${res.status}).`);
    }
  } catch (e) {
    console.error("Kunde inte spara bemanning", e);
    alert("Kunde inte spara bemanningen – nätverksfel. Försök igen.");
  }
}

/* ---------------------------------------------------------------------
   Leveransplan + Leveransplan handlingar – båda listorna fungerar
   identiskt (lista sorterad på planerat datum, med statusmärke, samt
   planerat OCH faktiskt leveransdatum), så logiken byggs en gång som en
   fabrik och instansieras för respektive tabell/panel nedan.
   ------------------------------------------------------------------- */
function createDeliveryModule({ table, elId, editKey, getArr, setArr, formPrefix, addBtnId, emptyText }) {
  async function fetchFn() {
    if (!isSupabaseConfigured()) { setArr([]); return; }
    try {
      const url = `${settings.supabaseUrl}/rest/v1/${table}?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=planned_date.asc`;
      const res = await fetch(url, {
        headers: {
          apikey: settings.supabaseKey,
          Authorization: `Bearer ${settings.supabaseKey}`,
          Range: `0-${DELIVERIES_FETCH_LIMIT - 1}`
        }
      });
      setArr(res.ok ? await res.json() : []);
    } catch (e) {
      console.error(`Kunde inte hämta ${table}`, e);
      setArr([]);
    }
  }

  function render() {
    const el = document.getElementById(elId);

    if (!isSupabaseConfigured()) {
      el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
      return;
    }

    const sorted = [...getArr()].sort((a, b) => (a.planned_date || "").localeCompare(b.planned_date || ""));

    const rows = sorted.length === 0
      ? `<div class="hint">${emptyText}</div>`
      : sorted.map(d => {
          if (editingState[editKey] !== null && String(editingState[editKey]) === String(d.id)) return editRowHtml(d);
          const meta = [d.supplier, d.contractor, d.area].filter(Boolean).join(" · ");
          const status = d.status || "planerad";
          const color = DELIVERY_STATUS_COLORS[status] || "#6b7280";
          return `
            <div class="delivery-row">
              <span class="delivery-desc" title="${escapeHtml(d.description || "")}">${escapeHtml(d.description || "")}</span>
              <span class="delivery-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</span>
              <span class="delivery-dates">
                <span class="delivery-date-row"><span class="delivery-date-label">Planerad</span> ${formatDateSv(d.planned_date)}</span>
                <span class="delivery-date-row"><span class="delivery-date-label">Levererad</span> ${d.actual_date ? formatDateSv(d.actual_date) : "–"}</span>
              </span>
              <span class="badge" style="background:${color}">${escapeHtml(status)}</span>
              ${rowActionsHtml(editKey, d.id)}
            </div>`;
        }).join("");

    el.innerHTML = rows + formHtml();
    document.getElementById(addBtnId).onclick = onAdd;
    bindRowActions(el, editKey, {
      render,
      remove: id => supaDelete(table, id, "Ta bort leveransen?").then(ok => {
        if (ok) { fetchFn().then(render); }
      })
    });
    if (editingState[editKey] !== null) bindEditForm(el);
  }

  function editRowHtml(d) {
    const contractors = uniqueValues(it => it.contractor);
    return `
      <div class="delivery-row editing add-form" data-editing-id="${d.id}">
        <input type="text" class="edit-desc" value="${escapeHtml(d.description || "")}" placeholder="Beskrivning" />
        <input type="text" class="edit-supplier" value="${escapeHtml(d.supplier || "")}" placeholder="Leverantör" />
        <input type="text" class="edit-contractor" value="${escapeHtml(d.contractor || "")}" placeholder="Entreprenör" list="${formPrefix}ContractorListEdit" />
        <datalist id="${formPrefix}ContractorListEdit">${contractors.map(c => `<option value="${escapeHtml(c)}"></option>`).join("")}</datalist>
        <input type="text" class="edit-area" value="${escapeHtml(d.area || "")}" placeholder="Område" />
        <label class="inline-field">Planerad <input type="date" class="edit-date" value="${escapeHtml(d.planned_date || "")}" /></label>
        <label class="inline-field">Levererad <input type="date" class="edit-actual-date" value="${escapeHtml(d.actual_date || "")}" /></label>
        <select class="edit-status">
          ${DELIVERY_STATUS_OPTIONS.map(s => `<option value="${escapeHtml(s)}" ${s === (d.status || "planerad") ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
        </select>
        <span class="row-actions">
          <button type="button" class="icon-btn row-save-btn" title="Spara">${ICON_SAVE}</button>
          <button type="button" class="icon-btn row-cancel-btn" title="Avbryt">${ICON_CANCEL}</button>
        </span>
      </div>`;
  }

  function bindEditForm(el) {
    const row = el.querySelector(`[data-editing-id="${editingState[editKey]}"]`);
    if (!row) return;
    row.querySelector(".row-save-btn").onclick = async () => {
      const description = row.querySelector(".edit-desc").value.trim();
      const planned_date = row.querySelector(".edit-date").value;
      if (!description || !planned_date) { alert("Beskrivning och planerat datum måste vara ifyllda."); return; }
      const ok = await supaUpdate(table, editingState[editKey], {
        description,
        supplier: row.querySelector(".edit-supplier").value.trim() || null,
        contractor: row.querySelector(".edit-contractor").value.trim() || null,
        area: row.querySelector(".edit-area").value.trim() || null,
        planned_date,
        actual_date: row.querySelector(".edit-actual-date").value || null,
        status: row.querySelector(".edit-status").value
      });
      if (ok) {
        editingState[editKey] = null;
        await fetchFn();
        render();
      }
    };
    row.querySelector(".row-cancel-btn").onclick = () => {
      editingState[editKey] = null;
      render();
    };
  }

  function formHtml() {
    const contractors = uniqueValues(it => it.contractor);
    return `
      <div class="add-form">
        <input type="text" id="${formPrefix}Desc" placeholder="Beskrivning *" />
        <input type="text" id="${formPrefix}Supplier" placeholder="Leverantör" />
        <input type="text" id="${formPrefix}Contractor" placeholder="Entreprenör" list="${formPrefix}ContractorList" />
        <datalist id="${formPrefix}ContractorList">${contractors.map(c => `<option value="${escapeHtml(c)}"></option>`).join("")}</datalist>
        <input type="text" id="${formPrefix}Area" placeholder="Område" />
        <label class="inline-field">Planerad * <input type="date" id="${formPrefix}Date" title="Planerat datum *" /></label>
        <label class="inline-field">Levererad <input type="date" id="${formPrefix}ActualDate" title="Faktiskt levererad" /></label>
        <select id="${formPrefix}Status">
          ${DELIVERY_STATUS_OPTIONS.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
        </select>
        <button id="${addBtnId}">+ Lägg till leverans</button>
      </div>`;
  }

  async function onAdd() {
    const description = document.getElementById(`${formPrefix}Desc`).value.trim();
    const supplier = document.getElementById(`${formPrefix}Supplier`).value.trim();
    const contractor = document.getElementById(`${formPrefix}Contractor`).value.trim();
    const area = document.getElementById(`${formPrefix}Area`).value.trim();
    const planned_date = document.getElementById(`${formPrefix}Date`).value;
    const actual_date = document.getElementById(`${formPrefix}ActualDate`).value;
    const status = document.getElementById(`${formPrefix}Status`).value;
    if (!description || !planned_date) {
      alert("Ange både beskrivning och planerat datum för leveransen – annars sparas den inte.");
      return;
    }
    const ok = await supaInsert(table, {
      project_id: projectId,
      description,
      supplier: supplier || null,
      contractor: contractor || null,
      area: area || null,
      planned_date,
      actual_date: actual_date || null,
      status
    });
    if (ok) {
      await fetchFn();
      render();
    }
  }

  return { fetch: fetchFn, render };
}

const deliveriesModule = createDeliveryModule({
  table: "plan_deliveries",
  elId: "deliveriesList",
  editKey: "delivery",
  getArr: () => deliveries,
  setArr: v => { deliveries = v; },
  formPrefix: "newDelivery",
  addBtnId: "btnAddDelivery",
  emptyText: "Inga leveranser inplanerade ännu."
});
function fetchDeliveries() { return deliveriesModule.fetch(); }
function renderDeliveries() { return deliveriesModule.render(); }

const documentDeliveriesModule = createDeliveryModule({
  table: "plan_document_deliveries",
  elId: "documentDeliveriesList",
  editKey: "documentDelivery",
  getArr: () => documentDeliveries,
  setArr: v => { documentDeliveries = v; },
  formPrefix: "newDocDelivery",
  addBtnId: "btnAddDocDelivery",
  emptyText: "Inga handlingar (ritningar, bygglov, tekn. beskrivningar) inplanerade ännu."
});
function fetchDocumentDeliveries() { return documentDeliveriesModule.fetch(); }
function renderDocumentDeliveries() { return documentDeliveriesModule.render(); }

/* ---------------------------------------------------------------------
   Hinder (blockers) – varje hinder kan valfritt kopplas till ett
   planerat objekt (var hindret finns) samt till flera påverkade
   aktiviteter (flera val), har en ansvarig, en deadline, en fritext för
   påverkan på produktion, ett löst/olöst-läge och en egen
   kommentarstråd (separat från 4D-planerings vanliga objektskommentarer).
   ------------------------------------------------------------------- */
async function fetchBlockers() {
  if (!isSupabaseConfigured()) { blockers = []; return; }
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_blockers?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=deadline.asc`;
    const res = await fetch(url, {
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        Range: `0-${BLOCKERS_FETCH_LIMIT - 1}`
      }
    });
    blockers = res.ok ? await res.json() : [];
  } catch (e) {
    console.error("Kunde inte hämta hinder", e);
    blockers = [];
  }
}

// plan_blocker_comments har ingen egen project_id-kolumn (kopplas via
// blocker_id), så precis som för plan_item_comments hämtas alla och
// filtreras client-side mot de hinder-id:n som visas just nu.
async function fetchBlockerComments() {
  if (!isSupabaseConfigured()) { blockerComments = []; return; }
  try {
    const url = `${settings.supabaseUrl}/rest/v1/plan_blocker_comments?select=*&order=created_at.asc`;
    const res = await fetch(url, {
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
        Range: `0-${BLOCKER_COMMENTS_FETCH_LIMIT - 1}`
      }
    });
    blockerComments = res.ok ? await res.json() : [];
  } catch (e) {
    console.error("Kunde inte hämta hinderkommentarer", e);
    blockerComments = [];
  }
}

function renderBlockers() {
  const el = document.getElementById("blockersList");

  if (!isSupabaseConfigured()) {
    el.innerHTML = `<div class="hint">${emptyMessage()}</div>`;
    return;
  }

  const itemById = new Map(items.map(it => [it.id, it]));
  const today = todayUTC();

  const sorted = [...blockers].sort((a, b) => {
    if (Boolean(a.is_resolved) !== Boolean(b.is_resolved)) return a.is_resolved ? 1 : -1;
    return (a.deadline || "9999-99-99").localeCompare(b.deadline || "9999-99-99");
  });

  const rows = sorted.length === 0
    ? `<div class="hint">Inga hinder registrerade ännu.</div>`
    : sorted.map(b => {
        if (editingState.blocker !== null && String(editingState.blocker) === String(b.id)) return blockerEditRowHtml(b, itemById);

        const dl = parseDate(b.deadline);
        const overdue = !b.is_resolved && dl && dl < today;
        const linked = b.plan_item_id && itemById.has(Number(b.plan_item_id)) ? itemLabel(itemById.get(Number(b.plan_item_id))) : "";
        const affectedLabels = (Array.isArray(b.affected_item_ids) ? b.affected_item_ids : [])
          .map(id => itemById.get(Number(id)))
          .filter(Boolean)
          .map(itemLabel);
        const comments = blockerComments.filter(c => String(c.blocker_id) === String(b.id));
        const expanded = expandedBlockerId !== null && String(expandedBlockerId) === String(b.id);

        return `
          <div class="blocker-row${b.is_resolved ? " resolved" : ""}${overdue ? " overdue" : ""}">
            <div class="blocker-head">
              <span class="badge" style="background:${b.is_resolved ? "#3fb950" : "#e5484d"}">${b.is_resolved ? "Löst" : "Öppet"}</span>
              ${b.deadline ? `<span class="blocker-deadline">Deadline: ${formatDateSv(b.deadline)}</span>` : ""}
              ${rowActionsHtml("blocker", b.id)}
            </div>
            <div class="blocker-desc">${escapeHtml(b.description || "")}</div>
            ${linked ? `<div class="blocker-item" title="${escapeHtml(linked)}">Objekt: ${escapeHtml(linked)}</div>` : ""}
            ${affectedLabels.length ? `<div class="blocker-affected" title="${escapeHtml(affectedLabels.join(", "))}">Påverkar: ${escapeHtml(affectedLabels.join(", "))}</div>` : ""}
            ${b.responsible ? `<div class="blocker-meta">Ansvarig: ${escapeHtml(b.responsible)}</div>` : ""}
            ${b.production_impact ? `<div class="blocker-meta">Påverkan på produktion: ${escapeHtml(b.production_impact)}</div>` : ""}
            <div class="blocker-actions-row">
              <label class="blocker-resolve-label">
                <input type="checkbox" class="blocker-resolve-check" data-blocker-id="${b.id}" ${b.is_resolved ? "checked" : ""} /> Löst
              </label>
              <button type="button" class="blocker-comments-toggle" data-blocker-id="${b.id}">Kommentarer (${comments.length})</button>
            </div>
            ${expanded ? blockerCommentsHtml(b, comments) : ""}
          </div>`;
      }).join("");

  el.innerHTML = rows + blockerFormHtml();

  document.getElementById("btnAddBlocker").onclick = onAddBlocker;
  bindRowActions(el, "blocker", {
    render: renderBlockers,
    remove: id => supaDelete("plan_blockers", id, "Ta bort hindret? (kommentarerna tas också bort)").then(ok => {
      if (ok) { fetchBlockers().then(renderBlockers); }
    })
  });
  el.querySelectorAll(".blocker-resolve-check").forEach(cb => {
    cb.onchange = () => onToggleBlockerResolved(cb.dataset.blockerId, cb.checked);
  });
  el.querySelectorAll(".blocker-comments-toggle").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.blockerId;
      expandedBlockerId = (expandedBlockerId !== null && String(expandedBlockerId) === String(id)) ? null : id;
      renderBlockers();
    };
  });
  el.querySelectorAll(".blocker-comment-add-btn").forEach(btn => {
    btn.onclick = () => onAddBlockerComment(btn.dataset.blockerId);
  });
  if (editingState.blocker !== null) bindBlockerEditForm(el);
}

function blockerCommentsHtml(b, comments) {
  const sorted = [...comments].sort((a, c) => (a.created_at || "").localeCompare(c.created_at || ""));
  return `
    <div class="blocker-comments">
      ${sorted.length === 0
        ? `<div class="hint">Inga kommentarer ännu.</div>`
        : sorted.map(c => `
          <div class="blocker-comment-row">
            <div class="comment-head">
              <span class="comment-author">${escapeHtml(c.author || "Anonym")}</span>
              <span class="comment-time">${relativeTime(c.created_at)}</span>
            </div>
            <div class="comment-body">${escapeHtml(c.body || "")}</div>
          </div>`).join("")}
      <div class="add-form blocker-comment-form">
        <input type="text" class="blocker-comment-author" data-blocker-id="${b.id}" placeholder="Ditt namn" />
        <input type="text" class="blocker-comment-body" data-blocker-id="${b.id}" placeholder="Skriv en kommentar" />
        <button type="button" class="blocker-comment-add-btn" data-blocker-id="${b.id}">Kommentera</button>
      </div>
    </div>`;
}

async function onAddBlockerComment(blockerId) {
  const authorInput = document.querySelector(`.blocker-comment-author[data-blocker-id="${blockerId}"]`);
  const bodyInput = document.querySelector(`.blocker-comment-body[data-blocker-id="${blockerId}"]`);
  const body = bodyInput.value.trim();
  if (!body) { alert("Skriv en kommentar innan du sparar."); return; }
  const author = authorInput.value.trim();
  const ok = await supaInsert("plan_blocker_comments", { blocker_id: Number(blockerId), body, author: author || null });
  if (ok) {
    await fetchBlockerComments();
    renderBlockers();
  }
}

async function onToggleBlockerResolved(id, checked) {
  const ok = await supaUpdate("plan_blockers", id, { is_resolved: checked, resolved_date: checked ? todayISO() : null });
  if (ok) {
    await fetchBlockers();
    renderBlockers();
  }
}

function blockerEditRowHtml(b, itemById) {
  const filtered = getFilteredItems();
  const linkedOptions = filtered.some(it => it.id === Number(b.plan_item_id)) || !b.plan_item_id
    ? filtered
    : [itemById.get(Number(b.plan_item_id)), ...filtered].filter(Boolean);
  const affectedIds = Array.isArray(b.affected_item_ids) ? b.affected_item_ids.map(Number) : [];
  const affectedOptionsSource = [...filtered];
  affectedIds.forEach(id => {
    if (!affectedOptionsSource.some(it => it.id === id) && itemById.has(id)) affectedOptionsSource.push(itemById.get(id));
  });
  const impactOptions = categoryOptions(BLOCKER_IMPACT_SUGGESTIONS, blockers, x => x.production_impact);

  return `
    <div class="blocker-row editing add-form" data-editing-id="${b.id}">
      <input type="text" class="edit-desc" value="${escapeHtml(b.description || "")}" placeholder="Beskrivning av hindret *" />
      <select class="edit-item">
        <option value="">Inget objekt kopplat</option>
        ${linkedOptions.map(it => `<option value="${it.id}" ${it.id === Number(b.plan_item_id) ? "selected" : ""}>${escapeHtml(itemLabel(it))}</option>`).join("")}
      </select>
      <label class="field-label">Påverkad aktivitet (flera val möjliga)
        <select class="edit-affected" multiple size="4">
          ${affectedOptionsSource.map(it => `<option value="${it.id}" ${affectedIds.includes(it.id) ? "selected" : ""}>${escapeHtml(itemLabel(it))}</option>`).join("")}
        </select>
      </label>
      <input type="text" class="edit-responsible" value="${escapeHtml(b.responsible || "")}" placeholder="Ansvarig" />
      <input type="date" class="edit-deadline" value="${escapeHtml(b.deadline || "")}" />
      <input type="text" class="edit-impact" list="blockerImpactListEdit" value="${escapeHtml(b.production_impact || "")}" placeholder="Påverkan på produktion" />
      <datalist id="blockerImpactListEdit">${impactOptions.map(o => `<option value="${escapeHtml(o)}"></option>`).join("")}</datalist>
      <span class="row-actions">
        <button type="button" class="icon-btn row-save-btn" title="Spara">${ICON_SAVE}</button>
        <button type="button" class="icon-btn row-cancel-btn" title="Avbryt">${ICON_CANCEL}</button>
      </span>
    </div>`;
}

function bindBlockerEditForm(el) {
  const row = el.querySelector(`[data-editing-id="${editingState.blocker}"]`);
  if (!row) return;
  row.querySelector(".row-save-btn").onclick = async () => {
    const description = row.querySelector(".edit-desc").value.trim();
    if (!description) { alert("Ange en beskrivning av hindret."); return; }
    const plan_item_id = row.querySelector(".edit-item").value;
    const affected_item_ids = [...row.querySelector(".edit-affected").selectedOptions].map(o => Number(o.value));
    const ok = await supaUpdate("plan_blockers", editingState.blocker, {
      description,
      plan_item_id: plan_item_id ? Number(plan_item_id) : null,
      affected_item_ids,
      responsible: row.querySelector(".edit-responsible").value.trim() || null,
      deadline: row.querySelector(".edit-deadline").value || null,
      production_impact: row.querySelector(".edit-impact").value.trim() || null
    });
    if (ok) {
      editingState.blocker = null;
      await fetchBlockers();
      renderBlockers();
    }
  };
  row.querySelector(".row-cancel-btn").onclick = () => {
    editingState.blocker = null;
    renderBlockers();
  };
}

function blockerFormHtml() {
  const filtered = getFilteredItems();
  const impactOptions = categoryOptions(BLOCKER_IMPACT_SUGGESTIONS, blockers, b => b.production_impact);
  return `
    <div class="add-form">
      <input type="text" id="newBlockerDesc" placeholder="Beskrivning av hindret *" />
      <select id="newBlockerItem">
        <option value="">Inget objekt kopplat</option>
        ${filtered.map(it => `<option value="${it.id}">${escapeHtml(itemLabel(it))}</option>`).join("")}
      </select>
      <label class="field-label">Påverkad aktivitet (flera val möjliga)
        <select id="newBlockerAffected" multiple size="4">
          ${filtered.map(it => `<option value="${it.id}">${escapeHtml(itemLabel(it))}</option>`).join("")}
        </select>
      </label>
      <input type="text" id="newBlockerResponsible" placeholder="Ansvarig" />
      <input type="date" id="newBlockerDeadline" title="Deadline" />
      <input type="text" id="newBlockerImpact" list="blockerImpactList" placeholder="Påverkan på produktion" />
      <datalist id="blockerImpactList">${impactOptions.map(o => `<option value="${escapeHtml(o)}"></option>`).join("")}</datalist>
      <button id="btnAddBlocker">+ Registrera hinder</button>
    </div>`;
}

async function onAddBlocker() {
  const description = document.getElementById("newBlockerDesc").value.trim();
  if (!description) {
    alert("Ange en beskrivning av hindret.");
    return;
  }
  const plan_item_id = document.getElementById("newBlockerItem").value;
  const affected_item_ids = [...document.getElementById("newBlockerAffected").selectedOptions].map(o => Number(o.value));
  const responsible = document.getElementById("newBlockerResponsible").value.trim();
  const deadline = document.getElementById("newBlockerDeadline").value;
  const production_impact = document.getElementById("newBlockerImpact").value.trim();

  const ok = await supaInsert("plan_blockers", {
    project_id: projectId,
    description,
    plan_item_id: plan_item_id ? Number(plan_item_id) : null,
    affected_item_ids,
    responsible: responsible || null,
    deadline: deadline || null,
    production_impact: production_impact || null,
    is_resolved: false
  });
  if (ok) {
    await fetchBlockers();
    renderBlockers();
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
        if (editingState.safety !== null && String(editingState.safety) === String(s.id)) return safetyEditRowHtml(s);
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
              ${rowActionsHtml("safety", s.id)}
            </div>
            ${s.description ? `<div class="safety-desc">${escapeHtml(s.description)}</div>` : ""}
            ${meta ? `<div class="safety-meta">${escapeHtml(meta)}${s.reported_by ? ` · ${escapeHtml(s.reported_by)}` : ""}</div>` : (s.reported_by ? `<div class="safety-meta">${escapeHtml(s.reported_by)}</div>` : "")}
            ${renderAttachment(s.attachment_url, s.attachment_name)}
          </div>`;
      }).join("");

  el.innerHTML = rows + safetyFormHtml();
  document.getElementById("btnAddSafety").onclick = onAddSafety;
  bindRowActions(el, "safety", {
    render: renderSafety,
    remove: id => {
      const item = safetyEvents.find(s => String(s.id) === String(id));
      return supaDelete("plan_safety_events", id, "Ta bort säkerhetshändelsen?").then(ok => {
        if (ok) {
          if (item && item.attachment_url) deleteAttachmentBestEffort(item.attachment_url);
          fetchSafetyEvents().then(renderSafety);
        }
      });
    }
  });
  if (editingState.safety !== null) bindSafetyEditForm(el);
}

function safetyEditRowHtml(s) {
  return `
    <div class="safety-row editing add-form" data-editing-id="${s.id}">
      <input type="text" class="edit-type" list="safetyTypeList" value="${escapeHtml(s.event_type || "")}" placeholder="Typ av händelse" />
      <select class="edit-severity">
        <option value="">Allvarlighetsgrad (valfritt)</option>
        ${SAFETY_SEVERITIES.map(sv => `<option value="${escapeHtml(sv)}" ${sv === s.severity ? "selected" : ""}>${escapeHtml(sv)}</option>`).join("")}
      </select>
      <input type="text" class="edit-desc" value="${escapeHtml(s.description || "")}" placeholder="Beskrivning" />
      <input type="text" class="edit-area" value="${escapeHtml(s.area || "")}" placeholder="Område" />
      <input type="text" class="edit-contractor" value="${escapeHtml(s.contractor || "")}" placeholder="Entreprenör" />
      <input type="date" class="edit-date" value="${escapeHtml(s.event_date || "")}" />
      <input type="text" class="edit-reported-by" value="${escapeHtml(s.reported_by || "")}" placeholder="Rapporterad av" />
      ${s.attachment_url ? `<span class="current-attachment">${renderAttachment(s.attachment_url, s.attachment_name)}</span>
      <label class="edit-remove-attachment-label"><input type="checkbox" class="edit-remove-attachment" /> Ta bort bilaga</label>` : ""}
      <input type="file" class="edit-file" accept=".pdf,image/*" />
      <span class="row-actions">
        <button type="button" class="icon-btn row-save-btn" title="Spara">${ICON_SAVE}</button>
        <button type="button" class="icon-btn row-cancel-btn" title="Avbryt">${ICON_CANCEL}</button>
      </span>
    </div>`;
}

function bindSafetyEditForm(el) {
  const row = el.querySelector(`[data-editing-id="${editingState.safety}"]`);
  if (!row) return;
  const original = safetyEvents.find(s => String(s.id) === String(editingState.safety));
  row.querySelector(".row-save-btn").onclick = async () => {
    const event_type = row.querySelector(".edit-type").value.trim();
    const event_date = row.querySelector(".edit-date").value;
    if (!event_type || !event_date) { alert("Typ och datum måste vara ifyllda."); return; }

    let attachment_url = original ? original.attachment_url || null : null;
    let attachment_name = original ? original.attachment_name || null : null;
    const fileInput = row.querySelector(".edit-file");
    const removeAttachment = row.querySelector(".edit-remove-attachment");
    if (fileInput && fileInput.files[0]) {
      const uploaded = await uploadAttachment(fileInput.files[0], "safety");
      if (uploaded) {
        if (attachment_url) deleteAttachmentBestEffort(attachment_url);
        attachment_url = uploaded.url;
        attachment_name = uploaded.name;
      }
    } else if (removeAttachment && removeAttachment.checked && attachment_url) {
      deleteAttachmentBestEffort(attachment_url);
      attachment_url = null;
      attachment_name = null;
    }

    const ok = await supaUpdate("plan_safety_events", editingState.safety, {
      event_type,
      severity: row.querySelector(".edit-severity").value || null,
      description: row.querySelector(".edit-desc").value.trim() || null,
      area: row.querySelector(".edit-area").value.trim() || null,
      contractor: row.querySelector(".edit-contractor").value.trim() || null,
      event_date,
      reported_by: row.querySelector(".edit-reported-by").value.trim() || null,
      attachment_url,
      attachment_name
    });
    if (ok) {
      editingState.safety = null;
      await fetchSafetyEvents();
      renderSafety();
    }
  };
  row.querySelector(".row-cancel-btn").onclick = () => {
    editingState.safety = null;
    renderSafety();
  };
}

function safetyFormHtml() {
  const typeOptions = categoryOptions(SAFETY_EVENT_TYPES, safetyEvents, s => s.event_type);
  return `
    <div class="add-form">
      <input type="text" id="newSafetyType" list="safetyTypeList" placeholder="Typ av händelse" />
      <datalist id="safetyTypeList">${typeOptions.map(t => `<option value="${escapeHtml(t)}"></option>`).join("")}</datalist>
      <select id="newSafetySeverity">
        <option value="">Allvarlighetsgrad (valfritt)</option>
        ${SAFETY_SEVERITIES.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
      </select>
      <input type="text" id="newSafetyDesc" placeholder="Beskrivning" />
      <input type="text" id="newSafetyArea" placeholder="Område" />
      <input type="text" id="newSafetyContractor" placeholder="Entreprenör" />
      <input type="date" id="newSafetyDate" value="${todayISO()}" />
      <input type="text" id="newSafetyReportedBy" placeholder="Rapporterad av" />
      <input type="file" id="newSafetyFile" accept=".pdf,image/*" title="Bifoga PDF eller bild (valfritt)" />
      <button id="btnAddSafety">+ Logga händelse</button>
    </div>`;
}

async function onAddSafety() {
  const event_type = document.getElementById("newSafetyType").value.trim();
  const severity = document.getElementById("newSafetySeverity").value;
  const description = document.getElementById("newSafetyDesc").value.trim();
  const area = document.getElementById("newSafetyArea").value.trim();
  const contractor = document.getElementById("newSafetyContractor").value.trim();
  const event_date = document.getElementById("newSafetyDate").value || todayISO();
  const reported_by = document.getElementById("newSafetyReportedBy").value.trim();
  const file = document.getElementById("newSafetyFile").files[0];
  if (!event_type) {
    alert("Ange en typ av händelse.");
    return;
  }
  let attachment_url = null;
  let attachment_name = null;
  if (file) {
    const uploaded = await uploadAttachment(file, "safety");
    if (uploaded) {
      attachment_url = uploaded.url;
      attachment_name = uploaded.name;
    }
  }
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
        reported_by: reported_by || null,
        attachment_url,
        attachment_name
      })
    });
    if (res.ok) {
      await fetchSafetyEvents();
      renderSafety();
    } else {
      alert(`Kunde inte logga händelsen (${res.status}).`);
    }
  } catch (e) {
    console.error("Kunde inte logga säkerhetshändelse", e);
    alert("Kunde inte logga händelsen – nätverksfel. Försök igen.");
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
        if (editingState.inspection !== null && String(editingState.inspection) === String(i.id)) return inspectionEditRowHtml(i, itemById);
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
              ${rowActionsHtml("inspection", i.id)}
            </div>
            ${linked ? `<div class="inspection-item" title="${escapeHtml(linked)}">${escapeHtml(linked)}</div>` : ""}
            ${i.comment ? `<div class="inspection-comment">${escapeHtml(i.comment)}</div>` : ""}
            ${i.inspected_by ? `<div class="inspection-meta">${escapeHtml(i.inspected_by)}</div>` : ""}
            ${renderAttachment(i.attachment_url, i.attachment_name)}
          </div>`;
      }).join("");

  el.innerHTML = rows + inspectionsFormHtml();
  document.getElementById("btnAddInspection").onclick = onAddInspection;
  bindRowActions(el, "inspection", {
    render: renderInspections,
    remove: id => {
      const item = inspections.find(i => String(i.id) === String(id));
      return supaDelete("plan_inspections", id, "Ta bort besiktningen?").then(ok => {
        if (ok) {
          if (item && item.attachment_url) deleteAttachmentBestEffort(item.attachment_url);
          fetchInspections().then(renderInspections);
        }
      });
    }
  });
  if (editingState.inspection !== null) bindInspectionEditForm(el);
}

function inspectionEditRowHtml(i, itemById) {
  const filtered = getFilteredItems();
  const linkedOptions = filtered.some(it => it.id === i.plan_item_id) || !i.plan_item_id
    ? filtered
    : [itemById.get(i.plan_item_id), ...filtered].filter(Boolean);
  return `
    <div class="inspection-row editing add-form" data-editing-id="${i.id}">
      <input type="text" class="edit-type" list="inspectionTypeList" value="${escapeHtml(i.inspection_type || "")}" placeholder="Typ av besiktning" />
      <select class="edit-result">
        <option value="">Resultat (valfritt)</option>
        ${INSPECTION_RESULTS.map(r => `<option value="${escapeHtml(r)}" ${r === i.result ? "selected" : ""}>${escapeHtml(r)}</option>`).join("")}
      </select>
      <input type="text" class="edit-comment" value="${escapeHtml(i.comment || "")}" placeholder="Kommentar" />
      <input type="text" class="edit-by" value="${escapeHtml(i.inspected_by || "")}" placeholder="Besiktigad av" />
      <input type="date" class="edit-date" value="${escapeHtml(i.inspected_at || "")}" />
      <select class="edit-item">
        <option value="">Inget objekt</option>
        ${linkedOptions.map(it => `<option value="${it.id}" ${it.id === i.plan_item_id ? "selected" : ""}>${escapeHtml(itemLabel(it))}</option>`).join("")}
      </select>
      ${i.attachment_url ? `<span class="current-attachment">${renderAttachment(i.attachment_url, i.attachment_name)}</span>
      <label class="edit-remove-attachment-label"><input type="checkbox" class="edit-remove-attachment" /> Ta bort bilaga</label>` : ""}
      <input type="file" class="edit-file" accept=".pdf,image/*" />
      <span class="row-actions">
        <button type="button" class="icon-btn row-save-btn" title="Spara">${ICON_SAVE}</button>
        <button type="button" class="icon-btn row-cancel-btn" title="Avbryt">${ICON_CANCEL}</button>
      </span>
    </div>`;
}

function bindInspectionEditForm(el) {
  const row = el.querySelector(`[data-editing-id="${editingState.inspection}"]`);
  if (!row) return;
  const original = inspections.find(i => String(i.id) === String(editingState.inspection));
  row.querySelector(".row-save-btn").onclick = async () => {
    const inspection_type = row.querySelector(".edit-type").value.trim();
    if (!inspection_type) { alert("Ange en typ av besiktning."); return; }
    const plan_item_id = row.querySelector(".edit-item").value;

    let attachment_url = original ? original.attachment_url || null : null;
    let attachment_name = original ? original.attachment_name || null : null;
    const fileInput = row.querySelector(".edit-file");
    const removeAttachment = row.querySelector(".edit-remove-attachment");
    if (fileInput && fileInput.files[0]) {
      const uploaded = await uploadAttachment(fileInput.files[0], "inspections");
      if (uploaded) {
        if (attachment_url) deleteAttachmentBestEffort(attachment_url);
        attachment_url = uploaded.url;
        attachment_name = uploaded.name;
      }
    } else if (removeAttachment && removeAttachment.checked && attachment_url) {
      deleteAttachmentBestEffort(attachment_url);
      attachment_url = null;
      attachment_name = null;
    }

    const ok = await supaUpdate("plan_inspections", editingState.inspection, {
      inspection_type,
      result: row.querySelector(".edit-result").value || null,
      comment: row.querySelector(".edit-comment").value.trim() || null,
      inspected_by: row.querySelector(".edit-by").value.trim() || null,
      inspected_at: row.querySelector(".edit-date").value || todayISO(),
      plan_item_id: plan_item_id ? Number(plan_item_id) : null,
      attachment_url,
      attachment_name
    });
    if (ok) {
      editingState.inspection = null;
      await fetchInspections();
      renderInspections();
    }
  };
  row.querySelector(".row-cancel-btn").onclick = () => {
    editingState.inspection = null;
    renderInspections();
  };
}

function inspectionsFormHtml() {
  const filtered = getFilteredItems();
  const typeOptions = categoryOptions(INSPECTION_TYPES, inspections, i => i.inspection_type);
  return `
    <div class="add-form">
      <input type="text" id="newInspectionType" list="inspectionTypeList" placeholder="Typ av besiktning" />
      <datalist id="inspectionTypeList">${typeOptions.map(t => `<option value="${escapeHtml(t)}"></option>`).join("")}</datalist>
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
      <input type="file" id="newInspectionFile" accept=".pdf,image/*" title="Bifoga PDF eller bild (valfritt)" />
      <button id="btnAddInspection">+ Logga besiktning</button>
    </div>`;
}

async function onAddInspection() {
  const inspection_type = document.getElementById("newInspectionType").value.trim();
  const result = document.getElementById("newInspectionResult").value;
  const comment = document.getElementById("newInspectionComment").value.trim();
  const inspected_by = document.getElementById("newInspectionBy").value.trim();
  const inspected_at = document.getElementById("newInspectionDate").value || todayISO();
  const plan_item_id = document.getElementById("newInspectionItem").value;
  const file = document.getElementById("newInspectionFile").files[0];
  if (!inspection_type) {
    alert("Ange en typ av besiktning.");
    return;
  }
  let attachment_url = null;
  let attachment_name = null;
  if (file) {
    const uploaded = await uploadAttachment(file, "inspections");
    if (uploaded) {
      attachment_url = uploaded.url;
      attachment_name = uploaded.name;
    }
  }
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
        inspected_at,
        attachment_url,
        attachment_name
      })
    });
    if (res.ok) {
      await fetchInspections();
      renderInspections();
    } else {
      alert(`Kunde inte logga besiktningen (${res.status}).`);
    }
  } catch (e) {
    console.error("Kunde inte logga besiktning", e);
    alert("Kunde inte logga besiktningen – nätverksfel. Försök igen.");
  }
}

/* ---------------------------------------------------------------------
   Väder – aktuellt väder + kort prognos från Open-Meteo, baserat på
   koordinater från inställningarna. Ingen databaskoppling.
   ------------------------------------------------------------------- */
function renderWeather() {
  const el = document.getElementById("weatherPanel");

  if (!isWeatherConfigured()) {
    const hasSome = (settings.latitude || settings.longitude);
    el.innerHTML = hasSome
      ? `<div class="hint">Koordinaterna ser ogiltiga ut (latitud −90 till 90, longitud −180 till 180, använd punkt eller komma som decimaltecken). Öppna inställningarna (kugghjulet) och kontrollera värdena.</div>`
      : `<div class="hint">Ange koordinater i inställningarna (kugghjulet) för att visa väder.</div>`;
    return;
  }
  if (!weather || !weather.current) {
    el.innerHTML = `<div class="hint">Kunde inte hämta väderdata just nu.${weatherError ? ` (${escapeHtml(weatherError)})` : ""}</div>`;
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

/* ---------------------------------------------------------------------
   Export – Excel/kalkylark som CSV-filer (en fil per tabell, öppnas
   direkt i Excel) samt PDF via webbläsarens inbyggda utskrift
   (window.print) med särskild utskrifts-CSS som gör dashboarden till en
   ren rapport. Båda helt fristående – ingen extern tjänst eller CDN-
   biblioteket krävs, vilket gör exporten pålitlig även bakom en
   företagsbrandvägg som blockar okända skript-CDN:er.
   ------------------------------------------------------------------- */

// Bygger en CSV-textsträng (semikolon som avgränsare, vilket är vad
// svenska Excel-installationer förväntar sig som standard) av en lista
// objekt. `columns` är [ [rubrik, fältnamn-eller-funktion], ... ].
function toCsv(columns, rows) {
  const escapeCsv = value => {
    const s = value === null || value === undefined ? "" : String(value);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(c => escapeCsv(c[0])).join(";");
  const body = rows.map(row => columns.map(c => {
    const v = typeof c[1] === "function" ? c[1](row) : row[c[1]];
    return escapeCsv(v);
  }).join(";")).join("\r\n");
  // UTF-8 BOM så att å/ä/ö visas korrekt när filen öppnas i Excel.
  return "﻿" + header + "\r\n" + body;
}

function downloadCsv(filename, columns, rows) {
  const csv = toCsv(columns, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function onExportExcel() {
  if (!isSupabaseConfigured()) {
    alert("Ingen databas ansluten – det finns inget att exportera ännu.");
    return;
  }

  const itemById = new Map(items.map(it => [it.id, it]));
  const ts = todayISO();
  const exports = [
    {
      name: `4D-dashboard-planeringsobjekt-${ts}.csv`,
      columns: [
        ["Objekt", it => itemLabel(it)],
        ["Status", it => STATUS_LABELS[it.status] || it.status],
        ["Framdrift (%)", "progress"],
        ["Område", "area"],
        ["Aktivitet", "activity"],
        ["Entreprenör", "contractor"],
        ["Startdatum", "startDate"],
        ["Slutdatum", "endDate"]
      ],
      rows: items
    },
    {
      name: `4D-dashboard-milstolpar-${ts}.csv`,
      columns: [
        ["Namn", "name"],
        ["Måldatum", "target_date"],
        ["Klar", m => m.is_done ? "Ja" : "Nej"],
        ["Klardatum", "completed_date"]
      ],
      rows: milestones
    },
    {
      name: `4D-dashboard-bemanning-${ts}.csv`,
      columns: [
        ["Entreprenör", "contractor"],
        ["Veckostart", "week_start"],
        ["Planerad bemanning", "planned_headcount"],
        ["Faktisk bemanning", "headcount"]
      ],
      rows: staffing
    },
    {
      name: `4D-dashboard-leveransplan-${ts}.csv`,
      columns: [
        ["Beskrivning", "description"],
        ["Leverantör", "supplier"],
        ["Entreprenör", "contractor"],
        ["Område", "area"],
        ["Planerat datum", "planned_date"],
        ["Faktiskt datum", "actual_date"],
        ["Status", d => d.status || "planerad"]
      ],
      rows: deliveries
    },
    {
      name: `4D-dashboard-leveransplan-handlingar-${ts}.csv`,
      columns: [
        ["Beskrivning", "description"],
        ["Leverantör", "supplier"],
        ["Entreprenör", "contractor"],
        ["Område", "area"],
        ["Planerat datum", "planned_date"],
        ["Faktiskt datum", "actual_date"],
        ["Status", d => d.status || "planerad"]
      ],
      rows: documentDeliveries
    },
    {
      name: `4D-dashboard-hinder-${ts}.csv`,
      columns: [
        ["Beskrivning", "description"],
        ["Objekt", b => b.plan_item_id && itemById.has(Number(b.plan_item_id)) ? itemLabel(itemById.get(Number(b.plan_item_id))) : ""],
        ["Påverkade aktiviteter", b => (Array.isArray(b.affected_item_ids) ? b.affected_item_ids : [])
          .map(id => itemById.get(Number(id))).filter(Boolean).map(itemLabel).join(", ")],
        ["Ansvarig", "responsible"],
        ["Deadline", "deadline"],
        ["Påverkan på produktion", "production_impact"],
        ["Löst", b => b.is_resolved ? "Ja" : "Nej"],
        ["Löst datum", "resolved_date"]
      ],
      rows: blockers
    },
    {
      name: `4D-dashboard-sakerhet-${ts}.csv`,
      columns: [
        ["Typ", "event_type"],
        ["Allvarlighetsgrad", "severity"],
        ["Beskrivning", "description"],
        ["Område", "area"],
        ["Entreprenör", "contractor"],
        ["Datum", "event_date"],
        ["Rapporterad av", "reported_by"]
      ],
      rows: safetyEvents
    },
    {
      name: `4D-dashboard-besiktningar-${ts}.csv`,
      columns: [
        ["Typ", "inspection_type"],
        ["Resultat", "result"],
        ["Kommentar", "comment"],
        ["Besiktigad av", "inspected_by"],
        ["Datum", "inspected_at"],
        ["Kopplat objekt", i => i.plan_item_id && itemById.has(i.plan_item_id) ? itemLabel(itemById.get(i.plan_item_id)) : ""]
      ],
      rows: inspections
    }
  ];

  if (weather && weather.current) {
    exports.push({
      name: `4D-dashboard-vader-${ts}.csv`,
      columns: [
        ["Temperatur (°C)", () => weather.current.temperature_2m],
        ["Väderbeskrivning", () => weatherDescription(weather.current.weather_code)],
        ["Vind (m/s)", () => weather.current.wind_speed_10m],
        ["Nederbörd (mm)", () => weather.current.precipitation ?? 0]
      ],
      rows: [{}]
    });
  }

  // En fil per tabell (namngiven per kategori), laddas ner i tur och
  // ordning med en liten fördröjning – annars kan webbläsaren blockera
  // flera samtidiga nedladdningar från samma klick.
  exports.forEach((exp, idx) => {
    setTimeout(() => downloadCsv(exp.name, exp.columns, exp.rows), idx * 200);
  });
}

// PDF-export byggs på webbläsarens inbyggda "Skriv ut" (Spara som PDF),
// vilket funkar i alla webbläsare utan extra bibliotek. @media print i
// style.css döljer knappar/formulär/filter och lägger panelerna i en
// enkel kolumn så resultatet blir en ren rapport.
function onExportPdf() {
  window.print();
}
