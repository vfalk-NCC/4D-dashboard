// Visa endast kopplade (Gantt-schemat): isolerar i 3D-modellen bara objekten som är kopplade till aktiviteterna som visas
// (Victor 2026-10-13); följer sökning/filter; ett tryck till visar hela modellen igen.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8999;
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
  it('Platta SF1', 'SF1', 'Betong', 0, 3, { model_id: 'M1', object_id: 'G1' }),
  it('Vägg SF1', 'SF1', 'Betong', 4, 8, { model_id: 'M1', object_id: 'G2' }),
  it('Stål SF1', 'SF1', 'Stål', 9, 14),
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
  const seqs = () => { const e = store.get(`projects/${PID}/plan_assembly_sequences.json`); return e ? JSON.parse(e.content) : []; };
  await page.click('[data-gantt-view="montage"]'); await page.waitForSelector('.ms-root .ms-intro'); await page.waitForTimeout(300);
  // Mall -> 11 steg, spara
  await page.selectOption('#msTpl', { label: 'Transportband (11 steg)' }); await page.waitForSelector('.ms-row');
  if ((await page.$$('.ms-row')).length !== 11) fail('mallen har 11 steg');
  await page.fill('[data-f="name"]', 'Transportband 1'); await page.dispatchEvent('[data-f="name"]', 'change'); await page.waitForTimeout(100);
  await page.click('[data-a="save"]'); await page.waitForTimeout(500);
  if (seqs().length !== 1 || seqs()[0].steps.length !== 11 || seqs()[0].name !== 'Transportband 1') fail('sparad i 4D-data: ' + JSON.stringify(seqs()).slice(0, 200));
  // Beräknade datum: steg 4 startar dagen efter steg 3
  const dates = await page.evaluate(() => msViews(ms.cur).map(v => [v.s, v.e]));
  if (dates[3][0] !== iso(new Date(new Date(dates[2][1] + 'T00:00:00Z').getTime() + 864e5))) fail('steg 4 efter steg 3: ' + JSON.stringify(dates.slice(0, 4)));
  if (!(dates[7][0] > dates[4][1] && dates[7][0] > dates[5][1] && dates[7][0] > dates[6][1])) fail('steg 8 väntar på 5,6,7');
  if (process.env.SHOT) await page.screenshot({ path: '/tmp/ms_steps.png', fullPage: true });
  // Gantt
  await page.click('[data-mode="gantt"]'); await page.waitForSelector('.ms-bar2');
  if ((await page.$$('.ms-bar2')).length !== 11) fail('11 staplar');
  if ((await page.$$('.ms-gb svg path')).length < 11) fail('beroendepilar ritas');
  if (process.env.SHOT) await (await page.$('.ms-root')).screenshot({ path: '/tmp/ms_gantt.png' });
  // dra en stapel (steg 2) 3 dagar framåt => eget startdatum
  const b = await (await page.$('[data-bar="1"]')).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 16 * 3, b.y + b.height / 2, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(300);
  const st2 = await page.evaluate(() => ({ start: ms.cur.steps[1].start, dirty: ms.dirty })); if (!st2.start || !st2.dirty) fail('stapeln flyttas: ' + JSON.stringify(st2));
  // Ny tom sekvens (tom gantt)
  await page.click('[data-a="newEmpty"]'); await page.waitForTimeout(300);
  if (!(await page.evaluate(() => !!document.querySelector('.ms-g') && /Tom ganttvy/.test(document.querySelector('.ms-left').innerText)))) fail('tom ganttvy');
  await page.click('[data-a="addFree"]'); await page.waitForTimeout(200);
  if ((await page.$$('.ms-bar2')).length !== 1) fail('ett steg i tom gantt');
  await page.fill('[data-sf="name"]', 'Montera A'); await page.dispatchEvent('[data-sf="name"]', 'change');
  await page.fill('[data-f="name"]', 'Min plan'); await page.dispatchEvent('[data-f="name"]', 'change');
  await page.click('[data-a="save"]'); await page.waitForTimeout(500);
  if (seqs().length !== 2) fail('två sparade sekvenser');
  // Från filtret: aktivitetssteg med förslag
  await page.click('[data-a="newFilter"]'); await page.waitForTimeout(300);
  const nAct = await page.evaluate(() => ms.cur.steps.filter(s => s.kind === 'act').length); if (nAct !== 3) fail('3 aktivitetssteg från filtret: ' + nAct);
  await page.evaluate(() => { ms.cur.steps[2].pS = msAdd(msViews(ms.cur)[2].ppS, 7); ms.mode = 'send'; msPaint(); });
  const sendTxt = await page.evaluate(() => document.querySelector('.ms-left').innerText);
  if (!/1\s*flyttade/i.test(sendTxt.replace(/\n/g, ' '))) fail('en flyttad aktivitet: ' + sendTxt.slice(0, 200));
  if (process.env.SHOT) await (await page.$('.ms-root')).screenshot({ path: '/tmp/ms_send.png' });
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('[data-a="exXml"]')]);
  const xml = fs.readFileSync(await dl1.path(), 'utf8'); if (!/<Project/.test(xml) || !xml.includes('Stål SF1') || xml.includes('Platta SF1')) fail('XML med bara flyttade: ' + xml.slice(0, 200));
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-a="exHtml"]')]);
  const html = fs.readFileSync(await dl2.path(), 'utf8'); if (!html.includes('Vägg SF1') || !html.includes('förslag')) fail('HTML-förslag');
  // 3D: stega i sekvensen
  await page.evaluate(() => { ms.mode = 'steps'; ms.live = true; ms.i = 0; ms.shown = null; window.__iso = []; msPaint(); });
  await page.click('[data-a="next"]'); await page.waitForTimeout(500);
  const iso1 = await page.evaluate(() => window.__iso || []); if (!iso1.length || ![].concat(...iso1.map(e => e.flatMap(m => m.entityIds))).includes('G1')) fail('3D isolerar stegets objekt: ' + JSON.stringify(iso1));
  // Sammansättning: två transportband efter varandra
  await page.selectOption('#msTpl', { label: 'Transportband (11 steg)' }); await page.waitForSelector('.ms-row');
  await page.fill('[data-f="name"]', 'Transportband 2'); await page.dispatchEvent('[data-f="name"]', 'change'); await page.waitForTimeout(100);
  await page.click('[data-a="save"]'); await page.waitForTimeout(400);
  await page.click('[data-a="newCompose"]'); await page.waitForSelector('[data-a="addPart"]');
  await page.fill('[data-f="name"]', 'Sovringsverket band'); await page.dispatchEvent('[data-f="name"]', 'change'); await page.waitForTimeout(100);
  const addPart = async nm => { await page.click('[data-a="addPart"]'); await page.waitForSelector('[data-pickseq]'); await page.click(`[data-pickseq] >> text=${nm}`); await page.waitForTimeout(200); };
  await addPart('Transportband 1'); await addPart('Transportband 2');
  if ((await page.$$('.ms-row[data-part]')).length !== 2) fail('två delar i sammansättningen');
  // del 2 startar efter steg 4 i del 1, glapp 1
  await page.selectOption('[data-pf="after"]', { index: 1 }); await page.waitForTimeout(150);
  await page.selectOption('[data-pf="afterStep"]', '3'); await page.waitForTimeout(150);
  await page.fill('[data-pf="lag"]', '1'); await page.dispatchEvent('[data-pf="lag"]', 'change'); await page.waitForTimeout(200);
  const lay = await page.evaluate(() => { const l = msComposeLayout(ms.cur); return { n: l.views.length, p2: l.parts[1].s, p1step4: l.parts[0].views[3].e, p1s: l.parts[0].s, names: l.views.slice(10, 13).map(v => msLab(v)) }; });
  if (lay.n !== 22) fail('22 steg totalt: ' + lay.n);
  const next = d => iso(new Date(new Date(d + 'T00:00:00Z').getTime() + 2 * 864e5));
  if (lay.p2 !== next(lay.p1step4)) fail('del 2 startar efter steg 4 + 1 dag glapp: ' + JSON.stringify(lay));
  if (!/Transportband 2 › /.test(lay.names[1] + lay.names[2])) fail('steg märks med delens namn: ' + JSON.stringify(lay.names));
  await page.click('[data-mode="gantt"]'); await page.waitForSelector('.ms-bar2.sum');
  if ((await page.$$('.ms-bar2.sum')).length !== 2) fail('två sammanfattningsstaplar');
  if ((await page.$$('.ms-bar2.ro')).length !== 22) fail('22 stegstaplar (skrivskyddade)');
  await page.click('[data-tg="0"]'); await page.waitForTimeout(150);
  if ((await page.$$('.ms-bar2.ro')).length !== 11) fail('fälla ihop del 1 döljer dess steg');
  // dra sammanfattningsstapel 2 -> eget startdatum
  const sb = await (await page.$('[data-sum="1"]')).boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + 6); await page.mouse.down(); await page.mouse.move(sb.x + sb.width / 2 + 16 * 5, sb.y + 6, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(250);
  const own = await page.evaluate(() => ms.cur.parts[1].start); if (!own) fail('dragen ger eget startdatum');
  await page.click('[data-a="save"]'); await page.waitForTimeout(500);
  if (!seqs().some(x => x.type === 'compose' && x.parts.length === 2)) fail('sammansättningen sparad');
  if (process.env.SHOT) await (await page.$('.ms-root')).screenshot({ path: '/tmp/ms_compose.png' });
  // spelaren går igenom båda delarna
  await page.evaluate(() => { ms.mode = 'steps'; ms.i = 10; ms.shown = null; window.__iso = []; msPaint(); });
  await page.click('[data-a="next"]'); await page.waitForTimeout(300);
  if (!(await page.evaluate(() => document.querySelector('.ms-cur').innerText)).includes('Transportband 2 ›')) fail('spelaren går vidare till del 2');
  // XML med sammanfattningsrader per del
  await page.evaluate(() => { ms.mode = 'send'; msPaint(); });
  await page.evaluate(() => { document.getElementById('msAllXml').checked = true; document.getElementById('msAllXml').dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(200);
  const [dlx] = await Promise.all([page.waitForEvent('download'), page.click('[data-a="exXml"]')]);
  const x2 = fs.readFileSync(await dlx.path(), 'utf8'); if (!x2.includes('Transportband 1') || !x2.includes('Transportband 2') || !x2.includes('Sovringsverket band')) fail('XML har delarna som sammanfattningar');
  // Ladda om: sparade sekvenser finns kvar, öppna och ta bort
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  await page.click('[data-gantt-view="montage"]'); await page.waitForSelector('.ms-cards .ms-card');
  if ((await page.$$('.ms-card')).length !== 4) fail('fyra sparade efter omladdning: ' + (await page.$$('.ms-card')).length);
  await page.click('.ms-card >> text=Transportband 1'); await page.waitForSelector('.ms-row');
  await page.click('[data-a="del"]'); await page.waitForTimeout(600);
  if (seqs().length !== 3) fail('borttagen sekvens: ' + seqs().length);
  const real = errors.filter(e => !/allow-same-origin/.test(e)); if (real.length) fail('JS-fel: ' + real.join(' | '));
  console.log('OK test_montage'); await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
