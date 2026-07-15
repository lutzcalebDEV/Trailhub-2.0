// TrailHub tag-sync Worker (Cloudflare Workers, free tier).
// ---------------------------------------------------------------------------
// PURPOSE
//   Lets anyone who visits TrailHub add/remove photo tags and have them show up
//   for EVERYONE, on every machine. It does this by saving tags into tags.json
//   in your GitHub repo. pull.py then bakes tags.json into data.js on the next
//   scheduled run, and the site also reads the live tags right away.
//
// WHY YOU NEED IT
//   GitHub Pages can only SERVE files, it can't SAVE them. This tiny Worker is
//   the piece that does the saving. It holds your GitHub token server-side so
//   the token is never exposed in the website.
//
// SETUP (one time, ~5 minutes) — see the README "Shared tags" section.
//   Required Worker variables (Settings -> Variables and Secrets):
//     GITHUB_TOKEN   (secret)  fine-grained PAT, repo scoped, Contents: Read+Write
//     GITHUB_OWNER             e.g. lutzcalebDEV
//     GITHUB_REPO              e.g. Trailhub-2.0
//     GITHUB_BRANCH  (opt.)    defaults to "main"
//   Then copy the Worker URL into config.js:  window.TRAILHUB_TAGS_API = "https://...workers.dev";
//
// API
//   GET  /            -> { "<photoId>": ["Deer","Turkey"], ... }   (all photo tags)
//   POST /            with { "id": "sp_...", "tags": ["Deer","Turkey"] }  (save one photo)
//   GET  /cameras     -> { "<cameraKey>": "North Field", ... }    (all camera names)
//   POST /cameras     with { "id": "Camera 6a30...", "name": "North Field" }  (rename one)
//   GET  /meta        -> { "<photoId>": { "note": "...", "favorite": true }, ... }
//   POST /meta        with { "id": "sp_...", "meta": { "note": "buck", "favorite": true } }
//                     (merges the given keys into that photo; send a key as null to
//                      remove it, or an empty meta object to clear the whole entry.)
//   (POST an empty tags array or empty name to clear an entry.)
// ---------------------------------------------------------------------------

// Each resource maps a request path to a JSON file committed in the repo. pull.py
// bakes tags.json + metadata.json into data.js; the site reads all three files
// live for instant updates.
const TAGS_FILE = "tags.json";
const CAMERA_FILE = "camera-names.json";
const META_FILE = "metadata.json";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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

// Per-photo metadata sanitizing. This endpoint is intentionally auth-less (a shared
// family dashboard), so we bound what a single entry can hold to keep the committed
// metadata.json small and safe to render. Structural fields owned by other pipelines
// (tags, camera names) are reserved so metadata can't clobber them.
const META_RESERVED = new Set(["id", "image", "date", "camera", "tags", "species"]);
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
// when the sha is stale). `mutate(data)` edits the map in place.
async function saveEntry(env, path, mutate, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, sha } = await readFile(env, path);
    mutate(data);
    const res = await writeFile(env, path, data, sha, message);
    if (res.ok) return { ok: true, data };
    if (res.status !== 409) {
      const text = await res.text();
      return { ok: false, status: 502, error: `Save failed (${res.status}): ${text}` };
    }
  }
  return { ok: false, status: 409, error: "Conflict after retries, please try again." };
}

export default {
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
        const file = isCameras ? CAMERA_FILE : isMeta ? META_FILE : TAGS_FILE;
        const { data } = await readFile(env, file);
        return json(data);
      }

      if (request.method === "POST") {
        const payload = await request.json().catch(() => null);
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
      }

      return json({ error: "Method not allowed." }, 405);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500);
    }
  },
};
