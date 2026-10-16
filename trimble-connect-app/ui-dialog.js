/* Egna dialogrutor (Victor 2026-10-13: "Det verkar inte fungera att koppla objekt direkt i ganttschemat").
   Dashboarden körs i en iframe i Trimble Connect. Där blockerar webbläsaren alert/confirm/prompt (ingen ruta visas
   och confirm() svarar "nej" direkt) – så Koppla, flytta med beroenden och ta bort "gjorde ingenting" utan besked.
   I en iframe visas därför dashboardens egna rutor; på en egen flik används webbläsarens som förut (testerna svarar på dem).

     await dashConfirm(text, { ok, danger })  – true/false
     alert(text)                              – ersätts i en iframe av en ruta som inte blockerar koden
   Första stycket i texten blir rubrik, resten brödtext. Enter = OK, Esc = Avbryt. */

const dashInFrame = () => { try { return window.self !== window.top; } catch (e) { return true; } };
const dashNativeOk = () => !dashInFrame() && !window.__forceDashDialogs;
const dashNativeAlert = window.alert.bind(window);
let dashDlgQueue = Promise.resolve();

function dashDialog(kind, text, opts = {}) {
  const run = () => new Promise(resolve => {
    const parts = String(text ?? "").split(/\n\s*\n/), long = parts.length === 1 && parts[0].trim().length > 90;
    const title = parts.length > 1 ? parts[0].trim() : long ? "" : parts[0].trim(), body = parts.length > 1 ? parts.slice(1).join("\n\n").trim() : long ? parts[0].trim() : "";
    const danger = opts.danger ?? (kind === "confirm" && /^(ta bort|radera)/i.test(String(text).trim()));
    const okText = opts.ok || (kind === "alert" ? "OK" : danger ? "Ta bort" : "Fortsätt");
    if (!document.getElementById("dashDlgCss")) {
      const st = document.createElement("style"); st.id = "dashDlgCss";
      st.textContent = `.dash-dlg-wrap{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.38);padding:16px}
        .dash-dlg{width:min(420px,100%);background:#fff;color:#1f2328;border-radius:14px;box-shadow:0 24px 60px -12px rgba(15,23,42,.45);padding:18px 20px 14px;font:14px/1.45 "Segoe UI",Arial,sans-serif}
        .dash-dlg h3{margin:0 0 6px;font-size:15px;font-weight:700;white-space:pre-wrap}.dash-dlg p{margin:0 0 4px;color:#475569;white-space:pre-wrap;max-height:50vh;overflow:auto}
        .dash-dlg-b{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.dash-dlg-b button{font:inherit;font-weight:600;padding:7px 16px;border-radius:9px;border:1px solid #dcdfe4;background:#f4f5f7;color:#1f2328;cursor:pointer}
        .dash-dlg-b button.ok{background:#0b5fff;border-color:#0b5fff;color:#fff}.dash-dlg-b button.danger{background:#dc2626;border-color:#dc2626;color:#fff}.dash-dlg-b button:focus-visible{outline:2px solid #93c5fd;outline-offset:2px}`;
      document.head.appendChild(st);
    }
    const wrap = document.createElement("div"); wrap.className = "dash-dlg-wrap"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true");
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    wrap.innerHTML = `<div class="dash-dlg">${title ? `<h3>${esc(title)}</h3>` : ""}${body ? `<p>${esc(body)}</p>` : ""}<div class="dash-dlg-b">${kind === "confirm" ? `<button type="button" class="cancel">Avbryt</button>` : ""}<button type="button" class="${danger ? "danger" : "ok"} okb">${esc(okText)}</button></div></div>`;
    (typeof overlayHost === "function" ? overlayHost() : document.body).appendChild(wrap); // syns även i helskärm
    const done = v => { document.removeEventListener("keydown", key, true); wrap.remove(); resolve(v); };
    const key = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(kind === "confirm" ? false : undefined); } else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); done(kind === "confirm" ? true : undefined); } };
    document.addEventListener("keydown", key, true);
    wrap.querySelector(".okb").onclick = () => done(kind === "confirm" ? true : undefined);
    const c = wrap.querySelector(".cancel"); if (c) c.onclick = () => done(false);
    wrap.addEventListener("pointerdown", e => e.stopPropagation());
    wrap.querySelector(".okb").focus();
  });
  const p = dashDlgQueue.then(run, run); dashDlgQueue = p.catch(() => {});
  return p;
}
/* confirm som kan väntas på: en ruta i iframe (Trimble Connect), webbläsarens egen på en egen flik. */
function dashConfirm(text, opts = {}) { return dashNativeOk() ? Promise.resolve(window.confirm(String(text))) : dashDialog("confirm", text, opts); }
// alert blockerar inte koden i en iframe (som i 4D-planering): rutan visas och koden går vidare.
window.alert = text => { if (dashNativeOk()) dashNativeAlert(text); else dashDialog("alert", text); };
