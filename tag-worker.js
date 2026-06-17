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
//   GET  /  -> { "<photoId>": ["Deer","Turkey"], ... }   (current tags)
//   POST /  with JSON { "id": "sp_...", "tags": ["Deer","Turkey"] }  (save one photo)
// ---------------------------------------------------------------------------

const FILE_PATH = "tags.json";

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

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": "trailhub-tags",
    Accept: "application/vnd.github+json",
  };
}

async function readTags(env) {
  const branch = env.GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${FILE_PATH}?ref=${branch}`;
  const r = await fetch(url, { headers: ghHeaders(env) });
  if (r.status === 404) return { tags: {}, sha: null };
  if (!r.ok) throw new Error(`GitHub read failed: ${r.status}`);
  const data = await r.json();
  let tags = {};
  try {
    const parsed = JSON.parse(b64decode((data.content || "").replace(/\n/g, "")));
    if (parsed && typeof parsed === "object") tags = parsed;
  } catch (_) {
    tags = {};
  }
  return { tags, sha: data.sha };
}

async function writeTags(env, tags, sha, message) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${FILE_PATH}`;
  const body = {
    message,
    content: b64encode(JSON.stringify(tags, null, 1) + "\n"),
    branch: env.GITHUB_BRANCH || "main",
  };
  if (sha) body.sha = sha;
  return fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
      return json({ error: "Worker is missing GITHUB_TOKEN/OWNER/REPO variables." }, 500);
    }

    try {
      if (request.method === "GET") {
        const { tags } = await readTags(env);
        return json(tags);
      }

      if (request.method === "POST") {
        const payload = await request.json().catch(() => null);
        if (!payload || !payload.id) return json({ error: "Missing photo id." }, 400);
        const id = String(payload.id);
        const newTags = cleanTags(payload.tags);

        // Read-modify-write with retries to survive concurrent edits.
        for (let attempt = 0; attempt < 3; attempt++) {
          const { tags, sha } = await readTags(env);
          if (newTags.length) tags[id] = newTags;
          else delete tags[id];
          const res = await writeTags(env, tags, sha, `Update tags for ${id}`);
          if (res.ok) return json({ ok: true, tags });
          if (res.status !== 409) {
            const text = await res.text();
            return json({ error: `Save failed (${res.status}): ${text}` }, 502);
          }
        }
        return json({ error: "Conflict after retries, please try again." }, 409);
      }

      return json({ error: "Method not allowed." }, 405);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500);
    }
  },
};
