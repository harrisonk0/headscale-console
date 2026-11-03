import { AuthGuard } from "./auth";
export { AuthGuard };
const remoteCookie = "__Host-hkremote",
  umbrelCookie = "__Host-umbrel";
function cookie(request: Request, name: string) {
  return (
    (request.headers.get("Cookie") || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
const cookieHeader = (name: string, value: string, seconds = 1800) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
async function body(request: Request, maxBytes = 4096): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new Error("AUTH_400: JSON is required.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("AUTH_400: Missing request body.");
  let text = "",
    size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("AUTH_413: Request too large.");
    }
    text += decoder.decode(part.value, { stream: true });
  }
  try {
    const value = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error("AUTH_400: Invalid request.");
  }
}
function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
function entryPage() {
  const nonce = crypto.randomUUID();
  return new Response(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Opening Umbrel</title></head><body style="font:16px system-ui;background:#101817;color:#e6ece5;padding:50px"><h1>Opening your Umbrel…</h1><p id="message">Verifying your private session.</p><script nonce="${nonce}">(async()=>{const ticket=new URLSearchParams(location.hash.slice(1)).get("ticket");history.replaceState(null,"",location.pathname);try{const r=await fetch("/__remote/umbrel-open",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticket})});if(!r.ok)throw new Error((await r.json()).error||"Open Umbrel again from HK Remote.");location.replace("/");}catch(e){document.getElementById("message").textContent=e.message;}})();</script></body></html>`,
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url),
      origin = request.headers.get("Origin");
    const allowed =
      origin === env.APP_ORIGIN || origin === url.origin || origin === "http://localhost:5173";
    const headers = new Headers({
      "Access-Control-Allow-Origin": origin && allowed ? origin : env.APP_ORIGIN,
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Tailscale-Challenge",
      Vary: "Origin",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    const json = (value: unknown, status = 200, setCookie?: string) => {
      const h = new Headers(headers);
      if (setCookie) h.set("Set-Cookie", setCookie);
      return Response.json(value, { status, headers: h });
    };
    const auth = env.AUTH.getByName(env.OWNER_ID);
    try {
      if (origin && !allowed) return json({ error: "Origin not allowed." }, 403);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (url.pathname === "/__proxy/status")
        return json({ ok: true, transport: "websocket", version: 2 });
      if (url.pathname === "/__proxy/socket-check") {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
          return json({ error: "WebSocket required." }, 426);
        const pair = new WebSocketPair();
        pair[1].binaryType = "arraybuffer";
        pair[1].accept();
        const probeTimeout = setTimeout(() => pair[1].close(1000, "Probe timed out"), 8000);
        pair[1].addEventListener("close", () => clearTimeout(probeTimeout));
        pair[1].addEventListener("message", (event) => {
          clearTimeout(probeTimeout);
          if (typeof event.data === "string" || event.data.byteLength !== 4) {
            pair[1].close(1008, "Invalid probe");
            return;
          }
          const bytes = new Uint8Array(event.data);
          if (bytes[0] !== 72 || bytes[1] !== 75 || bytes[2] !== 82 || bytes[3] !== 77) {
            pair[1].close(1008, "Invalid probe");
            return;
          }
          pair[1].send(event.data);
          pair[1].close(1000, "Probe complete");
        });
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      if (url.pathname === "/__remote/umbrel-entry") return entryPage();
      if (url.pathname === "/__remote/umbrel-open") {
        if (request.method !== "POST" || origin !== url.origin)
          return json({ error: "Origin not allowed." }, 403);
        const b = await body(request);
        const token = await auth.redeem(text(b.ticket));
        return json({ ok: true }, 200, cookieHeader(umbrelCookie, token));
      }
      if (url.pathname.startsWith("/__remote/auth/")) {
        const action = url.pathname.slice("/__remote/auth/".length),
          session = cookie(request, remoteCookie);
        // Public, immutable Linux distribution only. Personal disk overlays
        // remain behind desktopSession/MFA and are never served by this route.
        if (action === "desktop/base" && ["GET", "HEAD"].includes(request.method)) {
          const range = request.headers.get("Range");
          const match = range?.match(/^bytes=(\d+)-(\d+)$/);
          if (request.method === "GET" && (!match || Number(match[2]) < Number(match[1]) ||
              Number(match[2]) - Number(match[1]) >= 8 * 1024 * 1024))
            return json({ error: "A bounded image range is required." }, 416);
          const h = new Headers({ "X-HKRemote-Bridge": env.UMBREL_BRIDGE_SECRET });
          if (range) h.set("Range", range);
          const r = await fetch(new URL("/__hkdesktop-base/hk-icewm-v1-f6a296075b6f.ext2", env.ORIGIN), {
            method: request.method, headers: h, redirect: "error", signal: AbortSignal.timeout(30000),
          });
          const out = new Headers(headers);
          for (const name of ["Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"])
            if (r.headers.has(name)) out.set(name, r.headers.get(name)!);
          out.set("Content-Type", "application/octet-stream");
          out.set("Cache-Control", r.ok ? "public, max-age=31536000, immutable" : "no-store");
          out.set("Vary", "Origin, Range");
          return new Response(r.body, { status: r.status, headers: out });
        }
        if (action === "status" && request.method === "GET")
          return json(await auth.status(session));
        if (/^desktop\/socket\/(open|read|write|close)$/.test(action)) {
          if (request.method !== "POST" || !(origin === env.APP_ORIGIN || origin === "http://localhost:5173"))
            return json({ error: "Origin not allowed." }, 403);
          return json(await auth.desktopSocket(session, action.slice(15), await body(request, 400000)));
        }
        if (["desktop/key", "desktop/probe"].includes(action) && request.method === "POST" &&
            (origin === env.APP_ORIGIN || origin === "http://localhost:5173")) {
          await auth.desktopSession(session);
          const r = await fetch(new URL(action === "desktop/key" ? "/__hkdesktop-network/key?v=113" : "/__hkdesktop-network/derp/probe", env.ORIGIN), {
            method: action === "desktop/key" ? "GET" : "HEAD",
            headers: { "X-HKRemote-Bridge": env.UMBREL_BRIDGE_SECRET },
            signal: AbortSignal.timeout(10000), redirect: "error",
          });
          const h = new Headers(headers); h.set("Content-Type", "application/json");
          return new Response(r.body, { status: r.status, headers: h });
        }
        if (/^desktop\/(claim|heartbeat|release|put|read|commit|join|resume|begin)$/.test(action)) {
          if (request.method !== "POST" || !(origin === env.APP_ORIGIN || origin === "http://localhost:5173"))
            return json({ error: "Origin not allowed." }, 403);
          const identity = await auth.desktopSession(session);
          if (action === "desktop/join") await auth.reserveJoin(session);
          const data = await body(request, 8 * 1024 * 1024);
          const result = await fetch(new URL("/__hkdesktop/" + action.slice(8), env.ORIGIN), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-HKRemote-Bridge": env.UMBREL_BRIDGE_SECRET,
              "X-Desktop-Session": identity.hash,
              "X-Desktop-Expires": String(identity.expires),
            },
            body: JSON.stringify(data),
            signal: AbortSignal.timeout(25000),
            redirect: "error",
          });
          const h = new Headers(headers);
          h.set("Content-Type", "application/json");
          return new Response(result.body, { status: result.status, headers: h });
        }
        if (
          request.method !== "POST" ||
          !(origin === env.APP_ORIGIN || origin === "http://localhost:5173")
        )
          return json({ error: "Origin not allowed." }, 403);
        const b = await body(request, action === "socket/write" ? 400000 : 10000);
        if (action === "socket/open") {
          const path = text(b.path);
          const url = new URL(path, env.ORIGIN);
          if (path !== url.pathname + url.search || path.length > 8192)
            return json({ error: "Invalid transport path." }, 400);
          const host = text(b.relayHost);
          if (host) {
            if (!/^derp[0-9]+[a-z]*\.tailscale\.com$/.test(host) || url.pathname !== "/derp")
              return json({ error: "Invalid relay." }, 400);
            url.hostname = host;
          }
          if (!Array.isArray(b.protocols) || b.protocols.some((p) => typeof p !== "string"))
            return json({ error: "Invalid protocol." }, 400);
          return json(await auth.openTransport(session, url.href, b.protocols as string[]));
        }
        if (action === "socket/read")
          return json(await auth.readTransport(session, text(b.id), Number(b.ack)));
        if (action === "socket/write")
          return json(
            await auth.writeTransport(
              session,
              text(b.id),
              Number(b.sequence),
              b.frames as { kind: "binary" | "text"; data: string }[],
            ),
          );
        if (action === "socket/close") return json(await auth.closeTransport(session, text(b.id)));
        if (action === "setup/start") return json(await auth.beginSetup(text(b.setupToken)));
        if (action === "setup/finish") {
          const result = await auth.finishSetup(text(b.setupToken), text(b.password), text(b.code));
          return json(
            { ok: true, recovery: result.recovery },
            200,
            cookieHeader(remoteCookie, result.session),
          );
        }
        if (action === "login") {
          const token = await auth.login(
            text(b.password),
            text(b.code),
            request.headers.get("CF-Connecting-IP") || "unknown",
          );
          return json({ ok: true }, 200, cookieHeader(remoteCookie, token));
        }
        if (action === "logout") {
          await auth.logout(session);
          return json({ ok: true }, 200, cookieHeader(remoteCookie, "", 0));
        }
        if (action === "umbrel-ticket") {
          const ticket = await auth.ticket(session);
          return json({
            url: `https://hk-remote-umbrel.harrisonk-0.workers.dev/__remote/umbrel-entry#ticket=${ticket}`,
          });
        }
        if (action === "join") {
          await auth.reserveJoin(session);
          const approval = await fetch(new URL("/api/v1/preauthkey", env.ORIGIN), {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.HEADSCALE_ADMIN_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              user: env.OWNER_ID,
              ephemeral: true,
              reusable: false,
              expiration: new Date(Date.now() + 120000).toISOString(),
            }),
          });
          if (!approval.ok)
            return json(
              {
                error:
                  "Server approval is unavailable. Its private Headscale credential may need renewal.",
              },
              502,
            );
          const data = (await approval.json()) as {
            preAuthKey?: { key: string; ephemeral: boolean };
          };
          if (!data.preAuthKey?.ephemeral || !data.preAuthKey.key)
            return json({ error: "Headscale did not return an ephemeral key." }, 502);
          return json({ authKey: data.preAuthKey.key });
        }
        return json({ error: "Not found." }, 404);
      }
      const control =
        /^\/(key|ts2021|machine(?:\/.*)?|derp(?:\/.*)?|register\/[a-zA-Z0-9_-]+|health)$/.test(
          url.pathname,
        );
      const upstreamHeaders = new Headers(request.headers);
      upstreamHeaders.delete("Host");
      let target: URL;
      if (control) {
        if (!["GET", "HEAD", "POST"].includes(request.method))
          return json({ error: "Method not allowed." }, 405);
        upstreamHeaders.delete("Cookie");
        target = new URL(url.pathname + url.search, env.ORIGIN);
      } else {
        if (!(await auth.allowUmbrel(cookie(request, umbrelCookie))))
          return new Response(
            `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="font:16px system-ui;padding:40px"><h1>Sign in to HK Remote first.</h1><p>Open Umbrel from your machines dashboard.</p><a href="${env.APP_ORIGIN}">Open HK Remote</a></body></html>`,
            {
              status: 401,
              headers: {
                "Content-Type": "text/html",
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
                "Content-Security-Policy":
                  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
              },
            },
          );
        if (request.method === "GET" && url.pathname === "/") {
          const ticket = await auth.appTicket(cookie(request, umbrelCookie), 80);
          return new Response(null, {
            status: 303,
            headers: {
              Location: `https://hk-remote-umbrel.harrisonk-0.workers.dev/__remote/umbrel-entry#ticket=${ticket}`,
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
            },
          });
        }
        target = new URL("/__hkremote" + url.pathname + url.search, env.ORIGIN);
        upstreamHeaders.set("X-HKRemote-Bridge", env.UMBREL_BRIDGE_SECRET);
        const cookies = (request.headers.get("Cookie") || "")
          .split(";")
          .filter(
            (v) =>
              !v.trim().startsWith(remoteCookie + "=") && !v.trim().startsWith(umbrelCookie + "="),
          )
          .join(";");
        if (cookies) upstreamHeaders.set("Cookie", cookies);
        else upstreamHeaders.delete("Cookie");
      }
      const response = await fetch(
        new Request(target, {
          method: request.method,
          headers: upstreamHeaders,
          body: request.body,
          redirect: "manual",
        }),
      );
      if (response.status === 101) return response;
      const out = new Headers(response.headers);
      headers.forEach((v, k) => out.set(k, v));
      const location = out.get("Location");
      if (location) {
        if (control && location.startsWith(env.ORIGIN))
          out.set("Location", url.origin + location.slice(env.ORIGIN.length));
        else if (!control)
          out.set(
            "Location",
            location.replace(
              /^https?:\/\/(100\.64\.0\.6(?::80)?|umbrel\.local)(?=\/|$)/,
              url.origin,
            ),
          );
      }
      if (!control) {
        const cookies = out.getSetCookie();
        if (cookies.length) {
          out.delete("Set-Cookie");
          for (const c of cookies) out.append("Set-Cookie", c.replace(/;\s*Domain=[^;]+/gi, ""));
        }
      }
      return new Response(response.body, { status: response.status, headers: out });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const match = message.match(/AUTH_(\d{3}): ([\s\S]*)/);
      if (match) return json({ error: match[2] }, Number(match[1]));
      console.error(JSON.stringify({ event: "request_failed" }));
      return json({ error: "The service is temporarily unavailable. Try again." }, 502);
    }
  },
} satisfies ExportedHandler<Env>;
