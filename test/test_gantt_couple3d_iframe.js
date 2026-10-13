// Koppla i 3D-modellen när dashboarden ligger i en iframe i Trimble Connect (Victor 2026-10-13: "Det verkar inte fungera att koppla
// objekt direkt i ganttschemat"): webbläsarens confirm/alert blockeras där (ingen ruta, svarar nej) – dashboardens egna rutor ska användas.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8986;
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
  it('Gjutning', 'Linje J', 'Betong', 0, 5, { source_key: 'pp:1', origin: 'powerproject' }),     // i1 – okopplad
  it('Schakt', 'Linje J', 'Mark', 6, 9, { model_id: 'M1', object_id: 'G5', depends_on: ['i1'] }), // i2 – kopplad
]);
seed('plan_item_activities.json', [{ id: 'a1', plan_item_id: 'i1', name: 'Form', start_date: day(0), end_date: day(2) }]);
['plan_milestones.json', 'plan_deliveries.json', 'plan_item_baseline_history.json'].forEach(f => seed(f, []));

(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data);
  })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); }); // iframe: webbläsarens rutor blockeras (svarar nej)
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `
    window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({
      project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) },
      viewer: { getSelection: () => Promise.resolve(window.__sel || []), convertToObjectIds: (m, r) => Promise.resolve(r.map(x => 'G' + x)), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids), getObjectProperties: () => Promise.resolve([]), setSelection: () => Promise.resolve() }
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
  await page.addInitScript(() => { window.__forceDashDialogs = true; localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const fail = m => { throw new Error(m); };
  const row = id => get('plan_items.json').find(r => r.id === id);
  const opts = () => page.evaluate(() => { const l = [...document.querySelectorAll('.new-act-pop .cb-list')].find(x => !x.hidden); return l ? [...l.querySelectorAll('.cb-opt')].map(o => o.querySelector('.cb-l').textContent + (o.querySelector('.cb-n') ? ' | ' + o.querySelector('.cb-n').textContent : '')) : null; });
  const rows = () => get('plan_items.json');
  await page.click('[data-gantt-view="board"]');
  await page.click('[data-gantt-weeks="4"]');
  await page.check('#ganttEditable'); await page.waitForTimeout(300);
  await page.click('#ganttChart .pnote[data-item-id="i1"] .pnote-title', { button: 'right' }); await page.waitForTimeout(150);
  if (!/inte kopplad än/.test(await page.innerText('.board-dep-menu [data-couple]'))) fail('Menyn: Koppla i 3D-modellen');
  await page.click('.board-dep-menu [data-couple]'); await page.waitForTimeout(300);
  if (!/0 markerade/.test(await page.innerText('.couple-bar')) || !(await page.isDisabled('.couple-go'))) fail('Listen visar 0 markerade');
  await page.evaluate(() => { window.__sel = [{ modelId: 'M1', objectRuntimeIds: [1, 2, 3, 5] }]; onTcEvent('viewer.onSelectionChanged'); });
  await page.waitForTimeout(500);
  const txt = await page.innerText('.couple-bar');
  if (!/4 markerade/.test(txt)) fail('Ska räkna markeringen: ' + txt);
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'couple_bar.png') });
  // 1. Koppla: en egen ruta (inte webbläsarens) frågar om objekt som redan hör till en annan aktivitet. Avbryt = inget sparas, listan står kvar.
  await page.click('.couple-go'); await page.waitForSelector('.dash-dlg', { timeout: 3000 });
  const dtxt = await page.innerText('.dash-dlg');
  if (dialogs.length || !/redan kopplade till andra aktiviteter/.test(dtxt) || !/Koppla ändå/.test(dtxt)) fail('Egen ruta ska fråga (inte webbläsarens): ' + JSON.stringify({ dialogs, dtxt }));
  await page.click('.dash-dlg .cancel'); await page.waitForTimeout(400);
  if (await page.locator('.dash-dlg').count() || !(await page.locator('.couple-bar').count()) || rows().length !== 2) fail('Avbryt: inget sparas och listan står kvar');
  // 2. Igen, nu OK: kopplingen sparas.
  await page.click('.couple-go'); await page.waitForSelector('.dash-dlg'); await page.click('.dash-dlg .okb'); await page.waitForTimeout(1000);
  if (dialogs.length) fail('Webbläsarens egna rutor ska inte användas i en iframe: ' + JSON.stringify(dialogs));
  let r = rows();
  const grp = r.find(x => x.id === 'i1');
  const mine = r.filter(x => x.group_id && x.group_id === grp.group_id);
  if (grp.model_id !== 'M1' || grp.object_id !== 'G1' || mine.length !== 4 || !mine.every(x => x.source_key === 'pp:1' && x.object_name === 'Gjutning' && x.start_date === day(0)) || JSON.stringify(mine.map(x => x.object_id).sort()) !== '["G1","G2","G3","G5"]') fail('Kopplad – en rad per objekt i samma grupp: ' + JSON.stringify(mine));
  if (get('plan_item_activities.json').length !== 4) fail('Kopiorna får delaktiviteterna');
  if (await page.locator('.couple-bar').count()) fail('Listen ska försvinna');
  if (await page.locator('#ganttChart .pnote').count() !== 2) fail('Fortfarande en lapp per aktivitet');
  console.log('OK: koppla i 3D-modellen i en iframe – egen ruta (avbryt sparar inget, OK kopplar), webbläsarens rutor används inte');
  // alert blockerar inte koden: ett meddelande visas som egen ruta och Enter stänger det.
  await page.evaluate(() => { window.__after = false; alert("Något gick fel\n\nFörsök igen."); window.__after = true; });
  await page.waitForSelector('.dash-dlg');
  const ok = await page.evaluate(() => window.__after === true), t2 = await page.innerText('.dash-dlg');
  await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  if (!ok || !/Något gick fel/.test(t2) || !/Försök igen/.test(t2) || await page.locator('.dash-dlg').count() || dialogs.length) fail('alert i iframe: egen ruta som inte blockerar: ' + JSON.stringify({ ok, t2, dialogs }));
  console.log('OK: alert ersätts av en ruta i iframe (koden går vidare, Enter stänger)');
  if (errors.length) fail('Sidfel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
