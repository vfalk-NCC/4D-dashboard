/* Data till HTML-rapporten (modern stil, se montage-report-modern.js). */
function msReportData(s, views, imgs, info) {
  const idx = new Map(views.map((x, i) => [x.st.id, i]));
  const deps = views.map(x => x.st.deps.filter(d => idx.has(d)).map(d => idx.get(d)));
  views.forEach((x, i) => { // en del som startar efter en annan del väntar på det steget (eller på delens sista steg)
    const p = x.part && x.part.p; if (!p || p.start || !p.after || deps[i].length) return;
    const ref = views.map((v, k) => [v, k]).filter(([v]) => v.part && v.part.p.id === p.after); if (!ref.length) return;
    const st = Number(p.afterStep), pick = st >= 0 && ref[st] ? ref[st] : ref.reduce((m, r) => (r[0].e > m[0].e ? r : m), ref[0]); deps[i].push(pick[1]);
  });
  const parts = [...new Set(views.map(x => (x.part ? x.partName : "")))];
  const by = (info && info.byStep) || {}, gm = typeof msGrpMap === "function" ? msGrpMap(s) : new Map();
  return {
    has3d: !!(info && info.has3d), cols: (info && info.cols) || [], title: s.name, logo: (typeof ms !== "undefined" && ms.logo && ms.logo.src) || "", company: (typeof ms !== "undefined" && ms.logo && ms.logo.company) || "", author: (typeof ms !== "undefined" && ms.logo && ms.logo.author) || "Victor Falk NCC", area: s.area || "", desc: s.desc || "", generated: new Date().toISOString().slice(0, 10), parts: parts.filter(Boolean), hasImg: !!(imgs && Object.keys(imgs).length),
    steps: views.map((x, i) => ({ n: x.st.name, p: x.part ? x.partName : "", s: x.s, e: x.e, note: x.st.note || "", deps: deps[i], img: (imgs && imgs[x.st.id]) || "", h: x.hours || 0, q: x.qty || 0, u: x.st.unit || "", obj: by[x.st.id] || [], gn: (gm.get(x.st.grp) || {}).name || "", gc: (gm.get(x.st.grp) || {}).color || "" }))
  };
}
