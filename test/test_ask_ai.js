// Fråga AI: HTML-fil till Claude, ändringslistan läses in, före/efter visas och tillämpas (med Ångra).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8976;
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
      viewer: { getSelection: () => Promise.resolve(window.__sel || []), convertToObjectIds: () => Promise.resolve([]), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids.map((x, i) => i + 1)), getObjectProperties: (m, rids) => Promise.resolve(rids.map(id => ({ id, properties: [{ name: 'Produkt', properties: [{ name: 'Namn', value: 'Vägg ' + id }, { name: 'HPM', value: 'Typ' + id }] }] }))),
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
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.waitForSelector('#ganttAskAi', { state: 'attached' });
  await page.evaluate(() => document.getElementById('ganttAskAi').click()); await page.waitForSelector('#askMake');
  await page.fill('#askQ', 'Vad är försenat?');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#askMake')]);
  await dl.saveAs('/tmp/askai.html'); const h = fs.readFileSync('/tmp/askai.html', 'utf8');
  if (!/Uppdrag till Claude/.test(h) || !/Vad är försenat\?/.test(h) || !/<td>A1<\/td>/.test(h) || !/"andringar"/.test(h)) fail('HTML-filen saknar uppdrag/fråga/tabell');
  const map = await page.evaluate(() => JSON.parse(localStorage.getItem('4ddash-askai-map')));
  if (!map || !map.rows.length) fail('Kopplingen ref → objekt ska sparas');
  const r0 = map.rows[0], ids0 = r0.ids;
  const ns = new Date(Date.parse(r0.start) + 7 * 864e5).toISOString().slice(0, 10), ne = new Date(Date.parse(r0.end) + 7 * 864e5).toISOString().slice(0, 10);
  await page.fill('#askAns', 'Här är mitt förslag:\n```json\n' + JSON.stringify({ andringar: [{ ref: 'A1', start: ns, slut: ne, kommentar: 'Vänta på leverans' }, { ref: 'A999', start: ns, slut: ne }] }) + '\n```\nKlart.');
  await page.click('#askRead'); await page.waitForSelector('#askApply');
  const rowsN = await page.locator('#askPrev tbody tr').count(); if (rowsN !== 2) fail('Två rader ska visas: ' + rowsN);
  if ((await page.locator('#askPrev [data-ar]:not(:disabled)').count()) !== 1) fail('Okänd ref ska inte gå att tillämpa');
  const before = await page.evaluate(ids => items.filter(x => ids.includes(x.id)).map(x => x.startDate), ids0);
  await page.click('#askApply'); await page.waitForTimeout(800);
  const after = await page.evaluate(ids => items.filter(x => ids.includes(x.id)).map(x => x.startDate), ids0);
  if (JSON.stringify(before) === JSON.stringify(after) || after[0] !== new Date(Date.parse(before[0]) + 7 * 864e5).toISOString().slice(0, 10)) fail('Datumen ska flyttas en vecka: ' + JSON.stringify([before, after]));
  await page.evaluate(() => document.getElementById('ganttUndo').click()); await page.waitForTimeout(800);
  const undone = await page.evaluate(ids => items.filter(x => ids.includes(x.id)).map(x => x.startDate), ids0);
  if (JSON.stringify(undone) !== JSON.stringify(before)) fail('Ångra ska återställa: ' + JSON.stringify(undone));
  // Svar utan ändringslista
  await page.evaluate(() => document.getElementById('ganttAskAi').click()); await page.waitForSelector('#askRead');
  await page.fill('#askAns', 'Bara text'); await page.click('#askRead');
  if (!/Hittade ingen ändringslista/.test(await page.textContent('#askMsg'))) fail('Meddelande saknas för svar utan lista');
  // Tidslinjen startar på idag + 4 veckor, och Fråga AI ligger i Verktyg-menyn
  const tr = await page.evaluate(() => ({ f: ganttTimeFrom, t: ganttTimeTo, today: todayISO(), inTools: !!document.querySelector('.gdd[data-dd="tools"] #ganttAskAi') }));
  if (tr.f !== tr.today || tr.t !== new Date(Date.parse(tr.today) + 28 * 864e5).toISOString().slice(0, 10)) fail('Tidslinjen ska starta idag + 28 dagar: ' + JSON.stringify(tr));
  if (!tr.inTools) fail('Fråga AI ska ligga i Verktyg-menyn');
  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK'); await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
