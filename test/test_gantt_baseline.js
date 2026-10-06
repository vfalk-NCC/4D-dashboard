// Baseline (Victors önskemål 2026-10-06: "kan den tidigare tändas upp som en baseline?"):
// "Baseline" visar baseline_start_date/baseline_end_date som en grå stapel under den planerade
// (staplar) eller en grå linje under lappen med förskjutningen (+5 d) på tavlan.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8975;
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
  it('Gjutning', 'Linje J', 'Betong', 7, 11, { baseline_start_date: day(2), baseline_end_date: day(6) }),  // i1: 5 dagar senare
  it('Montage', 'Linje J', 'Stomme', 3, 9, { baseline_start_date: day(3), baseline_end_date: day(9) }),    // i2: oförändrad
  it('Schakt', 'Linje K', 'Mark', 1, 4, { baseline_start_date: day(3), baseline_end_date: day(6) }),      // i3: 2 dagar tidigare
  it('Ny', 'Linje K', 'Mark', 12, 14),                                                                    // i4: ingen baseline
]);
seed('plan_baseline.json', [{ mode: 'prev', label: 'Import 01/10 2026 (Huvudtidplan.pp)', set_at: '2026-10-01T10:00:00Z' }]);
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
  // Tavlan: av från början, inga baseline-linjer.
  if (await page.locator('#ganttChart .pnote-bl').count()) fail('Baseline ska vara av från början');
  await page.check('#ganttShowBaseline'); await page.waitForTimeout(200);
  const b = await page.evaluate(() => {
    const dayPx = parseFloat(getComputedStyle(document.querySelector('.board-grid')).getPropertyValue('--day'));
    const one = id => { const n = document.querySelector(`#ganttChart .pnote[data-item-id="${id}"]`), l = n.querySelector('.pnote-bl'), d = n.querySelector('.pnote-bl-d'), r = n.getBoundingClientRect();
      return { bl: l ? { dl: (l.getBoundingClientRect().left - r.left) / dayPx, w: l.getBoundingClientRect().width / dayPx, below: l.getBoundingClientRect().top >= r.bottom - 1 } : null, d: d ? d.textContent : null, later: d ? d.classList.contains('later') : null }; };
    return { i1: one('i1'), i2: one('i2'), i3: one('i3'), i4: one('i4'), legend: document.getElementById('ganttLegend').innerText };
  });
  const near = (a, x) => Math.abs(a - x) < 0.05;
  if (!b.i1.bl || !near(b.i1.bl.dl, -5) || !near(b.i1.bl.w, 5) || !b.i1.bl.below || b.i1.d !== '+5 d' || !b.i1.later) fail('Gjutning: baseline 5 dagar tidigare, +5 d: ' + JSON.stringify(b.i1));
  if (!b.i2.bl || b.i2.d !== null) fail('Montage: oförändrad – linje men ingen förskjutning: ' + JSON.stringify(b.i2));
  if (b.i3.d !== '-2 d' || b.i3.later) fail('Schakt: 2 dagar tidigare: ' + JSON.stringify(b.i3));
  if (b.i4.bl || b.i4.d) fail('Ny: ingen baseline');
  if (!/Baseline: Import 01\/10 2026 \(Huvudtidplan\.pp\)/.test(b.legend)) fail('Förklaringen ska säga varifrån baseline kommer: ' + b.legend);
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'board_baseline.png') });
  console.log('OK: tavlan – grå baseline-linje under lappen, +5 d / -2 d, förklaringen säger varifrån');

  // Tipsrutan.
  await page.hover('#ganttChart .pnote[data-item-id="i1"] .pnote-title'); await page.waitForTimeout(250);
  const tip = await page.evaluate(() => (document.querySelector('.gantt-tooltip') || {}).innerText || '');
  if (!/Baseline/.test(tip) || !/senare 5 d/.test(tip)) fail('Tipsrutan ska visa baseline: ' + tip);

  // Staplar: en grå stapel under den planerade på baseline-datumen; vyn tar med baseline-datumen.
  await page.click('[data-gantt-view="bars"]'); await page.waitForTimeout(250);
  const s = await page.evaluate(() => {
    const row = id => document.querySelector(`#ganttChart .gantt-bar[data-item-id="${id}"]`).closest('.gantt-track');
    const g = row('i1'), bar = g.querySelector('.gantt-bar[data-item-id]').getBoundingClientRect(), bl = g.querySelector('.gantt-bar-baseline');
    return { bl: !!bl, before: bl && bl.getBoundingClientRect().left < bar.left - 5, below: bl && bl.getBoundingClientRect().top >= bar.bottom - 0.5, n: document.querySelectorAll('#ganttChart .gantt-bar-baseline').length };
  });
  if (!s.bl || !s.before || !s.below || s.n !== 3) fail('Staplarna ska få en baseline-stapel under: ' + JSON.stringify(s));
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'bars_baseline.png') });
  await page.uncheck('#ganttShowBaseline'); await page.waitForTimeout(200);
  if (await page.locator('#ganttChart .gantt-bar-baseline').count()) fail('Av ska ta bort baseline-staplarna');
  if (!(await page.evaluate(() => Object.values(localStorage).some(v => /"baseline":false/.test(v))))) fail('Valet ska sparas');
  console.log('OK: staplarna – grå baseline-stapel under den planerade; tipsrutan; valet sparas');

  if (errors.length) fail('Fel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
