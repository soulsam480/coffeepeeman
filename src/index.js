import { handleApi } from "./api.js";
import { handleLogin, handleLogout, isOwner } from "./auth.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const owner = isOwner(request, env);

    if (url.pathname === "/login") return handleLogin(request, env, owner);
    if (url.pathname === "/logout") return handleLogout(url.origin);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, owner);

    return env.ASSETS.fetch(request);
  },
};
