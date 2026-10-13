import { writable, get } from "svelte/store";
import appVersion from "virtual:app-version";

export type StartupStep = { at: number; message: string; state: "working" | "ok" | "error" };
const started = Date.now();
export const startupSteps = writable<StartupStep[]>([]);
export function reportStartup(message: string, state: StartupStep["state"] = "working") {
  startupSteps.update((steps) => {
    const last = steps.at(-1);
    if (last?.message === message && last.state === state) return steps;
    return [...steps, { at: Date.now() - started, message, state }].slice(-24);
  });
}
export function diagnosticText() {
  return JSON.stringify(
    { appVersion, browser: navigator.userAgent, steps: get(startupSteps) },
    null,
    2,
  );
}
