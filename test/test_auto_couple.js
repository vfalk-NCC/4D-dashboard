// Visa endast kopplade (Gantt-schemat): isolerar i 3D-modellen bara objekten som är kopplade till aktiviteterna som visas
// (Victor 2026-10-13); följer sökning/filter; ett tryck till visar hela modellen igen.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8997;
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
  it('7426: Fundament SF1, nivå 1', 'SF1', 'Betong', 0, 3),
  it('7421: Platta på mark', 'A', 'Betong', 4, 8),
  it('Utan kod', 'A', 'Mark', 2, 3),
  it('Redan kopplad 7426', 'SF1', 'Betong', 2, 3, { model_id: 'M1', object_id: 'G6' }),
]);
seed('plan_item_activities.json', []);
['plan_milestones.json', 'plan_deliveries.json', 'plan_item_baseline_history.json'].forEach(f => seed(f, []));

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
      markup: { addTextMarkup: m => { (window.__mk = window.__mk || []).push(m); return Promise.resolve(m.map((x, i) => ({ id: 100 + i + (window.__mk.length * 10) }))); }, addArrowMarkup: m => { (window.__ar = window.__ar || []).push(m); return Promise.resolve(m.map((x, i) => ({ id: 500 + i }))); }, removeMarkups: ids => { (window.__mkRm = window.__mkRm || []).push(ids); return Promise.resolve(); } },
      project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) },
      viewer: { isolateEntities: () => Promise.resolve(), setObjectState: () => Promise.resolve(), setCamera: () => Promise.resolve(), getModels: () => Promise.resolve([{ id: 'M1', state: 'loaded' }]), getObjects: () => Promise.resolve([{ modelId: 'M1', objects: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }] }]),
        getObjectProperties: (m, ids) => Promise.resolve(ids.map(id => ({ id, class: 'IfcWall', product: { name: 'Obj' + id }, properties: [{ set: 'Tekla', properties: [{ name: 'Zon', value: id <= 2 ? '7426 SF1 Level 1' : id <= 4 ? '7421' : id === 6 ? '7426 SF1 Level 1' : 'annat' }] }] }))),
        getSelection: () => Promise.resolve([]), convertToObjectIds: (m, r) => Promise.resolve(r.map(x => 'G' + x)), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids.map(x => Number(String(x).slice(1)))), setSelection: s => { (window.__setsel = window.__setsel || []).push(s); return Promise.resolve(); } }
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
  // Testar de klassiska staplarna (Visning → Ny tidslinje av); den nya tidslinjen testas i test_gantt_timeline.js.
  await page.addInitScript(() => localStorage.setItem('4ddash-gantt-classic', '1'));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const fail = m => { throw new Error(m); };
  await page.click('[data-gantt-view="board"]'); await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('ganttAutoCoupleBtn').click());
  await page.waitForSelector('.ac-dlg');
  const rows = () => page.evaluate(() => [...document.querySelectorAll('.ac-row')].map(r => ({ nm: r.querySelector('.ac-nm').childNodes[0].textContent, terms: r.querySelector('[data-terms]').value, n: r.querySelector('.ac-n').childNodes[0].textContent, on: r.querySelector('[data-on]').checked })));
  let r = await rows();
  if (r.length !== 3) fail('3 okopplade aktiviteter: ' + JSON.stringify(r));
  const r1 = r.find(x => x.nm.startsWith('7426')), r2 = r.find(x => x.nm.startsWith('7421'));
  if (!/7426/.test(r1.terms) || !/SF1/.test(r1.terms) || !/nivå 1\/level 1/.test(r1.terms)) fail('förslag på sökord: ' + r1.terms);
  await page.click('[data-read]'); await page.waitForFunction(() => /6 objekt/.test(document.getElementById('acStatus').textContent));
  r = await rows();
  if (r.find(x => x.nm.startsWith('7426')).n !== '3') fail('7426+SF1+nivå1 ska ge 3 träffar (1,2,6): ' + JSON.stringify(r));
  if (r.find(x => x.nm.startsWith('7421')).n !== '2') fail('7421 ska ge 2 träffar');
  if (r.find(x => x.nm === 'Utan kod').on) fail('utan kod ska inte vara förbockad');
  // ändra sökord
  await page.fill('.ac-row:nth-child(2) [data-terms]', 'annat'); await page.waitForTimeout(600);
  r = await rows(); if (!r.some(x => x.n === '1')) fail('ändrade sökord ger 1 träff: ' + JSON.stringify(r));
  await page.fill('.ac-row:nth-child(2) [data-terms]', '7421'); await page.waitForTimeout(600);
  await page.click('.ac-row:nth-child(1) [data-show]'); await page.waitForTimeout(200);
  if (!(await page.evaluate(() => window.__setsel || [])).length) fail('Visa markerar i modellen');
  await page.click('#acGo'); await page.waitForTimeout(300);
  await page.waitForTimeout(900);
  const pi = get('plan_items.json');
  const a = pi.filter(x => /7426: Fund/.test(x.object_name || '') || (x.group_id && pi.some(y => y.group_id === x.group_id && /7426: Fund/.test(y.object_name))));
  const c1 = pi.filter(x => x.model_id && /^G[12]$/.test(x.object_id));
  if (pi.filter(x => x.object_name === '7426: Fundament SF1, nivå 1' && x.model_id).length < 1) fail('7426 kopplad');
  const ids1 = pi.filter(x => x.object_name === '7426: Fundament SF1, nivå 1').map(x => x.object_id).sort().join();
  if (ids1 !== 'G1,G2') fail('7426 ska få G1,G2 (G6 är redan kopplad och hoppas över): ' + ids1);
  const ids2 = pi.filter(x => x.object_name === '7421: Platta på mark').map(x => x.object_id).sort().join();
  if (ids2 !== 'G3,G4') fail('7421 → G3,G4: ' + ids2);
  if (await page.evaluate(() => !!document.querySelector('.ac-dlg'))) fail('dialogen ska stängas');
  if (errors.length) fail('JS-fel: ' + errors.join(' | '));
  console.log('OK test_auto_couple'); await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
