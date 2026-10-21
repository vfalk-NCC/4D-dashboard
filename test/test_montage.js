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
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); localStorage.setItem('4ddash-test-modelctl', '1'); });
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
  const st2 = await page.evaluate(() => ({ start: ms.cur.steps[1].start, lag: Object.values(ms.cur.steps[1].depLags || {})[0], dirty: ms.dirty })); if (st2.start !== '' || !(st2.lag > 0) || !st2.dirty) fail('stapeln flyttas (ändrar glappet mot föregångaren): ' + JSON.stringify(st2));
  // Kombinera: Ctrl+klick på två staplar => grupp i ganttvyn
  await page.click('[data-bar="3"]', { modifiers: ['Control'] }); await page.click('[data-bar="5"]', { modifiers: ['Control'] }); await page.waitForTimeout(200);
  if ((await page.$$('.ms-bar2.msel')).length !== 2) fail('två markerade staplar med Ctrl+klick');
  await page.click('[data-a="grpMake"]'); await page.waitForTimeout(300);
  const gs = await page.evaluate(() => ({ g: ms.cur.groups.length, ids: ms.cur.steps.map((x, k) => x.grp ? k : -1).filter(k => k >= 0) }));
  if (gs.g !== 1 || gs.ids.length !== 2 || gs.ids[1] - gs.ids[0] !== 1) fail('grupp skapad, medlemmar intill varandra: ' + JSON.stringify(gs));
  if (!(await page.$('.ms-gband')) || !(await page.$('.ms-gtag'))) fail('grupp syns i ganttvyn (band + etikett)');
  await page.evaluate(g => { ms.i = g; }, gs.ids[0]); const nx = await page.evaluate(() => { msNext(); return ms.i; }); if (nx !== gs.ids[1] + 1) fail('nästa-steg hoppar över gruppen: ' + nx);
  await page.evaluate(() => { ms.multi.add(ms.cur.steps.find(x => x.grp).id); msPaint(); }); await page.click('[data-a="grpBreak"]'); await page.waitForTimeout(200);
  if (await page.evaluate(() => (ms.cur.groups || []).length + ms.cur.steps.filter(x => x.grp).length)) fail('avgruppera tar bort gruppen');
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
  const [dl1] = await Promise.all([page.waitForEvent('download'), (async () => { await page.evaluate(() => { document.querySelector('.ms-more').open = true; }); await page.click('[data-a="exXml"]'); })()]);
  const xml = fs.readFileSync(await dl1.path(), 'utf8'); if (!/<Project/.test(xml) || !xml.includes('Stål SF1') || xml.includes('Platta SF1')) fail('XML med bara flyttade: ' + xml.slice(0, 200));
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-a="exHtml"]')]);
  const html = fs.readFileSync(await dl2.path(), 'utf8'); if (!html.includes('Vägg SF1') || !html.includes('montageordning')) fail('HTML-rapport');
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
  if (process.env.SHOT) { const h = await page.evaluate(() => { const v = msViews(ms.cur), imgs = {}; v.forEach((x, i) => { const c = document.createElement('canvas'); c.width = 480; c.height = 270; const g = c.getContext('2d'); g.fillStyle = `hsl(${i * 16} 40% 80%)`; g.fillRect(0, 0, 480, 270); g.fillStyle = `hsl(${i * 16} 60% 40%)`; for (let k = 0; k <= i; k++) g.fillRect(20 + (k % 11) * 40, 220 - Math.floor(k / 11) * 70, 32, 50); g.fillStyle = '#000'; g.font = '20px sans-serif'; g.fillText('Steg ' + (i + 1), 12, 28); imgs[x.st.id] = c.toDataURL('image/jpeg', 0.6); }); ms.cur.steps.slice(0, 3).forEach((st, k) => { st.note = 'Anteckning: kontrollera mått och lyftplan innan montage.'; }); return msHtmlDoc(ms.cur, msViews(ms.cur), imgs); }); fs.writeFileSync('/tmp/report_sample.html', h); }
  // spelaren går igenom båda delarna
  await page.evaluate(() => { ms.mode = 'steps'; ms.i = 10; ms.shown = null; window.__iso = []; msPaint(); });
  await page.click('[data-a="next"]'); await page.waitForTimeout(300);
  if (!(await page.evaluate(() => document.querySelector('.ms-cur').innerText)).includes('Transportband 2 ›')) fail('spelaren går vidare till del 2');
  // XML med sammanfattningsrader per del
  await page.evaluate(() => { ms.mode = 'send'; msPaint(); });
  await page.evaluate(() => { document.getElementById('msAllXml').checked = true; document.getElementById('msAllXml').dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(200);
  const [dlx] = await Promise.all([page.waitForEvent('download'), (async () => { await page.evaluate(() => { document.querySelector('.ms-more').open = true; }); await page.click('[data-a="exXml"]'); })()]);
  const x2 = fs.readFileSync(await dlx.path(), 'utf8'); if (!x2.includes('Transportband 1') || !x2.includes('Transportband 2') || !x2.includes('Sovringsverket band')) fail('XML har delarna som sammanfattningar');
  // Logotyp, avsändare, timmar och mängd (avancerat)
  if (!(await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 1400; c.height = 800; const g = c.getContext('2d'); for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 7} 70% 50%)`; g.fillRect((i * 37) % 1400, (i * 91) % 800, 60, 40); } const src = c.toDataURL('image/png'); const hi = await msShrink(src, 'high'), mi = await msShrink(src, 'mid'), mn = await msShrink(src, 'min'); return hi.length > mi.length && mi.length > mn.length; }))) fail('lägre bildkvalitet ger mindre filer');
  const png = path.join(require('os').tmpdir(), 'logo_test.png'); fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await page.evaluate(() => { ms.mode = 'steps'; ms.i = 0; ms.cur = msNewSeq('Rapport', msStepsFromFilter()); msPaint(); });
  await page.click('.ms-adv summary'); await page.fill('[data-sf="hours"]', '120'); await page.dispatchEvent('[data-sf="hours"]', 'change'); await page.waitForTimeout(150);
  await page.fill('[data-sf="qty"]', '45'); await page.dispatchEvent('[data-sf="qty"]', 'change'); await page.fill('[data-sf="unit"]', 'm³'); await page.dispatchEvent('[data-sf="unit"]', 'change'); await page.waitForTimeout(150);
  if (!(await page.evaluate(() => ms.cur.steps[0].hours === 120 && ms.cur.steps[0].qty === 45 && ms.cur.steps[0].unit === 'm³'))) fail('timmar och mängd sparas på steget');
  // Samma kameravy för alla steg
  await page.evaluate(() => { window.__cams = []; API.viewer.getCamera = () => Promise.resolve({ position: { x: 1, y: 2, z: 3 }, id: 'cam1' }); API.viewer.setCamera = c => { window.__cams.push(c); return Promise.resolve(); }; ms.live = true; ms.follow = true; });
  await page.click('[data-a="saveSeqCam"]'); await page.waitForTimeout(200);
  if (!(await page.evaluate(() => !!ms.cur.cam && ms.cur.camAll === true))) fail('sekvensens kameravy sparas');
  await page.evaluate(() => { ms.shown = null; msGo(0); }); await page.waitForTimeout(300); await page.evaluate(() => { msGo(1); }); await page.waitForTimeout(400);
  const cams = await page.evaluate(() => window.__cams); if (cams.length < 2 || cams.some(c => c.id !== 'cam1')) fail('alla steg använder samma kameravy: ' + JSON.stringify(cams));
  // Samma kameravy på flera steg: Skift-intervall, spara aktuell TC-vy, kopiera, rensa
  await page.evaluate(() => { ms.mode = 'steps'; ms.cur.steps.forEach(x => { x.cam = null; }); ms.cur.camAll = false; ms.multi.clear(); ms.lastCk = null; msPaint(); });
  await page.click('[data-ck="0"]'); await page.keyboard.down('Shift'); await page.click('[data-ck="2"]'); await page.keyboard.up('Shift');
  if ((await page.evaluate(() => ms.multi.size)) !== 3) fail('Skift-klick markerar intervall: ' + await page.evaluate(() => ms.multi.size));
  await page.evaluate(() => { API.viewer.getCamera = () => Promise.resolve({ id: 'camX', position: { x: 9 } }); });
  await page.click('[data-a="camSetSel"]'); await page.waitForTimeout(200);
  if (!(await page.evaluate(() => ms.cur.steps.filter(x => x.cam && x.cam.id === 'camX').length === 3))) fail('vyn satt på 3 valda steg');
  await page.click('[data-a="ckNoCam"]'); await page.waitForTimeout(100); // inga utan vy (alla har)
  await page.evaluate(() => { ms.cur.steps[1].cam = null; ms.multi.clear(); msPaint(); });
  await page.click('[data-a="ckNoCam"]'); if ((await page.evaluate(() => ms.multi.size)) !== 1) fail('markera utan vy');
  await page.evaluate(() => { ms.i = 0; ms.multi.clear(); ms.multi.add(ms.cur.steps[1].id); msPaint(); });
  await page.click('[data-a="camCopySel"]'); await page.waitForTimeout(100);
  if (!(await page.evaluate(() => !!ms.cur.steps[1].cam))) fail('kopiera vy från aktuellt steg');
  await page.click('[data-a="camClearSel"]'); if ((await page.evaluate(() => ms.cur.steps[1].cam)) !== null) fail('rensa vy på valda');
  await page.evaluate(() => { ms.i = 0; msPaint(); }); await page.click('[data-a="camAllSteps"]'); await page.waitForTimeout(100);
  if (!(await page.evaluate(() => ms.cur.steps.every(x => x.cam)))) fail('samma vy på alla steg');
  await page.evaluate(() => { ms.mode = 'send'; msPaint(); });
  await page.setInputFiles('#msLogoFile', png); await page.waitForSelector('.ms-logoimg'); await page.fill('[data-lg="company"]', 'NCC Sverige'); await page.dispatchEvent('[data-lg="company"]', 'change');
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('[data-a="exHtml"]')]);
  const h3 = fs.readFileSync(await dl3.path(), 'utf8'); if (!h3.includes('data:image/png;base64') || !h3.includes('NCC Sverige') || !h3.includes('\\u0034') && !/"h":120/.test(h3)) fail('rapporten har logga, avsändare och timmar');
  if (!/"q":45,"u":"m³"/.test(h3)) fail('mängd i rapporten');
  // Ingen färgning i tidsläget
  const nc = await page.evaluate(() => { ganttNoColor = true; const a = ganttTimeColorOf({ phase: 'pagaende' }), b = ganttTimeColorOf({ phase: 'forsenad' }); ganttNoColor = false; const c = ganttTimeColorOf({ phase: 'pagaende' }); return [a, b, typeof c]; });
  if (nc[0] !== 'reset' || nc[1] !== 'reset' || nc[2] !== 'object') fail('Ingen färgning ger originalfärger: ' + JSON.stringify(nc));
  if (!(await page.$('#ganttTimeNoColor'))) fail('rutan Ingen färgning finns i menyn');
  // Modern HTML-rapport: dra i tidslinjen, redigera texter och exportera låst
  { const h = await page.evaluate(() => { const v = msViews(ms.cur); return msHtmlDoc(ms.cur, v, null, null); });
    if (/Läs igenom hela anvisningen|IKEA/.test(h)) fail('ingen IKEA-stil'); if (process.env.SHOT) fs.writeFileSync('/tmp/rep_mod.html', h);
    const p2 = await browser.newPage({ viewport: { width: 1500, height: 950 } }); const e2 = []; p2.on('pageerror', e => e2.push(e.message)); await p2.setContent(h); await p2.waitForSelector('#tli'); await p2.waitForTimeout(300);
    const d0 = await p2.textContent('#dt'); await (await p2.$('#ruler')).scrollIntoViewIfNeeded(); const rb = await (await p2.$('#ruler')).boundingBox();
    await p2.mouse.move(rb.x + rb.width * 0.3, rb.y + 30); await p2.mouse.down(); await p2.mouse.move(rb.x + rb.width * 0.8, rb.y + 30, { steps: 6 }); await p2.mouse.up(); await p2.waitForTimeout(200);
    const d1 = await p2.textContent('#dt'), c1 = await p2.textContent('#ct'); if (d0 === d1 || !/Dag \d+ av \d+/.test(c1) || !/klara/.test(c1)) fail('att dra i tidslinjen ändrar datum och läge: ' + d0 + ' → ' + d1 + ' | ' + c1);
    if (!(await p2.$$('#tli .mo')).length || !(await p2.$$('#tli .wk')).length || !(await p2.$$('#tli .bar')).length) fail('tidslinjen visar månader, veckor och aktiviteter');
    await p2.click('#pl'); await p2.waitForTimeout(900); await p2.click('#pl'); if ((await p2.textContent('#dt')) === d1) fail('spela upp flyttar datum');
    // redigera texter -> låst export
    await p2.click('#ed'); if (!(await p2.$eval('[data-ed="title"]', e => e.isContentEditable))) fail('texter blir redigerbara');
    await p2.evaluate(() => { const t = document.querySelector('[data-ed="title"]'); t.innerText = 'Ny rubrik 123'; t.dispatchEvent(new Event('input', { bubbles: true })); });
    await p2.click('#cur .tr2, .tr2[data-i="0"]').catch(() => {}); await p2.evaluate(() => { const n = document.querySelector('#cur [data-ed="s:0:n"]') || document.querySelector('#cur [data-ed^="s:"]'); if (n) { n.innerText = 'Nytt stegnamn'; n.dispatchEvent(new Event('input', { bubbles: true })); } });
    const [dlL] = await Promise.all([p2.waitForEvent('download'), p2.click('#xl1')]); const hl = fs.readFileSync(await dlL.path(), 'utf8');
    if (!hl.includes('Ny rubrik 123') || !/"locked":1/.test(hl)) fail('låst export har ändrad rubrik och låst-flagga');
    const p4 = await browser.newPage({ viewport: { width: 1500, height: 950 } }); await p4.setContent(hl); await p4.waitForSelector('#tli');
    if (await p4.$('#ed')) fail('låst HTML har ingen redigera-knapp'); if (!(await p4.textContent('h1')).includes('Ny rubrik 123')) fail('låst HTML visar den nya rubriken'); await p4.close();
    if (e2.length) fail('JS-fel i rapporten: ' + e2.join(' | ')); if (process.env.SHOT) await p2.screenshot({ path: '/tmp/tl_report.png', fullPage: true }); await p2.close(); }
  // Allt annat släcks undan, även när aktuellt steg saknar objekt; varning när 3D-styrningen är av eller inga objekt finns
  { await page.evaluate(() => { ms.mode = 'steps'; ms.cur = msNewSeq('Släck', msStepsFromFilter()); ms.cur.steps.forEach(x => { x.kind = 'free'; x.start = ''; x.dur = 2; x.cam = null; x.objs = []; }); ms.cur.steps[1].objs = [{ modelId: 'M1', objectId: 'G1' }]; ms.live = true; ms.follow = false; ms.i = 0; ms.shown = null; ms.noObjs = false; window.__calls = []; window.__iso = []; modelCtl.on = true; msPaint(); });
    await page.evaluate(() => msGo(1)); await page.waitForTimeout(500);
    if (!(await page.evaluate(() => (window.__iso || []).some(e => e.some(m => m.entityIds.includes('G1')))))) fail('steg med objekt isolerar dem');
    await page.evaluate(() => { window.__calls = []; window.__iso = []; msGo(0); }); await page.waitForTimeout(500);
    const hid = await page.evaluate(() => (window.__calls || []).some(c => c.b && c.b.visible === false)), iso0 = await page.evaluate(() => (window.__iso || []).length);
    if (!hid || iso0) fail('steg utan objekt släcker allt annat (inte visa allt): ' + JSON.stringify(await page.evaluate(() => window.__calls)));
    await page.evaluate(() => { modelCtl.on = false; msPaint(); }); if (!(await page.$('.ms-warn3d [data-a="mgOn"]'))) fail('varning när 3D-styrningen är av');
    await page.evaluate(() => { modelCtl.on = true; ms.cur.steps.forEach(x => { x.objs = []; }); ms.shown = null; ms.noObjs = false; msApply(); }); await page.waitForTimeout(400);
    await page.evaluate(() => msPaint()); if (!(await page.evaluate(() => /Inget steg har objekt/.test(document.querySelector('.ms-warn3d') ? document.querySelector('.ms-warn3d').innerText : '')))) fail('varning när inga steg har objekt'); }
  // Glapp och följa med: B väntar på A + 2 dagars glapp; flyttas A följer B med; drag av B ändrar glappet
  { const r = await page.evaluate(() => { const A = msStepFree('A', 3, []), B = msStepFree('B', 2, [A.id]); A.start = msToday(); B.depLags = { [A.id]: 2 }; ms.cur = msNewSeq('Glapp', [A, B]); ms.cur.start = msToday();
      const v0 = msViews(ms.cur), gap = msDiff(v0[0].e, v0[1].s); A.start = msAdd(A.start, 4); const v1 = msViews(ms.cur), moved = msDiff(v0[1].s, v1[1].s);
      ms.mode = 'gantt'; msPaint(); const vB = msViews(ms.cur)[1]; msBarCommit(vB, 'm', 2); const v2 = msViews(ms.cur); return { gap, moved, lag: B.depLags[A.id], start: B.start, gap2: msDiff(v2[0].e, v2[1].s) }; });
    if (r.gap !== 3 || r.moved !== 4 || r.lag !== 4 || r.start !== '' || r.gap2 !== 5) fail('Glapp/följa med: ' + JSON.stringify(r)); }
  // Färg och opacitet för kommande, via pilen
  { await page.evaluate(() => { ms.mode = 'steps'; ms.cur = msNewSeq('Färg', msStepsFromFilter()); ms.i = 0; msPaint(); });
    await page.click('[data-a="colPop"]'); await page.waitForSelector('.ms-colpop');
    await page.fill('[data-op="fut"]', '50'); await page.dispatchEvent('[data-op="fut"]', 'input'); await page.waitForTimeout(100);
    await page.evaluate(() => { const c = document.querySelector('[data-col="fut"]'); c.value = '#ff0000'; c.dispatchEvent(new Event('input', { bubbles: true })); }); await page.waitForTimeout(100);
    const c = await page.evaluate(() => ({ a: msRgba('fut').a, r: msRgba('fut').r, ls: JSON.parse(localStorage.getItem('4ddash-montage-cols')).fut })); if (c.a !== 128 || c.r !== 255 || c.ls.o !== 50) fail('Färg/opacitet för kommande: ' + JSON.stringify(c));
    await page.evaluate(() => { ms.cols.fut = { c: '#93c5fd', o: 16 }; msColsSave(); ms.colPop = false; msPaint(); }); }
  // Montagebild: objekten tänds nedifrån och upp
  { const r = await page.evaluate(async () => { const z = { G1: 4, G2: 1, G3: 3, G4: 2 }; API.viewer.getObjectBoundingBoxes = (m, rids) => Promise.resolve(rids.map(id => ({ id, boundingBox: { min: { x: 0, y: 0, z: z[id] }, max: { x: 1, y: 1, z: z[id] + 1 } } })));
      const s0 = msNewSeq('Prefab', [msStepFree('Klump', 3, [])]); s0.steps[0].objs = ['G1', 'G2', 'G3', 'G4'].map(o => ({ modelId: 'M1', objectId: o })); ms.cur = s0; ms.mode = 'steps'; ms.i = 0; ms.live = true; ms.follow = false; ms.cols.buildUp = true; ms.orderCache.clear(); modelCtl.on = true;
      const ids = () => { const l = window.__iso[window.__iso.length - 1]; return l ? l.flatMap(m => m.entityIds).join() : ''; };
      window.__iso = []; ms.shown = null; ms.baseShown = null; ms.sub = 0.5; await msApply(); const half = ids(); ms.sub = 0.25; await msApply(); const quarter = ids(); ms.sub = 1; await msApply(); const full = ids(); ms.cols.buildUp = false; return { half, quarter, full }; });
    if (r.half !== 'G2,G4' || r.quarter !== 'G2' || r.full.split(',').length !== 4) fail('Tänd nedifrån och upp (lägsta först): ' + JSON.stringify(r)); }
  // HTML med 3D (omslutande lådor) och objektlista (monterad + kommentar)
  { await page.evaluate(() => { const z = { G1: 0, G2: 2, G3: 4, G4: 6, G5: 0 }; API.viewer.getObjectBoundingBoxes = (m, rids) => Promise.resolve(rids.map(id => ({ id, boundingBox: { min: { x: 169000 + (z[id] || 0) * 0.5, y: 7456000, z: 480 + (z[id] || 0) }, max: { x: 169002 + (z[id] || 0) * 0.5, y: 7456002, z: 482 + (z[id] || 0) } } })));
      API.viewer.getObjectProperties = (m, rids) => Promise.resolve(rids.map(id => ({ id, class: 'IfcBeam', product: { name: 'Balk ' + id }, properties: [{ name: 'Qto', properties: [{ name: 'NetVolume', value: '1,5' }, { name: 'Weight', value: '3600' }] }, { name: 'Pset', properties: [{ name: 'Mark', value: 'M-' + id }] }, { name: 'IMPACT', properties: [{ name: 'Element_mark', value: 'D-' + id }, { name: 'Element_type', value: 'D/F' }, { name: 'Element_mass', value: '4.418' }, { name: 'Element_length', value: '5610.4' }, { name: 'Element_lift', value: 'Lyftbygel-LYNA' }, { name: 'Planning_production_date', value: '' }] }] })));
      const A = msStepFree('Platta', 3, []), B = msStepFree('Pelare', 4, [A.id]); A.objs = [{ modelId: 'M1', objectId: 'G1' }, { modelId: 'M1', objectId: 'G5' }]; B.objs = ['G2', 'G3', 'G4'].map(o => ({ modelId: 'M1', objectId: o })); A.start = msToday();
      ms.cur = msNewSeq('Prefab 3D', [A, B]); ms.cur.start = msToday(); ms.mode = 'send'; modelCtl.on = true; ms.opt.props = 'Volume, Weight, Mark, Element_length, Planning_production_date'; msPaint(); });
    const [dl3d] = await Promise.all([page.waitForEvent('download'), page.click('[data-a="exHtml"]')]); const h3d = fs.readFileSync(await dl3d.path(), 'utf8');
    if (!/cv3/.test(h3d) || !/"has3d":true/.test(h3d) || !/"cols":\["Volume","Weight","Mark","Element_length"\]/.test(h3d)) fail('HTML har 3D-vy, lådor och egenskapskolumner');
    if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, h3d);
    const p3 = await browser.newPage({ viewport: { width: 1500, height: 1000 } }); const e3 = []; p3.on('pageerror', e => e3.push(e.message)); await p3.setContent(h3d); await p3.waitForSelector('#cv3'); await p3.waitForTimeout(600);
    const px = () => p3.evaluate(() => { const cv = document.getElementById('cv3'), c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height; const g = c2.getContext('2d'); g.drawImage(cv, 0, 0); const d = g.getImageData(0, 0, c2.width, c2.height).data; let n = 0, sum = 0; for (let i = 0; i < d.length; i += 4) { if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 40) n++; sum += d[i] + d[i + 1] * 3 + d[i + 2] * 7; } return { n, sum }; });
    const st0 = await p3.evaluate(() => window.__v3 && window.__v3.state().N), a = await px(); if (st0 !== 5 || a.n < 300) fail('3D-vyn ritar lådorna: ' + JSON.stringify({ st0, a }));
    const cb = await (await p3.$('#cv3')).boundingBox(); const az0 = await p3.evaluate(() => window.__v3.state().cam.az);
    await p3.mouse.move(cb.x + 300, cb.y + 200); await p3.mouse.down(); await p3.mouse.move(cb.x + 420, cb.y + 230, { steps: 5 }); await p3.mouse.up(); await p3.waitForTimeout(200);
    if ((await p3.evaluate(() => window.__v3.state().cam.az)) === az0) fail('dra roterar 3D-vyn');
    await (await p3.$('#ruler')).scrollIntoViewIfNeeded(); const rb3 = await (await p3.$('#ruler')).boundingBox(); await p3.mouse.move(rb3.x + 300, rb3.y + 30); await p3.mouse.down(); await p3.mouse.move(rb3.x + rb3.width - 40, rb3.y + 30, { steps: 6 }); await p3.mouse.up(); await p3.waitForTimeout(300);
    const b2 = await px(); if (b2.sum === a.sum) fail('tidslinjen ändrar vad som syns i 3D');
    await p3.click('#ctl1'); if (await p3.isVisible('#tlp')) fail('tidplanen kan fällas ihop'); await p3.click('#ctl1'); if (!(await p3.isVisible('#tlp'))) fail('tidplanen kan fällas ut');
    await p3.click('#dwb'); if (await p3.isVisible('#drawer')) fail('menyn med steg och objekt kan döljas'); await p3.click('#dwb'); if (!(await p3.isVisible('#drawer'))) fail('menyn kan visas igen');
    // läge: Steg för steg hoppar sekvens för sekvens, Tidplan följer datumet
    await p3.click('[data-md="step"]'); { const s0 = await p3.evaluate(() => ({ m: __rep.st.mode, si: __rep.st.si, max: document.getElementById('scr').max })); if (s0.m !== 'step' || s0.max !== '1') fail('steg-läge: ' + JSON.stringify(s0));
      await p3.click('#bk'); await p3.click('#fw'); const s1 = await p3.evaluate(() => ({ si: __rep.st.si, d: __rep.st.d, bars: [...document.querySelectorAll('[data-b]')].map(b => b.className.split(' ')[1]) })); if (s1.si !== 1 || s1.bars.join() !== 'done,act') fail('nästa steg i steg-läget: ' + JSON.stringify(s1));
      await p3.fill('#scr', '0'); await p3.dispatchEvent('#scr', 'input'); const s2 = await p3.evaluate(() => ({ si: __rep.st.si, bars: [...document.querySelectorAll('[data-b]')].map(b => b.className.split(' ')[1]) })); if (s2.si !== 0 || s2.bars.join() !== 'act,todo') fail('skjutreglaget hoppar mellan steg: ' + JSON.stringify(s2)); }
    await p3.click('[data-md="time"]'); if ((await p3.evaluate(() => __rep.st.mode)) !== 'time') fail('tillbaka till tidplanens framdrift');
    // klick på ganttstapel markerar aktiviteten, Ctrl+klick flera, Esc rensar
    await p3.click('[data-b="0"]'); if ((await p3.evaluate(() => [...__rep.st.pick].join())) !== '0' || !(await p3.isVisible('#clr'))) fail('klick på stapel markerar aktiviteten');
    await p3.click('[data-b="1"]', { modifiers: ['Control'] }); if ((await p3.evaluate(() => [...__rep.st.pick].sort().join())) !== '0,1' || (await p3.$$('.bar.pick')).length !== 2) fail('Ctrl+klick markerar flera');
    await p3.keyboard.press('Escape'); if ((await p3.evaluate(() => __rep.st.pick.size)) !== 0) fail('Esc rensar markeringen');
    // klick på objekt i 3D-vyn visar infokort inne i modellvyn
    { const cb2 = await (await p3.$('#cv3')).boundingBox(); let hit = null;
      for (let gy = 0.1; gy < 0.9 && !hit; gy += 0.05) for (let gx = 0.1; gx < 0.9 && !hit; gx += 0.05) { const x = cb2.x + cb2.width * gx, y = cb2.y + cb2.height * gy; if (await p3.evaluate(([x, y]) => !!window.__v3.pickAt(x, y), [x, y])) hit = { x, y }; }
      if (!hit) fail('något objekt går att träffa i 3D-vyn'); await p3.mouse.click(hit.x, hit.y); await p3.waitForTimeout(200);
      const oi = await p3.textContent('#oinf'); if (!(await p3.isVisible('#oinf')) || !oi.includes('Kategori') || !oi.includes('Monterad')) fail('infokort vid klick på objekt: ' + oi.slice(0, 120)); await p3.click('#oix'); if (await p3.isVisible('#oinf')) fail('infokortet kan stängas'); }
    // helskärm
    await p3.click('#fs'); await p3.waitForTimeout(300); if (!(await p3.evaluate(() => !!document.fullscreenElement || document.getElementById('vwrap').classList.contains('fsx')))) fail('helskärm'); await p3.click('#fs'); await p3.waitForTimeout(300);

    // objektlistan: bocka monterad, kommentar, filter
    await p3.click('.tab[data-t="objs"]'); await p3.click('[data-of="all"]'); const rowsN = (await p3.$$('#tw tr.or')).length; if (rowsN !== 5) fail('objektlistan har 5 rader: ' + rowsN);
    const txt = await p3.textContent('#tw'); if (!txt.includes('D-G2') || !txt.includes('M-G3') || !txt.includes('3600') || !txt.includes('5610') || !txt.includes('4,418') || !txt.includes('Elementmärkning') || /Montageordning|Volym|Objekt\b.*Typ/.test(txt.slice(0, 300))) fail('objektlistan visar nya kolumner: ' + txt.slice(0, 300));
    await p3.click('th[data-sc="mk"]'); await p3.click('th[data-sc="mk"]'); if (!(await p3.textContent('#tw tr.or:first-child')).includes('D-G5')) fail('sortera fallande på elementmärkning'); await p3.click('th[data-sc="mk"]'); await p3.fill('#tw [data-cf="mk"]', 'G3'); if ((await p3.$$('#tw tr.or')).length !== 1) fail('filter på elementmärkning'); await p3.fill('#tw [data-cf="mk"]', ''); await p3.selectOption('#tw [data-cf="ty"]', 'D/F'); if ((await p3.$$('#tw tr.or')).length !== 5) fail('filter på kategori'); await p3.selectOption('#tw [data-cf="ty"]', '');
    await p3.click('#tw tr.or:nth-child(4) td:nth-child(3)'); const dt = await p3.textContent('#tw .od'); if (!dt.includes('IMPACT') || !dt.includes('Lyftbygel-LYNA') || dt.includes('Planning_production_date')) fail('detaljrutan visar alla ifyllda egenskaper per grupp: ' + dt.slice(0, 200)); await p3.click('#tw tr.or:nth-child(2) input[data-m]'); await p3.fill('#tw tr.or:nth-child(3) input.cm', 'Spricka i hörnet'); await p3.waitForTimeout(200);
    const stt = await p3.evaluate(() => window.__rep.state()); if (Object.keys(stt.m).length !== 1 || Object.values(stt.c)[0] !== 'Spricka i hörnet') fail('bock och kommentar sparas: ' + JSON.stringify(stt));
    await p3.click('[data-of="com"]'); if ((await p3.$$('#tw tr.or')).length !== 1) fail('filtret Med kommentar'); await p3.click('[data-of="open"]'); if ((await p3.$$('#tw tr.or')).length !== 4) fail('filtret Ej monterade');
    // låst export med bockar och kommentarer inbakade
    await p3.click('#ed'); const [dlK] = await Promise.all([p3.waitForEvent('download'), p3.click('#xl2')]); const hk = fs.readFileSync(await dlK.path(), 'utf8'); if (!/"locked":2/.test(hk) || !hk.includes('Spricka i hörnet')) fail('skrivskyddad export bär bockar och kommentarer');
    const p5 = await browser.newPage({ viewport: { width: 1500, height: 1000 } }); await p5.setContent(hk); await p5.waitForSelector('#tli'); await p5.click('.tab[data-t="objs"]'); await p5.click('[data-of="all"]');
    if ((await p5.$$('#tw input[data-m]:disabled')).length !== 5 || !(await p5.$eval('#tw input.cm[readonly]', e => !!e))) fail('skrivskyddad: bockar och kommentarer är låsta'); if ((await p5.$$('#tw tr.or.ok')).length !== 1) fail('inbakad bock visas'); await p5.close();
    { const n0 = (h3d.match(/"note":/g) || []).length; await page.evaluate(() => { const b = [...document.querySelectorAll('[data-ex]')].pop(); b.checked = false; b.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(200);
    if (!(await page.evaluate(() => ms.exSkip.size === 1))) fail('bocklistan väljer bort ett steg'); const [dlS] = await Promise.all([page.waitForEvent('download'), page.click('[data-a="exHtml"]')]); const hs = fs.readFileSync(await dlS.path(), 'utf8'); if ((hs.match(/"note":/g) || []).length !== n0 - 1) fail('exporten innehåller bara ibockade steg: ' + n0 + ' -> ' + (hs.match(/"note":/g) || []).length); }
    if (e3.length) fail('JS-fel i HTML: ' + e3.join(' | ')); if (process.env.SHOT) { await p3.click('.tab[data-t="steps"]'); await p3.waitForTimeout(300); await p3.screenshot({ path: '/tmp/r3d.png', fullPage: true }); } await p3.close(); }
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
