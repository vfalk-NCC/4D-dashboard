// Funktionstest för två nya funktioner i 4D-dashboard (Victors förfrågan
// 2026-09-17):
//  1) Kalenderexport (.ics) av milstolpar och leveransplan - nedladdad
//     fil, ingen delningslänk. Verifierar korrekt DTSTART/DTEND (heldags-
//     händelser, DTEND = dagen efter) och SUMMARY.
//  2) Cykeltidsanalys - jämför planerad mot verklig varaktighet per
//     aktivitet för klarmarkerade objekt, ignorerar objekt utan ifyllt
//     verkligt avslut (gammal data) och objekt som inte är klara.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8958;
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

// Gjutning: en i tid (planerat 10d, verkligt 10d) + en 5 dagar sen
// (planerat 10d, verkligt 15d) -> snittavvikelse +2.5d.
// Formning: en 2 dagar TIDIG (planerat 5d, verkligt 3d) -> snittavvikelse -2d.
// Plus två objekt som INTE ska räknas med: ett pågående (inget verkligt
// avslut) och ett klarmarkerat men utan ifyllt verkligt avslut (gammal data).
const seedItems = [
  { id: 'i1', project_id: PROJECT_ID, object_id: 'ext-1', object_name: 'Gjutning i tid', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'klar', start_date: '2026-01-01', end_date: '2026-01-11', actual_end_date: '2026-01-11', progress: 100, updated_at: '2026-01-11T00:00:00Z' },
  { id: 'i2', project_id: PROJECT_ID, object_id: 'ext-2', object_name: 'Gjutning sen', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'klar', start_date: '2026-01-01', end_date: '2026-01-11', actual_end_date: '2026-01-16', progress: 100, updated_at: '2026-01-16T00:00:00Z' },
  { id: 'i3', project_id: PROJECT_ID, object_id: 'ext-3', object_name: 'Formning tidig', area: 'Hus B', activity: 'Formning', contractor: 'Peab', status: 'klar', start_date: '2026-02-01', end_date: '2026-02-06', actual_end_date: '2026-02-04', progress: 100, updated_at: '2026-02-04T00:00:00Z' },
  { id: 'i4', project_id: PROJECT_ID, object_id: 'ext-4', object_name: 'Gjutning pågående', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'pagaende', start_date: '2026-03-01', end_date: '2026-03-11', actual_end_date: null, progress: 50, updated_at: '2026-03-05T00:00:00Z' },
  { id: 'i5', project_id: PROJECT_ID, object_id: 'ext-5', object_name: 'Formning gammal data', area: 'Hus B', activity: 'Formning', contractor: 'Peab', status: 'klar', start_date: '2026-01-01', end_date: '2026-01-06', actual_end_date: null, progress: 100, updated_at: '2026-01-06T00:00:00Z' }
];
seedJson(`projects/${PROJECT_ID}/plan_items.json`, seedItems);

const seedMilestones = [
  { id: 'm1', project_id: PROJECT_ID, name: 'Stomresning klar', target_date: '2026-03-10', is_done: false, completed_date: null }
];
seedJson(`projects/${PROJECT_ID}/plan_milestones.json`, seedMilestones);

const seedDeliveries = [
  { id: 'd1', project_id: PROJECT_ID, description: 'Betong leverans', supplier: 'Betongbolaget', contractor: 'NCC', area: 'Hus A', planned_date: '2026-03-05', actual_date: null, status: 'planerad' }
];
seedJson(`projects/${PROJECT_ID}/plan_deliveries.json`, seedDeliveries);

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 480, height: 2200 }, acceptDownloads: true });

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

  // Väderpanelen anropar Open-Meteo direkt - inte relevant för det här
  // testet, men får inte generera oväntade konsolfel. Svarar med ett tomt
  // men giltigt (nog) svar.
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ current_weather: {}, daily: {} })
  }));

  await page.addInitScript(() => {
    window.localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 'fake-token-for-test' }));
    window.localStorage.setItem('4ddash-unlocked', '1');
  });

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // ---- 1) Cykeltidsanalys.
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cycle-time-row')).map(r => ({
      label: r.querySelector('.cycle-time-label')?.textContent.trim(),
      values: Array.from(r.querySelectorAll('.cycle-time-bar-value')).map(v => v.textContent.trim()),
      meta: r.querySelector('.cycle-time-meta')?.textContent.trim()
    })));

  if (rows.length !== 2) throw new Error('Förväntade 2 rader i cykeltidsanalysen (Gjutning + Formning), fick: ' + JSON.stringify(rows));
  const [first, second] = rows;
  if (first.label !== 'Gjutning') throw new Error('Gjutning (störst avvikelse, +2.5d) skulle ligga överst, fick ordning: ' + JSON.stringify(rows));
  if (first.values[0] !== '10 d' || first.values[1] !== '12.5 d') throw new Error('Gjutning: förväntade planerat 10d/verkligt 12.5d, fick: ' + JSON.stringify(first.values));
  if (!/^\+2\.5 d/.test(first.meta) || !/2 obj/.test(first.meta)) throw new Error('Gjutning: förväntade avvikelse "+2.5 d" och "2 obj" i meta, fick: ' + first.meta);

  if (second.label !== 'Formning') throw new Error('Formning skulle vara den andra raden, fick: ' + JSON.stringify(rows));
  if (second.values[0] !== '5 d' || second.values[1] !== '3 d') throw new Error('Formning: förväntade planerat 5d/verkligt 3d, fick: ' + JSON.stringify(second.values));
  if (!/^-2 d/.test(second.meta) || !/1 obj/.test(second.meta)) throw new Error('Formning: förväntade avvikelse "-2 d" och "1 obj" i meta (bara det tidiga objektet, inte det utan verkligt avslut), fick: ' + second.meta);
  console.log('OK: Cykeltidsanalysen räknar rätt planerad/verklig snittvaraktighet per aktivitet, ignorerar objekt utan verkligt avslut eller som inte är klara, och sorterar störst avvikelse överst');

  // ---- 2) Kalenderexport (.ics).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btnExportIcs').click()
  ]);
  const icsPath = await download.path();
  const ics = fs.readFileSync(icsPath, 'utf-8');

  if (!ics.startsWith('BEGIN:VCALENDAR')) throw new Error('.ics-filen ska börja med BEGIN:VCALENDAR: ' + ics.slice(0, 60));
  if (!/SUMMARY:Milstolpe: Stomresning klar/.test(ics)) throw new Error('.ics-filen saknar milstolpens SUMMARY: ' + ics);
  if (!/DTSTART;VALUE=DATE:20260310/.test(ics)) throw new Error('.ics-filen har fel DTSTART för milstolpen (förväntade 20260310): ' + ics);
  if (!/DTEND;VALUE=DATE:20260311/.test(ics)) throw new Error('.ics-filen har fel DTEND för milstolpen (förväntade dagen efter, 20260311): ' + ics);
  if (!/SUMMARY:Leverans: Betong leverans/.test(ics)) throw new Error('.ics-filen saknar leveransens SUMMARY: ' + ics);
  if (!/DTSTART;VALUE=DATE:20260305/.test(ics)) throw new Error('.ics-filen har fel DTSTART för leveransen (förväntade 20260305): ' + ics);
  if (!/DTEND;VALUE=DATE:20260306/.test(ics)) throw new Error('.ics-filen har fel DTEND för leveransen (förväntade dagen efter, 20260306): ' + ics);
  if (!ics.trim().endsWith('END:VCALENDAR')) throw new Error('.ics-filen ska sluta med END:VCALENDAR: ' + ics.slice(-60));
  console.log('OK: Kalenderexporten (.ics) innehåller milstolpen och leveransen som heldagshändelser med korrekt DTSTART/DTEND (DTEND = dagen efter, enligt iCalendar-spec)');

  await browser.close();
  server.close();

  console.log('Konsolfel:', consoleErrors);
  if (consoleErrors.length > 0) throw new Error('Konsolfel upptäcktes: ' + consoleErrors.join(' | '));
  console.log('OK: Cykeltidsanalysen och kalenderexporten (.ics) fungerar korrekt');
}

run().catch(e => { console.error(e); process.exit(1); });
