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
  // Färg (förvald gul, valbar) och länken mellan baseline och lappen.
  const look = await page.evaluate(() => {
    const n = document.querySelector('#ganttChart .pnote[data-item-id="i1"]'), l = n.querySelector('.pnote-bl'), k = n.querySelector('.pnote-bl-link');
    const lr = l.getBoundingClientRect(), kr = k && k.getBoundingClientRect(), nr = n.getBoundingClientRect();
    return { color: getComputedStyle(l).backgroundColor, link: !!k, joins: k ? Math.abs(kr.left - lr.right) < 1.5 && Math.abs(kr.right - nr.left) < 1.5 : false, i2link: !!document.querySelector('.pnote[data-item-id="i2"] .pnote-bl-link') };
  });
  if (look.color !== 'rgb(245, 158, 11)' || !look.link || !look.joins || look.i2link) fail('Baseline gul och med en länk till lappen: ' + JSON.stringify(look));
  await page.locator('#ganttBaselineColor').evaluate(el => { el.value = '#2563eb'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(100);
  if (await page.evaluate(() => getComputedStyle(document.querySelector('.pnote-bl')).backgroundColor) !== 'rgb(37, 99, 235)') fail('Färgen ska gå att välja');
  await page.locator('#ganttBaselineColor').evaluate(el => { el.value = '#f59e0b'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.hover('#ganttChart .pnote[data-item-id="i1"] .pnote-title'); await page.waitForTimeout(150);
  const hov = await page.evaluate(() => ({ mine: parseFloat(getComputedStyle(document.querySelector('.pnote[data-item-id="i1"] .pnote-bl')).height), other: getComputedStyle(document.querySelector('.pnote[data-item-id="i3"] .pnote-bl')).opacity }));
  if (hov.mine < 5.5 || Number(hov.other) > 0.3) fail('Pekar man på en lapp ska dess baseline lyftas fram: ' + JSON.stringify(hov));
  console.log('OK: baseline gul (valbar färg), streckad länk till lappen, lyfts fram när man pekar på lappen');
  await page.uncheck('#ganttBoardOneLine'); await page.waitForTimeout(150);
  await page.hover('#ganttChart .pnote[data-item-id="i1"] .pnote-title'); await page.waitForTimeout(150);
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'board_baseline_big.png') });
  await page.check('#ganttBoardOneLine'); await page.mouse.move(0, 0); await page.waitForTimeout(150);
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'board_baseline.png') });
  console.log('OK: tavlan – grå baseline-linje under lappen, +5 d / -2 d, förklaringen säger varifrån');

  // "Bara ± dagar": bara etiketterna, inga linjer; knappen syns bara när Baseline är på.
  await page.check('#ganttBaselineDays'); await page.waitForTimeout(200);
  const only = await page.evaluate(() => ({ lines: document.querySelectorAll('#ganttChart .pnote-bl, #ganttChart .pnote-bl-link').length, chips: [...document.querySelectorAll('#ganttChart .pnote-bl-d')].map(c => c.textContent) }));
  if (only.lines || JSON.stringify(only.chips.sort()) !== JSON.stringify(['+5 d', '-2 d'].sort())) fail('Bara ± dagar på tavlan: ' + JSON.stringify(only));
  await page.click('[data-gantt-view="bars"]'); await page.waitForTimeout(250);
  const onlyBars = await page.evaluate(() => ({ bars: document.querySelectorAll('#ganttChart .gantt-bar-baseline').length, chips: [...document.querySelectorAll('#ganttChart .gantt-bl-d')].map(c => c.textContent) }));
  if (onlyBars.bars || onlyBars.chips.length !== 2) fail('Bara ± dagar i staplarna: ' + JSON.stringify(onlyBars));
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'bars_days_only.png') });
  await page.click('[data-gantt-view="board"]'); await page.waitForTimeout(250);
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'board_days_only.png') });
  await page.uncheck('#ganttBaselineDays'); await page.waitForTimeout(200);
  if (!(await page.locator('#ganttChart .pnote-bl').count())) fail('Av igen ska linjerna tillbaka');
  // Redigerbar: soptunnan och baseline-etiketten får inte överlappa (stora lappar och en rad).
  await page.uncheck('#ganttBaselineDays'); await page.check('#ganttEditable'); await page.waitForTimeout(200);
  for (const one of [true, false]) {
    if (one) await page.check('#ganttBoardOneLine'); else await page.uncheck('#ganttBoardOneLine');
    await page.waitForTimeout(250);
    await page.hover('#ganttChart .pnote[data-item-id="i1"] .pnote-title'); await page.waitForTimeout(250);
    const ov = await page.evaluate(() => { const n = document.querySelector('#ganttChart .pnote[data-item-id="i1"]'); const a = n.querySelector('.pnote-trash').getBoundingClientRect(), b = n.querySelector('.pnote-bl-d').getBoundingClientRect(); return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top); });
    if (ov) fail('Soptunnan krockar med baseline-etiketten (' + (one ? 'en rad' : 'stora lappar') + ')');
    if (!one) await page.locator('#ganttChart .pnote[data-item-id="i1"]').screenshot({ path: require('path').join(require('os').tmpdir(), 'note_trash_bl.png') });
  }
  await page.check('#ganttBoardOneLine'); await page.uncheck('#ganttEditable'); await page.mouse.move(0, 0); await page.waitForTimeout(200);
  console.log('OK: "Bara ± dagar" – bara förskjutningen (+5 d / -2 d) syns, utan baseline-linjer, på tavlan och i staplarna');

  // Tipsrutan.
  // Tipsrutan visas vid klick (inte vid hovring).
  await page.hover('#ganttChart .pnote[data-item-id="i1"] .pnote-title'); await page.waitForTimeout(250);
  if (!(await page.evaluate(() => { const t = document.querySelector('.gantt-tooltip'); return !t || t.classList.contains('hidden'); }))) fail('Hovring ska inte visa tipsrutan');
  await page.click('#ganttChart .pnote[data-item-id="i1"] .pnote-title'); await page.waitForTimeout(250);
  const tip = await page.evaluate(() => (document.querySelector('.gantt-tooltip') || {}).innerText || '');
  if (!/Baseline/.test(tip) || !/5 d senare/.test(tip)) fail('Tipsrutan ska visa baseline: ' + tip);

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
  if (await page.isVisible('#ganttBaselineDaysPill')) fail('Bara ± dagar ska bara synas när Baseline är på');
  if (await page.locator('#ganttChart .gantt-bar-baseline').count()) fail('Av ska ta bort baseline-staplarna');
  if (!(await page.evaluate(() => Object.values(localStorage).some(v => /"baseline":false/.test(v))))) fail('Valet ska sparas');
  console.log('OK: staplarna – grå baseline-stapel under den planerade; tipsrutan; valet sparas');

  if (errors.length) fail('Fel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
