// PDF-hubb: callout, verktygshubb (scrollhjulet), zoom med hjul i helskärm, hopp mellan ritningar, mappnamn som paket, ritningsnummer med siffror, synk mot 4D-data.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs'), FIX = path.join(__dirname, 'fixtures', 'review_hub2'), PORT = 8997;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const cands = [process.env.PDFJS_DIR, '/home/user/4D-planering/tools/smoke/.cache/pdfjs-dist_3.11.174/package/build', '/tmp/claude-0/-home-user-4D-planering/867d5061-8c43-5fe8-9725-74ef03d6c450/scratchpad/pdfjs/package/build'].filter(Boolean);
const PDFJS = cands.find(d => fs.existsSync(path.join(d, 'pdf.min.js')));
if (!PDFJS) { console.log('SKIP test_review_hub (hittar inte pdf.js lokalt)'); process.exit(0); }
(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data); })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const store = new Map(); let n = 0; const errors = [];
  const fail = m => { throw new Error(m); };
  async function mkPage() {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }), page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept('2'));
    await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({ project: { getProject: () => Promise.resolve({ id: 'p', name: 'T' }) } }) };` }));
    await page.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(PDFJS, 'pdf.min.js')) }));
    await page.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(PDFJS, 'pdf.worker.min.js')) }));
    await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
    await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', r => {
      const req = r.request(), f = decodeURIComponent(new URL(req.url()).pathname.replace('/repos/vfalk-NCC/4D-data/contents/', '')), e = store.get(f);
      if (req.method() === 'GET') { if (!e) return r.fulfill({ status: 404, body: '{}' }); if (/raw/.test(req.headers().accept || '')) return r.fulfill({ status: 200, body: Buffer.from(e.b64, 'base64') }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: e.b64, encoding: 'base64', sha: e.sha, size: Buffer.from(e.b64, 'base64').length }) }); }
      if (req.method() === 'PUT') { const b = JSON.parse(req.postData() || '{}'); if (e && e.sha !== b.sha) return r.fulfill({ status: 409, body: '{}' }); const sha = 's' + (++n); store.set(f, { b64: b.content, sha }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha } }) }); }
      r.fulfill({ status: 405, body: '' });
    });
    await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); });
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' }); await page.waitForSelector('#revBox .rv-drop');
    return { ctx, page };
  }
  const { ctx, page } = await mkPage();
  const files = fs.readdirSync(FIX).map(f => [f, fs.readFileSync(path.join(FIX, f)).toString('base64')]);
  // import som "mapp": filerna får rotnamnet som paket
  await page.evaluate(async fl => { const arr = fl.map(([nm, b64]) => { const f = new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], nm, { type: 'application/pdf' }); f.rvRoot = 'NSV-Granskning PM14'; return f; }); await rvImport(arr); }, files);
  await page.waitForFunction(() => rv.docs.length === 3 && !rv.indexing && rv.docs.every(d => d.text), null, { timeout: 30000 });
  const pk = await page.evaluate(() => rv.docs.map(d => (rv.pms.find(p => p.id === d.pm) || {}).name)); if (!pk.every(x => x === 'NSV-Granskning PM14')) fail('mappnamnet blir paket: ' + pk);
  const refs = await page.evaluate(() => { const d = rv.docs.find(x => /K-40/.test(x.name)), r = rvRefs(); return [...(r.out.get(d.id) || new Map()).keys()].map(id => rv.docs.find(x => x.id === id).no).sort(); });
  if (JSON.stringify(refs) !== JSON.stringify(['5082590', 'A-2600-1'])) fail('hänvisningar med rena siffror och A-2600-1: ' + JSON.stringify(refs));
  // öppna K-40 och kolla länkrutor
  await page.selectOption('#rvMode', 'disc'); await page.click('.rv-doc[data-open] >> text=K-40-001'); await page.waitForFunction(() => rvv.doc && /K-40/.test(rvv.doc.name) && rvv.links && rvv.links.length === 2 && rvv.W > 0, null, { timeout: 15000 });
  // hopp mellan ritningar
  const pos = await page.evaluate(() => [rv.order.length, rv.order.indexOf(rvv.id)]); if (pos[0] !== 3 || pos[1] < 0) fail('ritningsordning: ' + pos);
  const before = await page.evaluate(() => rvv.id); await page.click('[data-v="pdoc"]'); await page.waitForFunction(b => rvv.id !== b, before, { timeout: 10000 });
  await page.click('.rv-doc[data-open] >> text=K-40-001'); await page.waitForFunction(() => /K-40/.test(rvv.doc.name) && rvv.pdf && rvv.W > 0, null, { timeout: 10000 });
  // sida 2 -> pil höger -> nästa ritning (K-40 är 2 sidor): först sida 2, sedan hopp
  await page.click('[data-v="next"]'); await page.waitForFunction(() => rvv.num === 2, null, { timeout: 5000 }); await page.waitForTimeout(800);
  // callout
  await page.click('[data-tool="callout"]'); let box = await (await page.$('#rvOv')).boundingBox(); await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5); await page.waitForSelector('#rvMkText');
  await page.fill('#rvMkText', 'Kolla\nmåttet'); await page.waitForTimeout(450);
  let c = await page.evaluate(() => { const m = rvv.marks.find(x => x.type === 'callout'); return m && { x: m.x, y: m.y, bx: m.bx, by: m.by, text: m.text, fs: m.fs }; }); if (!c || c.text !== 'Kolla\nmåttet') fail('callout skapas: ' + JSON.stringify(c));
  await page.selectOption('#rvCoFs', '20'); await page.click('[data-fill="#fff3a3"]'); await page.click('[data-tcol="#e5484d"]'); await page.waitForTimeout(200);
  const st = await page.evaluate(() => { const m = rvv.marks.find(x => x.type === 'callout'); return [m.fs, m.fill, m.tcol]; }); if (st[0] !== 20 || st[1] !== '#fff3a3' || st[2] !== '#e5484d') fail('callout stil: ' + st);
  await page.click('[data-tool="hand"]'); box = await (await page.$('#rvOv')).boundingBox();
  const geo = await page.evaluate(() => { const m = rvv.marks.find(x => x.type === 'callout'), b = rvvCoBox(m, rvv.W, rvv.H); return { ax: m.x * rvv.W, ay: m.y * rvv.H, bx: b.x + b.w / 2, by: b.y + b.h / 2 }; });
  await page.mouse.move(box.x + geo.bx, box.y + geo.by); await page.mouse.down(); await page.mouse.move(box.x + geo.bx + 90, box.y + geo.by + 40, { steps: 5 }); await page.mouse.up();
  let c2 = await page.evaluate(() => { const m = rvv.marks.find(x => x.type === 'callout'); return { x: m.x, bx: m.bx }; }); if (Math.abs(c2.x - c.x) > 1e-6 || c2.bx <= c.bx + 0.02) fail('bubblan flyttas utan spetsen: ' + JSON.stringify([c, c2]));
  await page.mouse.move(box.x + geo.ax, box.y + geo.ay); await page.mouse.down(); await page.mouse.move(box.x + geo.ax - 60, box.y + geo.ay - 30, { steps: 5 }); await page.mouse.up();
  let c3 = await page.evaluate(() => { const m = rvv.marks.find(x => x.type === 'callout'); return { x: m.x, bx: m.bx }; }); if (c3.x >= c2.x - 0.02 || Math.abs(c3.bx - c2.bx) > 1e-6) fail('spetsen flyttas utan bubblan: ' + JSON.stringify([c2, c3]));
  // helskärm: hjulet zoomar, högerklick utan meny, hubb med mittenknappen
  await page.click('[data-v="fs"]'); await page.waitForFunction(() => rvv.fs, null, { timeout: 3000 }); await page.waitForTimeout(400);
  const stg = await (await page.$('#rvStage')).boundingBox(); await page.mouse.move(stg.x + stg.width / 2, stg.y + stg.height / 2);
  const z0 = await page.evaluate(() => rvv.zoom); await page.mouse.wheel(0, -400); await page.waitForTimeout(300); const z1 = await page.evaluate(() => rvv.zoom); if (!(z1 > z0 * 1.2)) fail('hjulet zoomar i helskärm: ' + [z0, z1]);
  const prevented = await page.evaluate(() => !document.getElementById('rvStage').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))); if (!prevented) fail('högerklick ska inte öppna webbläsarmenyn i helskärm');
  await page.mouse.move(stg.x + 400, stg.y + 300); await page.mouse.down({ button: 'middle' }); await page.waitForSelector('.rv-hub'); const items = await page.$$eval('.rv-hub-it', e => e.length); if (items !== 10) fail('hubben har 10 verktyg: ' + items);
  await page.mouse.move(stg.x + 400 + 95, stg.y + 300 + 31, { steps: 4 }); await page.waitForTimeout(100); if ((await page.$eval('.rv-hub-it.on', e => e.dataset.k)) !== 'arrow') fail('hubben lyser upp pilen');
  await page.mouse.up({ button: 'middle' }); await page.waitForTimeout(100); if ((await page.evaluate(() => rvv.tool)) !== 'arrow' || (await page.$('.rv-hub'))) fail('släpp väljer verktyget och stänger hubben');
  await page.click('[data-v="fs"]'); await page.waitForTimeout(300);
  // synk mot 4D-data
  await page.evaluate(() => rvsSync(true)); await page.waitForFunction(() => /Synkat/.test(rv.msg || ''), null, { timeout: 30000 });
  const keys = [...store.keys()].join('|'); if (!/review_pdf\/.*\.pdf/.test(keys) || !/review_marks\.json/.test(keys) || !/review_docs\.json/.test(keys)) fail('filer i 4D-data: ' + keys);
  const p2 = await mkPage(); await p2.page.evaluate(() => rvsSync(true)); await p2.page.waitForFunction(() => rv.docs.length === 3 && !rv.indexing && rv.docs.every(d => d.text), null, { timeout: 40000 });
  const mc = await p2.page.evaluate(async () => (await rvAll('marks')).map(m => m.type + ':' + m.fs).join()); if (!/callout:20/.test(mc)) fail('markeringarna följer med till andra enheten: ' + mc);
  const pk2 = await p2.page.evaluate(() => [...new Set(rv.docs.map(d => (rv.pms.find(p => p.id === d.pm) || {}).name))].join()); if (pk2 !== 'NSV-Granskning PM14') fail('paketnamn följer med: ' + pk2);
  const real = errors.filter(e => !/allow-same-origin/.test(e)); if (real.length) fail('JS-fel: ' + real.join(' | '));
  console.log('OK test_review_hub'); await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message, (e.stack.match(/test_review_hub.js:\d+/) || [''])[0]); process.exit(1); });
