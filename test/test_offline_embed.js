// Offline i 4D-dashboarden (Gantten som visas i 3D-editorn): offline.js laddas, läsningar sparas, och utan nät används den sparade versionen.
const { chromium } = require('playwright'), path = require('path'), http = require('http'), fs = require('fs');
const DOCS = path.join(__dirname, '..', 'docs'), PORT = 8947, MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const server = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]), f = path.join(DOCS, u === '/' ? 'index.html' : u); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }), ctx = await browser.newContext(), pg = await ctx.newPage(), errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  await pg.addInitScript(() => { localStorage.setItem('4ddash-unlocked', '1'); });
  await pg.route('https://components.connect.trimble.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
  const data = Buffer.from(JSON.stringify([{ id: 'a1' }])).toString('base64');
  await pg.route('https://api.github.com/**', r => { const u = new URL(r.request().url()); if (/plan_items\.json$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: data, sha: 's1', size: 20 }) }); r.fulfill({ status: 404, body: '{}' }); });
  await pg.goto(`http://localhost:${PORT}/index.html?embed=gantt`); await pg.waitForTimeout(1200);
  const a = await pg.evaluate(async () => { const g = await ghGetFile('t', 'projects/p1/plan_items.json'); return { has: typeof offlineSync !== 'undefined', n: g.data.length, cached: (await offlineSync.cachedFiles()).join() }; });
  if (!a.has || a.n !== 1 || a.cached !== 'projects/p1/plan_items.json') throw new Error('offline.js i dashboarden: ' + JSON.stringify(a));
  await ctx.setOffline(true); await pg.waitForTimeout(300);
  const b = await pg.evaluate(async () => { ghFileCache.clear(); const g = await ghGetFile('t', 'projects/p1/plan_items.json', { fresh: true }); return { n: g.data.length, st: offlineSync.state.offline, onl: navigator.onLine, w: String(ghGetFile).slice(0, 40) }; });
  if (b.n !== 1) throw new Error('Offline-läsning: ' + JSON.stringify(b));
  if (errors.length) throw new Error('Sidfel: ' + errors.join(' | '));
  console.log('OK test_offline_embed: dashboarden har offline-läge (läser sparad version utan nät)');
  await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
