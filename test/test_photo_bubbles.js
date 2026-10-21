// Foto med bubblor (Victor 2026-10-15): kameraknappen i Gantt tar en stillbild ur TC och lägger bubblor på den.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8971;
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
  it('Fundament J', 'PRODUKTION / 742A Krönlinje J', 'Fundament', -3, 6, { model_id: 'M1', object_id: 'o1', progress: 45 }),
  it('Kontrafor M12', 'PRODUKTION / 7421 Förtjockardel', 'Kontrafor', -2, 8, { model_id: 'M1', object_id: 'o2', progress: 50 }),
  it('Stödmur', 'PRODUKTION / 742C Stödmur', 'Stödmur', -4, 12, { model_id: 'M1', object_id: 'o3', progress: 16 }),
  it('Grovbetong gavel', 'PRODUKTION / 742C Stödmur', 'Gavel', -1, 4, { model_id: 'M1', object_id: 'o4', progress: 80 }),
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
      viewer: { getSelection: () => Promise.resolve(window.__sel || []), convertToObjectIds: () => Promise.resolve([]), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids.map((x, i) => i + 1)), getObjectProperties: (m, rids) => Promise.resolve(rids.map(id => ({ id, properties: [{ name: 'Produkt', properties: [{ name: 'Namn', value: 'Vägg ' + id }, { name: 'HPM', value: 'Typ' + id }] }] }))),
        getCamera: () => Promise.resolve(window.__cam || { position: { x: 0, y: -40, z: 20 }, target: { x: 0, y: 0, z: 0 }, fov: 60 }),
        getObjectBoundingBoxes: (m, rids) => Promise.resolve(rids.map(id => ({ id, boundingBox: { min: { x: -20 + id * 10, y: -2, z: 0 }, max: { x: -15 + id * 10, y: 2, z: 3 } } }))),
        getSnapshot: () => { const c = document.createElement('canvas'); c.width = 1200; c.height = 700; const x = c.getContext('2d'); x.fillStyle = '#e9edf0'; x.fillRect(0, 0, 1200, 700); x.fillStyle = '#6fbf73'; x.fillRect(300, 350, 600, 200); return Promise.resolve(c.toDataURL('image/png')); },
        setSelection: () => Promise.resolve(), setCamera: c => { window.__cam = c; window.__setCams = (window.__setCams || 0) + 1; return Promise.resolve(); } },
      markup: { removeMarkups: () => Promise.resolve() }
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
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); localStorage.setItem('4ddash-test-modelctl', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const fail = m => { throw new Error(m); };
  await page.waitForSelector('#ganttPhotoBtn', { state: 'attached' });
  for (const [name, cam] of [['pos', null], ['ang', { position: { x: 0, y: -40, z: 20 }, yaw: 0, pitch: -26.5, fov: 60 }], ['bad', { foo: 1 }]]) {
    await page.evaluate(c => { window.__cam = c; }, cam);
    await page.dispatchEvent('#ganttPhotoBtn', 'click'); await page.waitForSelector('#phbDlg canvas', { timeout: 15000 });
    const info = await page.textContent('.phb-info'); console.log(name, '->', info);
    if (name !== 'bad' && /kanten|Inga/.test(info)) fail('Bubblor placerades inte: ' + info);
    if (name === 'bad' && !/kanten/.test(info)) fail('Reservläget förväntades: ' + info);
    if (!/^4 bubblor/.test(info)) fail('Antal: ' + info);
    if (name === 'pos') { // zoom: 100 % ryms i fönstret, zoomen går hela vägen och bevarar proportionerna
      const M = () => page.evaluate(() => { const c = document.getElementById('phbCv'), b = document.querySelector('.phb-img'), r = c.getBoundingClientRect(); return { w: r.width, ar: r.width / r.height, ar0: c.width / c.height, sw: b.scrollWidth, cw: b.clientWidth }; });
      const z0 = await M(); if (z0.sw > z0.cw + 1) fail('100 % ska rymmas i fönstret utan rullning: ' + JSON.stringify(z0));
      for (let i = 0; i < 6; i++) await page.click('#phbZp');
      const z1 = await M(); if (z1.w < z0.w * 3.5 || Math.abs(z1.ar - z1.ar0) > 0.01) fail('Zoomen ska nå ~380 % med rätt proportioner: ' + JSON.stringify([z0, z1]));
      await page.hover('#phbCv'); await page.mouse.wheel(0, -2000); await page.waitForTimeout(100);
      const z2 = await M(); if (z2.w < z0.w * 7.5) fail('Mushjulet ska zooma upp till 800 %: ' + JSON.stringify(z2));
      await page.click('#phbZv'); const z3 = await M(); if (Math.abs(z3.w - z0.w) > 2) fail('100 % ska återställa: ' + JSON.stringify(z3));
    }
    if (name === 'pos') { // dra en bubbla
      const before = await page.evaluate(() => 1);
      const bb = await page.locator('#phbCv').boundingBox();
      await page.mouse.move(bb.x + bb.width * 0.4, bb.y + bb.height * 0.3); await page.mouse.down(); await page.mouse.move(bb.x + bb.width * 0.4 + 40, bb.y + bb.height * 0.3 + 30, { steps: 4 }); await page.mouse.up();
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#phbPdf')]);
      await dl.saveAs(process.env.PHB_OUT + '/foto.pdf');
      const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#phbPng')]);
      await dl2.saveAs(process.env.PHB_OUT + '/foto.png');
      // Punkten (ankaret) är låst till objektet och kan inte dras bort från det.
      { const g = await page.evaluate(() => { const cv = document.getElementById('phbCv'), st = cv._state(), c = st.cards[st.cards.length - 1], r = cv.getBoundingClientRect(); return { ax: c.ax, ay: c.ay, x: r.left + c.ax * r.width / st.W, y: r.top + c.ay * r.height / st.H, f: r.width / st.W }; });
        await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + 40, g.y + 25, { steps: 4 }); await page.mouse.up();
        const g2 = await page.evaluate(() => { const st = document.getElementById('phbCv')._state(), c = st.cards[st.cards.length - 1]; return { ax: c.ax, ay: c.ay, x: c.x, y: c.y }; });
        if (Math.abs(g2.ax - g.ax) > 0.5 || Math.abs(g2.ay - g.ay) > 0.5) fail('Punkten är låst till objektet och ska inte kunna flyttas: ' + JSON.stringify({ g, g2 })); }
      // Ta bort en bubbla: ✕ vid hovring, högerklick, Delete och Ångra.
      const where = async i => page.evaluate(i => { const cv = document.getElementById('phbCv'), st = cv._state(), c = st.cards[i], r = cv.getBoundingClientRect(); return { x: r.left + (c.x + c.W / 2) * r.width / st.W, y: r.top + (c.y + c.h / 2) * r.height / st.H, cx: r.left + (c.x + c.W - 2 * st.k) * r.width / st.W, cy: r.top + (c.y + 2 * st.k) * r.height / st.H }; }, i);
      let w = await where(0); await page.mouse.move(w.x, w.y); await page.waitForTimeout(100); await page.mouse.click(w.cx, w.cy);
      let n = await page.evaluate(() => document.getElementById('phbCv')._state().cards.length); if (n !== 3) fail('✕ ska ta bort en bubbla: ' + n);
      w = await where(0); await page.mouse.click(w.x, w.y, { button: 'right' });
      n = await page.evaluate(() => document.getElementById('phbCv')._state().cards.length); if (n !== 2) fail('Högerklick ska ta bort: ' + n);
      w = await where(0); await page.mouse.click(w.x, w.y); await page.keyboard.press('Delete');
      n = await page.evaluate(() => document.getElementById('phbCv')._state().cards.length); if (n !== 1) fail('Delete ska ta bort markerad: ' + n);
      if (!(await page.textContent('.phb-info')).includes('3 borttagna')) fail('Info om borttagna: ' + await page.textContent('.phb-info'));
      await page.click('#phbUndo'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
      n = await page.evaluate(() => document.getElementById('phbCv')._state().cards.length); if (n !== 4) fail('Ångra ska ta tillbaka alla: ' + n);
      // Redigering: skala, rubrik, färg, fält, lista, text, datum.
      const S = () => page.evaluate(() => { const s = document.getElementById('phbCv')._state(); return { k0: s.cards[0] && s.cards[0].W, n: s.cards.length, list: s.list.on, nl: s.list.rows.length, texts: s.texts.length, c0: s.sel && s.cards.includes(s.sel) ? { name: s.sel.name.join(' '), sub: s.sel.sub.length, prog: s.sel.show.prog, col: s.sel.colOver, h: s.sel.h } : null }; });
      const s0 = await S();
      await page.fill('#phbGScale', '200'); await page.waitForTimeout(100); const s1 = await S(); if (!(s1.k0 > s0.k0 * 1.9)) fail('Skala 200 % ska ge dubbel bredd: ' + s0.k0 + ' → ' + s1.k0);
      await page.fill('#phbGScale', '100'); await page.waitForTimeout(100);
      w = await where(0); await page.mouse.click(w.x, w.y); await page.waitForSelector('#phbCText');
      await page.fill('#phbCText', 'Egen rubrik'); await page.fill('#phbCScale', '150'); await page.uncheck('#phbCProg'); await page.uncheck('#phbCDate');
      await page.evaluate(() => { const i = document.getElementById('phbCCol'); i.value = '#ff0000'; i.dispatchEvent(new Event('input', { bubbles: true })); });
      const s2 = await S(); if (s2.c0.name !== 'Egen rubrik' || s2.c0.prog !== false || s2.c0.col !== '#ff0000') fail('Redigerad bubbla: ' + JSON.stringify(s2.c0));
      await page.check('#phbListOn'); await page.waitForTimeout(100); const s3 = await S(); if (!s3.list || s3.nl < 1) fail('Pågår just nu-listan ska ha rader: ' + JSON.stringify(s3));
      await page.fill('#phbListTitle', 'Pågår idag'); await page.fill('#phbListMax', '2'); await page.waitForTimeout(100); const s3b = await S(); if (s3b.nl !== 2) fail('Max rader: ' + s3b.nl);
      await page.click('.phb-sec:has(#phbListOn) > .phb-h'); if (await page.isVisible('#phbListTitle')) fail('Menyn ska fällas ihop'); await page.click('.phb-sec:has(#phbListOn) > .phb-h'); if (!(await page.isVisible('#phbListTitle'))) fail('Menyn ska fällas ut');
      const w0 = await page.evaluate(() => document.getElementById('phbCv').getBoundingClientRect().width);
      await page.click('#phbZp'); await page.click('#phbZp'); const w2 = await page.evaluate(() => document.getElementById('phbCv').getBoundingClientRect().width);
      if (!(w2 > w0 * 1.5)) fail('Zoom in ska förstora förhandsvisningen: ' + w0 + ' -> ' + w2);
      const zc = await page.evaluate(() => { const c = document.getElementById('phbCv'); return { cw: c.width, z: c._zoom() }; }); if (zc.cw < 100 || zc.z <= 1) fail('Zoomläge: ' + JSON.stringify(zc));
      await page.click('#phbZv'); const w3 = await page.evaluate(() => document.getElementById('phbCv').getBoundingClientRect().width); if (Math.abs(w3 - w0) > 2) fail('100 % ska återställa: ' + w3 + ' vs ' + w0);
      const ph = await page.evaluate(() => { const st = document.getElementById('phbCv')._state(); return { w: st.photo && st.photo.width, W: st.W, sharp: st.sharp }; });
      if (!ph.w || ph.w !== ph.W) fail('Fotot ska finnas i arbetsstorlek: ' + JSON.stringify(ph));
      await page.fill('#phbSharp', '0'); await page.waitForTimeout(300); if (await page.evaluate(() => document.getElementById('phbCv')._state().sharp) !== 0) fail('Skärpa 0');
      await page.selectOption('#phbProgMode', 'plan'); await page.waitForTimeout(100); const pm = await page.evaluate(() => document.getElementById('phbCv')._state().cards.map(c => c.prog)); if (!pm.every(v => v >= 0 && v <= 100)) fail('Framdrift enligt tidplan: ' + pm);
      await page.selectOption('#phbProgMode', 'entered');
      await page.fill('#phbListMax', '40'); await page.waitForTimeout(100);
      const lg = await page.evaluate(() => { const l = document.getElementById('phbCv')._state().list; return { heads: l.lines.filter(x => x.t === 'h').length, cands: l.cands.length, sel: l.sel.size, pk: document.querySelectorAll('[data-pk]').length, pg: document.querySelectorAll('[data-pg]').length }; });
      if (!lg.heads || lg.heads !== lg.pg || lg.pk !== lg.cands) fail('Listan ska vara indelad per område med en kryssruta per aktivitet: ' + JSON.stringify(lg));
      await page.evaluate(() => { const k = document.getElementById('phbPick'); k.scrollTop = 120; }); const sb = await page.evaluate(() => document.getElementById('phbPick').scrollTop);
      if (sb > 0) { await page.click('[data-pk]:nth-of-type(1) >> nth=3'); const sa = await page.evaluate(() => document.getElementById('phbPick').scrollTop); if (Math.abs(sa - sb) > 2) fail('Listan ska behålla rullningsläget: ' + sb + ' -> ' + sa); await page.click('#phbListNone'); await page.click('#phbListNow'); }
      await page.click('#phbListNone'); await page.waitForTimeout(100);
      const l0 = await page.evaluate(() => document.getElementById('phbCv')._state().list.rows.length); if (l0 !== 0) fail('Inga: ' + l0);
      await page.click('[data-pk]:not(:checked)'); await page.waitForTimeout(100);
      const l1 = await page.evaluate(() => document.getElementById('phbCv')._state().list.rows.length); if (l1 !== 1) fail('En ikryssad aktivitet ska ge en rad: ' + l1);
      await page.click('#phbListNow'); await page.fill('#phbListMax', '2'); await page.waitForTimeout(100);
      await page.click('#phbAddText'); await page.fill('#phbTText', 'Min kommentar\nrad 2'); await page.fill('#phbTSize', '30'); await page.waitForTimeout(100);
      const s4 = await S(); if (s4.texts !== 1) fail('Text ska finnas: ' + s4.texts);
      const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#phbPdf')]); await dl3.saveAs(process.env.PHB_OUT + '/foto2.pdf');
      const [dl4] = await Promise.all([page.waitForEvent('download'), page.click('#phbPng')]); await dl4.saveAs(process.env.PHB_OUT + '/foto2.png');

      // Objektbubblor (valfria egenskaper + egen text + AMA-kod)
      await page.evaluate(() => { window.__sel = [{ modelId: 'm1', objectRuntimeIds: [1, 2] }]; });
      await page.click('#phbOcNew'); await page.waitForSelector('#phbOcMake', { timeout: 5000 });
      await page.fill('#phbOcDText', 'Egen text här');
      await page.click('[data-ocp="1"]'); await page.selectOption('#phbOcDGroup', 'obj'); await page.click('[data-ocp="1"]'); await page.selectOption('#phbOcDGroup', 'all');
      await page.click('#phbOcMake'); await page.waitForTimeout(300);
      const oc = await page.evaluate(() => { const s = document.getElementById('phbCv')._state(); return { n: (s.ocards || []).length, text: (s.ocards[0] || {}).text, objs: ((s.ocards[0] || {}).objs || []).length }; });
      if (oc.n !== 1 || oc.text !== 'Egen text här' || oc.objs !== 2) fail('Objektbubbla: ' + JSON.stringify(oc));
      const dim = await page.evaluate(() => { const c = document.getElementById('phbCv')._state().ocards[0]; return { h: c.h / c.kk, w: c.W / c.kk, tx: c.tx.length, rows: c.rows.length, tl: c.tl.length }; });
      // 'Egen text' finns här, så testa luftighet med en bubbla utan egen text
      await page.evaluate(() => { const st = document.getElementById('phbCv')._state(); st.ocards[0].text = ''; phbOcMeasure(st.ocards[0], st); });
      const dim2 = await page.evaluate(() => { const c = document.getElementById('phbCv')._state().ocards[0]; return { h: c.h / c.kk, w: c.W / c.kk, tx: c.tx.length, rows: c.rows.length, tl: c.tl.length }; });
      if (dim2.tx !== 0 || dim2.h > 8 + dim2.tl * 18 + 3 + dim2.rows * 15.5 + 9 + 0.01 || dim2.w >= 269.9 && dim2.rows < 2 && dim2.tl === 1) fail('Bubblan ska inte ha tom yta: ' + JSON.stringify([dim, dim2]));
      await page.evaluate(() => { const st = document.getElementById('phbCv')._state(); st.ocards[0].text = 'Egen text här'; phbOcMeasure(st.ocards[0], st); });
      const [dl5] = await Promise.all([page.waitForEvent('download'), page.click('#phbPdf')]); await dl5.saveAs(process.env.PHB_OUT + '/foto3.pdf');
      if (!fs.readFileSync(process.env.PHB_OUT + '/foto3.pdf', 'latin1').includes('bubbla-obj')) fail('PDF saknar objektbubbla');
      const ln = await page.evaluate(() => { const c = document.getElementById('phbCv')._state().ocards[0]; return isFinite(c.ax) && isFinite(c.ay); }); if (!ln) fail('Objektbubblan ska ha en linje/punkt');
      await page.evaluate(() => { const c = document.getElementById('phbCv')._state().ocards[0]; window.__anc = [c.ax, c.ay]; c.ax += 37; c.ay -= 21; });
      await page.fill('#phbVwName', 'Testvy'); await page.click('#phbVwSave'); await page.waitForSelector('#phbVwSel');
      const un = await page.evaluate(() => [phbOcNum('12,3456', 'Qto / NetVolume (m3)', 1), phbOcNum('2500000', 'Area (mm2)', 2), phbOcNum('5', 'Namn', 0)]);
      if (un[0] !== '12,3 m³' || !/^2,50 m²$/.test(un[1].replace(/\s/g, ' ')) || un[2] !== '5') fail('Enheter/decimaler: ' + JSON.stringify(un));
      // Förval: spara bubblans inställning och få den på nästa bubblor från markeringen
      await page.evaluate(() => { const st = document.getElementById('phbCv')._state(), c = st.ocards[0]; c.dec = 3; c.scale = 1.4; c.colOver = '#112233'; c.titleSrc = 'area'; c.text = 'Förvalstext'; c.title = 'Spännarmering'; c.fields = ['◆ Antal objekt']; st.sel = c; });
      await page.evaluate(() => { phbOcSavePreset(document.getElementById('phbCv')._state().ocards[0]); });
      await page.click('#phbOcNew'); await page.waitForSelector('#phbOcMake'); await page.click('#phbOcMake'); await page.waitForTimeout(250);
      const nb = await page.evaluate(() => { const l = document.getElementById('phbCv')._state().ocards, c = l[l.length - 1]; return { dec: c.dec, scale: c.scale, col: c.colOver, src: c.titleSrc, text: c.text, title: c.title, f: c.fields }; });
      if (nb.dec !== 3 || nb.scale !== 1.4 || nb.col !== '#112233' || nb.src !== 'area' || nb.text !== 'Förvalstext' || nb.title !== 'Spännarmering' || JSON.stringify(nb.f) !== '["◆ Antal objekt"]') fail('Förvalet ska gälla nya bubblor: ' + JSON.stringify(nb));
      { const sm = await page.evaluate(() => { const K = 'Qto / NetVolume (m3)', mk = v => ({ flat: { [K]: v } }), objs = [mk('1,5'), mk('2,5'), mk('3'), mk('4')]; return [phbOcVal({}, { objs, dec: 2 }, K)[0], phbOcVal({}, { objs, dec: 2, sum: false }, K)[0], phbOcVal({}, { objs: [objs[0]], dec: 2 }, K)[0], phbOcVal({}, { objs: [objs[0], mk('x')], dec: 1 }, K)[0]]; });
        if (!/^Σ 11,00 m³ \(4 objekt\)$/.test(sm[0])) fail('Summerad volym för 4 objekt: ' + JSON.stringify(sm)); if (/Σ/.test(sm[1]) || /Σ/.test(sm[2]) || /Σ/.test(sm[3])) fail('Ingen summering när av, för ett objekt eller icke-numeriskt: ' + JSON.stringify(sm)); }
      await page.evaluate(() => localStorage.removeItem('4ddash-phb-oc-preset'));
      await page.click('#phbOcDel'); await page.waitForTimeout(100);
      // TC-kameran ändras efter att vyn sparats – "Använd" ska flytta tillbaka den och ta nytt foto
      await page.evaluate(() => { window.__camSaved = JSON.parse(localStorage.getItem('4ddash-phb-views')).slice(-1)[0].data.cam; window.__cam = { position: { x: 5, y: 5, z: 30 }, target: { x: 0, y: 0, z: 0 }, fov: 60 }; window.__setCams = 0; });
      await page.click('#phbVwUse'); await page.waitForFunction(() => window.__setCams > 0, null, { timeout: 8000 }); await page.waitForTimeout(900);
      const camBack = await page.evaluate(() => JSON.stringify(window.__cam) === JSON.stringify(window.__camSaved)); if (!camBack) fail('Kameran ska flyttas tillbaka till den sparade vyn: ' + JSON.stringify(await page.evaluate(() => [window.__cam, window.__camSaved])));
      const anc = await page.evaluate(() => { const c = document.getElementById('phbCv')._state().ocards[0]; return [c.ax, c.ay, window.__anc[0], window.__anc[1]]; });
      if (Math.abs(anc[0] - anc[2]) > 1 || Math.abs(anc[1] - anc[3]) > 1) fail('Insättningspunkten är låst till objektet och ska ligga i objektets läge när en vy läses in: ' + JSON.stringify(anc));
      const vw = await page.evaluate(() => { const s = document.getElementById('phbCv')._state(); return { n: s.ocards.length, t: (s.ocards[0] || {}).text }; });
      if (vw.n !== 1 || vw.t !== 'Egen text här') fail('Sparad vy: ' + JSON.stringify(vw));
      await page.selectOption('#phbOcTSrc', 'area'); await page.click('#phbOcQty'); await page.waitForTimeout(500);
      await page.click('#phbVwDel'); await page.waitForTimeout(100);
      if (await page.locator('#phbVwSel').count()) fail('Vyn ska vara borttagen');
      await page.click('#phbOcDel'); await page.waitForTimeout(100);
      const oc2 = await page.evaluate(() => document.getElementById('phbCv')._state().ocards.length); if (oc2 !== 0) fail('Borttagning: ' + oc2);
      // Mängdtabeller per område (från mängdavtagningen och från markeringen)
      await page.evaluate(() => {
        qmf.builds = ['Hus A']; qmf.map.areas = { 'Område 1': 'Hus A' }; qmf.custom.push({ key: 'c1', ref: 'ESB.1', label: 'Betong platsgjuten', unit: 'm³', k: { 'Hus A': 10 }, p: {} });
        const o = { modelId: 'm1', rid: 1, objectId: 'a1', flat: { Volume: '5' }, item: { area: 'Område 1' } }; qty.objs = [o, { modelId: 'm1', rid: 9, objectId: 'z9', flat: { Volume: '7' }, item: { area: 'Område 1' } }];
        qty.kv = { vol: { valKey: 'Volume', factor: 1 }, form: { valKey: '', factor: 1 } }; qty.keys = new Map(); qmf.map.obj.vol = { [qmfObjKey(qty.objs[0])]: 'c1', [qmfObjKey(qty.objs[1])]: 'c1' }; window.__qtyRead = qtyRead; qtyRead = async () => {};
      });
      await page.selectOption('#phbQtSrc', 'qty'); await page.click('#phbQtNew'); await page.waitForSelector('#phbQtMake', { timeout: 5000 }); await page.click('#phbQtMake'); await page.waitForTimeout(200);
      const qt = await page.evaluate(() => { const t = document.getElementById('phbCv')._state().tables; return { n: t.length, rows: t[0] && t[0].n, a: t[0] && t[0].area, cells: t[0] && t[0].cells.map(c => c.s).join('|') }; });
      if (qt.n !== 1 || qt.rows !== 1 || qt.a !== 'Hus A' || !/12/.test(qt.cells)) fail('Mängdtabell (avtagning): ' + JSON.stringify(qt));
      await page.selectOption('#phbQtSrc', 'sel'); await page.click('#phbQtNew'); await page.waitForSelector('#phbQtMake'); await page.click('#phbQtMake'); await page.waitForTimeout(200);
      const qs = await page.evaluate(() => { const t = document.getElementById('phbCv')._state().tables[1]; return t && t.cells.map(c => c.s).join('|'); });
      if (!qs || !/5/.test(qs) || /12/.test(qs)) fail('Mängdtabell (markering): ' + qs);
      const [dl6] = await Promise.all([page.waitForEvent('download'), page.click('#phbPdf')]); await dl6.saveAs(process.env.PHB_OUT + '/foto4.pdf');
      if (!fs.readFileSync(process.env.PHB_OUT + '/foto4.pdf', 'latin1').includes('lista-tabell2')) fail('PDF saknar mängdtabell');
      const [dl7] = await Promise.all([page.waitForEvent('download'), page.click('#phbPng')]); await dl7.saveAs(process.env.PHB_OUT + '/foto4.png');
      await page.click('#phbQtDel'); await page.waitForTimeout(100);
      if ((await page.evaluate(() => document.getElementById('phbCv')._state().tables.length)) !== 1) fail('Borttagning av tabell');
      await page.evaluate(() => { window.__sel = []; });
      await page.selectOption('#phbScope', 'marked'); await page.waitForTimeout(500);
      const i2 = await page.textContent('.phb-info'); if (!/^0 bubblor/.test(i2)) fail('Bara markerade utan markering: ' + i2);
    }
    await page.click('#phbClose');
  }
  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK'); await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
