// Markering i modellen → Gantt-schemat (Victor 2026-10-06).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8982;
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
  it('Grovbetong', 'Linje E', 'Betong', 1, 9, { model_id: 'm1', object_id: 'ext101', group_id: 'g' }),
  it('Grovbetong', 'Linje E', 'Betong', 1, 9, { model_id: 'm1', object_id: 'ext102', group_id: 'g' }),
  it('Montage', 'Linje K', 'Stomme', 3, 6, { model_id: 'm1', object_id: 'ext200' }),
  it('Långt fram', 'Linje K', 'Mark', 60, 64, { model_id: 'm1', object_id: 'ext300' }),
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
    window.__sel = []; window.__calls = [];
    window.TrimbleConnectWorkspace = { connect: (t, cb) => { window.__cb = cb; return Promise.resolve({
      project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) },
      viewer: { getSelection: () => Promise.resolve(window.__sel), convertToObjectIds: (m, rids) => Promise.resolve(rids.map(x => 'ext' + x)),
        convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids), getObjectProperties: () => Promise.resolve([]),
        setSelection: (s) => { window.__calls.push(['sel', s]); return Promise.resolve(); }, setCamera: (c) => { window.__calls.push(['cam', c]); return Promise.resolve(); } }
    }); } };` }));
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
  await page.click('[data-gantt-view="board"]');
  await page.click('[data-gantt-weeks="4"]');
  await page.waitForTimeout(200);
  const fire = async sel => { await page.evaluate(s => { window.__sel = s; window.__cb('viewer.onSelectionChanged', s); }, sel); await page.waitForTimeout(500); };
  const marked = () => page.evaluate(() => [...document.querySelectorAll('#ganttChart .model-sel')].map(n => n.dataset.itemId));
  // Ett objekt i Grovbetong markeras i modellen → lappen får ram och pulserar.
  await fire([{ modelId: 'm1', objectRuntimeIds: [102] }]);
  let m = await marked();
  if (JSON.stringify(m) !== '["i1"]' || !(await page.evaluate(() => document.querySelector('.pnote.model-sel').classList.contains('model-sel-pulse')))) fail('Markering från modellen: ' + JSON.stringify(m));
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'board_model_sel.png') });
  // Ramen ligger kvar när schemat ritas om.
  await page.click('[data-gantt-weeks="4"]'); await page.waitForTimeout(250);
  if (JSON.stringify(await marked()) !== '["i1"]') fail('Ramen ska ligga kvar efter omritning');
  // Två aktiviteter.
  await fire([{ modelId: 'm1', objectRuntimeIds: [101, 200] }]);
  m = await marked();
  if (m.length !== 2 || !/2 aktiviteter markerade/.test(await page.innerText('#modelToast'))) fail('Två aktiviteter: ' + JSON.stringify(m));
  // Okopplat objekt.
  await fire([{ modelId: 'm1', objectRuntimeIds: [999] }]);
  if ((await marked()).length || !/inte kopplat/.test(await page.innerText('#modelToast'))) fail('Okopplat objekt');
  // Utanför perioden → "Visa" hoppar dit.
  await fire([{ modelId: 'm1', objectRuntimeIds: [300] }]);
  if (!/utanför vald period/.test(await page.innerText('#modelToast'))) fail('Utanför perioden ska sägas till: ' + await page.innerText('#modelToast'));
  await page.click('#modelToast button'); await page.waitForTimeout(500);
  if (JSON.stringify(await marked()) !== '["i4"]') fail('Visa ska hoppa till aktiviteten');
  // Avmarkera i modellen → ramen bort.
  await fire([]);
  if ((await marked()).length) fail('Avmarkerat i modellen ska ta bort ramen');
  // Egen markering (klick på en lapp) studsar inte tillbaka.
  await page.click('[data-gantt-weeks="4"]'); await page.waitForTimeout(250);
  await page.click('#ganttChart .pnote[data-item-id="i3"] .pnote-title'); await page.waitForTimeout(100);
  await fire([{ modelId: 'm1', objectRuntimeIds: [200] }]);
  if ((await marked()).length) fail('Dashboardens egen markering ska inte studsa tillbaka');
  // Hopfällt område fälls ut.
  await page.waitForTimeout(1500);
  await page.selectOption('#ganttGroupBy', 'area'); await page.waitForTimeout(250);
  await page.click('.board-lane-head[data-group-key="area:Linje E"]'); await page.waitForTimeout(250);
  await fire([{ modelId: 'm1', objectRuntimeIds: [101] }]);
  if (JSON.stringify(await marked()) !== '["i1"]') fail('Hopfällt område ska fällas ut');
  // Gantt-panelen hopfälld → ingen reaktion.
  await fire([]);
  await page.click('section[data-panel-id="gantt"] .panel-collapse-btn'); await page.waitForTimeout(200);
  await fire([{ modelId: 'm1', objectRuntimeIds: [101] }]);
  if (await page.evaluate(() => ganttModelSel.size)) fail('Hopfälld Gantt-panel ska inte reagera');
  console.log('OK: markering i modellen → aktiviteten ramas in och pulserar, flera, okopplad, utanför perioden (Visa), avmarkering, ingen studs, utfällning, bara när schemat syns');
  if (errors.length) fail('Fel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
