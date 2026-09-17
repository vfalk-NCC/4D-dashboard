// Funktionstest: "Statusfärger" i 4D-dashboards inställningar (Victors
// förfrågan 2026-09-17: kunna välja egna färger för planerad/klar osv,
// i samband med en läsbarhetsöversyn av Gantt-schemat).
//  1) Inställningarna listar en färgruta per status, med standardfärgerna
//     ifyllda.
//  2) Att ändra en färg uppdaterar direkt Gantt-schemats stapelkant,
//     cirkeldiagrammet och statusfördelningen (ingen ombladdning/Spara-
//     knapp behövs).
//  3) Valet sparas i localStorage och gäller efter en omladdning.
//  4) "Återställ standardfärger" nollställer och tar bort det sparade valet.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8969;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const PROJECT_ID = 'test-project';

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const filePath = path.join(DOCS_DIR, req.url === '/' ? 'index.html' : req.url);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

const store = new Map();
function shaFor(content) {
  return crypto.createHash('sha1').update(typeof content === 'string' ? content : JSON.stringify(content)).digest('hex') + Math.random().toString(16).slice(2, 6);
}
function seedJson(filePath, content) {
  store.set(filePath, { content: JSON.stringify(content), sha: shaFor(content) });
}

const seedItems = [
  { id: 'i1', project_id: PROJECT_ID, object_id: 'ext-1', object_name: 'Pelare A', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'pagaende', start_date: '2026-02-01', end_date: '2026-02-10', actual_start_date: null, actual_end_date: null, estimated_hours: null, progress: 40, updated_at: '2026-02-01T00:00:00Z' }
];
seedJson(`projects/${PROJECT_ID}/plan_items.json`, seedItems);
seedJson(`projects/${PROJECT_ID}/plan_item_activities.json`, []);
seedJson(`projects/${PROJECT_ID}/plan_milestones.json`, []);
seedJson(`projects/${PROJECT_ID}/plan_deliveries.json`, []);

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 480, height: 2400 } });

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && !/Failed to load resource.*404/.test(msg.text())) consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  await page.route('https://components.connect.trimble.com/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.TrimbleConnectWorkspace = { connect: function() { return Promise.resolve({
      project: { getProject: function(){ return Promise.resolve({ id: '${PROJECT_ID}' }); } },
      viewer: {
        getSelection: function() { return Promise.resolve([]); },
        convertToObjectIds: function() { return Promise.resolve([]); },
        convertToObjectRuntimeIds: function() { return Promise.resolve([]); },
        getObjectProperties: function() { return Promise.resolve([]); },
        setSelection: function() { return Promise.resolve(); }
      }
    }); } };`
  }));

  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const filePath = decodeURIComponent(url.pathname.replace('/repos/vfalk-NCC/4D-data/contents/', ''));
    if (req.method() === 'GET') {
      const entry = store.get(filePath);
      if (!entry) { route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not Found' }) }); return; }
      const b64 = Buffer.from(entry.content).toString('base64');
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: b64, sha: entry.sha }) });
      return;
    }
    route.fulfill({ status: 405, body: 'method not allowed' });
  });

  await page.route('https://api.open-meteo.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ current_weather: {}, daily: {} })
  }));

  await page.addInitScript(() => {
    window.localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 'fake-token-for-test' }));
    window.localStorage.setItem('4ddash-unlocked', '1');
  });

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // ---- 1) Inställningarna listar en färgruta per status, med standardfärgerna ifyllda.
  await page.locator('#btnSettings').click();
  await page.waitForTimeout(50);
  const colorInputs = page.locator('.status-color-list input[type="color"]');
  if (await colorInputs.count() !== 6) throw new Error('Förväntade en färgruta per status (6), fick: ' + (await colorInputs.count()));
  const pagaendeInput = page.locator('input[type="color"][data-status="pagaende"]');
  const defaultValue = await pagaendeInput.inputValue();
  if (defaultValue.toLowerCase() !== '#f5a623') throw new Error('Förväntade standardfärgen #f5a623 för Pågående, fick: ' + defaultValue);
  console.log('OK: inställningarna listar en färgruta per status, med standardfärgerna ifyllda');

  // ---- 2) Att ändra "Pågående" till lila uppdaterar direkt Gantt-stapelns
  // kant, cirkeldiagrammets segment och statusfördelningens stapel.
  await pagaendeInput.evaluate(el => { el.value = '#8b5cf6'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(100);

  const barBorderColor = await page.evaluate(() => getComputedStyle(document.querySelector('.gantt-bar')).borderColor);
  if (!/139, 92, 246/.test(barBorderColor)) throw new Error('Förväntade att Gantt-stapelns kant blir lila (rgb 139,92,246) direkt, fick: ' + barBorderColor);

  const donutStroke = await page.evaluate(() => {
    const c = document.querySelector('#statusDonut circle[stroke]:not([stroke="var(--border)"])');
    return c ? c.getAttribute('stroke') : null;
  });
  if (donutStroke !== '#8b5cf6') throw new Error('Förväntade att cirkeldiagrammets segment blir lila, fick: ' + donutStroke);

  const legendDot = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.gantt-legend-item'));
    const row = items.find(el => el.textContent.includes('Pågående'));
    return row ? row.querySelector('.gantt-legend-dot').style.background : null;
  });
  if (!legendDot || !/139, 92, 246|#8b5cf6/i.test(legendDot)) throw new Error('Förväntade att Gantt-färgförklaringens prick för Pågående också blir lila, fick: ' + legendDot);
  console.log('OK: att ändra en statusfärg uppdaterar direkt Gantt-stapeln, färgförklaringen och cirkeldiagrammet - utan Spara-knapp');

  // ---- 3) Valet sparas i localStorage och gäller efter en omladdning.
  await page.locator('#btnCloseSettings').click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const barBorderColorAfterReload = await page.evaluate(() => getComputedStyle(document.querySelector('.gantt-bar')).borderColor);
  if (!/139, 92, 246/.test(barBorderColorAfterReload)) throw new Error('Förväntade att den anpassade färgen överlever en omladdning, fick: ' + barBorderColorAfterReload);
  console.log('OK: anpassade statusfärger sparas i localStorage och gäller efter en omladdning');

  // ---- 4) "Återställ standardfärger" nollställer valet.
  await page.locator('#btnSettings').click();
  await page.waitForTimeout(50);
  await page.locator('#btnResetStatusColors').click();
  await page.waitForTimeout(100);
  const resetValue = await page.locator('input[type="color"][data-status="pagaende"]').inputValue();
  if (resetValue.toLowerCase() !== '#f5a623') throw new Error('Förväntade att "Återställ standardfärger" sätter tillbaka #f5a623, fick: ' + resetValue);
  const barBorderColorAfterReset = await page.evaluate(() => getComputedStyle(document.querySelector('.gantt-bar')).borderColor);
  if (!/245, 166, 35/.test(barBorderColorAfterReset)) throw new Error('Förväntade att Gantt-stapelns kant återgår till orange efter återställning, fick: ' + barBorderColorAfterReset);
  const storedAfterReset = await page.evaluate(() => window.localStorage.getItem('4ddash-status-colors'));
  if (storedAfterReset !== null) throw new Error('Förväntade att det sparade valet tas bort helt vid återställning, fick: ' + storedAfterReset);
  console.log('OK: "Återställ standardfärger" nollställer valet och tar bort det sparade i localStorage');

  await browser.close();
  server.close();

  console.log('Konsolfel:', consoleErrors);
  if (consoleErrors.length > 0) throw new Error('Konsolfel upptäcktes: ' + consoleErrors.join(' | '));
  console.log('OK: "Statusfärger"-funktionen fungerar korrekt');
}

run().catch(e => { console.error(e); process.exit(1); });
