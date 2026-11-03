import { handleApi } from "./api.js";
import { handleLogin, handleLogout, isOwner } from "./auth.js";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000",
  "cross-origin-opener-policy": "same-origin",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-eval' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://cloudflareinsights.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

export default {
  async fetch(request, env) {
    const response = await route(request, env);
    return withSecurityHeaders(response);
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const owner = isOwner(request, env);

  if (url.pathname === "/login") return handleLogin(request, env, owner);
  if (url.pathname === "/logout") return handleLogout(url.origin);
  if (url.pathname.startsWith("/api/")) return handleApi(request, env, owner);

  return env.ASSETS.fetch(request);
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
