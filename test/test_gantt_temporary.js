// Temporär (Victor 2026-10-09, t.ex. en mobilkran): streckad stapel med borttagningsmarkering i Gantt,
// kryssruta i aktivitetsdialogen (redigera och ny).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8983;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const PID = 'test-project';
const store = new Map(); let n = 0;
const seed = (f, c) => store.set(`projects/${PID}/${f}`, { content: JSON.stringify(c), sha: 's' + (++n) });
const get = f => JSON.parse(store.get(`projects/${PID}/${f}`).content);
const iso = d => d.toISOString().slice(0, 10);
const day = k => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + k); return iso(d); };
const base = { project_id: PID, model_id: null, actual_start_date: null, actual_end_date: null, estimated_hours: null, updated_at: '2026-01-01T00:00:00Z', depends_on: [] };
let k = 0;
const it = (name, area, activity, s, e, extra = {}) => ({ ...base, id: 'i' + (++k), object_id: 'x' + k, object_name: name, area, activity, contractor: 'NCC', start_date: day(s), end_date: day(e), status: 'planerad', progress: 0, ...extra });
seed('plan_items.json', [
  it('Mobilkran', 'Linje J', 'Lyft', 0, 5, { temporary: true }),            // i1
  it('Gjutning', 'Linje J', 'Betong', 2, 6),                                // i2
]);
['plan_item_activities.json', 'plan_milestones.json', 'plan_deliveries.json', 'plan_item_baseline_history.json'].forEach(f => seed(f, []));

(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data);
  })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `
    window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({
      project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) },
      viewer: { getSelection: () => Promise.resolve([]), convertToObjectIds: () => Promise.resolve([]), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids), getObjectProperties: () => Promise.resolve([]), setSelection: () => Promise.resolve() }
    }) };` }));
  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', r => {
    const req = r.request(), f = decodeURIComponent(new URL(req.url()).pathname.replace('/repos/vfalk-NCC/4D-data/contents/', ''));
    const e = store.get(f);
    if (req.method() === 'GET') return e ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(e.content).toString('base64'), sha: e.sha }) }) : r.fulfill({ status: 404, body: '{}' });
    if (req.method() === 'PUT') {
      const b = JSON.parse(req.postData() || '{}');
      if (e && e.sha !== b.sha) return r.fulfill({ status: 409, body: '{}' });
      const sha = 's' + (++n); store.set(f, { content: Buffer.from(b.content, 'base64').toString('utf8'), sha });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha } }) });
    }
    r.fulfill({ status: 405, body: '' });
  });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const fail = m => { throw new Error(m); };
  const row = id => get('plan_items.json').find(r => r.id === id);
  const opts = () => page.evaluate(() => { const l = [...document.querySelectorAll('.new-act-pop .cb-list')].find(x => !x.hidden); return l ? [...l.querySelectorAll('.cb-opt')].map(o => o.querySelector('.cb-l').textContent + (o.querySelector('.cb-n') ? ' | ' + o.querySelector('.cb-n').textContent : '')) : null; });

  // 1. Gantt-staplarna: den temporära är streckad, har ⏱ och en markering där den tas bort.
  await page.click('[data-gantt-view="bars"]'); await page.waitForTimeout(300);
  const bar = id => page.locator(`#ganttChart .gantt-bar[data-item-id="${id}"]`);
  if (!(await bar('i1').getAttribute('class')).includes('gantt-bar-temp')) fail('Mobilkranen ska ha streckad stapel');
  if ((await bar('i2').getAttribute('class')).includes('gantt-bar-temp')) fail('Gjutningen är inte temporär');
  if (await page.locator('#ganttChart .gantt-temp-end').count() !== 1 || await page.locator('#ganttChart .gantt-temp-badge').count() !== 1) fail('En borttagningsmarkering och ett ⏱');
  const style = await bar('i1').evaluate(e => getComputedStyle(e).borderStyle);
  if (!style.includes('dashed')) fail('Streckad kant: ' + style);
  if (process.env.SHOT) { const bb = await page.locator('#ganttChart').boundingBox(); await page.screenshot({ path: process.env.SHOT, clip: { x: bb.x, y: bb.y, width: Math.min(bb.width, 1000), height: Math.min(bb.height, 260) } }); }
  console.log('OK: temporär stapel i Gantt');

  // 2. Redigera: kryssruta, sparas bara när den ändras.
  await page.click('[data-gantt-view="board"]'); await page.click('[data-gantt-weeks="4"]');
  await page.check('#ganttEditable'); await page.waitForTimeout(300);
  await page.dblclick('#ganttChart .pnote[data-item-id="i2"] .pnote-title'); await page.waitForTimeout(200);
  if (await page.isChecked('.na-temp-chk')) fail('Gjutningen ska inte vara ikryssad');
  await page.check('.na-temp-chk'); await page.click('.na-save'); await page.waitForTimeout(900);
  if (row('i2').temporary !== true) fail('Temporär ska sparas: ' + JSON.stringify(row('i2')));
  await page.dblclick('#ganttChart .pnote[data-item-id="i1"] .pnote-title'); await page.waitForTimeout(200);
  if (!(await page.isChecked('.na-temp-chk'))) fail('Mobilkranen ska vara ikryssad');
  await page.fill('.na-name', 'Mobilkran 60 t'); await page.click('.na-save'); await page.waitForTimeout(900);
  if (row('i1').temporary !== true || row('i1').object_name !== 'Mobilkran 60 t') fail('Annan ändring ska inte röra Temporär: ' + JSON.stringify(row('i1')));
  await page.dblclick('#ganttChart .pnote[data-item-id="i1"] .pnote-title'); await page.waitForTimeout(200);
  await page.uncheck('.na-temp-chk'); await page.click('.na-save'); await page.waitForTimeout(900);
  if (row('i1').temporary !== false) fail('Urkryssad ska sparas som false');
  console.log('OK: Temporär i redigeringsdialogen');

  // 3. Ny aktivitet som temporär.
  await page.click('#ganttAddBtn'); await page.waitForTimeout(150);
  await page.fill('.na-name', 'Stämp'); await page.check('.na-temp-chk');
  await page.click('.na-save'); await page.waitForTimeout(900);
  const st = get('plan_items.json').find(r => r.object_name === 'Stämp');
  if (!st || st.temporary !== true) fail('Ny temporär aktivitet: ' + JSON.stringify(st));
  console.log('OK: ny temporär aktivitet');

  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('OK test_gantt_temporary');
  await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
