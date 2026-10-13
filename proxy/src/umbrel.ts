import type { AuthGuard } from "./auth";
import networkScript from "./umbrel-network";

interface UmbrelEnv {
  AUTH: DurableObjectNamespace<AuthGuard>;
  OWNER_ID: string;
  ORIGIN: string;
  APP_ORIGIN: string;
  UMBREL_PORT: string;
  UMBREL_BRIDGE_SECRET: string;
}
const cookieName = "__Host-umbrel";
function session(request: Request) {
  return (
    (request.headers.get("Cookie") || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1) || ""
  );
}
function safePath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
}
const address = (port: number) =>
  port === 80
    ? "https://hk-remote-umbrel.harrisonk-0.workers.dev"
    : `https://hk-remote-umbrel-p${port}.harrisonk-0.workers.dev`;
const launcher = `(() => {
  const original = window.open;
  function mapped(raw) {
    try {
      const u = new URL(String(raw), location.href);
      const hostPort = /^p(300[0-9]{2})\\.umbrel\\.movenis\\.dev$/.exec(u.hostname);
      const port = hostPort ? Number(hostPort[1]) : Number(u.port);
      const local = hostPort || [location.hostname, '100.64.0.6', 'umbrel.local', 'umbrel.movenis.dev', 'hk-umbrel.mesh.movenis.dev'].includes(u.hostname);
      if (local && port >= 30000 && port <= 30099 && ['http:', 'https:'].includes(u.protocol))
        return '/__remote/app-launch?port=' + port + '&path=' + encodeURIComponent(u.pathname + u.search + u.hash);
    } catch {}
  }
  window.open = function(url, ...args) {
    return Reflect.apply(original, window, [mapped(url) || url, ...args]);
  };
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const target = mapped(a.href);
    if (target) { e.preventDefault(); Reflect.apply(original, window, [target, '_blank', 'noopener']); }
  }, true);
})();`;
function entryPage(path: string) {
  const nonce = crypto.randomUUID();
  return new Response(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Opening your app</title></head><body style="font:16px system-ui;background:#101817;color:#e6ece5;padding:40px"><h1>Opening your private app…</h1><p id="message">Verifying your session.</p><script nonce="${nonce}">(async()=>{const ticket=new URLSearchParams(location.hash.slice(1)).get('ticket');history.replaceState(null,'',location.pathname);try{const r=await fetch('/__remote/umbrel-open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});if(!r.ok)throw new Error('This link expired. Open the app again from Umbrel.');location.replace(${JSON.stringify(path).replace(/</g, "\\u003c")});}catch(e){document.getElementById('message').textContent=e.message;}})();</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
      },
    },
  );
}
export default {
  async fetch(request: Request, env: UmbrelEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url),
      port = Number(env.UMBREL_PORT),
      origin = request.headers.get("Origin");
    const auth = env.AUTH.getByName(env.OWNER_ID);
    const json = (data: unknown, status = 200) =>
      Response.json(data, {
        status,
        headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      });
    try {
      if (origin && origin !== url.origin) return json({ error: "Origin not allowed." }, 403);
      if (url.pathname === "/__remote/umbrel-entry")
        return entryPage(safePath(url.searchParams.get("path")));
      if (url.pathname === "/__remote/umbrel-open") {
        if (
          request.method !== "POST" ||
          origin !== url.origin ||
          !request.headers.get("Content-Type")?.startsWith("application/json")
        )
          return json({ error: "Origin not allowed." }, 403);
        const reader = request.body?.getReader();
        if (!reader) return json({ error: "Invalid ticket." }, 400);
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 256) {
            await reader.cancel();
            return json({ error: "Invalid ticket." }, 400);
          }
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        let body: { ticket?: unknown };
        try {
          body = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          return json({ error: "Invalid ticket." }, 400);
        }
        if (!body || typeof body.ticket !== "string" || !/^[0-9a-f]{64}$/.test(body.ticket))
          return json({ error: "Invalid ticket." }, 400);
        const token = await auth.redeem(
          typeof body.ticket === "string" ? body.ticket : "",
          port === 80 ? "dashboard" : String(port),
        );
        const response = json({ ok: true });
        response.headers.set(
          "Set-Cookie",
          `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800`,
        );
        return response;
      }
      if (!(await auth.allowUmbrel(session(request))))
        return new Response(
          `<!doctype html><html><head><title>Sign in to HK Remote</title></head><body style="font:16px system-ui;padding:40px"><h1>Open this app from HK Remote.</h1><p>Your private session has expired.</p><a href="${env.APP_ORIGIN}">Sign in to HK Remote</a></body></html>`,
          { status: 401, headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } },
        );
      if (port === 80 && url.pathname === "/__remote/network.js")
        return new Response(networkScript, {
          headers: {
            "Content-Type": "application/javascript",
            "Cache-Control": "private, no-cache",
          },
        });
      if (port === 80 && url.pathname.startsWith("/__remote/socket/")) {
        if (
          request.method !== "POST" ||
          origin !== url.origin ||
          !request.headers.get("Content-Type")?.startsWith("application/json")
        )
          return json({ error: "Origin not allowed." }, 403);
        const reader = request.body?.getReader();
        if (!reader) return json({ error: "Missing request." }, 400);
        const decoder = new TextDecoder();
        let payload = "",
          size = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 400000) {
            await reader.cancel();
            return json({ error: "Request too large." }, 413);
          }
          payload += decoder.decode(part.value, { stream: true });
        }
        let b: Record<string, unknown>;
        try {
          b = JSON.parse(payload + decoder.decode());
          if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error();
        } catch {
          return json({ error: "Invalid request." }, 400);
        }
        const token = session(request),
          id = typeof b.id === "string" ? b.id : "";
        switch (url.pathname.slice("/__remote/socket/".length)) {
          case "open":
            if (typeof b.path !== "string" || !Array.isArray(b.protocols) || b.protocols.length)
              return json({ error: "Invalid connection." }, 400);
            return json(await auth.openUmbrelTransport(token, b.path));
          case "read":
            return json(await auth.readUmbrelTransport(token, id, Number(b.ack)));
          case "write":
            return json(
              await auth.writeUmbrelTransport(
                token,
                id,
                Number(b.sequence),
                b.frames as { kind: "binary" | "text"; data: string }[],
              ),
            );
          case "close":
            return json(await auth.closeUmbrelTransport(token, id));
          default:
            return json({ error: "Unknown connection action." }, 404);
        }
      }
      // Authenticate before consulting the shared cache. Only fingerprinted dashboard
      // build assets are eligible; HTML, APIs and user files never enter this cache.
      const immutableAsset =
        port === 80 &&
        request.method === "GET" &&
        !url.search &&
        /^\/assets\/[A-Za-z0-9_./-]*-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2|svg|png|webp|ico)$/.test(
          url.pathname,
        );
      const cacheKey = new Request(url.href);
      const assetCache = immutableAsset
        ? await caches.open("hkremote-umbrel-assets-v1")
        : undefined;
      if (immutableAsset) {
        const cached = await assetCache!.match(cacheKey);
        if (cached) {
          const headers = new Headers(cached.headers);
          headers.set("Cache-Control", "private, max-age=31536000, immutable");
          headers.set("X-HKRemote-Cache", "HIT");
          return new Response(cached.body, { status: cached.status, headers });
        }
      }
      if (port === 80 && url.pathname === "/__remote/app-launch.js")
        return new Response(launcher, {
          headers: { "Content-Type": "application/javascript", "Cache-Control": "no-store" },
        });
      if (port === 80 && url.pathname === "/__remote/app-launch") {
        const appPort = Number(url.searchParams.get("port"));
        const ticket = await auth.appTicket(session(request), appPort);
        return new Response(null, {
          status: 303,
          headers: {
            Location: `${address(appPort)}/__remote/umbrel-entry?path=${encodeURIComponent(safePath(url.searchParams.get("path")))}#ticket=${ticket}`,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      }
      const upstream = new Headers(request.headers);
      upstream.delete("Host");
      upstream.set("X-HKRemote-Bridge", env.UMBREL_BRIDGE_SECRET);
      const cookies = (upstream.get("Cookie") || "")
        .split(";")
        .filter(
          (v) => !v.trim().startsWith(cookieName + "=") && !v.trim().startsWith("__Host-hkremote="),
        )
        .join(";");
      if (immutableAsset) {
        upstream.delete("Cookie");
        upstream.delete("Authorization");
        upstream.delete("If-None-Match");
        upstream.delete("If-Modified-Since");
      } else if (cookies) upstream.set("Cookie", cookies);
      else upstream.delete("Cookie");
      if (port !== 80) upstream.set("X-HKRemote-Port", String(port));
      else upstream.delete("X-HKRemote-Port");
      const target = new URL(
        (port === 80 ? "/__hkremote" : "/__hkremote-port") + url.pathname + url.search,
        env.ORIGIN,
      );
      const response = await fetch(
        new Request(target, {
          method: request.method,
          headers: upstream,
          body: request.body,
          redirect: "manual",
        }),
      );
      if (response.status === 101) return response;
      const out = new Headers(response.headers);
      const cacheableAsset =
        immutableAsset &&
        response.status === 200 &&
        !out.has("Set-Cookie") &&
        (out.get("Cache-Control") || "").includes("immutable") &&
        /(?:javascript|css|font|image)/.test(out.get("Content-Type") || "");
      if (cacheableAsset) {
        const cachedHeaders = new Headers(out);
        cachedHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
        ctx.waitUntil(
          assetCache!
            .put(cacheKey, new Response(response.clone().body, { headers: cachedHeaders }))
            .catch(() => {}),
        );
        out.set("Cache-Control", "private, max-age=31536000, immutable");
        out.set("X-HKRemote-Cache", "MISS");
      } else out.set("Cache-Control", "no-store");
      out.set("Referrer-Policy", "no-referrer");
      const location = out.get("Location");
      if (location) {
        try {
          const dest = new URL(location, url);
          if (
            ["100.64.0.6", "umbrel.local", "umbrel.movenis.dev"].includes(dest.hostname) ||
            /^p300\d\d\.umbrel\.movenis\.dev$/.test(dest.hostname)
          ) {
            const destPort = dest.hostname.startsWith("p")
              ? Number(dest.hostname.slice(1, 6))
              : Number(dest.port || 80);
            if (destPort === port)
              out.set("Location", url.origin + dest.pathname + dest.search + dest.hash);
            else if (port === 80 && destPort >= 30000 && destPort <= 30099)
              out.set(
                "Location",
                `/__remote/app-launch?port=${destPort}&path=${encodeURIComponent(dest.pathname + dest.search + dest.hash)}`,
              );
          }
        } catch {}
      }
      const setCookies = out.getSetCookie();
      out.delete("Set-Cookie");
      for (const c of setCookies) out.append("Set-Cookie", c.replace(/;\s*Domain=[^;]+/gi, ""));
      // Vaultwarden publishes absolute service URLs in this public config.
      // Adapt only the browser response; preserve its native-client domain.
      if (
        port === 30004 &&
        url.pathname === "/api/config" &&
        response.ok &&
        out.get("Content-Type")?.includes("json")
      ) {
        const config = (await response.json()) as { environment?: Record<string, unknown> };
        if (config.environment)
          for (const [key, value] of Object.entries(config.environment)) {
            if (typeof value !== "string" || !value) continue;
            try {
              const u = new URL(value);
              if (["p30004.umbrel.movenis.dev", "100.64.0.6", "umbrel.local"].includes(u.hostname))
                config.environment[key] = url.origin + u.pathname + u.search + u.hash;
            } catch {}
          }
        out.delete("Content-Length");
        out.delete("Content-Encoding");
        return Response.json(config, { status: response.status, headers: out });
      }
      let result = new Response(response.body, { status: response.status, headers: out });
      if (port === 80 && out.get("Content-Type")?.includes("text/html"))
        result = new HTMLRewriter()
          .on("head", {
            element(e) {
              e.prepend(
                '<script src="/__remote/network.js"></script><script src="/__remote/app-launch.js"></script>',
                { html: true },
              );
            },
          })
          .transform(result);
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const match = message.match(/AUTH_(\d{3}): ([\s\S]*)/);
      if (match) return json({ error: match[2] }, Number(match[1]));
      console.error(JSON.stringify({ event: "umbrel_proxy_failed" }));
      return json({ error: "The app is temporarily unavailable." }, 502);
    }
  },
} satisfies ExportedHandler<UmbrelEnv>;
