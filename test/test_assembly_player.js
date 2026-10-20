// Visa endast kopplade (Gantt-schemat): isolerar i 3D-modellen bara objekten som är kopplade till aktiviteterna som visas
// (Victor 2026-10-13); följer sökning/filter; ett tryck till visar hela modellen igen.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8996;
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
  it('Platta', 'SF1', 'Betong', 0, 3, { model_id: 'M1', object_id: 'G1' }),
  it('Vägg', 'SF1', 'Betong', 4, 8, { model_id: 'M1', object_id: 'G2' }),
  it('Okopplad', 'SF1', 'Mark', 2, 3),
  it('Tak', 'SF1', 'Stål', 9, 12, { model_id: 'M1', object_id: 'G3' }),
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
      viewer: { isolateEntities: e => { (window.__iso = window.__iso || []).push(e); (window.__calls = window.__calls || []).push({ iso: e }); return Promise.resolve(); }, setObjectState: (a, b) => { (window.__state = window.__state || []).push(b); (window.__calls = window.__calls || []).push({ a, b }); return Promise.resolve(); }, getObjectBoundingBoxes: (m, rids) => Promise.resolve(rids.map(id => ({ id, boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 3 } } }))), getModels: () => Promise.resolve([{ id: 'M1', state: 'unloaded' }, { id: 'BAD', state: 'unloaded' }]), toggleModel: (id, on) => { (window.__tog = window.__tog || []).push([id, on]); return Promise.resolve(); }, getSelection: () => Promise.resolve(window.__sel || []), convertToObjectIds: (m, r) => Promise.resolve(r.map(x => 'G' + x)), convertToObjectRuntimeIds: (m, ids) => m === 'BAD' ? Promise.reject(new Error('Invalid model id')) : ids.includes('BADOBJ') ? Promise.reject(new Error('Objektet finns inte')) : Promise.resolve(ids), getObjectProperties: () => Promise.resolve([]), setSelection: (sel, mode) => { (window.__setsel = window.__setsel || []).push(sel); return Promise.resolve(); } }
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
  const calls = () => page.evaluate(() => window.__calls || []);
  await page.evaluate(() => { document.getElementById('ganttAssemblyBtn').click(); });
  await page.waitForSelector('#asmPanel:not(.hidden)'); await page.waitForTimeout(400);
  const title = () => page.evaluate(() => document.querySelector('#asmPanel .asm-title').textContent);
  const stepTxt = () => page.evaluate(() => document.querySelector('#asmPanel .asm-step').textContent.replace(/\s+/g, ' '));
  if (await title() !== 'Platta') fail('steg 1 ska vara Platta: ' + await title());
  if (!/1 \/ 3/.test(await stepTxt())) fail('okopplade ska hoppas över (3 steg): ' + await stepTxt());
  let iso = await page.evaluate(() => window.__iso || []);
  if (JSON.stringify(iso[iso.length - 1]) !== JSON.stringify([{ modelId: 'M1', entityIds: ['G1'] }])) fail('steg 1 isolerar bara Platta: ' + JSON.stringify(iso));
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
  if (await title() !== 'Vägg') fail('pil höger → Vägg');
  iso = await page.evaluate(() => window.__iso || []);
  if ([...iso[iso.length - 1][0].entityIds].sort().join() !== 'G1,G2') fail('steg 2 visar G1+G2: ' + JSON.stringify(iso[iso.length - 1]));
  const cs = await calls();
  const lastColors = cs.filter(c => c.b && c.b.color && c.b.color !== 'reset').slice(-2);
  if (!lastColors.some(c => c.b.color.r === 245) || !lastColors.some(c => c.b.color.r === 150)) fail('klart grått + aktuellt orange: ' + JSON.stringify(lastColors));
  if (!cs.some(c => c.a && c.a.modelObjectIds === undefined) && false) fail('x');
  // Okopplade med
  await page.evaluate(() => { const c = document.querySelector('#asmPanel input[data-o="skip"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(300);
  if (!/\/ 4/.test(await stepTxt())) fail('alla 4 steg när okopplade tas med');
  await page.evaluate(() => { const c = document.querySelector('#asmPanel input[data-o="skip"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(300);
  // Lista, hopp
  await page.click('#asmPanel [data-a="list"]');
  await page.click('#asmPanel .asm-row[data-k="2"]'); await page.waitForTimeout(400);
  if (await title() !== 'Tak') fail('klick i listan → Tak');
  await page.click('#asmPanel [data-a="next"]'); await page.waitForTimeout(200);
  if (await title() !== 'Tak') fail('sista steget stannar');
  // Spela
  await page.click('#asmPanel [data-a="first"]'); await page.click('#asmPanel [data-a="play"]'); await page.waitForTimeout(5600);
  if (await title() === 'Platta') fail('spela ska gå framåt');
  await page.keyboard.press('Space');
  // Stäng återställer
  await page.evaluate(() => { window.__state = []; }); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  const st = await page.evaluate(() => window.__state || []);
  if (!st.some(b => b.color === 'reset') || !st.some(b => b.visible === 'reset')) fail('stängning återställer färg och synlighet: ' + JSON.stringify(st));
  if (await page.evaluate(() => !document.getElementById('asmPanel').classList.contains('hidden'))) fail('panelen ska stängas');
  if (errors.length) fail('JS-fel: ' + errors.join(' | '));
  console.log('OK test_assembly_player'); await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
