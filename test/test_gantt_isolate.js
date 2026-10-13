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
  it('Saknas', 'Linje K', 'Betong', 3, 8, { model_id: 'M1', object_id: 'BADOBJ' }),                      // i4b – objekt som saknas i modellversionen
  it('Gammal', 'Linje K', 'Betong', 3, 8, { model_id: 'BAD', object_id: 'G9' }),                        // i4 – modell som inte är inläst
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
      viewer: { isolateEntities: e => { (window.__iso = window.__iso || []).push(e); return Promise.resolve(); }, setObjectState: (a, b) => { (window.__state = window.__state || []).push(b); (window.__calls = window.__calls || []).push({ a, b }); return Promise.resolve(); }, getSelection: () => Promise.resolve(window.__sel || []), convertToObjectIds: (m, r) => Promise.resolve(r.map(x => 'G' + x)), convertToObjectRuntimeIds: (m, ids) => m === 'BAD' ? Promise.reject(new Error('Invalid model id')) : ids.includes('BADOBJ') ? Promise.reject(new Error('Objektet finns inte')) : Promise.resolve(ids), getObjectProperties: () => Promise.resolve([]), setSelection: () => Promise.resolve() }
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
  await page.click('[data-gmode="isolate"]'); await page.waitForTimeout(700);
  let I = await iso();
  if (I.length !== 1 || ids(I[0]) !== 'G5,G7' || I[0][0].modelId !== 'M1') fail('Isolerar objekten som är kopplade till det som visas: ' + JSON.stringify(I));
  if ((await page.getAttribute('[data-gmode="isolate"]', 'aria-pressed')) !== 'true') fail('Knappen ska visa att den är intryckt');
  if (!/hoppades över/.test(await page.innerText('#modelToast'))) fail('Modell som inte är inläst ska hoppas över med besked: ' + await page.innerText('#modelToast'));
  // Följer schemat: sökning på Schakt → bara G5.
  await page.fill('#ganttSearch', 'Schakt'); await page.waitForTimeout(1000);
  I = await iso();
  if (I.length !== 2 || ids(I[1]) !== 'G5') fail('Följer sökningen i schemat: ' + JSON.stringify(I));
  // Sökning på bara okopplat: inget att isolera (modellen rörs inte), besked.
  await page.fill('#ganttSearch', 'Gjutning'); await page.waitForTimeout(1000);
  if ((await iso()).length !== 2 || !/Inget av det som visas/.test(await page.innerText('#modelToast'))) fail('Okopplade aktiviteter: besked, ingen ny isolering ' + (await iso()).length + ' / ' + await page.innerText('#modelToast'));
  await page.fill('#ganttSearch', ''); await page.waitForTimeout(1000);
  I = await iso();
  if (I.length !== 3 || ids(I[2]) !== 'G5,G7') fail('Tillbaka till alla: ' + JSON.stringify(I));
  // Av: hela modellen visas igen.
  await page.click('[data-gmode="off"]'); await page.waitForTimeout(400);
  if (!(await st()).some(x => x && x.visible === 'reset') || (await page.getAttribute('[data-gmode="isolate"]', 'aria-pressed')) !== 'false') fail('Av: visible reset och knappen släpps: ' + JSON.stringify(await st()));
  // Medan den är av händer inget när schemat ändras.
  await page.fill('#ganttSearch', 'Schakt'); await page.waitForTimeout(900);
  if ((await iso()).length !== 3) fail('Av: schemat ändras utan att modellen isoleras');
  console.log('OK: Visa endast kopplade – isolerar objekten för det som visas i Gantt, följer sökningen, av = hela modellen igen');
  // Tidslinje-dragaren: valfri rad med dragare + datum; markeringen följer datumet, "Visa i 3D" visar bara objekt som hunnit starta
  // och uppdaterar 3D direkt (bara de som byter läge), färdigt arbete får egen opacitet.
  const replay = () => page.evaluate(() => {
    const vis = new Map(), col = new Map();
    (window.__calls || []).forEach(({ a, b }) => {
      if (!a) { if (b.visible === false) vis.clear(); if (b.color === 'reset') col.clear(); return; }
      a.modelObjectIds.forEach(m => m.objectRuntimeIds.forEach(r => { if (b.visible !== undefined) vis.set(r, b.visible); if (b.color && b.color !== 'reset') col.set(r, b.color); }));
    });
    return { shown: [...vis].filter(([, v]) => v).map(([r]) => r).sort().join(), col: Object.fromEntries(col) };
  });
  await page.fill('#ganttSearch', ''); await page.waitForTimeout(500);
  if (await page.isVisible('#ganttTimeRow')) fail('Dragaren ska vara avstängd som standard');
  await page.evaluate(() => { window.__calls = []; });
  await page.click('[data-gmode="time"]'); await page.waitForTimeout(400);
  if (!(await page.isVisible('#ganttTimeRow')) || !(await page.isVisible('#ganttTimeSlider'))) fail('Tidslinje-raden ska visas');
  await page.fill('#ganttTimeDate', day(4)); await page.dispatchEvent('#ganttTimeDate', 'change'); await page.waitForTimeout(500);
  if (!(await page.$('.gantt-today-label.asof')) && !(await page.$('.board-week-today'))) fail('Markeringen i schemat ska följa datumet');
  const sum = await page.innerText('#ganttTimeSum');
  if (!/klara · \d+ pågår · \d+ kommande/.test(sum)) fail('Sammanfattning per datum: ' + sum);
  await page.waitForTimeout(1200);
  let R = await replay();
  if (R.shown !== 'G7') fail('Vid dag 4 ska bara G7 (hunnit starta) visas: ' + JSON.stringify(R));
  const pg = await page.evaluate(() => STATUS_COLORS.pagaende), hx = c => '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
  if (hx(R.col.G7) !== pg || R.col.G7.a !== 255) fail('G7 pågår – pågående-färgen, helt täckande: ' + JSON.stringify(R.col));
  // Realtid: ett steg i dragaren ändrar bara de objekt som byter läge (inget "släck allt" igen).
  const n7 = await page.evaluate(() => window.__calls.length);
  await page.fill('#ganttTimeDate', day(7)); await page.dispatchEvent('#ganttTimeDate', 'change'); await page.waitForTimeout(900);
  const calls = await page.evaluate(n => window.__calls.slice(n).map(c => !!c.a), n7);
  if (calls.some(x => !x)) fail('Vid ett steg ska inte hela modellen släckas om: ' + JSON.stringify(calls));
  R = await replay();
  if (R.shown !== 'G5,G7') fail('Vid dag 7 ska båda visas: ' + R.shown);
  // Färdigt arbete (G7 slutar dag 8): efter slut genomskinligt – opacitet från skjutreglaget.
  await page.fill('#ganttTimeDate', day(10)); await page.dispatchEvent('#ganttTimeDate', 'change'); await page.waitForTimeout(900);
  R = await replay();
  if (!R.col.G7 || Math.abs(R.col.G7.a - Math.round(0.30 * 255)) > 1) fail('Klart ska få klart-opaciteten (30 %): ' + JSON.stringify(R.col.G7));
  await page.evaluate(() => { const i = document.getElementById('ganttTimeDoneOp'); i.value = 60; i.dispatchEvent(new Event('input')); }); await page.waitForTimeout(900);
  R = await replay();
  if (Math.abs(R.col.G7.a - Math.round(0.60 * 255)) > 1) fail('Skjutreglaget för klart synligt ska slå igenom: ' + JSON.stringify(R.col.G7));
  // Egen färg/opacitet per aktivitet.
  await page.evaluate(() => { const m = ganttShownItems.flatMap(i => i.members || [i]).find(x => x.objectId === 'G7'); m.doneColor = '#112233'; m.doneOpacity = 10; ganttTimeApply3d(); }); await page.waitForTimeout(500);
  await page.evaluate(() => { ganttTimeReset(); ganttTimeApply3d(); }); await page.waitForTimeout(800);
  R = await replay();
  if (hx(R.col.G7) !== '#112233' || Math.abs(R.col.G7.a - Math.round(0.10 * 255)) > 1) fail('Aktivitetens egen färg efter slut: ' + JSON.stringify(R.col.G7));
  // Färg på Pågående slår igenom.
  await page.fill('#ganttTimeDate', day(4)); await page.dispatchEvent('#ganttTimeDate', 'change'); await page.waitForTimeout(600);
  await page.evaluate(() => { const i = document.querySelector('[data-tcol="pagaende"]'); i.value = '#123456'; i.dispatchEvent(new Event('input')); }); await page.waitForTimeout(1200);
  R = await replay();
  if (hx(R.col.G7) !== '#123456') fail('Vald färg för pågående ska användas i 3D: ' + JSON.stringify(R.col.G7));
  // Uppspelning: 3D uppdateras medan det spelas (inte först vid paus).
  await page.fill('#ganttTimeDate', day(2)); await page.dispatchEvent('#ganttTimeDate', 'change'); await page.waitForTimeout(600);
  const nPlay = await page.evaluate(() => window.__calls.length);
  await page.click('#ganttTimePlay'); await page.waitForTimeout(700);
  const mid = await page.evaluate(n => ({ grew: window.__calls.length > n, playing: document.getElementById('ganttTimePlay').textContent }), nPlay);
  if (!mid.grew) fail('3D ska uppdateras under uppspelning: ' + JSON.stringify(mid));
  if (mid.playing === '⏸') await page.click('#ganttTimePlay');
  // Intervall: Från/Till styr dragarens spann.
  await page.fill('#ganttTimeFrom', day(2)); await page.dispatchEvent('#ganttTimeFrom', 'change');
  await page.fill('#ganttTimeTo', day(10)); await page.dispatchEvent('#ganttTimeTo', 'change'); await page.waitForTimeout(400);
  if ((await page.getAttribute('#ganttTimeSlider', 'max')) !== '8') fail('Dragaren ska spänna Från–Till (8 dagar): ' + await page.getAttribute('#ganttTimeSlider', 'max'));
  await page.click('#ganttTimeAuto'); await page.waitForTimeout(300);
  if ((await page.getAttribute('#ganttTimeSlider', 'max')) === '8') fail('Auto ska ge hela spannet');
  // Visa kommande: G5 (startar dag 6) syns i kommande-färgen redan vid dag 4.
  await page.check('#ganttTimeFuture'); await page.waitForTimeout(1200);
  R = await replay();
  if (R.shown !== 'G5,G7') fail('Visa kommande: båda i 3D: ' + R.shown);
  await page.uncheck('#ganttTimeFuture'); await page.waitForTimeout(800);
  await page.click('[data-gmode="off"]'); await page.waitForTimeout(600);
  if (await page.isVisible('#ganttTimeRow') || await page.$('.gantt-today-label.asof')) fail('Av: raden och datummarkeringen ska försvinna');

  console.log('OK: tidslinje-dragare över schemat – datummarkering, realtid i 3D, färger/opacitet efter slut, intervall, kommande');
  // Avvisar Trimble Connect isolateEntities (fel utan text, som hos Victor): släck allt och tänd de kopplade i stället.
  await page.evaluate(() => { window.__state = []; API.viewer.isolateEntities = () => Promise.reject(undefined); });
  await page.fill('#ganttSearch', ''); await page.waitForTimeout(600);
  await page.click('[data-gmode="isolate"]'); await page.waitForTimeout(800);
  const stt = await page.evaluate(() => window.__state.map(x => JSON.stringify(x)));
  if (stt[0] !== '{"visible":false}' || stt[1] !== '{"visible":true}') fail('Reserv när isolateEntities avvisas: ' + JSON.stringify(stt));
  if (/Kunde inte/.test(await page.innerText('#modelToast'))) fail('Inget felmeddelande när reserven fungerar: ' + await page.innerText('#modelToast'));
  await page.click('[data-gmode="off"]'); await page.waitForTimeout(300);
  console.log('OK: reserv (släck allt, tänd kopplade) när isolateEntities avvisas');
  // Dölj kopplade objekt: släcker alla kopplade (hela planeringen), av = hela modellen igen; utesluter Visa endast kopplade.
  await page.evaluate(() => { window.__calls = []; });
  await page.click('[data-gmode="hide"]'); await page.waitForTimeout(700);
  const hc = await page.evaluate(() => window.__calls.filter(c => c.a && c.b.visible === false).flatMap(c => c.a.modelObjectIds.flatMap(m => m.objectRuntimeIds)).sort().join());
  if (hc !== 'G5,G7' || (await page.getAttribute('[data-gmode="hide"]', 'aria-pressed')) !== 'true') fail('Dölj kopplade ska släcka G5 och G7 (inte den inte inlästa modellen): ' + hc);
  await page.click('[data-gmode="isolate"]'); await page.waitForTimeout(700);
  const pr = await page.evaluate(() => [...document.querySelectorAll('#ganttModeSeg [data-gmode]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.gmode).join());
  if (pr !== 'isolate') fail('Bara ett 3D-läge i taget: ' + pr);
  await page.click('[data-gmode="off"]'); await page.waitForTimeout(500);
  if (!(await page.evaluate(() => window.__calls.some(c => !c.a && c.b.visible === 'reset')))) fail('Av: visible reset');
  console.log('OK: Dölj kopplade objekt – släcker kopplade, av/på, utesluter Visa endast kopplade');
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
