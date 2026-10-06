// Växeln Excel/Powerproject i 4D-dashboard (Victors önskemål 2026-10-06): samma två planeringar
// som i 4D-planering – Excel i projects/<id>/, Powerproject i projects/<id>/pp/. Bara planeringens
// tabeller byts; milstolpar m.m. är gemensamma. Valet sparas.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8975;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const PID = 'test-project';
const store = new Map();
const seed = (f, c) => store.set(`projects/${PID}/${f}`, { content: JSON.stringify(c), sha: 's' + store.size });
const base = { project_id: PID, model_id: null, actual_start_date: null, actual_end_date: null, estimated_hours: null, updated_at: '2026-01-01T00:00:00Z', depends_on: [], status: 'planerad', progress: 0, contractor: 'NCC' };
seed('plan_items.json', [{ ...base, id: 'e1', object_id: 'x1', object_name: 'Excel A', area: 'Hus A', activity: 'Gjutning', start_date: '2026-10-01', end_date: '2026-10-10' }]);
seed('pp/plan_items.json', [
  { ...base, id: 'p1', object_id: 'y1', object_name: 'Montage stomme', area: 'PRODUKTION / 743 Krosshall', activity: '743 Krosshall', start_date: '2026-10-05', end_date: '2026-10-20' },
  { ...base, id: 'p2', object_id: 'y2', object_name: 'Tätt hus', area: 'PRODUKTION / 743 Krosshall', activity: 'Milstolpe', start_date: '2026-11-10', end_date: '2026-11-10', depends_on: ['p1'] }]);
['plan_item_activities.json', 'plan_deliveries.json'].forEach(f => seed(f, []));
seed('plan_milestones.json', [{ id: 'm1', project_id: PID, name: 'Gemensam milstolpe', target_date: '2026-12-01', done: false }]);

(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data);
  })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `
    window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({
      project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) },
      viewer: { getSelection: () => Promise.resolve([]), convertToObjectIds: () => Promise.resolve([]), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids), getObjectProperties: () => Promise.resolve([]), setSelection: () => Promise.resolve() }
    }) };` }));
  const reads = [];
  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', r => {
    const f = decodeURIComponent(new URL(r.request().url()).pathname.replace('/repos/vfalk-NCC/4D-data/contents/', ''));
    reads.push(f);
    const e = store.get(f);
    return e ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(e.content).toString('base64'), sha: e.sha }) }) : r.fulfill({ status: 404, body: '{}' });
  });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const fail = m => { throw new Error(m); };
  const state = () => page.evaluate(() => ({ src: planSource, active: document.querySelector('#planSourceBar .active').dataset.src, names: items.map(i => i.objectName).sort(), ms: (typeof milestones !== 'undefined' ? milestones : []).length }));
  const a = await state();
  if (a.src !== 'excel' || a.active !== 'excel' || JSON.stringify(a.names) !== '["Excel A"]') fail('Excel från början: ' + JSON.stringify(a));
  await page.selectOption('#filterArea', 'Hus A');
  reads.length = 0;
  await page.click('#planSourceBar [data-src="pp"]'); await page.waitForTimeout(600);
  const b = await state();
  if (b.src !== 'pp' || JSON.stringify(b.names) !== '["Montage stomme","Tätt hus"]' || b.ms !== 1) fail('Powerproject-planeringen (milstolparna gemensamma): ' + JSON.stringify(b));
  if (!reads.includes(`projects/${PID}/pp/plan_items.json`) || reads.includes(`projects/${PID}/pp/plan_milestones.json`)) fail('Bara planeringens tabeller ska läsas från pp/: ' + JSON.stringify(reads));
  if ((await page.inputValue('#filterArea')) !== '') fail('Filtret ska nollställas vid byte');
  if (!(await page.textContent('#ganttChart')).includes('Montage stomme')) fail('Gantt-schemat ska visa Powerproject-aktiviteterna');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  if ((await state()).src !== 'pp') fail('Valet ska sparas');
  await page.click('#planSourceBar [data-src="excel"]'); await page.waitForTimeout(600);
  if (JSON.stringify((await state()).names) !== '["Excel A"]') fail('Tillbaka till Excel');
  console.log('OK: växeln Excel/Powerproject – planeringens tabeller från pp/, gemensamma milstolpar, filter nollställs, valet sparas');
  if (errors.length) fail('Fel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
