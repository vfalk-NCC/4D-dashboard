// ---------------------------------------------------------------------
// GitHub-storage.js
// ---------------------------------------------------------------------
// Ersätter Supabase/PostgREST som datalager. All projektdata lagras som
// JSON-filer i det privata repot vfalk-NCC/4D-data, en mapp per Trimble-
// projekt (projects/<projectId>/<tabell>.json), via GitHub Contents API.
//
// Delas av 4D-dashboard och 4D-planering (identisk kopia i båda repona,
// eftersom GitHub Pages inte kan dela filer mellan repon).
//
// Autentisering: en fine-grained personal access token, scopead till
// enbart 4D-data-repot (Contents: Read and write). Token:en matas in av
// användaren i respektive apps inställningspanel och sparas i
// localStorage, precis som Supabase-URL/anon-key gjorde tidigare. Den
// är alltså lika synlig i klientkoden som den gamla anon-nyckeln var —
// samma förtroendemodell, bara en annan leverantör. Se
// GITHUB_TOKEN_SETUP.md för hur token:en skapas.
//
// API-yta:
//   ghReadJSON(token, path)                    -> array (tom array om filen inte finns än)
//   ghWriteJSON(token, path, mutateFn, message) -> skriver om resultatet av mutateFn(currentArray),
//                                                   läser om och försöker igen vid skrivkrock (HTTP 409)
//   ghUpsertOne(token, path, record, keyFn, message) -> insert-eller-uppdatera efter keyFn (motsvarar on_conflict=)
//   ghUploadBinary(token, path, file, message)  -> laddar upp en bilaga (File/Blob), returnerar path
//   ghReadBinaryUrl(token, path)                -> hämtar en bilaga och returnerar en blob:-URL för visning
//   ghDeleteBinary(token, path, message)        -> tar bort en bilaga (best-effort, kastar inte om den redan är borta)
//   ghNewId()                                    -> crypto.randomUUID(), ersätter Postgres bigint identity
// ---------------------------------------------------------------------

const GH_OWNER = "vfalk-NCC";
const GH_REPO = "4D-data";
const GH_BRANCH = "main";
const GH_API_BASE = "https://api.github.com";

function ghNewId() {
  return crypto.randomUUID();
}

function ghHeaders(token, accept) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept || "application/vnd.github+json",
  };
}

function ghUtf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function ghB64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function ghContentsUrl(path) {
  return `${GH_API_BASE}/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
}

/** Hämtar en fils metadata + innehåll (avkodat som text). null om filen inte finns. */
async function ghGetFile(token, path) {
  const res = await fetch(`${ghContentsUrl(path)}?ref=${GH_BRANCH}`, {
    headers: ghHeaders(token),
  });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) {
    throw new Error(`GitHub GET ${path} misslyckades: ${res.status}`);
  }
  const json = await res.json();
  if (Array.isArray(json)) {
    // path pekar på en mapp, inte en fil - ska inte hända i vårt bruk
    throw new Error(`GitHub-path ${path} är en mapp, inte en fil`);
  }
  const text = ghB64ToUtf8(json.content);
  return { data: JSON.parse(text), sha: json.sha };
}

/** Bara metadata (sha) - används för bilagor där vi inte vill JSON-avkoda innehållet. */
async function ghGetMeta(token, path) {
  const res = await fetch(`${ghContentsUrl(path)}?ref=${GH_BRANCH}`, {
    headers: ghHeaders(token),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET (meta) ${path} misslyckades: ${res.status}`);
  const json = await res.json();
  return { sha: json.sha, size: json.size };
}

async function ghPutFile(token, path, contentB64, sha, message) {
  const body = {
    message: message || `Uppdatera ${path}`,
    content: contentB64,
    branch: GH_BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await fetch(ghContentsUrl(path), {
    method: "PUT",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    const err = new Error("Skrivkrock (409) mot " + path);
    err.conflict = true;
    throw err;
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).message || ""; } catch (e) {}
    throw new Error(`GitHub PUT ${path} misslyckades: ${res.status} ${detail}`);
  }
  return res.json();
}

/** Läser en JSON-array-fil. Returnerar tom array om filen inte finns än (nytt projekt). */
async function ghReadJSON(token, path) {
  const { data } = await ghGetFile(token, path);
  return Array.isArray(data) ? data : [];
}

/**
 * Läser en JSON-array-fil, kör mutateFn(currentArray) -> nyArray, och skriver
 * tillbaka den. Vid skrivkrock (någon annan hann skriva emellan) läses filen
 * om och mutateFn körs igen, upp till maxRetries gånger - motsvarar Postgres
 * radlåsning fast optimistiskt via filens sha.
 */
async function ghWriteJSON(token, path, mutateFn, message, maxRetries = 4) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data, sha } = await ghGetFile(token, path);
    const current = Array.isArray(data) ? data : [];
    const next = mutateFn(current.slice());
    try {
      await ghPutFile(token, path, ghUtf8ToB64(JSON.stringify(next, null, 2)), sha, message);
      return next;
    } catch (e) {
      lastErr = e;
      if (!e.conflict) throw e;
      // annars: loopa och försök igen med färsk sha
    }
  }
  throw lastErr;
}

/**
 * Insert-eller-uppdatera en post i en JSON-array-fil, matchat på keyFn
 * (motsvarar Supabase on_conflict=). Om en post med samma nyckel redan
 * finns slås fälten ihop (merge), annars läggs posten till.
 */
async function ghUpsertOne(token, path, record, keyFn, message) {
  const key = keyFn(record);
  return ghWriteJSON(
    token,
    path,
    (arr) => {
      const idx = arr.findIndex((r) => keyFn(r) === key);
      if (idx >= 0) {
        // Behåll den befintliga radens id - annars skriver record.id (ofta
        // ett nygenererat ghNewId()) över det stabila id:t vid varje upsert.
        const merged = { ...arr[idx], ...record, id: arr[idx].id };
        const next = arr.slice();
        next[idx] = merged;
        return next;
      }
      return [...arr, record];
    },
    message
  );
}

/** Laddar upp en bilaga (File/Blob) till given path. Returnerar path (sparas i JSON-posten). */
async function ghUploadBinary(token, path, file, message) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  const contentB64 = btoa(binary);
  const existing = await ghGetMeta(token, path);
  await ghPutFile(token, path, contentB64, existing ? existing.sha : null, message || `Lägg till bilaga ${path}`);
  return path;
}

/** Hämtar en bilaga och returnerar en blob:-URL som kan användas i <img src>/<a href>. */
async function ghReadBinaryUrl(token, path) {
  const res = await fetch(`${ghContentsUrl(path)}?ref=${GH_BRANCH}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw" },
  });
  if (!res.ok) throw new Error(`GitHub GET (raw) ${path} misslyckades: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Tar bort en bilaga. Best-effort - kastar inte om den redan är borta. */
async function ghDeleteBinary(token, path, message) {
  try {
    const meta = await ghGetMeta(token, path);
    if (!meta) return;
    await fetch(ghContentsUrl(path), {
      method: "DELETE",
      headers: { ...ghHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ message: message || `Ta bort bilaga ${path}`, sha: meta.sha, branch: GH_BRANCH }),
    });
  } catch (e) {
    console.warn("Kunde inte ta bort bilaga (ignoreras):", path, e);
  }
}
