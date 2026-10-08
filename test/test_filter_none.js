// Filtret "Utan entreprenör" (Victor 2026-10-08): ett eget val för aktiviteter utan entreprenör
// (likadant för område och aktivitet), bara när sådana finns.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8964;
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
  it('A1', 'Inköp', 'Leverans', 0, 5), it('B1', 'Sektionsfickor', 'Valv', 1, 8), it('B2', 'Sektionsfickor', 'Valv', 2, 9),
  it('C1', 'Sikthall', 'Grund', 3, 10, { contractor: '' }), it('C2', 'Sikthall', 'Grund', 4, 9, { contractor: null }),
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
  // Entreprenör: flera val (Victor 2026-10-08) – lista att bocka i, med "Utan entreprenör" först.
  await page.click('#filterContractorBtn');
  const opts = await page.evaluate(() => [...document.querySelectorAll('#contractorFilterPop .ggp-row')].map(o => o.textContent.trim()));
  if (opts.join() !== 'Utan entreprenör,NCC') fail('Valen: ' + opts);
  const areaOpts = await page.evaluate(() => [...document.querySelectorAll('#filterArea option')].map(o => o.textContent));
  if (areaOpts.includes('Utan område')) fail('"Utan område" ska bara visas när det finns sådana: ' + areaOpts);
  await page.check('#contractorFilterPop .ggp-row >> nth=0'); await page.waitForTimeout(300);
  let shown = await page.evaluate(() => getFilteredItems().map(it => it.objectName).sort().join());
  if (shown !== 'C1,C2' || (await page.textContent('#filterContractorBtn')).trim() !== 'Utan entreprenör ▾') fail('Utan entreprenör ska visa C1 och C2: ' + shown);
  await page.check('#contractorFilterPop .ggp-row >> nth=1'); await page.waitForTimeout(300);
  shown = await page.evaluate(() => getFilteredItems().length);
  if (shown !== 5 || (await page.textContent('#filterContractorBtn')).trim() !== '2 entreprenörer ▾') fail('Två val ska visa alla fem: ' + shown);
  await page.uncheck('#contractorFilterPop .ggp-row >> nth=0'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => getFilteredItems().length)) !== 3) fail('Bara NCC ska visa 3');
  // Sök + Välj träffarna, Esc stänger, Rensa filter nollställer.
  await page.fill('#contractorFilterPop .ggp-search', 'utan');
  await page.click('#contractorFilterPop [data-cf="match"]'); await page.waitForTimeout(200);
  if ((await page.evaluate(() => filters.contractor.length)) !== 2) fail('Välj träffarna ska lägga till');
  await page.keyboard.press('Escape');
  if (await page.$('#contractorFilterPop')) fail('Esc ska stänga listan');
  await page.click('#btnResetFilters'); await page.waitForTimeout(200);
  if ((await page.evaluate(() => getFilteredItems().length)) !== 5 || (await page.textContent('#filterContractorBtn')).trim() !== 'Alla entreprenörer ▾') fail('Rensa filter');
  console.log('OK: entreprenörsfiltret med flera val (bocka i, Utan entreprenör, sök, Välj träffarna, Rensa filter)');
  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
