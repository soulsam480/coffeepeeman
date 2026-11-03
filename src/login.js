export function loginPage(error = "") {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sign in · Coffee</title>
  <style>
    :root{--ground:#f6f2ea;--card:#fffdf8;--ink:#1c1a17;--muted:#6f685d;--rule:#e2dbcf;--accent:#2f5d3a}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--ground);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
    form{width:100%;max-width:340px;background:var(--card);border:1px solid var(--rule);border-radius:14px;padding:24px}
    h1{margin:0 0 4px;font:600 30px/1.1 "Iowan Old Style",Georgia,serif;letter-spacing:-.02em}
    p{margin:0 0 20px;color:var(--muted);font-size:14px}
    label{display:block;font-size:14px;font-weight:500;color:var(--muted);margin-bottom:6px}
    input{width:100%;font:inherit;padding:12px;border:1px solid var(--rule);border-radius:10px;background:#fff}
    input:focus{outline:2px solid var(--accent);outline-offset:1px}
    button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:999px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
    a{color:var(--muted);font-size:13px;display:inline-block;margin-top:14px}
    .error{margin:0 0 14px;color:#8a3b2a;font-size:13px}
  </style>
</head>
<body>
  <form method="post" action="/login">
    <h1>Sign in</h1>
    <p>Adding and rating is private. The list is public.</p>
    ${error ? `<p class="error">${error}</p>` : ""}
    <label for="token">Owner token</label>
    <input id="token" name="token" type="password" autocomplete="current-password" autofocus required>
    <button type="submit">Unlock</button>
    <a href="/">Back to the list</a>
  </form>
</body>
</html>`;
}
