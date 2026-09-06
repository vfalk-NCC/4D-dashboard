// Visuell + funktionell koll av denna omgångs fyra ändringar:
//  1) Bemanning: cellayouten är fixad (ikonerna ligger inte längre över
//     "Planerad"-raden).
//  2) Hinder, Kvalitet/besiktningar och Säkerhet: "Välj objekt i modell"
//     ersätter/lägger till koppling till ett objekt i 3D-modellen
//     (mockad via TrimbleConnectWorkspace.connect().viewer).
//  3) Väder: emoji som speglar vädret + platsnamn.
//  4) Översikt: nytt cirkeldiagram (donut) för statusfördelningen.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const OUT_DIR = path.join(__dirname, 'screenshots');
const PORT = 8938;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const filePath = path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

const MOCK = {
  items: [
    { id: 1, object_name: 'Objekt A - Grund', status: 'pagaende', progress: 40, area: 'Vitåfors', activity: 'Grundläggning', contractor: 'NCC', start_date: '2026-09-01', end_date: '2026-09-20' },
    { id: 2, object_name: 'Objekt B - Stomme', status: 'klar', progress: 100, area: 'Vitåfors', activity: 'Stomresning', contractor: 'Skanska', start_date: '2026-08-25', end_date: '2026-09-05' },
    { id: 3, object_name: 'Objekt C - Tak', status: 'forsenad', progress: 60, area: 'Malmberget', activity: 'Takarbete', contractor: 'NCC', start_date: '2026-09-01', end_date: '2026-09-10' },
    { id: 4, object_name: 'Objekt D - Installation', status: 'planerad', progress: 0, area: 'Malmberget', activity: 'Installation', contractor: 'Skanska', start_date: '2026-09-15', end_date: '2026-09-25' }
  ],
  milestones: [],
  staffing: [
    { id: 21, contractor: 'NCC', week_start: '2026-09-07', headcount: 5, planned_headcount: 8 }
  ],
  deliveries: [],
  documentDeliveries: [],
  safety: [
    { id: 41, event_type: 'tillbud', severity: 'låg', description: 'Halkrisk', area: 'Vitåfors', contractor: 'NCC', event_date: '2026-09-01', reported_by: 'Kalle' }
  ],
  inspections: [
    { id: 51, inspection_type: 'egenkontroll', result: 'godkänd', comment: 'OK', inspected_by: 'Anna', inspected_at: '2026-09-02' }
  ],
  blockers: [
    { id: 71, description: 'Väntar på leverans av armering', affected_item_ids: [1, 3], responsible: 'Kalle', deadline: '2026-09-12', production_impact: 'Stopp i aktivitet', is_resolved: false, resolved_date: null }
  ],
  blockerComments: [],
  comments: []
};

const inserted = { blockers: [], safety: [], inspections: [] };

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 480, height: 2000 } });

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  // Trimble Connect Workspace API-stub, med en mockad viewer som alltid
  // rapporterar att objekt "42" i modell "model-1" är markerat, med
  // produktnamnet "Pelare P-104" – för att testa "Välj objekt i modell".
  await page.route('https://components.connect.trimble.com/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.TrimbleConnectWorkspace = { connect: function() { return Promise.resolve({
      project: { getProject: function(){ return Promise.resolve({ id: 'test-project' }); } },
      viewer: {
        getSelection: function() { return Promise.resolve([{ modelId: 'model-1', objectRuntimeIds: [42] }]); },
        getObjectProperties: function() { return Promise.resolve([{ id: 42, product: { name: 'Pelare P-104' } }]); },
        setSelection: function() { return Promise.resolve(); }
      }
    }); } };`
  }));

  await page.route('**/rest/v1/**', route => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === 'POST' || method === 'PATCH') {
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (url.includes('plan_blockers')) inserted.blockers.push(body);
      if (url.includes('plan_safety_events')) inserted.safety.push(body);
      if (url.includes('plan_inspections')) inserted.inspections.push(body);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 999, ...body }]) });
      return;
    }
    let data = [];
    if (url.includes('plan_items')) data = MOCK.items;
    else if (url.includes('plan_item_comments')) data = MOCK.comments;
    else if (url.includes('plan_item_progress_history')) data = [];
    else if (url.includes('plan_milestones')) data = MOCK.milestones;
    else if (url.includes('plan_staffing')) data = MOCK.staffing;
    else if (url.includes('plan_document_deliveries')) data = MOCK.documentDeliveries;
    else if (url.includes('plan_deliveries')) data = MOCK.deliveries;
    else if (url.includes('plan_safety_events')) data = MOCK.safety;
    else if (url.includes('plan_inspections')) data = MOCK.inspections;
    else if (url.includes('plan_blocker_comments')) data = MOCK.blockerComments;
    else if (url.includes('plan_blockers')) data = MOCK.blockers;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });

  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      current: { temperature_2m: -4.5, precipitation: 2.1, wind_speed_10m: 4.1, weather_code: 71, is_day: 1 },
      daily: { time: ['2026-09-05','2026-09-06'], temperature_2m_max:[-2,-1], temperature_2m_min:[-8,-7], precipitation_sum:[3,0], weather_code:[71,0] }
    })
  }));

  await page.addInitScript(() => {
    window.localStorage.setItem('4ddash-settings', JSON.stringify({
      supabaseUrl: 'https://fake.supabase.co', supabaseKey: 'fake-anon-key',
      latitude: '67,14', longitude: '20,66', locationName: 'Gällivare'
    }));
  });

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  // 1) Bemanning: ikonerna ska inte överlappa "Planerad"-statraden.
  await page.locator('#staffingChart').screenshot({ path: path.join(OUT_DIR, 'p4_01_staffing.png') });
  const staffingCell = page.locator('.staffing-cell-filled').first();
  const headBox = await staffingCell.locator('.staffing-cell-head').boundingBox();
  const plannedBox = await staffingCell.locator('.staffing-stat').first().boundingBox();
  if (headBox && plannedBox && (headBox.y + headBox.height) > plannedBox.y + 1) {
    throw new Error('Ikonraden i Bemanning överlappar fortfarande "Planerad"-raden');
  }

  // 2) Väder: emoji + platsnamn ska visas.
  const weatherHtml = await page.locator('#weatherPanel').innerHTML();
  const weatherText = await page.locator('#weatherPanel').innerText();
  if (!weatherHtml.includes('Gällivare')) throw new Error('Platsnamnet visas inte i väderpanelen');
  if (!weatherHtml.includes('weather-emoji') || !/❄️|🌨️/.test(weatherText)) {
    throw new Error('Väderemoji visas inte (förväntade snö-emoji för weather_code 71)');
  }
  await page.locator('#weatherPanel').screenshot({ path: path.join(OUT_DIR, 'p4_02_weather.png') });

  // 3) Översikt: cirkeldiagrammet (donut) ska finnas och visa segment.
  const donutSegments = await page.locator('#statusDonut .donut-svg circle').count();
  if (donutSegments < 2) throw new Error('Cirkeldiagrammet i Översikt saknar segment (bakgrundscirkel + minst en status)');
  await page.locator('#kpiGrid, #statusDonut').first().locator('xpath=..').screenshot({ path: path.join(OUT_DIR, 'p4_03_overview_donut.png') });

  // 4) Hinder: "Välj objekt i modell" ska visas istället för "Inget objekt".
  const blockersHtml = await page.locator('#blockersList').innerHTML();
  if (!blockersHtml.includes('Välj objekt i modell')) throw new Error('Hinder saknar "Välj objekt i modell"-knappen');
  if (blockersHtml.includes('Inget objekt')) throw new Error('Hinder visar fortfarande gamla "Inget objekt"-texten');
  await page.locator('#newBlockerModelPickBtn').click();
  await page.waitForTimeout(200);
  const blockerBadgeText = await page.locator('#newBlockerModelPicker .model-pick-btn').innerText();
  if (!blockerBadgeText.includes('Pelare P-104')) throw new Error('Hinder-formuläret visar inte det valda objektets namn efter "Välj objekt i modell"');
  await page.locator('#blockersList').screenshot({ path: path.join(OUT_DIR, 'p4_04_blocker_picker.png') });
  await page.locator('#newBlockerDesc').fill('Testhinder med objektval');
  await page.locator('#btnAddBlocker').click();
  await page.waitForTimeout(300);
  if (inserted.blockers.length === 0 || inserted.blockers[0].model_object_name !== 'Pelare P-104') {
    throw new Error('Hindret sparades inte med model_object_name från 3D-modellen');
  }

  // 5) Säkerhet: ny funktionalitet, "Välj objekt i modell" ska finnas.
  const safetyHtml = await page.locator('#safetyFeed').innerHTML();
  if (!safetyHtml.includes('Välj objekt i modell')) throw new Error('Säkerhet saknar "Välj objekt i modell"-knappen');
  await page.locator('#newSafetyModelPickBtn').click();
  await page.waitForTimeout(200);
  await page.locator('#newSafetyType').fill('tillbud');
  await page.locator('#btnAddSafety').click();
  await page.waitForTimeout(300);
  if (inserted.safety.length === 0 || inserted.safety[0].model_object_name !== 'Pelare P-104') {
    throw new Error('Säkerhetshändelsen sparades inte med model_object_name från 3D-modellen');
  }

  // 6) Kvalitet/besiktningar: "Välj objekt i modell" ska finnas.
  const inspectionsHtml = await page.locator('#inspectionsList').innerHTML();
  if (!inspectionsHtml.includes('Välj objekt i modell')) throw new Error('Besiktningar saknar "Välj objekt i modell"-knappen');
  await page.locator('#newInspectionModelPickBtn').click();
  await page.waitForTimeout(200);
  await page.locator('#newInspectionType').fill('egenkontroll');
  await page.locator('#btnAddInspection').click();
  await page.waitForTimeout(300);
  if (inserted.inspections.length === 0 || inserted.inspections[0].model_object_name !== 'Pelare P-104') {
    throw new Error('Besiktningen sparades inte med model_object_name från 3D-modellen');
  }

  await browser.close();
  server.close();

  console.log('Screenshots saved to', OUT_DIR);
  console.log('Console errors:', consoleErrors);
  if (consoleErrors.length > 0) throw new Error('Konsolfel upptäcktes: ' + consoleErrors.join(' | '));
  console.log('OK: alla kontroller godkända');
}

run().catch(e => { console.error(e); process.exit(1); });
