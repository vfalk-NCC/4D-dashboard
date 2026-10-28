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
      // Punkten (ankaret) går att flytta för hand (Victor 2026-10-21: "låt mig flytta insättningspunkten").
      { const g = await page.evaluate(() => { const cv = document.getElementById('phbCv'), st = cv._state(), c = st.cards[st.cards.length - 1], r = cv.getBoundingClientRect(); return { ax: c.ax, ay: c.ay, x: r.left + c.ax * r.width / st.W, y: r.top + c.ay * r.height / st.H, f: r.width / st.W }; });
        await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + 40, g.y + 25, { steps: 4 }); await page.mouse.up();
        const g2 = await page.evaluate(() => { const st = document.getElementById('phbCv')._state(), c = st.cards[st.cards.length - 1]; return { ax: c.ax, ay: c.ay, x: c.x, y: c.y }; });
        if (Math.abs(g2.ax - g.ax - 40 / g.f) > 2 || Math.abs(g2.ay - g.ay - 25 / g.f) > 2) fail('Punkten ska gå att flytta för hand: ' + JSON.stringify({ g, g2 })); }
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
      { const r = await page.evaluate(() => { const W = 2000, H = 1000, cam = { position: { x: 0, y: -100, z: 50 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, projectionType: 'ORTHOGRAPHIC', orthoSize: 40 };
          const pts = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: -5, y: 3, z: 0 }]; const c = phbPickCamera(cam, pts, W, H); const q = c && phbProject(c, pts[1], W, H), q0 = c && phbProject(c, pts[0], W, H);
          const pe = phbPickCamera({ ...cam, projectionType: 'perspective', fov: 60 }, pts, W, H);
          const au = phbPickCamera({ position: cam.position, target: cam.target, up: cam.up, projectionType: 'orthographic' }, pts, W, H);
          return { ortho: !!(c && c.ortho), dx: q && q.x - W / 2, cx: q0 && q0.x, persp: !!(pe && !pe.ortho), auto: !!(au && au.ortho && au.vh > 0) }; });
        if (!r.ortho || Math.abs(r.dx - 250) > 2 || Math.abs(r.cx - 1000) > 1 || !r.persp || !r.auto) fail('Parallellprojektion: ' + JSON.stringify(r)); }
      { const r = await page.evaluate(() => { const bx = (x, w, h = 3) => ({ min: { x, y: 0, z: 0 }, max: { x: x + w, y: 2, z: h } }), objs = [{ box: bx(0, 2) }, { box: bx(10, 4) }, { box: bx(14, 0.2, 8) }];
          const cam = phbPickCamera({ position: { x: 7, y: -40, z: 20 }, lookAt: { x: 7, y: 1, z: 1 }, upDirection: { x: 0, y: 0, z: 1 }, projectionType: 'perspective', fieldOfView: 60 }, [{ x: 7, y: 1, z: 3 }, { x: 11, y: 1, z: 3 }, { x: 1, y: 1, z: 3 }], 2000, 1000);
          const st = { camC: cam, W: 2000, H: 1000 }; const q = phbOcAnchor(st, objs), qB = phbProject(cam, { x: 12, y: 1, z: 3 }, 2000, 1000);
          return { q, qB, one: phbOcAnchor(st, [objs[0]]), oneExp: phbProject(cam, { x: 1, y: 1, z: 3 }, 2000, 1000) }; });
        if (!r.q || Math.abs(r.q.x - r.qB.x) > 0.5 || Math.abs(r.q.y - r.qB.y) > 0.5 || Math.abs(r.one.x - r.oneExp.x) > 0.5) fail('Punkten ska ligga på huvudobjektet (störst volym): ' + JSON.stringify(r)); }
      { const r = await page.evaluate(() => { // Trimble Connects verkliga kameraformat (Victor 2026-10-21)
          const cam = { position: { x: 169133.54881845822, y: 7456772.143193085, z: 480.1904816832895 }, lookAt: { x: 169132.6587369766, y: 7456771.8760279175, z: 479.82118812867105 }, upDirection: { x: -0.353703678780377, y: -0.10616702454128912, z: 0.9293127947667983 }, quaternion: { x: -0.66, y: 0.49, z: 0.33, w: -0.45 }, pitch: 1.1925476014359826, yaw: 1.8623981617542575, projectionType: 'perspective', fieldOfView: 60, orthoSize: 1 };
          const f = { x: cam.lookAt.x - cam.position.x, y: cam.lookAt.y - cam.position.y, z: cam.lookAt.z - cam.position.z }, L = Math.hypot(f.x, f.y, f.z), P = { x: cam.position.x + f.x / L * 20, y: cam.position.y + f.y / L * 20, z: cam.position.z + f.z / L * 20 };
          const pts = [P, { x: P.x + 3, y: P.y - 4, z: P.z }, { x: P.x - 2, y: P.y + 5, z: P.z - 1 }], c = phbPickCamera(cam, pts, 1800, 960), q = c && phbProject(c, P, 1800, 960);
          return { ok: !!c, ortho: !!(c && c.ortho), why: c && c.why, x: q && q.x, y: q && q.y }; });
        if (!r.ok || r.ortho || r.why !== 'mål' || Math.abs(r.x - 900) > 0.5 || Math.abs(r.y - 480) > 0.5) fail('Verkligt TC-kameraformat: ' + JSON.stringify(r)); }
      { const r = await page.evaluate(() => { const W = 1800, H = 960, pos = { x: 0, y: -500, z: 300 }, fwd = phbNorm({ x: 0, y: 500, z: -300 }), up = { x: 0, y: 0, z: 1 }, cam = { orthoSize: 100 };
          const c = { pos, fwd, up, ortho: true, vh: 100, sc: 1, fov: 60 }, P = { x: 12, y: 3, z: 1 }, right = phbNorm(phbCross(fwd, up)), upv = phbCross(right, fwd), d = phbSub(P, pos), ps = H / 25;
          const click = { x: W / 2 + phbDot(d, right) * ps, y: H / 2 - phbDot(d, upv) * ps }, r1 = phbCalibrate(c, cam, P, click, W, H);
          const cp = { pos, fwd, up, fov: 60, sc: 1 }, q = phbProject(cp, P, W, H), q2 = { x: W / 2 + (q.x - W / 2) * 1.5, y: H / 2 + (q.y - H / 2) * 1.5 }, r2 = phbCalibrate(cp, {}, P, q2, W, H);
          return { k1: r1 && r1.k, m1: r1 && r1.mode, k2: r2 && r2.k, m2: r2 && r2.mode }; });
        if (r.m1 !== 'ortho' || Math.abs(r.k1 - 0.25) > 0.002 || r.m2 !== 'persp' || Math.abs(r.k2 - 1.5) > 0.02) fail('Kalibrering med ett klick: ' + JSON.stringify(r)); }
      await page.evaluate(() => localStorage.removeItem('4ddash-phb-oc-preset'));
      await page.click('#phbOcDel'); await page.waitForTimeout(100);
      // TC-kameran ändras efter att vyn sparats – "Använd" ska flytta tillbaka den och ta nytt foto
      await page.evaluate(() => { window.__camSaved = JSON.parse(localStorage.getItem('4ddash-phb-views')).slice(-1)[0].data.cam; window.__cam = { position: { x: 5, y: 5, z: 30 }, target: { x: 0, y: 0, z: 0 }, fov: 60 }; window.__setCams = 0; });
      await page.click('#phbVwUse'); await page.waitForFunction(() => window.__setCams > 0, null, { timeout: 8000 }); await page.waitForTimeout(900);
      const camBack = await page.evaluate(() => JSON.stringify(window.__cam) === JSON.stringify(window.__camSaved)); if (!camBack) fail('Kameran ska flyttas tillbaka till den sparade vyn: ' + JSON.stringify(await page.evaluate(() => [window.__cam, window.__camSaved])));
      const anc = await page.evaluate(() => { const c = document.getElementById('phbCv')._state().ocards[0]; return [c.ax, c.ay, window.__anc[0], window.__anc[1]]; });
      if (Math.abs(anc[0] - anc[2]) > 1 || Math.abs(anc[1] - anc[3]) > 1) fail('Oflyttad insättningspunkt ska ligga i objektets läge när en vy läses in: ' + JSON.stringify(anc));
      // Flytta punkten för hand, spara vyn och läs in den: punkten behåller sitt läge; dubbelklick återställer.
      { const g = await page.evaluate(() => { const cv = document.getElementById('phbCv'), st = cv._state(), c = st.ocards[0], r = cv.getBoundingClientRect(); return { ax: c.ax, ay: c.ay, x: r.left + c.ax * r.width / st.W, y: r.top + c.ay * r.height / st.H, f: r.width / st.W }; });
        await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + 30, g.y + 20, { steps: 4 }); await page.mouse.up();
        const m1 = await page.evaluate(() => { const c = document.getElementById('phbCv')._state().ocards[0]; return { ax: c.ax, ay: c.ay, free: c.free }; });
        if (!m1.free || Math.abs(m1.ax - g.ax - 30 / g.f) > 2) fail('objektbubblans punkt går att flytta: ' + JSON.stringify({ g, m1 }));
        await page.evaluate(() => { const st = document.getElementById('phbCv')._state(), c = st.cards[0]; window.__cardPos = null; if (c) { c.x = st.W * 0.31; c.y = st.H * 0.22; c.text = 'Flyttad bubbla'; c.scale = 1.2; phbCardMeasure(c, st); window.__cardPos = [c.x / st.W, c.y / st.H, phbKey(c.a)]; } });
        await page.evaluate(() => { const st = document.getElementById('phbCv')._state(); st.list.on = true; window.__lsel = [...st.list.sel].sort().join('|'); const k = [...st.list.sel][0]; if (k) st.list.sel.delete(k); window.__lsel2 = [...st.list.sel].sort().join('|'); });
        await page.fill('#phbVwName', 'Flyttad'); await page.click('#phbVwSave'); await page.waitForTimeout(300);
        await page.selectOption('#phbVwSel', { label: 'Flyttad' }); await page.click('#phbVwUse'); await page.waitForTimeout(1200);
        const m2 = await page.evaluate(() => { const c = document.getElementById('phbCv')._state().ocards[0]; return { ax: c.ax, ay: c.ay }; });
        { const ls = await page.evaluate(() => [window.__lsel2, [...document.getElementById('phbCv')._state().list.sel].sort().join('|'), window.__lsel]); if (ls[0] !== ls[1]) fail('Listans valda aktiviteter ska sparas i vyn: ' + JSON.stringify(ls)); console.log('OK: listans aktiviteter sparas i vyn'); }
        { const r = await page.evaluate(async () => { const st = document.getElementById('phbCv')._state(), n0 = st.cards.length; if (!n0) return null; const gone = st.cards.pop(); const k0 = st.cards.length; const add = await phbVwAddActive(st); const dn = phbVwDropDone(st); return { n0, k0, added: add.n, now: st.cards.length, dn }; });
          if (r && (r.added > 1 || r.now > r.n0)) fail('Lägg till pågående / ta bort klara: ' + JSON.stringify(r)); console.log('OK: lägg till pågående / ta bort klara ' + JSON.stringify(r)); }
        { const cp0 = await page.evaluate(() => window.__cardPos); if (cp0) { const cp = await page.evaluate(() => { const st = document.getElementById('phbCv')._state(), c = st.cards.find(k => phbKey(k.a) === window.__cardPos[2]); return c ? [c.x / st.W, c.y / st.H, c.text, c.scale] : null; });
          if (!cp || Math.abs(cp[0] - cp0[0]) > 0.002 || Math.abs(cp[1] - cp0[1]) > 0.002 || cp[2] !== 'Flyttad bubbla' || cp[3] !== 1.2) fail('Aktivitetsbubblan ska ligga kvar på exakt samma plats i den sparade vyn: ' + JSON.stringify([cp0, cp])); console.log('OK: aktivitetsbubblor sparas i vyn'); } else console.log('(inga aktivitetsbubblor i testet – hoppade över)'); }
        { await page.waitForTimeout(700); const files = [...store.keys()].filter(k => /plan_photo_views\.json$/.test(k)); if (files.length !== 1) fail('Vyerna ska ligga i plan_photo_views.json: ' + [...store.keys()].join());
    const arr = JSON.parse(store.get(files[0]).content); if (!arr.length || !arr.every(v => v.id && v.name && v.data)) fail('Vyerna i 4D-datan: ' + JSON.stringify(arr).slice(0, 200)); console.log('OK: vyerna sparas i 4D-datan (' + arr.length + ')'); }

        if (Math.abs(m2.ax - m1.ax) > 2 || Math.abs(m2.ay - m1.ay) > 2) fail('flyttad punkt behåller sitt läge efter inläsning: ' + JSON.stringify({ m1, m2 }));
        const g3 = await page.evaluate(() => { const cv = document.getElementById('phbCv'), st = cv._state(), c = st.ocards[0], r = cv.getBoundingClientRect(); return { x: r.left + c.ax * r.width / st.W, y: r.top + c.ay * r.height / st.H }; });
        await page.mouse.dblclick(g3.x, g3.y); await page.waitForTimeout(200);
        const m3 = await page.evaluate(() => { const c = document.getElementById('phbCv')._state().ocards[0]; return { ax: c.ax, ay: c.ay, free: c.free }; });
        if (m3.free || Math.abs(m3.ax - g.ax) > 2 || Math.abs(m3.ay - g.ay) > 2) fail('dubbelklick återställer punkten: ' + JSON.stringify({ g, m3 }));
        await page.selectOption('#phbVwSel', { label: 'Flyttad' }); await page.click('#phbVwDel'); await page.waitForTimeout(200); }
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
    const nd = dialogs.length; await page.click('#phbClose'); await page.waitForTimeout(150);
    if (dialogs.length !== nd + 1 || !/Stänga bildredigeraren/.test(dialogs[dialogs.length - 1])) fail('Stängning ska fråga först: ' + JSON.stringify(dialogs.slice(-2)));
    if (await page.$('#phbDlg')) fail('Fönstret ska stängas efter ja');
    console.log('OK: frågar innan bildredigeraren stängs');
    // Avvisa: fönstret ska vara kvar (tryck utanför / Esc)
    await page.evaluate(() => { window.__nc = 0; });
  }
  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK'); await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
