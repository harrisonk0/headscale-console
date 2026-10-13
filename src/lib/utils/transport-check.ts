import { enableHttpsSockets } from "./https-socket";
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
      else if (socket.readyState === WebSocket.CONNECTING)
        socket.addEventListener("open", () => socket.close(), { once: true });
    };
    const timer = setTimeout(() => finish(false), 8000);
    socket.onopen = () => {
      if (protocol) finish(socket.protocol === protocol);
      else socket.send(new Uint8Array([72, 75, 82, 77]));
    };
    socket.onmessage = (event) => {
      if (protocol || !(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
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

/** These public probes send no credentials and register no Tailnet device. */
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
    if (!response.ok || typeof data.publicKey !== "string" || !data.publicKey.startsWith("mkey:"))
      throw new Error();
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
  reportStartup("Checking binary WebSocket traffic");
  const socket = new URL("/__proxy/socket-check", base);
  socket.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  if (!(await socketCheck(socket.href))) {
    reportStartup("Browser WebSockets failed; trying the authenticated HTTPS fallback");
    enableHttpsSockets(controlUrl);
    if (!(await socketCheck(socket.href)))
      return {
        https: true,
        websocket: false,
        control: false,
        message:
          "The native WebSocket and HTTPS fallback both failed. This network may be blocking the live connection requests.",
      };
    reportStartup("Binary traffic passed through HTTPS fallback", "ok");
  } else reportStartup("Binary WebSocket traffic passed", "ok");
  reportStartup("Checking the Tailscale WebSocket protocol");
  socket.pathname = "/ts2021";
  if (!(await socketCheck(socket.href, "tailscale-control-protocol")))
    return {
      https: true,
      websocket: true,
      control: false,
      message:
        "Ordinary WebSockets work, but the homelab protocol handshake failed. The network proxy may be filtering that handshake, or the connection service may be unavailable.",
    };
  reportStartup("Tailscale WebSocket protocol accepted", "ok");
  return {
    https: true,
    websocket: true,
    control: true,
    message: "The browser can reach the homelab server and its live connection.",
  };
}
