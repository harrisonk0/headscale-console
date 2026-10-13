// The authenticated bootstrap script carries public English translations so the
// dashboard can initialize even when the network filters its /locales/ URLs.
const scope = globalThis as typeof globalThis & {
  __hkremoteEnglish?: Record<string, unknown>;
};
const dictionary = scope.__hkremoteEnglish;
delete scope.__hkremoteEnglish;
if (dictionary) {
  const serialized = JSON.stringify(dictionary);
  const originalFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      location.href,
    );
    const method = init?.method || (input instanceof Request ? input.method : "GET");
    if (
      method.toUpperCase() === "GET" &&
      url.origin === location.origin &&
      /^\/locales\/en(?:-[A-Za-z0-9]{2,8})?\.json$/i.test(url.pathname)
    ) {
      return new Response(serialized, {
        headers: { "Content-Type": "application/json;charset=utf-8" },
      });
    }
    return Reflect.apply(originalFetch, window, [input, init]);
  };
}
