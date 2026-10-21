/* HTML-rapporten för montageordning, uppbyggd som en monteringsanvisning (Victor 2026-10-21): omslag, innehåll, tidsöversikt och en sida per steg
   med stort stegnummer, förkunskaper, Obs!-ruta och bock för klart. Bläddra eller visa alla sidor; skrivs ut med en sida per steg. En enda fristående fil som öppnas i valfri webbläsare utan Trimble Connect.
   Allt är inbyggt – inga bibliotek hämtas. */
function msReportData(s, views, imgs) {
  const idx = new Map(views.map((x, i) => [x.st.id, i])), succ = views.map(() => []);
  const deps = views.map(x => x.st.deps.filter(d => idx.has(d)).map(d => idx.get(d)));
  views.forEach((x, i) => { // en del som startar efter en annan del väntar på det steget (eller på delens sista steg)
    const p = x.part && x.part.p; if (!p || p.start || !p.after || deps[i].length) return;
    const ref = views.map((v, k) => [v, k]).filter(([v]) => v.part && v.part.p.id === p.after); if (!ref.length) return;
    const st = Number(p.afterStep), pick = st >= 0 && ref[st] ? ref[st] : ref.reduce((m, r) => (r[0].e > m[0].e ? r : m), ref[0]); deps[i].push(pick[1]);
  });
  deps.forEach((ds, i) => ds.forEach(d => succ[d].push(i)));
  const parts = [...new Set(views.map(x => (x.part ? x.partName : "")))];
  return {
    title: s.name, logo: (typeof ms !== "undefined" && ms.logo && ms.logo.src) || "", company: (typeof ms !== "undefined" && ms.logo && ms.logo.company) || "", area: s.area || "", desc: s.desc || "", generated: new Date().toISOString().slice(0, 10), parts: parts.filter(Boolean), hasImg: !!(imgs && Object.keys(imgs).length),
    steps: views.map((x, i) => ({ n: x.st.name, p: x.part ? x.partName : "", s: x.s, e: x.e, ps: x.act ? x.ppS : "", pe: x.act ? x.ppE : "", k: x.isNew ? "new" : x.changed ? "moved" : "same", sh: x.shift || 0, note: x.st.note || "", deps: deps[i], img: (imgs && imgs[x.st.id]) || "", h: x.hours || 0, q: x.qty || 0, u: x.st.unit || "" }))
  };
}
function msReportRuntime(D) {
  const $ = (q, r) => (r || document).querySelector(q), $$ = (q, r) => [...(r || document).querySelectorAll(q)];
  const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const add = (s, k) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
  const diff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
  const sd = d => new Date(d + "T00:00:00Z").toLocaleDateString("sv-SE", { day: "numeric", month: "short", timeZone: "UTC" });
  const fd = d => new Date(d + "T00:00:00Z").toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const S = D.steps, N = S.length, KEY = "montage:" + D.title;
  let mn = S[0].s, mx = S[0].e; S.forEach(x => { [x.s, x.ps].forEach(v => { if (v && v < mn) mn = v; }); [x.e, x.pe].forEach(v => { if (v && v > mx) mx = v; }); });
  const span = diff(mn, mx) + 1; let done = new Set(); try { done = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch (e) { /* */ }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify([...done])); } catch (e) { /* */ } };
  const st = { mode: "book", p: 0 };
  document.title = D.title + " – montageanvisning";
  const I = { warn: `<svg viewBox="0 0 40 36" width="34" height="31" aria-hidden="true"><path d="M20 3 38 34H2z" fill="#ffdb00" stroke="#111" stroke-width="2.4" stroke-linejoin="round"/><path d="M20 14v10" stroke="#111" stroke-width="3.2" stroke-linecap="round"/><circle cx="20" cy="29" r="1.9" fill="#111"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="#111" stroke-width="2"/><path d="M12 7v5l3.5 2" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"/></svg>`,
    cal: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="#111" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="#111" stroke-width="2" stroke-linecap="round"/></svg>`,
    box: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3 21 7.5v9L12 21 3 16.5v-9z M3 7.5 12 12l9-4.5M12 12v9" fill="none" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>`,
    man: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="7" r="3.5" fill="none" stroke="#111" stroke-width="2"/><path d="M5 21c0-4.5 3-7 7-7s7 2.5 7 7" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"/></svg>`,
    chk: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12.5 10 18 20 6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>` };
  const pages = [{ t: "cover" }, { t: "contents" }, { t: "overview" }]; let lastPart = null;
  S.forEach((x, i) => { if (x.p && x.p !== lastPart) { pages.push({ t: "part", p: x.p }); lastPart = x.p; } pages.push({ t: "step", i }); }); pages.push({ t: "end" });
  const pageOf = i => pages.findIndex(p => p.t === "step" && p.i === i), total = pages.length;
  const days = x => diff(x.s, x.e) + 1;
  const foot = (n, t) => `<div class="pf"><span>${D.company ? esc(D.company) : ""}</span><span>${n}${t ? " / " + total : ""}</span></div>`;
  const strip = i => { // schematisk bild när 3D-bild saknas: stegen som rutor, aktuellt gult
    const W = 760, H = 150, gap = 4, w = Math.max(10, Math.min(60, (W - gap * (N - 1)) / N)), x0 = (W - (w * N + gap * (N - 1))) / 2; let g = "";
    S[i].deps.forEach(d => { g += `<path d="M${x0 + d * (w + gap) + w / 2} 52V34H${x0 + i * (w + gap) + w / 2}V52" class="sa"/>`; });
    S.forEach((x, k) => { const cls = k === i ? "cur" : S[i].deps.includes(k) ? "pre" : k < i ? "old" : "fut"; g += `<rect x="${x0 + k * (w + gap)}" y="56" width="${w}" height="${w > 20 ? 56 : 40}" rx="4" class="sq ${cls}"/>${w > 22 ? `<text x="${x0 + k * (w + gap) + w / 2}" y="92" class="sn ${cls}">${k + 1}</text>` : ""}`; });
    return `<svg viewBox="0 0 ${W} ${H}" class="ill">${g}<text x="${W / 2}" y="${H - 8}" class="sl">Steg ${i + 1} av ${N}</text></svg>`;
  };
  const gantt = () => {
    const LW = 210, RH = 24, W = 1000, PX = (W - LW - 10) / span, X = d => LW + diff(mn, d) * PX, rows = []; let last = null;
    S.forEach((x, i) => { if (x.p && x.p !== last) { rows.push({ h: x.p }); last = x.p; } rows.push({ i }); });
    const ry = new Map(); rows.forEach((r, k) => { if (r.i !== undefined) ry.set(r.i, k); }); const H = rows.length * RH + 28; let g = "";
    for (let w = mn; w <= mx; w = add(w, 7)) g += `<line x1="${X(w)}" x2="${X(w)}" y1="20" y2="${H}" class="gl"/><text x="${X(w) + 3}" y="13" class="gt">${sd(w)}</text>`;
    rows.forEach((r, k) => { const y = 24 + k * RH; if (r.h) g += `<rect x="0" y="${y}" width="${W}" height="${RH}" class="gh"/><text x="8" y="${y + 16}" class="ghl">${esc(r.h)}</text>`; else { const x = S[r.i]; g += `<g class="grow" data-go="${r.i}"><rect x="0" y="${y}" width="${W}" height="${RH}" fill="transparent"/><text x="8" y="${y + 16}" class="rl"><tspan class="rn">${r.i + 1}</tspan> ${esc(x.n.length > 32 ? x.n.slice(0, 31) + "…" : x.n)}</text><rect x="${X(x.s)}" y="${y + 6}" width="${Math.max(4, days(x) * PX)}" height="${RH - 12}" rx="3" class="gb"/></g>`; } });
    S.forEach((x, i) => x.deps.forEach(d => { const y1 = 24 + ry.get(d) * RH + RH / 2, y2 = 24 + ry.get(i) * RH + RH / 2, x1 = X(S[d].e) + PX, x2 = X(x.s); g += `<path d="M${x1} ${y1}H${Math.max(x1 + 3, Math.min(x2 - 3, x1 + 5))}V${y2}H${x2}" class="ga"/>`; }));
    return `<svg viewBox="0 0 ${W} ${H}" class="gsvg">${g}</svg>`;
  };
  const stepPage = (i, n) => {
    const x = S[i], pv = (() => { for (let k = i - 1; k >= 0; k--) if (S[k].img) return S[k]; return null; })(), nx = S.map((y, k) => [y, k]).filter(([y]) => y.deps.includes(i)).map(([, k]) => k);
    return `<div class="top"><div class="num">${i + 1}</div><div class="tt"><h2>${esc(x.n)}</h2>${x.p ? `<div class="sub">${esc(x.p)}</div>` : ""}</div>
      <button class="ok${done.has(i) ? " on" : ""}" data-done="${i}" aria-pressed="${done.has(i)}">${I.chk}<span>${done.has(i) ? "Klart" : "Markera som klart"}</span></button></div>
      <div class="picto"><span>${I.clock}<b>${days(x)}</b> ${days(x) === 1 ? "dag" : "dagar"}</span><span>${I.cal}${sd(x.s)}${x.s !== x.e ? " – " + sd(x.e) : ""}</span>${x.h ? `<span>${I.man}<b>${x.h}</b> h</span>` : ""}${x.q ? `<span>${I.box}<b>${x.q}</b> ${esc(x.u)}</span>` : ""}</div>
      <div class="main"><div class="fig">${x.img ? `<div class="ba"><img class="b1" src="${pv ? pv.img : x.img}" alt=""><div class="b2w"><img src="${x.img}" alt=""></div>${pv ? `<input type="range" class="bs" min="0" max="100" value="100" aria-label="Före / efter"><span class="bl l">Före</span><span class="bl r">Efter</span>` : ""}</div>` : strip(i)}</div>
      <div class="side">${x.deps.length ? `<div class="box"><h4>Innan du börjar</h4>${x.deps.map(d => `<a class="req${done.has(d) ? " on" : ""}" data-go="${d}"><span class="sqn">${d + 1}</span>${esc(S[d].n)}<i>${I.chk}</i></a>`).join("")}</div>` : `<div class="box"><h4>Innan du börjar</h4><p class="mu">Inga förkunskaper – kan startas direkt.</p></div>`}
      ${x.note ? `<div class="obs">${I.warn}<div><b>Obs!</b><p>${esc(x.note)}</p></div></div>` : ""}
      ${nx.length ? `<div class="box"><h4>Därefter</h4>${nx.map(d => `<a class="req" data-go="${d}"><span class="sqn">${d + 1}</span>${esc(S[d].n)}</a>`).join("")}</div>` : ""}</div></div>${foot(n, 1)}`;
  };
  const pageHtml = (pg, n) => {
    if (pg.t === "cover") return `<div class="band"></div><div class="cv"><div class="brand">${D.logo ? `<span class="logo"><img src="${D.logo}" alt="${esc(D.company)}"></span>` : ""}<span class="eyebrow">${D.company ? esc(D.company) : ""}</span></div><div class="kick">Montageanvisning</div><h1>${esc(D.title)}</h1>${D.area ? `<div class="area">${esc(D.area)}</div>` : ""}<p class="lead">${esc(D.desc)}</p>
      <div class="range">${fd(mn)} – ${fd(mx)}</div>
      <div class="obs big">${I.warn}<div><b>Läs igenom hela anvisningen innan du börjar.</b><p>Följ stegen i nummerordning. Bocka av varje steg när det är klart – dina bockar sparas i den här webbläsaren.</p></div></div></div>${foot(n, 1)}`;
    if (pg.t === "contents") return `<h2 class="ph">Innehåll</h2><div class="grid">${S.map((x, i) => `<a class="card${done.has(i) ? " on" : ""}" data-go="${i}"><span class="cn">${i + 1}</span><span class="cl">${esc(x.n)}${x.p ? `<small>${esc(x.p)}</small>` : ""}</span><span class="cd">${days(x)} d</span><i>${I.chk}</i></a>`).join("")}</div>${foot(n, 1)}`;
    if (pg.t === "overview") return `<h2 class="ph">Tidsöversikt</h2><p class="mu">Klicka på ett steg för att öppna det.</p><div class="gw">${gantt()}</div>${foot(n, 1)}`;
    if (pg.t === "part") return `<div class="chap"><div class="kick">Del</div><h1>${esc(pg.p)}</h1><p class="mu">${S.filter(x => x.p === pg.p).length} steg</p></div>${foot(n, 1)}`;
    if (pg.t === "end") return `<div class="chap"><div class="bigcheck">${I.chk}</div><h1>Klart!</h1><p class="lead">${done.size === N ? "Alla steg är avbockade." : `${done.size} av ${N} steg är avbockade.`}</p><div class="endb"><button data-a="print">Skriv ut / spara som PDF</button><button data-a="csv">Ladda ner CSV</button><button data-a="link">Kopiera länk</button></div></div>${foot(n, 1)}`;
    return stepPage(pg.i, n);
  };
  document.body.innerHTML = `<nav class="nav"><div class="nl"><b>${esc(D.title)}</b></div><div class="nm"><button data-a="prev" aria-label="Föregående">←</button><select id="jp" aria-label="Gå till sida"></select><button data-a="next" aria-label="Nästa">→</button></div><div class="nr"><span id="pr"></span><button data-a="mode" id="md"></button><button data-a="print" title="Skriv ut (p)">⎙</button></div></nav><div class="prog"><i id="pg"></i></div><main id="pages"></main><div id="lb" class="lb" hidden><img alt=""></div>`;
  $("#jp").innerHTML = pages.map((pg, k) => `<option value="${k}">${pg.t === "cover" ? "Omslag" : pg.t === "contents" ? "Innehåll" : pg.t === "overview" ? "Tidsöversikt" : pg.t === "part" ? "Del: " + esc(pg.p) : pg.t === "end" ? "Avslut" : "Steg " + (pg.i + 1) + ": " + esc(S[pg.i].n.slice(0, 38))}</option>`).join("");
  $("#pages").innerHTML = pages.map((pg, k) => `<section class="pg ${pg.t}" data-p="${k}">${pageHtml(pg, k + 1)}</section>`).join("");
  const show = () => {
    $$(".pg").forEach((e, k) => { e.hidden = st.mode === "book" && k !== st.p; }); $("#jp").value = st.p; $("#md").textContent = st.mode === "book" ? "Visa alla sidor" : "Bläddra"; $("#pr").textContent = `${st.p + 1} / ${total}`;
    $("#pg").style.width = Math.round(done.size / N * 100) + "%"; $("#pg").title = `${done.size} av ${N} steg klara`;
    const e = $(`.pg[data-p="${st.p}"]`); if (e && st.mode === "all") e.scrollIntoView({ block: "start" }); else if (st.mode === "book") window.scrollTo(0, 0);
    const pg = pages[st.p]; try { history.replaceState(null, "", pg.t === "step" ? "#steg=" + (pg.i + 1) : location.pathname + location.search); } catch (x) { /* */ }
    $$(".ba").forEach(bind);
  };
  function bind(ba) { const bs = $(".bs", ba); if (bs) { const w = $(".b2w", ba), u = () => { w.style.clipPath = `inset(0 ${100 - bs.value}% 0 0)`; }; bs.oninput = u; u(); } ba.onclick = e => { if (e.target.classList.contains("bs")) return; const lb = $("#lb"); lb.querySelector("img").src = $("img:last-of-type", ba).src; lb.hidden = false; }; }
  const go = k => { st.p = Math.max(0, Math.min(total - 1, k)); show(); };
  const csv = () => { const t = "Nr;Steg;Del;Start;Slut;Dagar;Väntar på;Anteckning;Timmar;Mängd;Enhet;Klart\n" + S.map((x, i) => [i + 1, x.n, x.p, x.s, x.e, days(x), x.deps.map(d => d + 1).join(" "), x.note, x.h || "", x.q || "", x.u, done.has(i) ? "ja" : ""].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(";")).join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + t], { type: "text/csv" })); a.download = "montageordning.csv"; a.click(); };
  const link = () => { const pg = pages[st.p], u = location.href.split("#")[0] + (pg.t === "step" ? "#steg=" + (pg.i + 1) : ""); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => alert("Länken är kopierad"), () => prompt("Kopiera länken", u)); };
  document.addEventListener("click", e => {
    if (e.target.closest("#lb")) { $("#lb").hidden = true; return; }
    const d = e.target.closest("[data-done]"); if (d) { const i = Number(d.dataset.done); done.has(i) ? done.delete(i) : done.add(i); keep(); $$(".pg.step").forEach(() => {}); const k = pageOf(i); $(`.pg[data-p="${k}"]`).innerHTML = pageHtml(pages[k], k + 1); $(`.pg[data-p="1"]`).innerHTML = pageHtml(pages[1], 2); $$(".ba").forEach(bind); show(); return; }
    const g = e.target.closest("[data-go]"); if (g) { go(pageOf(Number(g.dataset.go))); return; }
    const a = e.target.closest("[data-a]"); if (!a) return; const k = a.dataset.a;
    if (k === "prev") go(st.p - 1); else if (k === "next") go(st.p + 1); else if (k === "mode") { st.mode = st.mode === "book" ? "all" : "book"; show(); } else if (k === "print") window.print(); else if (k === "csv") csv(); else if (k === "link") link();
  });
  $("#jp").onchange = e => go(Number(e.target.value));
  document.addEventListener("keydown", e => { if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "range") return; if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(st.p + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); go(st.p - 1); } else if (e.key === "p") window.print(); else if (e.key === "Escape") $("#lb").hidden = true; });
  const m = /steg=(\d+)/.exec(location.hash); if (m && S[Number(m[1]) - 1]) st.p = pageOf(Number(m[1]) - 1); show();
}
const MS_REPORT_CSS = `:root{--blue:#0058a3;--yel:#ffdb00;--ink:#111;--mu:#6b6b6b;--ln:#d9d9d9}*{box-sizing:border-box}body{margin:0;background:#e6e6e6;color:var(--ink);font:16px/1.45 "Noto Sans","Segoe UI",system-ui,-apple-system,Arial,sans-serif}[hidden]{display:none!important}
.nav{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;background:var(--blue);color:#fff;padding:8px 16px}.nl{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nm,.nr{display:flex;gap:6px;align-items:center}.nav button,.nav select{font:inherit;font-weight:700;border:2px solid #fff;background:transparent;color:#fff;border-radius:99px;padding:4px 14px;cursor:pointer}.nav select{max-width:260px;background:var(--blue)}.nav button:hover{background:#fff;color:var(--blue)}#pr{opacity:.85;font-size:13px}.prog{height:5px;background:#9fc2e3}.prog i{display:block;height:100%;width:0;background:var(--yel);transition:width .25s}
main{max-width:1120px;margin:22px auto 40px;padding:0 12px}.pg{position:relative;background:#fff;margin:0 auto 22px;padding:34px 40px 54px;min-height:600px;box-shadow:0 6px 24px rgba(0,0,0,.18);border-radius:4px}.pf{position:absolute;left:40px;right:40px;bottom:16px;display:flex;justify-content:space-between;color:var(--mu);font-size:13px;border-top:1px solid var(--ln);padding-top:8px}
.band{position:absolute;left:0;right:0;top:0;height:14px;background:linear-gradient(90deg,var(--blue) 70%,var(--yel) 70%)}.cv{padding-top:20px}.brand{display:flex;align-items:center;gap:14px;margin-bottom:46px}.logo{display:inline-flex;align-items:center;border:2px solid var(--ink);border-radius:8px;padding:8px 16px}.logo img{display:block;max-height:46px;max-width:210px}.eyebrow{font-weight:700;letter-spacing:.06em}.kick{font-weight:800;text-transform:uppercase;letter-spacing:.14em;color:var(--blue);font-size:15px}h1{font-size:clamp(34px,6vw,64px);line-height:1.05;margin:8px 0 10px;letter-spacing:-.02em;font-weight:800}.area{font-size:20px;font-weight:700}.lead{max-width:680px;font-size:18px;color:#333}.facts{display:flex;gap:16px;margin:26px 0 10px;flex-wrap:wrap}.facts div{border:2px solid var(--ink);border-radius:10px;padding:10px 22px;min-width:130px}.facts b{display:block;font-size:44px;line-height:1.05}.facts span{font-size:13px;color:var(--mu)}.range{font-weight:700;margin:22px 0 26px;font-size:18px}
.obs{display:flex;gap:12px;align-items:flex-start;background:#fffbe0;border:2px solid var(--ink);border-radius:10px;padding:10px 14px}.obs b{font-size:15px}.obs p{margin:2px 0 0}.obs.big{max-width:680px}
.ph{font-size:30px;margin:0 0 14px;font-weight:800}.mu{color:var(--mu)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}.card{display:flex;align-items:center;gap:12px;border:2px solid var(--ink);border-radius:10px;padding:8px 12px;cursor:pointer;position:relative;color:inherit;text-decoration:none}.card:hover{background:#fffbe0}.cn{font-size:30px;font-weight:800;min-width:38px}.cl{flex:1;font-weight:600;line-height:1.25}.cl small{display:block;font-weight:400;color:var(--mu)}.cd{font-size:12px;color:var(--mu)}.card i,.req i{display:none;color:#fff;background:var(--blue);border-radius:50%;width:22px;height:22px;align-items:center;justify-content:center}.card.on i,.req.on i{display:inline-flex}
.gw{overflow:auto}.gsvg{width:100%;min-width:760px}.gl{stroke:#e5e5e5}.gt{font-size:9px;fill:var(--mu)}.gh{fill:#f1f1f1}.ghl{font-size:11px;font-weight:800}.rl{font-size:11px}.rn{font-weight:800}.grow{cursor:pointer}.grow:hover rect:first-child{fill:#fffbe0}.gb{fill:var(--ink)}.gb.cr{fill:var(--blue);stroke:var(--ink);stroke-width:2}.gb.mv{stroke:#f97316;stroke-width:2.2}.ga{fill:none;stroke:#555;stroke-width:1}
.top{display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap}.num{font-size:112px;font-weight:800;line-height:.9;min-width:90px;letter-spacing:-.04em}.tt{flex:1;min-width:200px;padding-top:6px}h2{font-size:clamp(22px,3.4vw,34px);margin:0;line-height:1.15;font-weight:800}.sub{color:var(--mu);margin-top:4px}.ok{display:inline-flex;align-items:center;gap:8px;font:inherit;font-weight:700;border:2px solid var(--ink);background:#fff;border-radius:99px;padding:8px 18px;cursor:pointer}.ok.on{background:var(--blue);border-color:var(--blue);color:#fff}
.picto{display:flex;flex-wrap:wrap;gap:8px 22px;margin:16px 0 14px;align-items:center}.picto span{display:inline-flex;align-items:center;gap:7px;font-size:15px}.picto b{font-size:18px}.tg{border:2px solid var(--ink);border-radius:99px;padding:1px 12px;font-weight:700;font-size:13px}.tg.y{background:var(--yel)}.tg.k{background:var(--ink);color:#fff}
.main{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(240px,1fr);gap:22px}.fig{border:2px solid var(--ink);border-radius:10px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:260px}.ill{width:100%;height:auto}.sq{stroke:var(--ink);stroke-width:2;fill:#fff}.sq.old{fill:#e0e0e0}.sq.pre{fill:var(--blue)}.sq.cur{fill:var(--yel);stroke-width:3.5}.sn{font-size:15px;font-weight:800;text-anchor:middle}.sn.pre{fill:#fff}.sa{fill:none;stroke:var(--ink);stroke-width:2}.sl{font-size:13px;text-anchor:middle;fill:var(--mu)}
.ba{position:relative;width:100%;cursor:zoom-in}.ba img{display:block;width:100%}.ba .b1{position:relative}.b2w{position:absolute;inset:0}.b2w img{height:100%;object-fit:cover}.bs{position:absolute;left:4%;width:92%;bottom:8px}.bl{position:absolute;top:8px;font-size:11px;background:var(--ink);color:#fff;padding:2px 9px;border-radius:99px}.bl.l{left:8px}.bl.r{right:8px}
.side{display:flex;flex-direction:column;gap:12px}.box{border:2px solid var(--ink);border-radius:10px;padding:10px 12px}.box h4{margin:0 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.08em}.req{display:flex;align-items:center;gap:10px;padding:5px 0;cursor:pointer;color:inherit;text-decoration:none;font-size:14px}.req:hover{color:var(--blue)}.sqn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:2px solid var(--ink);border-radius:6px;font-weight:800}.req.on .sqn{background:var(--blue);color:#fff;border-color:var(--blue)}.req i{margin-left:auto}
.chap{min-height:420px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start}.bigcheck{color:#fff;background:var(--blue);border-radius:50%;width:90px;height:90px;display:flex;align-items:center;justify-content:center;margin-bottom:16px}.bigcheck svg{width:52px;height:52px}.endb{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.endb button{font:inherit;font-weight:700;border:2px solid var(--ink);background:#fff;border-radius:99px;padding:8px 20px;cursor:pointer}.endb button:hover{background:var(--yel)}
.lb{position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:20;display:flex;align-items:center;justify-content:center;cursor:zoom-out}.lb img{max-width:94vw;max-height:92vh;border-radius:6px}
@media(max-width:820px){.pg{padding:22px 16px 52px}.pf{left:16px;right:16px}.main{grid-template-columns:1fr}.num{font-size:76px;min-width:60px}.nl{display:none}.nav select{max-width:150px}}
@page{size:A4 landscape;margin:10mm}@media print{body{background:#fff}.nav,.prog,.ok,.endb,.bs{display:none!important}main{margin:0;max-width:none;padding:0}.pg{display:block!important;box-shadow:none;border-radius:0;margin:0;page-break-after:always;break-after:page;min-height:0;height:185mm;padding:10mm 12mm}.pg[hidden]{display:block!important}.pf{bottom:6mm}.band,.sq,.gb,.sqn,.tg,.logo{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
