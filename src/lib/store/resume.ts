const prefix = "ipn-state-";
const cacheName = "hk-remote-sealed-session";
let key: CryptoKey | undefined;
let expiresAt = 0;
let generation = 0;
let writes = Promise.resolve();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export async function restoreBrowserIdentity(secret: string, expiry: number) {
  const version = ++generation;
  expiresAt = expiry;
  key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(secret.match(/../g) || [], (v) => parseInt(v, 16)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
  const raw = localStorage.getItem(cacheName);
  if (raw) {
    try {
      const cache = JSON.parse(raw);
      if (cache.expiresAt <= Date.now()) throw new Error("Expired session");
      const bytes = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(cache.iv) },
        key,
        decode(cache.data),
      );
      if (version !== generation) return;
      const state = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>;
      for (const name of Object.keys(sessionStorage))
        if (name.startsWith(prefix)) sessionStorage.removeItem(name);
      for (const [name, value] of Object.entries(state))
        if (name.startsWith(prefix) && typeof value === "string")
          sessionStorage.setItem(name, value);
    } catch {
      localStorage.removeItem(cacheName);
    }
  }
  cacheBrowserIdentity();
  await flushBrowserIdentity();
}
export function cacheBrowserIdentity() {
  if (!key || expiresAt <= Date.now()) return;
  const currentKey = key,
    expiry = expiresAt,
    version = generation;
  const state = Object.fromEntries(
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(prefix))
      .map((k) => [k, sessionStorage.getItem(k)]),
  );
  writes = writes
    .catch(() => {})
    .then(async () => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        currentKey,
        new TextEncoder().encode(JSON.stringify(state)),
      );
      if (version === generation)
        localStorage.setItem(
          cacheName,
          JSON.stringify({ iv: encode(iv), data: encode(new Uint8Array(data)), expiresAt: expiry }),
        );
    });
}
export const flushBrowserIdentity = () => writes;
export function forgetBrowserIdentity() {
  generation++;
  key = undefined;
  localStorage.removeItem(cacheName);
}
