// Visa endast kopplade (Gantt-schemat): isolerar i 3D-modellen bara objekten som är kopplade till aktiviteterna som visas
// (Victor 2026-10-13); följer sökning/filter; ett tryck till visar hela modellen igen.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8988;
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
  it('Gjutning', 'Linje J', 'Betong', 0, 5, { source_key: 'pp:1', origin: 'powerproject' }),            // i1 – okopplad
  it('Schakt', 'Linje K', 'Mark', 6, 9, { model_id: 'M1', object_id: 'G5' }),                           // i2 – kopplad
  it('Armering', 'Linje K', 'Betong', 3, 8, { model_id: 'M1', object_id: 'G7', progress: 20 }),                       // i3 – kopplad
  it('Saknas', 'Linje K', 'Betong', 3, 8, { model_id: 'M1', object_id: 'BADOBJ' }),                      // i4b – objekt som saknas i modellversionen
  it('Pelare A', 'Linje Z', 'Pelare', 4, 6, { group_id: 'g1', source_key: 'pp:g1', origin: 'powerproject' }),
  it('Pelare B', 'Linje Z', 'Pelare', 4, 6, { group_id: 'g1', source_key: 'pp:g1', origin: 'powerproject' }),
  it('Gammal', 'Linje K', 'Betong', 3, 8, { model_id: 'BAD', object_id: 'G9' }),                        // i4 – modell som inte är inläst
]);
seed('plan_item_activities.json', [{ id: 'a1', plan_item_id: 'i1', name: 'Form', start_date: day(0), end_date: day(2) }]);
['plan_milestones.json', 'plan_deliveries.json', 'plan_item_baseline_history.json'].forEach(f => seed(f, []));

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
  await page.context().route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `
    window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({
      markup: { addTextMarkup: m => { (window.__mk = window.__mk || []).push(m); return Promise.resolve(m.map((x, i) => ({ id: 100 + i + (window.__mk.length * 10) }))); }, addArrowMarkup: m => { (window.__ar = window.__ar || []).push(m); return Promise.resolve(m.map((x, i) => ({ id: 500 + i }))); }, removeMarkups: ids => { (window.__mkRm = window.__mkRm || []).push(ids); return Promise.resolve(); } },
      project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) },
      viewer: { isolateEntities: e => { (window.__iso = window.__iso || []).push(e); (window.__calls = window.__calls || []).push({ iso: e }); return Promise.resolve(); }, setObjectState: (a, b) => { (window.__state = window.__state || []).push(b); (window.__calls = window.__calls || []).push({ a, b }); return Promise.resolve(); }, getObjectBoundingBoxes: (m, rids) => Promise.resolve(rids.map(id => ({ id, boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 3 } } }))), getModels: () => Promise.resolve([{ id: 'M1', state: 'unloaded' }, { id: 'BAD', state: 'unloaded' }]), toggleModel: (id, on) => { (window.__tog = window.__tog || []).push([id, on]); return Promise.resolve(); }, getSelection: () => Promise.resolve(window.__sel || []), convertToObjectIds: (m, r) => Promise.resolve(r.map(x => 'G' + x)), convertToObjectRuntimeIds: (m, ids) => m === 'BAD' ? Promise.reject(new Error('Invalid model id')) : ids.includes('BADOBJ') ? Promise.reject(new Error('Objektet finns inte')) : Promise.resolve(ids), getObjectProperties: () => Promise.resolve([]), setSelection: (sel, mode) => { (window.__setsel = window.__setsel || []).push(sel); return Promise.resolve(); } }
    }) };` }));
  await page.context().route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', r => {
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
  await page.context().route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  // Testar de klassiska staplarna (Visning → Ny tidslinje av); den nya tidslinjen testas i test_gantt_timeline.js.
  await page.addInitScript(() => localStorage.setItem('4ddash-gantt-classic', '1'));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); localStorage.setItem('4ddash-test-modelctl', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const fail = m => { throw new Error(m); };
  try {
    await page.waitForFunction(() => typeof items !== 'undefined' && items.length >= 3, null, { timeout: 15000 });
    await page.evaluate(() => { window.__sels = []; const v = API.viewer; });
    const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 15000 }), page.click('#ganttPopBtn')]);
    const pf = async () => popup.frames().find(f => f.url().includes('embed=gantt'));
    await page.waitForTimeout(1500);
    let f = await pf(); if (!f) fail('popup saknar Gantt-ramen');
    await f.waitForFunction(() => typeof items !== 'undefined' && items.length >= 3 && document.documentElement.classList.contains('embed-gantt'), null, { timeout: 20000 });
    const A = await f.evaluate(() => ({ items: items.length, compact: document.documentElement.classList.contains('embed-compact'), panel: document.querySelector('[data-panel-id="gantt"]').offsetHeight > 100 }));
    if (A.compact || !A.panel) fail('popup ska visa hela Gantten: ' + JSON.stringify(A));
    // Ändring i popup-Gantten -> huvuddashboarden läser om
    await f.evaluate(() => ghWriteJSON(settings.githubToken, tablePath('plan_items'), a => a.map(r => r.id === 'i2' ? { ...r, progress: 61 } : r), 'popup'));
    await page.waitForFunction(() => items.some(x => String(x.id) === 'i2' && Number(x.progress) === 61), null, { timeout: 10000 }).catch(() => {});
    if (Number(await page.evaluate(() => (items.find(x => String(x.id) === 'i2') || {}).progress)) !== 61) fail('dashboarden läste inte om efter ändring i popup');
    // Ändring i dashboarden -> popup läser om
    await page.evaluate(() => ghWriteJSON(settings.githubToken, tablePath('plan_items'), a => a.map(r => r.id === 'i3' ? { ...r, progress: 77 } : r), 'main'));
    await f.waitForFunction(() => items.some(x => String(x.id) === 'i3' && Number(x.progress) === 77), null, { timeout: 15000 }).catch(() => {});
    if (Number(await f.evaluate(() => (items.find(x => String(x.id) === 'i3') || {}).progress)) !== 77) fail('popup läste inte om efter ändring i dashboarden');
    // Markera i modellen från popup -> dashboardens riktiga markering (setSelection)
    await page.evaluate(() => { window.__setsel = []; });
    await f.evaluate(() => selectActivityInModel({ id: 'i2', name: 'Schakt', members: [{ id: 'i2' }] }));
    await page.waitForTimeout(800);
    const sel = await page.evaluate(() => (window.__setsel || []).slice(-1)[0]);
    if (!sel || sel.modelObjectIds.flatMap(m => m.objectRuntimeIds).join() !== 'G5') fail('markera i modellen från popup: ' + JSON.stringify(sel));
    // Markering i modellen -> popup hoppar till aktiviteten
    await page.waitForTimeout(1800); await page.evaluate(() => { window.__sel = [{ modelId: 'M1', objectRuntimeIds: ['7'] }]; onTcEvent('viewer.onSelectionChanged'); });
    await f.waitForFunction(() => typeof ganttModelSel !== 'undefined' && ganttModelSel.has('i3'), null, { timeout: 8000 }).catch(() => {});
    if (!(await f.evaluate(() => ganttModelSel.has('i3')))) fail('popup hoppade inte till aktiviteten vid markering i modellen');
    await popup.close(); await page.waitForTimeout(2000);
    if (await page.evaluate(() => dashPopOn())) fail('knappen ska släppas när fönstret stängs');
    console.log('OK: Gantt i eget fönster – synkat åt båda hållen, markera i modellen, hoppar till aktivitet');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
