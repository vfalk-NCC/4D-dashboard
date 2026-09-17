// Funktionstest: cykeltidsanalysen ska föredra verklig start (actual_start_date)
// för verklig varaktighet när den finns ifylld, och bara falla tillbaka på
// planerat startdatum -> verkligt avslut (den gamla proxyn) för objekt som
// saknar verklig start. Se Victors förfrågan 2026-09-17 ("Om man fyller i
// detta så tänker jag att man kan få en väldigt kraftfull uppföljning...").
//
// Scenario, aktivitet "Gjutning":
//  - i1: ingen verklig start. Planerat 10d (01-01 -> 01-11), verkligt avslut
//    01-11 -> gamla proxyn ger 10d (i tid).
//  - i2: verklig start 01-03 (2 dagar sen jämfört med planerat 01-01), men
//    verkligt avslut 01-13 -> RIKTIG varaktighet är 10d (i tid), medan den
//    gamla proxyn (planerat 01-01 -> verkligt 01-13) hade visat 12d (2 dagar
//    sent) - ett missvisande resultat som den nya beräkningen ska undvika.
// Förväntat resultat: snittet blir 10d/10d (0 avvikelse) och metaraden
// visar "1 av 2 med verklig start".
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8960;
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
  { id: 'i1', project_id: PROJECT_ID, object_id: 'ext-1', object_name: 'Gjutning utan verklig start', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'klar', start_date: '2026-01-01', end_date: '2026-01-11', actual_start_date: null, actual_end_date: '2026-01-11', progress: 100, updated_at: '2026-01-11T00:00:00Z' },
  { id: 'i2', project_id: PROJECT_ID, object_id: 'ext-2', object_name: 'Gjutning med verklig start', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'klar', start_date: '2026-01-01', end_date: '2026-01-11', actual_start_date: '2026-01-03', actual_end_date: '2026-01-13', progress: 100, updated_at: '2026-01-13T00:00:00Z' }
];
seedJson(`projects/${PROJECT_ID}/plan_items.json`, seedItems);
seedJson(`projects/${PROJECT_ID}/plan_milestones.json`, []);
seedJson(`projects/${PROJECT_ID}/plan_deliveries.json`, []);

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 480, height: 2200 } });

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

  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cycle-time-row')).map(r => ({
      label: r.querySelector('.cycle-time-label')?.textContent.trim(),
      values: Array.from(r.querySelectorAll('.cycle-time-bar-value')).map(v => v.textContent.trim()),
      meta: r.querySelector('.cycle-time-meta')?.textContent.trim()
    })));

  if (rows.length !== 1) throw new Error('Förväntade 1 rad (Gjutning), fick: ' + JSON.stringify(rows));
  const g = rows[0];
  if (g.label !== 'Gjutning') throw new Error('Förväntade raden "Gjutning", fick: ' + g.label);
  if (g.values[0] !== '10 d') throw new Error('Förväntade planerat snitt 10d, fick: ' + g.values[0]);
  if (g.values[1] !== '10 d') {
    throw new Error(
      'Förväntade verkligt snitt 10d (i2 räknad från VERKLIG start 01-03->01-13 = 10d, inte gamla proxyn 01-01->01-13 = 12d som skulle gett 11d i snitt), fick: ' + g.values[1]
    );
  }
  if (!/^0 d|^i tid/.test(g.meta)) throw new Error('Förväntade "i tid" (0 avvikelse) i meta, fick: ' + g.meta);
  if (!/1 av 2 med verklig start/.test(g.meta)) throw new Error('Förväntade "1 av 2 med verklig start" i meta, fick: ' + g.meta);
  console.log('OK: cykeltidsanalysen använder verklig start (actualStartDate) för det objekt som har det ifyllt, och faller tillbaka på planerat startdatum för det andra - undviker den gamla proxyns missvisande "2 dagar sent"');

  // CSV-export: ny kolumn "Varav med verklig start".
  const exportOk = await page.evaluate(() => {
    const groups = computeCycleTimeByActivity(items);
    return groups.length === 1 && groups[0].realStartCount === 1 && groups[0].count === 2;
  });
  if (!exportOk) throw new Error('computeCycleTimeByActivity skulle rapportera realStartCount=1 av count=2 för Gjutning');
  console.log('OK: computeCycleTimeByActivity rapporterar realStartCount korrekt (används av CSV-exportens "Varav med verklig start"-kolumn)');

  await browser.close();
  server.close();

  console.log('Konsolfel:', consoleErrors);
  if (consoleErrors.length > 0) throw new Error('Konsolfel upptäcktes: ' + consoleErrors.join(' | '));
  console.log('OK: cykeltidsanalysen med verklig start fungerar korrekt');
}

run().catch(e => { console.error(e); process.exit(1); });
