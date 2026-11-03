const ACCESS_AUD =
  "1e0e7ebe5737579dd57139a53d0fdae8e62a599e30d3dd7372dbf069a7de156f";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    // Require the configured Cloudflare Access application.
   if (!ctx.access) {
  return json({
    error: "Access identity is unavailable to the Worker.",
    code: "ACCESS_CONTEXT_MISSING",
  }, 403);
}

if (ctx.access.aud !== ACCESS_AUD) {
  return json({
    error: "Access application does not match.",
    code: "ACCESS_AUD_MISMATCH",
  }, 403);
}

    try {
      const identity = await ctx.access.getIdentity();
      const email = String(identity.email || "").trim().toLowerCase();

      if (!email.endsWith("@cityoflaredo.com")) {
        return json({ error: "Access denied." }, 403);
      }
    } catch {
      return json({ error: "Unable to verify your login." }, 403);
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        service: "Neura",
        loginVerified: true,
        claudeKeyConfigured: Boolean(env.ANTHROPIC_API_KEY),
        chatConnected: false,
      });
    }

    // Chat functionality will be added after website hosting is verified.
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "This endpoint is not connected yet." }, 404);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    // Serve the website only after verifying the user's login.
    return env.ASSETS.fetch(request);
  },
};
