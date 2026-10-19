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
    // Klara objekt (Ganttens regel): de tre som är klara idag – den framtida väggen ingår inte.
    await page.click('#qtyRead'); await page.waitForFunction(() => qty.objs.length > 0, null, { timeout: 15000 });
    let R = await page.evaluate(() => ({ n: qty.objs.length, piv: qtyPivot().nObj, val: qty.cfg.valKey, row: qty.cfg.rowKey, f: qty.factor, note: qty.unitNote, P: (() => { const p = qtyPivot(); return { total: p.total, rows: p.rows.map(r => [r.key, Math.round(r.sum * 100) / 100, r.n]) }; })() }));
    if (R.n !== 4 || R.piv !== 3 || !/Volume$/.test(R.val) || !/Product Object Type/.test(R.row) || R.f !== 1e9 || !/mm³/.test(R.note)) fail('Läsning och enhet: ' + JSON.stringify(R));
    if (Math.abs(R.P.total - 12.5) > 0.001) fail('Summa klara volymer (6 + 4 + 2,5 m³): ' + JSON.stringify(R.P));
    if (R.P.rows.map(r => r.join(':')).join('|') !== 'Foundation Slab:Concrete - Cast-in-Place - 1200:10:2|Wall:Concrete - Cast-in-Place - 300:2.5:1') fail('Summering per typ: ' + JSON.stringify(R.P.rows));
    // Rader per område, kolumner per typ; filter; CSV.
    await page.selectOption('#qtyRowKey', '◆ Område (sista ledet)'); await page.selectOption('#qtyColKey', { index: 0 }).catch(() => {});
    R = await page.evaluate(() => { qty.cfg.rowKey = '◆ Område (sista ledet)'; qty.cfg.colKey = [...qty.keys.keys()].find(k => /Product Object Type/.test(k)); qtyRender(); const p = qtyPivot(); return { rows: p.rows.map(r => r.key + ':' + Math.round(r.sum * 10) / 10).join('|'), cols: p.cols.length, csv: qtyCsv() }; });
    if (R.rows !== '743 Krosshall:10|744 Fläkthuset:2.5' || R.cols !== 2 || !/743 Krosshall";"10";/.test(R.csv.replace(/"10"/, '"10"')) && !/743 Krosshall";"[\d,]*";"10";2/.test(R.csv)) fail('Område × typ och CSV: ' + JSON.stringify(R));
    await page.evaluate(() => { qty.cfg.filter = 'Wall'; qtyRender(); });
    if ((await page.evaluate(() => qtyPivot().total)) !== 2.5) fail('Filter Innehåller: Wall ska ge 2,5 m³');
    await page.evaluate(() => { qty.cfg.filter = ''; qty.cfg.exclude = 'wall'; qtyRender(); });
    if ((await page.evaluate(() => qtyPivot().total)) !== 10) fail('Utesluter: wall ska ge bara fundamentet (10 m³)');
    await page.evaluate(() => { qty.cfg.filter = 'foundation, wall'; qty.cfg.exclude = 'foundation'; qtyRender(); });
    if ((await page.evaluate(() => qtyPivot().total)) !== 2.5) fail('Flera ord med komma: Innehåller foundation, wall och Utesluter foundation ska ge 2,5 m³');
    await page.evaluate(() => { qty.cfg.filter = ''; qty.cfg.exclude = ''; qtyRender(); });
    await page.click('[data-qpre="steel"]'); if ((await page.evaluate(() => qty.cfg.filter)) !== 'Steel, Stål, Pile, Påle, Rebar, Armering') fail('Snabbval Bara stål');
    await page.click('[data-qpre="all"]'); if ((await page.evaluate(() => qty.cfg.filter + qty.cfg.exclude)) !== '') fail('Snabbval Allt');
    // Alla oavsett läge.
    await page.evaluate(() => { qty.cfg.phase = 'all'; qtyRender(); });
    if (Math.abs((await page.evaluate(() => qtyPivot().total)) - 21.5) > 0.001) fail('Alla objekt: 21,5 m³');
    // Klara under period: långt tillbaka = samma som Klara; Från efter Till = inget; UI:t visar Från/Till.
    await page.evaluate(() => { qty.cfg.phase = 'klar'; qty.cfg.date = ''; qty.cfg.from = ''; qtyRender(); });
    const base = await page.evaluate(() => qtyPivot().total);
    await page.click('[data-qphase="period"]'); await page.waitForSelector('#qtyFrom');
    const per = await page.evaluate(() => { const r = {}; qty.cfg.from = '2000-01-01'; r.old = qtyPivot().total; qty.cfg.from = addDaysIso(qtyAt(), 1); r.after = qtyPivot().total; qty.cfg.from = ''; r.def = qtyFrom(); qtyRender(); r.hint = document.querySelector('#qtyBox').textContent.includes('Klart under perioden'); return r; });
    if (Math.abs(per.old - base) > 0.001 || per.after !== 0 || !per.hint) fail('Klara under period: ' + JSON.stringify({ base, per }));
    await page.evaluate(() => { qty.cfg.phase = 'klar'; qty.cfg.from = ''; qtyRender(); });
    // Följer tidslinjen: flyttas Ganttens tidslinje räknas "klart" om till det datumet (Victor 2026-10-19).
    { await page.evaluate(() => { qty.cfg.phase = 'klar'; qty.cfg.date = ''; qty.cfg.follow = undefined; qtyRender(); });
      const T = async n => { await page.evaluate(n => setGanttAsOf(addDaysIso(todayISO(), n), { noRender: true }), n); await page.waitForTimeout(450); return page.evaluate(() => ({ tot: qtyPivot().total, at: qtyAt(), input: document.getElementById('qtyDate').value })); };
      const a = await T(-15), b = await T(-5), c = await T(1);
      if (!(a.tot < b.tot && b.tot < c.tot)) fail('Mängden klar ska växa med tidslinjen: ' + JSON.stringify([a, b, c]));
      if (c.input !== c.at || (await page.evaluate(() => document.getElementById('qtyFollow').checked)) !== true) fail('Datumrutan ska visa tidslinjens datum: ' + JSON.stringify(c));
      await page.evaluate(() => { document.getElementById('qtyDate').value = '2000-01-01'; document.getElementById('qtyDate').dispatchEvent(new Event('change')); });
      const d = await page.evaluate(() => ({ follow: qtyFollow(), at: qtyAt() })); if (d.follow || d.at !== '2000-01-01') fail('Eget datum stänger av följningen: ' + JSON.stringify(d));
      await page.evaluate(() => { qty.cfg.follow = undefined; qty.cfg.date = ''; setGanttAsOf(null, { noRender: true }); qtyRender(); }); }
    console.log('OK: mängdavtagningen följer tidslinjen');
    // Mängdförteckningen (Excel): läses utan bibliotek, kopplingar föreslås, jämförelse per post och byggnad.
    await page.evaluate(() => { qty.cfg.phase = 'klar'; qty.cfg.filter = ''; qtyRender(); });
    await page.setInputFiles('#qmfFile', path.join(__dirname, 'fixtures', 'mf_test.xlsx'));
    await page.waitForFunction(() => qmf.posts.length > 0, null, { timeout: 10000 });
    const M = await page.evaluate(() => ({ posts: qmf.posts.length, builds: qmf.builds.join(), ese21: qmf.posts.find(p => p.ref === 'ESE.21'), types: qmf.map.types, areas: qmf.map.areas, sub: qmf.posts.some(p => /tillägg för anläggningscement/.test(p.label) && p.unit === 'm³') }));
    if (M.posts < 5 || M.builds !== 'Sektionsfickor,Sikthall,Krosshall,Fläkthus,Förtjockarhus,Ställverk,Personal' || !M.ese21 || M.ese21.k.Krosshall !== 2575 || M.ese21.p.Krosshall !== 2600 || !M.sub) fail('Läsning av mängdförteckningen: ' + JSON.stringify(M));
    if (M.areas['743 Krosshall'] !== 'Krosshall' || M.areas['744 Fläkthuset'] !== 'Fläkthus') fail('Byggnad föreslås efter områdets namn: ' + JSON.stringify(M.areas));
    const tv = Object.entries(M.types.vol).map(([k, v]) => k.split(':')[0] + '=' + v.split('|')[0]).sort().join();
    if (tv !== 'Foundation Slab=ESE.15,Wall=ESE.21') fail('Typ → post föreslås: ' + tv);
    const cmp = b => page.evaluate(b => { qmf.build = b; qmfRender(); const c = qmfCompare(); return Object.fromEntries(c.list.map(r => [r.p.ref, [r.k, r.pr, Math.round(r.klar * 100) / 100, Math.round(r.tot * 100) / 100]])); }, b);
    let K = await cmp('Krosshall');
    if (JSON.stringify(K['ESE.15']) !== '[669,669,10,10]' || JSON.stringify(K['ESE.21']) !== '[2575,2600,0,0]') fail('Jämförelse Krosshall: ' + JSON.stringify(K));
    K = await cmp('Fläkthus');
    if (JSON.stringify(K['ESE.21']) !== '[14,14,2.5,11.5]') fail('Jämförelse Fläkthus (klar 2,5 av totalt 11,5 m³): ' + JSON.stringify(K));
    K = await cmp('');
    if (K['ESE.21'][2] !== 2.5 || K['ESE.15'][2] !== 10) fail('Jämförelse alla byggnader: ' + JSON.stringify(K));
    const csv = await page.evaluate(() => qmfCsv(qmfCompare())); if (!/ESE\.21/.test(csv)) fail('CSV för jämförelsen');
    // Klick på en typrad / postrad markerar objekten i TC.
    { await page.evaluate(() => { window.__selRows = null; const o = window.qtySelectRows; window.qtySelectRows = async objs => { window.__selRows = objs.length; return o && o(objs); }; qmf.build = ''; qmfRender(); });
      await page.click('tr[data-tyrow] td:first-child'); await page.waitForTimeout(200);
      const n1 = await page.evaluate(() => window.__selRows); if (!(n1 >= 1)) fail('Klick på typrad ska markera objekt: ' + n1);
      await page.evaluate(() => { window.__selRows = null; }); await page.evaluate(() => { const tr = [...document.querySelectorAll('tr[data-postrow]')].find(x => !/markera de 0 objekten/.test(x.title)); tr.querySelector('td').click(); }); await page.waitForTimeout(200);
      const n2 = await page.evaluate(() => window.__selRows); if (!(n2 >= 1)) fail('Klick på postrad ska markera objekt: ' + n2);
      await page.evaluate(() => { window.__selRows = null; }); await page.click('tr[data-arrow] td:first-child'); await page.waitForTimeout(200);
      if (!((await page.evaluate(() => window.__selRows)) >= 1)) fail('Klick på områdesrad ska markera objekt'); }
    // Bläddra bland koderna: ◀ ▶ markerar objekten på posten i TC och följer med i tabellen.
    { const bar = await page.evaluate(() => ({ has: !!document.querySelector('#qmfBrowse'), n: document.querySelectorAll('#qmfBrowse option').length, info: (document.querySelector('#qmfBrowseInfo') || {}).textContent }));
      if (!bar.has || bar.n < 1) fail('Bläddra-fältet saknas: ' + JSON.stringify(bar));
      await page.evaluate(() => { window.__selRows = null; qmf.build = ''; qmfRender(); });
      await page.click('#qmfNext'); await page.waitForTimeout(200);
      const r = await page.evaluate(() => ({ sel: window.__selRows, cur: document.querySelectorAll('tr.qmf-cur').length, val: document.querySelector('#qmfBrowse').value, key: qmf.browse }));
      if (!(r.sel >= 1) || r.val !== r.key || (bar.n > 1 && r.cur !== 1)) fail('Nästa kod ska markera objekten och markera raden: ' + JSON.stringify(r));
      await page.evaluate(() => { window.__selRows = null; }); await page.click('#qmfPrev'); await page.waitForTimeout(200);
      if (!((await page.evaluate(() => window.__selRows)) >= 1)) fail('Föregående kod ska markera objekt'); }
    // Sök/filtrera typ- och postkolumnerna.
    { const vis = () => page.evaluate(() => [...document.querySelectorAll('tr[data-tyrow]')].filter(r => r.style.display !== 'none').length), tot = await page.evaluate(() => document.querySelectorAll('tr[data-tyrow]').length);
      await page.fill('[data-flt="ty"]', 'wall'); const v1 = await vis(); if (!(v1 >= 1 && v1 < tot)) fail('Sök typ ska dölja övriga rader: ' + v1 + '/' + tot);
      await page.fill('[data-flt="ty"]', ''); await page.fill('[data-flt="po"]', 'ESE.21'); const v2 = await vis(); if (!(v2 >= 1 && v2 < tot)) fail('Sök post ska filtrera på vald post: ' + v2 + '/' + tot);
      await page.fill('[data-flt="po"]', 'finns-inte-xyz'); if ((await vis()) !== 0) fail('Inga träffar ska ge inga rader');
      await page.fill('[data-flt="po"]', ''); if ((await vis()) !== tot) fail('Tomt filter visar allt'); }
    // Söklista för post: sök, poster i andra enheter under egna rubriker; väljer man en post i annan enhet flyttas typen till det mängdslaget.
    { await page.evaluate(() => { qmf.build = ''; qmfRender(); });
      const ty = await page.evaluate(() => document.querySelector('select[data-ty]').dataset.ty);
      const prev = await page.evaluate(ty => ({ vol: (qmf.map.types.vol || {})[ty], form: (qmf.map.types.form || {})[ty] }), ty);
      await page.dispatchEvent('select[data-ty]', 'mousedown'); await page.waitForSelector('.qmf-combo');
      const heads = await page.evaluate(() => [...document.querySelectorAll('.qmf-combo-g')].map(g => g.textContent)); if (!heads.some(h => /Poster i m³/.test(h)) || !heads.some(h => /Poster i m².*läggs objekten till/.test(h))) fail('Grupper i söklistan: ' + heads.join(' | '));
      await page.fill('.qmf-combo-q', 'grundsulor'); const hit = await page.evaluate(() => [...document.querySelectorAll('.qmf-combo-i')].map(x => x.textContent)); if (hit.length < 1 || !hit.every(x => /grundsulor/i.test(x))) fail('Sök i söklistan: ' + hit.join(' | '));
      await page.fill('.qmf-combo-q', 'xyz-finns-inte'); if (!/Inga poster/.test(await page.textContent('.qmf-combo-list'))) fail('Inga träffar'); await page.keyboard.press('Escape');
      // välj en m²-post för en m³-typ: objekten läggs TILL i Form, och finns kvar i Betong (form ligger "ovanpå" objektet)
      await page.dispatchEvent('select[data-ty]', 'mousedown'); await page.waitForSelector('.qmf-combo');
      const m2 = await page.evaluate(() => { const post = qmf.posts.find(p => p.unit === 'm²' && /form/i.test(p.ref + ' ' + p.label)); const el = [...document.querySelectorAll('.qmf-combo-i')].find(x => x.textContent.startsWith(post.ref + ' –')); el.click(); return post.key; });
      await page.waitForTimeout(200);
      const mv = await page.evaluate(ty => ({ vol: (qmf.map.types.vol || {})[ty], form: (qmf.map.types.form || {})[ty] }), ty);
      if (mv.form !== m2 || mv.vol !== prev.vol) fail('Formposten ska läggas till utan att ta bort betongposten: ' + JSON.stringify({ mv, prev, m2 }));
      if (!/även m²/.test(await page.evaluate(() => document.querySelector('select[data-ty]').options[0].textContent))) fail('Raden ska visa att typen även finns i ett annat mängdslag');
      await page.evaluate(([ty, prev]) => { if (prev.form === undefined) delete qmf.map.types.form[ty]; else qmf.map.types.form[ty] = prev.form; qmfRender(); }, [ty, prev]);
      // per objekt: expandera typen, välj post för ett enskilt objekt – frågan om bara det eller alla
      await page.evaluate(ty => { qmf.open.add(ty); qmfRender(); }, ty);
      const nObj = await page.evaluate(ty => document.querySelectorAll('tr.qmf-obj[data-og]').length, ty);
      if (nObj >= 1) { const multi = await page.evaluate(ty => (qmfObjsOf = null, [...document.querySelectorAll('tr[data-tyrow]')].find(r => r.dataset.tyrow === ty).children[1].textContent), ty);
        await page.dispatchEvent('select[data-ob]', 'mousedown'); await page.waitForSelector('.qmf-combo');
        const pickKey = await page.evaluate(() => { const p = qmf.posts.find(x => x.unit === 'm³'); [...document.querySelectorAll('.qmf-combo-i')].find(x => x.textContent.startsWith(p.ref + ' –') && !x.classList.contains('cur')) .click(); return p.key; }).catch(() => null);
        if (Number(multi) > 1) { await page.waitForSelector('.qmf-ask'); await page.click('.qmf-ask button[data-k="obj"]'); await page.waitForTimeout(200);
          const ov = await page.evaluate(() => Object.values(qmf.map.obj.vol || {}).length); if (ov < 1) fail('Valet för ett objekt ska sparas som objektets egen koppling'); }
        await page.evaluate(() => { qmf.map.obj = {}; qmfRender(); }); }
      await page.evaluate(ty => { qmf.open.delete(ty); qmfRender(); }, ty); }
    { const g = await page.evaluate(() => { const K = qmf.typeKey; const o = { modelId: 'm', objectId: 'a', flat: { [K]: 'Basic Wall:Concrete - Cast-in-Place - 1000:1788329' } }, o2 = { modelId: 'm', objectId: 'b', flat: { [K]: 'Basic Wall:Concrete - Cast-in-Place - 1000:1788331' } };
        const r = { a: qmfTypeVal(o), same: qmfTypeVal(o) === qmfTypeVal(o2), raw: qmfRawName(o) }; qmf.groupId = false; r.off = qmfTypeVal(o); qmf.groupId = true;
        qmf.map.obj.vol = { 'm|a': 'X' }; r.eff = qmfEffPost(o, 'vol'); r.eff2 = qmfEffPost(o2, 'vol') === ((qmf.map.types.vol || {})[qmfTypeVal(o2)] || ''); delete qmf.map.obj.vol;
        const kk = qty.cfg.kind; qty.cfg.kind = 'area'; const vk = Object.keys(qty.objs[0].flat).find(k => /volume$/i.test(k)); const w = { flat: { [vk]: 6 }, hz: 3, bx: 0.2, by: 5 }; qty.volFactor = 1; r.area = qtyValue(w); qty.cfg.kind = kk; return r; });
      if (g.a !== 'Basic Wall:Concrete - Cast-in-Place - 1000' || !g.same || g.off !== g.raw || g.eff !== 'X' || !g.eff2) fail('Gruppering bort objekt-ID och objektets egen koppling: ' + JSON.stringify(g));
      if (Math.abs(g.area - 30) > 1e-6) fail('Yta en sida = volym ÷ tjocklek (6 ÷ 0,2 = 30): ' + g.area); }
    // Lägg markerade objekt i TC på en post på en gång; posten syns sedan via qmfMemberPosts (Gantt-dialogen).
    { await page.evaluate(() => { qmf.map.obj = {}; qmf.build = ''; qmfRender(); });
      const info = await page.evaluate(() => { const os = qty.objs.slice(0, 3); API.viewer.getSelection = async () => [{ modelId: os[0].modelId, objectRuntimeIds: os.map(o => o.rid) }]; return { n: os.length, keys: os.map(o => o.modelId + '|' + o.objectId) }; });
      await page.click('#qmfSelAssign'); await page.waitForSelector('.qmf-combo'); await page.waitForTimeout(300);
      const pk = await page.evaluate(() => { const p = qmf.posts.find(x => x.unit === 'm³'); [...document.querySelectorAll('.qmf-combo-i')].find(x => x.textContent.startsWith(p.ref + ' –')).click(); return p.key; });
      await page.waitForSelector('.qmf-ask'); const q = await page.textContent('.qmf-ask-t'); if (!new RegExp('Lägga ' + info.n + ' markerade').test(q)) fail('Frågan ska nämna antalet: ' + q);
      await page.click('.qmf-ask button[data-k="ja"]'); await page.waitForTimeout(300);
      const set = await page.evaluate(([keys, pk]) => keys.filter(k => (qmf.map.obj.vol || {})[k] === pk).length, [info.keys, pk]);
      if (set !== info.n) fail('Alla markerade ska läggas på posten: ' + set + '/' + info.n);
      const mp = await page.evaluate(k => { const [m, id] = k.split('|'); return qmfMemberPosts({ modelId: m, objectId: id }).map(x => x.kind + ':' + x.post.ref); }, info.keys[0]);
      if (!mp.some(x => x.startsWith('vol:'))) fail('qmfMemberPosts (Gantt-dialogen) ska visa posten: ' + mp.join()); 
      await page.evaluate(() => { qmf.map.obj = {}; qmfRender(); }); }
    // Delning via 4D-data: kopplingar och poster skrivs till projektets mapp och läses tillbaka (den nyaste gäller).
    { await page.evaluate(() => { qmf.map.obj = { vol: { 'm1|o1': 'KEY1' } }; qmfSave(); qmfSavePosts(); });
      await page.waitForTimeout(2600);
      const sm = [...store.keys()].filter(k => /qty_mapping\.json$/.test(k)), sp = [...store.keys()].filter(k => /qty_posts\.json$/.test(k));
      if (sm.length !== 1 || sp.length !== 1) fail('Kopplingar och poster ska skrivas till 4D-data: ' + [...store.keys()].join());
      const wm = JSON.parse(store.get(sm[0]).content)[0]; if (!wm.updated_at || !wm.map.obj.vol || wm.map.obj.vol['m1|o1'] !== 'KEY1') fail('Skriven fil: ' + JSON.stringify(wm).slice(0, 200));
      const wp = JSON.parse(store.get(sp[0]).content)[0]; if (!wp.posts || wp.posts.length !== await page.evaluate(() => qmf.posts.length)) fail('Postfilen ska innehålla förteckningens poster');
      // fjärrfilen är nyare (någon annan har ändrat) → hämtas
      const remote = { ...wm, updated_at: '2999-01-01T00:00:00.000Z', map: { ...wm.map, obj: { vol: { 'm1|o1': 'FROM-REMOTE' } } } };
      store.set(sm[0], { content: JSON.stringify([remote]), sha: 'sx' + Date.now() });
      await page.evaluate(() => qmfSyncLoad()); await page.waitForTimeout(500);
      if ((await page.evaluate(() => qmf.map.obj.vol['m1|o1'])) !== 'FROM-REMOTE') fail('Nyare fjärrfil ska hämtas');
      await page.evaluate(() => { qmf.map.obj = {}; qmfSaveLocalOnly(); }); }
    { // Antal (st) räknar objekt.
      await page.click('[data-qkind="cnt"]'); await page.waitForTimeout(300);
      const cn = await page.evaluate(() => ({ tot: qtyPivot().total, n: qtyPivot().nObj, val: !!document.getElementById('qtyVal') })); if (cn.tot !== cn.n || cn.val) fail('Antal (st): summan ska vara antalet objekt: ' + JSON.stringify(cn));
      await page.click('[data-qkind="vol"]'); await page.waitForTimeout(300); }
    // Ändrad koppling slår igenom: Wall → ESE.1 ger ESE.21 noll.
    await page.evaluate(() => { const t = Object.keys(qmf.map.types.vol).find(k => /^Wall/.test(k)); qmf.map.types.vol[t] = qmf.posts.find(p => p.ref === 'ESE.1').key; qmfRender(); });
    K = await cmp('Fläkthus'); if (K['ESE.1'][2] !== 2.5) fail('Ändrad typ→post ska slå igenom: ' + JSON.stringify(K));
    // Form (m²): mängdslaget byter egenskap, enhet och poster; typ → ESB-post föreslås.
    await page.evaluate(() => { qty.cfg.formTop = true; }); // hela ytan (som förut) i den här kontrollen
    await page.click('[data-qkind="form"]'); await page.waitForTimeout(400);
    const FM = await page.evaluate(() => ({ key: qty.cfg.valKey, f: qty.factor, u: qtyUnitLabel(), types: Object.fromEntries(Object.entries(qmf.map.types.form || {}).map(([k, v]) => [k.split(':')[0], (qmf.posts.find(p => p.key === v) || {}).label])), posts: qmfPosts().length }));
    if (!/Surface Area$/.test(FM.key) || FM.f !== 1e6 || FM.u !== 'm²' || !/väggar/.test(FM.types.Wall || '') || !/grundsulor/.test(FM.types['Foundation Slab'] || '') || FM.posts < 2) fail('Mängdslag Form: ' + JSON.stringify(FM));
    // Formyta utan över-/underyta: hela ytan − 2 × volym ÷ höjd (höjd = lådans z-mått i mocken).
    { const R2 = await page.evaluate(async () => { const o = qty.objs.find(x => qtyFormDeduct(x) !== null); const full = (qtyNum(o.flat[qty.cfg.valKey]) / qty.factor); qty.cfg.formTop = true; const a = qtyValue(o); qty.cfg.formTop = false; const b = qtyValue(o); return { full, a, b, d: qtyFormDeduct(o), hz: o.hz, vf: qty.volFactor }; });
      if (Math.abs(R2.a - R2.full) > 1e-6 || !(R2.b < R2.a) || Math.abs((R2.a - R2.b) - R2.d) > 1e-6 || !(R2.hz > 0)) fail('Formyta: sidoyta ska vara hela ytan minus över-/underytan: ' + JSON.stringify(R2));
      await page.evaluate(() => { qty.cfg.formTop = true; }); }
    const A = v => 6 * Math.pow(v, 2 / 3);
    const fk = await page.evaluate(b => { qmf.build = b; qmfRender(); const c = qmfCompare(); return c.list.map(r => [r.p.label.split(' › ').pop().slice(0, 12), r.k, r.pr, Math.round(r.klar * 100) / 100]); }, 'Krosshall');
    const fg = fk.find(r => r[1] === 750); if (!fg || fg[1] !== 750 || Math.abs(fg[3] - Math.round((A(6) + A(4)) * 100) / 100) > 0.02) fail('Form per byggnad (grundsulor Krosshall): ' + JSON.stringify(fk));
    await page.click('[data-qkind="vol"]'); await page.waitForTimeout(300);
    if ((await page.evaluate(() => qty.cfg.valKey)).match(/Surface/)) fail('Tillbaka till betong ska välja volym igen');
    // Egna poster (Victor 2026-10-19): saknas koden skapar man en egen post direkt i sökrutan – den väljs, sparas och delas.
    { await page.evaluate(() => { qmf.build = ''; qmfRender(); });
      const ty0 = await page.evaluate(() => document.querySelector('select[data-ty]').dataset.ty);
      await page.dispatchEvent('select[data-ty]', 'mousedown'); await page.waitForSelector('.qmf-combo');
      await page.fill('.qmf-combo-q', 'EGEN.9'); await page.click('.qmf-combo-new'); await page.waitForSelector('.qmf-np');
      if ((await page.inputValue('.np-ref')) !== 'EGEN.9') fail('Koden i sökrutan ska fyllas i');
      await page.fill('.np-label', 'Prefabväggar (egen)'); await page.selectOption('.np-unit', 'm³'); await page.click('.np-ok'); await page.waitForTimeout(400);
      const C1 = await page.evaluate(ty => ({ n: qmf.custom.length, p: qmf.custom[0], mapped: (qmf.map.types.vol || {})[ty], all: qmfAllPosts().some(x => x.ref === 'EGEN.9'), grp: qmfPostGroups('')[0].items.some(i => i.post && i.post.ref === 'EGEN.9'), ls: !!localStorage.getItem('4ddash-qty-custom') }), ty0);
      if (C1.n !== 1 || !C1.all || !C1.grp || !C1.ls || C1.mapped !== C1.p.key) fail('Egen post ska skapas, väljas och finnas i listorna: ' + JSON.stringify(C1));
      if (!(await page.locator('.qmf-custom tr[data-ck]').count())) fail('Egna poster ska listas');
      // Ändra och ta bort
      await page.evaluate(() => { document.querySelector('.qmf-custom').open = true; });
      await page.click('.qmf-cedit'); await page.waitForSelector('.qmf-np'); await page.fill('.np-label', 'Prefabväggar B'); await page.click('.np-ok'); await page.waitForTimeout(200);
      const C2 = await page.evaluate(ty => ({ label: qmf.custom[0].label, mapped: (qmf.map.types.vol || {})[ty] === qmf.custom[0].key }), ty0);
      if (C2.label !== 'Prefabväggar B' || !C2.mapped) fail('Ändrad egen post ska behålla sina kopplingar: ' + JSON.stringify(C2));
      await page.evaluate(() => { document.querySelector('.qmf-custom').open = true; });
      await page.click('.qmf-cdel'); await page.waitForSelector('.qmf-ask'); await page.click('.qmf-ask button[data-k="ja"]'); await page.waitForTimeout(200);
      if (await page.evaluate(ty => qmf.custom.length !== 0 || (qmf.map.types.vol || {})[ty] === 'x', ty0)) fail('Borttagen egen post ska försvinna'); }
    console.log('OK: egna poster i mängdavtagningen');
    // Klick på en rad markerar objekten i TC.
    await page.evaluate(() => { window.__sel = []; }); await page.click('#qtyTable tbody tr'); await page.waitForTimeout(300);
    if (!(await page.evaluate(() => window.__sel.length))) fail('Klick på rad ska markera i TC');
    if (errors.length) fail('Sidfel: ' + errors.join(' | '));
    console.log('OK: Mängdavtagning – klara objekt (Ganttens regel), volym ur Calculated Geometry Values med enhetskontroll, summering per typ/område, filter, CSV, markera i TC');
    // Armering på schablon: betongvolym × ton/m³ (ton).
    const rb = await page.evaluate(async () => {
      qty.cfg.filter = ''; qty.cfg.exclude = ''; qty.cfg.kind = 'vol'; qtyPickDefaults(); await qtyUnitCheck(); qtyRender(); const vol = qtyPivot().total;
      qty.cfg.kind = 'rebar'; qty.cfg.rebarT = 0.12; qtyPickDefaults(); await qtyUnitCheck(); qtyRender();
      const out = { vol, ton: qtyPivot().total, unit: qtyUnitLabel(), field: !!document.querySelector('#qtyRebarT'), note: /schablon/i.test(qty.unitNote), btn: [...document.querySelectorAll('[data-qkind]')].some(b => /Armering \(schablon\)/.test(b.textContent)) };
      const f = document.querySelector('#qtyRebarT'); f.value = '0.2'; f.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 200)); out.ton2 = qtyPivot().total;
      qty.cfg.kind = 'vol'; qtyPickDefaults(); await qtyUnitCheck(); qtyRender(); return out;
    });
    if (!(rb.vol > 0) || Math.abs(rb.ton - rb.vol * 0.12) > 1e-6 || rb.unit !== 'ton' || !rb.field || !rb.note || !rb.btn || Math.abs(rb.ton2 - rb.vol * 0.2) > 1e-6) fail('Armering schablon: ' + JSON.stringify(rb));
    // Gantt-urvalet = det som ritas inom datumintervallet: objekt utanför intervallet räknas inte med.
    const rg = await page.evaluate(() => { const keep = ganttInRangeItems; qty.cfg.scope = 'gantt'; const a = qtyObjects().length; ganttInRangeItems = (ganttShownItems || []).slice(0, 1); const b = qtyObjects().length; ganttInRangeItems = []; const c = qtyObjects().length; ganttInRangeItems = keep; return { a, b, c }; });
    if (!(rg.a >= rg.b && rg.b <= 1 && rg.c === 0)) fail('Gantt-urval ska följa det som ritas inom intervallet: ' + JSON.stringify(rg));
    console.log('ALLA TESTER OK');
  } catch (e) { console.log('FEL: ' + e.message); process.exitCode = 1; }
  await browser.close(); server.close();
})();
