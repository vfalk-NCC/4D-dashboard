// Tidslinjen: HTML-fil till Claude, ändringslistan läses in, före/efter visas och tillämpas (med Ångra).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8979;
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
  it('Fundament J', 'PRODUKTION / 742A Krönlinje J', 'Fundament', -3, 6, { model_id: 'M1', object_id: 'o1', progress: 45, baseline_start_date: day(-8), baseline_end_date: day(1) }),
  it('Platta A', 'PRODUKTION / 742A Krönlinje J', 'Platta', 7, 12, { model_id: 'M1', object_id: 'o5', depends_on: ['i1'], group_id: 'g1' }),
  it('Platta B', 'PRODUKTION / 742A Krönlinje J', 'Platta', 7, 12, { model_id: 'M1', object_id: 'o6', depends_on: ['i1'], group_id: 'g1' }),
  it('Stödmur', 'PRODUKTION / 742C Stödmur', 'Stödmur', -4, 12, { model_id: 'M1', object_id: 'o3', progress: 16, contractor: 'Procyon' }),
  it('Mobilkran', 'PRODUKTION / 742C Stödmur', 'Kran', 0, 10, { temporary: true }),
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
      viewer: { getSelection: () => Promise.resolve(window.__sel || []), convertToObjectIds: () => Promise.resolve([]), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids.map((x, i) => i + 1)), getObjectProperties: (m, rids) => Promise.resolve(rids.map(id => ({ id, properties: [{ name: 'Produkt', properties: [{ name: 'Namn', value: 'Vägg ' + id }, { name: 'HPM', value: 'Typ' + id }] }] }))),
        getCamera: () => Promise.resolve(window.__cam || { position: { x: 0, y: -40, z: 20 }, target: { x: 0, y: 0, z: 0 }, fov: 60 }),
        getObjectBoundingBoxes: (m, rids) => Promise.resolve(rids.map(id => ({ id, boundingBox: { min: { x: -20 + id * 10, y: -2, z: 0 }, max: { x: -15 + id * 10, y: 2, z: 3 } } }))),
        getSnapshot: () => { const c = document.createElement('canvas'); c.width = 1200; c.height = 700; const x = c.getContext('2d'); x.fillStyle = '#e9edf0'; x.fillRect(0, 0, 1200, 700); x.fillStyle = '#6fbf73'; x.fillRect(300, 350, 600, 200); return Promise.resolve(c.toDataURL('image/png')); },
        setSelection: () => Promise.resolve(), setCamera: () => Promise.resolve() },
      markup: { removeMarkups: () => Promise.resolve() }
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
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const ST = () => page.evaluate(() => ({ rows: document.querySelectorAll('.tl-root .g-row[data-row]').length, bars: document.querySelectorAll('.tl-root .g-bar').length, temp: document.querySelectorAll('.tl-root .g-bar.temp').length, ghost: document.querySelectorAll('.tl-root .g-ghost').length }));
  let s = await ST();
  if (s.rows !== 4 || s.bars !== 4) fail('En rad per aktivitet (Platta A+B slås ihop): ' + JSON.stringify(s));
  if (s.temp !== 1) fail('Temporär ska vara streckad: ' + JSON.stringify(s));
  // Ljusa statusfärger: stapeln ska ändå synas (kant) – t.ex. Planerad inställd på nästan vit
  await page.evaluate(() => { STATUS_COLORS.planerad = '#ffffff'; renderGantt(getFilteredItems()); });
  const bw = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.tl-root .g-bar.planerad')); return c.borderTopWidth + '|' + c.borderTopColor; });
  if (!/^1px\|rgba\(15, 23, 42/.test(bw)) fail('Vita staplar ska ha kant: ' + bw);
  await page.evaluate(() => { STATUS_COLORS.planerad = '#94a3b8'; renderGantt(getFilteredItems()); });
  // klick på stapel: detaljer, pilar
  await page.click('.tl-root .g-bar[data-ref="i1"]'); await page.waitForSelector('#tlPop:not([hidden])');
  if (!(await page.locator('#tlInfo .gi-head h3').textContent()).includes('Fundament')) fail('Detaljpanelen ska visa vald aktivitet');
  if ((await page.locator('.tl-root .g-dep path.dp').count()) < 1) fail('Beroendepil ska visas för vald aktivitet');
  // kedja framåt
  await page.click('#tlPop [data-act="fw"]'); await page.waitForTimeout(200);
  if ((await page.locator('#tlMode [data-tl="endchain"]').count()) !== 1) fail('Kedjevy ska visas');
  await page.click('#tlMode [data-tl="endchain"]'); await page.waitForTimeout(200);
  // baslinje
  await page.evaluate(() => { ganttShowBaseline = true; renderGantt(getFilteredItems()); });
  s = await ST(); if (s.ghost < 1) fail('Baslinjens ghost-stapel ska visas: ' + JSON.stringify(s));
  await page.evaluate(() => { ganttBaselineDaysOnly = true; renderGantt(getFilteredItems()); });
  if ((await page.locator('.tl-root .g-sh').count()) < 1) fail('Bara ± dagar ska visa förskjutning');
  await page.evaluate(() => { ganttBaselineDaysOnly = false; ganttShowBaseline = false; renderGantt(getFilteredItems()); });
  // kritisk väg
  await page.click('[data-tl="crit"]'); await page.waitForTimeout(200);
  if ((await page.locator('.tl-root .g-bar.crit').count()) < 1) fail('Kritisk väg ska markeras');
  await page.click('[data-tl="crit"]');
  // gruppering och fällning
  await page.evaluate(() => { ganttGroupBy = 'area'; renderGantt(getFilteredItems()); });
  const gr = await page.locator('.tl-root .g-group').count(); if (gr !== 2) fail('Två områdesgrupper: ' + gr);
  await page.click('.tl-root .g-group >> nth=0'); await page.waitForTimeout(200);
  if ((await page.locator('.tl-root .g-row[data-row]').count()) >= 4) fail('Fälld grupp ska dölja rader');
  // högerklick på grupp → dashboardens meny
  await page.click('.tl-root .g-group >> nth=0', { button: 'right' }); await page.waitForSelector('#ganttGroupMenu');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { ganttGroupBy = ''; ganttCollapsedGroups.clear(); renderGantt(getFilteredItems()); });
  // klick på namnet: markera i 3D
  await page.evaluate(() => { window.__sel3d = null; window.selectActivityInModel = async it => { window.__sel3d = (it.members || [it]).map(m => m.id); }; });
  await page.click('.tl-root .g-lab[data-item-id="i1"]'); await page.waitForTimeout(200);
  const sel3d = await page.evaluate(() => window.__sel3d); if (!sel3d || !sel3d.length) fail('Klick på namnet ska markera i 3D: ' + JSON.stringify(sel3d));
  // dubbelklick: redigera
  await page.evaluate(() => { ganttEditable = true; renderGantt(getFilteredItems()); });
  await page.click('.tl-root .g-bar[data-ref="i1"]'); await page.waitForTimeout(100); await page.click('.tl-root .g-bar[data-ref="i1"]'); await page.waitForTimeout(400);
  if (!(await page.locator('.new-act-pop').count())) fail('Dubbelklick ska öppna redigering');
  await page.evaluate(() => { document.querySelectorAll('.new-act-pop').forEach(x => x.remove()); });
  // dra för att flytta (redigerbart läge) och Ångra
  await page.evaluate(() => { ganttEditable = true; renderGantt(getFilteredItems()); });
  const d0 = await page.evaluate(() => items.find(x => x.id === 'i4').startDate);
  const bb = await page.locator('.tl-root .g-bar[data-ref="i4"]').boundingBox(), ppd = await page.evaluate(() => TL.last.ppd);
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(bb.x + bb.width / 2 + ppd * 3 + 2, bb.y + bb.height / 2, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(900);
  const d1 = await page.evaluate(() => items.find(x => x.id === 'i4').startDate);
  if (d1 === d0 || Math.round((Date.parse(d1) - Date.parse(d0)) / 864e5) !== 3) fail('Dra ska flytta 3 dagar: ' + d0 + ' → ' + d1);
  await page.evaluate(() => document.getElementById('ganttUndo').click()); await page.waitForTimeout(900);
  if ((await page.evaluate(() => items.find(x => x.id === 'i4').startDate)) !== d0) fail('Ångra ska återställa');
  // tidslinjens datumstreck och zoom
  await page.evaluate(() => { ganttEditable = false; ganttMode = 'time'; ganttAsOf = todayISO(); renderGantt(getFilteredItems()); });
  await page.waitForTimeout(300);
  if (!(await page.locator('.tl-root .g-asof').count())) fail('Datumstrecket ska visas i tidsläget');
  await page.evaluate(() => { ganttMode = 'off'; ganttAsOf = null; ganttZoomPxPerDay = 18; renderGantt(getFilteredItems()); });
  if ((await page.evaluate(() => TL.last.ppd)) !== 18) fail('Zoom ska gälla');
  // snabbknappar för period: 4 v, 6 v, 3 mån, 6 mån, 12 mån, Allt
  const labs = await page.evaluate(() => [...document.querySelectorAll('.gantt-range-row .gantt-chip')].map(b => b.textContent.trim()));
  if (JSON.stringify(labs) !== JSON.stringify(['4 v', '6 v', '3 mån', '6 mån', '12 mån', 'Allt'])) fail('Periodknappar: ' + JSON.stringify(labs));
  for (const w of [4, 6, 13, 26, 52]) {
    await page.evaluate(w2 => document.querySelector(`[data-gantt-weeks="${w2}"]`).click(), w); await page.waitForTimeout(150);
    const r = await page.evaluate(w2 => ({ a: ganttRangeStart, b: ganttRangeEnd, e: ganttWeeksRange(w2), on: document.querySelector(`[data-gantt-weeks="${w2}"]`).classList.contains('active'), days: TL.last ? TL.last.tot : 0 }), w);
    if (r.a !== r.e[0] || r.b !== r.e[1] || !r.on || r.days < w * 7 - 1) fail('Period ' + w + ' v: ' + JSON.stringify(r));
  }
  await page.click('#ganttRangeReset'); await page.waitForTimeout(150);
  if ((await page.evaluate(() => ganttRangeStart || ganttRangeEnd))) fail('Allt ska nollställa perioden');
  // klassiska staplar
  await page.click('[data-tl="classic"]'); await page.waitForTimeout(300);
  if ((await page.locator('.tl-root .g-bar').count()) !== 0 || (await page.locator('.gantt-bar').count()) < 1) fail('Klassiska staplar ska kunna väljas');
  await page.evaluate(() => tlSetClassic(false)); await page.waitForTimeout(300);
  if ((await page.locator('.tl-root .g-bar').count()) < 1) fail('Ny tidslinje ska kunna slås på igen');
  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK'); await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
