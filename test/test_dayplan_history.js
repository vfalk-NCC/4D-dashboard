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
  { ...base, id: 'A5', object_id: 'o5', object_name: 'Sikthall', area: 'PRODUKTION / 742 Sikthall', activity: '742', start_date: '2026-10-01', end_date: '2026-12-30', source_key: 'PP a||5', origin: 'powerproject' },
  { ...base, id: 'A6', object_id: 'o6', object_name: 'Sektionsfickor', area: 'PRODUKTION / 741 Sektionsfickor', activity: '741', start_date: '2026-10-01', end_date: '2026-12-30', source_key: 'PP a||6', origin: 'powerproject' },
  { ...base, id: 'A4', object_id: 'o4', model_id: 'M1', object_name: 'Grovbetong för fundament linje E17-30', area: 'PRODUKTION / 744 Fläkthuset', activity: 'Grovbetong', start_date: '2026-10-15', end_date: '2026-10-30', source_key: 'PP a||4', origin: 'powerproject' },
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
      isolateEntities: e => { (window.__iso = window.__iso || []).push(e); return Promise.resolve(); }, setObjectState: (a, b) => { (window.__st = window.__st || []).push(b); return Promise.resolve(); }, setCamera: c => { (window.__cam = window.__cam || []).push(c); return Promise.resolve(); }, setSelection: (s, m) => { (window.__sel = window.__sel || []).push([s, m]); return Promise.resolve(); } } }) };` }));
  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', r => {
    const req = r.request(), f = decodeURIComponent(new URL(req.url()).pathname.replace('/repos/vfalk-NCC/4D-data/contents/', '')), e = store.get(f);
    if (req.method() === 'GET') return r.fulfill(e ? { status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(e.content).toString('base64'), sha: e.sha }) } : { status: 404, body: '{}' });
    if (req.method() === 'PUT') { const b = JSON.parse(req.postData() || '{}'); if (e && e.sha !== b.sha) return r.fulfill({ status: 409, body: '{}' }); const sha = 's' + (++n); store.set(f, { content: Buffer.from(b.content, 'base64').toString('utf8'), sha }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha } }) }); }
    r.fulfill({ status: 405, body: '' });
  });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't', userName: 'Victor' })); localStorage.setItem('4ddash-unlocked', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' }); await page.waitForSelector('#dphAdd'); await page.waitForTimeout(600);
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
  await page.waitForSelector('.dph-row'); const rowTxt = await page.textContent('.dph-row'); if (!rowTxt.includes('Mån 19 okt') || !rowTxt.includes('Procyon') || !rowTxt.includes('2 arbeten')) fail('historikrad: ' + rowTxt);
  if (!(await page.$('.dph-chart rect'))) fail('stapeldiagram över personer per dag');
  // 2) ändrad dagsplan för samma dag -> ny version i historiken
  await dropFiles([['Plan 19 okt rev.eml', eml('Dagsplan måndag – uppdaterad', mail('19.10.2026', 14)), 'message/rfc822']]);
  await page.waitForSelector('.dp-dlg .dp-t tbody tr[data-i]'); await page.click('.dp-save'); await page.waitForTimeout(800); 
  const s2 = get('ue_dayplans.json'); if (s2.length !== 1 || s2[0].history.length !== 1 || s2[0].history[0].tasks[0].workers !== 8 || s2[0].tasks[0].workers !== 14) fail('den gamla blir en version: ' + JSON.stringify(s2[0].history));
  await page.waitForSelector('.dp-ver'); await page.selectOption('.dp-ver', '0'); await page.waitForTimeout(200); if ((await page.inputValue('.dp-t tbody tr[data-i="0"] .dp-wk')) !== '8') fail('tidigare version kan läsas in'); await page.click('.dp-x');
  if (!(await page.textContent('.dph-v')).includes('v2')) fail('versionsmärke i historiken');
  // Outlook-mejl med punkt på egen rad, skift och iso-8859-2 (som Procyons riktiga mejl)
  { const body = `Plan for 22.10.2026\r\nProcyon: 68 +1 crane operators + 1 operator manitou\r\n\r\n\r\nFirst shift:\r\n\r\n  *\r\nFormwork for lean concrete line E and F - 5 workers\r\n\r\n  *\r\nFormwork stodmur line J- 6 workers\r\n\r\n  *\r\nCasting of  kontrafor M/12 - 4 workers\r\n\r\n  *\r\nReinforcement prefabrication < ST=D6DMUR 1,2 -LAPPKYRKEV=C4GEN> - 6 workers\r\n\r\n\r\nSecond shift:\r\n\r\n  *\r\nFormwork for kontrafor line J/10- 5 workers\r\n\r\n  *\r\nPreparation for winter at elyta - 4 workers\r\n`;
    const raw = `From: Procyon <plan@example.invalid>\r\nSubject: Plan for 22.10.2026\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="X"\r\n\r\n--X\r\nContent-Type: text/plain; charset="iso-8859-2"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${body}\r\n--X--\r\n`;
    await dropFiles([['Plan_for_22.10.2026.eml', raw, 'message/rfc822']]); await page.waitForSelector('.dp-dlg .dp-t tbody tr[data-i]');
    const rs = await page.$$eval('.dp-t tbody tr[data-i]', e => e.map(tr => ({ tx: tr.querySelector('.dp-tx').value, wk: tr.querySelector('.dp-wk').value, sh: tr.querySelector('.dp-shift').value, act: tr.querySelector('.dp-act').value, area: (tr.querySelector('.dp-ar small') || {}).textContent || '', sub: tr.querySelector('.dp-zone').options[tr.querySelector('.dp-zone').selectedIndex].textContent })));
    if (rs.length !== 6 || rs.filter(r => r.sh === '1').length !== 4 || rs.filter(r => r.sh === '2').length !== 2) fail('rader och skift ur Outlook-mejlet: ' + JSON.stringify(rs.map(r => [r.tx, r.sh])));
    if (rs[0].area !== 'Linje E, F' || rs[1].area !== 'Linje J' || rs[2].area !== 'M12' || !/STÖDMUR 1,2 -LAPPKYRKEVÄGEN/.test(rs[3].area) || rs[4].area !== 'Linje J · J10') fail('område ur raderna: ' + JSON.stringify(rs.map(r => r.area)));
    if (!/Grovbetong för fundament linje E17-30/.test(rs[0].act)) fail('grovbetong linje E och F kopplas till linje E17-30: ' + rs[0].act);
    if (!/Form stödmur/.test(rs[1].act) || !/Kontrafor M12/.test(rs[2].act)) fail('aktivitet kopplas (inkl. M/12): ' + JSON.stringify(rs.map(r => r.act)));
    if (!/742 Sikthall/.test(rs[1].sub) || !/742 Sikthall/.test(rs[2].sub)) fail('område enligt aktiviteten: ' + JSON.stringify(rs.map(r => r.sub)));
    const zs = await page.$$eval('.dp-t tbody tr[data-i] .dp-zone', e => e.map(s => s.options[s.selectedIndex].textContent)); if (zs[1] !== '742 Sikthall' || zs[2] !== '742 Sikthall') fail('område (742 Sikthall) ur raden/aktiviteten: ' + JSON.stringify(zs));
    const [dlH] = await Promise.all([page.waitForEvent('download'), page.click('.dp-html')]); const hh = fs.readFileSync(await dlH.path(), 'utf8'); if (!hh.includes('Skift 1') || !hh.includes('Linje E, F') || !/skift 2/.test(hh) || !hh.includes('742 - Sikthall')) fail('HTML-exporten visar skift och område');
    await page.click('.dp-x'); }
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
  // klick på en rad i historiken markerar objekten i modellen (när 3D-styrningen är på)
  await page.click('.dp-x'); await page.evaluate(() => { modelCtl.on = false; window.__sel = []; }); await page.waitForSelector('.dph-row.open');
  await page.click('tr.dph-tr.live >> nth=0'); await page.waitForTimeout(300); if ((await page.evaluate(() => (window.__sel || []).length)) !== 0) fail('3D-styrningen av: ingen markering i modellen');
  await page.evaluate(() => { modelCtl.on = true; }); await page.click('tr.dph-tr.live >> nth=0'); await page.waitForTimeout(500);
  const sel1 = await page.evaluate(() => window.__sel || []); if (!sel1.length || !sel1[0][0].modelObjectIds.length || sel1[0][1] !== 'set') fail('klick på rad markerar objekten i modellen: ' + JSON.stringify(sel1));
  await page.keyboard.down('Control'); await page.click('tr.dph-tr.live >> nth=1'); await page.keyboard.up('Control'); await page.waitForTimeout(400); if ((await page.$$('tr.dph-tr.on')).length !== 2) fail('Ctrl+klick markerar flera rader');
  // kolumnerna ligger på samma ställe i alla rader
  const xs = await page.$$eval('.dph-row .dph-h', hs => hs.map(h => [...h.children].map(c => Math.round(c.getBoundingClientRect().left)).join(','))); if (new Set(xs).size !== 1) fail('kolumnerna linjerar: ' + JSON.stringify(xs));
  await page.click('.dph-row.open [data-open]'); await page.waitForSelector('.dp-dlg .dp-obj');
  // "Visa i modellen" kräver 3D-styrningen: först av -> inget händer, sedan på
  await page.evaluate(() => { window.__iso = []; modelCtl.on = false; }); await page.click('.dp-model'); await page.waitForTimeout(300); if ((await page.evaluate(() => (window.__iso || []).length)) !== 0) fail('3D-styrningen av: modellen rörs inte');
  await page.evaluate(() => { modelCtl.on = true; }); await page.click('.dp-model'); await page.waitForTimeout(600);
  const iso = await page.evaluate(() => window.__iso || []); const ids = [].concat(...iso.map(e => e.flatMap(x => x.entityIds))); if (!iso.length || ids.length < 3 || !ids.includes(11)) fail('dagens arbeten isoleras i modellen: ' + JSON.stringify(iso));
  if (!(await page.evaluate(() => (window.__st || []).some(s => s && s.color && s.color.r === 245)))) fail('objekten färgas');
  await page.click('.dp-x');
  // Tidsaxeln: veckodag + datum under staplarna och veckoband
  { const ax = await page.$$eval('.dph-chart text', e => e.map(t => t.textContent)); if (!ax.includes('Mån') || !ax.some(t => /^\d+ okt$/.test(t)) || !ax.some(t => /^V\.\d+$/.test(t))) fail('veckodag, datum och vecka i diagrammet: ' + JSON.stringify(ax)); }
  // Uppdatera: en ny, bättre passande aktivitet hittas för en obunden rad
  { const r = await page.evaluate(() => { const rec = JSON.parse(JSON.stringify(dayplans[0])); rec.tasks[0].key = null; rec.tasks[0].label = ''; rec.tasks[0].src = null; rec.tasks[0].text = 'Formwork stodmur line J';
      items.push({ ...items[0], id: 'NEW1', activityKey: 'NEWK', objectName: 'Ställningsmontage till formning stödmur linje J', area: 'PRODUKTION / 742A Krönlinje J', activity: 'Formning stödmur linje J', startDate: rec.date, endDate: rec.date, modelId: null });
      const ch = dpRefitPlan(rec); return { n: ch.length, to: ch[0] && ch[0].to, btn: !!document.getElementById('dphRefit') }; });
    if (!r.btn) fail('knappen Uppdatera finns'); if (r.n < 1) fail('Uppdatera hittar en bättre aktivitet: ' + JSON.stringify(r)); }
  if (process.env.SHOT) { await page.click('#dphAdd'); await (await page.$('.panel[data-panel-id="dayplans"]')).screenshot({ path: '/tmp/dph.png' }); }
  if (errors.filter(e => !/allow-same-origin/.test(e)).length) fail('sidfel: ' + errors.slice(0, 3));
  console.log('OK test_dayplan_history'); await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
