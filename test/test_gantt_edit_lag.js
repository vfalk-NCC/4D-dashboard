// Aktivitetsdialogen: förslagslistor, glapp per koppling (konstant, + och −) och redigering med dubbelklick
// (Victor 2026-10-07).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8984;
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
  it('Schakt', 'Linje J', 'Mark', 0, 5),                                      // i1
  it('Gjutning', 'Linje J', 'Betong', 8, 10, { depends_on: ['i1'] }),        // i2
  it('Montage', 'Linje J', 'Stomme', 11, 13, { depends_on: ['i2'] }),        // i3
  it('Övrigt', 'Linje K', 'Mark', 2, 6, { contractor: 'Peab Anläggning' }), // i4
  it('Fristående', 'Linje K', 'Betong', 20, 22),                             // i5
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
  const row = id => get('plan_items.json').find(r => r.id === id);
  const opts = () => page.evaluate(() => { const l = [...document.querySelectorAll('.new-act-pop .cb-list')].find(x => !x.hidden); return l ? [...l.querySelectorAll('.cb-opt')].map(o => o.querySelector('.cb-l').textContent + (o.querySelector('.cb-n') ? ' | ' + o.querySelector('.cb-n').textContent : '')) : null; });
  await page.click('[data-gantt-view="board"]');
  await page.click('[data-gantt-weeks="4"]');
  await page.check('#ganttEditable'); await page.waitForTimeout(300);

  // 1. Förslagslistor och Väntar på med glapp i en ny aktivitet.
  await page.click('#ganttAddBtn'); await page.waitForTimeout(150);
  await page.click('.na-contr'); await page.waitForTimeout(100);
  let o = await opts();
  if (!o || !o.some(x => x.startsWith('Peab Anläggning')) || !o.some(x => x.startsWith('NCC | 4 akt.'))) fail('Entreprenör ska föreslå de övriga: ' + JSON.stringify(o));
  await page.fill('.na-contr', 'peab'); await page.waitForTimeout(100);
  o = await opts();
  if (JSON.stringify(o) !== JSON.stringify(['Peab Anläggning | 1 akt.'])) fail('Filtrering: ' + JSON.stringify(o));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  if (await page.inputValue('.na-contr') !== 'Peab Anläggning') fail('Enter ska välja förslaget');
  await page.click('.na-area'); await page.fill('.na-area', 'linje'); await page.waitForTimeout(100);
  o = await opts();
  if (JSON.stringify(o) !== JSON.stringify(['Linje J | 3 akt.', 'Linje K | 2 akt.'])) fail('Område: ' + JSON.stringify(o));
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  if (!(await page.locator('.new-act-pop').count()) || await opts()) fail('Esc stänger först bara listan');
  await page.click('.na-area'); await page.waitForTimeout(100);
  await page.click('.new-act-pop .cb-list:not([hidden]) .cb-opt >> text=Linje J');
  if (await page.inputValue('.na-area') !== 'Linje J') fail('Klick ska välja förslaget');
  await page.click('.na-pred-search'); await page.keyboard.type('gjut'); await page.waitForTimeout(100);
  o = await opts();
  if (o.length !== 1 || !o[0].startsWith('Gjutning')) fail('Väntar på ska gå att söka: ' + JSON.stringify(o));
  await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  if (await page.inputValue('.na-pred') !== 'i2' || await page.inputValue('.na-start') !== day(11)) fail('Vald föregångare, start dagen efter: ' + await page.inputValue('.na-start'));
  const d0 = await page.inputValue('.na-end');
  await page.click('.na-pred-row .na-lag-step[data-step="1"]'); await page.click('.na-pred-row .na-lag-step[data-step="1"]');
  if (await page.inputValue('.na-lag') !== '2' || await page.inputValue('.na-start') !== day(13)) fail('Glapp +2 ska flytta starten: ' + await page.inputValue('.na-start'));
  if (await page.inputValue('.na-end') <= d0) fail('Slutet följer med');
  await page.fill('.na-name', 'Härdning');
  await page.locator('.new-act-pop').screenshot({ path: path.join(require('os').tmpdir(), 'edit_new_lag.png') });
  await page.click('.na-save'); await page.waitForTimeout(900);
  const hd = get('plan_items.json').find(r => r.object_name === 'Härdning');
  if (!hd || JSON.stringify(hd.depends_on) !== '["i2"]' || JSON.stringify(hd.dep_lags) !== '{"i2":2}' || hd.start_date !== day(13) || hd.contractor !== 'Peab Anläggning') fail('Sparad med glapp: ' + JSON.stringify(hd));
  await page.waitForTimeout(300);
  const lbl = await page.evaluate(id => [...document.querySelectorAll('#ganttChart svg.gantt-arrows text.ga-lag-t')].map(t => `${t.dataset.a}>${t.dataset.b} ${t.textContent}`), hd.id);
  if (JSON.stringify(lbl) !== JSON.stringify([`i2>${hd.id} +2 d`])) fail('Glappet ska stå vid pilen: ' + JSON.stringify(lbl));
  console.log('OK: förslagslistor (filtrering, pilar/Enter, klick, Esc) och Väntar på med glapp – starten följer glappet');

  // 2. Dubbelklick redigerar; glappet hålls konstant åt båda hållen.
  await page.dblclick('#ganttChart .pnote[data-item-id="i2"] .pnote-title'); await page.waitForTimeout(200);
  if (!(await page.locator('.edit-act-pop').count()) || await page.inputValue('.na-name') !== 'Gjutning' || await page.inputValue('.na-pred') !== 'i1') fail('Dubbelklick öppnar redigering, ifylld');
  if (!/skrivas över vid nästa import/.test(await page.innerText('.edit-act-pop .na-foot'))) fail('Importerad: varning om nästa import');
  await page.fill('.na-end', day(12));
  await page.click('.na-save'); await page.waitForTimeout(900);
  if (row('i2').end_date !== day(12) || row('i3').start_date !== day(13) || row(hd.id).start_date !== day(15)) fail('Längre: utan glapp knuffas, med glapp +2: ' + JSON.stringify([row('i3').start_date, row(hd.id).start_date, day(15)]));
  await page.dblclick('#ganttChart .pnote[data-item-id="i2"] .pnote-title'); await page.waitForTimeout(200);
  await page.fill('.na-end', day(8));
  await page.click('.na-save'); await page.waitForTimeout(900);
  if (row('i3').start_date !== day(13) || row(hd.id).start_date !== day(11)) fail('Kortare: med glapp dras den tillbaka, utan glapp ligger kvar: ' + JSON.stringify([row('i3').start_date, row(hd.id).start_date]));
  console.log('OK: dubbelklick redigerar – fast glapp hålls när föregångaren flyttas, framåt och bakåt');

  // 3. Redigera fält + koppling med negativt glapp, och ångra allt i ett steg.
  await page.dblclick('#ganttChart .pnote[data-item-id="i5"] .pnote-title'); await page.waitForTimeout(200);
  await page.fill('.na-name', 'Fristående 2');
  await page.click('.na-pred-search'); await page.keyboard.type('övrigt'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  await page.fill('.na-pred-row .na-lag', '-1'); await page.waitForTimeout(100);
  if (await page.inputValue('.na-start') !== day(6) || await page.inputValue('.na-end') !== day(8)) fail('Glapp −1 = överlapp en dag, längden behålls: ' + await page.inputValue('.na-start'));
  await page.fill('.na-prog', '30');
  await page.click('.na-save'); await page.waitForTimeout(900);
  let r5 = row('i5');
  if (r5.object_name !== 'Fristående 2' || r5.progress !== 30 || JSON.stringify(r5.depends_on) !== '["i4"]' || JSON.stringify(r5.dep_lags) !== '{"i4":-1}' || r5.start_date !== day(6)) fail('Redigerad: ' + JSON.stringify(r5));
  if (!(await page.locator('#ganttChart .pnote[data-item-id="i5"]').innerText()).includes('Fristående 2')) fail('Lappen visar det nya namnet');
  await page.click('#ganttUndo'); await page.waitForTimeout(900);
  r5 = row('i5');
  if (r5.object_name !== 'Fristående' || r5.progress !== 0 || JSON.stringify(r5.depends_on) !== '[]' || r5.dep_lags || r5.start_date !== day(20)) fail('Ångra ska återställa allt: ' + JSON.stringify(r5));
  console.log('OK: namn, framdrift, koppling med −glapp sparas i ett steg och ångras i ett steg');

  // 4. Glapp i högerklicksmenyn.
  await page.click('#ganttChart .pnote[data-item-id="i3"] .pnote-title', { button: 'right' }); await page.waitForTimeout(150);
  await page.fill('.board-dep-menu .bdm-lag[data-kind="pred"]', '1'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  if (JSON.stringify(row('i3').dep_lags) !== '{"i2":1}' || row('i3').start_date !== day(10)) fail('Menyn: glapp +1 flyttar Montage till Gjutnings slut + 2: ' + JSON.stringify(row('i3')));
  await page.click('#ganttChart .pnote[data-item-id="i3"] .pnote-title', { button: 'right' }); await page.waitForTimeout(150);
  if (await page.inputValue('.board-dep-menu .bdm-lag[data-kind="pred"]') !== '1') fail('Menyn visar glappet');
  await page.fill('.board-dep-menu .bdm-lag[data-kind="pred"]', ''); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  if (row('i3').dep_lags) fail('Tomt tar bort glappet');
  console.log('OK: högerklicksmenyn – sätt och ta bort glapp');

  // 5. Ringberoende stoppas; staplarna har också dubbelklick; tipsrutan visar glappet.
  dialogs.length = 0;
  await page.dblclick('#ganttChart .pnote[data-item-id="i1"] .pnote-title'); await page.waitForTimeout(200);
  await page.click('.na-pred-search'); await page.keyboard.type('montage'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  await page.click('.na-save'); await page.waitForTimeout(400);
  if (!dialogs.some(m => /väntar redan/.test(m)) || row('i1').depends_on.length) fail('Ring ska stoppas: ' + JSON.stringify(dialogs));
  await page.click('.na-cancel');
  await page.click('[data-gantt-view="bars"]'); await page.waitForTimeout(300);
  await page.dblclick(`#ganttChart .gantt-bar[data-item-id="${hd.id}"]`); await page.waitForTimeout(200);
  if (await page.inputValue('.na-name') !== 'Härdning' || await page.inputValue('.na-lag') !== '2') fail('Staplarna: dubbelklick öppnar redigering med glappet');
  await page.click('.na-cancel');
  await page.click(`#ganttChart .gantt-bar[data-item-id="${hd.id}"]`); await page.waitForTimeout(200);
  if (!/glapp \+2 d/.test(await page.evaluate(() => document.querySelector('.gantt-tooltip').innerText))) fail('Tipsrutan visar glappet');
  // Redigerbar av: en tydlig knapp för att slå på.
  await page.uncheck('#ganttEditable'); await page.waitForTimeout(200);
  await page.dblclick(`#ganttChart .gantt-bar[data-item-id="i2"]`); await page.waitForTimeout(200);
  if (await page.locator('.new-act-pop').count() || !/Slå på/.test(await page.innerText('#modelToast'))) fail('Utan Redigerbar: toast med Slå på');
  console.log('OK: ringberoende stoppas, dubbelklick på staplar, glappet i tipsrutan, Redigerbar krävs');

  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
