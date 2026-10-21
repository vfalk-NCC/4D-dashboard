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
function modelGuardInstall(api) {
  if (!api) return;
  const wrap = (obj, names, key, empty) => { if (!obj) return; names.forEach(n => {
    if (typeof obj[n] !== "function") return; const orig = obj[n].bind(obj); mgRaw[key + "." + n] = orig;
    try { obj[n] = (...a) => { if (modelCtl.on) { if (key === "viewer") modelCtl.touched = true; return orig(...a); } mgNotice(); return Promise.resolve(empty(n)); }; } catch (e) { console.warn("Kunde inte skydda", n, e); }
  }); };
  wrap(api.viewer, MG_VIEWER, "viewer", () => undefined);
  wrap(api.markup, MG_MARKUP, "markup", n => (/^add/.test(n) ? [] : undefined));
  mgSyncUi();
}
async function modelGuardSet(on) {
  if (on === modelCtl.on) { mgSyncUi(); return; }
  if (!on) { // stäng av: lämna alla lägen och återställ det vi ändrat, medan anropen ännu går igenom
    try { if (typeof setGanttMode === "function" && typeof ganttMode !== "undefined" && ganttMode !== "off") await setGanttMode("off", true); } catch (e) { console.warn(e); }
    try { if (typeof bubbleCfg !== "undefined" && bubbleCfg.on) { bubbleCfg.on = false; if (typeof bubblesSyncUi === "function") bubblesSyncUi(); if (typeof bubblesClear === "function") await bubblesClear(); } } catch (e) { console.warn(e); }
    try { if (typeof msLeave === "function" && typeof ms !== "undefined" && ms.view) { ms.touched3d = true; await msRestoreModel(); } } catch (e) { console.warn(e); }
    try { const V = API && API.viewer; if (modelCtl.touched && V && typeof V.setObjectState === "function") { await V.setObjectState(undefined, { color: "reset" }); await V.setObjectState(undefined, { visible: "reset" }); } } catch (e) { console.warn(e); }
    modelCtl.touched = false;
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
