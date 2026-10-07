// Pilar för kopplingarna, animerad knuff vid dragning (tavla och staplar) och nya aktiviteter
// (Victor 2026-10-06).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8983;
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
  it('Schakt', 'Linje J', 'Mark', 0, 5, { progress: 40 }),                                   // i1
  it('Bergförstärkning', 'Linje J', 'Berg', 0, 8),                         // i2 – slutar senare
  it('Gjutning', 'Linje J', 'Betong', 10, 12, { depends_on: ['i1', 'i2'] }), // i3
  it('Montage', 'Linje J', 'Stomme', 15, 17, { depends_on: ['i3'] }),     // i4
  it('Återfyllning', 'Linje J', 'Mark', 13, 15, { depends_on: ['i3'] }),  // i5 – startar först
  it('Övrigt', 'Linje K', 'Mark', 2, 6, { progress: 75 }),
  it('Stödmur', 'Linje K', 'Betong', 4, 9, { depends_on: ['i6'] }),            // i7 – startar innan i6 är klar                                   // i6
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
  const paths = () => page.evaluate(() => [...document.querySelectorAll('#ganttChart svg.gantt-arrows path.ga')].map(p => `${p.dataset.a}>${p.dataset.b}${p.classList.contains('hot') ? '*' : ''}`).sort());
  await page.waitForTimeout(300);
  let p = await paths();
  if (JSON.stringify(p) !== JSON.stringify(['i1>i3', 'i2>i3', 'i3>i4', 'i3>i5', 'i6>i7'])) fail('Pilar på tavlan: ' + JSON.stringify(p));
  await page.hover('#ganttChart .pnote[data-item-id="i4"] .pnote-title'); await page.waitForTimeout(200);
  p = await paths();
  if (!p.includes('i3>i4*') || p.filter(x => x.endsWith('*')).length !== 1) fail('Pekar man på Montage ska bara dess pil lysa: ' + JSON.stringify(p));
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'board_arrows.png') });
  await page.mouse.move(0, 0);
  await page.uncheck('#ganttShowArrows'); await page.waitForTimeout(200);
  if (await page.locator('#ganttChart svg.gantt-arrows').count()) fail('Pilar av ska ta bort dem');
  await page.check('#ganttShowArrows'); await page.waitForTimeout(300);
  if ((await paths()).length !== 5) fail('Pilar på igen');
  // Framdriften i procent på linjen.
  const pct = await page.evaluate(() => [...document.querySelectorAll('#ganttChart .pnote-pct')].map(b => b.textContent).sort());
  if (JSON.stringify(pct) !== JSON.stringify(['40 %', '75 %'])) fail('Procenten på framdriftslinjen: ' + JSON.stringify(pct));
  // Pilen in mot efterföljaren slutar med en rak bit från vänster (pilspetsen pekar rakt in).
  const ends = await page.evaluate(() => [...document.querySelectorAll('#ganttChart svg.gantt-arrows path.ga')].map(p => /H[\d.]+$/.test(p.getAttribute('d'))));
  if (ends.some(x => !x)) fail('Varje pil ska sluta med en rak bit in');
  await page.uncheck('#ganttBoardOneLine'); await page.waitForTimeout(300);
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'board_arrows_big.png') });
  await page.check('#ganttBoardOneLine'); await page.waitForTimeout(300);
  console.log('OK: pilar för kopplingarna på tavlan – den hovrade aktivitetens pilar lyser, kan släckas');

  // Dra Gjutning (i3) +3 dagar: Återfyllning och Montage glider med medan man drar.
  await page.check('#ganttEditable'); await page.waitForTimeout(200);
  const dayPx = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.board-grid')).getPropertyValue('--day')));
  let b = await page.locator('#ganttChart .pnote[data-item-id="i3"]').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dayPx * 3, b.y + b.height / 2, { steps: 6 }); await page.waitForTimeout(300);
  const live = await page.evaluate(() => [...document.querySelectorAll('#ganttChart .ga-pushed')].map(n => [n.dataset.itemId, n.style.transform]));
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'board_push.png') });
  if (live.length !== 2 || !live.every(([, t]) => /translateX\(\d/.test(t))) fail('Beroende ska glida med under dragningen: ' + JSON.stringify(live));
  await page.mouse.up(); await page.waitForTimeout(800);
  let rows = get('plan_items.json');
  const r5 = rows.find(r => r.id === 'i5'), r3 = rows.find(r => r.id === 'i3');
  if (r3.start_date !== day(13) || r5.start_date !== day(16)) fail('Knuffen ska sparas: ' + JSON.stringify([r3.start_date, r5.start_date, day(13), day(16)]));
  console.log('OK: tavlan – beroende aktiviteter glider med medan man drar och sparas framskjutna');

  // Staplar: pilar och knuff.
  await page.click('[data-gantt-view="bars"]'); await page.waitForTimeout(300);
  if ((await paths()).length !== 5) fail('Pilar i staplarna: ' + JSON.stringify(await paths()));
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'bars_arrows.png') });
  b = await page.locator('#ganttChart .gantt-bar[data-item-id="i2"]').boundingBox();
  const pxd = await page.evaluate(() => { const t = document.querySelector('#ganttChart .gantt-bar[data-item-id="i2"]'); return t.getBoundingClientRect().width / 9; });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + pxd * 8, b.y + b.height / 2, { steps: 8 }); await page.waitForTimeout(300);
  const liveB = await page.evaluate(() => [...document.querySelectorAll('#ganttChart .ga-pushed')].map(n => n.dataset.itemId).sort());
  if (!liveB.includes('i3')) fail('Staplarna: beroende ska glida med: ' + JSON.stringify(liveB));
  await page.mouse.up(); await page.waitForTimeout(800);
  rows = get('plan_items.json');
  if (rows.find(r => r.id === 'i2').end_date <= day(8) || rows.find(r => r.id === 'i3').start_date <= day(13)) fail('Staplarna: knuffen ska sparas: ' + JSON.stringify(rows.map(r => [r.id, r.start_date, r.end_date])));
  // Dra i högerkanten på Montage: stapeln blir längre direkt, kortare när man drar tillbaka.
  b = await page.locator('#ganttChart .gantt-bar[data-item-id="i4"]').boundingBox();
  const w0 = b.width, pxd2 = w0 / 3;
  await page.mouse.move(b.x + b.width - 3, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width - 3 + pxd2 * 4, b.y + b.height / 2, { steps: 6 }); await page.waitForTimeout(250);
  const wLong = (await page.locator('#ganttChart .gantt-bar[data-item-id="i4"]').boundingBox()).width;
  await page.mouse.move(b.x + b.width - 3 + pxd2 * 1, b.y + b.height / 2, { steps: 4 }); await page.waitForTimeout(250);
  const wShort = (await page.locator('#ganttChart .gantt-bar[data-item-id="i4"]').boundingBox()).width;
  if (!(wLong > w0 + pxd2 * 3) || !(wShort < wLong && wShort > w0)) fail('Stapeln ska växa och krympa medan man drar: ' + JSON.stringify({ w0, wLong, wShort }));
  await page.mouse.up(); await page.waitForTimeout(800);
  if (get('plan_items.json').find(r => r.id === 'i4').end_date === day(17)) fail('Nytt slut ska sparas');
  console.log('OK: staplarna – pilar, och beroende staplar glider med och sparas framskjutna');

  // Ny aktivitet efter Återfyllning (högerklick på tavlan).
  await page.click('[data-gantt-view="board"]'); await page.waitForTimeout(300);
  await page.click('#ganttChart .pnote[data-item-id="i5"] .pnote-title', { button: 'right' });
  await page.click('.board-dep-menu [data-new-after]'); await page.waitForTimeout(150);
  const pref = await page.evaluate(() => ({ area: document.querySelector('.na-area').value, pred: document.querySelector('.na-pred').value, start: document.querySelector('.na-start').value }));
  const i5 = get('plan_items.json').find(r => r.id === 'i5');
  if (pref.area !== 'Linje J' || pref.pred !== 'i5' || pref.start !== (() => { const d = new Date(i5.end_date); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })()) fail('Förifyllt från aktiviteten: ' + JSON.stringify(pref));
  await page.fill('.na-name', 'Gjutning etapp 2');
  await page.locator('.new-act-pop').screenshot({ path: path.join(require('os').tmpdir(), 'new_activity.png') });
  await page.click('.na-save'); await page.waitForTimeout(900);
  rows = get('plan_items.json');
  const nw = rows.find(r => r.object_name === 'Gjutning etapp 2');
  if (!nw || nw.origin !== 'manuell' || JSON.stringify(nw.depends_on) !== '["i5"]' || nw.area !== 'Linje J' || nw.source_key !== null) fail('Ny aktivitet sparad med samma uppbyggnad: ' + JSON.stringify(nw));
  await page.waitForTimeout(300);
  if (!(await page.locator(`#ganttChart .pnote[data-item-id="${nw.id}"] .pnote-own`).count()) || !(await paths()).includes(`i5>${nw.id}`)) fail('Den nya ska synas som Egen med pil');
  await page.click('#modelToast button'); await page.waitForTimeout(800);
  if (get('plan_items.json').some(r => r.object_name === 'Gjutning etapp 2')) fail('Ångra ska ta bort den');
  // Knappen ＋ Aktivitet.
  await page.click('#ganttAddBtn'); await page.waitForTimeout(150);
  await page.fill('.na-name', 'Egen stödmur'); await page.fill('.na-area', 'Linje K');
  await page.click('.na-save'); await page.waitForTimeout(900);
  if (!get('plan_items.json').some(r => r.object_name === 'Egen stödmur' && r.area === 'Linje K' && r.origin === 'manuell')) fail('＋ Aktivitet');
  console.log('OK: ny aktivitet (knappen och "Ny aktivitet efter den här") – samma uppbyggnad, märkt Egen, pil från föregångaren, Ångra');

  // Ta bort lappar: egen (vanlig fråga) och importerad (varning), kopplingar städas, Ångra.
  const dlg = [];
  page.on('dialog', d => dlg.push(d.message()));
  await page.waitForTimeout(300);
  const own = get('plan_items.json').find(r => r.object_name === 'Egen stödmur');
  await page.click(`#ganttChart .pnote[data-item-id="${own.id}"] .pnote-title`, { button: 'right' });
  await page.click('.board-dep-menu [data-delete]'); await page.waitForTimeout(900);
  if (get('plan_items.json').some(r => r.id === own.id) || /kommer tillbaka/.test(dlg[dlg.length - 1] || '')) fail('Egen lapp ska tas bort efter en vanlig fråga: ' + JSON.stringify(dlg));
  await page.click('#ganttChart .pnote[data-item-id="i6"] .pnote-title', { button: 'right' });
  await page.click('.board-dep-menu [data-delete]'); await page.waitForTimeout(900);
  let rowsD = get('plan_items.json');
  if (rowsD.some(r => r.id === 'i6') || JSON.stringify(rowsD.find(r => r.id === 'i7').depends_on) !== '[]' || !/kommer tillbaka vid nästa import/.test(dlg[dlg.length - 1])) fail('Importerad lapp: varning, borttagen, kopplingen städad: ' + JSON.stringify(dlg));
  if ((await paths()).some(x => x.startsWith('i6>'))) fail('Pilen ska försvinna');
  await page.click('#modelToast button'); await page.waitForTimeout(900);
  rowsD = get('plan_items.json');
  if (!rowsD.some(r => r.id === 'i6') || JSON.stringify(rowsD.find(r => r.id === 'i7').depends_on) !== '["i6"]') fail('Ångra ska lägga tillbaka lappen och kopplingen');
  await page.waitForTimeout(300);
  if (!(await paths()).includes('i6>i7')) fail('Pilen ska komma tillbaka');
  // Soptunnan på lappen (syns när man pekar).
  await page.hover('#ganttChart .pnote[data-item-id="i4"] .pnote-title'); await page.waitForTimeout(250);
  if (Number(await page.evaluate(() => getComputedStyle(document.querySelector('#ganttChart .pnote[data-item-id="i4"] .pnote-trash')).opacity)) < 0.5) fail('Soptunnan ska synas när man pekar');
  await page.locator('#ganttChart .pnote[data-item-id="i4"]').screenshot({ path: path.join(require('os').tmpdir(), 'note_trash.png') });
  await page.click('#ganttChart .pnote[data-item-id="i4"] .pnote-trash'); await page.waitForTimeout(900);
  if (get('plan_items.json').some(r => r.id === 'i4')) fail('Soptunnan ska ta bort lappen');
  await page.click('#modelToast button'); await page.waitForTimeout(900);
  // Staplarna: soptunna på raden.
  await page.click('[data-gantt-view="bars"]'); await page.waitForTimeout(300);
  await page.hover('#ganttChart .gantt-bar[data-item-id="i4"]'); await page.waitForTimeout(150);
  await page.click('.gantt-row-trash[data-trash-id="i4"]'); await page.waitForTimeout(900);
  if (get('plan_items.json').some(r => r.id === 'i4')) fail('Soptunnan i staplarna');
  await page.click('#modelToast button'); await page.waitForTimeout(900);
  if (!get('plan_items.json').some(r => r.id === 'i4')) fail('Ångra i staplarna');
  console.log('OK: ta bort lappar – egen direkt, importerad med varning; kopplingarna städas; Ångra lägger tillbaka; soptunna på lappen och raden');
  if (errors.length) fail('Fel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
