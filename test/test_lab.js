// Visa endast kopplade (Gantt-schemat): isolerar i 3D-modellen bara objekten som är kopplade till aktiviteterna som visas
// (Victor 2026-10-13); följer sökning/filter; ett tryck till visar hela modellen igen.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8998;
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
  it('Platta SF1', 'SF1', 'Betong', -30, -20, { contractor: 'NCC', status: 'klar', progress: 100, actual_start_date: day(-30), actual_end_date: day(-17), estimated_hours: 160 }),
  it('Vägg SF1', 'SF1', 'Betong', -19, -5, { contractor: 'NCC', progress: 100, status: 'klar', actual_start_date: day(-19), actual_end_date: day(-2), depends_on: ['i1'], estimated_hours: 400 }),
  it('Stål SF1', 'SF1', 'Stål', -4, 10, { contractor: 'Stål AB', progress: 30, depends_on: ['i2'], estimated_hours: 300, actual_start_date: day(-4) }),
  it('Tak SF1', 'SF1', 'Tak', 11, 25, { contractor: 'Tak AB', depends_on: ['i3'], estimated_hours: 200 }),
  it('Platta SF2', 'SF2', 'Betong', 0, 8, { contractor: 'NCC', estimated_hours: 100 }),
  it('Vägg SF2', 'SF2', 'Betong', 9, 20, { contractor: 'NCC', depends_on: ['i5'] }),
]);
seed('plan_item_activities.json', []);
seed('plan_deliveries.json', [{ id: 'd1', planned_date: day(7), area: 'SF1', description: 'Takelement', supplier: 'Lev AB', space_m2: 40, project_id: PID }]);
['plan_milestones.json', 'plan_item_baseline_history.json'].forEach(f => seed(f, []));

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
      viewer: { isolateEntities: () => Promise.resolve(), setObjectState: () => Promise.resolve(), setCamera: () => Promise.resolve(), getModels: () => Promise.resolve([{ id: 'M1', state: 'loaded' }]), getObjects: () => Promise.resolve([{ modelId: 'M1', objects: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }] }]),
        getObjectProperties: (m, ids) => Promise.resolve(ids.map(id => ({ id, class: 'IfcWall', product: { name: 'Obj' + id }, properties: [{ set: 'Tekla', properties: [{ name: 'Zon', value: id <= 2 ? '7426 SF1 Level 1' : id <= 4 ? '7421' : id === 6 ? '7426 SF1 Level 1' : 'annat' }] }] }))),
        getSelection: () => Promise.resolve([]), convertToObjectIds: (m, r) => Promise.resolve(r.map(x => 'G' + x)), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids.map(x => Number(String(x).slice(1)))), setSelection: s => { (window.__setsel = window.__setsel || []).push(s); return Promise.resolve(); } }
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
  await page.click('[data-gantt-view="test"]'); await page.waitForSelector('.lab-tabs'); await page.waitForTimeout(400);
  const tab = async k => { await page.click(`[data-lab="${k}"]`); await page.waitForTimeout(300); if (process.env.SHOT) await page.screenshot({ path: `/tmp/lab_${k}.png` }); };
  const body = () => page.evaluate(() => document.getElementById('labBody').innerText);
  // 1 Kapsel
  const prev = async () => { await page.click('#labPrev'); await page.waitForSelector('.lab-frame'); await page.waitForTimeout(500); };
  await prev();
  const fr = page.frames().find(f => f !== page.mainFrame());
  const txt = await fr.evaluate(() => document.body.innerText);
  if (!/pågår idag/i.test(txt) || !/Stål SF1/.test(txt) || !/Takelement/.test(txt)) fail('kapseln ska visa pågående + leverans: ' + txt.slice(0, 300));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#labMake')]);
  const html = fs.readFileSync(await dl.path(), 'utf8');
  if (!/<!doctype html>/i.test(html) || !html.includes('Platta SF2') || html.includes('http://localhost')) fail('kapselfilen är fristående');
  // 2 Mitt-vecka
  await tab('week'); await page.selectOption('#labUe', 'Stål AB'); await prev();
  const fr2 = page.frames().find(f => f !== page.mainFrame());
  const t2 = await fr2.evaluate(() => document.body.innerText);
  if (!/Stål SF1/.test(t2) || /Platta SF2/.test(t2.split(/TIDSLINJE/i)[0])) fail('bara Stål AB:s aktiviteter före tidslinjen: ' + t2.slice(0, 400));
  // 3 QR
  await tab('qr'); await page.fill('#labBase', 'https://x.se/kapsel.html');
  if ((await page.$$('.lab-qrs figure svg')).length !== 2) fail('en QR per område');
  // 4 Dossier
  await tab('dossier'); await prev();
  const fr3 = page.frames().find(f => f !== page.mainFrame());
  const t4 = await fr3.evaluate(() => document.body.innerText);
  if (!/SF1/.test(t4) || !/SF2/.test(t4) || !/Takelement/.test(t4)) fail('dossier: ' + t4.slice(0, 300));
  // 5 Prognos
  await tab('forecast'); let t = await body();
  if (!/planerat slut/.test(t) || !/chans att hålla planen/.test(t) || !/Stål AB|NCC/.test(t)) fail('prognos: ' + t.slice(0, 400));
  // 6 Mängd→tid (utan inlästa mängder)
  await tab('qtytime'); if (!/Läs in mängder/.test(await body())) fail('mängd→tid utan mängder ska erbjuda inläsning');
  // 8 Platsdiagram
  await tab('place'); if ((await page.$$('.lab-pb')).length !== 6) fail('6 staplar i platsdiagrammet'); 
  // 9 Trängsel
  await tab('crowd'); if (!(await page.$$('.lab-heat td')).length) fail('värmekarta'); 
  await page.click('#lab3d'); await page.waitForTimeout(400);
  // 10 Logistik
  await tab('logi'); t = await body();
  if (!/Behov per aktivitet/.test(t) || !/Tak SF1/.test(t)) fail('logistik: ' + t.slice(0, 300));
  // 7 Vad händer om
  await page.click('[data-gantt-view="bars"]'); await page.waitForTimeout(300);
  await page.click('#ganttWhatIfBtn'); await page.waitForSelector('.wi-ops');
  const optVal = await page.evaluate(() => { const o = [...document.querySelectorAll('#wiAct option')].find(x => /Stål SF1/.test(x.textContent)); return o.value; });
  await page.selectOption('#wiAct', optVal); await page.fill('#wiDays', '10'); await page.click('[data-act="add"]'); await page.waitForTimeout(200);
  const r = await page.evaluate(() => document.querySelector('.wi-res').innerText);
  if (!/aktiviteter påverkas/.test(r) || !/Tak SF1/.test(r)) fail('vad händer om ska flytta Tak SF1 med: ' + r.slice(0, 300));
  const before = JSON.stringify(get('plan_items.json').map(x => [x.id, x.start_date, x.end_date]));
  if (process.env.SHOT) await page.screenshot({ path: '/tmp/lab_whatif.png' });
  await page.fill('#wiName', 'Test10'); await page.click('[data-act="save"]'); await page.waitForTimeout(200);
  if (!/Test10/.test(await page.evaluate(() => document.querySelector('.wi-saved').innerText))) fail('scenariot sparas');
  if (before !== JSON.stringify(get('plan_items.json').map(x => [x.id, x.start_date, x.end_date]))) fail('inget får ändras i datat före Genomför');
  await page.click('[data-act="apply"]'); await page.waitForTimeout(1200);
  const tak = get('plan_items.json').find(x => x.object_name === 'Tak SF1');
  if (tak.start_date !== day(21)) fail('Genomför flyttar Tak SF1 +10 d: ' + tak.start_date + ' vs ' + day(21));
  const real = errors.filter(e => !/allow-same-origin/.test(e)); if (real.length) fail('JS-fel: ' + real.join(' | '));
  console.log('OK test_lab'); await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
