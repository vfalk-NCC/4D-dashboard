// Hovring (Victor 2026-10-06): lappen lyfts, närmaste kopplade aktivitet bakåt och framåt (högst en åt
// varje håll) markeras med en diskret puls och en etikett.
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
  it('Schakt', 'Linje J', 'Mark', 0, 5),                                   // i1
  it('Bergförstärkning', 'Linje J', 'Berg', 0, 8),                         // i2 – slutar senare
  it('Gjutning', 'Linje J', 'Betong', 10, 12, { depends_on: ['i1', 'i2'] }), // i3
  it('Montage', 'Linje J', 'Stomme', 15, 17, { depends_on: ['i3'] }),     // i4
  it('Återfyllning', 'Linje J', 'Mark', 13, 15, { depends_on: ['i3'] }),  // i5 – startar först
  it('Övrigt', 'Linje K', 'Mark', 2, 6),                                   // i6
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
  const state = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#ganttChart .pnote')].map(n => [n.querySelector('.pnote-title').textContent.trim(), [n.classList.contains('pnote-hot') ? 'hot' : n.classList.contains('pnote-near-pred') ? 'pred' : n.classList.contains('pnote-near-succ') ? 'succ' : '', (n.querySelector('.near-tag') || {}).textContent || '']])));
  await page.hover('#ganttChart .pnote[data-item-id="i3"] .pnote-title'); await page.waitForTimeout(400);
  let st = await state();
  if (st.Gjutning[0] !== 'hot' || st['Bergförstärkning'][0] !== 'pred' || st.Schakt[0] || st['Återfyllning'][0] !== 'succ' || st.Montage[0] || st['Övrigt'][0]
    || !/◀ Före \(närmast av 2\)/.test(st['Bergförstärkning'][1]) || !/Efter ▶ \(närmast av 2\)/.test(st['Återfyllning'][1])) fail('Närmast före/efter, en åt varje håll: ' + JSON.stringify(st));
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.pnote-near-pred')).animationName);
  if (anim !== 'nearPulse') fail('Den närmaste ska pulsera: ' + anim);
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'board_near.png') });
  await page.mouse.move(0, 0); await page.waitForTimeout(200);
  st = await state();
  if (Object.values(st).some(v => v[0] || v[1])) fail('Markeringen ska försvinna: ' + JSON.stringify(st));
  console.log('OK: tavlan – hovrad lapp lyfts, närmaste föregångare (slutar senast) och efterföljare (startar först) pulserar med etikett');
  // Fokus: det som inte är kopplat tonas ut när man pekar (efter en kort stund) och låses vid klick.
  const focus = () => page.evaluate(() => ({ mode: document.getElementById('ganttChart').classList.contains('focus-mode'), linked: [...document.querySelectorAll('#ganttChart .pnote.focus-linked')].map(n => n.dataset.itemId).sort(), dimOp: Number(getComputedStyle(document.querySelector('#ganttChart .pnote[data-item-id="i6"]')).opacity) }));
  await page.hover('#ganttChart .pnote[data-item-id="i3"] .pnote-title'); await page.waitForTimeout(600);
  let f = await focus();
  if (!f.mode || JSON.stringify(f.linked) !== JSON.stringify(['i1', 'i2', 'i3', 'i4', 'i5']) || f.dimOp > 0.5) fail('Pekar man ska det okopplade tonas ut: ' + JSON.stringify(f));
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'board_focus.png') });
  await page.mouse.move(0, 0); await page.waitForTimeout(400);
  if ((await focus()).mode) fail('Fokus ska släppa när man pekar bort');
  await page.click('#ganttChart .pnote[data-item-id="i3"] .pnote-title'); await page.waitForTimeout(300);
  await page.mouse.move(0, 0); await page.waitForTimeout(400);
  if (!(await focus()).mode) fail('Klick ska låsa fokus');
  await page.evaluate(() => { window.scrollBy(0, 40); document.getElementById('ganttChart').scrollLeft += 30; document.dispatchEvent(new Event('scroll')); }); await page.waitForTimeout(300);
  if (!(await focus()).mode || await page.evaluate(() => document.querySelector('.gantt-tooltip').classList.contains('hidden'))) fail('Fokus och tipsrutan ska ligga kvar när man scrollar');
  await page.mouse.click(1300, 20); await page.waitForTimeout(400);
  if ((await focus()).mode) fail('Klick utanför ska släppa fokus');
  console.log('OK: fokus – det okopplade tonas ut när man pekar (efter en kort stund), låses vid klick, släpps vid klick utanför');
  // Staplar.
  await page.click('[data-gantt-view="bars"]'); await page.waitForTimeout(250);
  await page.hover('#ganttChart .gantt-bar[data-item-id="i3"]'); await page.waitForTimeout(300);
  const bars = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#ganttChart .gantt-bar[data-item-id]')].map(b => [b.dataset.itemId, b.className.match(/bar-(hot|near-pred|near-succ)/)?.[1] || ''])));
  if (bars.i3 !== 'hot' || bars.i2 !== 'near-pred' || bars.i5 !== 'near-succ' || bars.i1 || bars.i4) fail('Staplarna: ' + JSON.stringify(bars));
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'bars_near.png') });
  console.log('OK: staplarna – samma markering');
  if (errors.length) fail('Fel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
