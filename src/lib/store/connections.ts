import { writable } from "svelte/store";
export type Protocol = "ssh" | "vnc" | "rdp";
export type Connection = {
  host: string;
  proto: Protocol;
  username: string;
  port: number;
  at: number;
};
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export const favorites = writable<string[]>(read("mesh-favorites", []));
export const recent = writable<Connection[]>(read("mesh-recent", []));
favorites.subscribe((v) => localStorage.setItem("mesh-favorites", JSON.stringify(v)));
recent.subscribe((v) => localStorage.setItem("mesh-recent", JSON.stringify(v)));
export function favorite(host: string) {
  favorites.update((v) => (v.includes(host) ? v.filter((h) => h !== host) : [...v, host]));
}
export function remember(c: Omit<Connection, "at">) {
  recent.update((v) =>
    [{ ...c, at: Date.now() }, ...v.filter((i) => i.host !== c.host || i.proto !== c.proto)].slice(
      0,
      8,
    ),
  );
}
export function connectionUrl(host = "", proto: Protocol = "ssh") {
  return `#/connect?${new URLSearchParams({ proto, ...(host ? { host } : {}) })}`;
}
export async function endSession() {
  try {
    await window.ipn.logout();
  } catch {
    console.warn(
      "The browser session ended locally. Headscale will remove its ephemeral node after the inactivity timeout.",
    );
  } finally {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith("ipn-state-")) sessionStorage.removeItem(key);
  }
}
