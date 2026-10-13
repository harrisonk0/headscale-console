/** Caller must check the private Umbrel session before serving any response. */
export async function serveLocale(
  request: Request,
  origin: string,
  bridge: string,
  ctx: ExecutionContext,
) {
  const url = new URL(request.url);
  const match = /^\/locales\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)\.json$/.exec(url.pathname);
  if (!match || request.method !== "GET") return undefined;
  // Umbrel ships en.json, not regional English dictionaries. Reject HTML SPA
  // fallbacks rather than returning them as successful translation files.
  const language = /^en(?:-|$)/i.test(match[1]) ? "en" : match[1];
  const key = new Request(url.origin + `/locales/${language}.json`);
  const cache = await caches.open("hkremote-umbrel-locales-v1");
  const cached = await cache.match(key);
  const outward = (response: Response, hit: boolean) => {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-cache");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-HKRemote-Cache", hit ? "HIT" : "MISS");
    return new Response(response.body, { status: response.status, headers });
  };
  if (cached) return outward(cached, true);
  const target = new URL(`/__hkremote/locales/${language}.json`, origin);
  const response = await fetch(target, {
    headers: { Accept: "application/json", "X-HKRemote-Bridge": bridge },
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json"))
    return Response.json(
      { error: "This language file is unavailable." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing language file");
  const decoder = new TextDecoder();
  let text = "",
    size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 1024 * 1024) {
      await reader.cancel();
      throw new Error("Language file too large");
    }
    text += decoder.decode(part.value, { stream: true });
  }
  const dictionary = JSON.parse(text + decoder.decode());
  if (!dictionary || typeof dictionary !== "object" || Array.isArray(dictionary))
    throw new Error("Invalid language file");
  const result = Response.json(dictionary, { headers: { "Cache-Control": "public, max-age=300" } });
  ctx.waitUntil(cache.put(key, result.clone()).catch(() => {}));
  return outward(result, false);
}
