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
//     UPLOAD_PASSWORD  (secret)  the shared password
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
//   POST /login       checks the upload username and password
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
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// The password lives only in the UPLOAD_PASSWORD Worker secret. If it's unset,
// nobody can sign in.
async function isAuthorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!env.UPLOAD_PASSWORD || !env.UPLOAD_USER || !header.startsWith("Basic ")) return false;
  let decoded;
  try { decoded = b64decode(header.slice(6)); } catch (_) { return false; }
  const split = decoded.indexOf(":");
  if (split < 0) return false;
  const userOk = await sameText(decoded.slice(0, split), env.UPLOAD_USER);
  const passwordOk = await sameText(decoded.slice(split + 1), env.UPLOAD_PASSWORD);
  return userOk && passwordOk;
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
      if (request.method === "GET") {
        const file = path === "/comments" ? COMMENTS_FILE : isCameras ? CAMERA_FILE : isMeta ? META_FILE : TAGS_FILE;
        const { data } = await readFile(env, file);
        return json(data);
      }

      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

      // Every write is signed in. Reads above stay public.
      if (await overLimit(env, path === "/login" ? "LOGIN_LIMITER" : "WRITE_LIMITER", request)) {
        return json({ error: "Too many attempts. Wait a minute and try again." }, 429);
      }
      if (!(await isAuthorized(request, env))) return json({ error: "Sign in to save changes." }, 401);

      if (path === "/login") return json({ ok: true });
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
