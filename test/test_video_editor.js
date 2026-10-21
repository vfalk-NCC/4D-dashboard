// Video editor (block under Gantt-planeringen): kameravyer, provbild med grafik, förhandsvisning och rendering till videofil
// med Trimble Connects kamera och stillbilder utbytta mot provfunktioner.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8991;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const PID = 'test-project';
const store = new Map(); let n = 0;
const seed = (f, c) => store.set(`projects/${PID}/${f}`, { content: JSON.stringify(c), sha: 's' + (++n) });
const iso = d => d.toISOString().slice(0, 10);
const day = k => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + k); return iso(d); };
const base = { project_id: PID, model_id: 'M1', actual_start_date: null, actual_end_date: null, estimated_hours: null, updated_at: '2026-01-01T00:00:00Z', depends_on: [], contractor: 'NCC', status: 'planerad' };
seed('plan_items.json', [
  { ...base, id: 'i1', object_id: 'G1', object_name: 'Grund', area: 'A', activity: 'Betong', start_date: day(-6), end_date: day(-2), progress: 100 },
  { ...base, id: 'i2', object_id: 'G2', object_name: 'Stomme med ett riktigt långt namn för att testa avkortning', area: 'A', activity: 'Stomme', start_date: day(-1), end_date: day(5), progress: 40 },
  { ...base, id: 'i3', object_id: 'G3', object_name: 'Tak', area: 'B', activity: 'Tak', start_date: day(6), end_date: day(9), progress: 0 },
]);
['plan_milestones.json', 'plan_deliveries.json', 'plan_item_baseline_history.json', 'plan_item_activities.json'].forEach(f => seed(f, []));
(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data);
  })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `
    window.__cam = { position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 } }; window.__cams = []; window.__shots = 0;
    window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({
      markup: { addTextMarkup: m => Promise.resolve([]), removeMarkups: () => Promise.resolve() },
      project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) },
      viewer: { isolateEntities: () => Promise.resolve(), setObjectState: () => Promise.resolve(), convertToObjectRuntimeIds: (m, ids) => Promise.resolve(ids.map((x, i) => i + 1)), getModels: () => Promise.resolve([]), setSelection: () => Promise.resolve(),
        getCamera: () => Promise.resolve(JSON.parse(JSON.stringify(window.__cam))), setCamera: c => { if (c && c.position) { window.__cam = JSON.parse(JSON.stringify(c)); window.__cams.push(window.__cam); } return Promise.resolve(); },
        getSnapshot: () => { window.__shots++; const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); x.fillStyle = '#e5e7eb'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#2563eb'; x.fillRect(100 + window.__shots * 4, 100, 120, 80); return Promise.resolve(c.toDataURL('image/png')); } },
      ui: {}, extension: {}, embed: { setTokenRefresh: () => {} }
    }) };` }));
  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', r => {
    const req = r.request(), f = decodeURIComponent(new URL(req.url()).pathname.replace('/repos/vfalk-NCC/4D-data/contents/', ''));
    const e = store.get(f);
    if (req.method() === 'GET') return e ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(e.content).toString('base64'), sha: e.sha }) }) : r.fulfill({ status: 404, body: '{}' });
    r.fulfill({ status: 405, body: '' });
  });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); localStorage.setItem('4ddash-test-modelctl', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const fail = m => { throw new Error(m); };
  try {
    if (!(await page.$('[data-panel-id="video-editor"] #videoEditor'))) fail('Blocket Video editor saknas');
    if (!/video editor/i.test(await page.innerText('[data-panel-id="video-editor"] h2'))) fail('Rubriken ska vara Video editor: ' + await page.innerText('[data-panel-id="video-editor"] h2'));
    const order = await page.evaluate(() => [...document.querySelectorAll('.panel[data-panel-id]')].map(p => p.dataset.panelId));
    if (order.indexOf('video-editor') !== order.indexOf('resource-curve') + 1) fail('Blocket ska ligga under Gantt (och resurskurvan): ' + order.join());
    // Vyer: två kameravyer på olika datum.
    await page.evaluate(() => { window.__cam = { position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 } }; });
    await page.fill('#vidKeyDate', day(-6)); await page.click('#vidAddKey'); await page.waitForTimeout(200);
    await page.evaluate(() => { window.__cam = { position: { x: 100, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 } }; });
    await page.fill('#vidKeyDate', day(9)); await page.click('#vidAddKey'); await page.waitForTimeout(200);
    if ((await page.$$('.vid-key')).length !== 2) fail('Två vyer ska listas');
    const mid = await page.evaluate(day3 => vidCamAt(day3).position.x, day(1.5 | 0));
    const cams = await page.evaluate(() => [vidCamAt(addDaysIso(todayISO(), -30)).position.x, vidCamAt(addDaysIso(todayISO(), 30)).position.x]);
    if (cams[0] !== 0 || cams[1] !== 100 || !(mid > 0 && mid < 100)) fail('Kameran står still före första och efter sista vyn, och glider emellan: ' + JSON.stringify({ cams, mid }));
    // Reglaget hoppar TC-vyn till bildens kamera och datum.
    await page.evaluate(() => { window.__cams = []; const r = document.getElementById('vidFrame'); r.value = r.max; r.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(800);
    const jmp = await page.evaluate(() => ({ x: window.__cam.position.x, d: ganttAsOf, last: vidRange()[1] }));
    if (jmp.x !== 100 || jmp.d !== jmp.last) fail('Reglaget ska flytta TC-vyn till sista bilden (kamera och datum): ' + JSON.stringify(jmp));
    await page.evaluate(() => { const r = document.getElementById('vidFrame'); r.value = 0; r.dispatchEvent(new Event('input')); }); await page.waitForTimeout(800);
    if ((await page.evaluate(() => window.__cam.position.x)) !== 0) fail('Första bilden: kameran på första vyn');
    // Kameran glider jämnt mellan hela dagar (decimaldagar), inte i dagssteg.
    const sm = await page.evaluate(() => { const [from, to] = vidRange(), n = 300, xs = []; for (let i = 0; i <= n; i += 1) xs.push(vidCamAtFrame(i, n, from, to).position.x); const uniq = new Set(xs.map(v => v.toFixed(3))).size; return { uniq }; });
    if (sm.uniq < 250) fail('Kameran ska ha ett eget läge för (nästan) varje bild, inte stå still mellan dagarna: ' + JSON.stringify(sm));
    // Provbild med grafik.
    await page.fill('#vidSec', '3'); await page.selectOption('#vidFps', '10'); await page.fill('#vidWait', '0'); await page.dispatchEvent('#vidWait', 'change');
    await page.evaluate(() => { const r = document.getElementById('vidFrame'); r.value = 7; r.dispatchEvent(new Event('input')); });
    if (!/bild 8 av 31/.test(await page.innerText('#vidFrameLbl'))) fail('Valet av bild: ' + await page.innerText('#vidFrameLbl'));
    // Vinklarna tas den korta vägen (ingen 360° mellan vyer).
    { const w = await page.evaluate(() => ({ mid: vidLerp({ yaw: 170, pitch: -10, position: { x: 0 } }, { yaw: -170, pitch: 10, position: { x: 10 } }, 0.5), un: vidUnwrap({ yaw: 170 }, { yaw: -170 }), same: vidLerp({ yaw: 10 }, { yaw: 50 }, 0.5) }));
      if (Math.abs(w.mid.yaw - 180) > 1e-9 || w.mid.pitch !== 0 || w.mid.position.x !== 5 || Math.abs(w.un.yaw - 190) > 1e-9 || w.same.yaw !== 30) fail('Kameravinklar den korta vägen: ' + JSON.stringify(w)); }
    // Tidslinjen: dra på den väljer bild, huvudet och datumet följer, kameramarkörer finns.
    { const fr0 = await page.evaluate(() => document.getElementById('vidFrame').value); const bb = await page.locator('#vidTlTrack').boundingBox(); await page.mouse.move(bb.x + bb.width * 0.5, bb.y + 20); await page.mouse.down(); await page.mouse.up();
      const tl = await page.evaluate(() => ({ lbl: document.getElementById('vidFrameLbl').textContent, date: document.getElementById('vidTlDate').textContent, head: document.getElementById('vidTlHead').style.left, keys: document.querySelectorAll('.vtl-key').length, ticks: document.querySelectorAll('.vtl-axis span').length }));
      if (!/bild 1[5-7] av 31/.test(tl.lbl) || !/^v\.\d+ · \d+ \w+ \d{4}$/.test(tl.date) || parseFloat(tl.head) < 45 || parseFloat(tl.head) > 55 || tl.ticks < 1) fail('Tidslinjen i videoeditorn: ' + JSON.stringify(tl));
      if (process.env.SHOT) await page.locator('#vidTl, .vtl').first().screenshot({ path: process.env.SHOT + '/vtl.png' });
      await page.evaluate(v => { const r = document.getElementById('vidFrame'); r.value = v; r.dispatchEvent(new Event('input')); }, fr0); }
    await page.click('#vidShot'); await page.waitForSelector('#vidShotBox canvas', { timeout: 15000 }).catch(async () => fail('Provbild: ' + await page.innerText('#vidMsg') + ' | ' + errors.join(' | ')));
    if (!/Provbild .*640×360/.test(await page.innerText('#vidMsg'))) fail('Provbild: ' + await page.innerText('#vidMsg'));
    if (process.env.VID_PNG) fs.writeFileSync(process.env.VID_PNG, Buffer.from((await page.evaluate(() => document.querySelector('#vidShotBox canvas').toDataURL('image/png'))).split(',')[1], 'base64'));
    const px = await page.evaluate(() => { const c = document.querySelector('#vidShotBox canvas'), d = c.getContext('2d').getImageData(40, 90, 1, 1).data; return [...d]; });
    if (px[0] > 120 || px[2] > 140) fail('Datumskylten ska vara ritad (mörk ruta uppe till vänster): ' + px);
    if (!/Provbild bild 8 av 31/.test(await page.innerText('#vidMsg'))) fail('Provbild på vald bild: ' + await page.innerText('#vidMsg'));
    await page.click('#vidShotKeys'); await page.waitForFunction(() => document.querySelectorAll('#vidShotBox .vid-card').length === 3 && !vid.run, null, { timeout: 20000 });
    await page.fill('#vidSec', '3'); // ritar om blocket – provbilderna ska ligga kvar
    await page.dispatchEvent('#vidSec', 'change');
    if ((await page.$$('#vidShotBox .vid-card')).length !== 3 || !(await page.$('#vidShotBox .vc-save'))) fail('Provbilderna ska ligga kvar med Spara-knapp');
    // Rendera: 3 s × 10 bilder/s = 31 bilder; videon sparas som fil.
    const camBefore = await page.evaluate(() => window.__cam.position.x);
    const dl = page.waitForEvent('download', { timeout: 120000 });
    await page.click('#vidRender');
    await dl; // nedladdningen startade (headless ger blobben namnet 'download' – namnet kontrolleras via vid.last)
    await page.waitForFunction(() => !vid.run, null, { timeout: 15000 });
    const R = await page.evaluate(() => ({ shots: window.__shots, last: vid.last, msg: document.getElementById('vidMsg').textContent, mode: ganttMode }));
    if (R.shots < 31 || !R.last || R.last.frames < 31 || R.last.size < 1000 || R.last.H !== 1080 || R.last.W !== 1920 || !/^4D-film .*\.(mp4|webm)$/.test(R.last.name)) fail('Rendering: ' + JSON.stringify(R));
    // Kameran är tillbaka där den var.
    const camNow = await page.evaluate(() => window.__cam.position.x);
    if (camNow !== camBefore) fail('Kameran ska återställas efter filmen: ' + camNow);
    // Förhandsvisning och stopp.
    await page.click('#vidPreview'); await page.waitForTimeout(500); await page.click('#vidStop'); await page.waitForFunction(() => !vid.run, null, { timeout: 10000 });
    console.log('OK: Video editor – kameravyer, provbild med grafik, rendering till videofil, förhandsvisning och stopp');
    if (errors.length) fail('Sidfel: ' + errors.join(' | '));
    console.log('ALLA TESTER OK');
  } catch (e) { console.log('FEL: ' + e.message); process.exitCode = 1; }
  await browser.close(); server.close();
})();
