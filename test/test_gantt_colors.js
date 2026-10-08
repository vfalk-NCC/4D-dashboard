// Egna färger i Gantt (Victor 2026-10-08): välj färg per entreprenör/område – rutorna under
// förklaringen och högerklick på gruppens rubrik. Sparas i projektet (gantt_colors.json).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8963;
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
  it('A1', 'Inköp', 'Leverans', 0, 5), it('B1', 'Sektionsfickor', 'Valv', 1, 8), it('B2', 'Sektionsfickor', 'Valv', 2, 9),
  it('C1', 'Sikthall', 'Grund', 3, 10),
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
  await page.evaluate(() => { ganttGroupBy = 'area'; ganttColorBy = 'contractor'; ganttHiddenGroups = new Set(); items.forEach((x, i) => { x.contractor = i % 2 ? 'Peri' : 'NCC'; }); });
  await page.click('[data-gantt-view="board"]'); await page.waitForTimeout(300);
  const chips = await page.evaluate(() => [...document.querySelectorAll('#ganttLegend .gck-chip')].map(b => b.dataset.ck));
  if (chips.join() !== 'NCC,Peri') fail('Rutor per entreprenör: ' + chips);
  // Klick på rutan öppnar färgväljaren; vald färg syns på lapparna och sparas i projektet.
  await page.evaluate(() => { window._picked = null; const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type === 'color') { window._picked = this; return; } return orig.call(this); }; });
  await page.click('#ganttLegend .gck-chip[data-ck="Peri"]');
  await page.evaluate(() => { const i = window._picked; i.value = '#ff0000'; i.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(400);
  const c1 = await page.evaluate(() => {
    const it = items.find(x => x.contractor === 'Peri'), n = document.querySelector(`#ganttChart .pnote[data-item-id="${it.id}"]`);
    return { style: n ? n.getAttribute('style') : '', own: !!document.querySelector('#ganttLegend .gck-chip.own[data-ck="Peri"]') };
  });
  const saved = JSON.parse(store.get(`projects/${PID}/gantt_colors.json`).content);
  if (!/#ff/i.test(c1.style) || !c1.own || JSON.stringify(saved) !== '[{"key":"contractor:Peri","color":"#ff0000"}]') fail('Egen färg: ' + JSON.stringify({ c1, saved }));
  // Högerklick på områdets rubrik: Välj färg… (gäller området).
  await page.click('#ganttChart .board-lane-head >> nth=0', { button: 'right' });
  await page.click('#ganttGroupMenu [data-gm="color"]');
  await page.evaluate(() => { const i = window._picked; i.value = '#00aa00'; i.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(400);
  const head = await page.evaluate(() => document.querySelector('#ganttChart .board-lane-head').getAttribute('style'));
  if (!head.includes('--bd:#40bf40')) fail('Områdets färg via menyn: ' + head);
  // Standardfärg igen (högerklick på rutan) – tas bort ur filen, men andra färger finns kvar.
  await page.click('#ganttLegend .gck-chip[data-ck="Peri"]', { button: 'right' });
  await page.waitForTimeout(400);
  const left = JSON.parse(store.get(`projects/${PID}/gantt_colors.json`).content).map(x => x.key);
  if (left.join() !== 'area:Inköp') fail('Återställ: ' + left);
  console.log('OK: egna färger per entreprenör (rutorna) och område (högerklick), sparas i projektet, kan återställas');
  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
