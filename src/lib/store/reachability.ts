import { get, writable } from "svelte/store";
import type { Protocol } from "./connections";
export type PortState = "checking" | "open" | "unreachable";
type Result = {state: PortState; at: number};
export const portChecks = writable<Record<string, Result>>({});
export const protocolPort: Record<Protocol, number> = {ssh: 22, vnc: 5900, rdp: 3389};
const pending = new Map<string, Promise<void>>();
export const portKey = (host: string, port: number) => `${host}:${port}`;
export async function checkPort(host: string, port: number, force = false): Promise<void> {
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return;
  const key = portKey(host, port);
  const existing = pending.get(key);
  if (existing) return existing;
  const cached = get(portChecks)[key];
  if (!force && cached && Date.now() - cached.at < 60000) return;
  portChecks.update(v => ({...v, [key]: {state: "checking", at: Date.now()}}));
  const task = (async () => {
    let state: PortState = "unreachable";
    try {
      const channel = await window.ipn.tcp({hostname: host, port, connectTimeoutSeconds: 3, readCallback: () => {}});
      state = "open";
      await channel.close();
    } catch { /* Unreachable includes closed ports and denied routes. */ }
    finally {portChecks.update(v => ({...v, [key]: {state, at: Date.now()}}));pending.delete(key);}
  })();
  pending.set(key, task);
  return task;
}
export async function checkDevices(peers: IPNNetMapPeerNode[], force = false) {
  const jobs = peers.filter(p => p.online && !p.expired).flatMap(p => Object.values(protocolPort).map(port => () => checkPort(p.addresses[0], port, force)));
  // Limit simultaneous probes and cache for one minute to avoid repeatedly
  // opening connections whenever the dashboard is visited.
  let cursor = 0;
  await Promise.all(Array.from({length: 3}, async () => {while (cursor < jobs.length) await jobs[cursor++]();}));
}
