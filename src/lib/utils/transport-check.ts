import { enableHttpsSockets } from "./https-socket";
import { prefersHttpsRelay } from "./relay-mode";
import { reportStartup } from "$lib/store/startup-status";
export type TransportCheck = {
  https: boolean;
  websocket: boolean;
  control: boolean;
  message: string;
};

function socketCheck(url: string, protocol?: string): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: WebSocket;
    try {
      socket = protocol ? new WebSocket(url, protocol) : new WebSocket(url);
    } catch {
      resolve(false);
      return;
    }
    socket.binaryType = "arraybuffer";
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(ok);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      else if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => socket.close(), { once: true });
      }
    };
    const timer = setTimeout(() => finish(false), 8000);
    socket.onopen = () => {
      if (protocol === "derp") {
        if (socket.protocol !== protocol) finish(false);
      } else if (protocol) finish(socket.protocol === protocol);
      else socket.send(new Uint8Array([72, 75, 82, 77]));
    };
    socket.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      if (protocol === "derp") {
        // Require the actual binary server greeting, not just an HTTP upgrade.
        finish(
          bytes.length >= 45 && bytes[0] === 1 && bytes[5] === 68 &&
            bytes[6] === 69 && bytes[7] === 82 && bytes[8] === 80,
        );
        return;
      }
      if (protocol) return;
      finish(
        bytes.length === 4 &&
          bytes[0] === 72 &&
          bytes[1] === 75 &&
          bytes[2] === 82 &&
          bytes[3] === 77,
      );
    };
    socket.onerror = () => finish(false);
    socket.onclose = () => finish(false);
  });
}

/** Verify transport before requesting a device key; these checks never register a node. */
export async function checkBrowserTransport(controlUrl: string): Promise<TransportCheck> {
  const base = new URL(controlUrl);
  reportStartup("Checking HTTPS to " + base.hostname);
  try {
    const response = await fetch(new URL("/key?v=142", base), {
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok || typeof data.publicKey !== "string" || !data.publicKey.startsWith("mkey:")) {
      throw new Error();
    }
  } catch {
    return {
      https: false,
      websocket: false,
      control: false,
      message:
        "Sign-in works, but this browser cannot reach the separate homelab connection server. The network may be blocking its address or certificate.",
    };
  }
  reportStartup("Homelab HTTPS and public-key lookup passed", "ok");
  let httpsOnly = prefersHttpsRelay();
  const activateHttps = () => {
    httpsOnly = true;
    enableHttpsSockets(controlUrl, { report: reportStartup });
  };
  if (httpsOnly) {
    activateHttps();
    reportStartup("Using the saved HTTPS-only connection setting", "ok");
  }
  reportStartup(httpsOnly ? "Checking HTTPS relay transport" : "Checking binary WebSocket traffic");
  const socket = new URL("/__proxy/socket-check", base);
  socket.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  if (!(await socketCheck(socket.href))) {
    if (httpsOnly) {
      return {
        https: true,
        websocket: false,
        control: false,
        message:
          "The authenticated HTTPS connection failed. Sign in again or copy the connection diagnostics.",
      };
    }
    reportStartup("Browser WebSockets failed; trying the authenticated HTTPS fallback");
    activateHttps();
    if (!(await socketCheck(socket.href))) {
      return {
        https: true,
        websocket: false,
        control: false,
        message:
          "The native WebSocket and HTTPS fallback both failed. This network may be blocking the live connection requests.",
      };
    }
    reportStartup("Binary traffic passed through HTTPS fallback", "ok");
  } else {reportStartup(
      httpsOnly ? "HTTPS relay transport passed" : "Binary WebSocket traffic passed",
      "ok",
    );}
  reportStartup("Checking the private relay's binary greeting");
  socket.pathname = "/derp";
  let relayOk = await socketCheck(socket.href, "derp");
  if (!relayOk && !httpsOnly) {
    reportStartup("The relay WebSocket failed; switching to authenticated HTTPS");
    activateHttps();
    relayOk = await socketCheck(socket.href, "derp");
  }
  if (!relayOk) {
    return {
      https: true,
      websocket: false,
      control: false,
      message:
        "Sign-in works, but the private relay cannot exchange data on this network. Reconnect using HTTPS-only mode or copy the connection diagnostics.",
    };
  }
  reportStartup("Private relay binary greeting received", "ok");
  reportStartup("Checking the Tailscale WebSocket protocol");
  socket.pathname = "/ts2021";
  let controlOk = await socketCheck(socket.href, "tailscale-control-protocol");
  if (!controlOk && !httpsOnly) {
    reportStartup("The control WebSocket failed; switching to authenticated HTTPS");
    activateHttps();
    controlOk = await socketCheck(socket.href, "tailscale-control-protocol");
    socket.pathname = "/derp";
    relayOk = await socketCheck(socket.href, "derp");
  }
  if (!controlOk || !relayOk) {
    return {
      https: true,
      websocket: true,
      control: false,
      message:
        "Ordinary WebSockets work, but the homelab protocol handshake failed. The network proxy may be filtering that handshake, or the connection service may be unavailable.",
    };
  }
  reportStartup("Tailscale control protocol accepted", "ok");
  return {
    https: true,
    websocket: true,
    control: true,
    message: "The browser can reach the homelab server and its live connection.",
  };
}
