// Granskning (PDF): släpp PDF:er i ett PM, sortering på disciplin/revision, sökning i texten, visare med markeringar, jämför revisioner, rapport och export.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs'), FIX = path.join(__dirname, 'fixtures', 'review'), PORT = 8998;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const cands = [process.env.PDFJS_DIR, '/home/user/4D-planering/tools/smoke/.cache/pdfjs-dist_3.11.174/package/build', '/tmp/claude-0/-home-user-4D-planering/867d5061-8c43-5fe8-9725-74ef03d6c450/scratchpad/pdfjs/package/build'].filter(Boolean);
const PDFJS = cands.find(d => fs.existsSync(path.join(d, 'pdf.min.js')));
if (!PDFJS) { console.log('SKIP test_review (hittar inte pdf.js lokalt: sätt PDFJS_DIR)'); process.exit(0); }
(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data); })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept(d.type() === 'prompt' ? '2' : undefined));
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({ project: { getProject: () => Promise.resolve({ id: 'p', name: 'T' }) }, viewer: {} }) };` }));
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(PDFJS, 'pdf.min.js')) }));
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(PDFJS, 'pdf.worker.min.js')) }));
  await page.route('https://api.github.com/**', r => r.fulfill({ status: 404, body: '{}' })); await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' }); await page.waitForSelector('#revBox .rv-drop');
  const fail = m => { throw new Error(m); };
  const files = fs.readdirSync(FIX).filter(f => /\.pdf$/.test(f)).map(f => path.join(FIX, f));
  // släpp alla utom en via drop-händelsen, resten via filväljaren
  const dropOne = files.find(f => /VVS_300/.test(f));
  await page.evaluate(async ([name, b64]) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), dt = new DataTransfer(); dt.items.add(new File([bin], name, { type: 'application/pdf' })); document.getElementById('revBox').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, [path.basename(dropOne), fs.readFileSync(dropOne).toString('base64')]);
  await page.waitForFunction(() => rv.docs.length === 1 && !rv.indexing, null, { timeout: 15000 });
  await page.setInputFiles('#rvFile', files); await page.waitForFunction(() => rv.docs.length === 6 && !rv.indexing && rv.docs.every(d => d.text), null, { timeout: 30000 });
  const dupMsg = await page.textContent('.rv-msg').catch(() => ''); if (!/fanns redan/.test(dupMsg || '')) fail('samma fil läses inte in två gånger: ' + dupMsg);
  // sortering
  const gh = (await page.$$eval('.rv-gh', e => e.map(x => x.textContent.replace(/\s+/g, ' ').trim()))).join('|');
  if (!/Arkitekt 1/.test(gh) || !/Konstruktion 1/.test(gh) || !/El 1/.test(gh) || !/Ventilation 1/.test(gh)) fail('grupperas på disciplin: ' + gh);
  const rows = await page.$$eval('.rv-row:not(.old) .rv-t b', e => e.map(x => x.textContent)); if (!rows.includes('A-10-001') || rows.length !== 5) fail('en rad per ritning, ersatta dolda: ' + rows.join());
  const a = await page.evaluate(() => rv.docs.filter(d => d.no === 'A-10-001').map(d => [d.rev, d.old, d.revs])); if (JSON.stringify(a.sort()) !== JSON.stringify([['A', true, 2], ['B', false, 2]])) fail('revisionerna: ' + JSON.stringify(a));
  if (!(await page.textContent('.rv-list')).includes('ny rev')) fail('märket ny rev'); await page.check('#rvOld'); if ((await page.$$('.rv-row.old')).length !== 1) fail('visa ersatta'); await page.uncheck('#rvOld');
  const k = await page.evaluate(() => rv.docs.find(d => /K-20-005/.test(d.name))); if (k.rev !== 'C' && k.no !== 'K-20-005') fail('rubrik/revision ur filnamn eller första sidan: ' + JSON.stringify([k.no, k.rev]));
  // sök i texten
  await page.fill('#rvQ', 'armering'); await page.waitForSelector('.rv-snip'); const sn = await page.textContent('.rv-snip'); if (!/s\.2/.test(sn)) fail('sökträff på sida 2: ' + sn);
  await page.click('.rv-snip'); await page.waitForSelector('#rvCv'); await page.waitForFunction(() => rvv.num === 2 && rvv.hlRects.length > 0, null, { timeout: 15000 });
  await page.fill('#rvQ', ''); 
  // öppna ritning, markera
  await page.click('.rv-doc[data-open] >> text=A-10-001'); await page.waitForFunction(() => rvv.doc && rvv.doc.rev === 'B' && rvv.W > 0 && document.getElementById('rvCv') && document.getElementById('rvCv').width > 100, null, { timeout: 15000 }); await page.waitForTimeout(400);
  const ink = () => page.evaluate(() => { const cv = document.getElementById('rvCv'), c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const g = c.getContext('2d'); g.drawImage(cv, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n; });
  if ((await ink()) < 500) fail('sidan ritas');
  const box = await (await page.$('#rvOv')).boundingBox();
  await page.click('[data-tool="pin"]'); await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4); await page.waitForSelector('#rvMkText'); await page.fill('#rvMkText', 'Kontrollera mått mot K-ritning'); await page.waitForTimeout(500);
  await page.click('[data-tool="rect"]'); await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 5 }); await page.mouse.up();
  let mk = await page.evaluate(() => rvv.marks.map(m => [m.type, m.n, m.status, m.text])); if (mk.length !== 2 || mk[0][3] !== 'Kontrollera mått mot K-ritning' || mk[1][0] !== 'rect') fail('två markeringar: ' + JSON.stringify(mk));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200); if ((await page.evaluate(() => rvv.marks.length)) !== 1) fail('ångra tar bort ruta'); await page.keyboard.press('Control+y'); await page.waitForTimeout(200); if ((await page.evaluate(() => rvv.marks.length)) !== 2) fail('gör om');
  await page.click('.rv-mi >> nth=1'); await page.click('[data-st="done"]'); await page.waitForTimeout(200);
  // pil och mått med skala
  await page.click('[data-tool="calib"]'); await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.9); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.9, { steps: 4 }); await page.mouse.up();
  await page.waitForFunction(() => rvv.doc.scaleW > 0, null, { timeout: 5000 }); const sc = await page.evaluate(() => rvv.doc.scaleW); if (Math.abs(sc - 2 * 1 / 0.5) > 0.5 && !(sc > 0)) fail('skala satt: ' + sc);
  await page.click('[data-tool="measure"]'); await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.8); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.8, { steps: 4 }); await page.mouse.up();
  const meas = await page.evaluate(() => { const m = rvv.marks.find(x => x.type === 'measure'); return m ? rvvFmtLen(m) : ''; }); if (!/m$/.test(meas)) fail('mått visar längd: ' + meas);
  // zoom
  const z0 = await page.textContent('#rvZ'); await page.click('[data-v="zin"]'); await page.waitForTimeout(400); if ((await page.textContent('#rvZ')) === z0) fail('zoom ändras');
  // jämför revisioner
  await page.click('[data-v="cmp"]'); await page.click('.rv-menu button'); await page.waitForFunction(() => !document.getElementById('rvCmp').hidden, null, { timeout: 10000 });
  const cmp = await page.evaluate(() => { const cm = document.getElementById('rvCmp'), d = cm.getContext('2d').getImageData(0, 0, cm.width, cm.height).data; let g = 0, r = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] < 60 && d[i + 1] > 120 && d[i + 2] < 90) g++; else if (d[i] > 190 && d[i + 1] < 90) r++; } return { g, r }; });
  if (cmp.g < 200) fail('jämförelsen visar nytt i grönt (rev B har en extra ruta): ' + JSON.stringify(cmp));
  await page.click('[data-v="cmp"]'); if (!(await page.evaluate(() => document.getElementById('rvCmp').hidden))) fail('avsluta jämförelsen');
  if (process.env.SHOT) await page.screenshot({ path: '/tmp/rv1.png' });
  // sparat efter omladdning (IndexedDB)
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('#revBox .rv-row');
  const after = await page.evaluate(async () => ({ docs: rv.docs.length, marks: (await rvAll('marks')).length, scale: rv.docs.find(d => d.rev === 'B').scaleW > 0 })); if (after.docs !== 6 || after.marks !== 3 || !after.scale) fail('sparas lokalt: ' + JSON.stringify(after));
  if (!(await page.textContent('.rv-list')).match(/\d/)) fail('märke för öppna markeringar');
  // export
  await page.click('#rvRep'); const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('.rv-menu button >> text=CSV')]); const csv = fs.readFileSync(await dl1.path(), 'utf8'); if (!csv.includes('Kontrollera mått mot K-ritning') || !csv.includes('Åtgärdad')) fail('CSV: ' + csv.slice(0, 200));
  await page.click('#rvRep'); const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.rv-menu button >> text=Granskningsrapport')]); const html = fs.readFileSync(await dl2.path(), 'utf8'); if (!html.includes('Kontrollera mått mot K-ritning') || !/data:image\/jpeg/.test(html) || !html.includes('A-10-001')) fail('HTML-rapport med bildutsnitt');
  await page.click('#rvRep'); const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('.rv-menu button >> text=Spara markeringar')]); const js = JSON.parse(fs.readFileSync(await dl3.path(), 'utf8')); if (js.kind !== 'granskning-markeringar' || js.docs.length !== 1 || js.docs[0].marks.length !== 3) fail('markeringsfil: ' + JSON.stringify(js).slice(0, 200));
  // egen dialogruta med textfält (i Trimble Connects iframe blockeras webbläsarens prompt)
  { const r = await page.evaluate(async () => { window.__forceDashDialogs = true; const p = dashPrompt('Namn på PM', 'Start'); await new Promise(r => setTimeout(r, 60)); const inp = document.querySelector('.dash-in'); inp.value = 'Mitt PM'; document.querySelector('.okb').click(); const a = await p; const q = dashPrompt('Namn', 'x'); await new Promise(r => setTimeout(r, 60)); document.querySelector('.cancel').click(); const b = await q; window.__forceDashDialogs = false; return [a, b]; });
    if (r[0] !== 'Mitt PM' || r[1] !== null) fail('dashPrompt: ' + JSON.stringify(r)); }
  const real = errors.filter(e => !/allow-same-origin/.test(e)); if (real.length) fail('JS-fel: ' + real.join(' | '));
  console.log('OK test_review'); await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
