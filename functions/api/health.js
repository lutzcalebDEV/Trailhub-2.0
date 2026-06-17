export async function onRequestGet(context) {
  const { env } = context;
  const hasGithub = !!(env.GITHUB_OWNER && env.GITHUB_REPO && env.GITHUB_TOKEN);

  return new Response(
    JSON.stringify({
      ok: true,
      service: "trailhub-production-fetch",
      githubConfigured: hasGithub,
      time: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
