// En egen aktivitet kan följa en Powerproject-aktivitet: datumen läggs om vid hämtning (även efter ny import) och sparas.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs'), PORT = 8996, PID = 'test-project';
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const store = new Map(); let n = 0;
const seed = (f, c) => store.set(`projects/${PID}/${f}`, { content: JSON.stringify(c), sha: 's' + (++n) });
const get = f => JSON.parse(store.get(`projects/${PID}/${f}`).content);
const base = { project_id: PID, model_id: null, actual_start_date: null, actual_end_date: null, estimated_hours: null, updated_at: '2026-01-01T00:00:00Z', depends_on: [], status: 'planerad', progress: 0, contractor: 'NCC', area: 'PRODUKTION / 743 Krosshall', activity: '743 Krosshall' };
seed('plan_items.json', [
  { ...base, id: 'P1', object_id: 'pp-1', object_name: 'Gjutning platta', start_date: '2026-11-10', end_date: '2026-11-20', source_key: 'PP x||1', origin: 'powerproject' },
  { ...base, id: 'M1', object_id: 'manual-M1', object_name: 'Mobilkran', start_date: '2026-11-01', end_date: '2026-11-03', origin: 'manuell', temporary: true, follows: { id: 'P1', key: 'PP x||1', mode: 'span', d0: -1, d1: 2 } },
  { ...base, id: 'M2', object_id: 'manual-M2', object_name: 'Pumpbil', start_date: '2026-11-01', end_date: '2026-11-04', origin: 'manuell', follows: { id: 'GONE', key: 'PP x||1', mode: 'start', d0: 0, d1: 0 } },
]);
['plan_item_activities.json', 'plan_milestones.json', 'plan_deliveries.json', 'plan_item_baseline_history.json'].forEach(f => seed(f, []));
(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data); })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({ project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) } }) };` }));
  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', r => {
    const req = r.request(), f = decodeURIComponent(new URL(req.url()).pathname.replace('/repos/vfalk-NCC/4D-data/contents/', '')), e = store.get(f);
    if (req.method() === 'GET') return r.fulfill(e ? { status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(e.content).toString('base64'), sha: e.sha }) } : { status: 404, body: '{}' });
    if (req.method() === 'PUT') { const b = JSON.parse(req.postData() || '{}'); if (e && e.sha !== b.sha) return r.fulfill({ status: 409, body: '{}' }); const sha = 's' + (++n); store.set(f, { content: Buffer.from(b.content, 'base64').toString('utf8'), sha }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha } }) }); }
    r.fulfill({ status: 405, body: '' });
  });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); localStorage.setItem('4ddash-test-modelctl', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  const fail = m => { throw new Error(m); };
  const row = id => get('plan_items.json').find(r => r.id === id);
  let m1 = row('M1');
  if (m1.start_date !== '2026-11-09' || m1.end_date !== '2026-11-22') fail('Kranen ska följa perioden (−1 d / +2 d): ' + m1.start_date + ' – ' + m1.end_date);
  const m2 = row('M2'); if (m2.start_date !== '2026-11-10' || m2.end_date !== '2026-11-13') fail('Följer via source_key när id saknas (samma start, behåll längd): ' + m2.start_date + ' – ' + m2.end_date);
  console.log('OK: aktiviteter som följer en annan får dess datum vid hämtning och sparas');
  // Ny import: Powerproject-aktiviteten flyttas (samma id) – kranen följer med vid nästa hämtning
  const cur = get('plan_items.json'); cur.find(r => r.id === 'P1').start_date = '2026-12-01'; cur.find(r => r.id === 'P1').end_date = '2026-12-05'; seed('plan_items.json', cur);
  await page.evaluate(() => refreshAll()); await page.waitForTimeout(1200);
  m1 = row('M1'); if (m1.start_date !== '2026-11-30' || m1.end_date !== '2026-12-07') fail('Kranen ska följa med efter ny import: ' + m1.start_date + ' – ' + m1.end_date);
  console.log('OK: kranen följer med när aktiviteten flyttas av en ny import');
  // Filter: bara egna aktiviteter
  await page.click('#ganttOwnBtn'); await page.waitForTimeout(400);
  const own = await page.evaluate(() => ({ names: ganttShownItems.map(x => x.objectName).sort().join('|'), n: document.getElementById('ganttOwnN').textContent, p: document.getElementById('ganttOwnBtn').getAttribute('aria-pressed') }));
  if (own.names !== 'Mobilkran|Pumpbil' || own.n !== '(2)' || own.p !== 'true') fail('Egna-filtret ska visa bara egna aktiviteter: ' + JSON.stringify(own));
  await page.click('#ganttOwnBtn'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => ganttShownItems.length)) !== 3) fail('Av: alla visas igen');
  console.log('OK: filtret Egna visar bara egna aktiviteter');
  // Dialogen: välj aktivitet att följa
  await page.evaluate(() => { ganttEditable = true; openActivityDialog({ edit: items.find(x => x.id === 'M1') }); }); await page.waitForTimeout(200);
  if (!(await page.locator('.na-follow .nf-row').count())) fail('Dialogen ska visa vilken aktivitet som följs');
  await page.selectOption('.nf-mode', 'start'); await page.waitForTimeout(100);
  const st = await page.inputValue('.na-start'); if (st !== '2026-11-30') fail('Samma start − 1 d ska ge 2026-11-30: ' + st);
  await page.click('.nf-x'); await page.waitForTimeout(100); if (await page.locator('.nf-row').count()) fail('Sluta följa tar bort länken');
  await page.click('.na-cancel');
  if (errors.length) fail('sidfel: ' + errors.slice(0, 3));
  console.log('ALLA TESTER OK'); await browser.close(); server.close();
})().catch(e => { console.error('FEL: ' + e.message); process.exit(1); });
