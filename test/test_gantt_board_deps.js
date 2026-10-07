// Tavlan (Victors önskemål 2026-10-06): lapparna på en rad (statusprick, namn, aktivitet, datum i
// grått, framdrift i underkanten), och beroenden via högerklick – "Väntar på…"/"Följs av…" genom
// att klicka på en annan lapp, ta bort med ✕, skydd mot cirkulära beroenden, erbjudande att flytta
// en lapp som startar för tidigt, ångra/gör om. Sparas som depends_on i plan_items.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8973;
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
  it('J10', 'Linje J', 'Kontrefor', 0, 10),                        // i1
  it('J14', 'Linje J', 'Kontrefor', 3, 12),                        // i2 (startar innan J10 är klar)
  it('Gjutning A', 'Linje J', 'Gjutning', 14, 18, { group_id: 'G' }), // i3 – två objekt, en lapp
  it('Gjutning B', 'Linje J', 'Gjutning', 14, 18, { group_id: 'G' }), // i4
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
  const note = name => page.locator('#ganttChart .pnote', { has: page.locator('.pnote-title', { hasText: name }) }).first();

  // 1) En rad: alla lappar 28 px höga, datum och prick på samma rad.
  const one = await page.evaluate(() => [...document.querySelectorAll('#ganttChart .pnote')].map(nn => ({ h: nn.getBoundingClientRect().height, one: nn.classList.contains('pnote-one'), dates: (nn.querySelector('.pnote-dates') || {}).textContent || '', dot: !!nn.querySelector('.pnote-dot'),
    same: (() => { const a = nn.querySelector('.pnote-title').getBoundingClientRect(), b = nn.querySelector('.pnote-dates'); if (!b || getComputedStyle(b).display === 'none') return true; const c = b.getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (c.top + c.bottom) / 2) < 3; })() })));
  if (one.length !== 3 || one.some(o => !o.one || Math.abs(o.h - 28) > 1 || !o.dot || !o.same)) fail('Lapparna ska vara på en rad: ' + JSON.stringify(one));
  if (!/–/.test(one[0].dates) || (await page.evaluate(() => getComputedStyle(document.querySelector('.pnote-dates')).color)) !== 'rgb(107, 114, 128)') fail('Datumet ska stå i grått');
  await page.uncheck('#ganttBoardOneLine'); await page.waitForTimeout(150);
  if (await page.locator('#ganttChart .pnote-one').count()) fail('"En rad" av ska ge de stora lapparna');
  await page.check('#ganttBoardOneLine'); await page.waitForTimeout(150);
  console.log('OK: lapparna på en rad (prick, namn, aktivitet, datum i grått), "En rad" kan slås av');

  // 2) Högerklick utan Redigerbar: menyn visar beroenden men kan inte ändra.
  await note('J14').click({ button: 'right' }); await page.waitForTimeout(100);
  const ro = await page.evaluate(() => ({ menu: !!document.querySelector('.board-dep-menu'), dis: [...document.querySelectorAll('.board-dep-menu [data-add]')].every(b => b.disabled), hint: /Redigerbar/.test(document.querySelector('.board-dep-menu').textContent) }));
  if (!ro.menu || !ro.dis || !ro.hint) fail('Utan Redigerbar ska menyn bara visa: ' + JSON.stringify(ro));
  await page.keyboard.press('Escape');
  await page.check('#ganttEditable'); await page.waitForTimeout(150);

  // 3) J14 väntar på J10: högerklick → Väntar på… → klicka J10. J14 startar för tidigt → flyttas (bekräftas).
  await note('J14').click({ button: 'right' }); await page.click('.board-dep-menu [data-add="pred"]');
  if (!(await page.evaluate(() => document.getElementById('ganttChart').classList.contains('board-linking')))) fail('Väljläget ska synas');
  await note('J10').click(); await page.waitForTimeout(600);
  let rows = get('plan_items.json');
  const j14 = rows.find(r => r.id === 'i2');
  if (JSON.stringify(j14.depends_on) !== '["i1"]') fail('J14 ska vänta på J10: ' + JSON.stringify(j14.depends_on));
  if (!dialogs.some(d => /startar .* innan "J10" är klar/.test(d)) || j14.start_date !== (() => { const d = new Date(rows.find(r => r.id === 'i1').end_date); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })()) fail('J14 ska erbjudas att flyttas till dagen efter J10: ' + JSON.stringify({ dialogs, j14 }));
  console.log('OK: högerklick → Väntar på… → klick på en lapp sparar beroendet och flyttar lappen efter föregångaren');

  // 4) Följs av: Gjutning (två objekt) följer J14 – båda objekten får beroendet; menyn visar det.
  await note('J14').click({ button: 'right' }); await page.click('.board-dep-menu [data-add="succ"]');
  await note('Gjutning').click(); await page.waitForTimeout(600);
  rows = get('plan_items.json');
  if (!['i3', 'i4'].every(id => JSON.stringify(rows.find(r => r.id === id).depends_on) === '["i2"]')) fail('Båda objekten i Gjutning ska vänta på J14: ' + JSON.stringify(rows.map(r => [r.id, r.depends_on])));
  await note('J14').click({ button: 'right' }); await page.waitForTimeout(100);
  const menu = await page.evaluate(() => ({ text: document.querySelector('.board-dep-menu').innerText, pred: document.querySelectorAll('.pnote-dep-pred').length, succ: document.querySelectorAll('.pnote-dep-succ').length, mark: !!document.querySelector('.pnote .pnote-dep') }));
  if (!/Väntar på\s*J10/i.test(menu.text) || !/Följs av\s*Gjutning A \(2 objekt\)/i.test(menu.text) || menu.pred !== 1 || menu.succ !== 1 || !menu.mark) fail('Menyn ska visa och markera beroendena: ' + JSON.stringify(menu));
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.scrollTo(0, 0)); await note('J14').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
  await note('J14').locator('.pnote-title').click(); await page.waitForTimeout(300);
  const tip14 = await page.innerText('.gantt-tooltip');
  if (!/Väntar på[\s\S]*J10[\s\S]*Efterföljande[\s\S]*Gjutning/.test(tip14) || (tip14.match(/Gjutning/g) || []).length !== 1) fail('Tipsrutan ska visa beroendena (Efterföljande, en rad per aktivitet): ' + tip14);
  { const bb = await page.locator('.gantt-tooltip').boundingBox(); await page.screenshot({ path: path.join(require('os').tmpdir(), 'tooltip_deps.png'), clip: { x: bb.x - 2, y: bb.y - 2, width: bb.width + 4, height: bb.height + 4 } }); }
  await page.mouse.move(0, 0);
  console.log('OK: Följs av… på en lapp med flera objekt; menyn listar och markerar det som hör ihop');

  // 5) Cirkel: J10 kan inte vänta på Gjutning (som väntar på J14 som väntar på J10).
  dialogs.length = 0;
  await note('J10').click({ button: 'right' }); await page.click('.board-dep-menu [data-add="pred"]');
  await note('Gjutning').click(); await page.waitForTimeout(300);
  if (!dialogs.some(d => /väntar redan/.test(d)) || get('plan_items.json').find(r => r.id === 'i1').depends_on.length) fail('Cirkulära beroenden ska stoppas: ' + JSON.stringify(dialogs));
  console.log('OK: cirkulära beroenden stoppas');

  // 6) Ta bort med ✕, ångra och gör om.
  await note('Gjutning').click({ button: 'right' }); await page.click('.board-dep-menu .bdm-x[data-kind="pred"]'); await page.waitForTimeout(600);
  if (get('plan_items.json').find(r => r.id === 'i3').depends_on.length) fail('✕ ska ta bort beroendet');
  await page.click('#ganttUndo'); await page.waitForTimeout(600);
  if (JSON.stringify(get('plan_items.json').find(r => r.id === 'i4').depends_on) !== '["i2"]') fail('Ångra ska ge tillbaka beroendet');
  await page.click('#ganttRedo'); await page.waitForTimeout(600);
  if (get('plan_items.json').find(r => r.id === 'i4').depends_on.length) fail('Gör om ska ta bort det igen');
  console.log('OK: ✕ tar bort ett beroende, ångra/gör om fungerar');

  if (errors.length) fail('Fel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
