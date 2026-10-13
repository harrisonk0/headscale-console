import { ModeWatcher } from "mode-watcher";
import { mount, unmount } from "svelte";

import { createClient, prepareClient, IpnEventHandler } from "$package/tailscale";

import { Toaster } from "$lib/components/ui/sonner";

import { CriticalError } from "$lib/components/error";

import { ipnStatePrefix, loadIpnProfiles, netMap } from "$lib/store/ipn";
import { loadUserSettings } from "$lib/store/settings";
import { registerServiceWorker } from "$lib/utils/sw";
import { loadAppConfig } from "./lib/store/config";
import { AppRouter } from "$lib/utils/router";
import toast from "$lib/utils/toast";

import routes from "$routes";

import "./app.css";
import "./mesh.css";

import LoadingScreen from "./LoadingScreen.svelte";
import NotFound from "./routes/404.svelte";
import Critical from "./Critical.svelte";
import { restoreBrowserIdentity } from "$lib/store/resume";
import { claimBrowserSession } from "$lib/store/session-lease";
import SessionInUse from "$lib/components/SessionInUse.svelte";
import { checkBrowserTransport } from "$lib/utils/transport-check";
import { reportStartup } from "$lib/store/startup-status";
import SessionStart from "$lib/components/SessionStart.svelte";

declare global {
  interface Window {
    readonly appRouter: AppRouter;
    readonly ipn: IPN;
    readonly ipnEventHandler: IpnEventHandler;
    readonly ipnProfiles: ReturnType<typeof loadIpnProfiles>;
  }
}

(async () => {
  mount(ModeWatcher, { target: document.body });
  mount(Toaster, { target: document.body });

  const appEl = document.getElementById("app");
  if (!appEl) {
    throw new Error("Failed to get HTML element #app");
  }

  let stopped: boolean = false;

  let loadingScreen: object | undefined = mount(LoadingScreen, {
    target: appEl,
  });

  registerServiceWorker();
  reportStartup("Website loaded", "ok");

  if (!window.navigator.onLine) {
    await unmount(loadingScreen);
    mount(Critical, {
      target: appEl,
      props: {
        title: "Offline",
        message: "Please check your network connection.",
      },
    });
    return;
  }

  // Remove legacy disk-persisted private identities and token-bearing URLs.
  for (const key of Object.keys(localStorage))
    if (key.startsWith(ipnStatePrefix)) localStorage.removeItem(key);
  if (new URLSearchParams(location.search).has("authkey"))
    history.replaceState(null, "", location.pathname + location.hash);
  Object.assign(window, { ipnProfiles: loadIpnProfiles() });
  const cfg = await loadAppConfig();
  // Warm the public WASM download while the user signs in. No join key exists yet.
  void prepareClient().catch(() => {});
  let transportReady = false;
  const transport = cfg as typeof cfg & { relayProxyHost?: string; relayOriginHost?: string };
  Object.assign(window, {
    __meshRelayProxy: transport.relayProxyHost || "",
    __meshRelayOrigin: transport.relayOriginHost || "",
  });
  const setupToken = new URLSearchParams(location.hash.split("?")[1] || "").get("setup") || "";
  if (setupToken) history.replaceState(null, "", location.pathname + "#/setup");
  async function prepareSession(progress: (message: string) => void = () => {}) {
    const r = await fetch("/api/remote/status", {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error("Could not restore your browser session.");
    const status = await r.json();
    if (!status.authenticated || !status.resumeKey)
      throw new Error("Sign in again to restore your session.");
    reportStartup("Web login accepted", "ok");
    progress("Loading the browser networking client…");
    reportStartup("Downloading and compiling the browser client");
    try {
      await prepareClient();
    } catch {
      throw new Error(
        "The browser networking client could not load. This network or browser may be blocking the download or WebAssembly.",
      );
    }
    reportStartup("Browser client is ready", "ok");
    if (!transportReady) {
      progress("Checking the live homelab connection…");
      const result = await checkBrowserTransport(cfg.controlUrl);
      if (!result.control) {
        reportStartup(result.message, "error");
        throw new Error(result.message);
      }
      transportReady = true;
    }
    progress("Restoring your temporary browser session…");
    await claimBrowserSession(
      (move) =>
        new Promise<void>((resolve) => {
          const dialog = mount(SessionInUse, {
            target: document.body,
            props: {
              takeOver: async () => {
                await move();
                await unmount(dialog);
                resolve();
              },
            },
          });
        }),
    );
    await restoreBrowserIdentity(status.resumeKey, status.expiresAt);
    reportStartup("Browser session ownership acquired", "ok");
    Object.assign(window, { ipnProfiles: loadIpnProfiles() });
    return !window.ipnProfiles.currentProfile;
  }
  let sessionAuthKey: string | undefined;
  {
    await unmount(loadingScreen!);
    loadingScreen = undefined;
    sessionAuthKey = await new Promise<string>((resolve) => {
      const gate = mount(SessionStart, {
        target: appEl,
        props: {
          setupToken,
          prepareSession,
          needsNode: !window.ipnProfiles.currentProfile,
          onReady: async (key: string) => {
            await unmount(gate);
            resolve(key);
          },
        },
      });
    });
    loadingScreen = mount(LoadingScreen, { target: appEl });
  }
  if (/^#\/setup(?:\?|$)/i.test(location.hash))
    history.replaceState(null, "", location.pathname + "#/");
  loadUserSettings(cfg.defaults);

  reportStartup("Starting Tailscale in this browser");
  Object.assign(window, {
    ipnEventHandler: new IpnEventHandler(),
    ipn: await createClient({
      panicHandler: async (err) => {
        console.error(err);
        await window.appRouter.unmount();
        mount(CriticalError, {
          target: appEl,
          props: { error: err },
        });
      },
      routeAll: true,
      authKey: sessionAuthKey,
      hostname:
        window.ipnProfiles.currentProfile?.Hostname ||
        "mesh-browser-" + crypto.randomUUID().slice(0, 8),
      controlURL: cfg.controlUrl,
      advertiseTags: "",
    }),
    appRouter: new AppRouter({
      target: appEl,
      fallbackComponent: NotFound,
      routes,
    }),
  });

  window.ipnEventHandler.addEventListener(window.ipnEventHandler.Events.state, async (ev) => {
    console.info("state:", ev.detail.state);
    const labels: Record<IPNState, string> = {
      NoState: "Tailscale initialized",
      InUseOtherUser: "Tailscale is waiting for session ownership",
      NeedsLogin: sessionAuthKey
        ? "Registering the temporary browser device"
        : "Reconnecting the saved browser device",
      NeedsMachineAuth: "Waiting for device approval",
      Stopped: "Tailscale stopped",
      Starting: "Connecting to the coordination server",
      Running: "Connected to your homelab",
    };
    reportStartup(labels[ev.detail.state], ev.detail.state === "Running" ? "ok" : "working");
    switch (ev.detail.state) {
      case "NeedsLogin":
        if (stopped) break;

        Object.assign(window, { ipnProfiles: loadIpnProfiles() });

        if (loadingScreen) {
          await unmount(loadingScreen);
          loadingScreen = undefined;
        }

        window.appRouter.onResolve = () => "/_internal/auth";
        window.appRouter.resolve();

        if (!Object.keys(window.ipnProfiles.profiles).length) {
          // Trigger login only with the API-created ephemeral key.
          if (sessionAuthKey) window.ipn.login();
        }

        break;
      case "Running":
        Object.assign(window, { ipnProfiles: loadIpnProfiles() });

        if (
          !window.ipnProfiles.current ||
          !window.ipnProfiles.profiles[window.ipnProfiles.current]
        ) {
          throw new Error("Failed to load profile");
        }

        window.appRouter.onResolve = undefined;

        if (loadingScreen) {
          await unmount(loadingScreen);
          loadingScreen = undefined;
        }

        await window.appRouter.resolve();

        break;
      case "Stopped":
        stopped = true;

        await window.appRouter.unmount();

        for (const key of Object.keys(sessionStorage))
          if (key.startsWith(ipnStatePrefix)) sessionStorage.removeItem(key);

        mount(Critical, {
          target: appEl,
          props: {
            title: "Stopped",
            message: "The session has ended. Refresh the page to start a new session.",
          },
        });
        break;
    }
  });

  window.ipnEventHandler.addEventListener(window.ipnEventHandler.Events.netMap, (ev) => {
    try {
      if (typeof ev.detail.netMapStr !== "string") return;
      netMap.set(JSON.parse(ev.detail.netMapStr));
      reportStartup("Device list received", "ok");
    } catch (err) {
      console.error(err);
      toast.error(`Failed to parse NetMap: ${err?.toString()}`);
    }
  });

  window.ipnEventHandler.addEventListener(window.ipnEventHandler.Events.panicRecover, (ev) => {
    toast.error("Panic Recover: " + ev.detail.err);
  });

  window.ipn.run(window.ipnEventHandler);
})();
