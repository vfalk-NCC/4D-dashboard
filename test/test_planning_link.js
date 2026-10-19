// Koppling till 4D-planering: dashboardens läge och datum sänds på kanalen, och datum från 4D-planering flyttar Tid-läget (bara där).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8994;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const PID = 'test-project';
const store = new Map(); let n = 0;
const seed = (f, c) => store.set(`projects/${PID}/${f}`, { content: JSON.stringify(c), sha: 's' + (++n) });
const iso = d => d.toISOString().slice(0, 10);
const day = k => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + k); return iso(d); };
const base = { project_id: PID, model_id: 'M1', actual_start_date: null, actual_end_date: null, estimated_hours: null, updated_at: '2026-01-01T00:00:00Z', depends_on: [], contractor: 'NCC', status: 'planerad' };
seed('plan_items.json', [
  { ...base, id: 'i1', object_id: 'G1', object_name: 'Grund', area: 'A', activity: 'Betong', start_date: day(-6), end_date: day(-2), progress: 100 },
  { ...base, id: 'i2', object_id: 'G2', object_name: 'Stomme med ett riktigt långt namn för att testa avkortning', area: 'A', activity: 'Stomme', start_date: day(-1), end_date: day(5), progress: 40 },
  { ...base, id: 'i3', object_id: 'G3', object_name: 'Tak', area: 'B', activity: 'Tak', start_date: day(6), end_date: day(9), progress: 0 },
]);
['plan_milestones.json', 'plan_deliveries.json', 'plan_item_baseline_history.json', 'plan_item_activities.json'].forEach(f => seed(f, []));
(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data);
  })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `
    window.__cam = { position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 } }; window.__cams = []; window.__shots = 0;
    window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({
      markup: { addTextMarkup: m => Promise.resolve([]), removeMarkups: () => Promise.resolve() },
      project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) },
      viewer: { isolateEntities: () => Promise.resolve(), setObjectState: () => Promise.resolve(), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids.map((x, i) => i + 1)), getModels: () => Promise.resolve([]), setSelection: () => Promise.resolve(),
        getCamera: () => Promise.resolve(JSON.parse(JSON.stringify(window.__cam))), setCamera: c => { if (c && c.position) { window.__cam = JSON.parse(JSON.stringify(c)); window.__cams.push(window.__cam); } return Promise.resolve(); },
        getSnapshot: () => { window.__shots++; const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); x.fillStyle = '#e5e7eb'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#2563eb'; x.fillRect(100 + window.__shots * 4, 100, 120, 80); return Promise.resolve(c.toDataURL('image/png')); } },
      ui: {}, extension: {}, embed: { setTokenRefresh: () => {} }
    }) };` }));
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
    const peer = await ctx.newPage();
    await peer.goto(`http://localhost:${PORT}/style.css`);
    await peer.evaluate(() => { window.__got = []; window.__ch = new BroadcastChannel('4d-gantt-link'); window.__ch.onmessage = e => window.__got.push(e.data); });
    const got = () => peer.evaluate(() => window.__got);
    const send = m => peer.evaluate(m => window.__ch.postMessage(m), m);
    await peer.evaluate(() => window.__ch.postMessage({ t: 'hello' })); await page.waitForTimeout(400);
    let g = await got(); if (!g.some(m => m.t === 'state' && m.mode === 'off')) fail('Svar på hello med läget Alla: ' + JSON.stringify(g));
    // Ett datum utanför Tid-läget flyttar inget.
    await send({ t: 'setDate', date: '2020-01-01' }); await page.waitForTimeout(300);
    if (await page.evaluate(() => ganttAsOf)) fail('Datum från 4D-planering ska ignoreras utanför Tid-läget');
    // Tid-läget: läge och datum sänds.
    await page.evaluate(() => { window.__got = []; }); await peer.evaluate(() => { window.__got = []; });
    await page.click('[data-gantt-view="board"]').catch(() => {}); await page.dispatchEvent('[data-gmode="time"]', 'click'); await page.waitForTimeout(800);
    g = await got(); const st = g.filter(m => m.t === 'state').pop();
    if (!st || st.mode !== 'time' || !/^\d{4}-\d\d-\d\d$/.test(st.date)) fail('Tid-läget ska sändas med datum: ' + JSON.stringify(g));
    // Datum från 4D-planering flyttar Tid-lägets datum.
    const d1 = await page.evaluate(() => addDaysIso(ganttAsOf, 2));
    await send({ t: 'setDate', date: d1 }); await page.waitForTimeout(600);
    if ((await page.evaluate(() => ganttAsOf)) !== d1) fail('Dashboardens datum ska följa 4D-planeringens reglage: ' + await page.evaluate(() => ganttAsOf));
    await page.waitForTimeout(500); g = await got();
    if (!g.some(m => m.t === 'state' && m.date === d1)) fail('Nya datumet ska sändas tillbaka');
    // Läge Kopplade sänds utan datum; av = off.
    await page.dispatchEvent('[data-gmode="isolate"]', 'click'); await page.waitForTimeout(800); g = await got();
    if (g.filter(m => m.t === 'state').pop().mode !== 'isolate') fail('Kopplade ska sändas');
    await send({ t: 'setDate', date: '2020-01-01' }); await page.waitForTimeout(300);
    await page.dispatchEvent('[data-gmode="off"]', 'click'); await page.waitForTimeout(800); g = await got();
    if (g.filter(m => m.t === 'state').pop().mode !== 'off') fail('Alla (av) ska sändas');
    if (errors.length) fail('Sidfel: ' + errors.join(' | '));
    console.log('OK: dashboardens läge och datum sänds till 4D-planering, och dess reglage flyttar Tid-lägets datum (bara där)');
    console.log('ALLA TESTER OK');
  } catch (e) { console.log('FEL: ' + e.message); process.exitCode = 1; }
  await browser.close(); server.close();
})();
