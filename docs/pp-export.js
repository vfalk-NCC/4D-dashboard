/* Export av aktiviteter till Powerproject (Victor 2026-10-13): Microsoft Project-XML (MSPDI) som Powerproject kan importera
   (Import/Export → Importera från Microsoft Project®, XML). Områdets delar (delade på "/") blir sammanfattningsrader,
   aktiviteterna får start, slut, framdrift och "Väntar på" med glapp, och resurser (antal × timmar) kan följa med. */

const ppxEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
/* Arbetsdagar (mån–fre) mellan två datum, båda inräknade – minst 1. */
function ppxWorkdays(a, b) {
  const d0 = Date.parse(a + "T00:00:00Z"), d1 = Date.parse(b + "T00:00:00Z");
  let n = 0;
  for (let t = d0; t <= d1; t += 86400000) { const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) n++; }
  return Math.max(1, n);
}
const ppxDur = days => `PT${days * 8}H0M0S`;
const ppxHours = h => `PT${Math.max(0, Math.round(Number(h) * 100) / 100)}H0M0S`.replace(/(\.\d+)?H/, m => m);

/* En uppgift exakt som Powerproject själv skriver den i sin Microsoft Project-XML (samma fält, samma ordning, inga andra) –
   Powerprojects egen inläsning avvisade en fuller MSP-fil som "inte en giltig XML fil" (Victor 2026-10-13). */
function ppxTask(t) {
  return `<Task><UID>${t.uid}</UID><ID>${t.uid}</ID><Name>${ppxEsc(t.name)}</Name><Type>0</Type><IsNull>0</IsNull><WBS>${t.num}</WBS><OutlineNumber>${t.num}</OutlineNumber><OutlineLevel>${t.level}</OutlineLevel><Start>${t.start}</Start><Finish>${t.finish}</Finish><ManualStart>${t.start}</ManualStart><ManualFinish>${t.finish}</ManualFinish><Duration>${t.dur}</Duration><ManualDuration>${t.dur}</ManualDuration><DurationFormat>7</DurationFormat><Milestone>${t.milestone}</Milestone><Summary>${t.summary}</Summary><Critical>0</Critical><FixedCost>0</FixedCost><FixedCostAccrual>3</FixedCostAccrual><PercentComplete>${t.pct}</PercentComplete><ConstraintType>4</ConstraintType><CalendarUID>1</CalendarUID><ConstraintDate>${t.start}</ConstraintDate>${t.preds}${t.ext || ""}</Task>`;
}

/* acts: sammanslagna aktiviteter (som Gantten visar). opts: { project, resources }.
   Returnerar { xml, tasks, links, droppedLinks, resources }. */
function buildMspXml(acts, opts = {}) {
  const project = opts.project || "Nya aktiviteter från 4D";
  const list = acts.filter(a => a.startDate && (a.endDate || a.startDate));
  // Träd: områdets delar → sammanfattningsrader.
  const root = { name: project, kids: new Map(), acts: [], level: 0 };
  list.forEach(a => {
    const path = String(a.area || "").split("/").map(x => x.trim()).filter(Boolean);
    let node = root;
    (path.length ? path : ["Nya aktiviteter"]).forEach(seg => {
      if (!node.kids.has(seg)) node.kids.set(seg, { name: seg, kids: new Map(), acts: [], level: node.level + 1 });
      node = node.kids.get(seg);
    });
    node.acts.push(a);
  });
  // UID och disposition (1.2.3) i utskriftsordning.
  let uid = 0; const order = [], uidOfAct = new Map();
  const walk = (node, num) => {
    node.uid = uid++; node.num = num; order.push({ node });
    let c = 0;
    node.acts.forEach(a => { const u = uid++; uidOfAct.set(a, u); order.push({ act: a, uid: u, level: node.level + 1, num: (num ? num + "." : "") + (++c) }); });
    node.kids.forEach(k => walk(k, (num ? num + "." : "") + (++c)));
  };
  walk(root, "");
  // Alla id (även objekten i en sammanslagen aktivitet) → aktivitetens UID, för "Väntar på".
  const uidOfId = new Map();
  list.forEach(a => (a.members || [a]).forEach(m => uidOfId.set(String(m.id), uidOfAct.get(a))));
  const range = node => {
    const all = []; const rec = n => { n.acts.forEach(a => all.push(a)); n.kids.forEach(rec); }; rec(node);
    const s = all.map(a => a.startDate).sort(), e = all.map(a => a.endDate || a.startDate).sort();
    return { s: s[0], e: e[e.length - 1] };
  };
  const rootR0 = list.length ? list.map(a => a.startDate).sort()[0] : new Date().toISOString().slice(0, 10);
  const iso = (d, end) => `${d}T${end ? "16:00:00" : "08:00:00"}`;
  let links = 0, droppedLinks = 0;
  const taskXml = [];
  order.forEach(o => {
    if (o.node) {
      const n = o.node;
      if (n.level === 0) return; // projektraden skrivs inte (Powerproject skriver heller ingen)
      const r = range(n);
      const days = r.s ? ppxWorkdays(r.s, r.e) : 1;
      taskXml.push(ppxTask({ uid: n.uid, name: n.name, level: n.level, num: n.level === 0 ? "0" : n.num, start: iso(r.s || rootR0), finish: iso(r.e || rootR0, true), dur: ppxDur(days), summary: 1, milestone: 0, pct: 0, preds: "", ext: opts.extSummary || "" }));
    } else {
      const a = o.act, end = a.endDate || a.startDate, days = ppxWorkdays(a.startDate, end);
      const num = o.num;
      const milestone = a.startDate === end && a.activity === "Milstolpe";
      const preds = new Set(); let pl = "";
      (a.members || [a]).flatMap(m => (m.dependsOn || []).map(d => [m, String(d)])).forEach(([m, d]) => {
        const pu = uidOfId.get(d);
        if (pu === undefined) { droppedLinks++; return; }
        if (pu === o.uid || preds.has(pu)) return;
        preds.add(pu); links++;
        const lag = (m.depLags && m.depLags[d] !== undefined && m.depLags[d] !== null && m.depLags[d] !== "" ? Number(m.depLags[d]) : 0) || 0;
        pl += `<PredecessorLink><PredecessorUID>${pu}</PredecessorUID><Type>1</Type><CrossProject>0</CrossProject><LinkLag>${Math.round(lag * 4800)}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`;
      });
      taskXml.push(ppxTask({ uid: o.uid, name: a.objectName || a.activity || "Aktivitet", level: o.level, num, start: iso(a.startDate), finish: iso(end, true), dur: ppxDur(days), summary: 0, milestone: milestone ? 1 : 0, pct: Math.max(0, Math.min(100, Math.round(Number(a.progress) || 0))), preds: pl, ext: opts.extLeaf || "" }));
    }
  });
  // Resurser och tilldelningar.
  const resList = [], resUid = new Map(), assign = [], assignList = [];
  if (opts.resources !== false) list.forEach(a => {
    const rs = (a.members || [a]).map(m => m.resources).find(r => Array.isArray(r) && r.length) || [];
    rs.forEach(r => {
      if (!r || !r.name) return;
      if (!resUid.has(r.name)) { resUid.set(r.name, resList.length + 1); resList.push(r.name); }
      assignList.push({ task: uidOfAct.get(a), res: r.name, units: Number(r.qty) || 1, hours: r.hours });
      assign.push(`<Assignment><UID>${assign.length + 1}</UID><TaskUID>${uidOfAct.get(a)}</TaskUID><ResourceUID>${resUid.get(r.name)}</ResourceUID><Units>${Number(r.qty) || 1}</Units><Work>${ppxHours(r.hours)}</Work></Assignment>`);
    });
  });
  const rootR = range(root);
  const dayW = d => d === 1 || d === 7 ? `<WeekDay><DayType>${d}</DayType><DayWorking>0</DayWorking></WeekDay>` : `<WeekDay><DayType>${d}</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>16:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>`;
  const cal = `<Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID><WeekDays>${[1, 2, 3, 4, 5, 6, 7].map(dayW).join("")}</WeekDays></Calendar></Calendars>`;
  const hdr = `<Name>${ppxEsc(project)}</Name><Title>${ppxEsc(project)}</Title><Company></Company><Author></Author><ScheduleFromStart>1</ScheduleFromStart>${rootR.s ? `<StartDate>${iso(rootR.s)}</StartDate><FinishDate>${iso(rootR.e, true)}</FinishDate>` : ""}<FYStartDate>1</FYStartDate><CurrencyDigits>0</CurrencyDigits><CurrencySymbol>kr</CurrencySymbol><CurrencySymbolPosition>0</CurrencySymbolPosition><CalendarUID>1</CalendarUID><MinutesPerDay>480</MinutesPerDay><MinutesPerWeek>2400</MinutesPerWeek><DaysPerMonth>21</DaysPerMonth><DurationFormat>7</DurationFormat><WorkFormat>2</WorkFormat><FiscalYearStart>1</FiscalYearStart><WeekStartDay>1</WeekStartDay><ProjectExternallyEdited>0</ProjectExternallyEdited><ActualsInSync>0</ActualsInSync>`;
  const resXml = resList.length ? `<Resources>${resList.map((n, i) => `<Resource><UID>${i + 1}</UID><ID>${i + 1}</ID><Name>${ppxEsc(n)}</Name><Type>1</Type><MaxUnits>1</MaxUnits><StandardRateFormat>2</StandardRateFormat><Cost>0</Cost><OvertimeRateFormat>2</OvertimeRateFormat><IsCostResource>0</IsCostResource><AccrueAt>3</AccrueAt><CalendarUID>1</CalendarUID><IsGeneric>0</IsGeneric></Resource>`).join("")}</Resources><Assignments>${assign.join("")}</Assignments>` : "<Resources/><Assignments/>";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">${hdr}${cal}<Tasks>${taskXml.join("")}</Tasks>${resXml}</Project>`;
  return { xml, tasks: list.length, links, droppedLinks, resources: resList.length, taskXml: taskXml.join(""), assignList, rootR, hdrName: project };
}

/* Beroenden: hur många "Väntar på" som pekar på aktiviteter inom exporten (följer med) respektive utanför (kan inte följa med). */
function ppxLinkStats(acts) {
  const ids = new Set(); acts.forEach(a => (a.members || [a]).forEach(m => ids.add(String(m.id))));
  let inside = 0, outside = 0;
  acts.forEach(a => { const seen = new Set(); (a.members || [a]).forEach(m => (m.dependsOn || []).forEach(d => { d = String(d); if (own(a, d)) return; if (ids.has(d)) { if (!seen.has("i" + d)) { seen.add("i" + d); inside++; } } else if (!seen.has("o" + d)) { seen.add("o" + d); outside++; } })); });
  function own(a, d) { return (a.members || [a]).some(m => String(m.id) === d); }
  return { inside, outside };
}
/* Tar med aktiviteterna som de valda väntar på (så att kopplingarna kan följa med). Transitivt, högst 3 led. */
function ppxWithPredecessors(acts, all) {
  const byId = new Map(); all.forEach(a => (a.members || [a]).forEach(m => byId.set(String(m.id), a)));
  const set = new Set(acts); let frontier = [...acts];
  for (let lvl = 0; lvl < 3 && frontier.length; lvl++) {
    const next = [];
    frontier.forEach(a => (a.members || [a]).forEach(m => (m.dependsOn || []).forEach(d => { const p = byId.get(String(d)); if (p && !set.has(p) && p.startDate) { set.add(p); next.push(p); } })));
    frontier = next;
  }
  return [...set];
}

/* Dialogen: vilka aktiviteter som ska med. */
function openPpExportDialog() {
  const merged = mergeActivityGroups(items.filter(x => x.startDate));
  const own = merged.filter(a => (a.members || [a]).every(m => m.origin === "manuell"));
  const marked = typeof ganttMultiItems === "function" && ganttMultiSel.size ? mergeActivityGroups(ganttMultiMembers().filter(x => x.startDate)) : [];
  const shown = mergeActivityGroups(ganttShownItems.filter(x => x.startDate));
  const opts = [["own", `Egna aktiviteter (skapade här)`, own], ["marked", `Markerade i schemat`, marked], ["shown", `Alla som visas i schemat`, shown], ["all", `Alla aktiviteter`, merged]];
  const first = (own.length ? "own" : marked.length ? "marked" : "shown");
  const pop = document.createElement("div");
  pop.className = "board-pop new-act-pop ppx-pop";
  pop.innerHTML = `<div class="board-pop-title">⇪ Exportera till Powerproject</div>
    <div class="hint">Skapar en Microsoft Project-XML-fil. Importera den i Powerproject: <b>Importera från Microsoft Project® (XML)</b>. Din Powerproject-fil ändras inte.</div>
    <div class="ppx-opts">${opts.map(([k, l, a]) => `<label class="ppx-opt${a.length ? "" : " off"}"><input type="radio" name="ppxScope" value="${k}"${k === first && a.length ? " checked" : ""}${a.length ? "" : " disabled"} /> ${l} <span class="hint">${a.length} st</span></label>`).join("")}</div>
    <div class="ppx-tpl"><b>Mall från Powerproject</b> <span class="hint" id="ppxTplState"></span><br><input type="file" id="ppxTplFile" accept=".xml" /> <button type="button" class="link-btn" id="ppxTplClear">Ta bort mall</button>
      <div class="hint">Exportera en liten tidplan från Powerproject (<i>Exportera till Microsoft Project® XML</i>) och välj den här. Filen byggs då på den, vilket Powerproject godtar. Sparas i din webbläsare.</div></div>
    <label class="na-temp"><input type="checkbox" id="ppxRes" /> <span>Med resurser (skapar nya resurser i Powerproject om namnen inte finns)</span></label>
    <label class="na-temp"><input type="checkbox" id="ppxPreds" /> <span>Ta med aktiviteterna de väntar på (så att kopplingarna följer med)</span></label>
    <div class="hint" id="ppxLinks"></div>
    <div class="hint" id="ppxNote"></div>
    <div class="board-pop-actions"><button type="button" class="ppx-cancel">Avbryt</button><button type="button" class="ppx-go primary">Exportera</button></div>`;
  overlayHost().appendChild(pop);
  pop.style.left = `${Math.max(8, (window.innerWidth - pop.offsetWidth) / 2)}px`; pop.style.top = `${Math.max(8, Math.min(120, (window.innerHeight - pop.offsetHeight) / 2))}px`;
  const close = () => pop.remove();
  const scopeActs = () => {
    const scope = (pop.querySelector('input[name="ppxScope"]:checked') || {}).value;
    const acts = (opts.find(o => o[0] === scope) || [])[2] || [];
    return pop.querySelector("#ppxPreds").checked ? ppxWithPredecessors(acts, merged) : acts;
  };
  const stats = () => {
    const a = scopeActs(), st = ppxLinkStats(a);
    pop.querySelector("#ppxLinks").textContent = a.length ? `${a.length} aktiviteter · beroenden som följer med: ${st.inside}${st.outside ? ` · pekar utanför exporten: ${st.outside} (kryssa i rutan ovan för att ta med dem)` : ""}` : "";
  };
  pop.addEventListener("change", stats); stats();
  const tplKey = "4ddash-pp-template";
  const tplGet = () => { try { return JSON.parse(localStorage.getItem(tplKey) || "null"); } catch (e) { return null; } };
  const tplShow = () => { const t = tplGet(); pop.querySelector("#ppxTplState").textContent = t ? `✓ ${t.name}` : "(ingen vald – enklare fil)"; };
  tplShow();
  pop.querySelector("#ppxTplFile").onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const txt = await f.text();
    if (!ppxTemplateInfo(txt)) { pop.querySelector("#ppxNote").textContent = "Det där är ingen Microsoft Project-XML med uppgifter – exportera från Powerproject och försök igen."; return; }
    try { localStorage.setItem(tplKey, JSON.stringify({ name: f.name, xml: txt })); } catch (x) { pop.querySelector("#ppxNote").textContent = "Mallen är för stor för att sparas i webbläsaren – den används bara den här gången."; window.__ppxTplTmp = { name: f.name, xml: txt }; }
    tplShow();
  };
  pop.querySelector("#ppxTplClear").onclick = () => { try { localStorage.removeItem(tplKey); } catch (e) {} window.__ppxTplTmp = null; tplShow(); };
  pop.querySelector(".ppx-cancel").onclick = close;
  pop.querySelector(".ppx-go").onclick = () => {
    const acts = scopeActs();
    if (!acts.length) { pop.querySelector("#ppxNote").textContent = "Inget att exportera i det valet."; return; }
    const tpl = tplGet() || window.__ppxTplTmp, ro = { project: `4D – ${todayISO()}`, resources: pop.querySelector("#ppxRes").checked };
    const r = (tpl && buildMspXmlFromTemplate(acts, tpl.xml, ro)) || buildMspXml(acts, ro);
    const blob = new Blob([r.xml], { type: "application/xml;charset=utf-8" }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `4D-aktiviteter ${todayISO()}.xml`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    close();
    modelToast(`${r.tasks} aktiviteter exporterade${r.fromTemplate ? " (på din mall)" : " (utan mall)"}${r.skippedResources ? `, ${r.skippedResources} resurser saknas i mallen och hoppades över` : ""}${r.links ? `, ${r.links} kopplingar` : ""}${r.droppedLinks ? ` – ${r.droppedLinks} kopplingar till aktiviteter utanför exporten utelämnades` : ""}`);
  };
}


/* Mall från Powerproject (Victor 2026-10-13): Powerprojects inläsning godtog inte en egenbyggd fil men godtog en fil som
   Powerproject själv exporterat. Därför byggs filen på en sådan: allt utom uppgifterna (rubrik, kalendrar, egna fält, resurser)
   tas från mallen, och uppgifterna skrivs med samma extra fält som mallens egna uppgifter. Resurser kopplas på namn. */
function ppxTemplateInfo(tplXml) {
  const d = new DOMParser().parseFromString(tplXml, "application/xml");
  if (d.getElementsByTagName("parsererror").length || !d.getElementsByTagName("Tasks").length) return null;
  const ser = new XMLSerializer(), strip = x => x.replace(/ xmlns="[^"]*"/g, "");
  const tasks = [...d.getElementsByTagName("Task")];
  const extOf = t => t ? [...t.children].filter(c => c.tagName === "ExtendedAttribute").map(c => strip(ser.serializeToString(c)).replace(/<(\w+)\/>/g, "<$1></$1>")).join("") : "";
  const leaf = tasks.find(t => (t.getElementsByTagName("Summary")[0] || {}).textContent === "0"), sum = tasks.find(t => (t.getElementsByTagName("Summary")[0] || {}).textContent === "1");
  const res = new Map(); [...d.getElementsByTagName("Resource")].forEach(r => { const n = r.getElementsByTagName("Name")[0], u = r.getElementsByTagName("UID")[0]; if (n && u) res.set(n.textContent, u.textContent); });
  return { extLeaf: extOf(leaf || sum), extSummary: extOf(sum || leaf), resources: res };
}
function buildMspXmlFromTemplate(acts, tplXml, opts = {}) {
  const info = ppxTemplateInfo(tplXml);
  if (!info) return null;
  const r = buildMspXml(acts, { ...opts, extLeaf: info.extLeaf, extSummary: info.extSummary });
  const i0 = tplXml.indexOf("<Tasks>"), i1 = tplXml.indexOf("</Tasks>") + 8;
  if (i0 < 0 || i1 < 8) return null;
  let xml = tplXml.slice(0, i0) + `<Tasks>${r.taskXml}</Tasks>` + tplXml.slice(i1);
  // Uppgifternas datum och namn i rubriken.
  const iso = (d, end) => `${d}T${end ? "16:00:00" : "08:00:00"}`;
  if (r.rootR.s) {
    xml = xml.replace(/<StartDate>[^<]*<\/StartDate>/, `<StartDate>${iso(r.rootR.s)}</StartDate>`).replace(/<FinishDate>[^<]*<\/FinishDate>/, `<FinishDate>${iso(r.rootR.e, true)}</FinishDate>`);
  }
  // Tilldelningar: resurser som finns i mallen (på namn).
  let skipped = 0, n = 0; const ass = [];
  (opts.resources === false ? [] : r.assignList).forEach(a => {
    const ru = info.resources.get(a.res);
    if (ru === undefined) { skipped++; return; }
    ass.push(`<Assignment><UID>${++n}</UID><TaskUID>${a.task}</TaskUID><ResourceUID>${ru}</ResourceUID><Units>${a.units}</Units><Work>${ppxHours(a.hours)}</Work></Assignment>`);
  });
  xml = xml.replace(/<Assignments\/>|<Assignments>[\s\S]*?<\/Assignments>/, ass.length ? `<Assignments>${ass.join("")}</Assignments>` : "<Assignments/>");
  return { ...r, xml, skippedResources: skipped, assigned: ass.length, fromTemplate: true };
}
