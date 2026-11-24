// TrailHub sync Worker (Cloudflare Workers, free tier).
// ---------------------------------------------------------------------------
// PURPOSE
//   The site's private back end. GitHub Pages serves only the app itself; every
//   photo, the photo list (data.js) and the family's edits (tags, camera names,
//   notes, comments, uploads) live in the PHOTOS R2 bucket, which has no public
//   address, and this Worker hands them out to signed-in people only ("Private
//   storage" below). pull.py bakes the edits into data.js on its next run, and the
//   site also reads them live right away.
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
//     ACCOUNTS         (KV binding, optional) turns on personal accounts + sign-up approval
//   Then copy the Worker URL into config.js:  window.TRAILHUB_TAGS_API = "https://...workers.dev";
//
// ACCESS
//   Everything needs a sign-in, reading included; only signing in, asking for an
//   account and the push key are open. Sign-in attempts are rate limited per IP
//   (LOGIN_LIMITER / WRITE_LIMITER in wrangler.toml).
//
// API
//   GET  /data        -> data.js (the photo list)
//   GET  /media-token -> { token, exp }: a photo pass, so <img> tags can load photos
//   GET  /media/<key>?m=<photo pass>  one photo or video (byte ranges supported)
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
//                     ("remove" with "uploads": true also deletes everything they uploaded)
//   POST /passkey/options   { purpose: "login"|"signup"|"add", user? } -> a Face ID challenge + ticket
//   POST /passkey/register  { purpose, ticket, credential, label } saves a passkey
//   POST /passkey/login     { ticket, credential } -> same answer as /login
//   GET  /passkeys          this account's Face ID sign-ins; POST { remove: id } removes one
//   GET  /password          { shared, hasPassword } for the signed-in account
//   POST /password          { current, password } -> a fresh session like /login; signs
//                           out the account's other devices
//   Writes take "Authorization: Bearer <token>" (or Basic, for older copies of the site).
//   POST /thumb       ?id=up_<uuid>  body: a small JPEG preview, stored as <id>_t.jpg
//   POST /upload      stores one JPEG or video in R2 and lists it in uploads.json;
//                     body is the file; query has id (optional, from /thumb), date,
//                     camera, species, and optionally comment, author, buck, thumb=1
//   POST /uploads     with { "id": "up_...", "camera": "...", "date": "...", "species": "..." }
//                     to edit an upload, or { "id": "up_...", "remove": true } to delete it
//                     (only the person who added it, or an admin)
//   GET  /comments    -> { "<photoId>": [{ id, text, author, at }], ... }
//   POST /comments    with { "photo": "...", "text": "...", "author": "..." }
//                     or { "photo": "...", "remove": "<commentId>" }
// ---------------------------------------------------------------------------

// Each resource maps a request path to a JSON file in private storage. pull.py
// bakes tags.json + metadata.json into data.js; the site reads them live through
// this Worker for instant updates.
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
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// UTF-8 safe base64 decoding (sign-ins and repo files may hold non-ASCII text).
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

/* ---------------------------- Private storage -----------------------------
   Everything the site shows is private: it lives in the PHOTOS R2 bucket, which
   has no public address, and this Worker hands it only to signed-in people.
   - "state/<file>": data.js from the photo job (the workflow writes it), and the
     JSON files edited from the site (tags, notes, comments, camera names, uploads).
   - every other key: a photo, its small copy, or an uploaded video (/media/).
   Nothing is ever read from the (public) repo: a file that isn't here yet starts
   empty. */
const STATE_PREFIX = "state/";

async function readFile(env, path) {
  const obj = await env.PHOTOS.get(STATE_PREFIX + path);
  if (!obj) return { data: {}, etag: null };
  let data = {};
  try {
    const parsed = JSON.parse(await obj.text());
    if (parsed && typeof parsed === "object") data = parsed;
  } catch (_) {}
  return { data, etag: obj.etag };
}

// Saves only if nobody else saved since `etag` was read; false when someone did.
async function writeFile(env, path, data, etag) {
  const options = { httpMetadata: { contentType: "application/json", cacheControl: "no-store" } };
  if (etag) options.onlyIf = { etagMatches: etag };
  const put = await env.PHOTOS.put(STATE_PREFIX + path, JSON.stringify(data, null, 1) + "\n", options);
  return !!put;
}

// Read-modify-write with retries to survive concurrent edits. `mutate(data)`
// edits the map in place; returning false from it means "nothing to change".
// (The last argument, once a commit message, is no longer used.)
async function saveEntry(env, path, mutate, _message) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, etag } = await readFile(env, path);
    if (mutate(data) === false) return { ok: true, data, unchanged: true };
    if (await writeFile(env, path, data, etag)) return { ok: true, data };
  }
  return { ok: false, status: 409, error: "Conflict after retries, please try again." };
}

// data.js as the photo job last wrote it.
async function readDataScript(env) {
  const obj = await env.PHOTOS.get(STATE_PREFIX + "data.js");
  return obj ? obj.text() : "window.TRAILHUB_DATA = {};\n";
}

/* Photos and videos: GET /media/<key>?m=<photo pass>. An <img> or <video> can't
   send a sign-in header, so the app asks for a photo pass (GET /media-token): a
   signed, read-only key that lasts MEDIA_DAYS and is checked against the account
   on every request, so removing someone or changing their password stops it. */
const MEDIA_DAYS = 7;
async function makeMediaToken(env, user) {
  const exp = Date.now() + MEDIA_DAYS * 86400000;
  const body = b64url(new TextEncoder().encode(JSON.stringify({ u: user, iat: Date.now(), exp })));
  return { token: `m1.${body}.${b64url(await hmac(env, "media:" + body))}`, exp };
}
async function mediaViewer(env, request, url) {
  const m = url.searchParams.get("m");
  if (!m) return authenticate(request, env);
  const [v, body, sig] = m.split(".");
  if (v !== "m1" || !body || !sig) return null;
  try {
    if (!sameBytes(fromB64url(sig), await hmac(env, "media:" + body))) return null;
    const c = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (!c || !c.u || !(c.exp > Date.now())) return null;
    if (await isShared(env, c.u)) return { user: env.UPLOAD_USER };
    const acct = await getAccount(env, c.u);
    if (!acct || acct.status !== "approved") return null;
    if (acct.sessionsFrom && c.iat < acct.sessionsFrom) return null;
    return { user: acct.name };
  } catch (_) { return null; }
}

// Serves one photo or video, with byte ranges (iPhones play video in pieces).
async function handleMedia(request, env, url) {
  let key = "";
  try { key = decodeURIComponent(url.pathname.slice("/media/".length)); } catch (_) {}
  if (!key || key.startsWith(STATE_PREFIX) || key.includes("..")) return new Response("Not found", { status: 404, headers: CORS });
  if (!(await mediaViewer(env, request, url))) return new Response("Sign in to see photos.", { status: 401, headers: CORS });
  let range;
  const asked = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range") || "");
  if (asked && (asked[1] || asked[2])) {
    if (asked[1]) {
      const offset = Number(asked[1]);
      range = asked[2] ? { offset, length: Number(asked[2]) - offset + 1 } : { offset };
    } else {
      range = { suffix: Number(asked[2]) };
    }
  }
  const obj = await env.PHOTOS.get(key, range ? { range } : undefined);
  if (!obj) return new Response("Not found", { status: 404, headers: CORS });
  const headers = new Headers(CORS);
  headers.set("Content-Type", (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream");
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  if (!range) {
    headers.set("Content-Length", String(obj.size));
    return new Response(obj.body, { status: 200, headers });
  }
  const start = range.suffix != null ? Math.max(0, obj.size - range.suffix) : range.offset;
  const end = range.length != null ? Math.min(obj.size - 1, start + range.length - 1) : obj.size - 1;
  if (start >= obj.size || end < start) {
    return new Response("Range not satisfiable", { status: 416, headers: { ...CORS, "Content-Range": `bytes */${obj.size}` } });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${obj.size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(obj.body, { status: 206, headers });
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
// Usernames: 3–32 letters, numbers, spaces and . _ - @ ' (so a full name or an
// email address works), starting with a letter or number. Plain ASCII only, so no
// lookalike letters from other alphabets. The iPhone keyboard's curly apostrophes
// and long dashes count as plain ones, and runs of spaces as one. Names are
// case-insensitive: the key is the cleaned, lowercased name.
// NFKC turns the iPhone's "…" into "..." and full-width punctuation into plain;
// the rest catches what NFKC keeps: curly apostrophes, dashes and minus signs, and
// invisible zero-width characters.
const cleanUsername = (s) => String(s || "").normalize("NFKC")
  .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
  .replace(/[\u2018\u2019\u02BC\u0060]/g, "'")
  .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
  .replace(/\s+/g, " ").trim();
// What's wrong with a (cleaned) username, said plainly, or "" if nothing.
function usernameProblem(name) {
  const n = name.length;
  if (n < 3) return n ? `"${name}" is too short. Usernames need at least 3 characters.` : "Choose a username.";
  if (n > 32) return `That username is ${n} characters. Use at most 32.`;
  const bad = [...new Set(name.replace(/[a-z0-9 ._@'-]/gi, ""))];
  if (bad.length) return `Usernames can't use ${bad.map((c) => `"${c}"`).join(" ")}. Use letters, numbers, spaces and . _ - @ '`;
  if (!/^[a-z0-9]/i.test(name)) return "Start the username with a letter or number.";
  return "";
}
const accountKey = (name) => "user:" + cleanUsername(name).toLowerCase();

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

/* Passwords: any characters at all (spaces, symbols, emoji, any language), 8 to
   PASSWORD_MAX of them, counted as characters (an emoji is one). Nothing is
   trimmed or changed except Unicode normalization (NFC), so an accented letter
   typed on another device or keyboard still matches. Hashes made before that are
   checked against the password exactly as typed too. */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 256;
const passwordProblem = (pw) => {
  const n = [...pw].length;
  if (n < PASSWORD_MIN) return `Use a password of at least ${PASSWORD_MIN} characters.`;
  if (n > PASSWORD_MAX) return `Use a password of at most ${PASSWORD_MAX} characters.`;
  return null;
};
const hashNewPassword = async (pw) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(pw.normalize("NFC"), salt, PBKDF2_ITER);
  return { salt: b64url(salt), hash: b64url(hash), iter: PBKDF2_ITER };
};
async function passwordMatches(acct, pw) {
  const salt = fromB64url(acct.salt), want = fromB64url(acct.hash), iter = acct.iter || PBKDF2_ITER;
  if (sameBytes(await hashPassword(pw.normalize("NFC"), salt, iter), want)) return true;
  return pw.normalize("NFC") !== pw && sameBytes(await hashPassword(pw, salt, iter), want);
}

// Checks a username and password. Returns { user, admin } or { pending: true } or null.
async function checkPassword(env, user, password) {
  if (await isShared(env, user)) {
    return env.UPLOAD_PASSWORD && (await sameText(password, env.UPLOAD_PASSWORD))
      ? { user: env.UPLOAD_USER, admin: true } : null;
  }
  const acct = await getAccount(env, user);
  if (!acct || !acct.hash) return null; // no account, or one that only uses Face ID
  if (!(await passwordMatches(acct, password))) return null;
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
    if (!acct || acct.status !== "approved") return null;
    // Sessions from before a password change are signed out (see handlePassword).
    if (acct.sessionsFrom && claims.exp - SESSION_DAYS * 86400000 < acct.sessionsFrom) return null;
    return { user: acct.name, admin: !!acct.admin };
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

// Your own password. GET says whether the account has one (an account made with
// Face ID may not). POST { current, password } changes it; an account without one
// sets it with no current password. Every other device signed in to the account is
// signed out, and this one gets a fresh session. The shared login's password is the
// UPLOAD_PASSWORD secret, so it can't be changed here.
async function handlePassword(request, env, who) {
  const shared = await isShared(env, who.user);
  const acct = shared ? null : await getAccount(env, who.user);
  if (request.method === "GET") return json({ shared, hasPassword: shared || !!(acct && acct.hash) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (shared) {
    return json({ error: "The shared login's password is set in the Worker's settings (UPLOAD_PASSWORD)." }, 400);
  }
  if (!acct) return json({ error: "No such account." }, 404);
  const payload = await request.json().catch(() => null);
  const current = String((payload && payload.current) || "");
  const password = String((payload && payload.password) || "");
  if (acct.hash && !(await passwordMatches(acct, current))) return json({ error: "Your current password isn't right." }, 403);
  const problem = passwordProblem(password);
  if (problem) return json({ error: problem }, 400);
  Object.assign(acct, await hashNewPassword(password));
  acct.sessionsFrom = Date.now();
  await env.ACCOUNTS.put(accountKey(acct.name), JSON.stringify(acct));
  const { token, exp } = await makeToken(env, acct.name);
  return json({ ok: true, user: acct.name, admin: !!acct.admin, token, exp });
}

// Best effort: a push alert to every admin's phone that has alerts turned on, so a
// new sign-up doesn't sit unnoticed. Uses the same Web Push as sighting alerts.
async function notifyAdmins(env, text) {
  if (!pushReady(env)) return;
  const isAdmin = {};
  let cursor;
  do {
    const page = await env.ACCOUNTS.list({ prefix: "push:", cursor });
    for (const k of page.keys) {
      const entry = await env.ACCOUNTS.get(k.name, "json");
      if (!entry || !entry.sub || !entry.user || inQuietHours(entry.quiet)) continue;
      const name = String(entry.user).toLowerCase();
      if (!(name in isAdmin)) {
        const shared = await isShared(env, name);
        const acct = shared ? null : await getAccount(env, name);
        isAdmin[name] = shared || !!(acct && acct.status === "approved" && acct.admin);
      }
      if (!isAdmin[name]) continue;
      const r = await sendPush(env, entry.sub, { title: "New account request", body: text, url: "./", tag: "signup" }).catch(() => "error");
      if (r === "gone") await env.ACCOUNTS.delete(k.name);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

/* ------------------------- Guarding new sign-ups --------------------------
   A new account can't sign in or change anything until an admin approves it.
   On top of that, so nobody can flood the list or the admins' phones:
   - names an admin could be mistaken for, or that only differ from an existing
     account by case, spaces or punctuation ("deer.hunter" vs "Deer Hunter"), are taken;
   - at most SIGNUP_PENDING_MAX requests wait at once;
   - a request nobody approves is deleted after SIGNUP_PENDING_DAYS;
   - admins get at most one sign-up alert per SIGNUP_ALERT_GAP_MS (the list in
     Manage accounts shows everyone waiting);
   - a form field people never see catches bots that fill in every box;
   - sign-ups share the login rate limit (5 a minute per address). */
const SIGNUP_PENDING_MAX = 25;
const SIGNUP_PENDING_DAYS = 14;
const SIGNUP_ALERT_GAP_MS = 10 * 60000;
const RESERVED_NAMES = new Set(["administrator", "root", "support", "system", "owner", "moderator", "mod",
  "help", "security", "staff", "official", "valetrails", "trailhub", "everyone", "null", "undefined"]);
const squashName = (name) => cleanUsername(name).toLowerCase().replace(/[^a-z0-9]/g, "");

// Whether a new account may take this (cleaned) name: null, or [error, status].
async function signupBlocked(env, user) {
  const bad = usernameProblem(user);
  if (bad) return [bad, 400];
  const sq = squashName(user);
  if (RESERVED_NAMES.has(sq) || sq.startsWith("admin") || (await isShared(env, user)) ||
      (env.UPLOAD_USER && squashName(env.UPLOAD_USER) === sq)) return ["That username is taken.", 409];
  const all = await listAccounts(env);
  if (all.some((a) => squashName(a.name) === sq)) return ["That username is taken.", 409];
  if (all.filter((a) => a.status === "pending").length >= SIGNUP_PENDING_MAX) {
    return ["Too many account requests are waiting right now. Ask an admin, or try again later.", 503];
  }
  return null;
}

// Saves a new account request. It expires unless an admin approves it (approving
// saves it again, which drops the expiry). Any Face ID sign-in left from an
// earlier, expired request for the same name is removed first, so it can never
// open this account.
async function savePending(env, record) {
  await dropEntriesFor(env, "cred:", record.name);
  await env.ACCOUNTS.put(accountKey(record.name), JSON.stringify(record), { expirationTtl: SIGNUP_PENDING_DAYS * 86400 });
}

async function notifySignup(env, user) {
  const last = Number(await env.ACCOUNTS.get("meta:signup-alert")) || 0;
  if (Date.now() - last < SIGNUP_ALERT_GAP_MS) return;
  await env.ACCOUNTS.put("meta:signup-alert", String(Date.now()));
  await notifyAdmins(env, `${user} asked for an account. Open the app to see who's waiting.`);
}

async function handleRegister(request, env) {
  if (!env.ACCOUNTS) return json({ error: "Sign-ups aren't turned on yet." }, 503);
  const payload = await request.json().catch(() => null);
  // The hidden field: a person never fills it in, so this is a bot. It's told the
  // request went through, so it has no reason to try anything else.
  if (payload && payload.website) return json({ ok: true, pending: true });
  const user = cleanUsername(payload && payload.user);
  const password = String((payload && payload.password) || "");
  const badName = usernameProblem(user);
  if (badName) return json({ error: badName }, 400);
  const problem = passwordProblem(password);
  if (problem) return json({ error: problem }, 400);
  const blocked = await signupBlocked(env, user);
  if (blocked) return json({ error: blocked[0] }, blocked[1]);
  await savePending(env, {
    name: user, ...(await hashNewPassword(password)),
    status: "pending", admin: false, created: new Date().toISOString(),
  });
  await notifySignup(env, user);
  return json({ ok: true, pending: true });
}

/* --------------------------- Face ID (passkeys) ---------------------------
   Sign in with Face ID / Touch ID instead of a password (WebAuthn passkeys). The
   phone makes a key pair: the private half stays in its keychain (and syncs with
   iCloud Keychain), and the Worker keeps the public half in ACCOUNTS as
   "cred:<id>" -> { user, jwk, counter, label, created }. Signing in means the
   phone signs a one-time challenge after Face ID.
   Challenges need no storage: each comes with a short-lived "ticket" signed like a
   session token, which the phone sends back with its answer.
   The site's address decides which passkeys belong to it. It defaults to the
   GitHub Pages address; set SITE_ORIGIN (and PASSKEY_RP_ID) if the site moves. */
const PASSKEY_TTL_MS = 3 * 60000;
const credKey = (id) => "cred:" + id;
const passkeyOrigins = (env) => (env.SITE_ORIGIN
  ? String(env.SITE_ORIGIN).split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean)
  : [`https://${String(env.GITHUB_OWNER).toLowerCase()}.github.io`]);
const passkeyRpId = (env) => env.PASSKEY_RP_ID || new URL(passkeyOrigins(env)[0]).hostname;
const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

async function makeTicket(env, purpose, user) {
  const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ c: challenge, p: purpose, u: user || "", exp: Date.now() + PASSKEY_TTL_MS })));
  return { challenge, ticket: `pk1.${body}.${b64url(await hmac(env, "pk:" + body))}` };
}

async function readTicket(env, ticket, purpose) {
  const [v, body, sig] = String(ticket || "").split(".");
  if (v !== "pk1" || !body || !sig) return null;
  try {
    if (!sameBytes(fromB64url(sig), await hmac(env, "pk:" + body))) return null;
    const t = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return t && t.p === purpose && t.exp > Date.now() ? t : null;
  } catch (_) { return null; }
}

// Just enough CBOR (RFC 8949) to read a passkey's registration data.
function cborDecode(bytes) {
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = (info) => {
    if (info < 24) return info;
    if (info === 24) return bytes[pos++];
    if (info === 25) { const v = view.getUint16(pos); pos += 2; return v; }
    if (info === 26) { const v = view.getUint32(pos); pos += 4; return v; }
    throw new Error("CBOR length not supported");
  };
  const item = () => {
    if (pos >= bytes.length) throw new Error("CBOR ended early");
    const first = bytes[pos++];
    const major = first >> 5, info = first & 31;
    if (major === 0) return len(info);
    if (major === 1) return -1 - len(info);
    if (major === 2 || major === 3) {
      const n = len(info);
      const v = bytes.slice(pos, pos + n);
      pos += n;
      return major === 2 ? v : new TextDecoder().decode(v);
    }
    if (major === 4) { const n = len(info); const a = []; for (let i = 0; i < n; i++) a.push(item()); return a; }
    if (major === 5) {
      const n = len(info);
      const m = new Map();
      for (let i = 0; i < n; i++) { const k = item(); m.set(k, item()); }
      return m;
    }
    if (major === 7 && (info === 20 || info === 21 || info === 22)) return info === 21 ? true : info === 20 ? false : null;
    throw new Error("CBOR type not supported");
  };
  return item();
}

// authenticatorData: rpIdHash(32) flags(1) counter(4) [aaguid(16) idLen(2) id key].
const UP = 0x01, UV = 0x04, AT = 0x40;
function parseAuthData(a) {
  if (a.length < 37) throw new Error("authData too short");
  const out = { rpIdHash: a.slice(0, 32), flags: a[32], counter: new DataView(a.buffer, a.byteOffset + 33, 4).getUint32(0) };
  if (out.flags & AT) {
    const idLen = (a[53] << 8) | a[54];
    out.credId = a.slice(55, 55 + idLen);
    out.cose = cborDecode(a.slice(55 + idLen));
  }
  return out;
}

// Only ES256 on P-256, which is what iPhones, Macs and Android phones make.
function coseToJwk(cose) {
  if (!(cose instanceof Map) || cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1) return null;
  const x = cose.get(-2), y = cose.get(-3);
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) return null;
  return { kty: "EC", crv: "P-256", x: b64url(x), y: b64url(y) };
}

// WebAuthn signatures are DER; WebCrypto wants r and s as 32 bytes each.
function derToRaw(der) {
  if (der[0] !== 0x30) throw new Error("Bad signature");
  let p = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2;
  const int = () => {
    if (der[p++] !== 0x02) throw new Error("Bad signature");
    const n = der[p++];
    let v = der.slice(p, p + n);
    p += n;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error("Bad signature");
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = int(), s = int();
  return concat(r, s);
}

// The parts every passkey answer must get right: the kind of request, our own
// challenge, this site's address, and Face ID actually used.
async function checkPasskeyAnswer(env, clientDataBytes, authData, type, challenge) {
  let cd;
  try { cd = JSON.parse(new TextDecoder().decode(clientDataBytes)); } catch (_) { return "Bad response."; }
  if (cd.type !== type || cd.challenge !== challenge) return "That sign-in expired. Try again.";
  if (!passkeyOrigins(env).includes(cd.origin)) return "Wrong site.";
  if (!sameBytes(authData.rpIdHash, await sha256(new TextEncoder().encode(passkeyRpId(env))))) return "Wrong site.";
  if (!(authData.flags & UP) || !(authData.flags & UV)) return "Face ID wasn't confirmed.";
  return null;
}

const passkeyUserId = async (user) => b64url((await sha256(new TextEncoder().encode("vt:" + String(user).toLowerCase()))).slice(0, 16));

async function listCreds(env, user) {
  const name = String(user).toLowerCase();
  const out = [];
  let cursor;
  do {
    const page = await env.ACCOUNTS.list({ prefix: "cred:", cursor });
    for (const k of page.keys) {
      const c = await env.ACCOUNTS.get(k.name, "json");
      if (c && String(c.user).toLowerCase() === name) out.push({ id: k.name.slice(5), label: c.label || "", created: c.created || null });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => String(a.created).localeCompare(String(b.created)));
}

// Step 1 of everything: a challenge. "login" and "signup" need no sign-in; "add"
// (turn on Face ID for the signed-in account) does.
async function handlePasskeyOptions(request, env) {
  if (!env.ACCOUNTS) return json({ error: "Face ID needs the ACCOUNTS namespace." }, 503);
  const payload = await request.json().catch(() => null);
  const purpose = payload && payload.purpose;
  const base = { rpId: passkeyRpId(env), expires: Date.now() + PASSKEY_TTL_MS - 15000 };
  if (purpose === "login") return json({ ...base, ...(await makeTicket(env, "login", "")) });
  if (purpose === "signup") {
    // The username is checked now, before the phone makes a passkey for it.
    const user = cleanUsername(payload.user);
    const blocked = await signupBlocked(env, user);
    if (blocked) return json({ error: blocked[0] }, blocked[1]);
    return json({ ...base, ...(await makeTicket(env, "signup", user)), user });
  }
  if (purpose !== "add") return json({ error: "Unknown purpose." }, 400);
  const who = await authenticate(request, env);
  if (!who) return json({ error: "Sign in first." }, 401);
  return json({
    ...base, ...(await makeTicket(env, "add", who.user)),
    user: who.user, userId: await passkeyUserId(who.user),
    exclude: (await listCreds(env, who.user)).map((c) => c.id),
  });
}

// Step 2a: save a new passkey, for the signed-in account ("add") or for a new
// account that waits for approval like any other sign-up ("signup").
async function handlePasskeyRegister(request, env) {
  if (!env.ACCOUNTS) return json({ error: "Face ID needs the ACCOUNTS namespace." }, 503);
  const payload = await request.json().catch(() => null);
  const cred = payload && payload.credential;
  const signup = payload && payload.purpose === "signup";
  const ticket = await readTicket(env, payload && payload.ticket, signup ? "signup" : "add");
  if (!ticket || !cred) return json({ error: "That took too long. Try again." }, 400);

  let user;
  if (signup) {
    user = cleanUsername(ticket.u);
    const blocked = await signupBlocked(env, user);
    if (blocked) return json({ error: blocked[0] }, blocked[1]);
  } else {
    const who = await authenticate(request, env);
    if (!who || who.user.toLowerCase() !== String(ticket.u).toLowerCase()) return json({ error: "Sign in first." }, 401);
    user = who.user;
  }

  let authData, jwk;
  try {
    const att = cborDecode(fromB64url(String(cred.attestationObject)));
    authData = parseAuthData(att.get("authData"));
    const problem = await checkPasskeyAnswer(env, fromB64url(String(cred.clientDataJSON)), authData, "webauthn.create", ticket.c);
    if (problem) return json({ error: problem }, 400);
    jwk = authData.cose && coseToJwk(authData.cose);
  } catch (_) {
    return json({ error: "That passkey couldn't be read." }, 400);
  }
  if (!jwk || !authData.credId) return json({ error: "This device's passkey type isn't supported." }, 400);
  const id = b64url(authData.credId);
  if (await env.ACCOUNTS.get(credKey(id))) return json({ error: "That passkey is already saved." }, 409);

  if (signup) await savePending(env, { name: user, status: "pending", admin: false, created: new Date().toISOString() });
  await env.ACCOUNTS.put(credKey(id), JSON.stringify({
    user, jwk, counter: authData.counter, label: cleanName(payload.label).slice(0, 40) || "Device",
    created: new Date().toISOString(),
  }));
  if (signup) {
    await notifySignup(env, user);
    return json({ ok: true, pending: true });
  }
  return json({ ok: true, passkeys: await listCreds(env, user) });
}

// Step 2b: sign in with a passkey. Answers like /login.
async function handlePasskeyLogin(request, env) {
  if (!env.ACCOUNTS) return json({ error: "Face ID needs the ACCOUNTS namespace." }, 503);
  const payload = await request.json().catch(() => null);
  const cred = payload && payload.credential;
  const ticket = await readTicket(env, payload && payload.ticket, "login");
  if (!ticket || !cred) return json({ error: "That took too long. Try again." }, 400);
  const id = String(cred.id || "");
  const saved = id && (await env.ACCOUNTS.get(credKey(id), "json"));
  if (!saved) return json({ error: "This Face ID isn't linked to an account here." }, 401);

  try {
    const authBytes = fromB64url(String(cred.authenticatorData));
    const clientBytes = fromB64url(String(cred.clientDataJSON));
    const authData = parseAuthData(authBytes);
    const problem = await checkPasskeyAnswer(env, clientBytes, authData, "webauthn.get", ticket.c);
    if (problem) return json({ error: problem }, 400);
    const key = await crypto.subtle.importKey("jwk", saved.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const signed = concat(authBytes, await sha256(clientBytes));
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(fromB64url(String(cred.signature))), signed);
    if (!ok) return json({ error: "Face ID didn't match." }, 401);
    // Synced passkeys (iCloud Keychain) always report 0; a device key that counts
    // must only go up, or the key was copied.
    if (authData.counter || saved.counter) {
      if (authData.counter <= (saved.counter || 0)) return json({ error: "Face ID didn't match." }, 401);
      saved.counter = authData.counter;
      await env.ACCOUNTS.put(credKey(id), JSON.stringify(saved));
    }
  } catch (_) {
    return json({ error: "That sign-in couldn't be read." }, 400);
  }

  let who;
  if (await isShared(env, saved.user)) {
    who = { user: env.UPLOAD_USER, admin: true };
  } else {
    const acct = await getAccount(env, saved.user);
    if (!acct) { await env.ACCOUNTS.delete(credKey(id)); return json({ error: "This account was removed." }, 401); }
    if (acct.status !== "approved") return json({ error: "This account is waiting for approval.", pending: true }, 403);
    who = { user: acct.name, admin: !!acct.admin };
  }
  const { token, exp } = await makeToken(env, who.user);
  return json({ ok: true, user: who.user, admin: who.admin, token, exp });
}

// The signed-in account's Face ID sign-ins, and removing one (an admin can remove
// anyone's). For the shared login this lists every phone that added Face ID to it.
async function handlePasskeys(request, env, who) {
  if (!env.ACCOUNTS) return json({ passkeys: [] });
  if (request.method === "GET") return json({ passkeys: await listCreds(env, who.user) });
  const payload = await request.json().catch(() => null);
  const id = String((payload && payload.remove) || "");
  const saved = id && (await env.ACCOUNTS.get(credKey(id), "json"));
  if (!saved) return json({ error: "Not found." }, 404);
  if (!who.admin && String(saved.user).toLowerCase() !== who.user.toLowerCase()) return json({ error: "Not yours." }, 403);
  await env.ACCOUNTS.delete(credKey(id));
  return json({ ok: true, passkeys: await listCreds(env, who.user) });
}

async function listAccounts(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.ACCOUNTS.list({ prefix: "user:", cursor });
    const rows = await Promise.all(page.keys.map((k) => env.ACCOUNTS.get(k.name, "json")));
    for (const a of rows) {
      if (a) out.push({ name: a.name, status: a.status, admin: !!a.admin, created: a.created, approvedBy: a.approvedBy || null, faceIdOnly: !a.hash });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "pending" ? -1 : 1));
}

// Deletes everything an account left on phones: alerts ("push:") or Face ID
// sign-ins ("cred:").
async function dropEntriesFor(env, prefix, user) {
  const name = String(user).toLowerCase();
  let cursor;
  do {
    const page = await env.ACCOUNTS.list({ prefix, cursor });
    for (const k of page.keys) {
      const entry = await env.ACCOUNTS.get(k.name, "json");
      if (entry && String(entry.user || "").toLowerCase() === name) await env.ACCOUNTS.delete(k.name);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

// Admins approve, decline/remove, and promote or demote accounts. Removing can
// also delete everything that person uploaded ({ uploads: true }).
async function handleAccounts(request, env, who) {
  if (!who.admin) return json({ error: "Only an admin can manage accounts." }, 403);
  if (!env.ACCOUNTS) return json({ accounts: [], enabled: false });
  if (request.method === "GET") return json({ accounts: await listAccounts(env), enabled: true });
  const payload = await request.json().catch(() => null);
  const user = String((payload && payload.user) || "");
  const action = payload && payload.action;
  const acct = await getAccount(env, user);
  if (!acct) return json({ error: "No such account." }, 404);
  let removedUploads = [];
  if (action === "remove") {
    if (payload.uploads) {
      const name = acct.name.toLowerCase();
      const result = await removeUploads(env, (r) => String(r.by || "").toLowerCase() === name,
        `Remove uploads by ${acct.name}`);
      if (!result.ok) return json({ error: result.error }, result.status);
      removedUploads = result.ids;
    }
    await env.ACCOUNTS.delete(accountKey(user));
    await dropEntriesFor(env, "push:", acct.name);
    await dropEntriesFor(env, "cred:", acct.name);
  } else if (action === "approve" || action === "admin" || action === "unadmin") {
    if (action === "approve") { acct.status = "approved"; acct.approvedBy = who.user; }
    if (action === "admin") acct.admin = true;
    if (action === "unadmin") acct.admin = false;
    await env.ACCOUNTS.put(accountKey(user), JSON.stringify(acct));
  } else {
    return json({ error: "Unknown action." }, 400);
  }
  return json({ ok: true, accounts: await listAccounts(env), enabled: true, removedUploads });
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

async function handleUpload(request, env, who) {
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
    by: who.user,
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

// Who may change an upload: an admin, or the person who added it. Uploads from
// before uploads were signed (no "by") belong to the shared login, so admins only.
const mayEditUpload = (who, record) =>
  who.admin || (!!record.by && String(record.by).toLowerCase() === String(who.user).toLowerCase());

// Removes uploads (file, preview, and every note, tag and comment attached to them)
// in one commit per file. `pick(record, id)` chooses which. Returns the removed ids.
async function removeUploads(env, pick, message) {
  const removed = [];
  const result = await saveEntry(env, UPLOADS_FILE, (data) => {
    removed.length = 0;
    for (const [id, record] of Object.entries(data)) {
      if (record && pick(record, id)) { removed.push({ id, image: record.image }); delete data[id]; }
    }
    if (!removed.length) return false;
  }, message);
  if (!result.ok) return result;
  if (!removed.length) return { ok: true, ids: [] };
  if (env.PHOTOS) {
    const keys = [];
    for (const r of removed) {
      keys.push(`${r.id}_t.jpg`);
      try { keys.push(decodeURIComponent(new URL(r.image).pathname.slice(1))); } catch (_) {}
    }
    await Promise.all(keys.map((k) => env.PHOTOS.delete(k).catch(() => {})));
  }
  const ids = removed.map((r) => r.id);
  const drop = (data) => {
    let changed = false;
    for (const id of ids) if (id in data) { delete data[id]; changed = true; }
    if (!changed) return false;
  };
  const label = ids.length === 1 ? ids[0] : `${ids.length} uploads`;
  await saveEntry(env, COMMENTS_FILE, drop, `Remove comments on ${label}`);
  await saveEntry(env, TAGS_FILE, drop, `Remove tags on ${label}`);
  await saveEntry(env, META_FILE, drop, `Remove metadata on ${label}`);
  await dispatchUpdate(env).catch(() => {});
  return { ok: true, ids };
}

// Fix an upload's camera, date or animal, or remove it. Members can change only
// their own uploads; admins can change any.
async function handleUploadEdit(request, env, who) {
  const payload = await request.json().catch(() => null);
  const id = payload && String(payload.id || "");
  if (!UPLOAD_ID.test(id)) return json({ error: "Missing id." }, 400);
  const notYours = json({ error: "Only an admin or the person who added this can change it." }, 403);

  if (payload.remove) {
    let denied = false;
    const result = await removeUploads(env, (record, key) => {
      if (key !== id) return false;
      if (!mayEditUpload(who, record)) { denied = true; return false; }
      return true;
    }, `Remove uploaded photo ${id}`);
    if (denied) return notYours;
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ ok: true, id, removed: true });
  }

  let record = null, denied = false;
  const result = await saveEntry(env, UPLOADS_FILE, (data) => {
    const cur = data[id];
    if (!cur) return false;
    if (!mayEditUpload(who, cur)) { denied = true; return false; }
    if (payload.camera != null) cur.camera = cleanName(payload.camera) || "Other camera";
    if (payload.date != null) cur.date = cleanDate(payload.date, Date.parse(cur.date) || Date.now());
    if (payload.species != null) cur.species = cleanTags([payload.species])[0] || "Animal";
    record = cur;
  }, `Edit uploaded photo ${id}`);
  if (denied) return notYours;
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
  // Optional: only some cameras (none listed = every camera), and quiet hours in
  // the phone's own time zone.
  const cameras = [...new Set((Array.isArray(payload.cameras) ? payload.cameras : []).map(cleanName).filter(Boolean))].slice(0, 40);
  const quiet = cleanQuiet(payload.quiet);
  await env.ACCOUNTS.put(key, JSON.stringify({
    sub, species, cameras, quiet, user: who.user, updated: new Date().toISOString(),
  }));
  return json({ ok: true, species, cameras, quiet });
}

// { from: "22:00", to: "05:30", tz: "America/New_York" } or null.
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
function cleanQuiet(q) {
  if (!q || !HHMM.test(String(q.from)) || !HHMM.test(String(q.to)) || q.from === q.to) return null;
  const tz = String(q.tz || "America/New_York");
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch (_) { return null; }
  return { from: q.from, to: q.to, tz };
}

// True while a phone's quiet hours are on. A window can run past midnight.
function inQuietHours(quiet, now = new Date()) {
  if (!quiet) return false;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: quiet.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t) => Number((parts.find((p) => p.type === t) || {}).value || 0);
  const mins = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const cur = (get("hour") % 24) * 60 + get("minute"), from = mins(quiet.from), to = mins(quiet.to);
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

/* ------------------------------- Map pins -------------------------------- */
// Where each camera really stands, set by dragging its pin on the Map page. Kept in
// the accounts namespace, which has no public address, and never written to R2 or the
// repo: data.js only ever holds positions rounded to about 1 km.
//   GET  /pins                                      -> { pins: { camera: [lat, lng] } }
//   POST /pins { pins: { camera: [lat, lng] | null } }  (null = back to the rounded spot)
const PINS_KEY = "meta:pins";
const PINS_MAX = 40;
async function handlePins(request, env, who) {
  if (!env.ACCOUNTS) return json({ error: "Pins need the ACCOUNTS namespace." }, 503);
  const saved = (await env.ACCOUNTS.get(PINS_KEY, "json")) || {};
  const pins = saved.pins && typeof saved.pins === "object" ? saved.pins : {};
  if (request.method === "GET") return json({ pins });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const payload = await request.json().catch(() => null);
  const changes = payload && payload.pins && typeof payload.pins === "object" && !Array.isArray(payload.pins)
    ? Object.entries(payload.pins) : [];
  if (!changes.length || changes.length > PINS_MAX) return json({ error: "No pins to save." }, 400);
  const next = new Map(Object.entries(pins));
  for (const [camera, spot] of changes) {
    const name = cleanName(camera);
    if (!name) return json({ error: "Missing camera." }, 400);
    if (spot === null) { next.delete(name); continue; }
    const ok = Array.isArray(spot) && spot.length === 2 && spot.every((v) => typeof v === "number" && Number.isFinite(v))
      && Math.abs(spot[0]) <= 85 && Math.abs(spot[1]) <= 180;
    if (!ok) return json({ error: "That spot isn't valid." }, 400);
    next.set(name, spot.map((v) => Math.round(v * 1e5) / 1e5));
  }
  if (next.size > PINS_MAX) return json({ error: "Too many pins." }, 400);
  const out = Object.fromEntries(next);
  await env.ACCOUNTS.put(PINS_KEY, JSON.stringify({ pins: out, by: who.user, at: new Date().toISOString() }));
  return json({ ok: true, pins: out });
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
      camera: cleanName(s.camera),
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
      if (inQuietHours(entry.quiet)) continue;
      const wanted = new Set(entry.species || []);
      const cams = entry.cameras && entry.cameras.length ? new Set(entry.cameras) : null;
      // One alert per photo: a deer tagged both Deer and Buck is one sighting, told
      // by its more specific name.
      const byPhoto = new Map();
      for (const s of sightings) {
        if (!wanted.has(s.species) || (cams && !cams.has(s.camera))) continue;
        const key = s.tag || `${s.title}\n${s.body}`;
        const had = byPhoto.get(key);
        if (!had || (had.species === "Deer" && s.species !== "Deer")) byPhoto.set(key, s);
      }
      const mine = [...byPhoto.values()];
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
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    const isCameras = path === "/cameras" || path === "/camera-names";
    const isMeta = path === "/meta" || path === "/metadata";

    try {
      // The public key phones subscribe with (public by design).
      if (request.method === "GET" && path === "/push/key") {
        return json({ enabled: pushReady(env), publicKey: pushReady(env) ? env.VAPID_PUBLIC_KEY : null });
      }
      // Photos and videos: checked by their photo pass, and not rate limited (one
      // screen of photos is dozens of requests).
      if ((request.method === "GET" || request.method === "HEAD") && path.startsWith("/media/")) {
        return await handleMedia(request, env, url);
      }

      if (request.method !== "POST" && request.method !== "GET") return json({ error: "Method not allowed." }, 405);

      // Everything below is signed in, reads included, except signing in itself.
      // Challenges check no password, so they get the looser limit (a sign-up asks
      // for one as the username is typed).
      const strict = path === "/login" || path === "/register" || path === "/passkey/register" || path === "/passkey/login" ||
        (path === "/password" && request.method === "POST");
      if (await overLimit(env, strict ? "LOGIN_LIMITER" : "WRITE_LIMITER", request)) {
        return json({ error: "Too many attempts. Wait a minute and try again." }, 429);
      }
      if (path === "/login") return await handleLogin(request, env);
      if (path === "/register") return await handleRegister(request, env);
      if (path === "/passkey/options") return await handlePasskeyOptions(request, env);
      if (path === "/passkey/register") return await handlePasskeyRegister(request, env);
      if (path === "/passkey/login") return await handlePasskeyLogin(request, env);
      // The workflow's own key (PUSH_SECRET), not a person's sign-in.
      if (path === "/push/notify" && request.method === "POST") return await handlePushNotify(request, env);

      const who = await authenticate(request, env);
      if (!who) return json({ error: "Sign in to see Vale Trails." }, 401);

      if (request.method === "GET" && path === "/data") {
        return new Response(await readDataScript(env), {
          headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store", ...CORS },
        });
      }
      if (path === "/pins") return await handlePins(request, env, who);
      if (request.method === "GET" && path === "/media-token") return json(await makeMediaToken(env, who.user));
      if (request.method === "GET" && path !== "/accounts" && path !== "/passkeys" && path !== "/password") {
        const file = path === "/comments" ? COMMENTS_FILE : isCameras ? CAMERA_FILE : isMeta ? META_FILE : TAGS_FILE;
        const { data } = await readFile(env, file);
        return json(data);
      }

      if (path === "/accounts") return await handleAccounts(request, env, who);
      if (path === "/passkeys") return await handlePasskeys(request, env, who);
      if (path === "/password") return await handlePassword(request, env, who);
      if ((path === "/push/subscribe" || path === "/push/unsubscribe") && request.method === "POST") {
        return await handlePushPrefs(request, env, who, path);
      }
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (path === "/thumb") return await handleThumb(request, env);
      if (path === "/upload") return await handleUpload(request, env, who);
      if (path === "/uploads") return await handleUploadEdit(request, env, who);
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
