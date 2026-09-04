/* =========================================================================
   4D-dashboard – Trimble Connect Extension
   ---------------------------------------------------------------------
   Fristående extension som visar nyckeltal och statusfördelning för
   samma planeringsdata som 4D-planering skriver till (Supabase-tabellen
   plan_items). Läser bara data – skriver aldrig något till databasen.
   Bygger på trimble-connect-workspace-api. Se:
   https://developer.trimble.com/docs/connect/workspace-api/
   ========================================================================= */

let API = null;              // Workspace API-instans
let projectId = null;        // Aktuellt Trimble Connect-projekt
let items = [];              // Cache av planeringsposter (från backend)
let settings = {
  supabaseUrl: "",
  supabaseKey: ""
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
}

function toggle(id, show) {
  document.getElementById(id).classList.toggle("hidden", !show);
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
  renderKpis();
  renderStatusChart();
  updateLastUpdated();
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
    progress: Number.isFinite(row.progress) ? row.progress : 0
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

/* ---------------------------------------------------------------------
   Statistik
   ------------------------------------------------------------------- */
function computeStats() {
  const total = items.length;
  const byStatus = {};
  STATUS_ORDER.forEach(s => { byStatus[s] = 0; });
  let progressSum = 0;

  items.forEach(it => {
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
  const s = computeStats();

  if (s.total === 0) {
    el.innerHTML = `<div class="hint">${isSupabaseConfigured() ? "Inga planerade objekt hittades för det här projektet." : "Ingen databas ansluten ännu."}</div>`;
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
  const s = computeStats();

  if (s.total === 0) {
    el.innerHTML = `<div class="hint">${isSupabaseConfigured() ? "Inga planerade objekt att visa." : "Ingen databas ansluten ännu."}</div>`;
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
