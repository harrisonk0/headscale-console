/** Fixed-origin transport proxy. No auth keys, node state, or desktop plaintext. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed =
      origin === env.APP_ORIGIN || origin === url.origin || origin === "http://localhost:5173";
    if (origin && !allowed) return new Response("Origin not allowed", { status: 403 });
    const cors = new Headers({
      "Access-Control-Allow-Origin": origin && allowed ? origin : env.APP_ORIGIN,
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Tailscale-Challenge",
      "Access-Control-Expose-Headers": "Location",
      Vary: "Origin",
      "Cache-Control": "no-store",
    });
    if (url.pathname === "/__proxy/status")
      return Response.json({ ok: true, transport: "websocket", version: 1 }, { headers: cors });
    const pathAllowed =
      /^\/(key|ts2021|machine(?:\/.*)?|derp(?:\/.*)?|register\/[a-zA-Z0-9_-]+|health)$/.test(
        url.pathname,
      ) || /^\/api\/v1\/(user|preauthkey)$/.test(url.pathname);
    if (!pathAllowed) return new Response("Not found", { status: 404, headers: cors });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!["GET", "HEAD", "POST"].includes(request.method))
      return new Response("Method not allowed", { status: 405, headers: cors });
    const target = new URL(url.pathname + url.search, env.ORIGIN);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cookie");
    try {
      const upstream = await fetch(
        new Request(target, {
          method: request.method,
          headers,
          body: request.body,
          redirect: "manual",
        }),
      );
      // Return upgraded connections directly: Cloudflare forwards binary frames
      // without per-message JavaScript, keeping proxy CPU usage low.
      if (upstream.status === 101) return upstream;
      const responseHeaders = new Headers(upstream.headers);
      cors.forEach((value, key) => responseHeaders.set(key, value));
      const location = responseHeaders.get("Location");
      if (location?.startsWith(env.ORIGIN))
        responseHeaders.set("Location", url.origin + location.slice(env.ORIGIN.length));
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch {
      console.error(JSON.stringify({ event: "upstream_unavailable" }));
      return Response.json(
        { error: "Headscale is temporarily unavailable. Try again." },
        { status: 502, headers: cors },
      );
    }
  },
} satisfies ExportedHandler<Env>;
