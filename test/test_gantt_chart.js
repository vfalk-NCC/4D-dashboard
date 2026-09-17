// Funktionstest: Gantt-schema i 4D-dashboard (Victors förfrågan 2026-09-17).
//  1) En rad per objekt (planerat start-slut), sorterat på startdatum.
//  2) Objekt med sparade delaktiviteter (plan_item_activities) har en
//     utfällbar pil - klick visar/döljer delaktivitetsraderna.
//  3) Kryssrutan "Visa verkligt" lägger till en extra stapel med verklig
//     start/avslut, av som standard.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8964;
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
  { id: 'i1', project_id: PROJECT_ID, object_id: 'ext-1', object_name: 'Pelare A', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'pagaende', start_date: '2026-02-01', end_date: '2026-02-15', actual_start_date: '2026-02-03', actual_end_date: null, estimated_hours: null, progress: 40, updated_at: '2026-02-01T00:00:00Z' },
  { id: 'i2', project_id: PROJECT_ID, object_id: 'ext-2', object_name: 'Pelare B', area: 'Hus A', activity: 'Formning', contractor: 'Peab', status: 'klar', start_date: '2026-01-10', end_date: '2026-01-20', actual_start_date: '2026-01-11', actual_end_date: '2026-01-22', estimated_hours: null, progress: 100, updated_at: '2026-01-22T00:00:00Z' },
  { id: 'i3', project_id: PROJECT_ID, object_id: 'ext-3', object_name: 'Pelare C (inga datum)', area: 'Hus B', activity: 'Gjutning', contractor: 'NCC', status: 'ej_planerad', start_date: null, end_date: null, actual_start_date: null, actual_end_date: null, estimated_hours: null, progress: 0, updated_at: '2026-01-01T00:00:00Z' }
];
seedJson(`projects/${PROJECT_ID}/plan_items.json`, seedItems);

const seedActivities = [
  { id: 'act-1', plan_item_id: 'i1', project_id: PROJECT_ID, name: 'Formning', start_date: '2026-02-01', end_date: '2026-02-06', estimated_hours: 8 },
  { id: 'act-2', plan_item_id: 'i1', project_id: PROJECT_ID, name: 'Gjutning', start_date: '2026-02-07', end_date: '2026-02-15', estimated_hours: 12 }
];
seedJson(`projects/${PROJECT_ID}/plan_item_activities.json`, seedActivities);
seedJson(`projects/${PROJECT_ID}/plan_milestones.json`, []);
seedJson(`projects/${PROJECT_ID}/plan_deliveries.json`, []);

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
  await page.waitForTimeout(600);

  // ---- 1) En rad per objekt med datum, sorterat på startdatum. Objekt utan datum uteslutet + varnat om.
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('.gantt-row:not(.gantt-subrow) .gantt-label')).map(el => el.textContent.trim()));
  if (JSON.stringify(labels) !== JSON.stringify(['Pelare B', 'Pelare A'])) {
    throw new Error('Förväntade raderna i startdatumordning ["Pelare B", "Pelare A"] (Pelare C saknar datum och ska inte visas), fick: ' + JSON.stringify(labels));
  }
  const skippedHint = await page.locator('#ganttChart').innerText();
  if (!/1 objekt utan både start- och slutdatum/.test(skippedHint)) throw new Error('Förväntade en hint om att 1 objekt utan datum inte visas, fick: ' + skippedHint);
  console.log('OK: Gantt-schemat visar en rad per objekt med datum, sorterat på startdatum, och varnar om uteslutna objekt utan datum');

  // ---- 2) Infällbara delaktiviteter - Pelare A har 2 sparade, Pelare B har 0.
  const subRowsBefore = await page.locator('.gantt-subrow').count();
  if (subRowsBefore !== 0) throw new Error('Delaktiviteter ska vara hopfällda som standard, hittade: ' + subRowsBefore);

  const toggleA = page.locator('.gantt-row:not(.gantt-subrow)', { hasText: 'Pelare A' }).locator('[data-action="toggle-gantt"]');
  if (await toggleA.count() !== 1) throw new Error('Pelare A (har delaktiviteter) skulle ha en utfällbar pil');
  const toggleB = page.locator('.gantt-row:not(.gantt-subrow)', { hasText: 'Pelare B' }).locator('[data-action="toggle-gantt"]');
  if (await toggleB.count() !== 0) throw new Error('Pelare B (inga delaktiviteter) skulle INTE ha en utfällbar pil');

  await toggleA.click();
  await page.waitForTimeout(50);
  const subLabelsA = await page.evaluate(() => Array.from(document.querySelectorAll('.gantt-subrow .gantt-sublabel')).map(el => el.textContent.trim()));
  if (JSON.stringify(subLabelsA) !== JSON.stringify(['Formning', 'Gjutning'])) {
    throw new Error('Förväntade delaktiviteterna ["Formning", "Gjutning"] under Pelare A, fick: ' + JSON.stringify(subLabelsA));
  }
  console.log('OK: klick på pilen fäller ut objektets sparade delaktiviteter som egna rader');

  await toggleA.click();
  await page.waitForTimeout(50);
  const subRowsAfterCollapse = await page.locator('.gantt-subrow').count();
  if (subRowsAfterCollapse !== 0) throw new Error('Delaktiviteterna skulle fällas ihop igen vid nytt klick på pilen');
  console.log('OK: ett andra klick på pilen fäller ihop delaktiviteterna igen');

  // ---- 3) "Visa verkligt" - av som standard, lägger till en extra stapel när ikryssad.
  const actualBarsBefore = await page.locator('.gantt-bar-actual').count();
  if (actualBarsBefore !== 0) throw new Error('"Visa verkligt" ska vara av som standard (inga .gantt-bar-actual), hittade: ' + actualBarsBefore);

  await page.locator('#ganttShowActual').check();
  await page.waitForTimeout(50);
  // Pelare A och Pelare B har båda verklig start, men bara Pelare B har även verkligt avslut ifyllt.
  const actualBarsAfter = await page.locator('.gantt-bar-actual').count();
  if (actualBarsAfter !== 1) throw new Error('Förväntade 1 verklig-stapel (bara Pelare B har både verklig start OCH avslut ifyllt), fick: ' + actualBarsAfter);
  console.log('OK: "Visa verkligt" lägger till en extra stapel bara för objekt som har både verklig start och avslut ifyllt');

  await browser.close();
  server.close();

  console.log('Konsolfel:', consoleErrors);
  if (consoleErrors.length > 0) throw new Error('Konsolfel upptäcktes: ' + consoleErrors.join(' | '));
  console.log('OK: Gantt-schemat fungerar korrekt');
}

run().catch(e => { console.error(e); process.exit(1); });
