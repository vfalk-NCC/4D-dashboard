/* Huvudbrytare för 3D-modellen (Victor 2026-10-21): vid start är dashboarden AV för allt som ändrar modellen i Trimble Connect
   (färger, dölj/visa, markering, kamera, markeringar/bubblor, tänd/släck modell). Då kan andra som använder modellen utan att känna
   till appen inte påverkas. Läsning (markering, egenskaper, bilder) fungerar som vanligt. Slås på med reglaget i sidhuvudet,
   och slås inte på av sig själv – inte ens vid omladdning. När den slås av återställs modellen och bubblorna tas bort. */
const modelCtl = { on: false, touched: false, lastToast: 0 };
try { if (localStorage.getItem("4ddash-test-modelctl") === "1") modelCtl.on = true; } catch (e) { /* */ } // bara för de automatiska testerna
const MG_VIEWER = ["setObjectState", "isolateEntities", "setSelection", "addToSelection", "removeFromSelection", "setCamera", "toggleModel", "setSettings", "setCameraMode"];
const MG_MARKUP = ["addTextMarkup", "addArrowMarkup", "addLineMarkup", "addFreelineMarkups", "removeMarkups", "editMarkup", "editMarkups"];
const mgRaw = {};
function mgNotice() {
  const t = Date.now(); if (t - modelCtl.lastToast < 4000) return; modelCtl.lastToast = t;
  if (typeof modelToast === "function") modelToast("3D-styrningen är av – slå på reglaget överst om du vill ändra modellen i Trimble Connect");
}
const mgReal = { viewer: null };
const MG_FLAG = "4ddash-model-touched";   // finns kvar efter omladdning om dashboarden färgat/dolt något i modellen
function mgTouch() { modelCtl.touched = true; try { localStorage.setItem(MG_FLAG, "1"); } catch (e) { /* */ } }
/* Skyddet ligger i en Proxy som ersätter api.viewer/api.markup (Victor 2026-11-03: "objekt färgas även fast 3D-styrningen inte är aktiverad").
   Då fungerar det även om API:t hämtar ett nytt viewer-objekt vid varje åtkomst – tidigare ändrades bara ett engångsobjekt. */
function mgProxy(real, names, key, empty) {
  const set = new Set(names);
  return new Proxy(real, { get(t, k) {
    const v = Reflect.get(t, k, t);
    if (typeof k === "string" && set.has(k) && typeof v === "function") { const orig = v.bind(t); mgRaw[key + "." + k] = orig; return (...a) => { if (modelCtl.on) { if (key === "viewer") mgTouch(); return orig(...a); } mgNotice(); return Promise.resolve(empty(k)); }; }
    return typeof v === "function" ? v.bind(t) : v;
  } });
}
function modelGuardInstall(api) {
  if (!api) return;
  const put = (name, names, key, empty) => { const real = api[name]; if (!real || real.__mgGuarded) return; if (key === "viewer") mgReal.viewer = real;
    const px = mgProxy(real, names, key, empty); let ok = false;
    try { Object.defineProperty(api, name, { value: px, configurable: true, writable: true, enumerable: true }); ok = api[name] === px; } catch (e) { /* */ }
    if (!ok) { try { api[name] = px; ok = api[name] === px; } catch (e) { /* */ } }
    if (!ok) { names.forEach(n => { if (typeof real[n] !== "function") return; const orig = real[n].bind(real); mgRaw[key + "." + n] = orig; try { real[n] = (...a) => { if (modelCtl.on) { if (key === "viewer") mgTouch(); return orig(...a); } mgNotice(); return Promise.resolve(empty(n)); }; } catch (e) { console.warn("Kunde inte skydda", n, e); } }); } };
  put("viewer", MG_VIEWER, "viewer", () => undefined);
  put("markup", MG_MARKUP, "markup", n => (/^add/.test(n) ? [] : undefined));
  mgSyncUi(); mgCleanLeftovers();
}
/* Har dashboarden färgat modellen i ett tidigare pass (reglaget slogs på och fliken stängdes) ligger färgerna kvar i Trimble Connect: återställ dem när reglaget är av. */
async function mgCleanLeftovers() {
  let flag = null; try { flag = localStorage.getItem(MG_FLAG); } catch (e) { /* */ } if (flag !== "1" || modelCtl.on) return;
  await mgResetModel(); try { localStorage.removeItem(MG_FLAG); } catch (e) { /* */ }
}
async function mgResetModel() {
  const V = mgReal.viewer; if (!V || typeof V.setObjectState !== "function") return;
  try { await V.setObjectState(undefined, { color: "reset" }); await V.setObjectState(undefined, { visible: "reset" }); } catch (e) { console.warn("Kunde inte återställa modellen", e); }
}
async function modelGuardSet(on) {
  if (on === modelCtl.on) { mgSyncUi(); return; }
  if (!on) { // stäng av: lämna alla lägen och återställ det vi ändrat, medan anropen ännu går igenom
    try { if (typeof setGanttMode === "function" && typeof ganttMode !== "undefined" && ganttMode !== "off") await setGanttMode("off", true); } catch (e) { console.warn(e); }
    try { if (typeof bubbleCfg !== "undefined" && bubbleCfg.on) { bubbleCfg.on = false; if (typeof bubblesSyncUi === "function") bubblesSyncUi(); if (typeof bubblesClear === "function") await bubblesClear(); } } catch (e) { console.warn(e); }
    try { if (typeof msLeave === "function" && typeof ms !== "undefined" && ms.view) { ms.touched3d = true; await msRestoreModel(); } } catch (e) { console.warn(e); }
    await mgResetModel();   // alltid – även om färgerna kommer från ett tidigare pass
    modelCtl.touched = false; try { localStorage.removeItem(MG_FLAG); } catch (e) { /* */ }
  }
  modelCtl.on = on; mgSyncUi();
  if (typeof modelToast === "function") modelToast(on ? "3D-styrningen är på – dashboarden kan nu ändra modellen i Trimble Connect" : "3D-styrningen är av – modellen är återställd");
}
function mgSyncUi() {
  const c = document.getElementById("mgSwitch"); if (c) c.checked = modelCtl.on;
  const l = document.getElementById("mgLabel"); if (l) { l.classList.toggle("on", modelCtl.on); const t = l.querySelector("span"); if (t) t.textContent = modelCtl.on ? "3D-styrning på" : "3D-styrning av"; }
}
function mgInit() { const c = document.getElementById("mgSwitch"); if (c) { c.checked = modelCtl.on; c.onchange = () => { modelGuardSet(c.checked).catch(e => console.warn(e)); }; } mgSyncUi(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mgInit); else mgInit();
