// Funktionstest: Resurstimmar-panelen i 4D-dashboard (Victors förfrågan
// 2026-09-17 om "uppföljning på resurstimmar ... som man brukar göra i
// byggprojekt", avgränsat via klargörande fråga till enbart planerad
// tidsåtgång, ingen jämförelse mot verkligt utfall i denna omgång).
//  1) Objekt med sparade delaktiviteter fördelar delaktiviteternas timmar
//     (inte objektets egna "estimated_hours", som ignoreras när
//     delaktiviteter finns - samma låsningsmönster som i 4D-planering).
//  2) Objekt utan delaktiviteter men med egna uppskattade timmar + datum
//     fördelar sina timmar jämnt över sitt datumintervall.
//  3) Objekt utan datum och/eller timmar exkluderas, med en hint om antalet.
//  4) Tabellen summerar per entreprenör (rad) och totalt (fotrad).
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8965;
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

// Pelare A (NCC): har 2 delaktiviteter (8h + 12h = 20h). Objektets egna
// estimated_hours (999) ska IGNORERAS eftersom delaktiviteter finns.
// Pelare B (Peab): inga delaktiviteter, 20h ifyllda direkt på objektet.
// Pelare C (NCC): varken datum eller timmar ifyllda - ska exkluderas.
const seedItems = [
  { id: 'i1', project_id: PROJECT_ID, object_id: 'ext-1', object_name: 'Pelare A', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'pagaende', start_date: '2026-02-01', end_date: '2026-02-15', actual_start_date: null, actual_end_date: null, estimated_hours: 999, progress: 40, updated_at: '2026-02-01T00:00:00Z' },
  { id: 'i2', project_id: PROJECT_ID, object_id: 'ext-2', object_name: 'Pelare B', area: 'Hus A', activity: 'Formning', contractor: 'Peab', status: 'planerad', start_date: '2026-01-10', end_date: '2026-01-20', actual_start_date: null, actual_end_date: null, estimated_hours: 20, progress: 0, updated_at: '2026-01-01T00:00:00Z' },
  { id: 'i3', project_id: PROJECT_ID, object_id: 'ext-3', object_name: 'Pelare C (inga timmar)', area: 'Hus B', activity: 'Gjutning', contractor: 'NCC', status: 'ej_planerad', start_date: null, end_date: null, actual_start_date: null, actual_end_date: null, estimated_hours: null, progress: 0, updated_at: '2026-01-01T00:00:00Z' }
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

  // ---- 1) Kontraktörsraderna finns, alfabetiskt sorterade (NCC, Peab).
  const rowLabels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.reshours-table tbody tr .reshours-rowlabel')).map(el => el.textContent.trim())
  );
  if (JSON.stringify(rowLabels) !== JSON.stringify(['NCC', 'Peab'])) {
    throw new Error('Förväntade entreprenörsraderna ["NCC", "Peab"] i bokstavsordning, fick: ' + JSON.stringify(rowLabels));
  }
  console.log('OK: en rad per entreprenör, alfabetiskt sorterade');

  // ---- 2) Radsummor: NCC = 8+12 = 20 (från delaktiviteterna, objektets
  // egna 999h ska ha ignorerats eftersom delaktiviteter finns). Peab = 20
  // (direkt från objektets egna uppskattade timmar).
  const rowTotals = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.reshours-table tbody tr')).map(tr => tr.querySelector('.reshours-rowtotal').textContent.trim())
  );
  if (rowTotals[0] !== '20') throw new Error('Förväntade NCC-radens totalsumma "20" (8+12h från delaktiviteterna, inte objektets egna 999h), fick: ' + rowTotals[0]);
  if (rowTotals[1] !== '20') throw new Error('Förväntade Peab-radens totalsumma "20" (objektets egna uppskattade timmar), fick: ' + rowTotals[1]);
  console.log('OK: delaktiviteters timmar används istället för objektets egna när delaktiviteter finns, annars objektets egna timmar');

  // ---- 3) Fotradens totalsumma = 20 + 20 = 40.
  const grandTotal = await page.evaluate(() => document.querySelector('.reshours-table tfoot .reshours-rowtotal').textContent.trim());
  if (grandTotal !== '40') throw new Error('Förväntade en total på "40" i fotraden, fick: ' + grandTotal);
  console.log('OK: fotraden summerar samtliga entreprenörers timmar korrekt');

  // ---- 4) Pelare C (varken datum eller timmar) exkluderas, med en hint.
  const hint = await page.locator('#resourceHoursChart').innerText();
  if (!/1 objekt saknar uppskattade timmar/.test(hint)) throw new Error('Förväntade en hint om att 1 objekt utan timmar/datum inte visas, fick: ' + hint);
  console.log('OK: objekt utan uppskattade timmar och/eller datum exkluderas, med en hint om antalet');

  await browser.close();
  server.close();

  console.log('Konsolfel:', consoleErrors);
  if (consoleErrors.length > 0) throw new Error('Konsolfel upptäcktes: ' + consoleErrors.join(' | '));
  console.log('OK: Resurstimmar-panelen fungerar korrekt');
}

run().catch(e => { console.error(e); process.exit(1); });
