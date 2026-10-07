/* Synliga fel (Victor 2026-10-07: "Det allra viktigaste är stabiliteten").
   Ett oväntat fel i appen ska aldrig vara tyst: en diskret rad längst ned berättar att något gick
   fel och vad, med knappar för att ladda om eller kopiera felinformationen (till Victor/utvecklare).
   Samma fel visas högst en gång per halvminut; brus från webbläsaren (ResizeObserver, fel i andra
   domäners skript utan information) ignoreras. Ändrar inget i appens beteende – bara visar. */
(function () {
  if (window.__errorGuard) return;
  window.__errorGuard = true;
  const seen = new Map(), log = [];
  const IGNORE = /ResizeObserver loop|^Script error\.?$|AbortError|The user aborted|Load failed|NetworkError when attempting|Failed to fetch dynamically/i;
  const version = () => (typeof APP_VERSION !== "undefined" ? APP_VERSION : "") || (document.querySelector("#versionBadge") || {}).textContent || "";
  function show(msg, detail) {
    msg = String(msg || "Okänt fel").replace(/^Uncaught\s+/, "").slice(0, 240);
    if (IGNORE.test(msg)) return;
    const now = Date.now();
    if (now - (seen.get(msg) || 0) < 30000) return;
    seen.set(msg, now);
    log.push({ at: new Date().toISOString(), msg, detail: String(detail || "").slice(0, 2000) });
    if (log.length > 20) log.shift();
    let bar = document.getElementById("errGuardBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "errGuardBar";
      bar.setAttribute("role", "alert");
      bar.style.cssText = "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2147483000;max-width:min(680px,calc(100vw - 24px));display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px 8px 12px;background:#7f1d1d;color:#fff;border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.3);font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;";
      bar.innerHTML = `<span style="flex:1 1 260px;min-width:0;"><b>⚠ Något gick fel</b> – <span class="eg-msg"></span><br><small style="opacity:.8">Det du gjort är sparat om inget annat sägs. Ladda om om något inte fungerar.</small></span>
        <button type="button" class="eg-reload" style="font:inherit;font-size:12px;padding:4px 9px;border-radius:6px;border:1px solid rgba(255,255,255,.4);background:#fff;color:#7f1d1d;cursor:pointer;font-weight:600">Ladda om</button>
        <button type="button" class="eg-copy" style="font:inherit;font-size:12px;padding:4px 9px;border-radius:6px;border:1px solid rgba(255,255,255,.4);background:transparent;color:#fff;cursor:pointer">Kopiera felinfo</button>
        <button type="button" class="eg-x" title="Dölj" style="font:inherit;font-size:14px;padding:2px 7px;border:none;background:transparent;color:#fff;cursor:pointer">✕</button>`;
      (document.body || document.documentElement).appendChild(bar);
      bar.querySelector(".eg-reload").onclick = () => location.reload();
      bar.querySelector(".eg-x").onclick = () => { bar.style.display = "none"; };
      bar.querySelector(".eg-copy").onclick = async () => {
        const txt = [`${document.title} ${version()}`, location.href.replace(/token=[^&]+/, "token=…"), navigator.userAgent, "", ...log.map(e => `${e.at}  ${e.msg}\n${e.detail}`)].join("\n");
        try { await navigator.clipboard.writeText(txt); bar.querySelector(".eg-copy").textContent = "✓ Kopierad"; }
        catch (e) { window.prompt("Kopiera felinformationen:", txt.slice(0, 1800)); }
      };
    }
    bar.querySelector(".eg-msg").textContent = msg;
    bar.style.display = "flex";
  }
  window.addEventListener("error", e => {
    if (e && e.target && e.target !== window && (e.target.tagName === "IMG" || e.target.tagName === "SCRIPT" || e.target.tagName === "LINK")) return; // resurser som inte laddade
    show(e.message || (e.error && e.error.message), e.error && e.error.stack || `${e.filename || ""}:${e.lineno || ""}`);
  }, true);
  window.addEventListener("unhandledrejection", e => {
    const r = e.reason;
    show(r && r.message ? r.message : String(r), r && r.stack);
  });
  window.showAppError = show; // för fel som fångas i koden men ändå ska synas
})();
