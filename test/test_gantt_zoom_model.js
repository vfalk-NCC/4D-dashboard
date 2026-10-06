// Klick på en kopplad aktivitet i Gantt-schemat markerar och zoomar in objekten i Trimble Connect
// (Victor 2026-10-06).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8981;
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
  it('Grovbetong', 'Linje E', 'Betong', 1, 9, { model_id: 'm1', object_id: '101', group_id: 'g' }),
  it('Grovbetong', 'Linje E', 'Betong', 1, 9, { model_id: 'm1', object_id: '102', group_id: 'g' }),
  it('Okopplad', 'Linje E', 'Mark', 3, 6),
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
      viewer: { getSelection: () => Promise.resolve([]), convertToObjectIds: () => Promise.resolve([]), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids), getObjectProperties: () => Promise.resolve([]), setSelection: (s) => { (window.__calls = window.__calls || []).push(['sel', s]); return Promise.resolve(); }, setCamera: (c, o) => { (window.__calls = window.__calls || []).push(['cam', c, o]); return Promise.resolve(); } }
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
  await page.click('[data-gantt-view="board"]');
  await page.click('[data-gantt-weeks="4"]');
  await page.waitForTimeout(200);
  await page.click('#ganttChart .pnote[data-item-id="i1"] .pnote-title'); await page.waitForTimeout(500);
  const calls = await page.evaluate(() => window.__calls || []);
  const sel = calls.find(c => c[0] === 'sel'), cam = calls.find(c => c[0] === 'cam');
  if (!sel || !cam || JSON.stringify(cam[1].modelObjectIds) !== JSON.stringify([{ modelId: 'm1', objectRuntimeIds: ['101', '102'] }]) || cam[2] !== undefined) fail('Klick ska markera och zooma in: ' + JSON.stringify(calls));
  if (!/Markerad och inzoomad i modellen \(2 objekt\)/.test(await page.innerText('#modelToast'))) fail('Bekräftelsen ska visas');
  await page.evaluate(() => { window.__calls = []; });
  await page.click('#ganttChart .pnote[data-item-id="i3"] .pnote-title'); await page.waitForTimeout(400);
  if ((await page.evaluate(() => window.__calls.length)) || !/inte kopplad/.test(await page.innerText('#modelToast'))) fail('Okopplad: inget händer i modellen, men det sägs till');
  // Staplar: klick på namnet gör detsamma.
  await page.click('[data-gantt-view="bars"]'); await page.waitForTimeout(250);
  await page.click('.gantt-label[data-item-id="i2"]'); await page.waitForTimeout(400);
  if (!(await page.evaluate(() => window.__calls.some(c => c[0] === 'cam')))) fail('Staplarna: klick på namnet ska zooma');
  console.log('OK: klick på en kopplad aktivitet markerar och zoomar in objekten i TC (tavla och staplar); okopplad säger till');
  if (errors.length) fail('Fel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
