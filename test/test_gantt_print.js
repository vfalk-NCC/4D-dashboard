// Utskrift av Gantt-schemat (Victors önskemål 2026-10-06): knappen 🖨 Skriv ut öppnar en liten
// dialog (papper, riktning), ritar schemat i en egen utskriftsvy i sidbredd med rubrik och
// förklaring, tidshuvudet i en thead (upprepas på varje sida) och – för tavlan – uppdelat i
// perioder så att lapparna går att läsa. Skärmens inställningar ändras inte av utskriften.
// Sätt GANTT_PRINT_PDF=<katalog> för att också spara utskrifterna som PDF (för granskning).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8971;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const PID = 'test-project';
const store = new Map();
const seed = (f, c) => store.set(`projects/${PID}/${f}`, { content: JSON.stringify(c), sha: 's' + store.size });
const iso = d => d.toISOString().slice(0, 10);
const day = n => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const base = { project_id: PID, model_id: null, actual_start_date: null, actual_end_date: null, estimated_hours: null, updated_at: '2026-01-01T00:00:00Z' };
let n = 0;
const it = (name, area, activity, contractor, s, e, status, progress) => ({ ...base, id: 'i' + (++n), object_id: 'x' + n, object_name: name, area, activity, contractor, start_date: day(s), end_date: day(e), status, progress });
const items = [
  it('Bjälklag Sektionsfickor (alla)', '741 - Sektionsfickor', 'Bjälklag', 'NCC', -9, 115, 'forsenad', 10),
  it('L-stål, upplag för bjälklag, del 2', '741 - Sektionsfickor', 'Stål', 'Stålbyggarna', -2, 3, 'klar', 100),
  it('Tillfällig pelare, del 1', '741 - Sektionsfickor', 'Pelare', 'NCC', 1, 7, 'planerad', 0),
  it('Tillfällig pelare, del 2', '741 - Sektionsfickor', 'Pelare', 'NCC', 7, 13, 'planerad', 0),
  it('Bjälklag +433.000 - montage prefabbjälklag', '741 - Sektionsfickor', 'Montage', 'Prefab AB', 3, 18, 'planerad', 0),
  it('Raiseborrningsarbeten Bedrock', '742 - Sikthall / Bedrock', 'Borrning', 'Bedrock', -7, 90, 'forsenad', 5),
  it('I16', '742 - Sikthall / Linje I', 'Fundament', 'NCC', 0, 17, 'pagaende', 45),
  it('I10', '742 - Sikthall / Linje I', 'Fundament', 'NCC', 5, 15, 'pagaende', 30),
  it('I12', '742 - Sikthall / Linje I', 'Fundament - Utförs efter kontrefor Förtj.', 'NCC', 5, 15, 'planerad', 0),
  it('I14', '742 - Sikthall / Linje I', 'Fundament - Utförs senare pga logistik', 'NCC', 20, 30, 'planerad', 0),
  it('I30', '742 - Sikthall / Linje I', 'Fundament', 'NCC', -22, 3, 'klar', 100),
  it('Förtjockardelen', '742 - Sikthall / Linje J', 'Förtjockning', 'NCC', -91, 41, 'pagaende', 70),
  it('J10', '742 - Sikthall / Linje J', 'Kontrefor - DP1', 'NCC', -89, 41, 'pagaende', 35),
  it('J14', '742 - Sikthall / Linje J', 'Kontrefor', 'NCC', -89, 12, 'pagaende', 50),
];
seed('plan_items.json', items);
['plan_item_activities.json', 'plan_milestones.json', 'plan_deliveries.json'].forEach(f => seed(f, []));

(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data);
  })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `
    window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({
      project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Slussen Etapp 4' }) },
      viewer: { getSelection: () => Promise.resolve([]), convertToObjectIds: () => Promise.resolve([]), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids), getObjectProperties: () => Promise.resolve([]), setSelection: () => Promise.resolve() }
    }) };` }));
  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', r => {
    const f = decodeURIComponent(new URL(r.request().url()).pathname.replace('/repos/vfalk-NCC/4D-data/contents/', ''));
    const e = store.get(f);
    if (r.request().method() !== 'GET') return r.fulfill({ status: 405, body: '' });
    return e ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(e.content).toString('base64'), sha: e.sha }) }) : r.fulfill({ status: 404, body: '{}' });
  });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  await page.addInitScript(() => {
    localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' }));
    localStorage.setItem('4ddash-unlocked', '1');
    window.__prints = 0; window.print = () => { window.__prints++; };
  });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const fail = m => { throw new Error(m); };
  const pdfDir = process.env.GANTT_PRINT_PDF;

  // Gruppera på område, staplar, en hopfälld grupp och en markerad kedja på skärmen.
  await page.selectOption('#ganttGroupBy', 'area');
  await page.evaluate(() => { ganttCollapsedGroups.add('area:742 - Sikthall / Bedrock'); renderGantt(getFilteredItems()); });
  const screenBefore = await page.evaluate(() => JSON.stringify([ganttRangeStart, ganttRangeEnd, ganttZoomPxPerDay, ganttEditable, [...ganttCollapsedGroups]]));

  // 1) Staplar: dialog, A4 liggande.
  await page.click('#ganttPrintBtn');
  if (!(await page.isVisible('.gantt-print-pop'))) fail('Dialogen ska öppnas');
  await page.click('.gantt-print-pop [data-paper="A4"]');
  await page.click('.gantt-print-pop [data-orient="landscape"]');
  const info = await page.textContent('.gantt-print-pop .gpp-info');
  if (!/anpassas till sidbredden/.test(info)) fail('Infotexten för staplar: ' + info);
  await page.click('.gantt-print-pop [data-act="print"]');
  await page.waitForFunction(() => window.__prints === 1);
  const bars = await page.evaluate(() => {
    const r = document.getElementById('ganttPrint');
    return {
      body: document.body.classList.contains('printing-gantt'), width: r.getBoundingClientRect().width,
      title: r.querySelector('h1').textContent, sub: r.querySelector('.gp-sub').textContent,
      thead: r.querySelectorAll('thead .gantt-ruler-row').length, rows: r.querySelectorAll('tbody .gantt-row').length,
      groups: [...r.querySelectorAll('tbody .gantt-group')].map(g => g.textContent.replace(/\s+/g, ' ').trim()),
      overflow: [...r.querySelectorAll('.gp-chart')].some(c => c.scrollWidth > c.clientWidth + 1),
      page: document.getElementById('ganttPrintPageStyle').textContent,
    };
  });
  if (!bars.body || Math.abs(bars.width - 1047) > 1) fail('Utskriftsvyn ska vara 1047 px bred (A4 liggande, 10 mm marginal): ' + JSON.stringify(bars));
  if (bars.title !== 'Gantt-schema – Slussen Etapp 4' || !/Staplar, grupperat på område/.test(bars.sub)) fail('Rubriken: ' + bars.title + ' / ' + bars.sub);
  if (bars.thead !== 1 || bars.rows !== items.length) fail(`Tidshuvud i thead och alla ${items.length} rader (även den hopfällda gruppen): ` + JSON.stringify(bars));
  if (bars.groups.length !== 4 || bars.groups.some(g => /[▸▾]/.test(g))) fail('Grupperna utan pilar: ' + bars.groups);
  if (bars.overflow) fail('Inget ska sticka ut i sidled');
  if (!/size: A4 landscape/.test(bars.page) || !/counter\(pages\)/.test(bars.page)) fail('Sidformatet: ' + bars.page);
  if (pdfDir) await page.pdf({ path: path.join(pdfDir, 'gantt-staplar.pdf'), preferCSSPageSize: true, printBackground: true });
  console.log('OK: staplarna skrivs ut i sidbredd med rubrik, förklaring och tidshuvud på varje sida');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  if (await page.evaluate(() => !!document.getElementById('ganttPrint') || document.body.classList.contains('printing-gantt'))) fail('Utskriftsvyn ska städas bort efteråt');
  const screenAfter = await page.evaluate(() => JSON.stringify([ganttRangeStart, ganttRangeEnd, ganttZoomPxPerDay, ganttEditable, [...ganttCollapsedGroups]]));
  if (screenAfter !== screenBefore) fail('Skärmens inställningar ska vara orörda: ' + screenBefore + ' → ' + screenAfter);
  console.log('OK: efter utskriften är vyn borta och skärmens inställningar orörda');

  // 2) Tavlan, hela perioden ("Allt", ca 30 veckor): delas i perioder; lappar som fortsätter märks.
  await page.click('[data-gantt-view="board"]');
  await page.click('#ganttEditable'); // redigerbar på skärmen – inte i utskriften
  await page.click('#ganttPrintBtn');
  await page.click('.gantt-print-pop [data-paper="A3"]');
  const info2 = await page.textContent('.gantt-print-pop .gpp-info');
  if (!/delas i \d+ perioder/.test(info2)) fail('Infotexten för tavlan: ' + info2);
  await page.click('.gantt-print-pop [data-act="print"]');
  await page.waitForFunction(() => window.__prints === 2);
  const board = await page.evaluate(() => {
    const r = document.getElementById('ganttPrint');
    const secs = [...r.querySelectorAll('.gp-section')];
    return {
      width: r.getBoundingClientRect().width, sections: secs.length,
      titles: secs.map(s => (s.querySelector('.gp-section-title') || {}).textContent || ''),
      widths: secs.map(s => s.querySelector('.board').getBoundingClientRect().width),
      theads: r.querySelectorAll('thead .board-head').length,
      editable: r.querySelectorAll('.pnote-editable').length,
      contR: r.querySelectorAll('.pnote-cont-r').length, contL: r.querySelectorAll('.pnote-cont-l').length,
      firstWeek: secs.map(s => s.querySelector('.board-week b').textContent),
    };
  });
  if (Math.abs(board.width - 1512) > 1) fail('A3 liggande ska vara 1512 px: ' + board.width);
  if (board.sections < 3 || board.theads !== board.sections) fail('Tavlan ska delas i flera perioder med eget veckohuvud: ' + JSON.stringify(board));
  if (board.widths.some(w => w > 1512.5)) fail('Varje period ska rymmas i sidbredden: ' + board.widths);
  if (!/Del 1 av/.test(board.titles[0])) fail('Periodrubrikerna: ' + board.titles);
  if (board.editable) fail('Utskriften ska inte vara redigerbar');
  if (!board.contR || !board.contL) fail('Lappar som fortsätter i nästa/förra perioden ska märkas: ' + JSON.stringify(board));
  if (pdfDir) await page.pdf({ path: path.join(pdfDir, 'gantt-tavla.pdf'), preferCSSPageSize: true, printBackground: true });
  console.log(`OK: tavlan delas i ${board.sections} perioder (${board.firstWeek.join(', ')}) som ryms i sidbredden, fortsättningar märkta`);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  if (!(await page.evaluate(() => ganttEditable && document.querySelectorAll('#ganttChart .pnote-editable').length > 0))) fail('Tavlan på skärmen ska vara redigerbar som förut');

  // 3) Tavlan, 4 veckor på A4: en period, ingen periodrubrik.
  await page.click('[data-gantt-weeks="4"]');
  await page.click('#ganttPrintBtn');
  await page.click('.gantt-print-pop [data-paper="A4"]');
  await page.click('.gantt-print-pop [data-act="print"]');
  await page.waitForFunction(() => window.__prints === 3);
  const four = await page.evaluate(() => ({ s: document.querySelectorAll('#ganttPrint .gp-section').length, t: document.querySelectorAll('#ganttPrint .gp-section-title').length, w: document.querySelector('#ganttPrint .board').getBoundingClientRect().width, notes: document.querySelectorAll('#ganttPrint .pnote').length }));
  if (four.s !== 1 || four.t !== 0 || four.w > 1047.5 || four.notes < 10) fail('4 veckor på A4 ska bli en period i sidbredd: ' + JSON.stringify(four));
  if (pdfDir) await page.pdf({ path: path.join(pdfDir, 'gantt-tavla-4v.pdf'), preferCSSPageSize: true, printBackground: true });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  console.log('OK: fyra veckor på A4 blir en sida i sidbredd');
  if (await page.evaluate(() => JSON.parse(localStorage.getItem('4ddash-gantt-print')).paper) !== 'A4') fail('Valet av papper ska sparas');

  if (errors.length) fail('Fel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
