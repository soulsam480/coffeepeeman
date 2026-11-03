export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith("/api/")) {
      return Response.json({ error: "not implemented" }, { status: 501 });
    }

    return env.ASSETS.fetch(request);
  },
};
