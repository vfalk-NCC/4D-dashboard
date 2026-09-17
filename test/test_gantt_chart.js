// Funktionstest: Gantt-schema i 4D-dashboard (Victors förfrågan 2026-09-17).
//  1) En rad per objekt (planerat start-slut), sorterat på startdatum.
//  2) Objekt med sparade delaktiviteter (plan_item_activities) har en
//     utfällbar pil - klick visar/döljer delaktivitetsraderna.
//  3) Kryssrutan "Visa verkligt" lägger till en extra stapel med verklig
//     start/avslut, av som standard.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const PORT = 8964;
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
  { id: 'i1', project_id: PROJECT_ID, object_id: 'ext-1', model_id: 'model-1', object_name: 'Pelare A', area: 'Hus A', activity: 'Gjutning', contractor: 'NCC', status: 'pagaende', start_date: '2026-02-01', end_date: '2026-02-15', actual_start_date: '2026-02-03', actual_end_date: null, estimated_hours: null, progress: 40, updated_at: '2026-02-01T00:00:00Z' },
  { id: 'i2', project_id: PROJECT_ID, object_id: 'ext-2', object_name: 'Pelare B', area: 'Hus A', activity: 'Formning', contractor: 'Peab', status: 'klar', start_date: '2026-01-10', end_date: '2026-01-20', actual_start_date: '2026-01-11', actual_end_date: '2026-01-22', estimated_hours: null, progress: 100, updated_at: '2026-01-22T00:00:00Z' },
  { id: 'i3', project_id: PROJECT_ID, object_id: 'ext-3', object_name: 'Pelare C (inga datum)', area: 'Hus B', activity: 'Gjutning', contractor: 'NCC', status: 'ej_planerad', start_date: null, end_date: null, actual_start_date: null, actual_end_date: null, estimated_hours: null, progress: 0, updated_at: '2026-01-01T00:00:00Z' }
];
seedJson(`projects/${PROJECT_ID}/plan_items.json`, seedItems);

const seedActivities = [
  { id: 'act-1', plan_item_id: 'i1', project_id: PROJECT_ID, name: 'Formning', start_date: '2026-02-01', end_date: '2026-02-06', estimated_hours: 8 },
  { id: 'act-2', plan_item_id: 'i1', project_id: PROJECT_ID, name: 'Gjutning', start_date: '2026-02-07', end_date: '2026-02-15', estimated_hours: 12 }
];
seedJson(`projects/${PROJECT_ID}/plan_item_activities.json`, seedActivities);
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
        convertToObjectRuntimeIds: function(modelId, ids) { window.__lastConvertCall = { modelId: modelId, ids: ids }; return Promise.resolve(ids.map(function(_, i) { return 500 + i; })); },
        getObjectProperties: function() { return Promise.resolve([]); },
        setSelection: function(sel) { window.__lastSelection = sel; return Promise.resolve(); }
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

  // ---- 1) En rad per objekt med datum, sorterat på startdatum. Objekt utan datum uteslutet + varnat om.
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('.gantt-row:not(.gantt-subrow) .gantt-label')).map(el => el.textContent.trim()));
  if (JSON.stringify(labels) !== JSON.stringify(['Pelare B', 'Pelare A'])) {
    throw new Error('Förväntade raderna i startdatumordning ["Pelare B", "Pelare A"] (Pelare C saknar datum och ska inte visas), fick: ' + JSON.stringify(labels));
  }
  const skippedHint = await page.locator('#ganttNotes').innerText();
  if (!/1 objekt utan både start- och slutdatum/.test(skippedHint)) throw new Error('Förväntade en hint om att 1 objekt utan datum inte visas, fick: ' + skippedHint);
  console.log('OK: Gantt-schemat visar en rad per objekt med datum, sorterat på startdatum, och varnar om uteslutna objekt utan datum');

  // ---- 2) Infällbara delaktiviteter - Pelare A har 2 sparade, Pelare B har 0.
  const subRowsBefore = await page.locator('.gantt-subrow').count();
  if (subRowsBefore !== 0) throw new Error('Delaktiviteter ska vara hopfällda som standard, hittade: ' + subRowsBefore);

  const toggleA = page.locator('.gantt-row:not(.gantt-subrow)', { hasText: 'Pelare A' }).locator('[data-action="toggle-gantt"]');
  if (await toggleA.count() !== 1) throw new Error('Pelare A (har delaktiviteter) skulle ha en utfällbar pil');
  const toggleB = page.locator('.gantt-row:not(.gantt-subrow)', { hasText: 'Pelare B' }).locator('[data-action="toggle-gantt"]');
  if (await toggleB.count() !== 0) throw new Error('Pelare B (inga delaktiviteter) skulle INTE ha en utfällbar pil');

  await toggleA.click();
  await page.waitForTimeout(50);
  const subLabelsA = await page.evaluate(() => Array.from(document.querySelectorAll('.gantt-subrow .gantt-sublabel')).map(el => el.textContent.trim()));
  if (JSON.stringify(subLabelsA) !== JSON.stringify(['Formning', 'Gjutning'])) {
    throw new Error('Förväntade delaktiviteterna ["Formning", "Gjutning"] under Pelare A, fick: ' + JSON.stringify(subLabelsA));
  }
  console.log('OK: klick på pilen fäller ut objektets sparade delaktiviteter som egna rader');

  await toggleA.click();
  await page.waitForTimeout(50);
  const subRowsAfterCollapse = await page.locator('.gantt-subrow').count();
  if (subRowsAfterCollapse !== 0) throw new Error('Delaktiviteterna skulle fällas ihop igen vid nytt klick på pilen');
  console.log('OK: ett andra klick på pilen fäller ihop delaktiviteterna igen');

  // ---- 3) "Visa verkligt" - av som standard, lägger till en extra stapel när ikryssad.
  const actualBarsBefore = await page.locator('.gantt-bar-actual').count();
  if (actualBarsBefore !== 0) throw new Error('"Visa verkligt" ska vara av som standard (inga .gantt-bar-actual), hittade: ' + actualBarsBefore);

  await page.locator('#ganttShowActual').check();
  await page.waitForTimeout(50);
  // Pelare A och Pelare B har båda verklig start, men bara Pelare B har även verkligt avslut ifyllt.
  const actualBarsAfter = await page.locator('.gantt-bar-actual').count();
  if (actualBarsAfter !== 1) throw new Error('Förväntade 1 verklig-stapel (bara Pelare B har både verklig start OCH avslut ifyllt), fick: ' + actualBarsAfter);
  console.log('OK: "Visa verkligt" lägger till en extra stapel bara för objekt som har både verklig start och avslut ifyllt');

  // ---- 4) Färgförklaring (legend) - status + verkligt/helg/idag.
  const legendText = await page.locator('#ganttLegend').innerText();
  if (!/Pågående/.test(legendText) || !/Helg/.test(legendText) || !/Idag/.test(legendText) || !/Verkligt/.test(legendText)) {
    throw new Error('Förväntade en färgförklaring med status, verkligt, helg och idag, fick: ' + legendText);
  }
  console.log('OK: färgförklaringen visar statusar samt verkligt/helg/idag-nycklar');

  // ---- 5) Grid/helg/idag-markör ritas som CSS-bakgrundslager på .gantt-inner (eget datumintervall som täcker idag).
  await page.locator('#ganttRangeStart').fill('2026-01-01');
  await page.locator('#ganttRangeEnd').fill('2026-12-31');
  await page.locator('#ganttRangeApply').click();
  await page.waitForTimeout(50);
  const gridImage = await page.evaluate(() => document.querySelector('.gantt-inner').style.getPropertyValue('--gg-image'));
  if (!/repeating-linear-gradient/.test(gridImage)) throw new Error('Förväntade vecko-/helglinjer (repeating-linear-gradient) i --gg-image, fick: ' + gridImage);
  const todayLabelCount = await page.locator('.gantt-today-label').count();
  if (todayLabelCount !== 1) throw new Error('Förväntade en "Idag"-etikett när dagens datum ligger inom det valda intervallet, fick: ' + todayLabelCount);
  const rangeStatus = await page.locator('#ganttRangeStatus').innerText();
  if (!/2026-01-01.*2026-12-31/.test(rangeStatus)) throw new Error('Förväntade en statustext med det valda intervallet, fick: ' + rangeStatus);
  console.log('OK: eget datumintervall filtrerar/ritar om tidsaxeln, med grid-/helglinjer och en "Idag"-markör');

  await page.locator('#ganttRangeReset').click();
  await page.waitForTimeout(50);

  // ---- 6) Framdrift-fyllning - bredden på .gantt-bar-fill motsvarar objektets progress (Pelare A = 40%).
  const fillWidth = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.gantt-row:not(.gantt-subrow)')).find(r => r.textContent.includes('Pelare A'));
    return row.querySelector('.gantt-bar-fill').style.width;
  });
  if (fillWidth !== '40%') throw new Error('Förväntade en framdrift-fyllning på 40% för Pelare A, fick: ' + fillWidth);
  console.log('OK: staplarna har en framdrift-fyllning (meter) som motsvarar objektets progress-fält');

  // ---- 7) Hover-tooltip visar status/datum/framdrift.
  const barA = page.locator('.gantt-row:not(.gantt-subrow)', { hasText: 'Pelare A' }).locator('.gantt-bar').first();
  await barA.hover();
  await page.waitForTimeout(50);
  const tooltipText = await page.locator('.gantt-tooltip').innerText();
  if (!/Pelare A/.test(tooltipText) || !/Pågående/.test(tooltipText) || !/40%/.test(tooltipText)) {
    throw new Error('Förväntade en tooltip med namn, status och framdrift för Pelare A, fick: ' + tooltipText);
  }
  await page.mouse.move(5, 5);
  await page.waitForTimeout(50);
  const tooltipHiddenAfter = await page.locator('.gantt-tooltip').evaluate(el => el.classList.contains('hidden'));
  if (!tooltipHiddenAfter) throw new Error('Förväntade att tooltipen döljs när muspekaren lämnar stapeln');
  console.log('OK: hover över en stapel visar en tooltip med status/datum/framdrift, som döljs igen när pekaren flyttas bort');

  // ---- 8) Gruppering (Område) - grupphuvuden, hopfällbara.
  await page.locator('#ganttGroupBy').selectOption('area');
  await page.waitForTimeout(50);
  const groupHeaders = await page.locator('.gantt-group').allInnerTexts();
  if (!groupHeaders.some(t => /Hus A/.test(t))) throw new Error('Förväntade en gruppheader för "Hus A", fick: ' + JSON.stringify(groupHeaders));
  const groupHeaderA = page.locator('.gantt-group', { hasText: 'Hus A' });
  await groupHeaderA.click();
  await page.waitForTimeout(50);
  const rowsAfterCollapse = await page.locator('.gantt-rows-wrap .gantt-row:not(.gantt-subrow)').count();
  if (rowsAfterCollapse !== 0) throw new Error('Förväntade att hopfälld grupp döljer sina rader (Hus A är den enda gruppen med data här), fick: ' + rowsAfterCollapse);
  await groupHeaderA.click();
  await page.waitForTimeout(50);
  await page.locator('#ganttGroupBy').selectOption('');
  await page.waitForTimeout(50);
  console.log('OK: gruppering på Område visar hopfällbara grupphuvuden');

  // ---- 9) Sortering (Namn) - byter radordning.
  await page.locator('#ganttSortBy').selectOption('name');
  await page.waitForTimeout(50);
  const labelsByName = await page.evaluate(() => Array.from(document.querySelectorAll('.gantt-row:not(.gantt-subrow) .gantt-label')).map(el => el.textContent.trim()));
  if (JSON.stringify(labelsByName) !== JSON.stringify(['Pelare A', 'Pelare B'])) {
    throw new Error('Förväntade bokstavsordning ["Pelare A", "Pelare B"] vid sortering på Namn, fick: ' + JSON.stringify(labelsByName));
  }
  await page.locator('#ganttSortBy').selectOption('startDate');
  await page.waitForTimeout(50);
  console.log('OK: sortering på Namn byter radordningen');

  // ---- 10) Densitet - "Kompakt" -> "Bekväm" byter klass på #ganttChart.
  await page.locator('#ganttDensityToggle').click();
  await page.waitForTimeout(50);
  const hasComfortable = await page.locator('#ganttChart.gantt-density-comfortable').count();
  if (hasComfortable !== 1) throw new Error('Förväntade klassen gantt-density-comfortable efter klick på densitetsknappen');
  await page.locator('#ganttDensityToggle').click();
  await page.waitForTimeout(50);
  console.log('OK: densitetsknappen växlar mellan kompakt och bekväm radhöjd');

  // ---- 11) Zoom - "+" byter från procent- till pixelbaserad positionering (px-enhet i stapelns style.left).
  await page.locator('#ganttZoomIn').click();
  await page.waitForTimeout(50);
  const barLeftZoomed = await page.evaluate(() => document.querySelector('.gantt-row:not(.gantt-subrow) .gantt-bar').style.left);
  if (!/px$/.test(barLeftZoomed)) throw new Error('Förväntade en pixelbaserad position efter zoom in, fick: ' + barLeftZoomed);
  await page.locator('#ganttZoomFit').click();
  await page.waitForTimeout(50);
  const barLeftFit = await page.evaluate(() => document.querySelector('.gantt-row:not(.gantt-subrow) .gantt-bar').style.left);
  if (!/%$/.test(barLeftFit)) throw new Error('Förväntade procentbaserad position efter "Anpassa", fick: ' + barLeftFit);
  console.log('OK: zoomkontrollerna växlar mellan procent- ("Anpassa") och pixelbaserad positionering');

  // ---- 12) Klick på objektnamnet markerar objektet i 3D-modellen (Pelare A har model_id/object_id).
  const labelA = page.locator('.gantt-row:not(.gantt-subrow)', { hasText: 'Pelare A' }).locator('[data-action="select-gantt-3d"]');
  if (await labelA.count() !== 1) throw new Error('Förväntade att Pelare A (har model_id/object_id) har ett klickbart, 3D-kopplat objektnamn');
  const labelB = page.locator('.gantt-row:not(.gantt-subrow)', { hasText: 'Pelare B' }).locator('[data-action="select-gantt-3d"]');
  if (await labelB.count() !== 0) throw new Error('Förväntade att Pelare B (saknar model_id/object_id) INTE har ett 3D-kopplat objektnamn');
  await labelA.click();
  await page.waitForTimeout(50);
  const lastSelection = await page.evaluate(() => window.__lastSelection);
  if (!lastSelection || !lastSelection.modelObjectIds || lastSelection.modelObjectIds[0].modelId !== 'model-1') {
    throw new Error('Förväntade att klick på Pelare A anropar setSelection med modelId "model-1", fick: ' + JSON.stringify(lastSelection));
  }
  console.log('OK: klick på ett objektnamn med känd 3D-koppling markerar objektet i modellen');

  await browser.close();
  server.close();

  console.log('Konsolfel:', consoleErrors);
  if (consoleErrors.length > 0) throw new Error('Konsolfel upptäcktes: ' + consoleErrors.join(' | '));
  console.log('OK: Gantt-schemat fungerar korrekt');
}

run().catch(e => { console.error(e); process.exit(1); });
