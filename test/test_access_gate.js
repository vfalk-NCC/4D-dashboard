// Funktionstest: verifierar lösenordsgrinden i 4D-dashboard.
// Fel lösenord -> "Du har ej åtkomst" ligger kvar + felmeddelande.
// Rätt lösenord ("ändra-mig") -> grinden döljs, appen startar, och valet
// kommer ihåg vid omladdning (localStorage 4ddash-unlocked).
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8943;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

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

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 480, height: 900 } });

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && !/Failed to load resource.*404/.test(msg.text())) consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  // Trimble/GitHub anropas bara EFTER upplåsning - mockas ändå så att
  // initApp() (som körs efter rätt lösenord) inte fastnar.
  await page.route('https://components.connect.trimble.com/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.TrimbleConnectWorkspace = { connect: function() { return Promise.resolve({
      project: { getProject: function(){ return Promise.resolve({ id: 'test-project' }); } },
      viewer: {
        getSelection: function() { return Promise.resolve([]); },
        convertToObjectIds: function() { return Promise.resolve([]); },
        getObjectProperties: function() { return Promise.resolve([]); },
        setSelection: function() { return Promise.resolve(); }
      }
    }); } };`
  }));
  await page.route('https://api.github.com/**', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not Found' }) }));

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  // 1) Ingen som är upplåst sedan tidigare -> grinden ska synas direkt,
  //    med exakt texten "Du har ej åtkomst".
  const gateVisible = await page.locator('#accessGate').isVisible();
  if (!gateVisible) throw new Error('accessGate borde vara synlig vid första besöket');
  const heading = await page.locator('#accessGate h2').innerText();
  if (heading.trim() !== 'Du har ej åtkomst') throw new Error('Fel rubriktext på grinden: ' + heading);

  // 2) Fel lösenord -> grinden ligger kvar, felmeddelande visas, ingen
  //    upplåsning sparas.
  await page.locator('#accessPassword').fill('fel-losenord');
  await page.locator('#btnAccessSubmit').click();
  await page.waitForTimeout(150);
  const stillVisible = await page.locator('#accessGate').isVisible();
  if (!stillVisible) throw new Error('Grinden döljdes trots fel lösenord');
  const errorVisible = await page.locator('#accessError').isVisible();
  if (!errorVisible) throw new Error('Felmeddelandet visades inte vid fel lösenord');
  const unlockedAfterWrong = await page.evaluate(() => window.localStorage.getItem('4ddash-unlocked'));
  if (unlockedAfterWrong) throw new Error('localStorage markerades som upplåst trots fel lösenord');

  // 3) Rätt lösenord -> grinden döljs, appen startar (huvud-UI syns).
  await page.locator('#accessPassword').fill('ändra-mig');
  await page.locator('#btnAccessSubmit').click();
  await page.waitForTimeout(300);
  const hiddenAfterCorrect = await page.locator('#accessGate').isHidden();
  if (!hiddenAfterCorrect) throw new Error('Grinden döljdes inte trots rätt lösenord');
  const unlockedAfterCorrect = await page.evaluate(() => window.localStorage.getItem('4ddash-unlocked'));
  if (unlockedAfterCorrect !== '1') throw new Error('localStorage markerades inte som upplåst efter rätt lösenord');
  const appVisible = await page.locator('#app header h1').isVisible();
  if (!appVisible) throw new Error('Appens huvud-UI syns inte efter upplåsning');

  // 4) Omladdning -> ska komma ihåg upplåsningen, grinden ska INTE visas.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const hiddenAfterReload = await page.locator('#accessGate').isHidden();
  if (!hiddenAfterReload) throw new Error('Grinden visades igen efter omladdning trots sparad upplåsning');

  await browser.close();
  server.close();

  console.log('Konsolfel:', consoleErrors);
  if (consoleErrors.length > 0) throw new Error('Konsolfel upptäcktes: ' + consoleErrors.join(' | '));
  console.log('OK: lösenordsgrinden i 4D-dashboard fungerar korrekt');
}

run().catch(e => { console.error(e); process.exit(1); });
