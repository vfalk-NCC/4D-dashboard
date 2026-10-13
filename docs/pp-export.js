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
  return `<Task><UID>${t.uid}</UID><ID>${t.uid}</ID><Name>${ppxEsc(t.name)}</Name><Type>0</Type><IsNull>0</IsNull><WBS>${t.num}</WBS><OutlineNumber>${t.num}</OutlineNumber><OutlineLevel>${t.level}</OutlineLevel><Start>${t.start}</Start><Finish>${t.finish}</Finish><ManualStart>${t.start}</ManualStart><ManualFinish>${t.finish}</ManualFinish><Duration>${t.dur}</Duration><ManualDuration>${t.dur}</ManualDuration><DurationFormat>7</DurationFormat><Milestone>${t.milestone}</Milestone><Summary>${t.summary}</Summary><Critical>0</Critical><FixedCost>0</FixedCost><FixedCostAccrual>3</FixedCostAccrual><PercentComplete>${t.pct}</PercentComplete><ConstraintType>4</ConstraintType><CalendarUID>1</CalendarUID><ConstraintDate>${t.start}</ConstraintDate>${t.preds}</Task>`;
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
      taskXml.push(ppxTask({ uid: n.uid, name: n.name, level: n.level, num: n.level === 0 ? "0" : n.num, start: iso(r.s || rootR0), finish: iso(r.e || rootR0, true), dur: ppxDur(days), summary: 1, milestone: 0, pct: 0, preds: "" }));
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
      taskXml.push(ppxTask({ uid: o.uid, name: a.objectName || a.activity || "Aktivitet", level: o.level, num, start: iso(a.startDate), finish: iso(end, true), dur: ppxDur(days), summary: 0, milestone: milestone ? 1 : 0, pct: Math.max(0, Math.min(100, Math.round(Number(a.progress) || 0))), preds: pl }));
    }
  });
  // Resurser och tilldelningar.
  const resList = [], resUid = new Map(), assign = [];
  if (opts.resources !== false) list.forEach(a => {
    const rs = (a.members || [a]).map(m => m.resources).find(r => Array.isArray(r) && r.length) || [];
    rs.forEach(r => {
      if (!r || !r.name) return;
      if (!resUid.has(r.name)) { resUid.set(r.name, resList.length + 1); resList.push(r.name); }
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
  return { xml, tasks: list.length, links, droppedLinks, resources: resList.length };
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
    <label class="na-temp"><input type="checkbox" id="ppxRes" /> <span>Med resurser (skapar nya resurser i Powerproject om namnen inte finns)</span></label>
    <div class="hint" id="ppxNote"></div>
    <div class="board-pop-actions"><button type="button" class="ppx-cancel">Avbryt</button><button type="button" class="ppx-go primary">Exportera</button></div>`;
  overlayHost().appendChild(pop);
  pop.style.left = `${Math.max(8, (window.innerWidth - pop.offsetWidth) / 2)}px`; pop.style.top = `${Math.max(8, Math.min(120, (window.innerHeight - pop.offsetHeight) / 2))}px`;
  const close = () => pop.remove();
  pop.querySelector(".ppx-cancel").onclick = close;
  pop.querySelector(".ppx-go").onclick = () => {
    const scope = (pop.querySelector('input[name="ppxScope"]:checked') || {}).value;
    const acts = (opts.find(o => o[0] === scope) || [])[2] || [];
    if (!acts.length) { pop.querySelector("#ppxNote").textContent = "Inget att exportera i det valet."; return; }
    const r = buildMspXml(acts, { project: `4D – ${todayISO()}`, resources: pop.querySelector("#ppxRes").checked });
    const blob = new Blob([r.xml], { type: "application/xml;charset=utf-8" }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `4D-aktiviteter ${todayISO()}.xml`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    close();
    modelToast(`${r.tasks} aktiviteter exporterade${r.links ? `, ${r.links} kopplingar` : ""}${r.droppedLinks ? ` – ${r.droppedLinks} kopplingar till aktiviteter utanför exporten utelämnades` : ""}`);
  };
}
