// Tavlan, "En rad" (Victors önskemål 2026-10-06: "ingen aning om vad akt. handlar om om den blir
// för kort"): en lapp som är för kort för sitt namn får en ljus förlängning med namnet; den färgade
// delen är fortfarande exakt aktivitetens längd och högerkanten där går att dra. Även med större lappar.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8974;
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
  it('Kort', 'Linje J', 'Montage av mycket långa prefabricerade väggelement', 2, 2),  // i1: 1 dag, långt namn
  it('Granne', 'Linje J', 'Gjutning', 5, 12),                                        // i2: samma rad om platsen inte reserveras
  it('Lång', 'Linje K', 'Kontrefor', 0, 20),                                         // i3: får plats
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
  await page.click('[data-gantt-view="board"]');
  await page.click('[data-gantt-weeks="4"]');
  await page.waitForTimeout(200);
  const ext = await page.evaluate(() => [...document.querySelectorAll('#ganttChart .pnote')].map(n => {
    const t = n.querySelector('.pnote-title'), r = n.getBoundingClientRect(), tr = t.getBoundingClientRect();
    return { id: n.dataset.itemId, ext: n.classList.contains('pnote-ext'), real: parseFloat(n.style.getPropertyValue('--real')) || 0, w: r.width, top: r.top, left: r.left, right: r.right,
      fits: t.scrollWidth <= t.clientWidth + 1 && tr.right <= r.right + 1, text: t.textContent,
      sub: (() => { const sb = n.querySelector('.pnote-sub'); if (!sb || getComputedStyle(sb).display === 'none') return false; const q = sb.getBoundingClientRect(); return q.right <= r.right + 1 && /Montage av mycket/.test(sb.textContent); })() };
  }));
  const k1 = ext.find(e => e.id === 'i1'), k2 = ext.find(e => e.id === 'i2'), k3 = ext.find(e => e.id === 'i3');
  const dayPx = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.board-grid')).getPropertyValue('--day')));
  if (!k1 || !k1.ext || Math.abs(k1.real - dayPx) > 0.5 || k1.w <= k1.real + 20 || !k1.fits || !k1.sub) fail('En kort lapp ska förlängas så att namnet syns: ' + JSON.stringify({ k1, dayPx }));
  if (k3.ext) fail('En lång lapp ska inte förlängas');
  if (Math.abs(k1.top - k2.top) < 2 && k2.left < k1.right - 1) fail('Förlängningen ska reservera platsen: ' + JSON.stringify({ k1, k2 }));
  // Färgade delen är aktivitetens längd.
  const bw = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pnote-ext'), '::before').width));
  if (Math.abs(bw - dayPx) > 0.5) fail('Den färgade delen ska vara 1 dag: ' + bw);
  await page.locator('#ganttChart').screenshot({ path: path.join(require('os').tmpdir(), 'board_short_note.png') });
  console.log('OK: en 1-dagslapp med långt namn förlängs med namnet, den färgade delen = 1 dag, platsen reserveras');

  // Dra i den riktiga högerkanten → lappen blir längre (Redigerbar).
  await page.check('#ganttEditable'); await page.waitForTimeout(150);
  const n1 = page.locator('#ganttChart .pnote[data-item-id="i1"]');
  const b = await n1.boundingBox();
  const x0 = b.x + dayPx - 3, y0 = b.y + b.height / 2;
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x0 + dayPx * 2, y0, { steps: 5 }); await page.waitForTimeout(250);
  // Medan man drar växer lappen (den färgade delen) direkt – 1 dag → 3 dagar.
  const liveReal = await page.evaluate(() => parseFloat(document.querySelector('#ganttChart .pnote[data-item-id="i1"]').style.getPropertyValue('--real')));
  if (Math.abs(liveReal - dayPx * 3) > 1) fail('Lappen ska växa medan man drar: ' + JSON.stringify({ liveReal, want: dayPx * 3 }));
  await page.mouse.up(); await page.waitForTimeout(600);
  const r1 = get('plan_items.json').find(r => r.id === 'i1');
  if (r1.start_date !== day(2) || r1.end_date !== day(4)) fail('Högerkanten ska förlänga aktiviteten: ' + JSON.stringify(r1));
  console.log('OK: den riktiga högerkanten går att dra');

  await page.uncheck('#ganttBoardOneLine'); await page.waitForTimeout(150);
  // Större lappar (Victor 2026-10-08): en för smal lapp förlängs på samma sätt; de breda gör det inte.
  const big = await page.evaluate(() => [...document.querySelectorAll('#ganttChart .pnote')].map(n => ({ id: n.dataset.itemId, ext: n.classList.contains('pnote-ext'), w: n.getBoundingClientRect().width, meta: !!n.querySelector('.pnote-meta') && getComputedStyle(n.querySelector('.pnote-meta')).display !== 'none' })));
  const kort = big.find(x => x.id === 'i1');
  if (!kort || !kort.ext || kort.w < 160 || !kort.meta || big.filter(x => x.ext).length !== 1) fail('Utan "En rad": den smala lappen ska förlängas (namn, status, datum), inte de andra: ' + JSON.stringify(big));

  // En dag = heldag: datumet en gång och "1 dag"; den färgade dagen ligger kvar framför tavlan även
  // utan lutning (utskriften) – förlängningen är en egen stapelkontext.
  await page.evaluate(() => { const x = items.find(i => i.id === 'i3'); x.endDate = x.startDate; renderGantt(getFilteredItems()); });
  const oneDay = await page.evaluate(() => { const n = document.querySelector('#ganttChart .pnote[data-item-id="i3"]'); return { txt: n.querySelector('.pnote-meta').textContent, iso: getComputedStyle(n).isolation, ext: n.classList.contains('pnote-ext') }; });
  if (!/· 1 dag/.test(oneDay.txt) || / – /.test(oneDay.txt) || !oneDay.ext || oneDay.iso !== 'isolate') fail('Endagsaktivitet: ' + JSON.stringify(oneDay));
  console.log('OK: endagsaktivitet visas som heldag ("1 dag") och den färgade dagen syns även i utskriften');
  // Hela texten (Victor 2026-10-08): knappen visar hela namnet på alla större lappar; att peka på en lapp
  // fäller ut den utan att något annat flyttas.
  await page.evaluate(() => { ganttBoardOneLine = false; ganttBoardFullText = false; const x = items.find(i => i.id === 'i3'); x.objectName = 'Ställningsmontage till kontrafor. KLART PÅ FREDAG. Resten på kontrafor efter det. STÄLLNING FRAMFLYTTAD PGA UPPSTICK. PROJFÖRÄNDRING. PROJ LÖST.'; const d = new Date(x.startDate); d.setUTCDate(d.getUTCDate() + 5); x.endDate = d.toISOString().slice(0, 10); renderGantt(getFilteredItems()); });
  await page.waitForTimeout(200);
  const lines = () => page.evaluate(() => { const t = document.querySelector('#ganttChart .pnote[data-item-id="i3"] .pnote-title'); return Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight)); });
  const posOthers = () => page.evaluate(() => [...document.querySelectorAll('#ganttChart .pnote:not([data-item-id="i3"])')].map(n => Math.round(n.getBoundingClientRect().top)).join());
  if ((await lines()) > 2) fail('Standard: högst två rader');
  const before = await posOthers();
  await page.hover('#ganttChart .pnote[data-item-id="i3"] .pnote-meta');
  await page.waitForTimeout(150);
  const peek = await page.evaluate(() => document.querySelector('#ganttChart .pnote[data-item-id="i3"]').classList.contains('pnote-peek'));
  if (!peek || (await lines()) <= 2 || (await posOthers()) !== before) fail('Peka: lappen ska fällas ut utan att något flyttas: ' + JSON.stringify({ peek, lines: await lines() }));
  await page.mouse.move(5, 5); await page.waitForTimeout(100);
  await page.check('#ganttBoardFull'); await page.waitForTimeout(200);
  if ((await lines()) <= 2 || !(await page.evaluate(() => JSON.parse(localStorage.getItem(GANTT_PREFS_KEY)).boardFullText))) fail('Hela texten ska visa allt och sparas');
  await page.uncheck('#ganttBoardFull');
  console.log('OK: Hela texten – knappen visar hela namnet, att peka fäller ut lappen utan att något flyttas');
  if (errors.length) fail('Fel: ' + errors.join(' | '));
  console.log('ALLA TESTER OK');
  await browser.close(); server.close();
})().catch(e => { console.error('FEL:', e.message); process.exit(1); });
