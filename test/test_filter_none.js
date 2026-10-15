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
  await page.click('#filterAreaBtn');
  const areaOpts = await page.evaluate(() => [...document.querySelectorAll('#areaFilterPop .ggp-row')].map(o => o.textContent.trim()));
  if (areaOpts.includes('Utan område')) fail('"Utan område" ska bara visas när det finns sådana: ' + areaOpts);
  { const n2 = await page.evaluate(() => [...new Set(items.map(i => i.area).filter(Boolean))].length);
    if (n2 >= 2) { const exp = await page.evaluate(() => { const as = [...new Set(items.map(i => i.area).filter(Boolean))].slice(0, 2); return { as, n: items.filter(i => as.includes(i.area)).length }; });
      for (const a of exp.as) await page.check(`#areaFilterPop .ggp-row[title="${a}"] input`);
      await page.waitForTimeout(300); const got = await page.evaluate(() => ({ n: getFilteredItems().length, lbl: document.getElementById('filterAreaBtn').textContent.trim() }));
      if (got.n !== exp.n || got.lbl !== '2 områden ▾') fail('Flera områden samtidigt: ' + JSON.stringify({ exp, got }));
      await page.evaluate(() => { filters.area = []; renderAreaFilter(); renderAll(); }); } }
  // Aktivitet: samma lista med kryssrutor, med aktiviteternas namn (inte områdesnamnet).
  { await page.click('#filterActivityBtn');
    const an = await page.evaluate(() => ({ rows: [...document.querySelectorAll('#activityFilterPop .ggp-row')].map(o => o.textContent.trim()), names: [...new Set(items.map(i => i.objectName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv')) }));
    const real = an.rows.filter(r => r !== 'Utan aktivitet');
    if (real.join('|') !== an.names.join('|')) fail('Aktivitetslistan ska ha aktiviteternas namn: ' + JSON.stringify(an));
    if (an.names.length) { await page.check('#activityFilterPop .ggp-row >> nth=' + (an.rows.length - an.names.length)); await page.waitForTimeout(300);
      const got = await page.evaluate(() => ({ n: getFilteredItems().length, lbl: document.getElementById('filterActivityBtn').textContent.trim(), exp: items.filter(i => filters.activity.includes(i.objectName)).length }));
      if (got.n !== got.exp || !got.n) fail('Aktivitetsfiltret: ' + JSON.stringify(got));
      await page.evaluate(() => { filters.activity = []; renderActivityFilter(); renderAll(); }); }
    await page.click('#filterActivityBtn'); }
  // Välj träffarna → Avmarkera träffarna → Rensa allt (sök + knappar i listan).
  { await page.click('#filterActivityBtn'); const nm = await page.evaluate(() => (items.find(i => i.objectName) || {}).objectName || '');
    if (nm) { const q = nm.slice(0, 3); await page.fill('#activityFilterPop .ggp-search', q); await page.click('#activityFilterPop [data-aa="match"]'); await page.waitForTimeout(200);
      const a1 = await page.evaluate(() => filters.activity.length); await page.click('#activityFilterPop [data-aa="unmatch"]'); await page.waitForTimeout(200);
      const a2 = await page.evaluate(() => filters.activity.length); await page.click('#activityFilterPop [data-aa="match"]'); await page.click('#activityFilterPop [data-aa="all"]'); await page.waitForTimeout(200);
      const a3 = await page.evaluate(() => ({ n: filters.activity.length, all: getFilteredItems().length === items.length }));
      if (!a1 || a2 !== 0 || a3.n !== 0 || !a3.all) fail('Välj/avmarkera träffarna och Rensa allt: ' + JSON.stringify({ a1, a2, a3 })); }
    await page.click('#filterActivityBtn'); await page.waitForTimeout(100); }
  // 3D-editorn från dashboarden: knappen finns; hello besvaras med token/projekt, övriga förfrågningar vidarebefordras över kanalen.
  { const ed = await page.evaluate(async () => {
      const btn = !!document.getElementById('ganttOpen3d') && typeof window.openLagesplan3d === 'function';
      const got = [], ch = new BroadcastChannel('4d-gantt-link'); ch.onmessage = e => got.push(e.data);
      const replies = []; window.addEventListener('message', e => { if (e.data && e.data.lagesplanReply) replies.push(e.data); });
      window.dispatchEvent(new MessageEvent('message', { data: { lagesplan: true, type: 'hello', reqId: 1 }, origin: location.origin, source: window }));
      window.dispatchEvent(new MessageEvent('message', { data: { lagesplan: true, type: 'ifcModelsList', reqId: 2 }, origin: location.origin, source: window }));
      await new Promise(r => setTimeout(r, 400));
      return { btn, hello: replies.find(r => r.reqId === 1) && Object.keys(replies.find(r => r.reqId === 1).settings || {}), relay: got.filter(m => m.t === 'relay').map(m => m.msg.type) };
    });
    if (!ed.btn || !ed.hello || !ed.hello.includes('githubToken') || ed.relay.join() !== 'ifcModelsList') fail('3D-editorn från dashboarden: ' + JSON.stringify(ed));
    console.log('OK: knapp för 3D-editorn i Gantten – hello besvaras och förfrågningar vidarebefordras'); }
  // Sparade filter: spara det man filtrerat på under ett namn, rensa, och återställ med ett klick.
  { const pre = await page.evaluate(() => { const as = [...new Set(items.map(i => i.area).filter(Boolean))].slice(0, 1), ac = [...new Set(items.map(i => i.objectName).filter(Boolean))].slice(0, 2); filters.area = as; filters.activity = ac; renderAreaFilter(); renderActivityFilter(); renderAll(); return { as, ac, n: getFilteredItems().length }; });
    await page.click('#filterSavedBtn'); await page.fill('#savedFilterPop .sf-name', 'Mitt filter'); await page.click('#savedFilterPop .sf-save'); await page.waitForTimeout(200);
    const listed = await page.evaluate(() => [...document.querySelectorAll('#savedFilterPop .sf-row')].map(r => r.textContent.trim()));
    await page.click('#filterSavedBtn'); await page.click('#btnResetFilters'); await page.waitForTimeout(200);
    const cleared = await page.evaluate(() => filtersCount());
    await page.click('#filterSavedBtn'); await page.click('#savedFilterPop .sf-row'); await page.waitForTimeout(300);
    const back = await page.evaluate(() => ({ as: filters.area.slice(), ac: filters.activity.slice(), n: getFilteredItems().length }));
    if (!listed.length || !/Mitt filter/.test(listed[0]) || cleared !== 0 || JSON.stringify(back.as) !== JSON.stringify(pre.as) || JSON.stringify(back.ac) !== JSON.stringify(pre.ac) || back.n !== pre.n) fail('Sparade filter: ' + JSON.stringify({ pre, listed, cleared, back }));
    await page.click('#filterSavedBtn'); await page.click('#savedFilterPop .sf-del'); await page.waitForTimeout(200);
    const gone = await page.evaluate(() => savedFiltersGet().length); await page.click('#filterSavedBtn'); await page.evaluate(() => { filters.area = []; filters.activity = []; renderAreaFilter(); renderActivityFilter(); renderAll(); });
    if (gone !== 0) fail('Sparat filter ska gå att ta bort');
    console.log('OK: sparade filter – spara under namn, återställ med ett klick, ta bort'); }
  await page.click('#filterAreaBtn'); await page.click('#filterContractorBtn'); // stäng områdeslistan, öppna entreprenörslistan igen
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
