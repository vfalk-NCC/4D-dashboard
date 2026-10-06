// Sökning i Gantt-schemat och helskärm med stort schema (Victor 2026-10-06).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8980;
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
const rowsSeed = [];
for (let i = 0; i < 70; i++) rowsSeed.push(it(`Aktivitet ${i}`, ['742 Sikthall', '741 Sektionsfickor', '744 Fläkthuset'][i % 3], ['Gjutning', 'Montage', 'Bergstag'][i % 3], (i % 20) - 5, (i % 20) + 2));
rowsSeed.push(it('Grovbetong för fundament linje E17-30', '744 Fläkthuset', 'Betong', 1, 9));
seed('plan_items.json', rowsSeed);
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
  await page.click('[data-gantt-view="board"]');
  await page.click('[data-gantt-weeks="4"]');
  await page.waitForTimeout(200);
  await page.selectOption('#ganttGroupBy', 'area').catch(() => {});
  // Helskärm med ett stort schema: båda verktygsraderna syns (andra raden klipptes bort förut).
  await page.click('#ganttFullBtn'); await page.waitForTimeout(400);
  const rowsVis = await page.evaluate(() => ({ sub: document.querySelector('.gantt-range-row').getBoundingClientRect().height, edit: document.getElementById('ganttEditable').getBoundingClientRect().height, scroll: document.getElementById('ganttChart').scrollHeight > document.getElementById('ganttChart').clientHeight }));
  if (rowsVis.sub < 20 || rowsVis.edit < 8) fail('Andra verktygsraden ska synas i helskärm: ' + JSON.stringify(rowsVis));
  console.log('OK: helskärm – båda verktygsraderna (period, baseline, redigerbar …) syns även med ett stort schema');
  // Sök: område, aktivitet, flera ord, utan accenter; Esc rensar (och stänger inte helskärmen).
  const count = () => page.evaluate(() => document.querySelectorAll('#ganttChart .pnote').length);
  const all = await count();
  await page.fill('#ganttSearch', 'flakthuset'); await page.waitForTimeout(400);
  const n1 = await count(), c1 = await page.innerText('#ganttSearchCount');
  if (!(n1 > 0 && n1 < all) || !/ av /.test(c1)) fail('Sök på område (utan å/ä): ' + JSON.stringify({ all, n1, c1 }));
  await page.fill('#ganttSearch', 'grovbetong E17'); await page.waitForTimeout(400);
  const t2 = await page.evaluate(() => [...document.querySelectorAll('#ganttChart .pnote .pnote-title')].map(t => t.textContent.trim()));
  if (t2.length !== 1 || !/Grovbetong/.test(t2[0])) fail('Sök med flera ord: ' + JSON.stringify(t2));
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'gantt_search.png'), clip: { x: 0, y: 0, width: 1400, height: 330 } });
  await page.focus('#ganttSearch'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  if (await count() !== all || await page.inputValue('#ganttSearch') !== '') fail('Esc ska rensa sökningen');
  if (!(await page.evaluate(() => document.querySelector('section[data-panel-id="gantt"]').classList.contains('gantt-fullscreen')))) fail('Esc i sökrutan ska inte stänga helskärmen');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  console.log('OK: sökning på område/aktivitet (flera ord, utan accenter), antal träffar, Esc rensar');
  if (errors.length) fail('Fel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
