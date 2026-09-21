// Funktionstest: dra i en stapels vänster-/högerkant i redigerbart
// Gantt-läge för att förlänga/förkorta ett objekts start- eller slutdatum
// (Victors förfrågan 2026-09-21: "det är inte möjligt att dra i hörnen för
// att förlänga eller förkorta aktiviteterna").
//
// Grundorsak (hittad via en fristående reproduktionsskript innan denna fil
// skrevs): #ganttChart är en skrollbar ruta (overflow:auto) som i inzoomat
// läge ofta är SMALARE än stapeln den innehåller - i Victors smala
// sidopanel i Trimble Connect (~480-520px brett minus etikettkolumnen)
// slog det till på i princip vilken zoomad stapel som helst. Kant-zonens
// gamla beräkning (offsetX mot stapelns FULLA, ev. delvis dolda bredd)
// landade då på pixlar som webbläsaren aldrig visar/skickar pekar-events
// för (overflow klipper bort dem) - man kunde bara greppa mitten av
// stapeln (flytta), aldrig den faktiska kanten. Fixen räknar istället
// kant-zonen mot stapelns SYNLIGA kant (beskuren mot #ganttChart:s egen
// klientyta), så man kan greppa "så nära kanten man faktiskt kan se/nå",
// precis som en skrollbar tabellkolumn går att dra i även om dess sanna
// kant råkar vara utanför synligt område just nu.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8975;
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

const today = new Date();
const iso = (offsetDays) => {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

const X_ID = 'x1-formning';

function resetStore(item) {
  store.clear();
  seedJson(`projects/${PROJECT_ID}/plan_items.json`, [item]);
  ['plan_item_activities', 'plan_item_baseline_history', 'plan_milestones', 'plan_item_comments',
   'plan_item_progress_history', 'plan_staffing', 'plan_deliveries', 'plan_document_deliveries',
   'plan_safety_events', 'plan_inspections', 'plan_blockers', 'plan_blocker_comments'
  ].forEach(t => seedJson(`projects/${PROJECT_ID}/${t}.json`, []));
}

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 520, height: 1400 } });

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
        convertToObjectRuntimeIds: function() { return Promise.resolve([]); },
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
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData() || '{}');
      const existing = store.get(filePath);
      if (existing && existing.sha !== body.sha) {
        route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'conflict' }) });
        return;
      }
      const raw = Buffer.from(body.content, 'base64').toString('utf8');
      const newSha = shaFor(raw);
      store.set(filePath, { content: raw, sha: newSha });
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: newSha } }) });
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

  // ---- 1) Grundfall: kanten är fullt synlig (litet, ozoomat "Anpassa"-läge) - ska fungera precis som innan.
  resetStore({ id: X_ID, project_id: PROJECT_ID, object_id: 'ext-x', object_name: 'Formning Pelare A', area: 'Hus A', activity: 'Formning', contractor: 'NCC', status: 'pagaende', start_date: iso(-10), end_date: iso(10), actual_start_date: null, actual_end_date: null, progress: 50, depends_on: [], updated_at: '2026-01-01T00:00:00Z' });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('#ganttEditable').check();
  await page.waitForTimeout(150);

  const bar1 = page.locator('.gantt-bar[data-item-id="' + X_ID + '"]');
  const box1 = await bar1.boundingBox();
  const grabX1 = box1.x + box1.width - 3;
  const grabY1 = box1.y + box1.height / 2;
  await page.mouse.move(grabX1, grabY1);
  await page.mouse.down();
  await page.mouse.move(grabX1 + 20, grabY1, { steps: 3 });
  await page.mouse.move(grabX1 + 40, grabY1, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  let saved = JSON.parse(store.get(`projects/${PROJECT_ID}/plan_items.json`).content).find(r => r.id === X_ID);
  if (saved.start_date !== iso(-10)) throw new Error('Högerkant-drag ska INTE ändra startdatumet, fick: ' + saved.start_date);
  if (saved.end_date === iso(10)) throw new Error('Förväntade att slutdatumet förlängts av högerkant-draget, men det är oförändrat');
  console.log('OK: att dra i en fullt synlig högerkant förlänger slutdatumet utan att röra startdatumet');

  // ---- 2) Zoomat läge där stapelns HÖGERKANT hamnar utanför #ganttChart:s
  //         synliga (klippta) yta redan vid start (scrollLeft=0) - detta var
  //         exakt scenariot som gjorde att hörn-dragning "inte gick" i
  //         Victors smala sidopanel.
  resetStore({ id: X_ID, project_id: PROJECT_ID, object_id: 'ext-x', object_name: 'Formning Pelare A', area: 'Hus A', activity: 'Formning', contractor: 'NCC', status: 'pagaende', start_date: iso(-10), end_date: iso(10), actual_start_date: null, actual_end_date: null, progress: 50, depends_on: [], updated_at: '2026-01-01T00:00:00Z' });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('#ganttZoomIn').click();
  await page.locator('#ganttZoomIn').click();
  await page.locator('#ganttZoomIn').click();
  await page.locator('#ganttZoomIn').click(); // GANTT_ZOOM_LEVELS[3] = 18 px/dag -> 20-dagarsstapeln blir 360px, bredare än panelen
  await page.waitForTimeout(150);
  await page.locator('#ganttEditable').check();
  await page.waitForTimeout(150);

  const bar2 = page.locator('.gantt-bar[data-item-id="' + X_ID + '"]');
  const box2 = await bar2.boundingBox();
  const chartClipRight = await page.evaluate(() => document.getElementById('ganttChart').getBoundingClientRect().right);
  if (box2.x + box2.width <= chartClipRight) {
    throw new Error('Testet förutsätter att stapelns högerkant är utanför #ganttChart:s synliga yta - annars testar det inte den ursprungliga buggen. bar right=' + (box2.x + box2.width) + ', chart clip right=' + chartClipRight);
  }
  // Greppa så nära den verkliga kanten som faktiskt är synlig/klickbar.
  const grabX2 = Math.min(box2.x + box2.width, chartClipRight) - 3;
  const grabY2 = box2.y + box2.height / 2;
  await page.mouse.move(grabX2, grabY2);
  await page.mouse.down();
  await page.mouse.move(grabX2 + 20, grabY2, { steps: 3 });
  await page.mouse.move(grabX2 + 40, grabY2, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  saved = JSON.parse(store.get(`projects/${PROJECT_ID}/plan_items.json`).content).find(r => r.id === X_ID);
  if (saved.start_date !== iso(-10)) throw new Error('Högerkant-drag (klippt läge) ska INTE ändra startdatumet, fick: ' + saved.start_date);
  if (saved.end_date === iso(10)) throw new Error('Förväntade att slutdatumet förlängts trots att stapelns sanna högerkant var utanför synligt område - detta var precis den rapporterade buggen (hörnen gick inte att dra i), fick oförändrat: ' + saved.end_date);
  console.log('OK: att dra nära en högerkant som är beskuren av #ganttChart:s synliga yta (i smal, zoomad panel) fungerar nu - detta var den rapporterade buggen');

  // ---- 3) Samma sak för VÄNSTERKANTEN, när den skrollats utanför synligt område.
  resetStore({ id: X_ID, project_id: PROJECT_ID, object_id: 'ext-x', object_name: 'Formning Pelare A', area: 'Hus A', activity: 'Formning', contractor: 'NCC', status: 'pagaende', start_date: iso(-60), end_date: iso(60), actual_start_date: null, actual_end_date: null, progress: 50, depends_on: [], updated_at: '2026-01-01T00:00:00Z' });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('#ganttZoomIn').click();
  await page.locator('#ganttZoomIn').click();
  await page.locator('#ganttZoomIn').click();
  await page.locator('#ganttZoomIn').click();
  await page.waitForTimeout(150);
  await page.locator('#ganttEditable').check();
  await page.waitForTimeout(150);
  // Skrolla schemat åt höger så stapelns vänsterkant (startdatumet) hamnar
  // utanför synligt område, men själva stapelkroppen fortfarande täcker
  // #ganttChart:s vänstra klippkant.
  await page.evaluate(() => { document.getElementById('ganttChart').scrollLeft = 200; });
  await page.waitForTimeout(100);

  const bar3 = page.locator('.gantt-bar[data-item-id="' + X_ID + '"]');
  const box3 = await bar3.boundingBox();
  const chartClipLeft = await page.evaluate(() => document.getElementById('ganttChart').getBoundingClientRect().left);
  if (box3.x >= chartClipLeft) {
    throw new Error('Testet förutsätter att stapelns vänsterkant är utanför #ganttChart:s synliga yta efter skroll. bar left=' + box3.x + ', chart clip left=' + chartClipLeft);
  }
  const grabX3 = Math.max(box3.x, chartClipLeft) + 3;
  const grabY3 = box3.y + box3.height / 2;
  await page.mouse.move(grabX3, grabY3);
  await page.mouse.down();
  await page.mouse.move(grabX3 - 20, grabY3, { steps: 3 });
  await page.mouse.move(grabX3 - 40, grabY3, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  saved = JSON.parse(store.get(`projects/${PROJECT_ID}/plan_items.json`).content).find(r => r.id === X_ID);
  if (saved.end_date !== iso(60)) throw new Error('Vänsterkant-drag (klippt läge) ska INTE ändra slutdatumet, fick: ' + saved.end_date);
  if (saved.start_date === iso(-60)) throw new Error('Förväntade att startdatumet tidigarelagts trots att stapelns sanna vänsterkant var utanför synligt område, fick oförändrat: ' + saved.start_date);
  console.log('OK: att dra nära en vänsterkant som skrollats utanför #ganttChart:s synliga yta fungerar också');

  await browser.close();
  server.close();

  console.log('Konsolfel:', consoleErrors);
  if (consoleErrors.length > 0) throw new Error('Konsolfel upptäcktes: ' + consoleErrors.join(' | '));
  console.log('OK: hörn-dragning (förläng/förkorta) i redigerbart Gantt-läge fungerar korrekt, även när kanten är beskuren av panelens synliga yta');
}

run().catch(e => { console.error(e); process.exit(1); });
