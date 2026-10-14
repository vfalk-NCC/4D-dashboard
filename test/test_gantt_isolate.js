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
  it('Armering', 'Linje K', 'Betong', 3, 8, { model_id: 'M1', object_id: 'G7', progress: 20 }),                       // i3 – kopplad
  it('Saknas', 'Linje K', 'Betong', 3, 8, { model_id: 'M1', object_id: 'BADOBJ' }),                      // i4b – objekt som saknas i modellversionen
  it('Pelare A', 'Linje Z', 'Pelare', 4, 6, { group_id: 'g1', source_key: 'pp:g1', origin: 'powerproject' }),
  it('Pelare B', 'Linje Z', 'Pelare', 4, 6, { group_id: 'g1', source_key: 'pp:g1', origin: 'powerproject' }),
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
  const openMenu = async () => { if (await page.isVisible('#ganttTimeMenu')) return; await page.click('#ganttTimeMenuBtn'); await page.waitForSelector('#ganttTimeMenu', { state: 'visible' }); };
  const replay = () => page.evaluate(() => {
    const vis = new Map(), col = new Map();
    (window.__calls || []).forEach(({ a, b, iso }) => {
      if (iso) { vis.clear(); iso.forEach(m => m.entityIds.forEach(r => vis.set(r, true))); return; }
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
  if (!(await page.$('.gantt-scrub'))) fail('Dragstrecket ska ligga ovanpå schemat');
  const sum = await page.innerText('#ganttTimeSum');
  if (!/klara · \d+ pågår · \d+ försenade · \d+ kvar/.test(sum)) fail('Sammanfattning per datum: ' + sum);
  await page.waitForTimeout(1200);
  let R = await replay();
  if (R.shown !== 'G7') fail('Vid dag 4 ska bara G7 (hunnit starta) visas: ' + JSON.stringify(R));
  const pg = await page.evaluate(() => STATUS_COLORS.pagaende), hx = c => '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
  if (hx(R.col.G7) !== pg || R.col.G7.a !== 255) fail('G7 pågår – pågående-färgen, helt täckande: ' + JSON.stringify(R.col));
  // Realtid: ett steg i dragaren ändrar bara de objekt som byter läge (inget "släck allt" igen).
  const n7 = await page.evaluate(() => window.__calls.length);
  await page.fill('#ganttTimeDate', day(7)); await page.dispatchEvent('#ganttTimeDate', 'change'); await page.waitForTimeout(900);
  const calls = await page.evaluate(n => window.__calls.slice(n).map(c => !!(c.a || c.iso)), n7);
  if (calls.some(x => !x)) fail('Vid ett steg ska inte hela modellen släckas om: ' + JSON.stringify(calls));
  R = await replay();
  if (R.shown !== 'G5,G7') fail('Vid dag 7 ska båda visas: ' + R.shown);
  // Färdigt arbete (G7 slutar dag 8): efter slut genomskinligt – opacitet från skjutreglaget.
  // Pågående kräver minst 1 % framdrift; utan det är den försenad (börjat enligt startdatum). Efter slut utan klar = försenad.
  const phs = await page.evaluate(([d4, d8]) => { const m = { startDate: d4, endDate: d8 }; return [ganttPhaseAt({ ...m, progress: 0 }, d4), ganttPhaseAt({ ...m, progress: 0.5 }, d4), ganttPhaseAt({ ...m, progress: 1 }, d4), ganttPhaseAt({ ...m, progress: 20 }, d8), ganttPhaseAt({ ...m, progress: 20 }, d8 + 'x'), ganttPhaseAt({ ...m, progress: 100 }, '9999-01-01'), ganttPhaseAt({ ...m, progress: 0 }, '2000-01-01')].join(); }, [day(4), day(8)]);
  if (phs !== 'forsenad,forsenad,pagaende,pagaende,forsenad,klar,planerad') fail('Faser (försenad < 1 %): ' + phs);
  // Datum före planerad start är "planerad" även om aktiviteten har framdrift nu (objekt ska inte synas före tidslinjen nått dem).
  const early = await page.evaluate(([d2, d10, d11, d15, d5]) => { const m = { startDate: d10, endDate: d15, progress: 30 }; return [ganttPhaseAt(m, d2), ganttPhaseAt(m, d11), ganttPhaseAt({ ...m, progress: 100 }, d2), ganttPhaseAt({ ...m, actualStartDate: d5 }, d2)]; }, [day(-3), day(10), day(11), day(15), day(-5)]);
  if (early.join() !== 'planerad,pagaende,planerad,pagaende') fail('Före planerad start ska vara planerad, med verklig start pågående: ' + early.join());
  await page.evaluate(() => { const g = items.find(x => x.objectId === 'G7'); g.progress = 100; ganttShownItems.forEach(x => { if (x.objectId === 'G7') x.progress = 100; }); ganttTimeReset(); });
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
  // Ikonen vid Helskärm: tidslinjedragaren av/på även när knapparna är dolda.
  await page.evaluate(() => setGanttFsClean(true)); await page.waitForTimeout(300);
  if (!(await page.isVisible('#ganttFsTime'))) fail('Tidslinje-ikonen ska synas även med dolda knappar');
  const wasTime = await page.evaluate(() => ganttMode);
  await page.click('#ganttFsTime'); await page.waitForTimeout(600);
  const m2 = await page.evaluate(() => ganttMode);
  if (m2 === wasTime || (await page.getAttribute('#ganttFsTime', 'aria-pressed')) !== String(m2 === 'time')) fail('Ikonen ska växla Tid-läget: ' + wasTime + ' → ' + m2);
  await page.click('#ganttFsTime'); await page.waitForTimeout(600);
  if ((await page.evaluate(() => ganttMode)) !== 'off' && wasTime === 'time') { /* tillbaka till av */ }
  await page.evaluate(() => setGanttFsClean(false)); await page.waitForTimeout(200);
  if ((await page.evaluate(() => ganttMode)) !== wasTime) { await page.evaluate(m => setGanttMode(m, true), wasTime); await page.waitForTimeout(600); }
  // Stegknapparna: en dag fram/bak (stannar vid spannets ände).
  const st0 = await page.evaluate(() => ganttAsOf);
  await page.click('#ganttTimeNext'); await page.waitForTimeout(300);
  const st1 = await page.evaluate(() => ganttAsOf); await page.click('#ganttTimePrev'); await page.click('#ganttTimePrev'); await page.waitForTimeout(300);
  const st2 = await page.evaluate(() => ganttAsOf);
  const ddays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  if (ddays(st0, st1) !== 1 || ddays(st1, st2) !== -1) fail('Stegknapparna ska flytta en dag och stanna vid spannets början: ' + [st0, st1, st2]);
  await page.click('#ganttTimeMenuBtn'); await page.waitForTimeout(150); if (await page.isVisible('#ganttTimeMenu')) { /* öppnades/stängdes */ }
  // Opacitet per status: pågående 50 % ger alfa 128; 0 = osynligt (släcks).
  await page.evaluate(() => { const i = document.querySelector('[data-topc="pagaende"]'); i.value = 50; i.dispatchEvent(new Event('input')); }); await page.waitForTimeout(1200);
  R = await replay();
  if (!R.col.G7 || Math.abs(R.col.G7.a - Math.round(0.5 * 255)) > 1) fail('Opacitet för pågående: ' + JSON.stringify(R.col.G7));
  await page.evaluate(() => { const i = document.querySelector('[data-topc="pagaende"]'); i.value = 0; i.dispatchEvent(new Event('input')); }); await page.waitForTimeout(1200);
  R = await replay();
  if (R.shown.split(',').includes('G7')) fail('Opacitet 0 för pågående ska släcka objektet: ' + R.shown);
  await page.evaluate(() => { const i = document.querySelector('[data-topc="pagaende"]'); i.value = 100; i.dispatchEvent(new Event('input')); }); await page.waitForTimeout(1000);
  console.log('OK: opacitet per status i tidslinjen (pågående 50 % och 0 = osynligt)');
  // Dragstrecket: dra i greppet med musen – datumet ändras och 3D följer.
  await page.fill('#ganttTimeDate', day(2)); await page.dispatchEvent('#ganttTimeDate', 'change'); await page.waitForTimeout(700);
  const hb = await (await page.$('.gantt-scrub-handle')).boundingBox();
  const d0 = await page.evaluate(() => ganttAsOf);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 160, hb.y + hb.height / 2, { steps: 8 }); await page.waitForTimeout(300);
  const dMid = await page.evaluate(() => ganttAsOf);
  await page.mouse.up(); await page.waitForTimeout(500);
  if (!(dMid > d0)) fail('Dra strecket åt höger ska ge ett senare datum: ' + d0 + ' → ' + dMid);
  if ((await page.inputValue('#ganttTimeDate')) !== dMid || !(await page.$('.gantt-scrub'))) fail('Datumfältet följer strecket och strecket finns kvar efter släpp');
  // Samma streck i stapelvyn: ligger inom tidsspåret och följer datumet.
  await page.click('[data-gantt-view="bars"]'); await page.waitForTimeout(700);
  const sg = await page.evaluate(() => { const sc = document.querySelector('.gantt-scrub'), tr = document.querySelector('.gantt-ruler-track'); return sc && tr ? { l: sc.offsetLeft, a: tr.offsetLeft, b: tr.offsetLeft + tr.offsetWidth } : null; });
  if (!sg || sg.l < sg.a || sg.l > sg.b) fail('Dragstrecket i stapelvyn ska ligga inom tidsspåret: ' + JSON.stringify(sg));
  await page.click('[data-gantt-view="board"]'); await page.waitForTimeout(700);
  // Modeller: läs in alla kopplade modeller.
  await page.click('#ganttLoadModelsBtn'); await page.waitForTimeout(500);
  const tog = await page.evaluate(() => window.__tog);
  if (!tog || tog.length !== 2 || !tog.every(t => t[1] === true)) fail('Läs in modeller: ' + JSON.stringify(tog));
  // Pulserande ljus på pågående objekt (valfritt).
  await page.fill('#ganttTimeDate', day(4)); await page.dispatchEvent('#ganttTimeDate', 'change'); await page.waitForTimeout(800);
  await page.evaluate(() => { window.__calls = []; });
  await openMenu(); await page.check('#ganttTimePulse'); await page.waitForTimeout(2200);
  const pcols = await page.evaluate(() => [...new Set(window.__calls.filter(c => c.a && c.b.color && c.b.color !== 'reset').map(c => JSON.stringify(c.b.color)))]);
  if (pcols.length < 3) fail('Pågående ska pulsera (flera färgsteg): ' + pcols.length);
  // Inställningar: färger (förval Röd), hastighet och stil.
  await openMenu(); await page.click('#ganttPulseCfgBtn'); await page.waitForSelector('#ganttPulsePop');
  await page.selectOption('#ganttPulsePop .pp-preset', 'rod'); await page.evaluate(() => { window.__calls = []; }); await page.waitForTimeout(1800);
  const rcols = await page.evaluate(() => [...new Set(window.__calls.filter(c => c.a && c.b.color && c.b.color !== 'reset').map(c => c.b.color))]);
  if (rcols.length < 3 || !rcols.every(c => c.r >= 0xe5 && c.g <= 0xd6 + 1)) fail('Röd förinställning (e5484d ↔ ffd6d6): ' + JSON.stringify(rcols.slice(0, 3)));
  await page.fill('#ganttPulsePop .pp-per', '0.5').catch(() => {}); await page.evaluate(() => { const i = document.querySelector('#ganttPulsePop .pp-per'); i.value = 0.5; i.dispatchEvent(new Event('input')); });
  await page.selectOption('#ganttPulsePop .pp-style', 'blink'); await page.evaluate(() => { window.__calls = []; }); await page.waitForTimeout(1500);
  const bl = await page.evaluate(() => [...new Set(window.__calls.filter(c => c.a && c.b.color && c.b.color !== 'reset').map(c => JSON.stringify(c.b.color)))]);
  if (bl.length !== 2) fail('Blink ger exakt två färger: ' + bl.length);
  if ((await page.evaluate(() => ganttPulseCfg.period)) !== 0.5 || (await page.evaluate(() => JSON.parse(localStorage.getItem('4ddash-pulse-cfg')).style)) !== 'blink') fail('Pulsinställningarna sparas');
  await page.click('#ganttPulsePop .pp-reset'); await page.click('#ganttPulsePop .pp-close');
  await openMenu(); await page.uncheck('#ganttTimePulse'); await page.waitForTimeout(500);
  const restored = await page.evaluate(() => JSON.stringify(window.__calls.filter(c => c.a && c.b.color && c.b.color !== 'reset').slice(-1)[0].b.color));
  const baseC = await page.evaluate(() => JSON.stringify(hexToRgbaObj(STATUS_COLORS.pagaende, 1)));
  if (restored !== baseC) fail('Av: pågående-färgen ska återställas: ' + restored + ' vs ' + baseC);
  const nCalls = await page.evaluate(() => window.__calls.length); await page.waitForTimeout(600);
  if ((await page.evaluate(() => window.__calls.length)) !== nCalls) fail('Pulsen ska stanna när rutan släpps');
  // Markera pågående med TC:s egen markering (och släpp den igen).
  await page.evaluate(() => { window.__setsel = []; });
  await openMenu(); await page.check('#ganttTimeSelAct'); await page.waitForTimeout(800);
  const sel1 = await page.evaluate(() => (window.__setsel || []).slice(-1)[0]);
  if (!sel1 || sel1.modelObjectIds.flatMap(m => m.objectRuntimeIds).join() !== 'G7') fail('Pågående (G7 vid dag 4) ska markeras: ' + JSON.stringify(sel1));
  await openMenu(); await page.uncheck('#ganttTimeSelAct'); await page.waitForTimeout(600);
  const sel2 = await page.evaluate(() => (window.__setsel || []).slice(-1)[0]);
  if (!sel2 || sel2.modelObjectIds.length !== 0) fail('Av: markeringen släpps: ' + JSON.stringify(sel2));
  // Temporär försvinner efter slut, Rivning syns före start men försvinner efter slut.
  const tdp = await page.evaluate(([d0, d1, d3, d4, d6, d7]) => {
    const keep = [ganttShownItems, ganttAsOf, ganttTime3d];
    ganttShownItems = [{ members: [
      { modelId: 'M1', objectId: 'T1', temporary: true, startDate: d1, endDate: d3, progress: 10 },
      { modelId: 'M1', objectId: 'D1', demolition: true, startDate: d4, endDate: d6, progress: 0 }] }];
    ganttTime3d = true;
    const at = d => { ganttAsOf = d; return ganttCoupledTargets().map(t => t.objectId + ':' + t.phase).join(); };
    const r = [at(d0), at(d1), at(d4), at(d7)];
    [ganttShownItems, ganttAsOf, ganttTime3d] = keep;
    return r;
  }, [day(0), day(1), day(3), day(4), day(6), day(7)]);
  if (tdp[0] !== 'T1:dold,D1:planerad' || tdp[1] !== 'T1:pagaende,D1:planerad' || tdp[2] !== 'T1:dold,D1:forsenad' || tdp[3] !== 'T1:dold,D1:dold') fail('Temporär/Rivning i tidslinjen: ' + JSON.stringify(tdp));
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
  await openMenu(); await page.check('#ganttTimeFuture'); await page.waitForTimeout(1200);
  R = await replay();
  if (R.shown !== 'G5,G7') fail('Visa kommande: båda i 3D: ' + R.shown);
  await openMenu(); await page.uncheck('#ganttTimeFuture'); await page.waitForTimeout(800);
  await page.click('[data-gmode="off"]'); await page.waitForTimeout(600);
  if (await page.isVisible('#ganttTimeRow') || await page.$('.gantt-scrub')) fail('Av: raden och dragstrecket ska försvinna');

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
  // Flera aktiviteter med Ctrl-klick: markeras, pushas till 3D, kan isoleras.
  await page.fill('#ganttSearch', ''); await page.waitForTimeout(600);
  const noteOf = txt => page.locator('.pnote', { hasText: txt }).first();
  await noteOf('Schakt').click({ modifiers: ['Control'] });
  await noteOf('Armering').click({ modifiers: ['Control'] }); await page.waitForTimeout(900);
  if ((await page.locator('.pnote.gantt-multisel').count()) !== 2 || !/2 markerade/.test(await page.innerText('#ganttMultiBar'))) fail('Ctrl-klick ska markera flera: ' + await page.innerText('#ganttMultiBar').catch(() => '(ingen ruta)'));
  const ss = await page.evaluate(() => (window.__setsel || []).slice(-1)[0]);
  const ssIds = ss ? ss.modelObjectIds.flatMap(m => m.objectRuntimeIds).sort().join() : '';
  if (ssIds !== 'G5,G7') fail('De markerade ska pushas till 3D samtidigt: ' + ssIds);
  // Aktivitet med flera objekt: alla objekten följer med (inte bara ett).
  const nMem = await page.evaluate(() => ganttMultiMembers().length);
  if (nMem !== 2) fail('Två markerade enkla aktiviteter = 2 objekt: ' + nMem);
  await page.evaluate(() => { ganttMultiSel.clear(); const g = items.find(x => x.activityKey === 'g:g1'); ganttMultiSel.add(String(g.id)); });
  const nGrp = await page.evaluate(() => ganttMultiMembers().map(m => m.objectName).sort().join());
  if (nGrp !== 'Pelare A,Pelare B') fail('Alla objekt i aktiviteten ska följa med: ' + nGrp);
  await page.evaluate(() => { ganttMultiSel.clear(); ganttMultiSel.add(String(items.find(x => x.objectId === 'G5').id)); ganttMultiSel.add(String(items.find(x => x.objectId === 'G7').id)); applyGanttMultiSel(); });
  await page.click('#ganttMultiBar [data-mb="only"]'); await page.waitForTimeout(900);
  const only = await page.evaluate(() => ({ mode: ganttMode, last: window.__iso.slice(-1)[0] }));
  if (only.mode !== 'isolate' || only.last.flatMap(m => m.entityIds).sort().join() !== 'G5,G7') fail('Bara dessa: ' + JSON.stringify(only));
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  if (await page.$('#ganttMultiBar') || (await page.locator('.gantt-multisel').count())) fail('Esc rensar markeringen');
  await page.click('[data-gmode="off"]'); await page.waitForTimeout(300);
  console.log('OK: Ctrl-klick markerar flera aktiviteter – pushas till 3D, Bara dessa, Esc rensar');
  // Info-bubblor i 3D: en per aktivitet med namn, datum, framdrift, område och aktivitet; följer Ctrl-markeringen; av = borttagna.
  await page.evaluate(() => { window.__mk = []; window.__mkRm = []; });
  await page.click('#bubbleBtn'); await page.waitForTimeout(1200);
  let mk = await page.evaluate(() => (window.__mk || []).slice(-1)[0]);
  if (!mk || !mk.length || !/\d+ %/.test(mk[0].text) || !/\d/.test(mk[0].text.split('\n')[1] || '') || mk[0].start.positionZ !== 5200 || !/^#[0-9a-f]{6}$/i.test(mk[0].color || '') || mk[0].text.split('\n').some(l => l.length > 30)) fail('Bubbla med datum och framdrift: ' + JSON.stringify(mk && mk[0]));
  const arr = await page.evaluate(() => (window.__ar || []).slice(-1)[0]); if (!arr || !arr.length || arr[0].end.positionZ !== 3000 || arr[0].start.positionZ !== 5200) fail('Linje från bubblan till objektet: ' + JSON.stringify(arr));
  await page.evaluate(() => { ganttMultiSel.clear(); ganttMultiSel.add(String(items.find(x => x.objectId === 'G5').id)); applyGanttMultiSel(); }); await page.waitForTimeout(1500);
  mk = await page.evaluate(() => (window.__mk || []).slice(-1)[0]);
  if (!mk || mk.length !== 1 || !/Schakt/.test(mk[0].text)) fail('Bubbla bara för det markerade: ' + JSON.stringify(mk));
  if (!(await page.evaluate(() => (window.__mkRm || []).length))) fail('Gamla bubblor tas bort vid ny uppsättning');
  await page.evaluate(() => { ganttMultiSel.clear(); applyGanttMultiSel(); });
  await page.click('#bubbleBtn'); await page.waitForTimeout(800);
  const nRm = await page.evaluate(() => window.__mkRm.length); await page.waitForTimeout(900);
  if (await page.evaluate(() => bubbleIds.length)) fail('Av: alla bubblor borttagna');
  console.log('OK: info-bubblor i 3D – datum, framdrift, område, aktivitet; följer markeringen; av = borta');
  // Ta bort ett objekt ur en aktivitet (redigeringsdialogen): bara det objektet, aktiviteten finns kvar.
  const mergedG1 = () => page.evaluate(() => { const m = mergeActivityGroups(items.filter(x => x.activityKey === 'g:g1'))[0]; return m && m.members ? m.members.length : 0; });
  if ((await mergedG1()) !== 2) fail('Testdata: aktiviteten ska ha två objekt: ' + await mergedG1());
  await page.setViewportSize({ width: 1400, height: 520 }); // litet fönster: dialogen ska rulla, inte hamna utanför
  await page.evaluate(() => { ganttEditable = true; openActivityDialog({ edit: mergeActivityGroups(items.filter(x => x.activityKey === 'g:g1'))[0] }); });
  await page.click('.na-objs summary'); await page.waitForTimeout(150);
  if ((await page.locator('.na-obj').count()) !== 2) fail('Objektlistan ska visa två objekt');
  await page.evaluate(() => { window.__setsel = []; const b = items.find(x => x.objectName === 'Pelare B'); b.modelId = 'M1'; b.objectId = 'GB'; });
  await page.locator('.na-obj', { hasText: 'Pelare B' }).click(); await page.waitForTimeout(500);
  const pk = await page.evaluate(() => (window.__setsel || []).slice(-1)[0]);
  if (!pk || pk.modelObjectIds.flatMap(m => m.objectRuntimeIds).join() !== 'GB') fail('Klick på objektet ska markera och zooma i 3D: ' + JSON.stringify(pk));
  if (!(await page.locator('.na-obj.on', { hasText: 'Pelare B' }).count())) fail('Klickat objekt ska markeras i listan');
  await page.locator('.na-obj', { hasText: 'Pelare B' }).locator('.na-obj-x').click(); await page.waitForTimeout(900);
  if (get('plan_items.json').some(r => r.object_name === 'Pelare B') || !get('plan_items.json').some(r => r.object_name === 'Pelare A')) fail('Bara Pelare B ska tas bort ur aktiviteten');
  if (await page.$('.na-objs')) fail('Med ett objekt kvar ska listan försvinna');
  const fit = await page.evaluate(() => { const r = document.querySelector('.new-act-pop').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: window.innerHeight }; });
  if (fit.top < 0 || fit.bottom > fit.vh + 1) fail('Fönstret ska rymmas i bilden: ' + JSON.stringify(fit));
  await page.click('.na-cancel'); await page.setViewportSize({ width: 1400, height: 1000 }); await page.evaluate(() => { ganttEditable = false; });
  console.log('OK: ett objekt kan tas bort ur aktiviteten (redigeringsdialogen)');
  // Export till Powerproject (MS Project-XML): hierarki från området, kopplingar med glapp, resurser.
  const px = await page.evaluate(() => {
    const A = { id: 'x1', objectName: 'Grund', area: 'PRODUKTION / 741 Sikthall', startDate: '2026-10-05', endDate: '2026-10-09', progress: 40, resources: [{ name: 'Betongarbetare', qty: 4, hours: 160 }], dependsOn: [] };
    const B = { id: 'x2', objectName: 'Stomme', area: 'PRODUKTION / 741 Sikthall', startDate: '2026-10-12', endDate: '2026-10-16', progress: 0, dependsOn: ['x1', 'ute'], depLags: { x1: 2 } };
    const r = buildMspXml([A, B], { project: 'T' });
    const d = new DOMParser().parseFromString(r.xml, 'application/xml');
    const tasks = [...d.getElementsByTagName('Task')].map(t => ({ n: t.getElementsByTagName('Name')[0].textContent, l: t.getElementsByTagName('OutlineLevel')[0].textContent, s: t.getElementsByTagName('Summary')[0].textContent, dur: (t.getElementsByTagName('Duration')[0] || {}).textContent, pc: t.getElementsByTagName('PercentComplete')[0].textContent, pred: [...t.getElementsByTagName('PredecessorLink')].map(p => p.getElementsByTagName('PredecessorUID')[0].textContent + ':' + p.getElementsByTagName('LinkLag')[0].textContent) }));
    return { err: d.getElementsByTagName('parsererror').length, tasks, links: r.links, dropped: r.droppedLinks, res: d.getElementsByTagName('Assignment').length, work: (d.getElementsByTagName('Assignment')[0].getElementsByTagName('Work')[0] || {}).textContent };
  });
  if (px.err) fail('XML ska vara välformad');
  const nm = px.tasks.map(t => t.l + t.n + (t.s === '1' ? '*' : '')).join('|');
  if (nm !== '1PRODUKTION*|2741 Sikthall*|3Grund|3Stomme') fail('Hierarkin från området: ' + nm);
  if (px.tasks[2].dur !== 'PT40H0M0S' || px.tasks[2].pc !== '40') fail('Varaktighet och framdrift: ' + JSON.stringify(px.tasks[2]));
  if (px.tasks[3].pred.join() !== '3:9600' || px.links !== 1 || px.dropped !== 1) fail('Väntar på med glapp (2 d = 9600) och utelämnad extern koppling: ' + JSON.stringify([px.tasks[3].pred, px.links, px.dropped]));
  if (px.res !== 1 || px.work !== 'PT160H0M0S') fail('Resurser: ' + JSON.stringify([px.res, px.work]));
  // Med mall från Powerproject: allt utom uppgifterna tas från mallen, uppgifterna får mallens extra fält, resurser kopplas på namn.
  const tp = await page.evaluate(() => {
    const tpl = '<?xml version="1.0" encoding="UTF-8"?>\r\n<Project xmlns="http://schemas.microsoft.com/project"><Name>Mall</Name><StartDate>2026-01-01T08:00:00</StartDate><FinishDate>2026-01-02T16:00:00</FinishDate><CalendarUID>1</CalendarUID><OutlineCodes><OutlineCode><Guid>X</Guid></OutlineCode></OutlineCodes><ExtendedAttributes><ExtendedAttribute><FieldID>1</FieldID><FieldName>Text1</FieldName><Alias>Unique_Task_ID</Alias></ExtendedAttribute></ExtendedAttributes><Calendars><Calendar><UID>1</UID><Name>Std</Name><IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID></Calendar></Calendars><Tasks><Task><UID>9</UID><ID>1</ID><Name>S</Name><Summary>1</Summary><ExtendedAttribute><FieldID>1</FieldID><Value>s01</Value></ExtendedAttribute></Task><Task><UID>10</UID><ID>2</ID><Name>L</Name><Summary>0</Summary><ExtendedAttribute><FieldID>1</FieldID><Value>a07</Value></ExtendedAttribute></Task></Tasks><Resources><Resource><UID>77</UID><ID>1</ID><Name>Betongarbetare</Name></Resource></Resources><Assignments/></Project>';
    const A = { id: 'x1', objectName: 'Grund', area: 'PRODUKTION', startDate: '2026-10-05', endDate: '2026-10-09', progress: 0, resources: [{ name: 'Betongarbetare', qty: 2, hours: 80 }, { name: 'Okänd', qty: 1, hours: 8 }] };
    const r = buildMspXmlFromTemplate([A], tpl, { project: 'T', resources: true });
    const d = new DOMParser().parseFromString(r.xml, 'application/xml');
    const tk = [...d.getElementsByTagName('Task')].map(t => [t.getElementsByTagName('Name')[0].textContent, (t.getElementsByTagName('Value')[0] || {}).textContent]);
    return { err: d.getElementsByTagName('parsererror').length, tk, oc: r.xml.includes('<OutlineCodes>'), fa: r.xml.includes('<FieldName>Text1</FieldName>'), asg: [...d.getElementsByTagName('Assignment')].map(a => a.getElementsByTagName('ResourceUID')[0].textContent + ':' + a.getElementsByTagName('Units')[0].textContent), skipped: r.skippedResources, start: (d.getElementsByTagName('StartDate')[0] || {}).textContent, crlf: r.xml.includes('\r\n') };
  });
  if (tp.err || !tp.oc || !tp.fa || JSON.stringify(tp.tk) !== '[["PRODUKTION","s01"],["Grund","a07"]]' || tp.asg.join() !== '77:2' || tp.skipped !== 1 || !/^2026-10-05/.test(tp.start)) fail('Export på mall: ' + JSON.stringify(tp));
  const lk = await page.evaluate(() => { const A = { id: 'q1', startDate: '2026-10-05', endDate: '2026-10-06', dependsOn: [] }, B = { id: 'q2', startDate: '2026-10-07', endDate: '2026-10-08', dependsOn: ['q1'] }, C = { id: 'q3', startDate: '2026-10-09', endDate: '2026-10-10', dependsOn: ['q2'] }; const all = [A, B, C]; return { alone: ppxLinkStats([C]), withPreds: ppxLinkStats(ppxWithPredecessors([C], all)), n: ppxWithPredecessors([C], all).length }; });
  if (lk.alone.outside !== 1 || lk.alone.inside !== 0 || lk.withPreds.inside !== 2 || lk.withPreds.outside !== 0 || lk.n !== 3) fail('Beroenden i exporten: ' + JSON.stringify(lk));
  await page.evaluate(() => { ganttMultiSel.clear(); }); 
  await page.click('#ganttPpExportBtn'); await page.waitForSelector('.ppx-pop');
  const dlp = page.waitForEvent('download', { timeout: 10000 });
  await page.click('.ppx-pop input[value="all"]'); await page.click('.ppx-go');
  const dwn = await dlp;
  if (!/\.xml$/i.test(dwn.suggestedFilename())) fail('Filen ska vara .xml: ' + dwn.suggestedFilename());
  console.log('OK: export till Powerproject (MS Project-XML) – hierarki, glapp, resurser, nedladdning');
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
