// Funktionstest: 4D-dashboard är read-only, men ska ändå spegla det nya
// fältet "Verkligt avslut" (actual_end_date) som 4D-planering skriver -
// se konversationen med Victor 2026-09-16 om hur framdriften visualiseras.
// Verifierar:
//  1) KPI-rutan "Klara, men försent" räknar bara klarmarkerade objekt vars
//     verkliga avslut faktiskt låg EFTER planerat slutdatum - inte
//     klarmarkerade objekt som saknar ett ifyllt verkligt avslut (gammal
//     data ska inte gissas som försenad).
//  2) Excel/CSV-exporten av planeringsobjekt har en "Verkligt avslut"-
//     kolumn med rätt värden (tom för objekt som saknar det).
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8945;
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
  return crypto.createHash('sha1').update(typeof content === 'string' ? content : JSON.stringify(content)).digest('hex');
}

// Fyra objekt: klar i tid, klar 5 dagar sent, klarmarkerad UTAN ifyllt
// verkligt avslut (äldre data - ska INTE räknas som försent klar), och ett
// som fortfarande pågår (irrelevant för "Klara, men försent").
const seedItems = [
  { id: crypto.randomUUID(), project_id: PROJECT_ID, model_id: null, object_id: 'ext-1', object_name: 'Balk 1 (i tid)', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'klar', start_date: '2026-01-01', end_date: '2026-01-10', actual_end_date: '2026-01-10', progress: 100, updated_at: '2026-01-10T10:00:00Z' },
  { id: crypto.randomUUID(), project_id: PROJECT_ID, model_id: null, object_id: 'ext-2', object_name: 'Balk 2 (sent)', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'klar', start_date: '2026-01-01', end_date: '2026-01-10', actual_end_date: '2026-01-15', progress: 100, updated_at: '2026-01-15T10:00:00Z' },
  { id: crypto.randomUUID(), project_id: PROJECT_ID, model_id: null, object_id: 'ext-3', object_name: 'Balk 3 (gammal data)', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'klar', start_date: '2026-01-01', end_date: '2026-01-10', actual_end_date: null, progress: 100, updated_at: '2026-01-10T10:00:00Z' },
  { id: crypto.randomUUID(), project_id: PROJECT_ID, model_id: null, object_id: 'ext-4', object_name: 'Balk 4 (pågående)', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'pagaende', start_date: '2026-02-01', end_date: '2026-02-20', actual_end_date: null, progress: 40, updated_at: '2026-02-05T10:00:00Z' }
];
store.set(`projects/${PROJECT_ID}/plan_items.json`, { content: JSON.stringify(seedItems), sha: shaFor(seedItems) });

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 480, height: 2000 }, acceptDownloads: true });

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

  await page.addInitScript(() => {
    window.localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 'fake-token-for-test' }));
    window.localStorage.setItem('4ddash-unlocked', '1');
  });

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // ---- 1) KPI-rutan "Klara, men försent".
  const kpiTiles = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.kpi-tile')).map(t => ({
      value: t.querySelector('.kpi-value')?.textContent.trim(),
      label: t.querySelector('.kpi-label')?.textContent.trim()
    })));
  const doneLateTile = kpiTiles.find(t => t.label === 'Klara, men försent');
  if (!doneLateTile) throw new Error('Förväntade en KPI-ruta märkt "Klara, men försent", fick: ' + JSON.stringify(kpiTiles));
  if (doneLateTile.value !== '1') throw new Error('Förväntade exakt 1 "klar men försent"-objekt (Balk 2), fick: ' + doneLateTile.value);
  console.log('OK: KPI-rutan "Klara, men försent" räknar bara objekt med ett ifyllt verkligt avslut efter planerat slutdatum');

  // ---- 2) CSV-export har "Verkligt avslut"-kolumnen med rätt värden.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btnExportExcel').click()
  ]);
  const downloadPath = await download.path();
  const csvContent = fs.readFileSync(downloadPath, 'utf-8');
  const lines = csvContent.trim().split('\n');
  const header = lines[0];
  if (!header.includes('Verkligt avslut')) throw new Error('CSV-headern saknar kolumnen "Verkligt avslut": ' + header);

  const row2 = lines.find(l => l.includes('Balk 2'));
  if (!row2 || !row2.includes('2026-01-15')) throw new Error('Raden för "Balk 2 (sent)" skulle innehålla verkligt avslut 2026-01-15: ' + row2);
  const row3 = lines.find(l => l.includes('Balk 3'));
  if (!row3) throw new Error('Hittade ingen rad för "Balk 3 (gammal data)"');
  const row3Cols = row3.split(';');
  if ((row3Cols[row3Cols.length - 1] || '').trim() !== '') {
    throw new Error('Raden för "Balk 3 (gammal data)" (utan verkligt avslut) skulle ha ett tomt sista fält, fick: ' + row3);
  }
  console.log('OK: CSV-exporten har en "Verkligt avslut"-kolumn med korrekta (och korrekt tomma) värden');

  await browser.close();
  server.close();

  console.log('Konsolfel:', consoleErrors);
  if (consoleErrors.length > 0) throw new Error('Konsolfel upptäcktes: ' + consoleErrors.join(' | '));
  console.log('OK: "Klara, men försent"-KPI:n och CSV-exportens "Verkligt avslut"-kolumn fungerar korrekt');
}

run().catch(e => { console.error(e); process.exit(1); });
