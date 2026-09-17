// Funktionstest: "Synliga block" i 4D-dashboards inställningar (Victors
// förfrågan 2026-09-17: "Man ska kunna välja från en lista vilka block
// man vill ha synliga, detta gör också så att dolda block inte kommer med
// i rapporten i pdf eller excel också").
//  1) Inställningsdialogen listar en kryssruta per block, ikryssade
//     (synliga) som standard.
//  2) Att bocka ur en kryssruta döljer blocket direkt (display:none),
//     vilket även är vad @media print/PDF-exporten bygger på.
//  3) Excel-exporten utesluter CSV-filen för det dolda blocket, men tar
//     fortfarande med filer för block som är kvar synliga.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8966;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const PROJECT_ID = 'test-project';

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

const store = new Map();
function shaFor(content) {
  return crypto.createHash('sha1').update(typeof content === 'string' ? content : JSON.stringify(content)).digest('hex') + Math.random().toString(16).slice(2, 6);
}
function seedJson(filePath, content) {
  store.set(filePath, { content: JSON.stringify(content), sha: shaFor(content) });
}

const seedItems = [
  { id: 'i1', project_id: PROJECT_ID, object_id: 'ext-1', object_name: 'Pelare A', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'planerad', start_date: '2026-02-01', end_date: '2026-02-10', actual_start_date: null, actual_end_date: null, estimated_hours: null, progress: 0, updated_at: '2026-02-01T00:00:00Z' }
];
seedJson(`projects/${PROJECT_ID}/plan_items.json`, seedItems);
seedJson(`projects/${PROJECT_ID}/plan_item_activities.json`, []);
seedJson(`projects/${PROJECT_ID}/plan_milestones.json`, [
  { id: 'm1', project_id: PROJECT_ID, name: 'Stomresning klar', target_date: '2026-03-01', is_done: false, completed_date: null }
]);
seedJson(`projects/${PROJECT_ID}/plan_staffing.json`, [
  { id: 's1', project_id: PROJECT_ID, contractor: 'NCC', week_start: '2026-02-02', headcount: 5, planned_headcount: 6 }
]);
seedJson(`projects/${PROJECT_ID}/plan_deliveries.json`, []);
seedJson(`projects/${PROJECT_ID}/plan_document_deliveries.json`, []);
seedJson(`projects/${PROJECT_ID}/plan_safety_events.json`, []);
seedJson(`projects/${PROJECT_ID}/plan_inspections.json`, []);
seedJson(`projects/${PROJECT_ID}/plan_blockers.json`, []);
seedJson(`projects/${PROJECT_ID}/plan_blocker_comments.json`, []);
seedJson(`projects/${PROJECT_ID}/plan_item_comments.json`, []);
seedJson(`projects/${PROJECT_ID}/plan_item_progress_history.json`, []);

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 480, height: 2400 } });

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && !/Failed to load resource.*404/.test(msg.text())) consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  await page.route('https://components.connect.trimble.com/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.TrimbleConnectWorkspace = { connect: function() { return Promise.resolve({
      project: { getProject: function(){ return Promise.resolve({ id: '${PROJECT_ID}' }); } },
      viewer: {
        getSelection: function() { return Promise.resolve([]); },
        convertToObjectIds: function() { return Promise.resolve([]); },
        getObjectProperties: function() { return Promise.resolve([]); },
        setSelection: function() { return Promise.resolve(); }
      }
    }); } };`
  }));

  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const filePath = decodeURIComponent(url.pathname.replace('/repos/vfalk-NCC/4D-data/contents/', ''));
    if (req.method() === 'GET') {
      const entry = store.get(filePath);
      if (!entry) { route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not Found' }) }); return; }
      const b64 = Buffer.from(entry.content).toString('base64');
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: b64, sha: entry.sha }) });
      return;
    }
    route.fulfill({ status: 405, body: 'method not allowed' });
  });

  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ current_weather: {}, daily: {} })
  }));

  await page.addInitScript(() => {
    window.localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 'fake-token-for-test' }));
    window.localStorage.setItem('4ddash-unlocked', '1');
  });

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // ---- 1) Inställningarna listar en kryssruta per block, ikryssade som standard.
  await page.locator('#btnSettings').click();
  await page.waitForTimeout(50);
  const checkCount = await page.locator('.panel-visibility-check').count();
  const panelCount = await page.locator('.panel[data-panel-id]').count();
  if (checkCount !== panelCount) throw new Error(`Förväntade en kryssruta per block (${panelCount}), fick ${checkCount}`);
  const milestonesCheck = page.locator('.panel-visibility-check[data-panel-id="milestones"]');
  if (!(await milestonesCheck.isChecked())) throw new Error('Milstolpar-blocket skulle vara ikryssat (synligt) som standard');
  console.log('OK: inställningarna listar en kryssruta per block, alla ikryssade (synliga) som standard');

  // ---- 2) Att bocka ur "Milstolpar" döljer blocket direkt.
  await milestonesCheck.uncheck();
  await page.waitForTimeout(50);
  const milestonesPanelDisplay = await page.locator('.panel[data-panel-id="milestones"]').evaluate(el => getComputedStyle(el).display);
  if (milestonesPanelDisplay !== 'none') throw new Error('Milstolpar-blocket skulle vara dolt (display:none) efter urbockning, fick: ' + milestonesPanelDisplay);
  const staffingPanelDisplay = await page.locator('.panel[data-panel-id="staffing"]').evaluate(el => getComputedStyle(el).display);
  if (staffingPanelDisplay === 'none') throw new Error('Bemanning-blocket skulle fortfarande vara synligt (bara Milstolpar bockades ur)');
  console.log('OK: att bocka ur ett block döljer det direkt (display:none), andra block påverkas inte');

  // ---- 3) Valet överlever en omladdning (sparas i localStorage).
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const milestonesPanelDisplayAfterReload = await page.locator('.panel[data-panel-id="milestones"]').evaluate(el => getComputedStyle(el).display);
  if (milestonesPanelDisplayAfterReload !== 'none') throw new Error('Det dolda blocket skulle förbli dolt efter en omladdning, fick: ' + milestonesPanelDisplayAfterReload);
  console.log('OK: vilka block som är dolda sparas i localStorage och gäller efter omladdning');

  // ---- 4) Excel-exporten utesluter CSV-filen för det dolda blocket
  // (Milstolpar), men tar med filer för block som fortfarande är synliga
  // (Bemanning) samt den grundläggande objektlistan (som inte hör till
  // något enskilt block).
  const downloadedNames = [];
  page.on('download', async (download) => { downloadedNames.push(download.suggestedFilename()); await download.path(); });
  await page.locator('#btnExportExcel').click();
  await page.waitForTimeout(2500);

  if (downloadedNames.some(n => n.includes('milstolpar'))) {
    throw new Error('Excel-exporten skulle INTE innehålla milstolpar-filen när Milstolpar-blocket är dolt, fick filer: ' + JSON.stringify(downloadedNames));
  }
  if (!downloadedNames.some(n => n.includes('bemanning'))) {
    throw new Error('Excel-exporten skulle fortfarande innehålla bemanning-filen (blocket är synligt), fick filer: ' + JSON.stringify(downloadedNames));
  }
  if (!downloadedNames.some(n => n.includes('planeringsobjekt'))) {
    throw new Error('Excel-exporten skulle fortfarande innehålla planeringsobjekt-filen (grunddata, hör inte till ett enskilt block), fick filer: ' + JSON.stringify(downloadedNames));
  }
  console.log('OK: Excel-exporten utesluter CSV-filen för dolda block men tar med filer för synliga block');

  await browser.close();
  server.close();

  console.log('Konsolfel:', consoleErrors);
  if (consoleErrors.length > 0) throw new Error('Konsolfel upptäcktes: ' + consoleErrors.join(' | '));
  console.log('OK: "Synliga block"-funktionen fungerar korrekt');
}

run().catch(e => { console.error(e); process.exit(1); });
