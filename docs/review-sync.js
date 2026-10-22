/* PDF-hubb – delning via 4D-data (Victor 2026-10-22: "ja kör det i 4d-data").
   Tre filer under projects/<projekt>/: review_docs.json (ritningarnas inställningar: typ, delområde, disciplin, ritningsnr, skala …),
   review_marks.json (markeringarna med status och kommentarer) och review_pdf/<id>.pdf (själva PDF:erna, högst 40 MB per fil).
   Markeringar och inställningar slås ihop per post (senast ändrad vinner; borttagna markeringar och ritningar följer med som "gravstenar").
   Markeringarna skickas automatiskt några sekunder efter varje ändring; PDF:erna flyttas när du trycker Synka. Favoriter och senast öppnade är per enhet. */

const rvsPath = f => `projects/${encodeURIComponent(projectId)}/${f}`;
const rvSid = d => d.sid || (d.sid = (() => { let h = 5381; for (const c of String(d.name)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return Number(d.size || 0).toString(36) + h.toString(36); })());
const RVS_SHARED = ["no", "rev", "key", "title", "disc", "dtype", "zone", "grp", "scaleW", "date", "cat"], RVS_MAX = 40e6;
const rvsOn = () => typeof settings !== "undefined" && settings && settings.githubToken && typeof projectId !== "undefined" && projectId;
const rvsTomb = () => { try { return JSON.parse(localStorage.getItem("4ddash-review-tomb") || "[]"); } catch (e) { return []; } };
function rvsTombAdd(id) { try { const t = rvsTomb().filter(x => x.id !== id); t.push({ id, upd: Date.now() }); localStorage.setItem("4ddash-review-tomb", JSON.stringify(t.slice(-2000))); } catch (e) { /* */ } }
const rvsMsg = t => { rv.msg = t; const b = document.querySelector(".rv-msg"); if (b) b.textContent = t; else rvRender(true); };
let rvsT = 0, rvsBusy = false;
function rvsSoon() { if (!rvsOn()) return; clearTimeout(rvsT); rvsT = setTimeout(() => { rvsPushMarks().catch(e => console.warn("Granskning: kunde inte skicka markeringar", e)); }, 4000); }
const rvsMarkSig = (list, tomb) => list.length + ":" + list.reduce((a, m) => Math.max(a, m.upd || 0), 0) + ":" + tomb.length + ":" + tomb.reduce((a, t) => Math.max(a, t.upd), 0);

async function rvsPushMarks() {
  if (!rvsOn()) return; const marks = await rvAll("marks"), docs = new Map(rv.docs.map(d => [d.id, d])), tomb = rvsTomb();
  const mine = marks.filter(m => docs.has(m.doc)).map(m => { const { doc, ...r } = m; return { ...r, sid: rvSid(docs.get(doc)), upd: m.upd || Date.parse(m.created) || 0 }; });
  const sig = rvsMarkSig(mine, tomb); let last = ""; try { last = localStorage.getItem("4ddash-review-sig") || ""; } catch (e) { /* */ } if (sig === last) return;
  await ghWriteJSON(settings.githubToken, rvsPath("review_marks.json"), arr => { const mp = new Map(arr.map(x => [x.id, x])); [...mine, ...tomb.map(t => ({ id: t.id, del: true, upd: t.upd }))].forEach(x => { const o = mp.get(x.id); if (!o || (x.upd || 0) >= (o.upd || 0)) mp.set(x.id, x); }); return [...mp.values()]; }, "Granskningsmarkeringar");
  try { localStorage.setItem("4ddash-review-sig", sig); } catch (e) { /* */ }
}
const rvsPmByName = rvPmByName;
const rvsDocRec = d => { const r = { sid: rvSid(d), name: d.name, size: d.size, pmName: (rv.pms.find(p => p.id === d.pm) || {}).name || "", upd: d.upd || 0, file: !!d.pushed }; RVS_SHARED.forEach(k => { if (d[k] != null && d[k] !== "") r[k] = d[k]; }); return r; };

/* full = även flytta PDF-filer (hämta saknade, skicka nya). Utan full synkas bara inställningar och markeringar. */
async function rvsSync(full) {
  if (!rvsOn()) { rvToast("Ange GitHub-token i inställningarna för att synka med 4D-data"); return; }
  if (rvsBusy) return; rvsBusy = true; const tok = settings.githubToken;
  try {
    if (full) rvsMsg("Synkar med 4D-data …");
    const [rDocs, rMarks] = await Promise.all([ghReadJSON(tok, rvsPath("review_docs.json")), ghReadJSON(tok, rvsPath("review_marks.json"))]);
    const bySid = new Map(rv.docs.map(d => [rvSid(d), d])), rdMap = new Map(rDocs.map(r => [r.sid, r])), tomb = new Map(rvsTomb().map(t => [t.id, t.upd]));
    let nMarks = 0, nSet = 0, nGot = 0, nUp = 0, skipped = 0, queue = [];
    // inställningar
    for (const r of rDocs) { const d = bySid.get(r.sid); if (!d) continue; if (r.del) { if ((r.upd || 0) > (d.upd || 0) && d.pushed) { await rvDeleteDoc(d.id, true); bySid.delete(r.sid); nSet++; } continue; } d.pushed = d.pushed || !!r.file; if ((r.upd || 0) > (d.upd || 0)) { RVS_SHARED.forEach(k => { if (r[k] != null) d[k] = r[k]; }); if (r.pmName) d.pm = await rvsPmByName(r.pmName); d.upd = r.upd; nSet++; } await rvPut("docs", d); }
    // PDF-filer
    if (full) {
      const missing = rDocs.filter(r => !r.del && r.file && !bySid.has(r.sid) && !tomb.has("doc:" + r.sid));
      let i = 0; for (const r of missing) { i++; rvsMsg(`Hämtar ritning ${i} av ${missing.length} …`); try { const url = await ghReadBinaryUrl(tok, rvsPath("review_pdf/" + r.sid + ".pdf")), blob = await (await fetch(url)).blob(); URL.revokeObjectURL(url); const id = rvId(), doc = { id, pm: await rvsPmByName(r.pmName), name: r.name, size: r.size, added: Date.now(), pages: 0, text: null, thumb: "", fav: false, opened: 0, grp: "", ...rvParse(r.name), sid: r.sid, pushed: true, upd: r.upd || 0 }; RVS_SHARED.forEach(k => { if (r[k] != null) doc[k] = r[k]; }); await rvTx(["docs", "blobs"], "readwrite", (a, b) => { a.put(doc); b.put({ id, blob }); }); rv.docs.push(doc); bySid.set(r.sid, doc); rv.queue.push(id); nGot++; } catch (e) { console.warn("Granskning: kunde inte hämta", r.name, e); } }
      const up = rv.docs.filter(d => !d.pushed && !(rdMap.get(rvSid(d)) || {}).file); i = 0;
      for (const d of up) { i++; rvsMsg(`Skickar ritning ${i} av ${up.length} …`); const b = await rvGet("blobs", d.id); if (!b) continue; if (b.blob.size > RVS_MAX) { skipped++; continue; } try { await ghUploadBinary(tok, rvsPath("review_pdf/" + rvSid(d) + ".pdf"), b.blob, "Granskning: " + d.name); d.pushed = true; await rvPut("docs", d); nUp++; } catch (e) { console.warn("Granskning: kunde inte skicka", d.name, e); } }
    }
    // markeringar
    const local = new Map((await rvAll("marks")).map(m => [m.id, m]));
    for (const r of rMarks) { const d = bySid.get(r.sid), l = local.get(r.id); if (r.del) { if (l && (r.upd || 0) >= (l.upd || 0)) { await rvDel("marks", r.id); nMarks++; } continue; } if (!d) continue; if (tomb.has(r.id) && tomb.get(r.id) >= (r.upd || 0)) continue; if (!l || (r.upd || 0) > (l.upd || 0)) { const { sid, ...rest } = r; await rvPut("marks", { ...rest, doc: d.id }); nMarks++; } }
    // skicka inställningar och markeringar
    const dt = rvsTomb().filter(t => t.id.startsWith("doc:"));
    await ghWriteJSON(tok, rvsPath("review_docs.json"), arr => { const mp = new Map(arr.map(x => [x.sid, x])); rv.docs.forEach(d => { const rec = rvsDocRec(d), o = mp.get(rec.sid); if (!o || o.del || (rec.upd || 0) >= (o.upd || 0)) mp.set(rec.sid, { ...(o && !o.del ? o : {}), ...rec, file: rec.file || !!(o && o.file) }); }); dt.forEach(t => mp.set(t.id.slice(4), { sid: t.id.slice(4), del: true, upd: t.upd })); return [...mp.values()]; }, "Granskning: ritningar");
    try { localStorage.removeItem("4ddash-review-sig"); } catch (e) { /* */ } await rvsPushMarks();
    rv.remoteOnly = rDocs.filter(r => !r.del && r.file && !bySid.has(r.sid)).length;
    rvPrep(); await rvMarksCount(); if (full) rv.msg = `Synkat: ${nGot} hämtade, ${nUp} skickade${skipped ? `, ${skipped} över 40 MB hoppades över` : ""}, ${nMarks} markeringar och ${nSet} inställningar uppdaterade.`; if (rv.open) { rvRender(true); if (nMarks && !(rvv.drag || (document.activeElement && document.activeElement.tagName === "TEXTAREA"))) rvOpenDoc(rv.open, { again: true, page: rvv.num }); } else rvRender(); if (rv.queue.length) rvRunQueue();
  } catch (e) { console.warn("Granskning: synk misslyckades", e); if (full) rv.msg = "Synk misslyckades: " + ((e && e.message) || e); rvRender(true); }
  finally { rvsBusy = false; }
}
