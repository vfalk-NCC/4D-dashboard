/* Tema (Victor 2026-10-20): ljust, mörkt eller följ systemet. Mörkt läge vänder sidans färger (CSS-filter på hela sidan) och vänder tillbaka
   bilder, kameravyer, lappar och staplar så att deras egna färger – statusfärgerna – ser ut som i ljust läge. Valet sparas i webbläsaren.
   Utskrift och PDF är alltid ljusa. Den tidiga inställningen sker i <head> (index.html) så att sidan inte blinkar vit vid start. */
const THEME_KEY = "4ddash-theme", THEME_MODES = ["light", "dark", "auto"], THEME_ICON = { light: "☀", dark: "🌙", auto: "◐" }, THEME_LABEL = { light: "Ljust tema", dark: "Mörkt tema", auto: "Följer systemet" };
function themeGet() { try { const t = localStorage.getItem(THEME_KEY); return THEME_MODES.includes(t) ? t : "light"; } catch (e) { return "light"; } }
function themeApply(mode) {
  const dark = mode === "dark" || (mode === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.setAttribute("data-theme", "dark"); else document.documentElement.removeAttribute("data-theme");
  const b = document.getElementById("btnTheme"); if (b) { b.textContent = THEME_ICON[mode]; b.title = `${THEME_LABEL[mode]} – klicka för att byta (ljust → mörkt → följ systemet)`; }
}
function themeSet(mode) { try { localStorage.setItem(THEME_KEY, mode); } catch (e) { /* ingen lagring */ } themeApply(mode); }
function initTheme() {
  themeApply(themeGet());
  const b = document.getElementById("btnTheme"); if (b) b.onclick = () => { const m = themeGet(); themeSet(THEME_MODES[(THEME_MODES.indexOf(m) + 1) % THEME_MODES.length]); };
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (themeGet() === "auto") themeApply("auto"); });
}
document.addEventListener("DOMContentLoaded", initTheme);
if (document.readyState !== "loading") initTheme();
