const COOKIE = "coffee_auth";

function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

const page = (error = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f6f2ea">
<title>Coffee</title>
<style>
  :root{--ground:#f6f2ea;--card:#fffdf8;--ink:#1c1a17;--muted:#6f685d;--rule:#e2dbcf;--accent:#2f5d3a}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--ground);color:var(--ink);
    font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
  form{width:100%;max-width:340px;background:var(--card);border:1px solid var(--rule);border-radius:14px;padding:24px}
  h1{margin:0 0 4px;font:600 30px/1.1 "Iowan Old Style",Georgia,serif;letter-spacing:-.02em}
  p{margin:0 0 20px;color:var(--muted);font-size:14px}
  label{display:block;font-size:14px;font-weight:500;color:var(--muted);margin-bottom:6px}
  input{width:100%;font:inherit;padding:12px;border:1px solid var(--rule);border-radius:10px;background:#fff}
  input:focus{outline:2px solid var(--accent);outline-offset:1px}
  button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:999px;background:var(--accent);color:#fff;
    font:inherit;font-weight:600;cursor:pointer}
  .err{margin:0 0 14px;color:#8a3b2a;font-size:13px}
</style></head>
<body><form method="post" action="/login">
  <h1>Coffee</h1>
  <p>This one's private. Paste the owner token.</p>
  ${error ? `<p class="err">${error}</p>` : ""}
  <label for="token">Token</label>
  <input id="token" name="token" type="password" autocomplete="current-password" autofocus required>
  <button type="submit">Unlock</button>
</form></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const token = env.OWNER_TOKEN || "\u0000";
    const authed = same(cookie(request, COOKIE) || "", token);

    if (url.pathname === "/login") {
      if (request.method === "POST") {
        const form = await request.formData();
        if (same(String(form.get("token") || ""), token)) {
          return new Response(null, {
            status: 302,
            headers: {
              Location: "/",
              "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`,
              "Cache-Control": "no-store",
            },
          });
        }
        return new Response(page("Wrong token."), {
          status: 401,
          headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
      if (authed) return Response.redirect(url.origin + "/", 302);
      return new Response(page(), {
        headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (!authed) {
      if (url.pathname.startsWith("/api/"))
        return Response.json({ error: "unauthorized" }, { status: 401 });
      return Response.redirect(url.origin + "/login", 302);
    }

    if (url.pathname === "/api/" || url.pathname === "/api")
      return Response.json({ error: "not implemented" }, { status: 501 });

    return env.ASSETS.fetch(request);
  },
};
