// Mängdavtagning: klara objekt enligt Ganttens regel, mängder ur TC:s egenskaper (Calculated Geometry Values → Volume), summering per egenskap/område, CSV.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8995;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const PID = 'test-project';
const store = new Map(); let n = 0;
const seed = (f, c) => store.set(`projects/${PID}/${f}`, { content: JSON.stringify(c), sha: 's' + (++n) });
const iso = d => d.toISOString().slice(0, 10);
const day = k => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + k); return iso(d); };
const base = { project_id: PID, model_id: 'M1', actual_start_date: null, actual_end_date: null, estimated_hours: null, updated_at: '2026-01-01T00:00:00Z', depends_on: [], contractor: 'NCC', status: 'planerad' };
seed('plan_items.json', [
  { ...base, id: 'i1', object_id: 'S1', object_name: 'Platta 1', area: 'PRODUKTION / 743 Krosshall', activity: 'Gjutning', start_date: day(-20), end_date: day(-10), progress: 100 },
  { ...base, id: 'i2', object_id: 'S2', object_name: 'Platta 2', area: 'PRODUKTION / 743 Krosshall', activity: 'Gjutning', start_date: day(-20), end_date: day(-10), progress: 100 },
  { ...base, id: 'i3', object_id: 'W1', object_name: 'Vägg 1', area: 'PRODUKTION / 744 Fläkthuset', activity: 'Väggar', start_date: day(-5), end_date: day(-1), progress: 100 },
  { ...base, id: 'i4', object_id: 'W2', object_name: 'Vägg 2', area: 'PRODUKTION / 744 Fläkthuset', activity: 'Väggar', start_date: day(2), end_date: day(9), progress: 0 },
]);
['plan_milestones.json', 'plan_deliveries.json', 'plan_item_baseline_history.json', 'plan_item_activities.json'].forEach(f => seed(f, []));
// Volym (m³) och typ per objekt, som Revit/TC visar dem.
const P = { S1: [6, 'Foundation Slab:Concrete - Cast-in-Place - 1200'], S2: [4, 'Foundation Slab:Concrete - Cast-in-Place - 1200'], W1: [2.5, 'Wall:Concrete - Cast-in-Place - 300'], W2: [9, 'Wall:Concrete - Cast-in-Place - 300'] };
(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data);
  })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERR', e.message); }); page.on('dialog', d => d.accept());
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `
    const P = ${JSON.stringify(P)}; const ids = Object.keys(P); window.__sel = [];
    window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({
      markup: { addTextMarkup: m => Promise.resolve([]), removeMarkups: () => Promise.resolve() },
      project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) },
      viewer: { isolateEntities: () => Promise.resolve(), setObjectState: () => Promise.resolve(), setCamera: () => Promise.resolve(), getModels: () => Promise.resolve([]),
        convertToObjectRuntimeIds: (m, oids) => Promise.resolve(oids.map(o => ids.indexOf(o) + 1 || null)),
        setSelection: s => { window.__sel.push(s); return Promise.resolve(); }, getSelection: () => Promise.resolve([]),
        getObjectBoundingBoxes: (m, rids) => Promise.resolve(rids.map(r => { const v = P[ids[r - 1]][0]; const s = Math.cbrt(v * 1.5); return { id: r, boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: s, y: s, z: s } } }; })),
        getObjectProperties: (m, rids) => Promise.resolve(rids.map(r => ({ id: r, class: 'IfcSlab', product: { name: P[ids[r - 1]][1] + ':' + r }, properties: [
          { name: 'CalculatedGeometryValues', properties: [{ name: 'Volume', value: P[ids[r - 1]][0] * 1e9 }, { name: 'Surface Area', value: 6 * Math.pow(P[ids[r - 1]][0], 2 / 3) * 1e6 }, { name: 'CenterOfGravityX', value: 1000 }] },
          { name: 'Product', properties: [{ name: 'Product Object Type', value: P[ids[r - 1]][1] }] },
          { name: 'Reference Object', properties: [{ name: 'Layer', value: 'S-FNDN' }] } ] }))) },
      ui: {}, extension: {}, embed: { setTokenRefresh: () => {} } }) };` }));
  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', r => {
    const req = r.request(), f = decodeURIComponent(new URL(req.url()).pathname.replace('/repos/vfalk-NCC/4D-data/contents/', ''));
    const e = store.get(f);
    if (req.method() === 'GET') return e ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(e.content).toString('base64'), sha: e.sha }) }) : r.fulfill({ status: 404, body: '{}' });
    if (req.method() === 'PUT') { const b = JSON.parse(req.postData() || '{}'); if (e && e.sha !== b.sha) return r.fulfill({ status: 409, body: '{}' }); const sha = 's' + (++n); store.set(f, { content: Buffer.from(b.content, 'base64').toString('utf8'), sha }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha } }) }); }
    r.fulfill({ status: 405, body: '' });
  });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const fail = m => { throw new Error(m); };
  try {
    if (!(await page.$('[data-panel-id="quantities"] #qtyBox'))) fail('Blocket Mängdavtagning saknas');
    const order = await page.evaluate(() => [...document.querySelectorAll('.panel[data-panel-id]')].map(p => p.dataset.panelId));
    if (order.indexOf('quantities') !== order.indexOf('video-editor') + 1) fail('Blocket ska ligga under video-editorn: ' + order.join());
    // Tomt läge: ingen förteckning ännu -> uppmaning att läsa in Excel.
    if (!(await page.evaluate(() => /Börja med mängdförteckningen/.test(document.getElementById('qtyBox').textContent)))) fail('Tomt läge ska be om Excel-filen');
    // Läs mängder: 4 objekt, enheten (mm³) upptäcks.
    await page.click('#qtyRead'); await page.waitForFunction(() => qty.objs.length > 0, null, { timeout: 15000 });
    const R = await page.evaluate(() => ({ n: qty.objs.length, vf: qty.volFactor, vk: qty.kv.vol.valKey, af: qty.kv.form.factor, note: qty.notes.join(' ') }));
    if (R.n !== 4 || R.vf !== 1e9 || !/Volume$/.test(R.vk) || R.af !== 1e6 || !/mm³/.test(R.note)) fail('Läsning och enhet: ' + JSON.stringify(R));
    console.log('OK: läsning, mängdslag och enhet');
    // Excel: koder, byggnader, rubriker och radordning; kopplingar föreslås.
    await page.setInputFiles('#qmfFile', path.join(__dirname, 'fixtures', 'mf_test.xlsx'));
    await page.waitForFunction(() => qmf.posts.length > 0, null, { timeout: 10000 });
    const X = await page.evaluate(() => ({ posts: qmf.posts.length, builds: qmf.builds.join(), ese21: qmf.posts.find(p => p.ref === 'ESE.21'), types: qmf.map.types, areas: qmf.map.areas, heads: qmf.layout.filter(e => e.h).length, order: qmf.layout.filter(e => e.p).map(e => e.p).join('|') === qmf.posts.map(p => p.key).join('|') }));
    if (X.posts < 5 || X.builds !== 'Sektionsfickor,Sikthall,Krosshall,Fläkthus,Förtjockarhus,Ställverk,Personal' || !X.ese21 || X.ese21.k.Krosshall !== 2575 || X.ese21.p.Krosshall !== 2600) fail('Läsning av mängdförteckningen: ' + JSON.stringify(X));
    if (X.areas['743 Krosshall'] !== 'Krosshall' || X.areas['744 Fläkthuset'] !== 'Fläkthus') fail('Byggnad föreslås efter områdets namn: ' + JSON.stringify(X.areas));
    if (Object.entries(X.types.vol).map(([k, v]) => k.split(':')[0] + '=' + v.split('|')[0]).sort().join() !== 'Foundation Slab=ESE.15,Wall=ESE.21') fail('Typ → kod föreslås: ' + JSON.stringify(X.types));
    if (!(X.heads > 0) || !X.order) fail('Rubriker och radordning från Excel: ' + JSON.stringify({ heads: X.heads, order: X.order }));
    // Matrisen: rader i Excel-ordning, rubriker, celler med mängder.
    const MX = await page.evaluate(() => { const M = xlCompute(), P = r => qmfAllPosts().find(p => p.ref === r), v = (r, b, m) => Math.round(xlVal(M, P(r), b, m) * 100) / 100;
      return { tbl: !!document.querySelector('.qmf-mxt'), heads: document.querySelectorAll('.qmf-mxt tr.mx-head').length, rows: document.querySelectorAll('.qmf-mxt tbody tr:not(.mx-head)').length, unl: M.unlinked.length,
        a: [v('ESE.15', 'Krosshall', 'tot'), v('ESE.15', 'Krosshall', 'klar'), v('ESE.21', 'Fläkthus', 'tot'), v('ESE.21', 'Fläkthus', 'klar'), v('ESE.21', 'Fläkthus', 'kvar'), v('ESE.21', 'Krosshall', 'k'), v('ESE.21', 'Krosshall', 'pr')] }; });
    if (!MX.tbl || !(MX.heads > 0) || !(MX.rows >= 2) || MX.unl !== 0 || JSON.stringify(MX.a) !== '[10,10,11.5,2.5,11.5,2575,2600]') fail('Matrisen (modell totalt/klart, kontrakt, prognos): ' + JSON.stringify(MX));
    console.log('OK: Excel-förteckningen som matris (kod × byggnad, rubriker, radordning)');
    // Klick på en cell markerar bara det som räknas i läget (Modell = alla, Klart = klara, Kvar = ej klara).
    { const S = await page.evaluate(async () => { window.__calls = []; window.qtySelectRows = async o => { window.__calls.push(o.length); };
        const click = m => { xl.mode = m; qtyRender(); window.__calls.length = 0; document.querySelector('.qmf-mxt td.mx-c[data-mp][data-mb="Fläkthus"]').click(); return window.__calls[0] ?? 0; };
        const wallCell = [...document.querySelectorAll('.qmf-mxt td.mx-c.has')].find(td => qmfAllPosts().find(p => p.key === td.dataset.mp).ref === 'ESE.21' && td.dataset.mb === 'Fläkthus');
        const at = m => { xl.mode = m; qtyRender(); window.__calls.length = 0; [...document.querySelectorAll('.qmf-mxt td.mx-c.has')].find(td => qmfAllPosts().find(p => p.key === td.dataset.mp).ref === 'ESE.21' && td.dataset.mb === 'Fläkthus').click(); return window.__calls.length ? window.__calls[0] : 0; };
        const r = { tot: at('tot'), klar: at('klar'), kvar: at('kvar') }; xl.mode = 'tot'; qtyRender(); return r; });
      if (S.tot !== 2 || S.klar !== 1 || S.kvar !== 1) fail('Läget ska styra markeringen (2/1/1): ' + JSON.stringify(S)); }
    console.log('OK: klick på siffra markerar de objekt som räknas');
    // Rubriker kan fällas ihop och ut (sparas), och sökning visar alla träffar.
    { const F = await page.evaluate(() => { xl.closed.clear(); xl.q = ''; qtyRender(); const rows = () => document.querySelectorAll('.qmf-mxt tbody tr:not(.mx-head)').length, a = rows();
        document.querySelector('.qmf-mxt tr.mx-head.fold').click(); const b = rows(); const saved = JSON.parse(localStorage.getItem('4ddash-qty-closed') || '[]').length;
        document.querySelector('#xlUnfoldAll').click(); const c = rows(); document.querySelector('#xlFoldAll').click(); const d = rows(); document.querySelector('#xlUnfoldAll').click();
        return { a, b, c, d, saved, caret: !!document.querySelector('.mx-caret') }; });
      if (!(F.a >= 2) || !(F.b < F.a) || F.c !== F.a || F.d !== 0 || F.saved < 1 || !F.caret) fail('Fälla ihop rubriker: ' + JSON.stringify(F)); }
    console.log('OK: rubriker kan fällas ihop');
    // Koppla: klick på kod öppnar panelen; en sökruta (HPM-fallet) ger objekt; koppla valda; ångra.
    { const ese = await page.evaluate(() => { const p = qmfAllPosts().find(x => x.ref === 'ESE.2431' && x.unit === 'm³') || qmfAllPosts().find(x => x.unit === 'm³' && x.ref !== 'ESE.21' && x.ref !== 'ESE.15'); return { key: p.key, ref: p.ref }; });
      await page.evaluate(k => { xl.active = k; xl.find = ''; xl.sel.clear(); qtyRender(); }, ese.key);
      if (!(await page.$('.xl-link'))) fail('Koppla-panelen ska öppnas för en kod');
      await page.fill('#xlFind', 'foundation'); await page.waitForTimeout(450);
      const f1 = await page.evaluate(() => ({ rows: document.querySelectorAll('.xl-list input[data-xo]').length, txt: document.querySelector('.xl-ls .hint').textContent }));
      if (f1.rows !== 2 || !/2 objekt matchar/.test(f1.txt)) fail('Sök i alla egenskaper: ' + JSON.stringify(f1));
      await page.evaluate(() => { document.querySelectorAll('.xl-list input[data-xo]').forEach(c => { c.checked = true; c.dispatchEvent(new Event('change')); }); });
      await page.click('#xlApply'); await page.waitForTimeout(400);
      const a1 = await page.evaluate(k => ({ eff: qty.objs.filter(o => /Foundation/.test(o.flat['Produkt / Namn'])).map(o => qmfEffPost(o, 'vol')), undo: !!document.querySelector('#xlUndo'), saved: Object.values(JSON.parse(localStorage.getItem('4ddash-qty-map')).obj.vol || {}).filter(v => v === k).length }), ese.key);
      if (a1.eff.length !== 2 || a1.eff.some(e => e !== ese.key) || !a1.undo || a1.saved !== 2) fail('Koppla valda objekt till koden (och spara): ' + JSON.stringify(a1));
      await page.click('#xlUndo'); await page.waitForTimeout(300);
      const a2 = await page.evaluate(() => qty.objs.filter(o => /Foundation/.test(o.flat['Produkt / Namn'])).map(o => qmfEffPost(o, 'vol').split('|')[0]));
      if (a2.join() !== 'ESE.15,ESE.15' && a2.some(e => /ESE\.2431/.test(e))) fail('Ångra ska återställa: ' + JSON.stringify(a2));
      await page.evaluate(() => { xl.active = ''; xl.find = ''; qtyRender(); }); }
    console.log('OK: koppla via sökruta och ångra');
    // Form och betong kopplas var för sig (mängdslaget följer kodens enhet): formkod på väggtypen ändrar inte betongkopplingen.
    { const F = await page.evaluate(async () => { const P = qmfAllPosts().find(p => p.unit === 'm²' && /form/i.test(p.ref + ' ' + p.label)), t = qty.objs.map(qmfTypeVal).find(x => /^Wall/.test(x));
        qmfSetLink({ types: [t] }, P.key); await qtyLoadBoxes(); qtyRender(); const M = xlCompute(), c = (M.cells.get(P.key) || new Map()).get('Fläkthus');
        const w1 = qty.objs.find(o => o.item.objectName === 'Vägg 1'); return { kind: qmfKindOfPost(P), vol: qmfEffPost(w1, 'vol').split('|')[0], form: qmfEffPost(w1, 'form') === P.key, klar: c && Math.round(c.klar * 100) / 100, tot: c && Math.round(c.tot * 100) / 100 }; });
      if (F.kind !== 'form' || F.vol !== 'ESE.21' || !F.form || Math.abs(F.klar - 7.83) > 0.06 || Math.abs(F.tot - (7.83 + (6 * Math.pow(9, 2 / 3) - 2 * 9 / Math.cbrt(13.5)))) > 0.1) fail('Form och betong kopplade var för sig: ' + JSON.stringify(F)); }
    console.log('OK: form och betong på samma objekt, var för sig');
    // Armering: schablon (kg per m³ betong) för koder i kg och ton; vikt ur modellen saknas -> räknas inte.
    { const A = await page.evaluate(() => { qmf.custom.push({ key: 'egen|ARM|Armering|kg', ref: 'ARM', label: 'Armering', unit: 'kg', k: {}, p: {}, custom: true }, { key: 'egen|ARMT|Armering ton|ton', ref: 'ARMT', label: 'Armering ton', unit: 'ton', k: {}, p: {}, custom: true });
        const t = qty.objs.map(qmfTypeVal).find(x => /^Wall/.test(x)); qmfSetLink({ types: [t] }, 'egen|ARM|Armering|kg'); qmfSetLink({ types: [t] }, 'egen|ARMT|Armering ton|ton'); qty.cfg.rebarKg = 100; qty.cfg.rebarMode = 'schablon';
        const w1 = qty.objs.find(o => o.item.objectName === 'Vägg 1'), r = { kg: qtyValue(w1, 'kg'), ton: qtyValue(w1, 'rebar') }; qty.cfg.rebarMode = 'modell'; r.modell = qtyValue(w1, 'kg'); qty.cfg.rebarMode = 'schablon'; return r; });
      if (Math.abs(A.kg - 250) > 0.01 || Math.abs(A.ton - 0.25) > 0.001 || A.modell !== null) fail('Armering på schablon (2,5 m³ × 100 kg/m³): ' + JSON.stringify(A)); }
    console.log('OK: armering på schablon');
    // Utan kod: objekt som saknar kod räknas och knappen visar det.
    { const U = await page.evaluate(() => { const t = qty.objs.map(qmfTypeVal).find(x => /^Foundation/.test(x)); qmfSetLink({ types: [t] }, '', 'vol'); qmfSetLink({ types: [t] }, '', 'form'); qtyRender(); return { n: xlCompute().unlinked.length, btn: (document.querySelector('#xlUnl') || {}).textContent }; });
      if (U.n !== 2 || !/2 objekt saknar kod/.test(U.btn)) fail('Objekt utan kod: ' + JSON.stringify(U)); await page.evaluate(() => qmfUndo()); }
    // Följer tidslinjen: flyttas Ganttens tidslinje räknas "klart" om till det datumet.
    { await page.evaluate(() => { qty.cfg.date = ''; qty.cfg.follow = undefined; xl.mode = 'klar'; qtyRender(); });
      const T = async n => { await page.evaluate(n => setGanttAsOf(addDaysIso(todayISO(), n), { noRender: true }), n); await page.waitForTimeout(450); return page.evaluate(() => { const M = xlCompute(); let s = 0; M.cells.forEach((m, k) => { if (/egen/.test(k)) return; m.forEach(c => { s += c.klar; }); }); return { s, at: qtyAt(), input: document.getElementById('qtyDate').value }; }); };
      const a = await T(-15), b = await T(-5), c = await T(1);
      if (!(a.s < b.s && b.s < c.s)) fail('Klart ska växa med tidslinjen: ' + JSON.stringify([a, b, c]));
      if (c.input !== c.at || (await page.evaluate(() => document.getElementById('qtyFollow').checked)) !== true) fail('Datumrutan ska visa tidslinjens datum: ' + JSON.stringify(c));
      await page.evaluate(() => { document.getElementById('qtyDate').value = '2000-01-01'; document.getElementById('qtyDate').dispatchEvent(new Event('change')); });
      const d = await page.evaluate(() => ({ follow: qtyFollow(), at: qtyAt() })); if (d.follow || d.at !== '2000-01-01') fail('Eget datum stänger av följningen: ' + JSON.stringify(d));
      await page.evaluate(() => { qty.cfg.follow = undefined; qty.cfg.date = ''; setGanttAsOf(null, { noRender: true }); xl.mode = 'tot'; qtyRender(); }); }
    console.log('OK: följer tidslinjen');
    // Delning i 4D-data: kopplingar och förteckning (med rubriker) sparas i projektets mapp.
    { await page.evaluate(() => { qmfSave(); qmfSavePosts(); }); await page.waitForTimeout(2500);
      const keys = [...store.keys()].filter(k => /qty_(mapping|posts)\.json$/.test(k)); const posts = store.get(keys.find(k => /qty_posts/.test(k)) || '');
      if (keys.length < 2 || !posts || !JSON.parse(posts.content)[0].layout.length) fail('Kopplingar och förteckning (med rubriker) ska delas i 4D-data: ' + keys.join()); }
    // Egen kod: skapas i dialogen, kopplas via Koppla-panelen och sparas.
    { await page.evaluate(() => { xl.settings = true; qtyRender(); }); await page.click('#qmfNewPost'); await page.waitForSelector('.qmf-np');
      await page.fill('.np-ref', 'TEST.99'); await page.fill('.np-label', 'Provkod'); await page.click('.np-ok'); await page.waitForTimeout(200);
      const k = await page.evaluate(() => { const p = qmfAllPosts().find(x => x.ref === 'TEST.99'); xl.active = p.key; xl.settings = false; xl.find = 'wall'; qtyRender(); return p.key; });
      await page.waitForTimeout(100); await page.evaluate(() => { document.querySelectorAll('.xl-list input[data-xo]').forEach(c => { c.checked = true; c.dispatchEvent(new Event('change')); }); });
      await page.click('#xlApply'); await page.waitForTimeout(400);
      const r = await page.evaluate(k => ({ saved: Object.values(JSON.parse(localStorage.getItem('4ddash-qty-map')).obj.vol || {}).filter(v => v === k).length, custom: JSON.parse(localStorage.getItem('4ddash-qty-custom') || '[]').some(x => x.ref === 'TEST.99'), row: [...document.querySelectorAll('.qmf-mxt td.mx-ref')].some(td => td.textContent === 'TEST.99') }), k);
      if (r.saved !== 2 || !r.custom || !r.row) fail('Egen kod ska skapas, kopplas och sparas: ' + JSON.stringify(r)); }
    console.log('OK: egen kod');
    // Export och rullning.
    { const E = await page.evaluate(() => { const M = xlCompute(); return { html: xlHtml(M), csv: xlCsv(M) }; });
      if (!/<table>/.test(E.html) || !/ESE\.21/.test(E.html) || !/ESE\.21/.test(E.csv) || !/class="hd/.test(E.html)) fail('HTML/CSV-exporten ska innehålla matrisen med rubriker');
      const sc = await page.evaluate(async () => { const h = document.getElementById('qtyBox').getBoundingClientRect().top + window.scrollY; window.scrollTo(0, h + 200); const y0 = Math.round(window.scrollY); qtyRender(); await new Promise(r => setTimeout(r, 200)); return { y0, y1: Math.round(window.scrollY) }; });
      if (sc.y0 > 0 && Math.abs(sc.y1 - sc.y0) > 2) fail('Rullningen ska ligga kvar vid omritning: ' + JSON.stringify(sc)); }
    if (errors.length) fail('Sidfel: ' + errors.join(' | '));
    console.log('ALLA TESTER OK');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
