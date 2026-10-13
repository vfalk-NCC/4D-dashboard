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

const ppxUid = () => "00000000-0000-4000-8000-" + String(Date.now()).padStart(12, "0").slice(-12);
/* En uppgift med alla fält i samma ordning som Microsoft Project själv skriver dem (MSPDI), så att strikta läsare accepterar filen. */
function ppxTask(t) {
  const now = new Date().toISOString().slice(0, 19), st = t.start || now, fi = t.finish || now;
  return `<Task><UID>${t.uid}</UID><ID>${t.uid}</ID><Name>${ppxEsc(t.name)}</Name><Active>1</Active><Manual>0</Manual><Type>0</Type><IsNull>0</IsNull><CreateDate>${now}</CreateDate><WBS>${t.num}</WBS><OutlineNumber>${t.num}</OutlineNumber><OutlineLevel>${t.level}</OutlineLevel><Priority>500</Priority><Start>${st}</Start><Finish>${fi}</Finish><Duration>${t.dur}</Duration><DurationFormat>7</DurationFormat><Work>PT0H0M0S</Work><ResumeValid>0</ResumeValid><EffortDriven>0</EffortDriven><Recurring>0</Recurring><OverAllocated>0</OverAllocated><Estimated>0</Estimated><Milestone>${t.milestone}</Milestone><Summary>${t.summary}</Summary><DisplayAsSummary>0</DisplayAsSummary><Critical>0</Critical><IsSubproject>0</IsSubproject><IsSubprojectReadOnly>0</IsSubprojectReadOnly><ExternalTask>0</ExternalTask><EarlyStart>${st}</EarlyStart><EarlyFinish>${fi}</EarlyFinish><LateStart>${st}</LateStart><LateFinish>${fi}</LateFinish><StartVariance>0</StartVariance><FinishVariance>0</FinishVariance><WorkVariance>0</WorkVariance><FreeSlack>0</FreeSlack><TotalSlack>0</TotalSlack><FixedCost>0</FixedCost><FixedCostAccrual>3</FixedCostAccrual><PercentComplete>${t.pct}</PercentComplete><PercentWorkComplete>0</PercentWorkComplete><Cost>0</Cost><OvertimeCost>0</OvertimeCost><OvertimeWork>PT0H0M0S</OvertimeWork><ActualDuration>PT0H0M0S</ActualDuration><ActualCost>0</ActualCost><ActualOvertimeCost>0</ActualOvertimeCost><ActualWork>PT0H0M0S</ActualWork><RegularWork>PT0H0M0S</RegularWork><RemainingDuration>${t.dur}</RemainingDuration><RemainingCost>0</RemainingCost><RemainingWork>PT0H0M0S</RemainingWork><RemainingOvertimeCost>0</RemainingOvertimeCost><RemainingOvertimeWork>PT0H0M0S</RemainingOvertimeWork><ACWP>0</ACWP><CV>0</CV><ConstraintType>0</ConstraintType><CalendarUID>-1</CalendarUID><LevelAssignments>1</LevelAssignments><LevelingCanSplit>1</LevelingCanSplit><LevelingDelay>0</LevelingDelay><LevelingDelayFormat>8</LevelingDelayFormat><IgnoreResourceCalendar>0</IgnoreResourceCalendar><HideBar>0</HideBar><Rollup>0</Rollup><BCWS>0</BCWS><BCWP>0</BCWP><PhysicalPercentComplete>0</PhysicalPercentComplete><EarnedValueMethod>0</EarnedValueMethod>${t.preds}<ActualWorkProtected>PT0H0M0S</ActualWorkProtected><ActualOvertimeWorkProtected>PT0H0M0S</ActualOvertimeWorkProtected></Task>`;
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
  const iso = (d, end) => `${d}T${end ? "17:00:00" : "08:00:00"}`;
  let links = 0, droppedLinks = 0;
  const taskXml = [];
  order.forEach(o => {
    if (o.node) {
      const n = o.node;
      const r = range(n);
      const days = r.s ? ppxWorkdays(r.s, r.e) : 1;
      taskXml.push(ppxTask({ uid: n.uid, name: n.name, level: n.level, num: n.level === 0 ? "0" : n.num, start: r.s ? iso(r.s) : null, finish: r.s ? iso(r.e, true) : null, dur: r.s ? ppxDur(days) : "PT0H0M0S", summary: 1, milestone: 0, pct: 0, preds: "" }));
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
      assign.push(`<Assignment><UID>${assign.length + 1}</UID><TaskUID>${uidOfAct.get(a)}</TaskUID><ResourceUID>${resUid.get(r.name)}</ResourceUID><Finish>${iso(a.endDate || a.startDate, true)}</Finish><Start>${iso(a.startDate)}</Start><Units>${Number(r.qty) || 1}</Units><Work>${ppxHours(r.hours)}</Work></Assignment>`);
    });
  });
  const rootR = range(root), now = new Date().toISOString().slice(0, 19);
  const cal = `<Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>${[1, 2, 3, 4, 5, 6, 7].map(d => d === 1 || d === 7 ? `<WeekDay><DayType>${d}</DayType><DayWorking>0</DayWorking></WeekDay>` : `<WeekDay><DayType>${d}</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>`).join("")}</WeekDays></Calendar></Calendars>`;
  const hdr = `<SaveVersion>14</SaveVersion><BuildNumber>14.0.4760.1000</BuildNumber><UID>${ppxUid()}</UID><Name>${ppxEsc(project)}</Name><Title>${ppxEsc(project)}</Title><CreationDate>${now}</CreationDate><LastSaved>${now}</LastSaved><ScheduleFromStart>1</ScheduleFromStart>${rootR.s ? `<StartDate>${iso(rootR.s)}</StartDate><FinishDate>${iso(rootR.e, true)}</FinishDate>` : ""}<FYStartDate>1</FYStartDate><CriticalSlackLimit>0</CriticalSlackLimit><CurrencyDigits>2</CurrencyDigits><CurrencySymbol>kr</CurrencySymbol><CurrencySymbolPosition>1</CurrencySymbolPosition><CalendarUID>1</CalendarUID><DefaultStartTime>08:00:00</DefaultStartTime><DefaultFinishTime>17:00:00</DefaultFinishTime><MinutesPerDay>480</MinutesPerDay><MinutesPerWeek>2400</MinutesPerWeek><DaysPerMonth>20</DaysPerMonth><DefaultTaskType>0</DefaultTaskType><DefaultFixedCostAccrual>3</DefaultFixedCostAccrual><DefaultStandardRate>0</DefaultStandardRate><DefaultOvertimeRate>0</DefaultOvertimeRate><DurationFormat>7</DurationFormat><WorkFormat>2</WorkFormat><EditableActualCosts>0</EditableActualCosts><HonorConstraints>0</HonorConstraints><EarnedValueMethod>0</EarnedValueMethod><InsertedProjectsLikeSummary>0</InsertedProjectsLikeSummary><MultipleCriticalPaths>0</MultipleCriticalPaths><NewTasksEffortDriven>0</NewTasksEffortDriven><NewTasksEstimated>0</NewTasksEstimated><SplitsInProgressTasks>1</SplitsInProgressTasks><SpreadActualCost>0</SpreadActualCost><SpreadPercentComplete>0</SpreadPercentComplete><TaskUpdatesResource>1</TaskUpdatesResource><FiscalYearStart>0</FiscalYearStart><WeekStartDay>1</WeekStartDay><MoveCompletedEndsBack>0</MoveCompletedEndsBack><MoveRemainingStartsBack>0</MoveRemainingStartsBack><MoveRemainingStartsForward>0</MoveRemainingStartsForward><MoveCompletedEndsForward>0</MoveCompletedEndsForward><BaselineForEarnedValue>0</BaselineForEarnedValue><AutoAddNewResourcesAndTasks>1</AutoAddNewResourcesAndTasks><CurrentDate>${now}</CurrentDate><MicrosoftProjectServerURL>1</MicrosoftProjectServerURL><Autolink>0</Autolink><NewTaskStartDate>0</NewTaskStartDate><DefaultTaskEVMethod>0</DefaultTaskEVMethod><ProjectExternallyEdited>0</ProjectExternallyEdited><ActualsInSync>0</ActualsInSync><RemoveFileProperties>0</RemoveFileProperties><AdminProject>0</AdminProject>`;
  const resXml = resList.length ? `<Resources><Resource><UID>0</UID><ID>0</ID><Type>1</Type><IsNull>0</IsNull></Resource>${resList.map((n, i) => `<Resource><UID>${i + 1}</UID><ID>${i + 1}</ID><Name>${ppxEsc(n)}</Name><Type>1</Type><IsNull>0</IsNull><MaxUnits>1</MaxUnits></Resource>`).join("")}</Resources><Assignments>${assign.join("")}</Assignments>` : "<Resources/>";
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
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
    <label class="na-temp"><input type="checkbox" id="ppxRes" checked /> <span>Med resurser (antal och timmar)</span></label>
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
