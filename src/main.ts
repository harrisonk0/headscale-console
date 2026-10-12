import { ModeWatcher } from "mode-watcher";
import { mount, unmount } from "svelte";

import { createClient, IpnEventHandler } from "$package/tailscale";

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
  const transport = cfg as typeof cfg & { relayProxyHost?: string; relayOriginHost?: string };
  Object.assign(window, {
    __meshRelayProxy: transport.relayProxyHost || "",
    __meshRelayOrigin: transport.relayOriginHost || "",
  });
  let sessionAuthKey: string | undefined;
  if (!window.ipnProfiles.currentProfile) {
    await unmount(loadingScreen!);
    loadingScreen = undefined;
    sessionAuthKey = await new Promise<string>((resolve) => {
      const gate = mount(SessionStart, {
        target: appEl,
        props: {
          controlUrl: cfg.controlUrl,
          onReady: async (key: string) => {
            await unmount(gate);
            resolve(key);
          },
        },
      });
    });
    loadingScreen = mount(LoadingScreen, { target: appEl });
  }
  loadUserSettings(cfg.defaults);

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
      hostname: "mesh-browser-" + crypto.randomUUID().slice(0, 8),
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
