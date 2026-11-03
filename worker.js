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


const MODEL = "claude-sonnet-4-6";
const SYSTEM = "You are Neura, an internal assistant for the Laredo Public Health Department. Be concise, factual, and clear. PHAB reference documents and department procedures are not connected yet. Do not claim to have reviewed them, invent citations, or certify accreditation compliance. State when source documents are needed.";

async function chat(request, env) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return json({ error: "Open the Neura connection check to send a message." }, 403);
  }
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Claude API key is not configured." }, 503);
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    return json({ error: "Expected JSON." }, 415);
  }
  let body;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "A message is required." }, 400);
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); return json({ error: "Message is too large." }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return json({ error: "Invalid JSON." }, 400); }
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 12 ||
      messages.some(m => !m || !["user", "assistant"].includes(m.role) ||
        typeof m.content !== "string" || !m.content.trim() || m.content.length > 8000) ||
      messages[0].role !== "user" || messages.at(-1).role !== "user" ||
      messages.reduce((n, m) => n + m.content.length, 0) > 16000) {
    return json({ error: "Send 1–12 text messages, ending with a user message (16,000 characters total maximum)." }, 400);
  }
  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1024, system: SYSTEM,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      const errors = {
        401: "Claude rejected the API key. Check the Worker secret.",
        403: "This API key does not have permission to use Claude.",
        404: "The configured Claude model is unavailable.",
        429: "Claude usage or rate limit reached. Check API billing and limits.",
        529: "Claude is busy. Please try again shortly.",
      };
      return json({ error: errors[upstream.status] || "Claude could not complete this request.",
        code: "CLAUDE_REQUEST_FAILED", upstreamStatus: upstream.status }, upstream.status === 429 ? 429 : 502);
    }
    const result = await upstream.json();
    const reply = (result.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    if (!reply) return json({ error: "Claude returned no text response." }, 502);
    return json({ reply, model: result.model, stopReason: result.stop_reason });
  } catch {
    return json({ error: "Claude could not be reached or the request timed out.", code: "CLAUDE_UNAVAILABLE" }, 504);
  }
}

const CHECK_PAGE = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neura connection check</title>
<body><main><h1>Neura · Claude connection check</h1>
<p>Your department login is required. This sends text to the Claude API and uses API credits.</p>
<p>PHAB references and document uploads are not connected yet.</p>
<form id="chat"><label for="message">Test message</label><br>
<textarea id="message" rows="4" cols="55" maxlength="8000" required>Reply with: Neura is connected.</textarea><br>
<button id="send">Send test message</button></form>
<p id="status" role="status"></p><pre id="reply" style="white-space:pre-wrap"></pre>
<script>
document.getElementById("chat").addEventListener("submit", async event => {
  event.preventDefault();
  const button = document.getElementById("send");
  const status = document.getElementById("status");
  button.disabled = true;
  status.textContent = "Waiting for Claude…";
  document.getElementById("reply").textContent = "";
  try {
    const response = await fetch("/api/chat", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: document.getElementById("message").value }] })
    });
    if (!(response.headers.get("Content-Type") || "").includes("application/json")) {
      throw new Error("Your login may have expired. Reload this page and sign in.");
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    status.textContent = "Claude replied successfully.";
    document.getElementById("reply").textContent = data.reply;
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
</script></main></body></html>`;

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
        chatEndpointConfigured: Boolean(env.ANTHROPIC_API_KEY),
        model: MODEL,
      });
    }

    if (url.pathname === "/connection-check" && request.method === "GET") {
      const nonce = crypto.randomUUID();
      return new Response(CHECK_PAGE.replace("<script>", '<script nonce="' + nonce + '">'), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; script-src 'nonce-" + nonce + "'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        },
      });
    }
    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") return json({ error: "Use POST to send a chat message." }, 405);
      return chat(request, env);
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
