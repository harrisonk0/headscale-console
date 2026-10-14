import { get, writable } from "svelte/store";
import type { Protocol } from "./connections";
export type PortState = "checking" | "open" | "closed" | "timeout" | "unknown";
type Result = { state: PortState; at: number; reason?: string };
export const portChecks = writable<Record<string, Result>>({});
export const protocolPort: Record<Protocol, number> = { ssh: 22, vnc: 5900, rdp: 3389 };
const pending = new Map<string, Promise<void>>();
export const portKey = (host: string, port: number) => `${host}:${port}`;

export async function checkPort(host: string, port: number, force = false): Promise<void> {
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return;
  const key = portKey(host, port);
  const existing = pending.get(key);
  if (existing) return existing;
  const cached = get(portChecks)[key];
  if (!force && cached && Date.now() - cached.at < 60000) return;
  portChecks.update((values) => ({ ...values, [key]: { state: "checking", at: Date.now() } }));
  const task = (async () => {
    let state: PortState = "unknown";
    let reason: string | undefined;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const channel = await window.ipn.tcp({
            hostname: host,
            port,
            connectTimeoutSeconds: 15,
            readCallback: () => {},
          });
          state = "open";
          reason = undefined;
          try {
            await channel.close();
          } catch {
            /* Cleanup cannot invalidate a successful check. */
          }
          break;
        } catch (error) {
          reason = String(error instanceof Error ? error.message : error)
            .replace(/hskey-[A-Za-z0-9_-]+/g, "[redacted]")
            .slice(0, 300);
          state = /connection refused|actively refused/i.test(reason)
            ? "closed"
            : /timeout|timed out|deadline/i.test(reason)
              ? "timeout"
              : "unknown";
          if (state === "closed") break;
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } finally {
      portChecks.update((values) => ({ ...values, [key]: { state, at: Date.now(), reason } }));
      pending.delete(key);
    }
  })();
  pending.set(key, task);
  return task;
}

export async function checkDevices(peers: IPNNetMapPeerNode[], force = false) {
  const jobs = peers
    .filter((peer) => peer.online && !peer.expired)
    .flatMap((peer) =>
      Object.values(protocolPort).map((port) => () => checkPort(peer.addresses[0], port, force)),
    );
  // Bound the probes, which run in the private tunnel and remain advisory.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < jobs.length) await jobs[cursor++]();
    }),
  );
}
