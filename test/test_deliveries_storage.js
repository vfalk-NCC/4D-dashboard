// Leveranser och upplag (Victor 2026-10-09): leveransplanen kopplas till upplag i lägesplanen och i 3D,
// med yta och ligger kvar t.o.m.; varningar när upplaget är fullt eller leveransen saknar upplag.
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
seed('plan_deliveries.json', [
  { id: 'd1', project_id: PID, description: 'Armering', planned_date: day(1), until_date: day(4), storage_id: 's1', space_m2: 12, status: 'planerad' },
  { id: 'd2', project_id: PID, description: 'Formvirke', planned_date: day(2), storage_id: 's1', space_m2: 10, status: 'planerad' },
  { id: 'd3', project_id: PID, description: 'Prefabtrappor', planned_date: day(3), status: 'planerad' },
  { id: 'd4', project_id: PID, description: 'Gammal', planned_date: day(-20), status: 'levererad' },
]);
seed('plan_items.json', [it('Schakt', 'Linje J', 'Mark', 0, 5)]);
seed('site_layers.json', [{ id: 's1', type: 'storage', name: 'Upplag Norr', cx: 0, cy: 0, w: 5, h: 4, rot: 0 }, { id: 'n1', type: 'note', pts: [[0, 0], [1, 1]] }]);
seed('plan_placements.json', [{ id: 'u', type: 'upplag', name: 'Upplag 3D', x: 0, y: 0, z: 0, L: 10, B: 5, H: 0.3 }, { id: 'c', type: 'container', name: 'Container 1', L: 6, B: 2, H: 2 }]);
['plan_item_activities.json', 'plan_milestones.json', 'plan_item_baseline_history.json'].forEach(f => seed(f, []));

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

  await page.evaluate(async () => { await fetchDeliveries(); renderDeliveries(); });
  const txt = () => page.innerText('#deliveriesList');
  let t = await txt();
  if (!t.includes('📦 Upplag Norr · 12 m²') || !t.includes('Upplaget fullt') || !t.includes('Saknar upplag')) fail('Upplag och varningar i listan: ' + t);
  if (process.env.SHOT) { await page.locator('#deliveriesList').scrollIntoViewIfNeeded(); await page.locator('#deliveriesList').screenshot({ path: process.env.SHOT }); }
  const sum = await page.innerText('#deliveriesList .delivery-warn-sum');
  if (!/1 leverans saknar upplag/.test(sum) || !/2 leveranser på fullt upplag/.test(sum)) fail('Summering: ' + sum);
  if ((await page.$$eval('#deliveriesList .delivery-row', rs => rs.filter(r => r.innerText.includes('Gammal') && r.innerText.includes('⚠')).length))) fail('Gamla leveranser varnas inte');
  // Valen: lägesplanens och 3D:s upplag (inte containern eller noteringen).
  const sopts = await page.$$eval('#newDeliveryStorage option', os => os.map(o => o.textContent));
  if (JSON.stringify(sopts) !== JSON.stringify(['– inget upplag –', 'Upplag Norr (20 m², lägesplanen)', 'Upplag 3D (50 m², 3D)'])) fail('Upplagen att välja: ' + JSON.stringify(sopts));
  // Ny leverans på 3D-upplaget.
  await page.fill('#newDeliveryDesc', 'Rör'); await page.fill('#newDeliveryDate', day(3));
  await page.selectOption('#newDeliveryStorage', 'place:u'); await page.fill('#newDeliveryM2', '7,5'); await page.fill('#newDeliveryUntil', day(5));
  await page.click('#btnAddDelivery'); await page.waitForTimeout(800);
  const r = get('plan_deliveries.json').find(d => d.description === 'Rör');
  if (!r || r.storage_id !== 'place:u' || r.space_m2 !== 7.5 || r.until_date !== day(5)) fail('Ny leverans: ' + JSON.stringify(r));
  // Redigera: trapporna på Upplag 3D -> varningen försvinner.
  await page.evaluate(() => { editingState.delivery = 'd3'; renderDeliveries(); });
  await page.selectOption('#deliveriesList .edit-storage', 'place:u'); await page.fill('#deliveriesList .edit-m2', '4');
  await page.click('#deliveriesList .row-save-btn'); await page.waitForTimeout(800);
  const d3 = get('plan_deliveries.json').find(d => d.id === 'd3');
  if (d3.storage_id !== 'place:u' || d3.space_m2 !== 4) fail('Redigerad: ' + JSON.stringify(d3));
  t = await txt();
  if (t.includes('Saknar upplag')) fail('Varningen ska försvinna: ' + t);
  // Utan upplagsfält: leveranser utan koppling sparas utan nya fält.
  await page.fill('#newDeliveryDesc', 'Spik'); await page.fill('#newDeliveryDate', day(3)); await page.click('#btnAddDelivery'); await page.waitForTimeout(800);
  const sp = get('plan_deliveries.json').find(d => d.description === 'Spik');
  if ('storage_id' in sp || 'space_m2' in sp || 'until_date' in sp) fail('Tomma fält ska inte sparas: ' + JSON.stringify(sp));
  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('OK test_deliveries_storage');
  await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
