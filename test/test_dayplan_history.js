// Dagsplaner: släpp mejlet (.eml/.msg/text), historik med versioner, flera mejl på en gång, CSV och valfri koppling till modellen.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs'), PORT = 8996, PID = 'test-project';
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const store = new Map(); let n = 0;
const seed = (f, c) => store.set(`projects/${PID}/${f}`, { content: JSON.stringify(c), sha: 's' + (++n) });
const get = f => JSON.parse(store.get(`projects/${PID}/${f}`).content);
const base = { project_id: PID, model_id: null, actual_start_date: null, actual_end_date: null, estimated_hours: null, updated_at: '2026-01-01T00:00:00Z', depends_on: [], status: 'planerad', progress: 20, contractor: 'NCC' };
seed('plan_items.json', [
  { ...base, id: 'A1', object_id: 'o1', model_id: 'M1', object_name: 'Form stödmur linje J', area: 'PRODUKTION / 742A Krönlinje J', activity: '742A Krönlinje J', start_date: '2026-10-15', end_date: '2026-10-25', source_key: 'PP a||1', origin: 'powerproject' },
  { ...base, id: 'A2', object_id: 'o2', model_id: 'M1', object_name: 'Kontrafor M12', area: 'PRODUKTION / 7421 Förtjockardel', activity: '7421 Förtjockardel', start_date: '2026-10-16', end_date: '2026-10-28', source_key: 'PP a||2', origin: 'powerproject' },
]);
['plan_item_activities.json', 'plan_milestones.json', 'plan_deliveries.json', 'plan_item_baseline_history.json'].forEach(f => seed(f, []));
const mail = (date, wk) => `Plan for ${date}\nProcyon :  40+1 crane operators\n   * Formwork stodmur at J line - ${wk} workers\n   * Formwork kontrafor M12-6 workers\n`;
const eml = (subject, body) => `From: Procyon <plan@procyon.example>\r\nSubject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="BB"\r\n\r\n--BB\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${body.replace(/[^\x00-\x7e]/g, c => [...Buffer.from(c)].map(b => '=' + b.toString(16).toUpperCase()).join('')).replace(/=\n/g, '=3D\n')}\r\n--BB\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>ignoreras</p>\r\n--BB--\r\n`;
(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data); })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({ project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) },
    viewer: { getSelection: () => Promise.resolve([{ modelId: 'M1', objectRuntimeIds: [11, 12] }]), convertToObjectIds: (m, r) => Promise.resolve(r.map(x => 'sel' + x)), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids.map((id, i) => /^sel/.test(id) ? Number(id.slice(3)) : 100 + i)),
      isolateEntities: e => { (window.__iso = window.__iso || []).push(e); return Promise.resolve(); }, setObjectState: (a, b) => { (window.__st = window.__st || []).push(b); return Promise.resolve(); }, setCamera: c => { (window.__cam = window.__cam || []).push(c); return Promise.resolve(); } } }) };` }));
  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', r => {
    const req = r.request(), f = decodeURIComponent(new URL(req.url()).pathname.replace('/repos/vfalk-NCC/4D-data/contents/', '')), e = store.get(f);
    if (req.method() === 'GET') return r.fulfill(e ? { status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(e.content).toString('base64'), sha: e.sha }) } : { status: 404, body: '{}' });
    if (req.method() === 'PUT') { const b = JSON.parse(req.postData() || '{}'); if (e && e.sha !== b.sha) return r.fulfill({ status: 409, body: '{}' }); const sha = 's' + (++n); store.set(f, { content: Buffer.from(b.content, 'base64').toString('utf8'), sha }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha } }) }); }
    r.fulfill({ status: 405, body: '' });
  });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't', userName: 'Victor' })); localStorage.setItem('4ddash-unlocked', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' }); await page.waitForSelector('#dphDrop'); await page.waitForTimeout(600);
  const fail = m => { throw new Error(m); };
  const dropFiles = (files) => page.evaluate(async fs2 => { const dt = new DataTransfer(); fs2.forEach(([name, b64, type]) => dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name, { type: type || '' }))); document.getElementById('dpBox').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, files.map(([n2, buf, t]) => [n2, Buffer.from(buf).toString('base64'), t]));
  // 1) släpp ett .eml (quoted-printable, kodad rubrik) -> dialogen fylls i
  await dropFiles([['Plan 19 okt.eml', eml('Dagsplan måndag – Procyon', mail('19.10.2026', 8)), 'message/rfc822']]);
  await page.waitForSelector('.dp-dlg .dp-t tbody tr[data-i]'); const rows = await page.$$eval('.dp-t tbody tr[data-i]', e => e.map(tr => [tr.querySelector('.dp-tx').value, tr.querySelector('.dp-wk').value, tr.querySelector('.dp-act').value]));
  if (rows.length !== 2 || rows[0][1] !== '8' || !/Form stödmur/.test(rows[0][2]) || !/Kontrafor M12/.test(rows[1][2])) fail('mejlet fyller dialogen och kopplar raderna: ' + JSON.stringify(rows));
  if (!(await page.textContent('.dp-from')).includes('Dagsplan måndag – Procyon')) fail('mejlets rubrik visas: ' + await page.textContent('.dp-from'));
  if ((await page.inputValue('.dp-date')) !== '2026-10-19' || (await page.inputValue('.dp-co')) !== 'Procyon') fail('datum och företag ur mejlet');
  await page.click('.dp-save'); await page.waitForTimeout(700); await page.click('.dp-x');
  if (get('ue_dayplans.json').length !== 1) fail('dagsplanen sparas');
  // historikpanelen
  await page.waitForSelector('.dph-row'); const rowTxt = await page.textContent('.dph-row'); if (!rowTxt.includes('2026-10-19') || !rowTxt.includes('Procyon') || !rowTxt.includes('2 arbeten')) fail('historikrad: ' + rowTxt);
  if (!(await page.$('.dph-chart rect'))) fail('stapeldiagram över personer per dag');
  // 2) ändrad dagsplan för samma dag -> ny version i historiken
  await dropFiles([['Plan 19 okt rev.eml', eml('Dagsplan måndag – uppdaterad', mail('19.10.2026', 14)), 'message/rfc822']]);
  await page.waitForSelector('.dp-dlg .dp-t tbody tr[data-i]'); await page.click('.dp-save'); await page.waitForTimeout(800); 
  const s2 = get('ue_dayplans.json'); if (s2.length !== 1 || s2[0].history.length !== 1 || s2[0].history[0].tasks[0].workers !== 8 || s2[0].tasks[0].workers !== 14) fail('den gamla blir en version: ' + JSON.stringify(s2[0].history));
  await page.waitForSelector('.dp-ver'); await page.selectOption('.dp-ver', '0'); await page.waitForTimeout(200); if ((await page.inputValue('.dp-t tbody tr[data-i="0"] .dp-wk')) !== '8') fail('tidigare version kan läsas in'); await page.click('.dp-x');
  if (!(await page.textContent('.dph-v')).includes('v2')) fail('versionsmärke i historiken');
  // 3) .msg (Outlook) + .eml på en gång -> lista, spara båda
  const msg = fs.readFileSync(path.join(__dirname, 'fixtures', 'dayplan_mail.msg'));
  await dropFiles([['Procyon plan 21.10.msg', msg, 'application/vnd.ms-outlook'], ['Plan 20 okt.eml', eml('Plan 20 okt', mail('20.10.2026', 9)), 'message/rfc822']]);
  await page.waitForSelector('.dp-ok'); const bulk = await page.$$eval('.dp-dlg .dp-t tbody tr', e => e.map(tr => tr.textContent.replace(/\s+/g, ' ').trim())); if (bulk.length !== 2 || !bulk.some(x => x.includes('2026-10-21')) || !bulk.some(x => x.includes('2026-10-20'))) fail('.msg och .eml läses: ' + JSON.stringify(bulk));
  await page.click('.dp-ok'); await page.waitForTimeout(1200); if (get('ue_dayplans.json').length !== 3) fail('båda sparas: ' + get('ue_dayplans.json').length);
  if ((await page.$$('.dph-row')).length !== 3) fail('tre rader i historiken');
  // filter och CSV
  await page.fill('#dphQ', 'kontrafor'); if ((await page.$$('.dph-row')).length !== 3) fail('sök i arbeten'); await page.fill('#dphQ', 'finns inte'); if ((await page.$$('.dph-row')).length !== 0) fail('sök utan träff'); await page.fill('#dphQ', '');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dphCsv')]); const csv = fs.readFileSync(await dl.path(), 'utf8'); if (!csv.includes('2026-10-19') || !csv.includes('Procyon') || csv.split('\n').length < 7) fail('CSV: ' + csv.slice(0, 160));
  // 4) koppling till modellen: valfri, via aktivitet eller egen markering
  await page.click('.dph-row >> nth=0'); await page.click('[data-open]'); await page.waitForSelector('.dp-dlg .dp-obj');
  const o0 = await page.textContent('.dp-t tbody tr[data-i="0"] .dp-obj'); if (!/🧊 1/.test(o0)) fail('rad kopplad via aktiviteten visar 1 objekt: ' + o0);
  await page.click('.dp-t tbody tr[data-i="0"] .dp-obj'); await page.click('.dp-menu button >> text=Koppla markeringen'); await page.waitForTimeout(200);
  if (!/🧊 3/.test(await page.textContent('.dp-t tbody tr[data-i="0"] .dp-obj'))) fail('egen markering + aktivitetens objekt = 3: ' + await page.textContent('.dp-t tbody tr[data-i="0"] .dp-obj'));
  await page.click('.dp-save'); await page.waitForTimeout(700); if (!get('ue_dayplans.json').some(r => r.tasks.some(t => (t.objs || []).length === 2))) fail('egna objekt sparas på raden');
  // "Visa i modellen" kräver 3D-styrningen: först av -> inget händer, sedan på
  await page.evaluate(() => { window.__iso = []; modelCtl.on = false; }); await page.click('.dp-model'); await page.waitForTimeout(300); if ((await page.evaluate(() => (window.__iso || []).length)) !== 0) fail('3D-styrningen av: modellen rörs inte');
  await page.evaluate(() => { modelCtl.on = true; }); await page.click('.dp-model'); await page.waitForTimeout(600);
  const iso = await page.evaluate(() => window.__iso || []); const ids = [].concat(...iso.map(e => e.flatMap(x => x.entityIds))); if (!iso.length || ids.length < 3 || !ids.includes(11)) fail('dagens arbeten isoleras i modellen: ' + JSON.stringify(iso));
  if (!(await page.evaluate(() => (window.__st || []).some(s => s && s.color && s.color.r === 245)))) fail('objekten färgas');
  await page.click('.dp-x');
  if (process.env.SHOT) { await page.click('.dph-row >> nth=0').catch(() => {}); await (await page.$('.panel[data-panel-id="dayplans"]')).screenshot({ path: '/tmp/dph.png' }); }
  if (errors.filter(e => !/allow-same-origin/.test(e)).length) fail('sidfel: ' + errors.slice(0, 3));
  console.log('OK test_dayplan_history'); await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
