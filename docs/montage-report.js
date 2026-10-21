/* HTML-rapporten för montageordning (Victor 2026-10-21): en enda fristående fil som öppnas i valfri webbläsare utan Trimble Connect.
   Innehåll: nyckeltal, en ganttvy som kan SPELAS UPP (bygget växer fram, aktuellt steg med anteckning och 3D-bild), före/efter-reglage
   mellan stegbilder, kritisk väg, filter och sök, belastning per vecka, mörkt läge, delbar länk till ett steg, CSV-export och
   utskrift som PDF. Allt är inbyggt – inga bibliotek hämtas. */
function msReportData(s, views, imgs) {
  const idx = new Map(views.map((x, i) => [x.st.id, i])), succ = views.map(() => []);
  const deps = views.map(x => x.st.deps.filter(d => idx.has(d)).map(d => idx.get(d)));
  views.forEach((x, i) => { // en del som startar efter en annan del väntar på det steget (eller på delens sista steg)
    const p = x.part && x.part.p; if (!p || p.start || !p.after || deps[i].length) return;
    const ref = views.map((v, k) => [v, k]).filter(([v]) => v.part && v.part.p.id === p.after); if (!ref.length) return;
    const st = Number(p.afterStep), pick = st >= 0 && ref[st] ? ref[st] : ref.reduce((m, r) => (r[0].e > m[0].e ? r : m), ref[0]); deps[i].push(pick[1]);
  });
  deps.forEach((ds, i) => ds.forEach(d => succ[d].push(i)));
  const end = views.reduce((m, x) => (x.e > m ? x.e : m), views[0].e), lf = new Array(views.length).fill(null);
  const dur = i => msDiff(views[i].s, views[i].e) + 1;
  const calc = i => { if (lf[i] !== null) return lf[i]; let v = end; succ[i].forEach(j => { const c = msAdd(calc(j), -dur(j)); if (c < v) v = c; }); return (lf[i] = v); };
  views.forEach((x, i) => calc(i));
  const parts = [...new Set(views.map(x => (x.part ? x.partName : "")))];
  return {
    title: s.name, logo: (typeof ms !== "undefined" && ms.logo && ms.logo.src) || "", company: (typeof ms !== "undefined" && ms.logo && ms.logo.company) || "", area: s.area || "", desc: s.desc || "", generated: new Date().toISOString().slice(0, 10), parts: parts.filter(Boolean), hasImg: !!(imgs && Object.keys(imgs).length),
    steps: views.map((x, i) => ({ n: x.st.name, p: x.part ? x.partName : "", s: x.s, e: x.e, ps: x.act ? x.ppS : "", pe: x.act ? x.ppE : "", k: x.isNew ? "new" : x.changed ? "moved" : "same", sh: x.shift || 0, note: x.st.note || "", deps: deps[i], crit: msDiff(x.e, lf[i]) <= 0 && (succ[i].length > 0 || x.e === end), img: (imgs && imgs[x.st.id]) || "", h: x.hours || 0, q: x.qty || 0, u: x.st.unit || "" }))
  };
}
function msReportRuntime(D) {
  const $ = (q, r) => (r || document).querySelector(q), $$ = (q, r) => [...(r || document).querySelectorAll(q)];
  const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const add = (s, k) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
  const diff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
  const fmt = d => new Date(d + "T00:00:00Z").toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const S = D.steps, N = S.length;
  let mn = S[0].s, mx = S[0].e; S.forEach(x => { [x.s, x.ps].forEach(v => { if (v && v < mn) mn = v; }); [x.e, x.pe].forEach(v => { if (v && v > mx) mx = v; }); });
  const span = diff(mn, mx) + 1, hue = p => { const i = D.parts.indexOf(p); return i < 0 ? 215 : (215 + i * 47) % 360; };
  const st = { d: mn, play: false, speed: 1, filter: "all", q: "", sel: -1, crit: false, timer: null };
  const phase = (x, d) => (x.e < d ? "done" : x.s > d ? "todo" : "act");
  document.title = D.title + " – montageordning";
  const nNew = S.filter(x => x.k === "new").length, nMov = S.filter(x => x.k === "moved").length, nCrit = S.filter(x => x.crit).length;
  const kpi = [[N, "steg"], [span, "kalenderdagar"], [nNew, "nya steg"], [nMov, "flyttade mot tidplan"], [nCrit, "på kritisk väg"]];
  const hasImg = D.hasImg;
  document.body.innerHTML = `
  <header class="hero"><div class="hero-in"><div class="brand">${D.logo ? `<span class="logo"><img src="${D.logo}" alt="${esc(D.company)}"></span>` : ""}<div class="eyebrow">${D.company ? esc(D.company) + " · " : ""}Montageordning${D.area ? " · " + esc(D.area) : ""}</div></div><h1>${esc(D.title)}</h1><p>${esc(D.desc)}</p>
    <div class="kpis">${kpi.map(([v, l]) => `<div class="kpi"><b data-count="${v}">0</b><span>${l}</span></div>`).join("")}</div>
    <div class="range">${fmt(mn)} → ${fmt(mx)}</div></div></header>
  <main>
  <section class="card stage"><div class="bar"><button id="pl" class="btn pri" aria-label="Spela">▶ Spela upp</button><button id="bk" class="btn" aria-label="Föregående steg" title="←">⏮</button><button id="fw" class="btn" aria-label="Nästa steg" title="→">⏭</button>
    <select id="sp" aria-label="Hastighet"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select>
    <label class="chk"><input type="checkbox" id="cr"> Kritisk väg</label><span class="sp"></span><button id="dk" class="btn" title="Mörkt läge (d)">◐</button><button id="pr" class="btn" title="Skriv ut / spara som PDF (p)">⎙</button><button id="cp" class="btn" title="Kopiera länk till valt steg">🔗</button><button id="cv" class="btn" title="Ladda ner som CSV">CSV</button></div>
    <div class="now"><div><div class="date" id="dt"></div><div class="cnt" id="ct"></div></div><div class="prog"><i id="pg"></i></div></div>
    <input type="range" id="sc" min="0" max="${span - 1}" value="0" aria-label="Datum">
    <div class="grid2"><div class="gwrap"><svg id="g"></svg></div><aside class="cur" id="cur"></aside></div></section>
  <section class="card"><h2>Belastning per vecka</h2><div class="load" id="ld"></div><p class="m">Antal steg som pågår samtidigt. Hovra en stapel.</p></section>
  <section class="card"><h2>Alla steg</h2><div class="bar"><div class="chips" id="fl">${[["all", "Alla"], ["new", "Nya"], ["moved", "Flyttade"], ["crit", "Kritiska"]].map(([k, t]) => `<button class="chip${k === "all" ? " on" : ""}" data-f="${k}">${t}</button>`).join("")}</div><input id="q" placeholder="Sök steg …" aria-label="Sök"></div><div class="tw"><table id="tb"></table></div></section>
  </main><footer>${S.some(x => x.h) ? `<div class="adv">Summa planerade timmar: ${Math.round(S.reduce((t, x) => t + (x.h || 0), 0))} h</div>` : ""}${D.company ? esc(D.company) + " · " : ""}Skapad ${esc(D.generated)} · 4D-dashboard · Förslaget är underlag för diskussion med tidplaneraren.</footer>
  <div id="tip" class="tip"></div><div id="lb" class="lb" hidden><img alt=""></div>`;
  // nyckeltal räknas upp
  $$("[data-count]").forEach(e => { const t = Number(e.dataset.count), t0 = performance.now(); const f = now => { const k = Math.min(1, (now - t0) / 900); e.textContent = Math.round(t * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  // ganttvy
  const LW = 190, RH = 26, W = 1000, PX = (W - LW - 10) / span, X = d => LW + diff(mn, d) * PX, rows = []; let last = null;
  S.forEach((x, i) => { if (x.p && x.p !== last) { rows.push({ h: x.p }); last = x.p; } rows.push({ i }); });
  const ry = new Map(); rows.forEach((r, k) => { if (r.i !== undefined) ry.set(r.i, k); });
  const H = rows.length * RH + 30; let g = "";
  for (let w = mn, k = 0; w <= mx; w = add(w, 7), k++) g += `<line x1="${X(w)}" x2="${X(w)}" y1="22" y2="${H}" class="gl"/><text x="${X(w) + 3}" y="14" class="gt">${w.slice(5)}</text>`;
  rows.forEach((r, k) => { const y = 26 + k * RH; if (r.h) g += `<rect x="0" y="${y}" width="${W}" height="${RH}" class="gh" style="--h:${hue(r.h)}"/><text x="8" y="${y + 17}" class="ghl">${esc(r.h)}</text>`; else { const x = S[r.i]; g += `<g class="row" data-i="${r.i}"><rect x="0" y="${y}" width="${W}" height="${RH}" class="rb"/><text x="${r.i >= 0 && x.p ? 14 : 8}" y="${y + 17}" class="rl">${r.i + 1}. ${esc(x.n.length > 30 ? x.n.slice(0, 29) + "…" : x.n)}</text>${x.ps && (x.ps !== x.s || x.pe !== x.e) ? `<rect x="${X(x.ps)}" y="${y + 4}" width="${Math.max(3, (diff(x.ps, x.pe) + 1) * PX)}" height="${RH - 8}" rx="4" class="pp"/>` : ""}<rect class="bar2" data-b="${r.i}" x="${X(x.s)}" y="${y + 7}" width="${Math.max(4, (diff(x.s, x.e) + 1) * PX)}" height="${RH - 14}" rx="4"/></g>`; } });
  let ar = ""; S.forEach((x, i) => x.deps.forEach(d => { const p = S[d], y1 = 26 + ry.get(d) * RH + RH / 2, y2 = 26 + ry.get(i) * RH + RH / 2, x1 = X(p.e) + PX, x2 = X(x.s); ar += `<path d="M${x1} ${y1}H${Math.max(x1 + 3, Math.min(x2 - 3, x1 + 5))}V${y2}H${x2}" class="ar${x.crit && p.crit ? " cr" : ""}"/>`; }));
  const svg = $("#g"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.innerHTML = g + ar + `<line id="ph" y1="20" y2="${H}" class="ph"/>`;
  const bars = $$("[data-b]", svg), ph = $("#ph");
  // belastning
  const weeks = []; for (let w = add(mn, -((new Date(mn + "T00:00:00Z").getUTCDay() + 6) % 7)); w <= mx; w = add(w, 7)) weeks.push(w);
  const load = weeks.map(w => S.filter(x => x.s <= add(w, 6) && x.e >= w)), mxl = Math.max(1, ...load.map(l => l.length));
  $("#ld").innerHTML = weeks.map((w, i) => `<div class="lb2" style="height:${Math.round(load[i].length / mxl * 100)}%" data-t="v${w.slice(5)}: ${load[i].length} steg – ${esc(load[i].map(x => x.n).slice(0, 6).join(", "))}"><span>${load[i].length || ""}</span></div>`).join("");
  // tabell
  const tb = $("#tb");
  const drawTable = () => {
    const q = st.q.toLowerCase(), list = S.map((x, i) => [x, i]).filter(([x]) => (st.filter === "all" || (st.filter === "crit" ? x.crit : x.k === st.filter)) && (!q || (x.n + " " + x.p + " " + x.note).toLowerCase().includes(q)));
    tb.innerHTML = `<tr><th>#</th><th>Steg</th><th>Start</th><th>Slut</th><th>Dagar</th><th>Mot tidplan</th><th>Väntar på</th></tr>` + list.map(([x, i]) => `<tr class="tr${st.sel === i ? " sel" : ""}" data-r="${i}"><td>${i + 1}</td><td><b>${esc(x.n)}</b>${x.p ? `<small>${esc(x.p)}</small>` : ""}${x.h || x.q ? `<small class="adv">${x.h ? "⏱ " + x.h + " h" : ""}${x.h && x.q ? " · " : ""}${x.q ? x.q + " " + esc(x.u) : ""}</small>` : ""}${x.crit ? ` <em class="tag cr">kritisk</em>` : ""}</td><td>${x.s}</td><td>${x.e}</td><td>${diff(x.s, x.e) + 1}</td><td>${x.k === "new" ? `<em class="tag nw">nytt</em>` : x.k === "moved" ? `<em class="tag mv">${x.sh > 0 ? "+" : ""}${x.sh} d</em>` : "–"}</td><td>${x.deps.map(d => d + 1).join(", ") || "–"}</td></tr>${st.sel === i ? `<tr class="dt"><td></td><td colspan="6">${x.note ? `<p>${esc(x.note)}</p>` : `<p class="m">Ingen anteckning.</p>`}${x.img ? `<img src="${x.img}" alt="">` : ""}</td></tr>` : ""}`).join("") || `<tr><td colspan="7" class="m">Inga steg matchar.</td></tr>`;
  };
  // aktuell tid
  const curIdx = d => { let best = -1; S.forEach((x, i) => { if (phase(x, d) === "act" && (best < 0 || x.s >= S[best].s)) best = i; }); if (best >= 0) return best; let b2 = -1; S.forEach((x, i) => { if (x.e < d && (b2 < 0 || x.e >= S[b2].e)) b2 = i; }); return b2 >= 0 ? b2 : 0; };
  const drawCur = i => {
    const x = S[i], prev = S.findIndex((y, k) => k < i && y.img), pv = (() => { for (let k = i - 1; k >= 0; k--) if (S[k].img) return S[k]; return null; })();
    $("#cur").innerHTML = `<div class="cn">Steg ${i + 1} av ${N}</div><h3>${esc(x.n)}</h3>${x.p ? `<div class="m">${esc(x.p)}</div>` : ""}<div class="dts">${x.s} → ${x.e} · ${diff(x.s, x.e) + 1} dagar</div>
      ${x.k === "moved" ? `<div class="tag mv">Flyttad ${x.sh > 0 ? "+" : ""}${x.sh} d mot tidplan (${x.ps} → ${x.pe})</div>` : x.k === "new" ? `<div class="tag nw">Nytt steg</div>` : ""}${x.crit ? `<div class="tag cr">På kritisk väg</div>` : ""}
      ${x.note ? `<p class="note">${esc(x.note)}</p>` : ""}${x.deps.length ? `<div class="m">Väntar på: ${x.deps.map(d => `<a href="#steg=${d + 1}" data-go="${d}">${d + 1}. ${esc(S[d].n)}</a>`).join(", ")}</div>` : ""}
      ${x.img ? `<div class="ba"><img class="b1" src="${pv ? pv.img : x.img}" alt=""><div class="b2w"><img src="${x.img}" alt=""></div>${pv ? `<input type="range" min="0" max="100" value="100" class="bs" aria-label="Före / efter"><span class="bl l">Före</span><span class="bl r">Efter</span>` : ""}</div>` : ""}`;
    const bs = $(".bs"); if (bs) { const w = $(".b2w"); const u = () => { w.style.clipPath = `inset(0 ${100 - bs.value}% 0 0)`; }; bs.oninput = u; u(); }
    const im = $(".ba"); if (im) im.onclick = e => { if (e.target.classList.contains("bs")) return; const lb = $("#lb"); lb.querySelector("img").src = x.img; lb.hidden = false; };
  };
  let shownCur = -2;
  const draw = () => {
    const d = st.d, done = S.filter(x => phase(x, d) === "done").length;
    $("#dt").textContent = fmt(d); $("#ct").textContent = `${done} av ${N} steg klara · ${S.filter(x => phase(x, d) === "act").length} pågår`; $("#pg").style.width = Math.round(done / N * 100) + "%";
    $("#sc").value = diff(mn, d); ph.setAttribute("x1", X(d) + PX / 2); ph.setAttribute("x2", X(d) + PX / 2);
    bars.forEach(b => { const i = Number(b.dataset.b), x = S[i]; b.setAttribute("class", `bar2 ${phase(x, d)} ${x.k}${x.crit && st.crit ? " crit" : ""}${st.crit && !x.crit ? " dim" : ""}${st.sel === i ? " sel" : ""}`); });
    const c = st.sel >= 0 ? st.sel : curIdx(d); if (c !== shownCur) { shownCur = c; drawCur(c); }
  };
  const setDate = d => { st.d = d < mn ? mn : d > mx ? mx : d; draw(); };
  const select = i => { st.sel = i; shownCur = -2; history.replaceState(null, "", "#steg=" + (i + 1)); drawTable(); draw(); };
  const play = on => { st.play = on; clearInterval(st.timer); $("#pl").textContent = on ? "⏸ Pausa" : "▶ Spela upp"; if (on) { if (st.d >= mx) st.d = mn; st.sel = -1; st.timer = setInterval(() => { if (st.d >= mx) { play(false); return; } setDate(add(st.d, 1)); }, 1000 / (6 * st.speed)); } };
  const step = k => { const starts = [...new Set(S.map(x => x.s))].sort(); const cur = st.d; const t = k > 0 ? starts.find(s => s > cur) : [...starts].reverse().find(s => s < cur); st.sel = -1; setDate(t || (k > 0 ? mx : mn)); };
  $("#pl").onclick = () => play(!st.play); $("#fw").onclick = () => { play(false); step(1); }; $("#bk").onclick = () => { play(false); step(-1); };
  $("#sp").onchange = e => { st.speed = Number(e.target.value); if (st.play) play(true); }; $("#sc").oninput = e => { play(false); st.sel = -1; setDate(add(mn, Number(e.target.value))); };
  $("#cr").onchange = e => { st.crit = e.target.checked; draw(); };
  $("#dk").onclick = () => document.documentElement.classList.toggle("dark"); $("#pr").onclick = () => window.print();
  $("#cp").onclick = () => { const u = location.href.split("#")[0] + "#steg=" + ((st.sel >= 0 ? st.sel : curIdx(st.d)) + 1); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => { $("#cp").textContent = "✔"; setTimeout(() => { $("#cp").textContent = "🔗"; }, 1200); }, () => { prompt("Kopiera länken", u); }); };
  $("#cv").onclick = () => { const csv = "Nr;Steg;Del;Start;Slut;Dagar;Mot tidplan;Väntar på;Anteckning;Timmar;Mängd;Enhet\n" + S.map((x, i) => [i + 1, x.n, x.p, x.s, x.e, diff(x.s, x.e) + 1, x.k === "new" ? "nytt" : x.k === "moved" ? x.sh + " d" : "", x.deps.map(d => d + 1).join(" "), x.note, x.h || "", x.q || "", x.u].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(";")).join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = "montageordning.csv"; a.click(); };
  $("#fl").onclick = e => { const b = e.target.closest("[data-f]"); if (!b) return; st.filter = b.dataset.f; $$(".chip").forEach(c => c.classList.toggle("on", c === b)); drawTable(); };
  $("#q").oninput = e => { st.q = e.target.value; drawTable(); };
  tb.onclick = e => { const r = e.target.closest("[data-r]"); if (r) { const i = Number(r.dataset.r); play(false); if (st.sel === i) { st.sel = -1; drawTable(); draw(); } else { setDate(S[i].s); select(i); } } };
  svg.onclick = e => { const r = e.target.closest("[data-i]"); if (r) { play(false); const i = Number(r.dataset.i); setDate(S[i].s); select(i); } };
  document.addEventListener("click", e => { const a = e.target.closest("[data-go]"); if (a) { e.preventDefault(); play(false); const i = Number(a.dataset.go); setDate(S[i].s); select(i); } if (e.target.closest("#lb")) $("#lb").hidden = true; });
  document.addEventListener("keydown", e => { if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "range") return; if (e.key === " ") { e.preventDefault(); play(!st.play); } else if (e.key === "ArrowRight") { e.preventDefault(); play(false); step(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); play(false); step(-1); } else if (e.key === "d") document.documentElement.classList.toggle("dark"); else if (e.key === "p") window.print(); else if (e.key === "Escape") $("#lb").hidden = true; });
  // verktygstips
  const tip = $("#tip"); document.addEventListener("mousemove", e => { const b = e.target.closest("[data-b],[data-t]"); if (!b) { tip.style.display = "none"; return; } let t = ""; if (b.dataset.b !== undefined) { const x = S[b.dataset.b]; t = `<b>${esc(x.n)}</b><br>${x.s} → ${x.e}${x.ps && x.k === "moved" ? `<br>tidplan ${x.ps} → ${x.pe}` : ""}`; } else t = esc(b.dataset.t); tip.innerHTML = t; tip.style.display = "block"; tip.style.left = Math.min(innerWidth - 260, e.clientX + 14) + "px"; tip.style.top = e.clientY + 16 + "px"; });
  const m = /steg=(\d+)/.exec(location.hash); drawTable(); if (m && S[Number(m[1]) - 1]) { const i = Number(m[1]) - 1; st.d = S[i].s; select(i); } else draw();
}
const MS_REPORT_CSS = `:root{--bg:#f4f6fb;--card:#fff;--tx:#1b2433;--mu:#6b7690;--ln:#e3e8f2;--ac:#2563eb;--done:#22c55e;--act:#f59e0b;--todo:#cbd5e1}html.dark{--bg:#0d1320;--card:#151d2e;--tx:#e8edf7;--mu:#97a3bd;--ln:#26324a;--todo:#3a4660}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.hero{background:linear-gradient(135deg,#0b1f4d,#1e40af 55%,#0ea5e9);color:#fff;padding:42px 20px 56px}.hero-in{max-width:1180px;margin:auto}.eyebrow{text-transform:uppercase;letter-spacing:.16em;font-size:12px;opacity:.8}h1{font-size:clamp(28px,5vw,48px);margin:6px 0;letter-spacing:-.02em}.hero p{max-width:720px;opacity:.9;margin:0 0 20px}.kpis{display:flex;flex-wrap:wrap;gap:12px}.kpi{background:rgba(255,255,255,.14);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.22);border-radius:14px;padding:12px 18px;min-width:120px}.kpi b{display:block;font-size:32px;line-height:1.1}.kpi span{font-size:12px;opacity:.85}.brand{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:6px}.logo{background:#fff;border-radius:14px;padding:9px 16px;display:inline-flex;align-items:center;box-shadow:0 6px 18px rgba(0,0,0,.25)}.logo img{display:block;max-height:46px;max-width:200px;width:auto;height:auto}.range{margin-top:16px;opacity:.85;font-size:14px}
main{max-width:1180px;margin:-30px auto 0;padding:0 16px 30px;display:flex;flex-direction:column;gap:16px}.card{background:var(--card);border:1px solid var(--ln);border-radius:16px;padding:16px;box-shadow:0 8px 30px rgba(15,23,42,.08)}h2{margin:0 0 10px;font-size:18px}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}.sp{flex:1}.btn,select,input#q{font:inherit;border:1px solid var(--ln);background:var(--card);color:var(--tx);border-radius:10px;padding:7px 12px;cursor:pointer}.btn.pri{background:var(--ac);border-color:var(--ac);color:#fff;font-weight:600}.chk{font-size:13px;color:var(--mu);display:inline-flex;gap:5px;align-items:center}
.now{display:flex;gap:16px;align-items:center;margin:6px 0}.date{font-size:22px;font-weight:700}.cnt{color:var(--mu);font-size:13px}.prog{flex:1;height:10px;background:var(--todo);border-radius:6px;overflow:hidden}.prog i{display:block;height:100%;background:linear-gradient(90deg,#22c55e,#16a34a);transition:width .2s}input[type=range]{width:100%;accent-color:var(--ac)}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;margin-top:8px}.gwrap{overflow:auto;max-height:560px;border:1px solid var(--ln);border-radius:12px}svg{width:100%;min-width:700px;display:block}.gl{stroke:var(--ln)}.gt{font-size:9px;fill:var(--mu)}.gh{fill:hsl(var(--h) 60% 50% / .16)}.ghl{font-size:11px;font-weight:700;fill:var(--tx)}.rl{font-size:10.5px;fill:var(--tx)}.rb{fill:transparent}.row{cursor:pointer}.row:hover .rb{fill:rgba(37,99,235,.08)}.pp{fill:none;stroke:var(--mu);stroke-dasharray:3 2}
.bar2{transition:fill .25s,opacity .25s}.bar2.todo{fill:var(--todo)}.bar2.done{fill:var(--done)}.bar2.act{fill:var(--act);animation:pulse 1.2s ease-in-out infinite}.bar2.moved.act,.bar2.moved.todo,.bar2.moved.done{stroke:#f97316;stroke-width:1.5}.bar2.new{stroke:#0ea5e9;stroke-width:1.5}.bar2.crit{stroke:#dc2626;stroke-width:2}.bar2.dim{opacity:.35}.bar2.sel{stroke:var(--tx);stroke-width:2.2}@keyframes pulse{50%{opacity:.6}}
.ar{fill:none;stroke:var(--mu);stroke-width:1;opacity:.7}.ar.cr{stroke:#dc2626;opacity:1}.ph{stroke:#ef4444;stroke-width:2}
.cur{border:1px solid var(--ln);border-radius:12px;padding:12px;max-height:560px;overflow:auto}.cn{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--mu)}.cur h3{margin:4px 0}.m{color:var(--mu);font-size:13px}.dts{font-size:13px;margin:6px 0}.note{background:rgba(245,158,11,.14);border-left:3px solid var(--act);padding:7px 10px;border-radius:6px}.cur a{color:var(--ac)}
.tag{font-style:normal;font-size:11px;padding:2px 8px;border-radius:99px;display:inline-block;margin:2px 4px 2px 0}.tag.cr{background:#fee2e2;color:#b91c1c}.tag.nw{background:#dbeafe;color:#1d4ed8}.tag.mv{background:#ffedd5;color:#c2410c}
.ba{position:relative;margin-top:10px;border-radius:10px;overflow:hidden;cursor:zoom-in}.ba img{display:block;width:100%}.ba .b1{position:relative}.b2w{position:absolute;inset:0}.b2w img{height:100%;object-fit:cover}.bs{position:absolute;left:4%;right:4%;bottom:8px;width:92%}.bl{position:absolute;top:8px;font-size:11px;background:rgba(0,0,0,.55);color:#fff;padding:2px 8px;border-radius:99px}.bl.l{left:8px}.bl.r{right:8px}
.load{display:flex;align-items:flex-end;gap:3px;height:120px;border-bottom:1px solid var(--ln)}.lb2{flex:1;min-width:6px;background:linear-gradient(#60a5fa,#2563eb);border-radius:4px 4px 0 0;position:relative;min-height:3px}.lb2 span{position:absolute;top:-16px;left:0;right:0;text-align:center;font-size:10px;color:var(--mu)}
.chips{display:flex;gap:6px}.chip{font:inherit;font-size:13px;border:1px solid var(--ln);background:var(--card);color:var(--tx);border-radius:99px;padding:4px 12px;cursor:pointer}.chip.on{background:var(--ac);border-color:var(--ac);color:#fff}input#q{min-width:200px}.tw{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:7px 8px;text-align:left;border-bottom:1px solid var(--ln);vertical-align:top}th{color:var(--mu);font-weight:600;font-size:12px}.tr{cursor:pointer}.tr:hover,.tr.sel{background:rgba(37,99,235,.08)}td small{display:block;color:var(--mu)}.adv{opacity:.7;font-size:11px}.dt img{max-width:420px;width:100%;border-radius:10px}
.tip{position:fixed;display:none;z-index:9;background:#0f172a;color:#fff;padding:6px 10px;border-radius:8px;font-size:12px;pointer-events:none;max-width:260px}.lb{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:20;display:flex;align-items:center;justify-content:center;cursor:zoom-out}.lb[hidden]{display:none}.lb img{max-width:94vw;max-height:92vh;border-radius:10px}footer{text-align:center;color:var(--mu);font-size:12px;padding:10px 0 30px}
@media(max-width:860px){.grid2{grid-template-columns:1fr}.cur{max-height:none}}@media print{.logo{box-shadow:none;border:1px solid #ddd}body{background:#fff;color:#000}.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:20px}.bar,.now input,#sc,.bs,.tip,.chips,#q{display:none!important}.card{box-shadow:none;break-inside:avoid}.gwrap,.cur{max-height:none;overflow:visible}main{margin-top:10px}}`;
