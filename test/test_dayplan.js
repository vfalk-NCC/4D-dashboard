// Dagsplan från underentreprenör: mejlet läses in, raderna kopplas till aktiviteter, sparas i 4D-data och exporteras som HTML.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs'), PORT = 8997, PID = 'test-project';
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const store = new Map(); let n = 0;
const seed = (f, c) => store.set(`projects/${PID}/${f}`, { content: JSON.stringify(c), sha: 's' + (++n) });
const get = f => JSON.parse(store.get(`projects/${PID}/${f}`).content);
const base = { project_id: PID, model_id: null, actual_start_date: null, actual_end_date: null, estimated_hours: null, updated_at: '2026-01-01T00:00:00Z', depends_on: [], status: 'planerad', progress: 20, contractor: 'NCC' };
seed('plan_items.json', [
  { ...base, id: 'A1', object_id: 'o1', object_name: 'Form stödmur linje J', area: 'PRODUKTION / 742A Krönlinje J', activity: '742A Krönlinje J', start_date: '2026-10-15', end_date: '2026-10-25', source_key: 'PP a||1', origin: 'powerproject' },
  { ...base, id: 'A2', object_id: 'o2', object_name: 'Kontrafor M12', area: 'PRODUKTION / 7421 Förtjockardel', activity: '7421 Förtjockardel', start_date: '2026-10-16', end_date: '2026-10-28', source_key: 'PP a||2', origin: 'powerproject' },
  { ...base, id: 'A3', object_id: 'o3', object_name: 'Tornkranar Binsell', area: 'PRODUKTION / 7461 MSP Ställverk', activity: '7461', start_date: '2026-10-10', end_date: '2026-11-20', source_key: 'PP a||3', origin: 'powerproject' },
]);
['plan_item_activities.json', 'plan_milestones.json', 'plan_deliveries.json', 'plan_item_baseline_history.json'].forEach(f => seed(f, []));
const MAIL = `Plan for 19.10.2026
Procyon :  68+2 crane operators+2sennebogen operator+1manitue operator
   * Fomwork stodmur at J line-8 workers
   * Formwork lean concrete kyrkavagen  O-10 workers
   * Reinforcement prefabrication < STÖDMUR 1,2 -LAPPKYRKEVÄGEN>-16 workers
   * Formwork kontrafor M12-6 workers
   * Formwork at line F-10`;
(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data); })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({ project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) } }) };` }));
  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', r => {
    const req = r.request(), f = decodeURIComponent(new URL(req.url()).pathname.replace('/repos/vfalk-NCC/4D-data/contents/', '')), e = store.get(f);
    if (req.method() === 'GET') return r.fulfill(e ? { status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(e.content).toString('base64'), sha: e.sha }) } : { status: 404, body: '{}' });
    if (req.method() === 'PUT') { const b = JSON.parse(req.postData() || '{}'); if (e && e.sha !== b.sha) return r.fulfill({ status: 409, body: '{}' }); const sha = 's' + (++n); store.set(f, { content: Buffer.from(b.content, 'base64').toString('utf8'), sha }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha } }) }); }
    r.fulfill({ status: 405, body: '' });
  });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); localStorage.setItem('4ddash-test-modelctl', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  const fail = m => { throw new Error(m); };
  const P = await page.evaluate(m => dpParse(m), MAIL);
  if (P.date !== '2026-10-19' || P.company !== 'Procyon' || P.total !== 68 || P.tasks.length !== 5 || P.tasks[0].workers !== 8 || P.tasks[4].workers !== 10 || !/crane operators/.test(P.extras)) fail('Parsning: ' + JSON.stringify(P));
  console.log('OK: mejlet läses till datum, företag, totalt och 5 rader med antal');
  // Dialogen
  await page.evaluate(() => ganttDdOpen('tools')); await page.click('#dpOpenBtn'); await page.waitForSelector('.dp-dlg .dp-text');
  await page.fill('.dp-text', MAIL); await page.click('.dp-read'); await page.waitForTimeout(300);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.dp-t tbody tr[data-i]')].map(tr => [tr.querySelector('.dp-tx').value, tr.querySelector('.dp-wk').value, tr.querySelector('.dp-act').value]));
  if (rows.length !== 5) fail('Fem rader efter inläsning: ' + JSON.stringify(rows));
  if (!/Form stödmur/.test(rows[0][2]) || !/Kontrafor M12/.test(rows[3][2])) fail('Raderna ska kopplas till rätt aktivitet: ' + JSON.stringify(rows));
  if (await page.inputValue('.dp-date') !== '2026-10-19' || await page.inputValue('.dp-co') !== 'Procyon') fail('Datum och UE ska fyllas i');
  // Justera en rad och spara
  await page.fill('.dp-t tbody tr[data-i="4"] .dp-wk', '12'); await page.click('.dp-save'); await page.waitForTimeout(800);
  const saved = get('ue_dayplans.json'); if (saved.length !== 1 || saved[0].tasks[4].workers !== 12 || saved[0].total !== 68) fail('Dagsplanen ska sparas: ' + JSON.stringify(saved[0] && saved[0].tasks[4]));
  const al = get('ue_aliases.json'); if (!al.length) fail('Kopplingarna ska sparas som regler');
  // Antal syns på aktiviteten vid dagsplanens datum
  await page.evaluate(() => { ganttAsOf = '2026-10-19'; }); // dagsplanens datum (annars räknas "idag")
  const w = await page.evaluate(() => { const it = mergeActivityGroups(items.filter(x => x.id === 'A1'))[0]; return dpWorkersFor(it); });
  if (!w || w.n !== 8) fail('Aktiviteten ska visa 8 personer: ' + JSON.stringify(w));
  // HTML-export
  const dl = page.waitForEvent('download'); await page.click('.dp-html'); const d = await dl;
  const html = fs.readFileSync(await d.path(), 'utf8');
  if (!/Dagsplan måndag 19 okt 2026/.test(html) || !/Procyon/.test(html)) fail('HTML-exporten saknar innehåll ' + [/Dagsplan måndag 19 okt 2026/.test(html), /Form stödmur linje J/.test(html), /Procyon/.test(html)] + html.slice(html.indexOf('<h1>'), html.indexOf('<h1>') + 300));
  if (!/class="tag zn">/.test(html)) fail('Området ska stå som text på varje rad');
  if (/framdrift|Ingen kopplad aktivitet|data-f="ph"/.test(html)) fail('HTML-exporten ska inte ta med aktivitet från tidplan som standard');
  await page.check('.dp-withact'); const dl2 = page.waitForEvent('download'); await page.click('.dp-html'); const html2 = fs.readFileSync(await (await dl2).path(), 'utf8');
  if (!/Form stödmur linje J/.test(html2) || /Form stödmur linje J/.test(html) || !/framdrift/.test(html2) || !/data-f="ph"/.test(html2)) fail('Med bockrutan ska aktiviteten från tidplanen följa med');
  // exporterad HTML: sök, filter, fäll ihop områden
  { const pg = await browser.newPage(); const pe = []; pg.on('pageerror', e => pe.push(e.message)); await pg.setContent(html2);
    const r = await pg.evaluate(async () => { const o = {}, $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)], vis = () => $$('.row:not(.hid)').length;
      o.total = $$('.row').length; o.secs = $$('.ag').length; o.hasTools = !!$('#q') && $$('.chip[data-f]').length > 0;
      const h = $('.ag h2'); h.click(); o.collapsed = $('.ag').classList.contains('cl') && getComputedStyle($('.ag .rows')).display === 'none'; h.click(); o.opened = getComputedStyle($('.ag .rows')).display !== 'none';
      $('#ca').click(); o.allCl = $$('.ag.cl').length === o.secs; $('#ea').click(); o.allOp = $$('.ag.cl').length === 0;
      const q = $('#q'); q.value = 'stödmur'; q.dispatchEvent(new Event('input')); o.search = vis() > 0 && vis() < o.total || o.total === vis(); o.visTxt = $('#vis').textContent;
      q.value = 'zzzz-finns-inte'; q.dispatchEvent(new Event('input')); o.none = vis() === 0 && $$('.ag:not(.hid)').length === 0; $('#cl').click(); o.reset = vis() === o.total && $('#q').value === '';
      const c = $('.chip[data-f="ph"]'); c.click(); o.chip = c.classList.contains('on') && vis() <= o.total; c.click(); o.chipOff = vis() === o.total; return o; });
    if (!r.hasTools || !r.collapsed || !r.opened || !r.allCl || !r.allOp || !r.search || !r.none || !r.reset || !r.chip || !r.chipOff || pe.length) fail('HTML-exportens filter/fäll ihop: ' + JSON.stringify(r) + pe.join('|')); await pg.close(); }
  // arbetstyp + statistik
  { const tr = await page.evaluate(() => ['Formwork stodmur at J line', 'Reinforcement prefabrication', 'Casting slab 7421', 'Gjutning platta', 'Armering vägg', 'Städning'].map(x => dpTradeOf(x)));
    if (tr.join() !== 'form,prefab,gjutning,gjutning,armering,ovrigt') fail('arbetstyp gissas fel: ' + tr.join());
    const dayh = await page.evaluate(() => dpDayLong('2026-10-19')); if (!/måndag 19 oktober 2026 · vecka 43/.test(dayh)) fail('datum/dag: ' + dayh);
    const hist = await page.evaluate(async () => { await dpLoad().catch(() => {}); const had = typeof dayplans !== 'undefined' ? dayplans.length : 0; return had; });
    const st = await page.evaluate(async () => { const rec = { id: 'x1', date: '2026-10-19', company: 'Procyon', tasks: [{ text: 'Formwork stodmur at J line', workers: 8, shift: 1, zone: '742' }, { text: 'Reinforcement', workers: 16, shift: 2, zone: '742' }, { text: 'Casting', workers: 5, shift: 1, area: 'Plan 2' }] }; const html = dpsHtml(dpsData([rec, { ...rec, id: 'x2', date: '2026-10-20' }], '', '')); return html.length; });
    if (!(st > 5000)) fail('statistik-HTML saknas');
    const pg = await browser.newPage(); const pe = []; pg.on('pageerror', e => pe.push(e.message));
    const html3 = await page.evaluate(() => { const rec = { id: 'x1', date: '2026-10-19', company: 'Procyon', tasks: [{ text: 'Formwork stodmur at J line', workers: 8, shift: 1, zone: '742' }, { text: 'Reinforcement', workers: 16, shift: 2, zone: '742' }, { text: 'Casting', workers: 5, shift: 1, area: 'Plan 2' }] }; return dpsHtml(dpsData([rec, { ...rec, id: 'x2', date: '2026-10-20' }], '', '')); });
    await pg.setContent(html3); await pg.waitForTimeout(300);
    const r = await pg.evaluate(() => { const o = {}, q = s => document.querySelector(s); o.kpi = q('#kpi').textContent; o.heat = !!q('#heat table'); o.areas = document.querySelectorAll('.ar').length; o.days = document.querySelectorAll('#days tbody tr').length; o.week = /v43/.test(q('#time').innerHTML);
      q('.chip[data-t="form"]').click(); o.filtered = q('#kpi .k b').textContent; q('#clr').click(); o.reset = q('#kpi .k b').textContent; q('.ar').click(); o.areaFilter = document.querySelectorAll('.ar').length; return o; });
    if (r.filtered !== '16' || r.reset !== '58' || !r.heat || r.areas < 2 || r.days !== 2 || !r.week || pe.length) fail('statistikrapport: ' + JSON.stringify(r) + pe.join('|')); await pg.close(); }
  if (errors.length) fail('sidfel: ' + errors.slice(0, 3));
  console.log('ALLA TESTER OK'); await browser.close(); server.close();
})().catch(e => { console.error('FEL: ' + e.message); process.exit(1); });
