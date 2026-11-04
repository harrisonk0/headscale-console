import { mount } from "svelte";
import "./app.css";
import "./mesh.css";
import { ModeWatcher } from "mode-watcher";
import { Toaster } from "$lib/components/ui/sonner";
import { registerServiceWorker } from "$lib/utils/sw";
mount(ModeWatcher, {target: document.body});
mount(Toaster, {target: document.body});
registerServiceWorker();
void import("./Portal.svelte").then(({default: Portal}) => {
  mount(Portal, {target: document.getElementById("app")!});
});
