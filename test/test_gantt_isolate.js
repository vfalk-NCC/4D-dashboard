// Visa endast kopplade (Gantt-schemat): isolerar i 3D-modellen bara objekten som är kopplade till aktiviteterna som visas
// (Victor 2026-10-13); följer sökning/filter; ett tryck till visar hela modellen igen.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8987;
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
  it('Gjutning', 'Linje J', 'Betong', 0, 5, { source_key: 'pp:1', origin: 'powerproject' }),            // i1 – okopplad
  it('Schakt', 'Linje K', 'Mark', 6, 9, { model_id: 'M1', object_id: 'G5' }),                           // i2 – kopplad
  it('Armering', 'Linje K', 'Betong', 3, 8, { model_id: 'M1', object_id: 'G7' }),                       // i3 – kopplad
]);
seed('plan_item_activities.json', [{ id: 'a1', plan_item_id: 'i1', name: 'Form', start_date: day(0), end_date: day(2) }]);
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
      project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) },
      viewer: { isolateEntities: e => { (window.__iso = window.__iso || []).push(e); return Promise.resolve(); }, setObjectState: (a, b) => { (window.__state = window.__state || []).push(b); return Promise.resolve(); }, getSelection: () => Promise.resolve(window.__sel || []), convertToObjectIds: (m, r) => Promise.resolve(r.map(x => 'G' + x)), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids), getObjectProperties: () => Promise.resolve([]), setSelection: () => Promise.resolve() }
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
  const row = id => get('plan_items.json').find(r => r.id === id);
  const opts = () => page.evaluate(() => { const l = [...document.querySelectorAll('.new-act-pop .cb-list')].find(x => !x.hidden); return l ? [...l.querySelectorAll('.cb-opt')].map(o => o.querySelector('.cb-l').textContent + (o.querySelector('.cb-n') ? ' | ' + o.querySelector('.cb-n').textContent : '')) : null; });
  const rows = () => get('plan_items.json');
  await page.click('[data-gantt-view="board"]');
  await page.click('[data-gantt-weeks="4"]'); await page.waitForTimeout(300);
  const iso = () => page.evaluate(() => window.__iso || []), st = () => page.evaluate(() => window.__state || []);
  const ids = e => e.flatMap(m => m.entityIds).sort().join();
  await page.click('#ganttIsolateBtn'); await page.waitForTimeout(700);
  let I = await iso();
  if (I.length !== 1 || ids(I[0]) !== 'G5,G7' || I[0][0].modelId !== 'M1') fail('Isolerar objekten som är kopplade till det som visas: ' + JSON.stringify(I));
  if ((await page.getAttribute('#ganttIsolateBtn', 'aria-pressed')) !== 'true' || !/Visar endast kopplade/.test(await page.innerText('#ganttIsolateBtn'))) fail('Knappen ska visa att den är intryckt');
  // Följer schemat: sökning på Schakt → bara G5.
  await page.fill('#ganttSearch', 'Schakt'); await page.waitForTimeout(1000);
  I = await iso();
  if (I.length !== 2 || ids(I[1]) !== 'G5') fail('Följer sökningen i schemat: ' + JSON.stringify(I));
  // Sökning på bara okopplat: inget att isolera (modellen rörs inte), besked.
  await page.fill('#ganttSearch', 'Gjutning'); await page.waitForTimeout(1000);
  if ((await iso()).length !== 2 || !/Inget av det som visas/.test(await page.innerText('#modelToast'))) fail('Okopplade aktiviteter: besked, ingen ny isolering');
  await page.fill('#ganttSearch', ''); await page.waitForTimeout(1000);
  I = await iso();
  if (I.length !== 3 || ids(I[2]) !== 'G5,G7') fail('Tillbaka till alla: ' + JSON.stringify(I));
  // Av: hela modellen visas igen.
  await page.click('#ganttIsolateBtn'); await page.waitForTimeout(400);
  if (!(await st()).some(x => x && x.visible === 'reset') || (await page.getAttribute('#ganttIsolateBtn', 'aria-pressed')) !== 'false') fail('Av: visible reset och knappen släpps: ' + JSON.stringify(await st()));
  // Medan den är av händer inget när schemat ändras.
  await page.fill('#ganttSearch', 'Schakt'); await page.waitForTimeout(900);
  if ((await iso()).length !== 3) fail('Av: schemat ändras utan att modellen isoleras');
  console.log('OK: Visa endast kopplade – isolerar objekten för det som visas i Gantt, följer sökningen, av = hela modellen igen');
  // Avvisar Trimble Connect isolateEntities (fel utan text, som hos Victor): släck allt och tänd de kopplade i stället.
  await page.evaluate(() => { window.__state = []; API.viewer.isolateEntities = () => Promise.reject(undefined); });
  await page.fill('#ganttSearch', ''); await page.waitForTimeout(600);
  await page.click('#ganttIsolateBtn'); await page.waitForTimeout(800);
  const stt = await page.evaluate(() => window.__state.map(x => JSON.stringify(x)));
  if (stt[0] !== '{"visible":false}' || stt[1] !== '{"visible":true}') fail('Reserv när isolateEntities avvisas: ' + JSON.stringify(stt));
  if (/Kunde inte/.test(await page.innerText('#modelToast'))) fail('Inget felmeddelande när reserven fungerar: ' + await page.innerText('#modelToast'));
  await page.click('#ganttIsolateBtn'); await page.waitForTimeout(300);
  console.log('OK: reserv (släck allt, tänd kopplade) när isolateEntities avvisas');
  // Uppdatera-knappen i Gantt: snurrar medan den hämtar, visar "Uppdaterad" och går tillbaka.
  await page.evaluate(() => { window.__ref = 0; const o = window.refreshAll; window.refreshAll = async () => { window.__ref++; await new Promise(r => setTimeout(r, 300)); return o && o(); }; });
  await page.click('#ganttRefreshBtn'); await page.waitForTimeout(100);
  if (!(await page.evaluate(() => document.getElementById('ganttRefreshBtn').classList.contains('spin')))) fail('Uppdatera ska snurra medan den hämtar');
  await page.waitForTimeout(2500);
  if (!/^Uppdatera$/.test((await page.innerText('#ganttRefreshBtn')).trim())) fail('Uppdatera: texten ska gå tillbaka');
  console.log('OK: Uppdatera-knapp i Gantt');
  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
