import { mount } from "svelte";
import "./app.css";
import "./mesh.css";
import { ModeWatcher } from "mode-watcher";
import { Toaster } from "$lib/components/ui/sonner";
mount(ModeWatcher, {target: document.body});
mount(Toaster, {target: document.body});
// Retire the old offline app shell so it cannot serve the previous portal.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then(registrations =>
    Promise.all(registrations.map(registration => registration.unregister()))
  ).catch(() => {});
}
void import("./Portal.svelte").then(({default: Portal}) => {
  mount(Portal, {target: document.getElementById("app")!});
});
