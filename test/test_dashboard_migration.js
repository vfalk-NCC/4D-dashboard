// Funktionstest: verifierar att 4D-dashboards migrering till GitHub-
// lagringen fungerar korrekt över flera paneler samtidigt, med fokus på
// just de ställen där id-typen bytte från bigint till UUID-sträng (ett
// vanligt ställe för buggar vid den här typen av migrering: Number(uuid)
// blir NaN och tysta jämförelser slutar matcha).
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8944;
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

const store = new Map(); // path -> { content: obj|Buffer, sha, binary }
function shaFor(content) {
  return crypto.createHash('sha1').update(typeof content === 'string' ? content : JSON.stringify(content)).digest('hex');
}

// Två förhandsseedade plan_items (samma form som github-storage.js
// skriver dem - UUID-id, precis som efter en riktig migrering/besök).
const ITEM_1_ID = crypto.randomUUID();
const ITEM_2_ID = crypto.randomUUID();
const seedItems = [
  { id: ITEM_1_ID, project_id: PROJECT_ID, model_id: null, object_id: 'ext-1', object_name: 'Balk 1', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'klar', start_date: '2026-01-01', end_date: '2026-01-10', progress: 100, updated_at: '2026-01-10T10:00:00Z' },
  { id: ITEM_2_ID, project_id: PROJECT_ID, model_id: null, object_id: 'ext-2', object_name: 'Balk 2', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'pagaende', start_date: '2026-02-01', end_date: '2026-02-10', progress: 40, updated_at: '2026-02-05T10:00:00Z' }
];
store.set(`projects/${PROJECT_ID}/plan_items.json`, { content: JSON.stringify(seedItems), sha: shaFor(seedItems) });

const FAKE_IMAGE = Buffer.from('fake-jpeg-bytes-for-test');

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
        getObjectProperties: function() { return Promise.resolve([]); },
        setSelection: function() { return Promise.resolve(); }
      }
    }); } };`
  }));

  await page.route('https://api.github.com/repos/vfalk-NCC/4D-data/contents/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const filePath = decodeURIComponent(url.pathname.replace('/repos/vfalk-NCC/4D-data/contents/', ''));
    const accept = req.headers()['accept'] || '';

    if (req.method() === 'GET') {
      const entry = store.get(filePath);
      if (!entry) { route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not Found' }) }); return; }
      if (accept.includes('application/vnd.github.raw')) {
        // Bilaga - rå binärdata direkt.
        route.fulfill({ status: 200, contentType: 'application/octet-stream', body: entry.content });
        return;
      }
      const b64 = Buffer.isBuffer(entry.content) ? entry.content.toString('base64') : Buffer.from(entry.content).toString('base64');
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: b64, sha: entry.sha }) });
      return;
    }
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData() || '{}');
      const existing = store.get(filePath);
      if (existing && existing.sha !== body.sha) {
        route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'conflict' }) });
        return;
      }
      const raw = Buffer.from(body.content, 'base64');
      const newSha = shaFor(raw) + Math.random().toString(16).slice(2, 6);
      store.set(filePath, { content: raw, sha: newSha });
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: newSha } }) });
      return;
    }
    route.fulfill({ status: 405, body: 'method not allowed' });
  });

  await page.addInitScript(() => {
    window.localStorage.setItem('4ddash-settings', JSON.stringify({ githubToken: 'fake-token-for-test' }));
    window.localStorage.setItem('4ddash-unlocked', '1');
  });

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  function readJSON(filePath) {
    const entry = store.get(filePath);
    if (!entry) throw new Error('Filen finns inte: ' + filePath);
    return JSON.parse(Buffer.isBuffer(entry.content) ? entry.content.toString('utf-8') : entry.content);
  }

  // 1) KPI:erna ska spegla de två förhandsseedade objekten.
  const kpiText = await page.locator('#kpiGrid').innerText();
  if (!kpiText.includes('2')) throw new Error('KPI-panelen verkar inte visa de 2 seedade objekten: ' + kpiText);

  // 2) Milstolpe.
  await page.locator('#newMilestoneName').fill('Stomresning klar');
  await page.locator('#newMilestoneDate').fill('2026-06-01');
  await page.locator('#btnAddMilestone').click();
  await page.waitForTimeout(300);
  const milestonesFile = readJSON(`projects/${PROJECT_ID}/plan_milestones.json`);
  if (milestonesFile.length !== 1) throw new Error('Förväntade 1 milstolpe, fick ' + milestonesFile.length);
  if (typeof milestonesFile[0].id !== 'string') throw new Error('Milstolpens id är inte en sträng (UUID)');

  // 3) Bemanning - lägg till, sedan uppdatera samma (entreprenör+vecka) och
  //    verifiera att SAMMA id behålls (ghUpsertOne-buggen som fixades:
  //    tidigare skrev ett nygenererat id över det befintliga vid merge).
  // Entreprenörsfältet blir en <select> (inte <input>) så fort minst ett
  // objekt redan har en entreprenör satt (kategoriförslag) - våra seedade
  // objekt har "NCC", så det gäller här.
  await page.selectOption('#newStaffingContractor', 'NCC');
  const weekOptions = await page.locator('#newStaffingWeek option').count();
  if (weekOptions === 0) throw new Error('Inga veckoalternativ i bemanningsformuläret');
  await page.locator('#newStaffingHeadcount').fill('8');
  await page.locator('#newStaffingPlanned').fill('10');
  await page.locator('#btnAddStaffing').click();
  await page.waitForTimeout(300);
  let staffingFile = readJSON(`projects/${PROJECT_ID}/plan_staffing.json`);
  if (staffingFile.length !== 1) throw new Error('Förväntade 1 bemanningsrad, fick ' + staffingFile.length);
  const staffingId1 = staffingFile[0].id;

  await page.selectOption('#newStaffingContractor', 'NCC');
  await page.locator('#newStaffingHeadcount').fill('9');
  await page.locator('#newStaffingPlanned').fill('10');
  await page.locator('#btnAddStaffing').click();
  await page.waitForTimeout(300);
  staffingFile = readJSON(`projects/${PROJECT_ID}/plan_staffing.json`);
  if (staffingFile.length !== 1) throw new Error('Bemanningsuppdatering skapade en ny rad i stället för att uppsertas: ' + staffingFile.length);
  if (staffingFile[0].id !== staffingId1) throw new Error('Bemanningsradens id ändrades vid uppdatering (ghUpsertOne-buggen är tillbaka)');
  if (staffingFile[0].headcount !== 9) throw new Error('Bemanningen uppdaterades inte till 9');

  // 4) Hinder med två påverkade objekt - testar att affected_item_ids
  //    sparas som UUID-strängar, inte NaN (Number(uuid)-buggen).
  await page.locator('#newBlockerDesc').fill('Väntar på armering');
  await page.locator('#newBlockerAffected').selectOption([ITEM_1_ID, ITEM_2_ID]);
  await page.locator('#newBlockerResponsible').fill('NCC');
  await page.locator('#btnAddBlocker').click();
  await page.waitForTimeout(300);
  const blockersFile = readJSON(`projects/${PROJECT_ID}/plan_blockers.json`);
  if (blockersFile.length !== 1) throw new Error('Förväntade 1 hinder, fick ' + blockersFile.length);
  const blocker = blockersFile[0];
  if (!Array.isArray(blocker.affected_item_ids) || blocker.affected_item_ids.length !== 2) {
    throw new Error('affected_item_ids sparades fel (NaN-buggen?): ' + JSON.stringify(blocker.affected_item_ids));
  }
  if (!blocker.affected_item_ids.includes(ITEM_1_ID) || !blocker.affected_item_ids.includes(ITEM_2_ID)) {
    throw new Error('affected_item_ids innehåller inte de valda objektens riktiga UUID:er: ' + JSON.stringify(blocker.affected_item_ids));
  }

  // itemHasOpenBlocker (används av "Kommande veckor") ska nu hitta hindret
  // för de påverkade objekten - testas direkt mot appens egen funktion.
  const hasOpenBlocker = await page.evaluate((itemId) => {
    const it = items.find(i => i.id === itemId);
    return itemHasOpenBlocker(it);
  }, ITEM_1_ID);
  if (!hasOpenBlocker) throw new Error('itemHasOpenBlocker hittade inte det öppna hindret för objektet (NaN-jämförelsebuggen?)');

  // 5) Kommentar på hindret - kommentarstråden är hopfälld som standard,
  //    måste expanderas via "Kommentarer (N)"-knappen först.
  await page.locator(`.blocker-comments-toggle[data-blocker-id="${blocker.id}"]`).click();
  await page.waitForTimeout(150);
  await page.locator(`.blocker-comment-author[data-blocker-id="${blocker.id}"]`).fill('Victor');
  await page.locator(`.blocker-comment-body[data-blocker-id="${blocker.id}"]`).fill('Levereras nästa vecka');
  await page.locator(`.blocker-comment-add-btn[data-blocker-id="${blocker.id}"]`).click();
  await page.waitForTimeout(300);
  let blockerCommentsFile = readJSON(`projects/${PROJECT_ID}/plan_blocker_comments.json`);
  if (blockerCommentsFile.length !== 1) throw new Error('Förväntade 1 hinderkommentar, fick ' + blockerCommentsFile.length);
  if (blockerCommentsFile[0].blocker_id !== blocker.id) throw new Error('Hinderkommentarens blocker_id matchar inte hindrets id (Number(uuid)-buggen?): ' + JSON.stringify(blockerCommentsFile[0]));

  // 6) Säkerhetshändelse MED bilaga - verifierar upload (ghUploadBinary),
  //    att attachment_url blir en repo-sökväg (inte en publik URL), och
  //    att resolveAttachmentLinks() sätter en blob:-URL i DOM:en.
  const tmpFile = path.join(__dirname, 'fixture_attachment.jpg');
  fs.writeFileSync(tmpFile, FAKE_IMAGE);
  await page.locator('#newSafetyType').fill('Skyddsrond');
  await page.locator('#newSafetyFile').setInputFiles(tmpFile);
  await page.locator('#btnAddSafety').click();
  await page.waitForTimeout(500);
  fs.unlinkSync(tmpFile);

  const safetyFile = readJSON(`projects/${PROJECT_ID}/plan_safety_events.json`);
  if (safetyFile.length !== 1) throw new Error('Förväntade 1 säkerhetshändelse, fick ' + safetyFile.length);
  const safetyRow = safetyFile[0];
  if (!safetyRow.attachment_url || safetyRow.attachment_url.startsWith('http')) {
    throw new Error('attachment_url är inte en repo-sökväg: ' + safetyRow.attachment_url);
  }
  const expectedPrefix = `projects/${PROJECT_ID}/attachments/safety/`;
  if (!safetyRow.attachment_url.startsWith(expectedPrefix)) {
    throw new Error('attachment_url hamnade på fel plats: ' + safetyRow.attachment_url);
  }
  const attEntry = store.get(safetyRow.attachment_url);
  if (!attEntry) throw new Error('Bilagan skrevs aldrig till GitHub-mocken');
  if (!Buffer.from(attEntry.content).equals(FAKE_IMAGE)) throw new Error('Bilagans innehåll matchar inte originalfilen');

  await page.waitForTimeout(300); // ge resolveAttachmentLinks tid att slå klart
  const attachmentHref = await page.locator(`a[data-attachment-path="${safetyRow.attachment_url}"]`).getAttribute('href');
  if (!attachmentHref || !attachmentHref.startsWith('blob:')) {
    throw new Error('Bilagelänken resolvades inte till en blob:-URL i DOM:en: ' + attachmentHref);
  }

  // 7) Radera hindret -> hinderkommentaren ska cascade-raderas.
  //    supaDelete() ber om bekräftelse via window.confirm(), som Playwright
  //    annars auto-avvisar (false) - godkänn den explicit för testet.
  page.once('dialog', dialog => dialog.accept());
  await page.evaluate((id) => supaDelete('plan_blockers', id, 'Ta bort?'), blocker.id);
  await page.waitForTimeout(300);
  const blockersFile2 = readJSON(`projects/${PROJECT_ID}/plan_blockers.json`);
  if (blockersFile2.length !== 0) throw new Error('Hindret raderades inte');
  const blockerCommentsFile2 = readJSON(`projects/${PROJECT_ID}/plan_blocker_comments.json`);
  if (blockerCommentsFile2.length !== 0) throw new Error('Hinderkommentaren cascade-raderades INTE: ' + JSON.stringify(blockerCommentsFile2));

  await browser.close();
  server.close();

  console.log('Konsolfel:', consoleErrors);
  if (consoleErrors.length > 0) throw new Error('Konsolfel upptäcktes: ' + consoleErrors.join(' | '));
  console.log('OK: alla migrationskontroller för 4D-dashboard (milstolpar, bemanning-upsert, hinder+affected_item_ids, hinderkommentarer, bilaga, cascade-delete) godkända');
}

run().catch(e => { console.error(e); process.exit(1); });
