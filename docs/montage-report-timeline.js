/* Alternativ HTML-rapport för montageordning: tidslinje med datum (Victor 2026-10-21) – inte monteringsanvisning. En enda fristående fil:
   dra i tidslinjen (eller spela upp) och se vad som är klart, pågår och kommer, med datum, framdrift i procent per steg, aktuellt steg
   med anteckning och bild, ganttvy, stegtabell med sök och filter. Skrivs ut, delas som länk till ett steg och exporteras som CSV. */
function msTimelineRuntime(D) {
  const $ = (q, r) => (r || document).querySelector(q), $$ = (q, r) => [...(r || document).querySelectorAll(q)];
  const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const add = (s, k) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
  const diff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
  const sd = d => new Date(d + "T00:00:00Z").toLocaleDateString("sv-SE", { day: "numeric", month: "short", timeZone: "UTC" });
  const fd = d => new Date(d + "T00:00:00Z").toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const S = D.steps, N = S.length, days = x => diff(x.s, x.e) + 1;
  let mn = S[0].s, mx = S[0].e; S.forEach(x => { if (x.s < mn) mn = x.s; if (x.e > mx) mx = x.e; });
  const span = diff(mn, mx) + 1, today = new Date().toISOString().slice(0, 10), hue = p => { const i = D.parts.indexOf(p); return i < 0 ? 212 : (212 + i * 47) % 360; };
  const st = { d: mn, play: false, speed: 1, filter: "all", q: "", sel: -1, timer: null }, ph = (x, d) => (x.e < d ? "done" : x.s > d ? "todo" : "act");
  const pct = (x, d) => (x.e < d ? 100 : x.s > d ? 0 : Math.round((diff(x.s, d) + 1) / days(x) * 100));
  document.title = D.title + " – tidslinje";
  const LB = { done: "Klar", act: "Pågår", todo: "Kommande" };
  document.body.innerHTML = `<header class="hd"><div class="hd-in"><div class="brand">${D.logo ? `<span class="logo"><img src="${D.logo}" alt="${esc(D.company)}"></span>` : ""}<div><div class="eb">${D.company ? esc(D.company) + " · " : ""}Montageordning${D.area ? " · " + esc(D.area) : ""}</div><h1>${esc(D.title)}</h1></div></div>
    ${D.desc ? `<p class="ds">${esc(D.desc)}</p>` : ""}<div class="rg">${sd(mn)} – ${sd(mx)} ${mx.slice(0, 4)}</div></div></header>
  <main><section class="card"><div class="bar"><button id="pl" class="btn pri">▶ Spela upp</button><button id="bk" class="btn" title="Föregående stegstart (←)">⏮</button><button id="fw" class="btn" title="Nästa stegstart (→)">⏭</button>
    <select id="sp" aria-label="Hastighet"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select><button id="td" class="btn" title="Hoppa till idag">Idag</button><span class="grow"></span><button id="dk" class="btn" title="Mörkt läge (d)">◐</button><button id="pr" class="btn" title="Skriv ut (p)">⎙</button><button id="cp" class="btn" title="Kopiera länk">🔗</button><button id="cv" class="btn">CSV</button></div>
    <div class="now"><div class="big" id="dt"></div><div class="mu" id="ct"></div></div><div class="prog"><i id="pg"></i></div>
    <div class="tl" id="tl" role="slider" aria-label="Datum – dra för att visa framdriften" tabindex="0"><div class="tl-t" id="tt"></div><i class="tl-ph" id="tp"><b id="tpl"></b></i></div>
    <div class="grid2"><div class="lw">${D.has3d ? `<div class="vt"><button class="chip on" data-v="3d">3D-modell</button><button class="chip" data-v="g">Gantt</button><span class="mu v3n">Förenklad modell: omslutande lådor</span></div>` : ""}${D.has3d ? `<div class="v3w" id="v3w"><canvas id="cv3"></canvas><div class="v3ui"><button class="btn" id="v3h" title="Återställ vyn">⌂</button><label class="v3c"><input type="checkbox" id="v3f" checked> Följ steg</label><label class="v3c"><input type="checkbox" id="v3q" checked> Kommande svagt</label><label class="v3c"><input type="checkbox" id="v3e" checked> Kanter</label><button class="btn" id="v3s" title="Spara bild">📷</button></div><div class="v3msg" id="v3m" hidden></div></div>` : ""}<div class="gwrap" id="gw"${D.has3d ? " hidden" : ""}><svg id="g"></svg></div></div><aside class="cur" id="cur"></aside></div></section>
  <section class="card"><h2>Alla steg</h2><div class="bar"><div class="chips" id="fl">${[["all", "Alla"], ["act", "Pågår"], ["todo", "Kommande"], ["done", "Klara"]].map(([k, t]) => `<button class="chip${k === "all" ? " on" : ""}" data-f="${k}">${t}</button>`).join("")}</div><input id="q" placeholder="Sök steg …" aria-label="Sök"></div><div class="tw"><table id="tb"></table></div></section></main>
  <footer>${D.company ? esc(D.company) + " · " : ""}Skapad ${esc(D.generated)} · 4D-dashboard</footer><div id="tip" class="tip"></div><div id="lb" class="lb" hidden><img alt=""></div>`;
  // tidslinjen (dragbar)
  const tl = $("#tl"), X = d => diff(mn, d) / Math.max(1, span - 1) * 100; let ticks = "";
  for (let w = add(mn, -((new Date(mn + "T00:00:00Z").getUTCDay() + 6) % 7)); w <= mx; w = add(w, 7)) if (w >= mn) ticks += `<i class="wk" style="left:${X(w)}%"><u>${sd(w)}</u></i>`;
  S.forEach((x, i) => { ticks += `<i class="sm" style="left:${X(x.s)}%" data-i="${i}" title="${esc(x.n)} – start ${x.s}"></i>`; });
  if (today >= mn && today <= mx) ticks += `<i class="tdm" style="left:${X(today)}%" title="Idag"></i>`;
  $("#tt").innerHTML = ticks;
  // gantt
  const LW = 210, RH = 24, W = 1000, PX = (W - LW - 10) / span, GX = d => LW + diff(mn, d) * PX, rows = []; let last = null;
  S.forEach((x, i) => { if (x.p && x.p !== last) { rows.push({ h: x.p }); last = x.p; } rows.push({ i }); });
  const ry = new Map(); rows.forEach((r, k) => { if (r.i !== undefined) ry.set(r.i, k); }); const H = rows.length * RH + 28; let g = "";
  for (let w = mn; w <= mx; w = add(w, 7)) g += `<line x1="${GX(w)}" x2="${GX(w)}" y1="20" y2="${H}" class="gl"/><text x="${GX(w) + 3}" y="13" class="gt">${sd(w)}</text>`;
  rows.forEach((r, k) => { const y = 24 + k * RH; if (r.h) g += `<rect x="0" y="${y}" width="${W}" height="${RH}" class="gh" style="--h:${hue(r.h)}"/><text x="8" y="${y + 16}" class="ghl">${esc(r.h)}</text>`; else { const x = S[r.i]; g += `<g class="row" data-i="${r.i}"><rect x="0" y="${y}" width="${W}" height="${RH}" class="rb"/><text x="8" y="${y + 16}" class="rl">${r.i + 1}. ${esc(x.n.length > 32 ? x.n.slice(0, 31) + "…" : x.n)}</text><rect x="${GX(x.s)}" y="${y + 6}" width="${Math.max(4, days(x) * PX)}" height="${RH - 12}" rx="4" class="bt"/><rect class="pgb" data-b="${r.i}" x="${GX(x.s)}" y="${y + 6}" width="0" height="${RH - 12}" rx="4"/></g>`; } });
  S.forEach((x, i) => x.deps.forEach(d => { const y1 = 24 + ry.get(d) * RH + RH / 2, y2 = 24 + ry.get(i) * RH + RH / 2, x1 = GX(S[d].e) + PX, x2 = GX(x.s); g += `<path d="M${x1} ${y1}H${Math.max(x1 + 3, Math.min(x2 - 3, x1 + 5))}V${y2}H${x2}" class="ar"/>`; }));
  const svg = $("#g"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.innerHTML = g + `<line id="ph" y1="20" y2="${H}" class="ph"/>`;
  const bars = $$("[data-b]", svg), phl = $("#ph");
  const tb = $("#tb");
  const drawTable = () => {
    const q = st.q.toLowerCase(), list = S.map((x, i) => [x, i]).filter(([x]) => (st.filter === "all" || ph(x, st.d) === st.filter) && (!q || (x.n + " " + x.p + " " + x.note).toLowerCase().includes(q)));
    tb.innerHTML = `<tr><th>#</th><th>Steg</th><th>Start</th><th>Slut</th><th>Dagar</th><th>Läge ${esc(sd(st.d))}</th></tr>` + list.map(([x, i]) => `<tr class="tr${st.sel === i ? " sel" : ""}" data-r="${i}"><td>${i + 1}</td><td><b>${esc(x.n)}</b>${x.p ? `<small>${esc(x.p)}</small>` : ""}${x.h || x.q ? `<small class="adv">${x.h ? "⏱ " + x.h + " h" : ""}${x.h && x.q ? " · " : ""}${x.q ? x.q + " " + esc(x.u) : ""}</small>` : ""}</td><td>${x.s}</td><td>${x.e}</td><td>${days(x)}</td><td><span class="bd ${ph(x, st.d)}">${LB[ph(x, st.d)]}${ph(x, st.d) === "act" ? " " + pct(x, st.d) + " %" : ""}</span></td></tr>${st.sel === i ? `<tr class="dt"><td></td><td colspan="5">${x.note ? `<p>${esc(x.note)}</p>` : `<p class="mu">Ingen anteckning.</p>`}${x.img ? `<img src="${x.img}" alt="">` : ""}</td></tr>` : ""}`).join("") || `<tr><td colspan="6" class="mu">Inga steg matchar.</td></tr>`;
  };
  const curIdx = d => { let b = -1; S.forEach((x, i) => { if (ph(x, d) === "act" && (b < 0 || x.s >= S[b].s)) b = i; }); if (b >= 0) return b; let b2 = -1; S.forEach((x, i) => { if (x.e < d && (b2 < 0 || x.e >= S[b2].e)) b2 = i; }); return b2 >= 0 ? b2 : (S.findIndex(x => x.s > d) >= 0 ? S.findIndex(x => x.s > d) : 0); };
  const drawCur = i => {
    const x = S[i], p = ph(x, st.d), pv = (() => { for (let k = i - 1; k >= 0; k--) if (S[k].img) return S[k]; return null; })(), act = S.map((y, k) => [y, k]).filter(([y]) => ph(y, st.d) === "act" && true);
    $("#cur").innerHTML = `<div class="cn">Steg ${i + 1} av ${N} · <span class="bd ${p}">${LB[p]}</span></div><h3>${esc(x.n)}</h3>${x.p ? `<div class="mu">${esc(x.p)}</div>` : ""}<div class="dts">${x.s} → ${x.e} · ${days(x)} ${days(x) === 1 ? "dag" : "dagar"}</div>
      <div class="sp"><i style="width:${pct(x, st.d)}%"></i></div><div class="mu sm2">${pct(x, st.d)} % av stegets tid har gått</div>${x.note ? `<p class="note">${esc(x.note)}</p>` : ""}
      ${x.deps.length ? `<div class="mu">Väntar på: ${x.deps.map(d => `<a href="#steg=${d + 1}" data-go="${d}">${d + 1}. ${esc(S[d].n)}</a>`).join(", ")}</div>` : ""}
      ${act.length > 1 ? `<div class="now2"><b>Pågår samtidigt</b>${act.filter(([, k]) => k !== i).map(([y, k]) => `<a href="#steg=${k + 1}" data-go="${k}">${k + 1}. ${esc(y.n)}</a>`).join("")}</div>` : ""}
      ${x.img ? `<div class="ba"><img class="b1" src="${pv ? pv.img : x.img}" alt=""><div class="b2w"><img src="${x.img}" alt=""></div>${pv ? `<input type="range" class="bs" min="0" max="100" value="100" aria-label="Före / efter"><span class="bl l">Före</span><span class="bl r">Efter</span>` : ""}</div>` : ""}`;
    const bs = $(".bs"); if (bs) { const w = $(".b2w"), u = () => { w.style.clipPath = `inset(0 ${100 - bs.value}% 0 0)`; }; bs.oninput = u; u(); }
    const im = $(".ba"); if (im) im.onclick = e => { if (e.target.classList.contains("bs")) return; $("#lb img").src = x.img; $("#lb").hidden = false; };
  };
  let shown = -2;
  const draw = () => {
    const d = st.d, done = S.filter(x => ph(x, d) === "done").length, act = S.filter(x => ph(x, d) === "act").length, totalDays = S.reduce((t, x) => t + days(x), 0), doneDays = S.reduce((t, x) => t + Math.round(days(x) * pct(x, d) / 100), 0);
    $("#dt").textContent = fd(d).replace(/^./, c => c.toUpperCase()); $("#ct").textContent = `Dag ${diff(mn, d) + 1} av ${span} · ${done} av ${N} steg klara · ${act} pågår · ${N - done - act} kommande`; $("#pg").style.width = Math.round(doneDays / Math.max(1, totalDays) * 100) + "%"; $("#pg").title = Math.round(doneDays / Math.max(1, totalDays) * 100) + " % av total tid";
    $("#tp").style.left = X(d) + "%"; $("#tpl").textContent = sd(d); tl.setAttribute("aria-valuetext", fd(d));
    phl.setAttribute("x1", GX(d) + PX / 2); phl.setAttribute("x2", GX(d) + PX / 2);
    bars.forEach(b => { const i = Number(b.dataset.b), x = S[i], p = ph(x, d); b.setAttribute("width", Math.max(0, days(x) * PX * pct(x, d) / 100)); b.setAttribute("class", `pgb ${p}${st.sel === i ? " sel" : ""}`); });
    if (v3) v3.update(); drawTable(); const c = st.sel >= 0 ? st.sel : curIdx(d); if (c !== shown) { shown = c; drawCur(c); } else if (c >= 0) { const sp = $(".sp i"); if (sp) sp.style.width = pct(S[c], d) + "%"; const m = $(".sm2"); if (m) m.textContent = pct(S[c], d) + " % av stegets tid har gått"; }
  };
  const setDate = d => { st.d = d < mn ? mn : d > mx ? mx : d; draw(); };
  const select = i => { st.sel = i; shown = -2; try { history.replaceState(null, "", "#steg=" + (i + 1)); } catch (e) { /* */ } draw(); };
  const play = on => { st.play = on; clearInterval(st.timer); $("#pl").textContent = on ? "⏸ Pausa" : "▶ Spela upp"; if (on) { if (st.d >= mx) st.d = mn; st.sel = -1; st.timer = setInterval(() => { if (st.d >= mx) { play(false); return; } setDate(add(st.d, 1)); }, 1000 / (5 * st.speed)); } };
  const step = k => { const starts = [...new Set(S.map(x => x.s))].sort(), t = k > 0 ? starts.find(s => s > st.d) : [...starts].reverse().find(s => s < st.d); st.sel = -1; setDate(t || (k > 0 ? mx : mn)); };
  // dra i tidslinjen
  const at = e => { const r = tl.getBoundingClientRect(); return add(mn, Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (span - 1))); };
  let dragging = false; tl.onpointerdown = e => { dragging = true; tl.setPointerCapture(e.pointerId); play(false); st.sel = -1; setDate(at(e)); };
  tl.onpointermove = e => { if (dragging) setDate(at(e)); }; tl.onpointerup = tl.onpointercancel = () => { dragging = false; };
  tl.onkeydown = e => { if (e.key === "ArrowRight") { e.preventDefault(); play(false); setDate(add(st.d, e.shiftKey ? 7 : 1)); } else if (e.key === "ArrowLeft") { e.preventDefault(); play(false); setDate(add(st.d, e.shiftKey ? -7 : -1)); } };
  $("#pl").onclick = () => play(!st.play); $("#fw").onclick = () => { play(false); step(1); }; $("#bk").onclick = () => { play(false); step(-1); }; $("#td").onclick = () => { play(false); st.sel = -1; setDate(today); };
  $("#sp").onchange = e => { st.speed = Number(e.target.value); if (st.play) play(true); };
  $("#dk").onclick = () => document.documentElement.classList.toggle("dark"); $("#pr").onclick = () => window.print();
  $("#cp").onclick = () => { const u = location.href.split("#")[0] + "#steg=" + ((st.sel >= 0 ? st.sel : curIdx(st.d)) + 1); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => { $("#cp").textContent = "✔"; setTimeout(() => { $("#cp").textContent = "🔗"; }, 1200); }, () => { prompt("Kopiera länken", u); }); };
  $("#cv").onclick = () => { const csv = "Nr;Steg;Del;Start;Slut;Dagar;Väntar på;Anteckning;Timmar;Mängd;Enhet\n" + S.map((x, i) => [i + 1, x.n, x.p, x.s, x.e, days(x), x.deps.map(d => d + 1).join(" "), x.note, x.h || "", x.q || "", x.u].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(";")).join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = "montageordning.csv"; a.click(); };
  $("#fl").onclick = e => { const b = e.target.closest("[data-f]"); if (!b) return; st.filter = b.dataset.f; $$(".chip").forEach(c => c.classList.toggle("on", c === b)); drawTable(); };
  $("#q").oninput = e => { st.q = e.target.value; drawTable(); };
  tb.onclick = e => { const r = e.target.closest("[data-r]"); if (r) { const i = Number(r.dataset.r); play(false); if (st.sel === i) { st.sel = -1; shown = -2; draw(); } else { setDate(S[i].s); select(i); } } };
  svg.onclick = e => { const r = e.target.closest("[data-i]"); if (r) { play(false); const i = Number(r.dataset.i); setDate(S[i].s); select(i); } };
  $("#tt").onclick = e => { const m = e.target.closest(".sm"); if (m) { e.stopPropagation(); play(false); const i = Number(m.dataset.i); setDate(S[i].s); select(i); } };
  document.addEventListener("click", e => { const a = e.target.closest("[data-go]"); if (a) { e.preventDefault(); play(false); const i = Number(a.dataset.go); setDate(S[i].s); select(i); } if (e.target.closest("#lb")) $("#lb").hidden = true; });
  document.addEventListener("keydown", e => { if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "range") return; if (e.target === tl) return; if (e.key === " ") { e.preventDefault(); play(!st.play); } else if (e.key === "ArrowRight") { e.preventDefault(); play(false); step(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); play(false); step(-1); } else if (e.key === "d") document.documentElement.classList.toggle("dark"); else if (e.key === "p") window.print(); else if (e.key === "Escape") $("#lb").hidden = true; });
  const tip = $("#tip"); document.addEventListener("mousemove", e => { const b = e.target.closest("[data-b]"); if (!b) { tip.style.display = "none"; return; } const x = S[b.dataset.b]; tip.innerHTML = `<b>${esc(x.n)}</b><br>${x.s} → ${x.e}<br>${LB[ph(x, st.d)]}${ph(x, st.d) === "act" ? " " + pct(x, st.d) + " %" : ""}`; tip.style.display = "block"; tip.style.left = Math.min(innerWidth - 260, e.clientX + 14) + "px"; tip.style.top = e.clientY + 16 + "px"; });

  // ---- 3D: förenklad modell (omslutande lådor) i WebGL, utan bibliotek ----------------------------------------------------------------------
  function init3d() {
    const cv = $("#cv3"), box = $("#v3w"), msg = $("#v3m"), gl = cv.getContext("webgl", { antialias: true, preserveDrawingBuffer: true }) || cv.getContext("experimental-webgl");
    if (!gl) { msg.hidden = false; msg.textContent = "Webbläsaren saknar WebGL – 3D-vyn kan inte visas. Gantt-fliken fungerar."; return null; }
    const boxes = []; S.forEach((x, i) => (x.bx || []).forEach((b, k) => boxes.push({ i, k, n: x.bx.length, b })));
    if (!boxes.length) { msg.hidden = false; msg.textContent = "Inga objekt med läge i modellen – 3D-vyn är tom."; return null; }
    const N = boxes.length, P = new Float32Array(N * 36 * 3), Nn = new Float32Array(N * 36 * 3), C = new Float32Array(N * 36 * 4), LP = new Float32Array(N * 24 * 3), LC = new Float32Array(N * 24 * 4);
    const faces = [[[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [[-1, 0, 0], [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]]], [[0, 1, 0], [[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]]], [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]], [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]], [[0, 0, -1], [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]]]];
    const edges = [[0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1], [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1], [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]];
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    boxes.forEach((o, bi) => {
      const b = o.b, d = [b[3] - b[0], b[4] - b[1], b[5] - b[2]]; for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], b[a]); hi[a] = Math.max(hi[a], b[a + 3]); }
      let t = bi * 36 * 3; faces.forEach(([nm, q]) => [0, 1, 2, 0, 2, 3].forEach(vi => { const v = q[vi]; for (let a = 0; a < 3; a++) { P[t + a] = b[a] + v[a] * d[a]; Nn[t + a] = nm[a]; } t += 3; }));
      let l = bi * 24 * 3; edges.forEach(e => { for (let a = 0; a < 3; a++) { LP[l + a] = b[a] + e[a] * d[a]; LP[l + 3 + a] = b[a] + e[a + 3] * d[a]; } l += 6; });
    });
    const ctr = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], rad = Math.max(1, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
    // rutnät i marknivå
    const G = [], gz = lo[2], gs = Math.max(1, Math.pow(10, Math.round(Math.log10(rad / 4)))), gx0 = Math.floor((lo[0] - rad) / gs) * gs, gy0 = Math.floor((lo[1] - rad) / gs) * gs, gx1 = hi[0] + rad, gy1 = hi[1] + rad;
    for (let x = gx0; x <= gx1; x += gs) G.push(x, gy0, gz, x, gy1, gz); for (let y = gy0; y <= gy1; y += gs) G.push(gx0, y, gz, gx1, y, gz);
    const mk = (t, src) => { const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; }, prog = (v, f) => { const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, v)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); return p; };
    const p1 = prog("attribute vec3 p;attribute vec3 n;attribute vec4 c;uniform mat4 m;varying vec3 vn;varying vec4 vc;void main(){gl_Position=m*vec4(p,1.);vn=n;vc=c;}", "precision mediump float;varying vec3 vn;varying vec4 vc;uniform float pass;void main(){if(vc.a<.01)discard;if(pass<.5&&vc.a<.99)discard;if(pass>.5&&vc.a>=.99)discard;float d=max(dot(normalize(vn),normalize(vec3(.45,-.55,.75))),0.);float l=.5+.5*d+.12*abs(vn.x);gl_FragColor=vec4(vc.rgb*l,vc.a);}");
    const p2 = prog("attribute vec3 p;attribute vec4 c;uniform mat4 m;varying vec4 vc;void main(){gl_Position=m*vec4(p,1.);vc=c;}", "precision mediump float;varying vec4 vc;void main(){if(vc.a<.01)discard;gl_FragColor=vc;}");
    const buf = (arr, dyn) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, dyn ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW); return b; };
    const bP = buf(P), bN = buf(Nn), bC = buf(C, 1), bLP = buf(LP), bLC = buf(LC, 1), bG = buf(new Float32Array(G)), gCol = new Float32Array(G.length / 3 * 4).fill(0.55);
    const bGC = buf(gCol), loc = (p, n) => gl.getAttribLocation(p, n), U = (p, n) => gl.getUniformLocation(p, n);
    const bind = (b, p, n, sz) => { const l = loc(p, n); if (l < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, sz, gl.FLOAT, false, 0, 0); };
    // matriser
    const mul = (a, b) => { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let t = 0; for (let k = 0; k < 4; k++) t += a[i + k * 4] * b[k + j * 4]; o[i + j * 4] = t; } return o; };
    const persp = (f, a, n, fa) => { const t = 1 / Math.tan(f / 2), nf = 1 / (n - fa); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0]; };
    const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const look = (e, c) => { const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross([0, 0, 1], z)), y = cross(z, x); return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]; };
    const home = () => ({ az: -0.9, el: 0.55, dist: rad * 2.3, t: ctr.slice() }); let cam = home(), want = null, dirty = true;
    const eye = () => [cam.t[0] + cam.dist * Math.cos(cam.el) * Math.cos(cam.az), cam.t[1] + cam.dist * Math.cos(cam.el) * Math.sin(cam.az), cam.t[2] + cam.dist * Math.sin(cam.el)];
    const dark = () => document.documentElement.classList.contains("dark");
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(10, Math.round(box.clientWidth * dpr)), h = Math.max(10, Math.round(box.clientHeight * dpr)); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h); const bg = dark() ? [0.05, 0.07, 0.12] : [0.93, 0.95, 0.98]; gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const M = mul(persp(0.8, w / h, Math.max(0.05, cam.dist / 200), cam.dist * 60), look(eye(), cam.t));
      gl.useProgram(p2); gl.uniformMatrix4fv(U(p2, "m"), false, M); bind(bG, p2, "p", 3); bind(bGC, p2, "c", 4); gl.drawArrays(gl.LINES, 0, G.length / 3);
      if (showEdges) { bind(bLP, p2, "p", 3); bind(bLC, p2, "c", 4); gl.drawArrays(gl.LINES, 0, N * 24); }
      gl.useProgram(p1); gl.uniformMatrix4fv(U(p1, "m"), false, M); bind(bP, p1, "p", 3); bind(bN, p1, "n", 3); bind(bC, p1, "c", 4);
      gl.depthMask(true); gl.uniform1f(U(p1, "pass"), 0); gl.drawArrays(gl.TRIANGLES, 0, N * 36); gl.depthMask(false); gl.uniform1f(U(p1, "pass"), 1); gl.drawArrays(gl.TRIANGLES, 0, N * 36); gl.depthMask(true);
    };
    let showEdges = true, follow = true, faint = true, raf = 0, lastFollow = -2;
    const frame = () => { raf = 0; if (want) { const k = 0.16; cam.t = cam.t.map((v, a) => v + (want.t[a] - v) * k); cam.dist += (want.dist - cam.dist) * k; if (Math.hypot(want.t[0] - cam.t[0], want.t[1] - cam.t[1], want.t[2] - cam.t[2]) < rad * 0.002 && Math.abs(want.dist - cam.dist) < rad * 0.002) want = null; dirty = true; } if (dirty) { dirty = false; draw(); } if (want) ask(); };
    const ask = () => { dirty = true; if (!raf) raf = requestAnimationFrame(frame); };
    const CL = { done: [0.55, 0.62, 0.7, 1], act: [0.96, 0.6, 0.05, 1], todo: [0.55, 0.75, 0.98, 0.14], edge: [0.12, 0.15, 0.2, 0.9] };
    const update = () => {
      const d = st.d, cur = st.sel >= 0 ? st.sel : curIdx(d);
      boxes.forEach((o, bi) => {
        const x = S[o.i], p = ph(x, d); let c = null;
        if (p === "done") c = CL.done; else if (p === "act") { const r = Math.max(1, Math.ceil(pct(x, d) / 100 * o.n)); c = o.k < r ? CL.act : (faint ? CL.todo : null); } else c = faint ? CL.todo : null;
        const sel = o.i === cur && c && c[3] > 0.5, col = c ? (sel && p !== "act" ? [0.35, 0.55, 0.95, 1] : c) : [0, 0, 0, 0];
        for (let v = 0; v < 36; v++) { C.set(col, (bi * 36 + v) * 4); } const ec = c ? (c[3] < 0.5 ? [0.3, 0.4, 0.6, 0.35] : CL.edge) : [0, 0, 0, 0]; for (let v = 0; v < 24; v++) LC.set(ec, (bi * 24 + v) * 4);
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, bC); gl.bufferSubData(gl.ARRAY_BUFFER, 0, C); gl.bindBuffer(gl.ARRAY_BUFFER, bLC); gl.bufferSubData(gl.ARRAY_BUFFER, 0, LC);
      if (follow && lastFollow === -2) lastFollow = cur; // första gången: visa hela modellen
      if (follow && cur !== lastFollow) { lastFollow = cur; const mine = boxes.filter(o => o.i === cur); if (mine.length) { const a = [1e9, 1e9, 1e9], b = [-1e9, -1e9, -1e9]; mine.forEach(o => { for (let q = 0; q < 3; q++) { a[q] = Math.min(a[q], o.b[q]); b[q] = Math.max(b[q], o.b[q + 3]); } }); want = { t: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], dist: Math.max(rad * 0.9, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 2.4 + rad * 0.5) }; } }
      ask();
    };
    // mus och touch: dra = rotera, höger/Skift = flytta, hjul/nyp = zooma
    const ptrs = new Map(); let last = null;
    cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey }); last = null; want = null; };
    cv.onpointermove = e => {
      const p = ptrs.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], dd = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; if (last) { cam.dist = Math.max(rad * 0.05, Math.min(rad * 20, cam.dist * last.d / Math.max(1, dd))); pan((mx - last.x) * 0.5, (my - last.y) * 0.5); } last = { d: dd, x: mx, y: my }; ask(); return; }
      if (p.b === 2 || p.sh) pan(dx, dy); else { cam.az -= dx * 0.008; cam.el = Math.max(-0.2, Math.min(1.5, cam.el + dy * 0.008)); } ask();
    };
    cv.onpointerup = cv.onpointercancel = e => { ptrs.delete(e.pointerId); last = null; };
    const pan = (dx, dy) => { const z = norm([eye()[0] - cam.t[0], eye()[1] - cam.t[1], eye()[2] - cam.t[2]]), r = norm(cross([0, 0, 1], z)), u = cross(z, r), k = cam.dist * 0.0016; for (let a = 0; a < 3; a++) cam.t[a] += (-r[a] * dx + u[a] * dy) * k; };
    cv.onwheel = e => { e.preventDefault(); cam.dist = Math.max(rad * 0.05, Math.min(rad * 20, cam.dist * Math.exp(e.deltaY * 0.0012))); want = null; ask(); };
    cv.oncontextmenu = e => e.preventDefault();
    $("#v3h").onclick = () => { cam = home(); want = null; lastFollow = -2; ask(); }; $("#v3f").onchange = e => { follow = e.target.checked; lastFollow = -3; if (follow) update(); }; $("#v3q").onchange = e => { faint = e.target.checked; update(); }; $("#v3e").onchange = e => { showEdges = e.target.checked; ask(); };
    $("#v3s").onclick = () => { draw(); const a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = "montage_" + st.d + ".png"; a.click(); };
    window.addEventListener("resize", ask); new MutationObserver(ask).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return { update, redraw: ask, state: () => ({ N, cam, dirty }) };
  }
  let v3 = null;
  if (D.has3d) { $$("[data-v]").forEach(b => { b.onclick = () => { $$("[data-v]").forEach(c => c.classList.toggle("on", c === b)); const g3 = b.dataset.v === "3d"; $("#v3w").hidden = !g3; $("#gw").hidden = g3; if (g3 && v3) v3.redraw(); }; }); v3 = init3d(); window.__v3 = v3; }
  const m = /steg=(\d+)/.exec(location.hash); if (m && S[Number(m[1]) - 1]) { const i = Number(m[1]) - 1; st.d = S[i].s; select(i); } else { st.d = today >= mn && today <= mx ? today : mn; draw(); }
}
const MS_TL_CSS = `:root{--bg:#f3f5f9;--card:#fff;--tx:#17202f;--mu:#667089;--ln:#e1e6ef;--ac:#1d4ed8;--done:#16a34a;--act:#f59e0b;--todo:#cbd5e1}html.dark{--bg:#0c1220;--card:#141c2e;--tx:#e8edf7;--mu:#95a1bb;--ln:#26324a;--todo:#38445e}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}[hidden]{display:none!important}
.hd{background:#fff;border-bottom:1px solid var(--ln)}html.dark .hd{background:#101828}.hd-in{max-width:1180px;margin:auto;padding:18px 16px}.brand{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.logo{display:inline-flex;align-items:center;border:1px solid var(--ln);border-radius:10px;padding:7px 14px;background:#fff}.logo img{display:block;max-height:44px;max-width:200px}.eb{text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:var(--mu)}h1{margin:2px 0 0;font-size:clamp(24px,4vw,38px);letter-spacing:-.02em}.ds{margin:8px 0 0;color:var(--mu);max-width:760px}.rg{margin-top:8px;font-weight:600;color:var(--ac)}
main{max-width:1180px;margin:16px auto 30px;padding:0 12px;display:flex;flex-direction:column;gap:14px}.card{background:var(--card);border:1px solid var(--ln);border-radius:14px;padding:14px;box-shadow:0 4px 18px rgba(15,23,42,.06)}h2{margin:0 0 8px;font-size:17px}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}.grow{flex:1}.btn,select,#q{font:inherit;border:1px solid var(--ln);background:var(--card);color:var(--tx);border-radius:9px;padding:6px 12px;cursor:pointer}.btn.pri{background:var(--ac);border-color:var(--ac);color:#fff;font-weight:600}
.now{display:flex;gap:6px 18px;align-items:baseline;flex-wrap:wrap}.big{font-size:24px;font-weight:700}.mu{color:var(--mu)}.prog{height:8px;background:var(--todo);border-radius:5px;overflow:hidden;margin:8px 0 14px}.prog i{display:block;height:100%;width:0;background:var(--done);transition:width .15s}
.tl{position:relative;height:56px;margin:4px 8px 16px;cursor:ew-resize;touch-action:none;outline:none;user-select:none}.tl:focus-visible{outline:2px solid var(--ac);outline-offset:6px;border-radius:6px}.tl-t{position:absolute;left:0;right:0;top:22px;height:8px;background:var(--todo);border-radius:5px}.tl .wk{position:absolute;top:-4px;width:1px;height:16px;background:var(--mu);opacity:.55;font-style:normal}.tl .wk u{position:absolute;top:-18px;left:3px;font-size:10px;color:var(--mu);text-decoration:none;white-space:nowrap}
.tl .sm{position:absolute;top:2px;width:3px;height:24px;margin-left:-1px;background:var(--ac);opacity:.5;border-radius:2px;cursor:pointer}.tl .sm:hover{opacity:1}.tl .tdm{position:absolute;top:-6px;width:2px;height:20px;background:#ef4444;opacity:.7}.tl-ph{position:absolute;top:8px;width:4px;height:42px;margin-left:-2px;background:var(--tx);border-radius:3px}.tl-ph::before{content:"";position:absolute;left:-7px;top:12px;width:18px;height:18px;border-radius:50%;background:var(--ac);border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.4)}.tl-ph b{position:absolute;top:-17px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:700;background:var(--tx);color:var(--card);padding:1px 7px;border-radius:99px;white-space:nowrap}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px}.gwrap{overflow:auto;max-height:540px;border:1px solid var(--ln);border-radius:10px}svg{width:100%;min-width:700px;display:block}.gl{stroke:var(--ln)}.gt{font-size:9px;fill:var(--mu)}.gh{fill:hsl(var(--h) 55% 50% / .15)}.ghl{font-size:11px;font-weight:700;fill:var(--tx)}.rl{font-size:10.5px;fill:var(--tx)}.rb{fill:transparent}.row{cursor:pointer}.row:hover .rb{fill:rgba(29,78,216,.08)}.bt{fill:var(--todo)}.pgb{fill:var(--act)}.pgb.done{fill:var(--done)}.pgb.act{animation:pu 1.3s ease-in-out infinite}.pgb.sel{stroke:var(--tx);stroke-width:2}@keyframes pu{50%{opacity:.65}}.ar{fill:none;stroke:var(--mu);stroke-width:1;opacity:.7}.ph{stroke:#ef4444;stroke-width:2}
.cur{border:1px solid var(--ln);border-radius:10px;padding:12px;max-height:540px;overflow:auto}.cn{font-size:12px;color:var(--mu)}.cur h3{margin:4px 0}.dts{font-size:13px;margin:6px 0}.sp{height:7px;background:var(--todo);border-radius:4px;overflow:hidden}.sp i{display:block;height:100%;background:var(--act)}.sm2{font-size:12px;margin:3px 0 6px}.note{background:rgba(245,158,11,.14);border-left:3px solid var(--act);padding:6px 10px;border-radius:6px}.cur a{color:var(--ac);display:block}.now2{margin-top:8px;font-size:13px}.now2 b{display:block;font-size:12px;color:var(--mu)}
.bd{font-size:11px;padding:2px 9px;border-radius:99px;font-weight:600;display:inline-block}.bd.done{background:#dcfce7;color:#166534}.bd.act{background:#fef3c7;color:#92400e}.bd.todo{background:#e5e9f2;color:#475569}
.ba{position:relative;margin-top:10px;border-radius:9px;overflow:hidden;cursor:zoom-in}.ba img{display:block;width:100%}.ba .b1{position:relative}.b2w{position:absolute;inset:0}.b2w img{height:100%;object-fit:cover}.bs{position:absolute;left:4%;width:92%;bottom:8px}.bl{position:absolute;top:8px;font-size:11px;background:rgba(0,0,0,.6);color:#fff;padding:2px 8px;border-radius:99px}.bl.l{left:8px}.bl.r{right:8px}
.chips{display:flex;gap:6px}.chip{font:inherit;font-size:13px;border:1px solid var(--ln);background:var(--card);color:var(--tx);border-radius:99px;padding:3px 12px;cursor:pointer}.chip.on{background:var(--ac);border-color:var(--ac);color:#fff}#q{min-width:200px}.tw{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:6px 8px;text-align:left;border-bottom:1px solid var(--ln);vertical-align:top}th{color:var(--mu);font-size:12px}.tr{cursor:pointer}.tr:hover,.tr.sel{background:rgba(29,78,216,.08)}td small{display:block;color:var(--mu)}.adv{opacity:.7;font-size:11px}.dt img{max-width:420px;width:100%;border-radius:9px}
.tip{position:fixed;display:none;z-index:9;background:#0f172a;color:#fff;padding:6px 10px;border-radius:8px;font-size:12px;pointer-events:none}.lb{position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:20;display:flex;align-items:center;justify-content:center;cursor:zoom-out}.lb img{max-width:94vw;max-height:92vh;border-radius:8px}footer{text-align:center;color:var(--mu);font-size:12px;padding:6px 0 28px}

.lw{min-width:0}.vt{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}.v3n{font-size:12px}.v3w{position:relative;border:1px solid var(--ln);border-radius:10px;overflow:hidden;aspect-ratio:16/10;background:#eef2f7;min-height:320px}html.dark .v3w{background:#0c1220}#cv3{width:100%;height:100%;display:block;cursor:grab;touch-action:none}#cv3:active{cursor:grabbing}.v3ui{position:absolute;left:8px;top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:var(--card);border:1px solid var(--ln);border-radius:10px;padding:4px 8px;font-size:12px}.v3ui .btn{padding:2px 9px}.v3c{display:inline-flex;gap:4px;align-items:center;cursor:pointer}.v3msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;color:var(--mu)}
@media(max-width:860px){.grid2{grid-template-columns:1fr}.cur{max-height:none}}@media print{.v3ui,.vt{display:none!important}body{background:#fff;color:#000}.bar,.tl,.bs,.chips,#q,.tip{display:none!important}.card{box-shadow:none;break-inside:avoid}.gwrap,.cur{max-height:none;overflow:visible}}`;
