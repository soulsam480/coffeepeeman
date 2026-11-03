import { loginPage } from "./login.js";

export const AUTH_COOKIE = "__Host-coffee_auth";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function cookieHeader(value, maxAgeSeconds) {
  return `${AUTH_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function expectedToken(env) {
  return env.OWNER_TOKEN || "\u0000";
}

export function isOwner(request, env) {
  return constantTimeEqual(
    readCookie(request, AUTH_COOKIE) || "",
    expectedToken(env),
  );
}

export function handleLogin(request, env, owner) {
  if (request.method === "POST") return submitLogin(request, env);
  if (owner) return Response.redirect(new URL(request.url).origin + "/", 302);
  return html(loginPage());
}

async function submitLogin(request, env) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return html(loginPage("Bad request."), 403);
  }

  const form = await request.formData();
  const token = String(form.get("token") || "");

  if (!constantTimeEqual(token, expectedToken(env))) {
    return html(loginPage("Wrong token."), 401);
  }

  return new Response(null, {
    status: 302,
    headers: {
      location: "/",
      "set-cookie": cookieHeader(token, ONE_YEAR_SECONDS),
      "cache-control": "no-store",
    },
  });
}

export function handleLogout(origin) {
  return new Response(null, {
    status: 302,
    headers: {
      location: origin + "/",
      "set-cookie": cookieHeader("", 0),
    },
  });
}
