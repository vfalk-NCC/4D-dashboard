// Egenkontroll stål: HTML-rapporten (kontrollpunkter, stålfilter, avvikelser, status sparas, statusfil, utskrift).
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs'), PORT = 8996;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data); })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }), page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({ project: { getProject: () => Promise.resolve({ id: 'p', name: 'T' }) } }) };` }));
  await page.route('https://api.github.com/**', r => r.fulfill({ status: 404, body: '{}' })); await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  const fail = m => { throw new Error(m); };
  const html = await page.evaluate(() => {
    const o = (id, n, t, m, k, l, w, h, tn) => ({ id, n, t, f: { m, k, l, w, h, t: tn, f: 'Lyftöglor', p: 'Fas 1' } });
    const views = [{ st: { id: 'a', name: 'Pelare nivå 1', note: 'Kran bokad' }, s: '2026-10-20', e: '2026-10-22' }, { st: { id: 'b', name: 'Balkar nivå 1', note: '' }, s: '2026-10-23', e: '2026-10-26' }];
    const info = { byStep: { a: [o('1', 'HEA 200 pelare', 'Column', 'P1', 'Pelare', 3000, 200, 200, 0.5), o('2', 'HEA 200 pelare', 'Column', 'P2', 'Pelare', 3000, 200, 200, 0.5), o('3', 'Betongvägg', 'Wall', 'V1', 'Vägg', 4000, 200, 2500, 3)], b: [o('4', 'IPE 300 balk', 'Beam', 'B1', 'Balk', 6000, 150, 300, 0.4)] } };
    return ekHtmlDoc({ name: 'Stålhall 742', area: 'Sikthall' }, views, info, { points: ['Märkning stämmer', 'Åtdragning utförd', 'Svets kontrollerad'], steelOnly: true });
  });
  if (/Betongvägg/.test(html)) fail('betong ska inte med när Bara stål är ikryssat');
  const p2 = await ctx.newPage(); const err2 = []; p2.on('pageerror', e => err2.push(e.message)); p2.on('dialog', d => d.accept());
  await p2.route('**/rapport.html', r => r.fulfill({ contentType: 'text/html', body: html })); await p2.goto('http://localhost:' + PORT + '/rapport.html');
  await p2.waitForSelector('table'); const rowsN = (await p2.$$('tr.r')).length; if (rowsN !== 3) fail('tre stålelement: ' + rowsN);
  if ((await p2.textContent('#kp')).indexOf('3') < 0) fail('KPI');
  // första punkten på P1 -> OK, andra -> avvikelse (två klick)
  await p2.fill('#me', 'Kalle'); const cells = '[data-key="0:0"].c'; await p2.click(cells + '[data-j="0"]'); await p2.click('[data-key="0:0"].c[data-j="1"]'); await p2.click('[data-key="0:0"].c[data-j="1"]');
  const st1 = await p2.$eval('tr[data-key="0:0"]', e => e.className); if (!/av/.test(st1)) fail('avvikelse ger raden avvikelse: ' + st1);
  if (!(await p2.textContent('#dev')).includes('Åtdragning utförd')) fail('avvikelselistan');
  await p2.fill('input[data-cm="0:0"]', 'Bult saknas'); if (!(await p2.textContent('#dev')).includes('Bult saknas')) fail('kommentar i avvikelselistan');
  // alla OK på rad 2 och i hela steget
  await p2.click('[data-all="0:1"]'); if (!/ok/.test(await p2.$eval('tr[data-key="0:1"]', e => e.className))) fail('alla OK på raden');
  await p2.click('th[data-col="1:2"]'); if ((await p2.$eval('tr[data-key="1:0"] td.c[data-j="2"]', e => e.textContent)) !== '✓') fail('kolumnrubriken sätter OK');
  const by = await p2.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('egenkontroll:')))).by['0:1']); if (by !== 'Kalle') fail('kontrollanten följer med: ' + by);
  // filter
  await p2.selectOption('#fs', 'av'); if ((await p2.$$('tr.r')).length !== 1) fail('filter avvikelser'); await p2.selectOption('#fs', 'all');
  // sparas efter omladdning, statusfil
  await p2.reload(); await p2.waitForSelector('table'); if (!/av/.test(await p2.$eval('tr[data-key="0:0"]', e => e.className))) fail('status sparas lokalt');
  const [dl] = await Promise.all([p2.waitForEvent('download'), p2.click('#sv')]); const j = JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); if (j.kind !== 'egenkontroll-stal' || !j.state.p['0:0']) fail('statusfil');
  if (process.env.SHOT) { await p2.selectOption('#fs', 'all'); await p2.screenshot({ path: '/tmp/ek.png', fullPage: true }); }
  const real = [...errors, ...err2].filter(e => !/allow-same-origin/.test(e)); if (real.length) fail('JS-fel: ' + real.join(' | '));
  console.log('OK test_egenkontroll'); await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message, (e.stack.match(/test_egenkontroll.js:\d+/) || [''])[0]); process.exit(1); });
