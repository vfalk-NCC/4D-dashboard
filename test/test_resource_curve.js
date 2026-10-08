// Resurser (Victor 2026-10-08): "Avancerat (resurser)" i Redigera aktivitet (resurs, antal, timmar –
// sparas i plan_items.resources för alla objekt i aktiviteten) och Resurskurvan under Gantt-schemat
// (personer/timmar per vecka och resurs; följer filter och dolda områden; en aktivitet räknas en gång).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8966;
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
// Veckan som börjar om 7 dagar räknat från måndag (stabilt oberoende av dagens veckodag).
const mon = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7); return d; })();
const wd = k => { const d = new Date(mon); d.setUTCDate(d.getUTCDate() + k); return iso(d); };
const R = (name, qty, hours, s, e) => ({ name, qty, hours, start: wd(s), end: wd(e) });
seed('plan_items.json', [
  // Gjutning: två 3D-objekt (samma aktivitet) – räknas en gång. 4 betongarbetare mån–fre vecka 1, 160 h.
  { ...it('G-a', 'Hus A', 'Gjutning', 0, 4, { group_id: 'G1' }), start_date: wd(0), end_date: wd(4), resources: [R('R012 Betongarbetare', 4, 160, 0, 4)] },
  { ...it('G-b', 'Hus A', 'Gjutning', 0, 4, { group_id: 'G1' }), start_date: wd(0), end_date: wd(4), resources: [R('R012 Betongarbetare', 4, 160, 0, 4)] },
  // Montage: 2 snickare två veckor (80 h), entreprenör Peri.
  { ...it('M', 'Hus B', 'Montage', 0, 11, { contractor: 'Peri' }), start_date: wd(0), end_date: wd(11), resources: [R('R01 Byggnadsarbetare', 2, 160, 0, 11)] },
  { ...it('Utan', 'Hus B', 'Övrigt', 0, 4), start_date: wd(0), end_date: wd(4) },
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
      viewer: { getSelection: () => Promise.resolve([]), convertToObjectIds: () => Promise.resolve([]), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids), getObjectProperties: () => Promise.resolve([]), setSelection: () => Promise.resolve() }
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
  await page.evaluate(() => { ganttGroupBy = 'area'; ganttHiddenGroups = new Set(); ganttRangeStart = null; ganttRangeEnd = null; rcPrefs = { mode: 'people', only: '', table: true }; renderAll(); });
  await page.waitForTimeout(400);
  const table = () => page.evaluate(() => [...document.querySelectorAll('#resourceCurve .rc-table tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim().replace(/^v\.\d+\s*/, ''))).filter(r => r[r.length - 1]));
  const heads = await page.evaluate(() => [...document.querySelectorAll('#resourceCurve .rc-table thead th')].map(th => th.textContent));
  if (heads.join() !== 'Vecka,R01 Byggnadsarbetare,R012 Betongarbetare,Totalt') fail('Kolumner: ' + heads);
  let t = await table();
  // Vecka 1: 2 snickare + 4 betong (inte 8: aktiviteten räknas en gång) = 6; vecka 2: 2 snickare.
  if (t.length !== 2 || t[0].slice(1).join('|') !== '2|4|6' || t[1].slice(1).join('|') !== '2||2') fail('Personer per vecka: ' + JSON.stringify(t));
  await page.click('#resourceCurve [data-rc-mode="hours"]');
  t = await table();
  if (t[0].slice(1).join('|') !== '80|160|240' || t[1].slice(1).join('|') !== '80||80') fail('Timmar per vecka: ' + JSON.stringify(t));
  // Filter (entreprenör Peri) och dolt område (Hus B) följs.
  await page.selectOption('#filterContractor', 'Peri'); await page.waitForTimeout(300);
  t = await table();
  if (t.length !== 2 || t[0].slice(1).join('|') !== '80|80') fail('Filtret ska följas: ' + JSON.stringify(t));
  await page.selectOption('#filterContractor', ''); await page.waitForTimeout(200);
  await page.evaluate(() => { ganttHiddenGroups = new Set(['area:Hus B']); renderGantt(getFilteredItems()); }); await page.waitForTimeout(300);
  t = await table();
  if (t.length !== 1 || t[0].slice(1).join('|') !== '160|160') fail('Dolda områden ska följas: ' + JSON.stringify(t));
  await page.evaluate(() => { ganttHiddenGroups = new Set(); rcPrefs.table = false; renderGantt(getFilteredItems()); }); await page.waitForTimeout(300);
  const svg = await page.evaluate(() => ({ bars: document.querySelectorAll('#resourceCurve .rc-svg rect[fill]').length, chips: [...document.querySelectorAll('#resourceCurve .rc-chip')].map(c => c.textContent.trim()) }));
  if (svg.bars < 3 || svg.chips.length !== 2) fail('Diagrammet: ' + JSON.stringify(svg));
  console.log('OK: resurskurvan – personer och timmar per vecka och resurs, en aktivitet en gång, följer filter och dolda områden');
  // Redigera aktivitet: Avancerat (resurser) – lägg till en resurs på aktiviteten "Utan" och ändra Gjutning.
  await page.evaluate(() => { ganttEditable = true; });
  await page.click('[data-gantt-view="board"]'); await page.waitForTimeout(300);
  const noteOf = name => page.evaluate(n => { const it = items.find(x => x.objectName === n); return `#ganttChart .pnote[data-item-id="${it.id}"]`; }, name);
  await page.dblclick(await noteOf('G-a')); await page.waitForTimeout(200);
  const dlg = await page.evaluate(() => ({ open: document.querySelector('.na-res').open, sum: document.querySelector('.na-res-sum').textContent, rows: [...document.querySelectorAll('.na-res-row')].map(r => [r.querySelector('.nr-name').value, r.querySelector('.nr-qty').value, r.querySelector('.nr-hours').value].join('/')) }));
  if (!/1 resurs, 160 h/.test(dlg.sum) || dlg.rows.join() !== 'R012 Betongarbetare/4/160') fail('Dialogen: ' + JSON.stringify(dlg));
  if (!dlg.open) await page.click('.na-res > summary');
  await page.fill('.na-res-row .nr-qty', '6');
  await page.click('.na-res-add');
  await page.fill('.na-res-row >> nth=1 >> .nr-name', 'Kranförare'); await page.fill('.na-res-row >> nth=1 >> .nr-hours', '40');
  await page.click('.na-save'); await page.waitForTimeout(700);
  const saved = get('plan_items.json').filter(r => r.group_id === 'G1').map(r => JSON.stringify(r.resources.map(x => [x.name, x.qty, x.hours])));
  if (saved.length !== 2 || saved.some(s => s !== '[["R012 Betongarbetare",6,160],["Kranförare",1,40]]')) fail('Sparat på alla objekt i aktiviteten: ' + JSON.stringify(saved));
  // Ångra tar tillbaka.
  await page.evaluate(() => undoSchedule()); await page.waitForTimeout(600);
  const undone = get('plan_items.json').filter(r => r.group_id === 'G1').map(r => JSON.stringify((r.resources || []).map(x => [x.name, x.qty, x.hours])));
  if (undone.some(s => s !== '[["R012 Betongarbetare",4,160]]')) fail('Ångra ska ta tillbaka resurserna: ' + JSON.stringify(undone));
  console.log('OK: Avancerat (resurser) i Redigera aktivitet – visar, ändrar och lägger till, sparas på alla objekt i aktiviteten, går att ångra');
  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
