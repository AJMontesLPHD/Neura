import { createRemoteJWKSet, jwtVerify } from "jose";

const ACCESS_ISSUER = "https://ajmontes.cloudflareaccess.com";
const ACCESS_AUD =
  "1e0e7ebe5737579dd57139a53d0fdae8e62a599e30d3dd7372dbf069a7de156f";

const ACCESS_KEYS = createRemoteJWKSet(
  new URL(`${ACCESS_ISSUER}/cdn-cgi/access/certs`)
);

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
  async fetch(request, env) {
    const token = request.headers.get("Cf-Access-Jwt-Assertion");

    if (!token) {
      return json({
        error: "Please sign in to Neura.",
        code: "ACCESS_TOKEN_MISSING",
      }, 401);
    }

    try {
      const { payload } = await jwtVerify(token, ACCESS_KEYS, {
        issuer: ACCESS_ISSUER,
        audience: ACCESS_AUD,
        algorithms: ["RS256"],
      });

      const email = String(payload.email || "").trim().toLowerCase();

      if (!email.endsWith("@cityoflaredo.com")) {
        return json({ error: "Access denied." }, 403);
      }
    } catch {
      return json({
        error: "Unable to verify your login.",
        code: "ACCESS_TOKEN_INVALID",
      }, 403);
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

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "This endpoint is not connected yet." }, 404);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
