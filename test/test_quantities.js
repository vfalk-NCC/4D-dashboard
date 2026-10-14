// Mängdavtagning: klara objekt enligt Ganttens regel, mängder ur TC:s egenskaper (Calculated Geometry Values → Volume), summering per egenskap/område, CSV.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8995;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const PID = 'test-project';
const store = new Map(); let n = 0;
const seed = (f, c) => store.set(`projects/${PID}/${f}`, { content: JSON.stringify(c), sha: 's' + (++n) });
const iso = d => d.toISOString().slice(0, 10);
const day = k => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + k); return iso(d); };
const base = { project_id: PID, model_id: 'M1', actual_start_date: null, actual_end_date: null, estimated_hours: null, updated_at: '2026-01-01T00:00:00Z', depends_on: [], contractor: 'NCC', status: 'planerad' };
seed('plan_items.json', [
  { ...base, id: 'i1', object_id: 'S1', object_name: 'Platta 1', area: 'PRODUKTION / 743 Krosshall', activity: 'Gjutning', start_date: day(-20), end_date: day(-10), progress: 100 },
  { ...base, id: 'i2', object_id: 'S2', object_name: 'Platta 2', area: 'PRODUKTION / 743 Krosshall', activity: 'Gjutning', start_date: day(-20), end_date: day(-10), progress: 100 },
  { ...base, id: 'i3', object_id: 'W1', object_name: 'Vägg 1', area: 'PRODUKTION / 744 Fläkthuset', activity: 'Väggar', start_date: day(-5), end_date: day(-1), progress: 100 },
  { ...base, id: 'i4', object_id: 'W2', object_name: 'Vägg 2', area: 'PRODUKTION / 744 Fläkthuset', activity: 'Väggar', start_date: day(2), end_date: day(9), progress: 0 },
]);
['plan_milestones.json', 'plan_deliveries.json', 'plan_item_baseline_history.json', 'plan_item_activities.json'].forEach(f => seed(f, []));
// Volym (m³) och typ per objekt, som Revit/TC visar dem.
const P = { S1: [6, 'Foundation Slab:Concrete - Cast-in-Place - 1200'], S2: [4, 'Foundation Slab:Concrete - Cast-in-Place - 1200'], W1: [2.5, 'Wall:Concrete - Cast-in-Place - 300'], W2: [9, 'Wall:Concrete - Cast-in-Place - 300'] };
(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data);
  })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `
    const P = ${JSON.stringify(P)}; const ids = Object.keys(P); window.__sel = [];
    window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({
      markup: { addTextMarkup: m => Promise.resolve([]), removeMarkups: () => Promise.resolve() },
      project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) },
      viewer: { isolateEntities: () => Promise.resolve(), setObjectState: () => Promise.resolve(), setCamera: () => Promise.resolve(), getModels: () => Promise.resolve([]),
        convertToObjectRuntimeIds: (m, oids) => Promise.resolve(oids.map(o => ids.indexOf(o) + 1 || null)),
        setSelection: s => { window.__sel.push(s); return Promise.resolve(); }, getSelection: () => Promise.resolve([]),
        getObjectBoundingBoxes: (m, rids) => Promise.resolve(rids.map(r => { const v = P[ids[r - 1]][0]; const s = Math.cbrt(v * 1.5); return { id: r, boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: s, y: s, z: s } } }; })),
        getObjectProperties: (m, rids) => Promise.resolve(rids.map(r => ({ id: r, class: 'IfcSlab', product: { name: P[ids[r - 1]][1] + ':' + r }, properties: [
          { name: 'CalculatedGeometryValues', properties: [{ name: 'Volume', value: P[ids[r - 1]][0] * 1e9 }, { name: 'CenterOfGravityX', value: 1000 }] },
          { name: 'Product', properties: [{ name: 'Product Object Type', value: P[ids[r - 1]][1] }] },
          { name: 'Reference Object', properties: [{ name: 'Layer', value: 'S-FNDN' }] } ] }))) },
      ui: {}, extension: {}, embed: { setTokenRefresh: () => {} } }) };` }));
  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', r => {
    const req = r.request(), f = decodeURIComponent(new URL(req.url()).pathname.replace('/repos/vfalk-NCC/4D-data/contents/', ''));
    const e = store.get(f);
    if (req.method() === 'GET') return e ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(e.content).toString('base64'), sha: e.sha }) }) : r.fulfill({ status: 404, body: '{}' });
    r.fulfill({ status: 405, body: '' });
  });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const fail = m => { throw new Error(m); };
  try {
    if (!(await page.$('[data-panel-id="quantities"] #qtyBox'))) fail('Blocket Mängdavtagning saknas');
    const order = await page.evaluate(() => [...document.querySelectorAll('.panel[data-panel-id]')].map(p => p.dataset.panelId));
    if (order.indexOf('quantities') !== order.indexOf('video-editor') + 1) fail('Blocket ska ligga under video-editorn: ' + order.join());
    // Klara objekt (Ganttens regel): de tre som är klara idag – den framtida väggen ingår inte.
    await page.click('#qtyRead'); await page.waitForFunction(() => qty.objs.length > 0, null, { timeout: 15000 });
    let R = await page.evaluate(() => ({ n: qty.objs.length, val: qty.cfg.valKey, row: qty.cfg.rowKey, f: qty.factor, note: qty.unitNote, P: (() => { const p = qtyPivot(); return { total: p.total, rows: p.rows.map(r => [r.key, Math.round(r.sum * 100) / 100, r.n]) }; })() }));
    if (R.n !== 3 || !/Volume$/.test(R.val) || !/Product Object Type/.test(R.row) || R.f !== 1e9 || !/mm³/.test(R.note)) fail('Läsning och enhet: ' + JSON.stringify(R));
    if (Math.abs(R.P.total - 12.5) > 0.001) fail('Summa klara volymer (6 + 4 + 2,5 m³): ' + JSON.stringify(R.P));
    if (R.P.rows.map(r => r.join(':')).join('|') !== 'Foundation Slab:Concrete - Cast-in-Place - 1200:10:2|Wall:Concrete - Cast-in-Place - 300:2.5:1') fail('Summering per typ: ' + JSON.stringify(R.P.rows));
    // Rader per område, kolumner per typ; filter; CSV.
    await page.selectOption('#qtyRowKey', '◆ Område (sista ledet)'); await page.selectOption('#qtyColKey', { index: 0 }).catch(() => {});
    R = await page.evaluate(() => { qty.cfg.rowKey = '◆ Område (sista ledet)'; qty.cfg.colKey = [...qty.keys.keys()].find(k => /Product Object Type/.test(k)); qtyRender(); const p = qtyPivot(); return { rows: p.rows.map(r => r.key + ':' + Math.round(r.sum * 10) / 10).join('|'), cols: p.cols.length, csv: qtyCsv() }; });
    if (R.rows !== '743 Krosshall:10|744 Fläkthuset:2.5' || R.cols !== 2 || !/743 Krosshall";"10";/.test(R.csv.replace(/"10"/, '"10"')) && !/743 Krosshall";"[\d,]*";"10";2/.test(R.csv)) fail('Område × typ och CSV: ' + JSON.stringify(R));
    await page.evaluate(() => { qty.cfg.filter = 'Wall'; qtyRender(); });
    if ((await page.evaluate(() => qtyPivot().total)) !== 2.5) fail('Filter Innehåller: Wall ska ge 2,5 m³');
    await page.evaluate(() => { qty.cfg.filter = ''; qtyRender(); });
    // Alla oavsett läge.
    await page.evaluate(() => { qty.cfg.phase = 'all'; qtyRender(); }); await page.click('#qtyRead'); await page.waitForFunction(() => qty.objs.length === 4, null, { timeout: 15000 });
    if (Math.abs((await page.evaluate(() => qtyPivot().total)) - 21.5) > 0.001) fail('Alla objekt: 21,5 m³');
    // Klick på en rad markerar objekten i TC.
    await page.evaluate(() => { window.__sel = []; }); await page.click('#qtyTable tbody tr'); await page.waitForTimeout(300);
    if (!(await page.evaluate(() => window.__sel.length))) fail('Klick på rad ska markera i TC');
    if (errors.length) fail('Sidfel: ' + errors.join(' | '));
    console.log('OK: Mängdavtagning – klara objekt (Ganttens regel), volym ur Calculated Geometry Values med enhetskontroll, summering per typ/område, filter, CSV, markera i TC');
    console.log('ALLA TESTER OK');
  } catch (e) { console.log('FEL: ' + e.message); process.exitCode = 1; }
  await browser.close(); server.close();
})();
