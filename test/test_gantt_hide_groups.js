// Dölj grupper i Gantt (Victor 2026-10-08): högerklick på ett områdes rubrik – Dölj, Visa bara,
// Visa alla; dolda visas som en rad ovanför schemat och kan tas fram igen. Tavla och staplar.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8962;
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
  await page.evaluate(() => { ganttGroupBy = 'area'; ganttHiddenGroups = new Set(); });
  await page.click('[data-gantt-view="board"]'); await page.waitForTimeout(300);
  const lanes = () => page.evaluate(() => [...document.querySelectorAll('#ganttChart .board-lane-name')].map(n => n.textContent.replace(/^[▸▾]\s*/, '').trim()));
  if ((await lanes()).join() !== 'Inköp,Sektionsfickor,Sikthall') fail('Start: ' + (await lanes()));
  await page.click('#ganttChart .board-lane-head >> nth=0', { button: 'right' });
  if (!(await page.$('#ganttGroupMenu'))) fail('Högerklick på områdets rubrik ska visa menyn');
  await page.click('#ganttGroupMenu [data-gm="hide"]');
  if ((await lanes()).join() !== 'Sektionsfickor,Sikthall') fail('Dölj: ' + (await lanes()));
  const bar = await page.evaluate(() => ({ txt: document.getElementById('ganttHiddenBar')?.textContent || '', saved: JSON.parse(localStorage.getItem(GANTT_PREFS_KEY)).hiddenGroups }));
  if (!bar.txt.includes('Inköp') || JSON.stringify(bar.saved) !== '["area:Inköp"]') fail('Dolda ska synas ovanför och sparas: ' + JSON.stringify(bar));
  // Utskriften: det dolda området skrivs inte ut (tavlan).
  await page.evaluate(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await page.click('#ganttPrintBtn');
  await page.click('.gantt-print-pop [data-act="print"]');
  await page.waitForFunction(() => window.__prints === 1);
  const printed = await page.evaluate(() => [...document.querySelectorAll('#ganttPrint .board-lane-name')].map(n => n.textContent.trim()));
  if (!printed.length || printed.some(t => t.includes('Inköp'))) fail('Dolt område ska inte skrivas ut: ' + printed);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint'))); await page.waitForTimeout(200);
  const menuTxt = await page.evaluate(() => document.getElementById('ganttHiddenBar').textContent);
  if (/[\u{1F300}-\u{1FAFF}]/u.test(menuTxt)) fail('Inga emojis: ' + menuTxt);
  // Visa bara Sikthall, sedan Visa alla via menyn.
  await page.click('#ganttChart .board-lane-head >> nth=1', { button: 'right' });
  await page.click('#ganttGroupMenu [data-gm="only"]');
  if ((await lanes()).join() !== 'Sikthall') fail('Visa bara: ' + (await lanes()));
  // Staplarna: samma dolda grupper; högerklick på gruppens rubrik fungerar där också.
  await page.click('[data-gantt-view="bars"]'); await page.waitForTimeout(300);
  const groupsBars = () => page.evaluate(() => [...document.querySelectorAll('#ganttChart [data-action="toggle-gantt-group"]')].map(h => h.dataset.groupKey));
  if ((await groupsBars()).join() !== 'area:Sikthall') fail('Staplar ska ha samma dolda: ' + (await groupsBars()));
  await page.click('#ganttChart [data-action="toggle-gantt-group"] >> nth=0', { button: 'right' });
  await page.click('#ganttGroupMenu [data-gm="all"]');
  if ((await groupsBars()).length !== 3 || (await page.$('#ganttHiddenBar'))) fail('Visa alla: ' + (await groupsBars()));
  // Chip i raden tar fram ett område igen; Esc stänger menyn.
  await page.click('#ganttChart [data-action="toggle-gantt-group"] >> nth=2', { button: 'right' });
  await page.keyboard.press('Escape');
  if (await page.$('#ganttGroupMenu')) fail('Esc ska stänga menyn');
  await page.click('#ganttChart [data-action="toggle-gantt-group"] >> nth=2', { button: 'right' });
  await page.click('#ganttGroupMenu [data-gm="hide"]');
  await page.click('#ganttHiddenBar .ghb-chip');
  if ((await groupsBars()).length !== 3) fail('Chippet ska visa området igen');
  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('OK: dölj områden via högerklick (dölj, visa bara, visa alla, chip), tavla och staplar, sparas');
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
