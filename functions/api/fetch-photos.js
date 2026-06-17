export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = corsHeaders();

  try {
    const expectedKey = env.FETCH_API_KEY || "";
    if (expectedKey) {
      const provided =
        request.headers.get("x-fetch-key") ||
        request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
        "";
      if (provided !== expectedKey) {
        return json({ ok: false, error: "Unauthorized" }, 401, headers);
      }
    }

    const owner = env.GITHUB_OWNER;
    const repo = env.GITHUB_REPO;
    const token = env.GITHUB_TOKEN;
    const workflow = env.GITHUB_WORKFLOW_FILE || "update.yml";
    const ref = env.GITHUB_REF || "main";

    if (!owner || !repo || !token) {
      return json(
        {
          ok: false,
          error:
            "Missing GITHUB_OWNER, GITHUB_REPO, or GITHUB_TOKEN environment variables.",
        },
        500,
        headers,
      );
    }

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
    const ghRes = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "trailhub-fetch-endpoint",
      },
      body: JSON.stringify({ ref }),
    });

    if (!ghRes.ok) {
      const body = await ghRes.text();
      return json(
        {
          ok: false,
          error: `GitHub dispatch failed (${ghRes.status})`,
          details: body.slice(0, 1500),
        },
        500,
        headers,
      );
    }

    return json(
      {
        ok: true,
        message: "Workflow dispatched.",
        workflow,
        ref,
      },
      200,
      headers,
    );
  } catch (err) {
    return json(
      {
        ok: false,
        error: "Unexpected server error.",
        details: String(err && err.message ? err.message : err),
      },
      500,
      headers,
    );
  }
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-fetch-key",
    "Cache-Control": "no-store",
  };
}
