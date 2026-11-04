import { mount } from "svelte";
import "./app.css";
import "./mesh.css";
import { ModeWatcher } from "mode-watcher";
import { Toaster } from "$lib/components/ui/sonner";
mount(ModeWatcher, {target: document.body});
mount(Toaster, {target: document.body});
// Retire the old offline app shell so it cannot serve the previous portal.
try {
  const worker = navigator.serviceWorker;
  if (worker?.getRegistrations) {
    void worker.getRegistrations().then(registrations =>
      Promise.all(registrations.map(registration => registration.unregister()))
    ).catch(() => {});
  }
} catch { /* Restricted browsers can disable this optional API. */ }
void import("./Portal.svelte").then(({default: Portal}) => {
  mount(Portal, {target: document.getElementById("app")!});
});
