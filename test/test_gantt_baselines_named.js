// Namngivna baselines (Victor 2026-10-06: kontraktstidplan + revisioner): välj vilken som visas
// och jämför mot en andra samtidigt (tunnare linje/stapel i egen färg).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8977;
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
  it('Gjutning', 'Linje J', 'Betong', 7, 11, { baseline_start_date: day(2), baseline_end_date: day(6), baselines: { rev1: [day(5), day(9)] } }),
  it('Montage', 'Linje J', 'Stomme', 3, 9, { baseline_start_date: day(3), baseline_end_date: day(9) }),
  it('Ny', 'Linje K', 'Mark', 12, 14, { baselines: { rev1: [day(12), day(14)] } }),
]);
seed('plan_baselines.json', [{ id: 'main', name: 'Kontraktstidplan', source: 'Kontrakt.ppb' }, { id: 'rev1', name: 'Rev 1 – ÄTA 12', source: 'Rev1.ppb' }]);
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
  await page.check('#ganttShowBaseline'); await page.waitForTimeout(200);
  const pick = await page.evaluate(() => ({ shown: !document.getElementById('ganttBlPick').classList.contains('hidden'), o1: [...document.querySelectorAll('#ganttBaselineSel option')].map(o => o.textContent), o2: [...document.querySelectorAll('#ganttBaseline2Sel option')].map(o => o.textContent), legend: document.getElementById('ganttLegend').innerText }));
  if (!pick.shown || JSON.stringify(pick.o1) !== JSON.stringify(['Kontraktstidplan', 'Rev 1 – ÄTA 12']) || pick.o2.length !== 2 || !/Baseline: Kontraktstidplan · Kontrakt\.ppb/.test(pick.legend)) fail('Väljarna och förklaringen: ' + JSON.stringify(pick));
  const d1 = await page.evaluate(() => [...document.querySelectorAll('#ganttChart .pnote')].map(n => [n.querySelector('.pnote-title').textContent.trim(), (n.querySelector('.pnote-bl-d') || {}).textContent || '', !!n.querySelector('.pnote-bl2')]));
  if (JSON.stringify(d1.find(x => x[0] === 'Gjutning')) !== '["Gjutning","+5 d",false]') fail('Mot kontraktstidplanen: ' + JSON.stringify(d1));
  // Visa revisionen i stället.
  await page.selectOption('#ganttBaselineSel', 'rev1'); await page.waitForTimeout(200);
  const d2 = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#ganttChart .pnote')].map(n => [n.querySelector('.pnote-title').textContent.trim(), [(n.querySelector('.pnote-bl-d') || {}).textContent || '', !!n.querySelector('.pnote-bl')]])));
  if (d2.Gjutning[0] !== '+2 d' || d2.Montage[1] || !d2.Ny[1]) fail('Mot revisionen: ' + JSON.stringify(d2));
  // Jämför: revisionen + kontraktstidplanen (tunn blå linje).
  await page.selectOption('#ganttBaseline2Sel', 'main'); await page.waitForTimeout(200);
  const d3 = await page.evaluate(() => {
    const n = document.querySelector('#ganttChart .pnote[data-item-id="i1"]'), a = n.querySelector('.pnote-bl:not(.pnote-bl2)'), b = n.querySelector('.pnote-bl2');
    return { both: !!a && !!b, below: b && b.getBoundingClientRect().top > a.getBoundingClientRect().top, color: b && getComputedStyle(b).backgroundColor, legend: document.getElementById('ganttLegend').innerText };
  });
  if (!d3.both || !d3.below || d3.color !== 'rgb(37, 99, 235)' || !/Jämför: Kontraktstidplan/.test(d3.legend)) fail('Två baselines samtidigt: ' + JSON.stringify(d3));
  await page.hover('#ganttChart .pnote[data-item-id="i1"] .pnote-title'); await page.waitForTimeout(250);
  const tip = await page.evaluate(() => (document.querySelector('.gantt-tooltip') || {}).innerText || '');
  if (!/Rev 1 – ÄTA 12[\s\S]*2 d senare[\s\S]*Kontraktstidplan[\s\S]*5 d senare/.test(tip) || (tip.match(/Kontraktstidplan/g) || []).length !== 1) fail('Tipsrutan ska visa båda (namnet en gång): ' + tip);
  { const bb = await page.locator('.gantt-tooltip').boundingBox(); await page.screenshot({ path: path.join(require('os').tmpdir(), 'tooltip_baseline.png'), clip: { x: bb.x - 2, y: bb.y - 2, width: bb.width + 4, height: bb.height + 4 } }); }
  await page.mouse.move(0, 0);
  await page.uncheck('#ganttBoardOneLine'); await page.waitForTimeout(150);
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'board_two_baselines.png') });
  await page.check('#ganttBoardOneLine');
  // Staplar: två baseline-staplar.
  await page.click('[data-gantt-view="bars"]'); await page.waitForTimeout(250);
  const bars = await page.evaluate(() => ({ b1: document.querySelectorAll('#ganttChart .gantt-bar-baseline:not(.gantt-bar-baseline2)').length, b2: document.querySelectorAll('#ganttChart .gantt-bar-baseline2').length }));
  if (bars.b1 !== 2 || bars.b2 !== 2) fail('Staplarna ska visa båda baselines: ' + JSON.stringify(bars));
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'bars_two_baselines.png') });
  // Valen sparas.
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  const saved = await page.evaluate(() => [ganttBaselineId, ganttBaseline2Id]);
  if (JSON.stringify(saved) !== '["rev1","main"]') fail('Valen ska sparas: ' + JSON.stringify(saved));
  console.log('OK: välja baseline (Kontraktstidplan / Rev 1), jämföra mot två samtidigt – tavla, staplar, tipsruta, förklaring; valen sparas');
  if (errors.length) fail('Fel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
