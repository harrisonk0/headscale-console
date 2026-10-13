import { enableHttpsSockets } from "./https-socket";

// Umbrel's authenticated dashboard uses tRPC WebSockets even for ordinary queries.
// Carry that one endpoint over same-origin HTTPS on the restricted-network proxy.
enableHttpsSockets(location.origin, {
  apiBase: "/__remote/socket",
  pathOnly: "/trpc",
  report(message, state) {
    if (state !== "error") return;
    const show = () => {
      let box = document.getElementById("hkremote-network-status");
      if (!box) {
        box = document.createElement("aside");
        box.id = "hkremote-network-status";
        box.setAttribute("role", "alert");
        box.style.cssText = "position:fixed;bottom:16px;left:16px;right:16px;z-index:999999;padding:16px;border-radius:12px;background:#202c2a;color:#fff;font:14px system-ui;box-shadow:0 4px 24px #0008";
        document.body.append(box);
      }
      box.replaceChildren(document.createTextNode(message + ". "));
      const link = document.createElement("a");
      link.href = "https://hk-remote.vercel.app";
      link.textContent = "Open HK Remote to reconnect";
      link.style.color = "#b5f5d9";
      box.append(link);
    };
    if (document.body) show();
    else document.addEventListener("DOMContentLoaded", show, { once: true });
  },
});
