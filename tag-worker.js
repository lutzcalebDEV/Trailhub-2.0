// TrailHub sync Worker (Cloudflare Workers, free tier).
// ---------------------------------------------------------------------------
// PURPOSE
//   Saves the family's edits (tags, camera names, notes, comments, uploads) into
//   JSON files in the GitHub repo so they show up for EVERYONE, on every device.
//   pull.py bakes those files into data.js on the next scheduled run, and the site
//   also reads them live right away.
//
// WHY YOU NEED IT
//   GitHub Pages can only SERVE files, it can't SAVE them. This Worker is the piece
//   that does the saving. It holds your GitHub token server-side so the token is
//   never exposed in the website.
//
// SETUP (one time, ~5 minutes) — see the README "Shared tags" section.
//   Required Worker variables (Settings -> Variables and Secrets):
//     GITHUB_TOKEN     (secret)  fine-grained PAT, repo scoped, Contents: Read+Write
//     GITHUB_OWNER               e.g. lutzcalebDEV
//     GITHUB_REPO                e.g. Trailhub-2.0
//     GITHUB_BRANCH    (opt.)    defaults to "main"
//     UPLOAD_USER                the shared username (wrangler.toml [vars])
//     UPLOAD_PASSWORD  (secret)  the shared password (this login is always an admin)
//     SESSION_SECRET   (secret, optional) signs sign-in sessions; defaults to UPLOAD_PASSWORD
//     NOTIFY_URL       (secret, optional) e.g. https://ntfy.sh/<topic>, pinged on new sign-ups
//     ACCOUNTS         (KV binding, optional) turns on personal accounts + sign-up approval
//   Then copy the Worker URL into config.js:  window.TRAILHUB_TAGS_API = "https://...workers.dev";
//
// ACCESS
//   Reading is public. EVERY write needs the upload login (HTTP Basic auth), so a
//   stranger who finds this URL can't wipe tags or rename cameras. Sign-in attempts
//   are rate limited per IP (LOGIN_LIMITER / WRITE_LIMITER in wrangler.toml).
//
// API
//   GET  /            -> { "<photoId>": ["Deer","Turkey"], ... }   (all photo tags)
//   POST /            with { "id": "sp_...", "tags": ["Deer","Turkey"] }  (save one photo)
//   POST /            with { "items": { "sp_...": ["Deer"], ... } }  (save many in one commit)
//   GET  /cameras     -> { "<cameraKey>": "North Field", ... }    (all camera names)
//   POST /cameras     with { "id": "Camera 6a30...", "name": "North Field" }  (rename one)
//   GET  /meta        -> { "<photoId>": { "note": "...", "favorite": true }, ... }
//   POST /meta        with { "id": "sp_...", "meta": { "note": "buck", "favorite": true } }
//                     (merges the given keys into that photo; send a key as null to
//                      remove it, or an empty meta object to clear the whole entry.)
//   (POST an empty tags array or empty name to clear an entry.)
//   POST /login       Basic auth -> { token, user, admin, exp } (30-day session), or
//                     403 { pending: true } for an account that isn't approved yet
//   POST /register    with { "user": "...", "password": "..." } -> a pending account
//   GET  /accounts    (admin) -> { accounts: [{ name, status, admin, created }], enabled }
//   POST /accounts    (admin) with { "user": "...", "action": "approve"|"remove"|"admin"|"unadmin" }
//   Writes take "Authorization: Bearer <token>" (or Basic, for older copies of the site).
//   POST /thumb       ?id=up_<uuid>  body: a small JPEG preview, stored as <id>_t.jpg
//   POST /upload      stores one JPEG or video in R2 and lists it in uploads.json;
//                     body is the file; query has id (optional, from /thumb), date,
//                     camera, species, and optionally comment, author, buck, thumb=1
//   POST /uploads     with { "id": "up_...", "camera": "...", "date": "...", "species": "..." }
//                     to edit an upload, or { "id": "up_...", "remove": true } to delete it
//   GET  /comments    -> { "<photoId>": [{ id, text, author, at }], ... }
//   POST /comments    with { "photo": "...", "text": "...", "author": "..." }
//                     or { "photo": "...", "remove": "<commentId>" }
// ---------------------------------------------------------------------------

// Each resource maps a request path to a JSON file committed in the repo. pull.py
// bakes tags.json + metadata.json into data.js; the site reads all three files
// live for instant updates.
const TAGS_FILE = "tags.json";
const CAMERA_FILE = "camera-names.json";
const META_FILE = "metadata.json";
const BATCH_MAX = 2000; // above the site's 1,500-photo cap
const UPLOADS_FILE = "uploads.json";
const COMMENTS_FILE = "comments.json";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_THUMB_BYTES = 400 * 1024;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024; // Workers hold the body in memory (128 MB)
const MAX_COMMENTS = 200; // per photo
const R2_STOP_BYTES = 7e9; // stop at 70% of R2's 10 GB free tier, well before any charge
const UPLOAD_ID = /^up_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// UTF-8 safe base64 (custom tags may contain non-ASCII characters).
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function cleanTags(arr) {
  const out = [];
  const seen = new Set();
  for (const t of arr || []) {
    const s = String(t).trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

// A camera display name: trimmed, single-spaced, length-capped, no control chars.
function cleanName(value) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// Per-photo metadata sanitizing. Writes need the login, but the entries are still
// bounded so the committed metadata.json stays small and safe to render.
// Structural fields owned by other pipelines (tags, camera names) are reserved so
// metadata can't clobber them.
const META_RESERVED = new Set(["id", "image", "thumb", "date", "camera", "tags", "species"]);
const META_MAX_KEYS = 24;
const META_MAX_STR = 500;

function cleanMetaValue(value, depth = 0) {
  if (value == null) return null;
  if (typeof value === "string") {
    const s = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, " ").slice(0, META_MAX_STR);
    return s.length ? s : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (depth === 0 && Array.isArray(value)) {
    const arr = value.slice(0, 32).map((v) => cleanMetaValue(v, depth + 1)).filter((v) => v != null);
    return arr.length ? arr : null;
  }
  return null; // drop nested objects / functions / unsupported types
}

// Apply a metadata patch to an entry: set cleaned keys, remove keys sent as null,
// and reject reserved keys. Returns the resulting entry (may be empty).
function applyMetaPatch(entry, patch) {
  const out = { ...(entry && typeof entry === "object" ? entry : {}) };
  let touched = 0;
  for (const [rawKey, rawVal] of Object.entries(patch || {})) {
    if (touched >= META_MAX_KEYS) break;
    const key = String(rawKey).slice(0, 40).trim();
    if (!key || META_RESERVED.has(key)) continue;
    touched++;
    const val = cleanMetaValue(rawVal);
    if (val == null) delete out[key];
    else out[key] = val;
  }
  // Cap total stored keys as a final guard against unbounded growth.
  const keys = Object.keys(out);
  if (keys.length > META_MAX_KEYS) {
    for (const k of keys.slice(META_MAX_KEYS)) delete out[k];
  }
  return out;
}

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": "trailhub-tags",
    Accept: "application/vnd.github+json",
  };
}

async function readFile(env, path) {
  const branch = env.GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${branch}`;
  const r = await fetch(url, { headers: ghHeaders(env) });
  if (r.status === 404) return { data: {}, sha: null };
  if (!r.ok) throw new Error(`GitHub read failed: ${r.status}`);
  const body = await r.json();
  let data = {};
  try {
    const parsed = JSON.parse(b64decode((body.content || "").replace(/\n/g, "")));
    if (parsed && typeof parsed === "object") data = parsed;
  } catch (_) {
    data = {};
  }
  return { data, sha: body.sha };
}

async function writeFile(env, path, data, sha, message) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const body = {
    message,
    content: b64encode(JSON.stringify(data, null, 1) + "\n"),
    branch: env.GITHUB_BRANCH || "main",
  };
  if (sha) body.sha = sha;
  return fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Read-modify-write with retries to survive concurrent edits (GitHub returns 409
// when the sha is stale). `mutate(data)` edits the map in place; returning false
// from it means "nothing to change", which skips the commit.
async function saveEntry(env, path, mutate, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, sha } = await readFile(env, path);
    if (mutate(data) === false) return { ok: true, data, unchanged: true };
    const res = await writeFile(env, path, data, sha, message);
    if (res.ok) return { ok: true, data };
    if (res.status !== 409) {
      const text = await res.text();
      return { ok: false, status: 502, error: `Save failed (${res.status}): ${text}` };
    }
  }
  return { ok: false, status: 409, error: "Conflict after retries, please try again." };
}

// Starts the photo pull. Needs a token with Actions: Read and write, as DISPATCH_TOKEN
// or on GITHUB_TOKEN.
async function dispatchUpdate(env) {
  const token = env.DISPATCH_TOKEN || env.GITHUB_TOKEN;
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/update.yml/dispatches`;
  const r = await fetch(url, {
    method: "POST",
    headers: { ...ghHeaders({ ...env, GITHUB_TOKEN: token }), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: env.GITHUB_BRANCH || "main" }),
  });
  if (!r.ok) throw new Error(`Workflow dispatch failed (${r.status}): ${await r.text()}`);
}

// Comparing hashes keeps the check's timing from revealing the password.
async function sameText(a, b) {
  const hash = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  return sameBytes(x, y);
}
function sameBytes(x, y) {
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ------------------------------- Accounts --------------------------------
   Two kinds of login:
   - The shared family login (UPLOAD_USER / UPLOAD_PASSWORD). It is always an admin.
   - Personal accounts people register themselves. They wait as "pending" until an
     admin approves them in the app. They live in the ACCOUNTS KV namespace (never
     in the public repo); without that binding, registration is simply off.
   Signing in returns a session token signed with SESSION_SECRET (falls back to
   UPLOAD_PASSWORD, so changing that password signs everyone out). The site keeps
   the token, never the password. */
const SESSION_DAYS = 30;
// Workers' free plan allows ~10 ms of CPU per request, so the hash cost is modest.
// Logins are rate limited per IP and the hashes are private, which carries the rest.
const PBKDF2_ITER = 20000;
const USERNAME = /^[a-z0-9][a-z0-9_.-]{2,23}$/i;
const accountKey = (name) => "user:" + String(name).toLowerCase();

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmac(env, text) {
  const secret = env.SESSION_SECRET || "pw:" + (env.UPLOAD_PASSWORD || "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}

async function makeToken(env, user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const body = b64url(new TextEncoder().encode(JSON.stringify({ u: user, exp })));
  return { token: `v1.${body}.${b64url(await hmac(env, body))}`, exp };
}

async function readToken(env, token) {
  const [v, body, sig] = String(token).split(".");
  if (v !== "v1" || !body || !sig) return null;
  try {
    if (!sameBytes(fromB64url(sig), await hmac(env, body))) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return claims && claims.exp > Date.now() && claims.u ? claims : null;
  } catch (_) { return null; }
}

async function hashPassword(password, salt, iter) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
  return new Uint8Array(bits);
}

const isShared = async (env, user) => !!env.UPLOAD_USER && (await sameText(String(user).toLowerCase(), env.UPLOAD_USER.toLowerCase()));

async function getAccount(env, user) {
  if (!env.ACCOUNTS) return null;
  return env.ACCOUNTS.get(accountKey(user), "json");
}

// Checks a username and password. Returns { user, admin } or { pending: true } or null.
async function checkPassword(env, user, password) {
  if (await isShared(env, user)) {
    return env.UPLOAD_PASSWORD && (await sameText(password, env.UPLOAD_PASSWORD))
      ? { user: env.UPLOAD_USER, admin: true } : null;
  }
  const acct = await getAccount(env, user);
  if (!acct) return null;
  const hash = await hashPassword(password, fromB64url(acct.salt), acct.iter || PBKDF2_ITER);
  if (!sameBytes(hash, fromB64url(acct.hash))) return null;
  if (acct.status !== "approved") return { pending: true };
  return { user: acct.name, admin: !!acct.admin };
}

// Who sent this request: { user, admin } or null. Accepts a session token
// (Bearer) or, for older copies of the site, the username and password (Basic).
async function authenticate(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (header.startsWith("Bearer ")) {
    const claims = await readToken(env, header.slice(7));
    if (!claims) return null;
    if (await isShared(env, claims.u)) return { user: env.UPLOAD_USER, admin: true };
    // Looked up each time, so removing an account or changing its role applies at once.
    const acct = await getAccount(env, claims.u);
    return acct && acct.status === "approved" ? { user: acct.name, admin: !!acct.admin } : null;
  }
  if (header.startsWith("Basic ")) {
    let decoded;
    try { decoded = b64decode(header.slice(6)); } catch (_) { return null; }
    const split = decoded.indexOf(":");
    if (split < 0) return null;
    const who = await checkPassword(env, decoded.slice(0, split), decoded.slice(split + 1));
    return who && !who.pending ? who : null;
  }
  return null;
}

async function handleLogin(request, env) {
  const header = request.headers.get("Authorization") || "";
  let user = "", password = "";
  try {
    const decoded = b64decode(header.replace(/^Basic /, ""));
    const split = decoded.indexOf(":");
    user = decoded.slice(0, split).trim();
    password = decoded.slice(split + 1);
  } catch (_) {}
  const who = user && password ? await checkPassword(env, user, password) : null;
  if (!who) return json({ error: "That username or password isn't right." }, 401);
  if (who.pending) return json({ error: "This account is waiting for approval.", pending: true }, 403);
  const { token, exp } = await makeToken(env, who.user);
  return json({ ok: true, user: who.user, admin: who.admin, token, exp });
}

// Best effort: a push to the admin's phone (e.g. an ntfy.sh topic URL) so a new
// sign-up doesn't sit unnoticed. Set NOTIFY_URL as a Worker secret to turn it on.
async function notifyAdmins(env, text) {
  if (!env.NOTIFY_URL) return;
  await fetch(env.NOTIFY_URL, { method: "POST", body: text, headers: { Title: "Vale Trails" } }).catch(() => {});
}

async function handleRegister(request, env) {
  if (!env.ACCOUNTS) return json({ error: "Sign-ups aren't turned on yet." }, 503);
  const payload = await request.json().catch(() => null);
  const user = String((payload && payload.user) || "").trim();
  const password = String((payload && payload.password) || "");
  if (!USERNAME.test(user)) {
    return json({ error: "Usernames are 3–24 letters, numbers, dots, dashes or underscores." }, 400);
  }
  if (password.length < 8 || password.length > 200) return json({ error: "Use a password of at least 8 characters." }, 400);
  if ((await isShared(env, user)) || (await getAccount(env, user))) return json({ error: "That username is taken." }, 409);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt, PBKDF2_ITER);
  await env.ACCOUNTS.put(accountKey(user), JSON.stringify({
    name: user, salt: b64url(salt), hash: b64url(hash), iter: PBKDF2_ITER,
    status: "pending", admin: false, created: new Date().toISOString(),
  }));
  await notifyAdmins(env, `${user} asked for a Vale Trails account. Open the site to approve or decline.`);
  return json({ ok: true, pending: true });
}

async function listAccounts(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.ACCOUNTS.list({ prefix: "user:", cursor });
    const rows = await Promise.all(page.keys.map((k) => env.ACCOUNTS.get(k.name, "json")));
    for (const a of rows) {
      if (a) out.push({ name: a.name, status: a.status, admin: !!a.admin, created: a.created, approvedBy: a.approvedBy || null });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "pending" ? -1 : 1));
}

// Admins approve, decline/remove, and promote or demote accounts.
async function handleAccounts(request, env, who) {
  if (!who.admin) return json({ error: "Only an admin can manage accounts." }, 403);
  if (!env.ACCOUNTS) return json({ accounts: [], enabled: false });
  if (request.method === "GET") return json({ accounts: await listAccounts(env), enabled: true });
  const payload = await request.json().catch(() => null);
  const user = String((payload && payload.user) || "");
  const action = payload && payload.action;
  const acct = await getAccount(env, user);
  if (!acct) return json({ error: "No such account." }, 404);
  if (action === "remove") {
    await env.ACCOUNTS.delete(accountKey(user));
  } else if (action === "approve" || action === "admin" || action === "unadmin") {
    if (action === "approve") { acct.status = "approved"; acct.approvedBy = who.user; }
    if (action === "admin") acct.admin = true;
    if (action === "unadmin") acct.admin = false;
    await env.ACCOUNTS.put(accountKey(user), JSON.stringify(acct));
  } else {
    return json({ error: "Unknown action." }, 400);
  }
  return json({ ok: true, accounts: await listAccounts(env), enabled: true });
}

// Per-IP rate limiting through a Workers Rate Limiting binding (wrangler.toml).
// The password has to be checked before we know whether a request was a guess, so
// every request to a signed-in route counts. The login route gets the tight limit;
// the other writes get a looser one so a quick Identify session isn't throttled.
// Without the binding (local dev, older deploy) nothing is limited.
async function overLimit(env, name, request) {
  const limiter = env[name];
  if (!limiter || typeof limiter.limit !== "function") return false;
  const key = request.headers.get("CF-Connecting-IP") || "unknown";
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch (_) {
    return false;
  }
}

async function bucketBytes(env) {
  let used = 0;
  let cursor;
  do {
    const page = await env.PHOTOS.list({ cursor });
    for (const object of page.objects) used += object.size;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return used;
}

// Decide the type from the file's own bytes, never from what the client claims.
function sniffMedia(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { media: "photo", ext: "jpg", type: "image/jpeg" };
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { media: "video", ext: "webm", type: "video/webm" };
  }
  const text = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  if (text(4, 8) === "ftyp") {
    return text(8, 12) === "qt  "
      ? { media: "video", ext: "mov", type: "video/quicktime" }
      : { media: "video", ext: "mp4", type: "video/mp4" };
  }
  return null;
}

const cleanComment = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

// A capture date the client claims: must parse and not sit in the future.
function cleanDate(value, fallback = Date.now()) {
  const now = Date.now();
  const taken = Date.parse(value || "");
  return new Date(Number.isNaN(taken) || taken > now + 86400000 ? fallback : taken).toISOString();
}

function addComment(data, photo, text, author) {
  const list = Array.isArray(data[photo]) ? data[photo] : [];
  list.push({ id: crypto.randomUUID(), text, author: author || "", at: new Date().toISOString() });
  data[photo] = list.slice(-MAX_COMMENTS);
}

async function handleComment(request, env) {
  const payload = await request.json().catch(() => null);
  const photo = payload && String(payload.photo || "");
  if (!/^[\w-]{1,80}$/.test(photo || "")) return json({ error: "Missing photo." }, 400);
  const text = cleanComment(payload.text, 500);
  if (!payload.remove && !text) return json({ error: "Empty comment." }, 400);
  const result = await saveEntry(env, COMMENTS_FILE, (data) => {
    if (payload.remove) {
      const left = (data[photo] || []).filter((c) => c.id !== payload.remove);
      if (left.length) data[photo] = left; else delete data[photo];
    } else {
      addComment(data, photo, text, cleanComment(payload.author, 40));
    }
  }, `Update comments on ${photo}`);
  return result.ok ? json({ ok: true, comments: result.data[photo] || [] }) : json({ error: result.error }, result.status);
}

// A small preview the site shows in photo grids. The browser makes it (a Worker has
// no image library) and sends it first, under an id it generated, so the upload
// that follows can list the preview in the same commit.
async function handleThumb(request, env) {
  if (!env.PHOTOS || !env.R2_PUBLIC_BASE_URL) return json({ error: "Photo storage isn't set up." }, 503);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!UPLOAD_ID.test(id)) return json({ error: "Bad id." }, 400);
  const bytes = new Uint8Array(await request.arrayBuffer());
  const kind = sniffMedia(bytes);
  if (!kind || kind.media !== "photo") return json({ error: "Previews must be JPEG." }, 415);
  if (bytes.length > MAX_THUMB_BYTES) return json({ error: "Preview too large." }, 413);
  if ((await bucketBytes(env)) + bytes.length > R2_STOP_BYTES) return json({ error: "Photo storage is full." }, 507);
  await env.PHOTOS.put(`${id}_t.jpg`, bytes, {
    httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
  });
  return json({ ok: true, id });
}

async function handleUpload(request, env) {
  if (!env.PHOTOS || !env.R2_PUBLIC_BASE_URL) return json({ error: "Photo storage isn't set up." }, 503);
  const bytes = new Uint8Array(await request.arrayBuffer());
  const kind = sniffMedia(bytes);
  if (!kind) return json({ error: "Only JPEG photos and MP4, MOV or WebM videos are accepted." }, 415);
  if (bytes.length > (kind.media === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
    return json({ error: "File too large." }, 413);
  }
  // A failed count throws to the caller, so an unknown usage blocks the upload.
  if ((await bucketBytes(env)) + bytes.length > R2_STOP_BYTES) {
    return json({ error: "Photo storage is full." }, 507);
  }
  const query = new URL(request.url).searchParams;
  const base = env.R2_PUBLIC_BASE_URL.replace(/\/$/, "");
  const wanted = query.get("id") || "";
  const id = UPLOAD_ID.test(wanted) ? wanted : `up_${crypto.randomUUID()}`;
  const key = `${id}.${kind.ext}`;
  if (await env.PHOTOS.head(key)) return json({ error: "That id is already used." }, 409);
  await env.PHOTOS.put(key, bytes, {
    httpMetadata: { contentType: kind.type, cacheControl: "public, max-age=31536000, immutable" },
  });
  const buck = cleanName(query.get("buck")).slice(0, 40);
  const record = {
    id,
    date: cleanDate(query.get("date")),
    media: kind.media,
    image: `${base}/${key}`,
    camera: cleanName(query.get("camera")) || "Other camera",
    species: buck ? "Buck" : cleanTags([query.get("species")])[0] || "Animal",
  };
  // Only list a preview that really exists, so a tile can never point at nothing.
  if (query.get("thumb") === "1" && (await env.PHOTOS.head(`${id}_t.jpg`))) {
    record.thumb = `${base}/${id}_t.jpg`;
  }
  const result = await saveEntry(env, UPLOADS_FILE, (data) => { data[id] = record; }, `Add uploaded photo ${id}`);
  if (!result.ok) {
    await env.PHOTOS.delete(key);
    return json({ error: result.error }, result.status);
  }
  const comment = cleanComment(query.get("comment"), 500);
  if (comment) {
    const author = cleanComment(query.get("author"), 40);
    await saveEntry(env, COMMENTS_FILE, (data) => addComment(data, id, comment, author), `Comment on ${id}`);
  }
  if (buck) {
    await saveEntry(env, META_FILE, (data) => { data[id] = applyMetaPatch(data[id], { buck }); }, `Name buck on ${id}`);
  }
  // Publish right away. If this fails, the next scheduled run picks the photo up.
  await dispatchUpdate(env).catch(() => {});
  return json({ ok: true, id, image: record.image, thumb: record.thumb || null });
}

// Fix an upload's camera, date or animal, or remove it (file, preview, and every
// note, tag and comment attached to it). The login is shared, so anyone signed in
// can edit any upload.
async function handleUploadEdit(request, env) {
  const payload = await request.json().catch(() => null);
  const id = payload && String(payload.id || "");
  if (!UPLOAD_ID.test(id)) return json({ error: "Missing id." }, 400);

  if (payload.remove) {
    let record = null;
    const result = await saveEntry(env, UPLOADS_FILE, (data) => {
      record = data[id] || null;
      if (!record) return false;
      delete data[id];
    }, `Remove uploaded photo ${id}`);
    if (!result.ok) return json({ error: result.error }, result.status);
    if (record && env.PHOTOS) {
      const keys = [`${id}_t.jpg`];
      try { keys.push(decodeURIComponent(new URL(record.image).pathname.slice(1))); } catch (_) {}
      await Promise.all(keys.map((k) => env.PHOTOS.delete(k).catch(() => {})));
    }
    const drop = (data) => { if (!(id in data)) return false; delete data[id]; };
    await saveEntry(env, COMMENTS_FILE, drop, `Remove comments on ${id}`);
    await saveEntry(env, TAGS_FILE, drop, `Remove tags on ${id}`);
    await saveEntry(env, META_FILE, drop, `Remove metadata on ${id}`);
    await dispatchUpdate(env).catch(() => {});
    return json({ ok: true, id, removed: true });
  }

  let record = null;
  const result = await saveEntry(env, UPLOADS_FILE, (data) => {
    const cur = data[id];
    if (!cur) return false;
    if (payload.camera != null) cur.camera = cleanName(payload.camera) || "Other camera";
    if (payload.date != null) cur.date = cleanDate(payload.date, Date.parse(cur.date) || Date.now());
    if (payload.species != null) cur.species = cleanTags([payload.species])[0] || "Animal";
    record = cur;
  }, `Edit uploaded photo ${id}`);
  if (!result.ok) return json({ error: result.error }, result.status);
  if (!record) return json({ error: "No such upload." }, 404);
  await dispatchUpdate(env).catch(() => {});
  return json({ ok: true, upload: record });
}

/* ---------------------------- Push notifications ---------------------------
   Standard Web Push: phones get alerts on the lock screen with the app closed.
   - Each phone subscribes from the app (signed in) with the species it wants;
     the subscription lives in the ACCOUNTS KV namespace under "push:<hash>".
   - After each publish the GitHub workflow (push_alerts.py) POSTs the new sightings
     to /push/notify with PUSH_SECRET; this sends one notification per sighting to
     every phone that chose that species.
   Keys: VAPID_PUBLIC_KEY (var) and VAPID_PRIVATE_KEY (secret), made once with
   `node make-vapid-keys.mjs`. Messages are encrypted per phone (RFC 8291, aes128gcm)
   and signed with the VAPID key (RFC 8292), all with WebCrypto. */
const PUSH_MAX_PER_PHONE = 3; // more sightings than this in one publish become a summary
const PUSH_SPECIES_MAX = 24;
const enc = new TextEncoder();
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
const pushKey = async (endpoint) =>
  "push:" + b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(endpoint)))).slice(0, 32);

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

// RFC 8291: encrypt one message for one subscription. Returns the request body.
async function encryptPush(sub, plaintext) {
  const uaPublic = fromB64url(sub.keys.p256dh);
  const authSecret = fromB64url(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce },
    aes, concat(enc.encode(plaintext), new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

// RFC 8292: a short-lived signed token proving the sender owns the VAPID key.
async function vapidHeader(env, endpoint) {
  const pub = fromB64url(env.VAPID_PUBLIC_KEY);
  const key = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", d: env.VAPID_PRIVATE_KEY,
    x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)),
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const part = (o) => b64url(enc.encode(JSON.stringify(o)));
  const subject = env.VAPID_SUBJECT || `https://${String(env.GITHUB_OWNER).toLowerCase()}.github.io/${env.GITHUB_REPO}/`;
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject,
  })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Send one message. Returns "ok", "gone" (the phone unsubscribed) or "error".
async function sendPush(env, sub, message) {
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidHeader(env, sub.endpoint),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
    },
    body: await encryptPush(sub, JSON.stringify(message)),
  });
  if (res.status === 404 || res.status === 410) return "gone";
  return res.ok ? "ok" : "error";
}

const pushReady = (env) => !!(env.ACCOUNTS && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

// Only real push services, so the Worker can never be pointed at an arbitrary URL.
const PUSH_HOSTS = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;
function cleanSubscription(raw) {
  try {
    const url = new URL(String(raw.endpoint));
    if (url.protocol !== "https:" || !PUSH_HOSTS.test(url.hostname)) return null;
    const p256dh = String(raw.keys.p256dh), auth = String(raw.keys.auth);
    if (fromB64url(p256dh).length !== 65 || fromB64url(auth).length !== 16) return null;
    return { endpoint: url.href, keys: { p256dh, auth } };
  } catch (_) { return null; }
}

// A phone turns alerts on, changes its species, or turns them off.
async function handlePushPrefs(request, env, who, path) {
  if (!pushReady(env)) return json({ error: "Alerts aren't set up on the server yet." }, 503);
  const payload = await request.json().catch(() => null);
  const sub = payload && cleanSubscription(payload.subscription || {});
  if (!sub) return json({ error: "That phone's subscription isn't valid." }, 400);
  const key = await pushKey(sub.endpoint);
  if (path === "/push/unsubscribe") {
    await env.ACCOUNTS.delete(key);
    return json({ ok: true });
  }
  const species = cleanTags(Array.isArray(payload.species) ? payload.species : []).slice(0, PUSH_SPECIES_MAX);
  await env.ACCOUNTS.put(key, JSON.stringify({ sub, species, user: who.user, updated: new Date().toISOString() }));
  return json({ ok: true, species });
}

// From the workflow: { sightings: [{ species, title, body, url, tag }] }. Sends each
// phone the sightings for its species: one notification each, or a summary.
async function handlePushNotify(request, env) {
  if (!pushReady(env) || !env.PUSH_SECRET) return json({ error: "Alerts aren't set up." }, 503);
  const header = request.headers.get("Authorization") || "";
  if (!(await sameText(header, "Bearer " + env.PUSH_SECRET))) return json({ error: "Not allowed." }, 401);
  const payload = await request.json().catch(() => null);
  const sightings = (payload && Array.isArray(payload.sightings) ? payload.sightings : []).slice(0, 50)
    .map((s) => ({
      species: String(s.species || ""), title: String(s.title || "").slice(0, 120),
      body: String(s.body || "").slice(0, 200), url: String(s.url || ""), tag: String(s.tag || "").slice(0, 80),
    }))
    .filter((s) => s.species && s.title);
  if (!sightings.length) return json({ ok: true, sent: 0 });

  let sent = 0, removed = 0, failed = 0;
  let cursor;
  do {
    const page = await env.ACCOUNTS.list({ prefix: "push:", cursor });
    for (const k of page.keys) {
      const entry = await env.ACCOUNTS.get(k.name, "json");
      if (!entry || !entry.sub) continue;
      const wanted = new Set(entry.species || []);
      const mine = sightings.filter((s) => wanted.has(s.species));
      if (!mine.length) continue;
      let messages = mine;
      if (mine.length > PUSH_MAX_PER_PHONE) {
        const counts = {};
        for (const s of mine) counts[s.species] = (counts[s.species] || 0) + 1;
        messages = [{
          title: `${mine.length} new sightings`,
          body: Object.entries(counts).map(([sp, n]) => `${n} ${sp}`).join(", "),
          url: mine[0].url.replace(/#.*$/, ""), tag: "summary",
        }];
      }
      for (const m of messages) {
        const r = await sendPush(env, entry.sub, m).catch(() => "error");
        if (r === "ok") sent++;
        else if (r === "gone") { await env.ACCOUNTS.delete(k.name); removed++; break; }
        else failed++;
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return json({ ok: true, sent, removed, failed });
}

export default {
  // Cron Trigger (wrangler.toml): GitHub's own cron is heavily throttled on this repo.
  async scheduled(event, env) {
    await dispatchUpdate(env);
  },

  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
      return json({ error: "Worker is missing GITHUB_TOKEN/OWNER/REPO variables." }, 500);
    }

    // Route by path: /cameras -> camera names, /meta -> per-photo metadata,
    // everything else -> photo tags.
    const path = new URL(request.url).pathname.replace(/\/+$/, "").toLowerCase();
    const isCameras = path === "/cameras" || path === "/camera-names";
    const isMeta = path === "/meta" || path === "/metadata";

    try {
      // The public key phones subscribe with (public by design).
      if (request.method === "GET" && path === "/push/key") {
        return json({ enabled: pushReady(env), publicKey: pushReady(env) ? env.VAPID_PUBLIC_KEY : null });
      }
      if (request.method === "GET" && path !== "/accounts") {
        const file = path === "/comments" ? COMMENTS_FILE : isCameras ? CAMERA_FILE : isMeta ? META_FILE : TAGS_FILE;
        const { data } = await readFile(env, file);
        return json(data);
      }

      if (request.method !== "POST" && request.method !== "GET") return json({ error: "Method not allowed." }, 405);

      // Every write is signed in. Reads above stay public.
      const strict = path === "/login" || path === "/register";
      if (await overLimit(env, strict ? "LOGIN_LIMITER" : "WRITE_LIMITER", request)) {
        return json({ error: "Too many attempts. Wait a minute and try again." }, 429);
      }
      if (path === "/login") return await handleLogin(request, env);
      if (path === "/register") return await handleRegister(request, env);
      // The workflow's own key (PUSH_SECRET), not a person's sign-in.
      if (path === "/push/notify" && request.method === "POST") return await handlePushNotify(request, env);

      const who = await authenticate(request, env);
      if (!who) return json({ error: "Sign in to save changes." }, 401);

      if (path === "/accounts") return await handleAccounts(request, env, who);
      if ((path === "/push/subscribe" || path === "/push/unsubscribe") && request.method === "POST") {
        return await handlePushPrefs(request, env, who, path);
      }
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (path === "/thumb") return await handleThumb(request, env);
      if (path === "/upload") return await handleUpload(request, env);
      if (path === "/uploads") return await handleUploadEdit(request, env);
      if (path === "/comments") return await handleComment(request, env);

      const payload = await request.json().catch(() => null);

      // Bulk tagging is one commit: separate saves would all race for the same file.
      if (!isCameras && !isMeta && payload && payload.items && typeof payload.items === "object") {
        const entries = Object.entries(payload.items);
        if (!entries.length) return json({ error: "No items." }, 400);
        if (entries.length > BATCH_MAX) return json({ error: "Too many items." }, 413);
        const result = await saveEntry(env, TAGS_FILE,
          (data) => {
            for (const [id, tags] of entries) {
              const clean = cleanTags(tags);
              if (clean.length) data[id] = clean; else delete data[id];
            }
          },
          `Update tags for ${entries.length} photos`);
        return result.ok ? json({ ok: true, tags: result.data }) : json({ error: result.error }, result.status);
      }

      if (!payload || !payload.id) return json({ error: "Missing id." }, 400);
      const id = String(payload.id);

      if (isCameras) {
        const name = cleanName(payload.name);
        const result = await saveEntry(env, CAMERA_FILE,
          (data) => { if (name) data[id] = name; else delete data[id]; },
          `Rename camera ${id}`);
        return result.ok ? json({ ok: true, names: result.data }) : json({ error: result.error }, result.status);
      }

      if (isMeta) {
        const patch = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
        const result = await saveEntry(env, META_FILE,
          (data) => {
            const entry = applyMetaPatch(data[id], patch);
            if (Object.keys(entry).length) data[id] = entry;
            else delete data[id];
          },
          `Update metadata for ${id}`);
        return result.ok ? json({ ok: true, meta: result.data }) : json({ error: result.error }, result.status);
      }

      const newTags = cleanTags(payload.tags);
      const result = await saveEntry(env, TAGS_FILE,
        (data) => { if (newTags.length) data[id] = newTags; else delete data[id]; },
        `Update tags for ${id}`);
      return result.ok ? json({ ok: true, tags: result.data }) : json({ error: result.error }, result.status);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500);
    }
  },
};
