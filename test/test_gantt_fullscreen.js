// Helskärm för Gantt-schemat (Victor 2026-10-06).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8978;
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
  it('Kort', 'Linje J', 'Montage av mycket långa prefabricerade väggelement', 2, 2),  // i1: 1 dag, långt namn
  it('Granne', 'Linje J', 'Gjutning', 5, 12),                                        // i2: samma rad om platsen inte reserveras
  it('Lång', 'Linje K', 'Kontrefor', 0, 20),                                         // i3: får plats
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
  await page.click('[data-gantt-view="board"]');
  await page.click('[data-gantt-weeks="4"]');
  await page.waitForTimeout(200);
  const size = () => page.evaluate(() => { const p = document.querySelector('section.panel[data-panel-id="gantt"]').getBoundingClientRect(), c = document.getElementById('ganttChart').getBoundingClientRect(); return { pw: p.width, ph: p.height, top: p.top, ch: c.height, btn: document.getElementById('ganttFullBtn').textContent, fs: document.querySelector('section.panel[data-panel-id="gantt"]').classList.contains('gantt-fullscreen') }; });
  const before = await size();
  await page.click('#ganttFullBtn'); await page.waitForTimeout(400);
  const on = await size();
  if (!on.fs || Math.abs(on.top) > 1 || on.pw < 1390 || on.ph < 990 || on.ch <= before.ch || !/Stäng helskärm/.test(on.btn)) fail('Helskärm ska fylla skärmen: ' + JSON.stringify({ before, on }));
  await page.locator('section[data-panel-id="gantt"]').screenshot({ path: path.join(require('os').tmpdir(), 'gantt_fullscreen.png') });
  // Tipsrutan ska synas i helskärm (i webbläsarens helskärm syns bara panelen).
  await page.click('#ganttChart .pnote[data-item-id="i1"] .pnote-title'); await page.waitForTimeout(250);
  const tipFs = await page.evaluate(() => { const t = document.querySelector('.gantt-tooltip'); return { fs: !!document.fullscreenElement, inside: !document.fullscreenElement || document.fullscreenElement.contains(t), shown: !t.classList.contains('hidden') && t.getBoundingClientRect().width > 0 }; });
  console.log('fullscreen i testet:', tipFs.fs);
  if (!tipFs.inside || !tipFs.shown) fail('Tipsrutan ska synas i helskärm: ' + JSON.stringify(tipFs));
  await page.mouse.move(0, 0);
  // Dölj knapparna: bara färgförklaringen och schemat; valet sparas.
  await page.click('#ganttFsTools'); await page.waitForTimeout(300);
  const clean = await page.evaluate(() => ({ head: getComputedStyle(document.querySelector('section[data-panel-id="gantt"] .gantt-head')).display, h2: getComputedStyle(document.querySelector('section[data-panel-id="gantt"] > h2')).display, legend: document.getElementById('ganttLegend').getBoundingClientRect().height, ch: document.getElementById('ganttChart').getBoundingClientRect().height, btn: document.getElementById('ganttFsTools').textContent }));
  if (clean.head !== 'none' || clean.h2 !== 'none' || clean.legend < 10 || clean.ch <= on.ch || !/Visa knappar/.test(clean.btn)) fail('Dölj knappar: ' + JSON.stringify({ clean, on }));
  await page.locator('section[data-panel-id="gantt"]').screenshot({ path: path.join(require('os').tmpdir(), 'gantt_fullscreen_clean.png') });
  await page.click('#ganttFsClose'); await page.waitForTimeout(300);
  if ((await size()).fs) fail('✕ ska stänga helskärmen');
  // Även utanför helskärm (Victor 2026-10-06): knapparna förblir dolda, rubriken och ☰ syns, ✕ inte.
  const outside = await page.evaluate(() => ({ head: getComputedStyle(document.querySelector('section[data-panel-id="gantt"] .gantt-head')).display, h2: getComputedStyle(document.querySelector('section[data-panel-id="gantt"] > h2')).display, tools: document.getElementById('ganttFsTools').textContent, toolsShown: getComputedStyle(document.getElementById('ganttFsTools')).display !== 'none', close: getComputedStyle(document.getElementById('ganttFsClose')).display }));
  if (outside.head !== 'none' || outside.h2 === 'none' || !/Visa knappar/.test(outside.tools) || !outside.toolsShown || outside.close !== 'none') fail('Dölj knappar utanför helskärm: ' + JSON.stringify(outside));
  await page.locator('section[data-panel-id="gantt"]').screenshot({ path: path.join(require('os').tmpdir(), 'gantt_clean_normal.png') });
  await page.click('#ganttFsTools'); await page.waitForTimeout(300);
  if (await page.evaluate(() => getComputedStyle(document.querySelector('section[data-panel-id="gantt"] .gantt-head')).display) === 'none') fail('Visa knappar utanför helskärm');
  await page.click('#ganttFsTools'); await page.waitForTimeout(300);
  await page.click('#ganttFsEnter'); await page.waitForTimeout(300);
  if (await page.evaluate(() => getComputedStyle(document.querySelector('section[data-panel-id="gantt"] .gantt-head')).display) !== 'none') fail('Valet att dölja knapparna ska sparas');
  await page.click('#ganttFsTools'); await page.waitForTimeout(300);
  if (await page.evaluate(() => getComputedStyle(document.querySelector('section[data-panel-id="gantt"] .gantt-head')).display) === 'none') fail('Visa knappar igen');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  const off = await size();
  if (off.fs || !/Helskärm/.test(off.btn) || /Stäng/.test(off.btn)) fail('Esc ska stänga helskärmen: ' + JSON.stringify(off));
  await page.click('#ganttFullBtn'); await page.waitForTimeout(300);
  await page.click('#ganttFullBtn'); await page.waitForTimeout(300);
  if ((await size()).fs) fail('Knappen ska stänga helskärmen');
  console.log('OK: Helskärm – fyller skärmen; knapparna kan döljas (färgförklaringen kvar, valet sparas); Esc, ✕ och knappen stänger');
  if (errors.length) fail('Fel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
