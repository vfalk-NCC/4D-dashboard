// Kopiera aktivitet (Victor 2026-10-15): Högerklick på en lapp → Kopiera aktiviteten… ger en förifylld ny aktivitet.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8973;
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
  it('Fundament J', 'PRODUKTION / 742A Krönlinje J', 'Fundament', -3, 6, { model_id: 'M1', object_id: 'o1', progress: 45 }),
  it('Kontrafor M12', 'PRODUKTION / 7421 Förtjockardel', 'Kontrafor', -2, 8, { model_id: 'M1', object_id: 'o2', progress: 50 }),
  it('Stödmur', 'PRODUKTION / 742C Stödmur', 'Stödmur', -4, 12, { model_id: 'M1', object_id: 'o3', progress: 16 }),
  it('Grovbetong gavel', 'PRODUKTION / 742C Stödmur', 'Gavel', -1, 4, { model_id: 'M1', object_id: 'o4', progress: 80 }),
  it('Okopplad aktivitet', 'PRODUKTION / 742C Stödmur', 'Okopplat', 2, 6, { model_id: null, object_id: null }),
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
      viewer: { getSelection: () => Promise.resolve([]), convertToObjectIds: () => Promise.resolve([]), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids.map((x, i) => i + 1)), getObjectProperties: () => Promise.resolve([]),
        getCamera: () => Promise.resolve(window.__cam || { position: { x: 0, y: -40, z: 20 }, target: { x: 0, y: 0, z: 0 }, fov: 60 }),
        getObjectBoundingBoxes: (m, rids) => Promise.resolve(rids.map(id => ({ id, boundingBox: { min: { x: -20 + id * 10, y: -2, z: 0 }, max: { x: -15 + id * 10, y: 2, z: 3 } } }))),
        getSnapshot: () => { const c = document.createElement('canvas'); c.width = 1200; c.height = 700; const x = c.getContext('2d'); x.fillStyle = '#e9edf0'; x.fillRect(0, 0, 1200, 700); x.fillStyle = '#6fbf73'; x.fillRect(300, 350, 600, 200); return Promise.resolve(c.toDataURL('image/png')); },
        setSelection: () => Promise.resolve(), setCamera: () => Promise.resolve() },
      markup: { removeMarkups: () => Promise.resolve() }
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
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); localStorage.setItem('4ddash-test-modelctl', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const fail = m => { throw new Error(m); };
  await page.click('[data-gantt-view="board"]'); await page.waitForTimeout(500);
  await page.evaluate(() => { const cb = document.getElementById('ganttEditable'); cb.checked = true; cb.dispatchEvent(new Event('change')); }); await page.waitForTimeout(500);
  const note = page.locator('.pnote', { hasText: 'Kontrafor M12' }).first();
  await note.click({ button: 'right' }); await page.waitForSelector('.board-dep-menu [data-copy]');
  await page.click('.board-dep-menu [data-copy]'); await page.waitForSelector('.new-act-pop');
  const f = await page.evaluate(() => ({ title: document.querySelector('.new-act-pop .board-pop-title').textContent, name: document.querySelector('.na-name').value, area: document.querySelector('.na-area').value, contr: document.querySelector('.na-contr').value, start: document.querySelector('.na-start').value, end: document.querySelector('.na-end').value, prog: document.querySelector('.na-prog') && document.querySelector('.na-prog').value, btn: document.querySelector('.na-save').textContent, preds: document.querySelector('.na-preds').textContent.trim(), objs: !!document.querySelector('.na-objs') }));
  console.log(JSON.stringify(f));
  if (!/Kopiera/.test(f.title) || f.name !== 'Kontrafor M12 (kopia)' || f.btn !== 'Skapa kopian' || f.contr !== 'NCC' || !/^Ingen/.test(f.preds) || f.objs) fail('Förifylld kopia: ' + JSON.stringify(f));
  const before = (await page.evaluate(() => items.length));
  await page.click('.na-save'); await page.waitForTimeout(1500);
  const rows = JSON.parse(store.get(`projects/${PID}/plan_items.json`).content);
  const copy = rows.find(r => r.object_name === 'Kontrafor M12 (kopia)');
  if (!copy || rows.length !== before + 1) fail('Kopian ska sparas som en ny rad: ' + rows.length + ' / ' + before);
  if (copy.model_id || copy.object_id && /^o2$/.test(copy.object_id)) fail('Kopian ska inte vara kopplad till originalets 3D-objekt: ' + JSON.stringify(copy));
  const orig = rows.find(r => r.object_name === 'Kontrafor M12'); if (!orig || copy.start_date !== orig.start_date || copy.end_date !== orig.end_date) fail('Samma datum');
  // Filter: bara aktiviteter som inte är kopplade i modellen; knapparna sitter vid pennan i färgförklaringen.
  await page.locator('.gantt-legend-row').screenshot({ path: (process.env.PHB_OUT || '/tmp') + '/legend.png' });
  const pos = await page.evaluate(() => { const p = document.querySelector('#ganttLegend .gl-edit'), b = document.getElementById('ganttUncoupledBtn'), a = document.getElementById('ganttAddBtn'); const r = x => x.getBoundingClientRect(); return { pencil: !!p, sameRow: p && Math.abs(r(p).top - r(a).top) < 14, after: p && r(a).left > r(p).left, inLegend: !!document.querySelector('#ganttLegend #ganttLegendActions'), n: document.getElementById('ganttUncoupledN').textContent, b: !!b }; });
  if (!pos.pencil || !pos.inLegend || !pos.sameRow || !pos.after || !pos.n) fail('Knapparna ska ligga efter pennan i färgförklaringen: ' + JSON.stringify(pos));
  await page.click('#ganttUncoupledBtn'); await page.waitForTimeout(500);
  const sh = await page.evaluate(() => ({ n: ganttShownItems.length, names: ganttShownItems.map(x => x.objectName).sort().join('|'), pressed: document.getElementById('ganttUncoupledBtn').getAttribute('aria-pressed') }));
  if (sh.n !== 2 || sh.names !== 'Kontrafor M12 (kopia)|Okopplad aktivitet' || sh.pressed !== 'true') fail('Bara okopplade aktiviteter ska visas: ' + JSON.stringify(sh));
  await page.click('#ganttUncoupledBtn'); await page.waitForTimeout(400);
  if ((await page.evaluate(() => ganttShownItems.length)) < 4) fail('Filtret av ska visa alla igen');
  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK'); await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
