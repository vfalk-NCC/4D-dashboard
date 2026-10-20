/* Liten QR-generator (byte-läge, felrättning M, version 1–40, bästa mask). qrMatrix(text) -> array av rader (true = mörk). Ingen extern kod. */
(function () {
  // Antal kodord per version: [ECC-ord per block, block grupp1, data/block1, block grupp2, data/block2] för nivå M.
  const M = [null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
    [30, 1, 50, 4, 51], [22, 6, 36, 2, 37], [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42], [28, 7, 45, 3, 46], [28, 10, 46, 1, 47], [26, 9, 43, 4, 44], [26, 3, 44, 11, 45], [26, 3, 41, 13, 42],
    [26, 17, 42, 0, 0], [28, 17, 46, 0, 0], [28, 4, 47, 14, 48], [28, 6, 45, 14, 46], [28, 8, 47, 13, 48], [28, 19, 46, 4, 47], [28, 22, 45, 3, 46], [28, 3, 45, 23, 46], [28, 21, 45, 7, 46], [28, 19, 47, 10, 48],
    [28, 2, 46, 29, 47], [28, 10, 46, 23, 47], [28, 14, 46, 21, 47], [28, 14, 46, 23, 47], [28, 12, 47, 26, 48], [28, 6, 47, 34, 48], [28, 29, 46, 14, 47], [28, 13, 46, 32, 47], [28, 40, 47, 7, 48], [28, 18, 47, 31, 48]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]];
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  function rsGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); g.forEach((c, j) => { ng[j] ^= c; ng[j + 1] ^= mul(c, EXP[i]); }); g = ng; } return g; }
  function rsEnc(data, n) { const g = rsGen(n), res = new Array(n).fill(0); data.forEach(d => { const f = d ^ res.shift(); res.push(0); if (f) for (let i = 0; i < n; i++) res[i] ^= mul(g[i + 1], f); }); return res; }
  const dataCap = v => { const t = M[v]; return t[1] * t[2] + t[3] * t[4]; };
  function formatBits(mask) { const d = (0 << 3 | mask) /* M = 00 */, ec = 0b00; let r = (ec << 3 | mask) << 10; const g = 0b10100110111; for (let i = 14; i >= 10; i--) if (r >> i & 1) r ^= g << (i - 10); return ((ec << 3 | mask) << 10 | r) ^ 0b101010000010010; }
  function versionBits(v) { let r = v << 12; const g = 0b1111100100101; for (let i = 17; i >= 12; i--) if (r >> i & 1) r ^= g << (i - 12); return v << 12 | r; }
  const MASKS = [(r, c) => (r + c) % 2 === 0, (r, c) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0, (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0];
  function penalty(m) {
    const n = m.length; let p = 0;
    for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) { let run = 1; for (let j = 1; j < n; j++) { const a = k ? m[j][i] : m[i][j], b = k ? m[j - 1][i] : m[i][j - 1]; if (a === b) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) if (m[i][j] === m[i + 1][j] && m[i][j] === m[i][j + 1] && m[i][j] === m[i + 1][j + 1]) p += 3;
    const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) for (let j = 0; j + 11 <= n; j++) { let a = true, b = true; for (let t = 0; t < 11; t++) { const v = (k ? m[j + t][i] : m[i][j + t]) ? 1 : 0; if (v !== pat[t]) a = false; if (v !== pat[10 - t]) b = false; } if (a || b) p += 40; }
    let dark = 0; m.forEach(r => r.forEach(v => { if (v) dark++; })); p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
    return p;
  }
  function build(bytes) {
    let v = 1; const need = ver => 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
    while (v <= 40 && need(v) > dataCap(v) * 8) v++;
    if (v > 40) throw new Error("För lång text för QR-kod");
    const bits = []; const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push(val >> i & 1); };
    put(0b0100, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
    const cap = dataCap(v) * 8; put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
    const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
    for (let pad = 0; data.length < dataCap(v); pad++) data.push(pad % 2 ? 0x11 : 0xec);
    const t = M[v], blocks = []; let pos = 0;
    for (let i = 0; i < t[1] + t[3]; i++) { const len = i < t[1] ? t[2] : t[4]; blocks.push(data.slice(pos, pos + len)); pos += len; }
    const ecs = blocks.map(b => rsEnc(b, t[0])), out = [];
    for (let i = 0; i < Math.max(t[2], t[4]); i++) blocks.forEach(b => { if (i < b.length) out.push(b[i]); });
    for (let i = 0; i < t[0]; i++) ecs.forEach(e => out.push(e[i]));
    const n = 17 + 4 * v, mod = Array.from({ length: n }, () => new Array(n).fill(false)), fn = Array.from({ length: n }, () => new Array(n).fill(false));
    const set = (r, c, val) => { if (r >= 0 && c >= 0 && r < n && c < n) { mod[r][c] = val; fn[r][c] = true; } };
    const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) set(r + i, c + j, i >= 0 && i <= 6 && j >= 0 && j <= 6 && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4))); };
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const al = ALIGN[v]; for (const r of al) for (const c of al) { if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (c === 6 && r === al[al.length - 1])) continue; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1); }
    const fmtArea = () => { for (let i = 0; i < 9; i++) { if (i !== 6) { fn[8][i] = true; fn[i][8] = true; } } for (let i = 0; i < 8; i++) { fn[8][n - 1 - i] = true; fn[n - 1 - i][8] = true; } fn[n - 8][8] = true; mod[n - 8][8] = true; };
    fmtArea();
    if (v >= 7) { const vb = versionBits(v); for (let i = 0; i < 18; i++) { const bit = vb >> i & 1, a = Math.floor(i / 3), b = i % 3 + n - 11; set(a, b, !!bit); set(b, a, !!bit); } }
    const bitsOut = []; out.forEach(b => { for (let i = 7; i >= 0; i--) bitsOut.push(b >> i & 1); });
    const place = () => { let k = 0, up = true; for (let c = n - 1; c > 0; c -= 2) { if (c === 6) c--; for (let i = 0; i < n; i++) { const r = up ? n - 1 - i : i; for (let d = 0; d < 2; d++) { const cc = c - d; if (fn[r][cc]) continue; mod[r][cc] = k < bitsOut.length ? !!bitsOut[k] : false; k++; } } up = !up; } };
    place();
    let best = null, bestP = Infinity;
    for (let mk = 0; mk < 8; mk++) {
      const m = mod.map(r => r.slice());
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!fn[r][c] && MASKS[mk](r, c)) m[r][c] = !m[r][c];
      const f = formatBits(mk);
      for (let i = 0; i < 15; i++) { const bit = !!(f >> i & 1); if (i < 6) m[i][8] = bit; else if (i < 8) m[i + 1][8] = bit; else m[n - 15 + i][8] = bit; if (i < 8) m[8][n - 1 - i] = bit; else if (i < 9) m[8][15 - i] = bit; else m[8][14 - i] = bit; }
      m[n - 8][8] = true;
      const p = penalty(m); if (p < bestP) { bestP = p; best = m; }
    }
    return best;
  }
  const utf8 = s => Array.from(new TextEncoder().encode(String(s)));
  window.qrMatrix = text => build(utf8(text));
  /* SVG-sträng för en QR-kod (med tyst zon). */
  window.qrSvg = (text, px = 200) => { const m = build(utf8(text)), n = m.length, q = 4; let d = ""; m.forEach((row, r) => row.forEach((v, c) => { if (v) d += `M${c + q} ${r + q}h1v1h-1z`; })); return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + q * 2} ${n + q * 2}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`; };
})();
