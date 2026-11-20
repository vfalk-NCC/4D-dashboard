// Foto med bubblor (Victor 2026-10-15): kameraknappen i Gantt tar en stillbild ur TC och lägger bubblor på den.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8979;
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
  const ok = (c, m) => { if (!c) fail(m); };
  await page.evaluate(() => { window.__cam = null; localStorage.removeItem('4ddash-phb-views'); });
  await page.dispatchEvent('#ganttPhotoBtn', 'click'); await page.waitForSelector('#phbDlg canvas', { timeout: 15000 }); await page.waitForTimeout(400);
  const st = fn => page.evaluate(fn);
  const clickCard = async i => { const g = await page.evaluate(i => { const cv = document.getElementById('phbCv'), s = cv._state(), c = s.cards[i], r = cv.getBoundingClientRect(); return { x: r.left + (c.x + c.W / 2) * r.width / s.W, y: r.top + (c.y + c.h / 2) * r.height / s.H }; }, i); await page.mouse.click(g.x, g.y); await page.waitForTimeout(150); };
  ok(await st(() => document.getElementById('phbCv')._state().cards.length) >= 3, 'Behöver bubblor att arbeta med');
  // 1) Manuella värden på en aktivitetsbubbla
  await clickCard(0); await page.waitForSelector('#phbCPr');
  const before = await st(() => { const c = document.getElementById('phbCv')._state().cards.find(c => c === document.getElementById('phbCv')._state().sel); return { prog: c.prog, key: phbKey(c.a) }; });
  await page.fill('#phbCPr', '77'); await page.press('#phbCPr', 'Tab'); await page.waitForTimeout(150);
  await page.fill('#phbCDt', '3 dec – 12 dec'); await page.fill('#phbCText', 'Gjutning pelare P1'); await page.waitForTimeout(150);
  const c0 = await st(() => { const s = document.getElementById('phbCv')._state(), c = s.sel; return { prog: c.prog, sub: c.sub, name: c.name.join(' ') }; });
  ok(c0.prog === 77 && c0.sub[0] === '3 dec – 12 dec' && /Gjutning pelare P1/.test(c0.name), 'Manuella värden: ' + JSON.stringify(c0));
  // 2) Lås: går inte att dra
  await page.click('#phbCLock'); await page.waitForTimeout(100);
  const p0 = await st(() => { const c = document.getElementById('phbCv')._state().sel; return [c.x, c.y, c.lock]; });
  { const g = await page.evaluate(() => { const cv = document.getElementById('phbCv'), s = cv._state(), c = s.sel, r = cv.getBoundingClientRect(); return { x: r.left + (c.x + c.W / 2) * r.width / s.W, y: r.top + (c.y + c.h / 2) * r.height / s.H }; });
    await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + 60, g.y + 30, { steps: 4 }); await page.mouse.up(); }
  const p1 = await st(() => { const c = document.getElementById('phbCv')._state().sel; return [c.x, c.y, c.lock]; });
  ok(p0[2] === true && p1[0] === p0[0] && p1[1] === p0[1], 'Låst bubbla ska ligga kvar: ' + JSON.stringify([p0, p1]));
  // Ordna om rör inte den låsta
  await page.click('#phbArrange'); await page.waitForTimeout(100);
  const p2 = await st(() => { const c = document.getElementById('phbCv')._state().sel; return [c.x, c.y]; }); ok(p2[0] === p0[0] && p2[1] === p0[1], 'Ordna om ska inte flytta låsta: ' + JSON.stringify(p2));
  // 3) Fri bubbla
  const n0 = await st(() => document.getElementById('phbCv')._state().cards.length);
  await page.click('#phbAddFree'); await page.waitForSelector('#phbCText'); await page.fill('#phbCText', 'Min bubbla'); await page.fill('#phbCPr', '33'); await page.press('#phbCPr', 'Tab'); await page.waitForTimeout(150);
  const fr = await st(() => { const s = document.getElementById('phbCv')._state(), c = s.cards.find(c => c.a.__free); return { n: s.cards.length, prog: c.prog, name: c.name.join(' '), ax: c.ax, ay: c.ay, ph: c.ph }; });
  ok(fr.n === n0 + 1 && fr.prog === 33 && /Min bubbla/.test(fr.name) && isFinite(fr.ax), 'Fri bubbla: ' + JSON.stringify(fr));
  const frPos = await st(() => { const c = document.getElementById('phbCv')._state().cards.find(c => c.a.__free); return [c.x, c.y, c.ax, c.ay]; });
  // 4) Spara vy
  await page.fill('#phbVwName', 'Vecka A'); await page.click('#phbVwSave'); await page.waitForSelector('#phbVwSel');
  const saved = await st(() => JSON.parse(localStorage.getItem('4ddash-phb-views')).find(v => v.name === 'Vecka A').data);
  const sc = saved.cards.find(c => c.key === before.key), sf = saved.cards.find(c => c.fa);
  ok(saved.asp > 0 && sc.progOver === 77 && sc.dtOver === '3 dec – 12 dec' && sc.lock === 1 && sf && sf.text === 'Min bubbla' && sf.fax > 0, 'Vyn sparar allt: ' + JSON.stringify([saved.asp, sc, sf]));
  // 5) Ändra allt, hämta vyn exakt
  await st(() => { const s = document.getElementById('phbCv')._state(), c = s.cards.find(c => c.a.__free); s.cards.splice(s.cards.indexOf(c), 1); const k = s.cards[0]; k.progOver = null; k.dtOver = ''; k.lock = false; k.x += 40; });
  await page.evaluate(() => { window.__setCams = 0; window.__cam = { position: { x: 5, y: 5, z: 30 }, target: { x: 0, y: 0, z: 0 }, fov: 60 }; });
  await page.selectOption('#phbVwMode', 'exact'); await page.click('#phbVwUse'); await page.waitForTimeout(1800);
  ok(true, '');
  const b2 = await page.evaluate(key => { const s = document.getElementById('phbCv')._state(), c = s.cards.find(c => phbKey(c.a) === key), f = s.cards.find(c => c.a.__free); return { n: s.cards.length, prog: c && c.prog, lock: c && c.lock, pos: c && [c.x, c.y], f: f && [f.x, f.y, f.ax, f.ay], fname: f && f.name.join(' '), fprog: f && f.prog, camBack: !!window.__setCams }; }, before.key);
  ok(b2.n === n0 + 1 && b2.prog === 77 && b2.lock === true && Math.abs(b2.pos[0] - p0[0]) < 1.5 && Math.abs(b2.pos[1] - p0[1]) < 1.5 && b2.f && Math.abs(b2.f[0] - frPos[0]) < 1.5 && Math.abs(b2.f[3] - frPos[3]) < 1.5 && /Min bubbla/.test(b2.fname) && b2.fprog === 33 && b2.camBack, 'Vyn återskapar exakt: ' + JSON.stringify([b2, p0, frPos]));
  // 6) Ny vecka-läge och kopia
  await page.selectOption('#phbVwMode', 'week'); await page.click('#phbVwUse'); await page.waitForTimeout(1800);
  const wk = await st(() => document.getElementById('phbCv')._state().cards.some(c => c.a.__free && c.prog === 33));
  ok(wk, 'Fria bubblor ska finnas kvar i veckoläget');
  await page.click('#phbVwCopy'); await page.waitForTimeout(300);
  const names = await st(() => JSON.parse(localStorage.getItem('4ddash-phb-views')).map(v => v.name));
  ok(names.length === 2 && names.some(n => /^Vecka A · \d{4}-\d{2}-\d{2}$/.test(n)), 'Ny vecka sparar en kopia: ' + JSON.stringify(names));
  // 7) Annat bildformat varnar
  await st(() => { const v = phbVwLoad().find(v => v.name === 'Vecka A'); v.data.asp = 0.9; });
  await page.selectOption('#phbVwSel', { label: 'Vecka A' }); await page.selectOption('#phbVwMode', 'exact'); await page.click('#phbVwUse'); await page.waitForTimeout(1500);
  const msg = await page.textContent('#phbVwMsg'); ok(/⚠/.test(msg) && /format/.test(msg), 'Varning vid annat format: ' + msg);
  // 8) Sparad PNG/PDF fungerar med fria bubblor
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#phbPng')]); ok(!!dl, 'PNG');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#phbPdf')]); ok(!!dl2, 'PDF');
  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('OK test_photo_bubble_views'); await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
