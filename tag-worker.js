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
//   (POST an empty tags array or empty name to clear an entry.)
// ---------------------------------------------------------------------------

// Each resource maps a request path to a JSON file committed in the repo. pull.py
// bakes tags.json into data.js; the site reads both files live for instant updates.
const TAGS_FILE = "tags.json";
const CAMERA_FILE = "camera-names.json";

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

    // Route by path: /cameras -> camera names, everything else -> photo tags.
    const path = new URL(request.url).pathname.replace(/\/+$/, "").toLowerCase();
    const isCameras = path === "/cameras" || path === "/camera-names";

    try {
      if (request.method === "GET") {
        const { data } = await readFile(env, isCameras ? CAMERA_FILE : TAGS_FILE);
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
