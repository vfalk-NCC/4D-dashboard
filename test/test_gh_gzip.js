// Stora datafiler sparas gzippade (över ~8 MB) och läses tillbaka identiskt; små filer är vanlig JSON.
const { chromium } = require('playwright');
const path = require('path'), http = require('http'), fs = require('fs');
const DOCS_DIR = path.join(__dirname, '..', 'docs'), PORT = 8994, PID = 'test-project';
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const store = new Map(); // path -> { b64, sha }
const put = (f, o) => store.set(`projects/${PID}/${f}`, { b64: Buffer.from(JSON.stringify(o)).toString('base64'), sha: 's0' });
put('plan_items.json', []); ['plan_item_activities.json', 'plan_milestones.json', 'plan_deliveries.json', 'plan_item_baseline_history.json'].forEach(f => put(f, []));
let n = 0; const puts = [];
(async () => {
  const server = http.createServer((req, res) => fs.readFile(path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]), (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(req.url.split('?')[0])] || 'application/octet-stream' }); res.end(data); })).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: `window.TrimbleConnectWorkspace = { connect: () => Promise.resolve({ project: { getProject: () => Promise.resolve({ id: '${PID}', name: 'Test' }) } }) };` }));
  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', r => {
    const req = r.request(), f = decodeURIComponent(new URL(req.url()).pathname.replace('/repos/vfalk-NCC/4D-data/contents/', '')), e = store.get(f);
    if (req.method() === 'GET') {
      if (!e) return r.fulfill({ status: 404, body: '{}' });
      const bytes = Buffer.from(e.b64, 'base64');
      if ((req.headers()['accept'] || '').includes('raw')) return r.fulfill({ status: 200, contentType: 'application/octet-stream', body: bytes });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bytes.length > 1e6 ? { sha: e.sha, size: bytes.length } : { content: e.b64, sha: e.sha }) });
    }
    if (req.method() === 'PUT') { const b = JSON.parse(req.postData() || '{}'); const sha = 's' + (++n); store.set(f, { b64: b.content, sha }); puts.push({ f, len: b.content.length, head: b.content.slice(0, 4) }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha } }) }); }
    r.fulfill({ status: 405, body: '' });
  });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"current_weather":{},"daily":{}}' }));
  await page.addInitScript(() => { localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 't' })); localStorage.setItem('4ddash-unlocked', '1'); });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  const fail = m => { throw new Error(m); };
  const R = await page.evaluate(async pid => {
    const mk = k => Array.from({ length: k }, (_, i) => ({ id: 'r' + i, object_name: 'Åäö-objekt ' + i + ' ' + 'x'.repeat(40), model_id: 'M', object_id: 'O' + i, start_date: '2026-10-01', end_date: '2026-10-20', progress: i % 100, note: 'å'.repeat(30) + Math.random() }));
    const p = `projects/${pid}/plan_items.json`, small = mk(50), big = mk(60000);
    await ghWriteJSON('t', p, () => small, 'liten'); ghFileCache.clear();
    const s1 = (await ghGetFile('t', p)).data.length;
    await ghWriteJSON('t', p, () => big, 'stor'); ghFileCache.clear();
    const got = (await ghGetFile('t', p)).data;
    return { s1, n: got.length, same: JSON.stringify(got) === JSON.stringify(big), len: JSON.stringify(big).length };
  }, PID);
  const pi = puts.filter(x => x.f.endsWith('plan_items.json'));
  if (R.s1 !== 50 || pi[0].head === 'H4sI') fail('liten fil ska vara vanlig JSON: ' + JSON.stringify([R.s1, pi[0]]));
  if (pi[1].head !== 'H4sI') fail('stor fil ska vara gzip (base64 börjar H4sI): ' + pi[1].head);
  if (!(pi[1].len < R.len / 4)) fail('gzip ska krympa kraftigt: ' + pi[1].len + ' mot ' + R.len);
  if (R.n !== 60000 || !R.same) fail('läsning ska ge identiskt innehåll: ' + JSON.stringify(R));
  if (errors.length) fail('sidfel: ' + errors.slice(0, 3));
  console.log('ALLA TESTER OK', `(${Math.round(R.len / 1e6)} MB → ${Math.round(pi[1].len * 0.75 / 1e6 * 10) / 10} MB)`); await browser.close(); server.close();
})().catch(e => { console.error('FEL: ' + e.message); process.exit(1); });
