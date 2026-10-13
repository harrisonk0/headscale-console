import { reportStartup } from "$lib/store/startup-status";

type Frame = { kind: "binary" | "text"; data: string; seq?: number };
const encode = (bytes: Uint8Array) => {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 32768)
    raw += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(raw);
};
const decode = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
async function rpc(action: string, body: unknown, retry = true): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`/api/remote/socket/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        const error = new Error(
          response.status === 401
            ? "Your web login expired; reload to sign in again"
            : `HTTPS connection failed (HTTP ${response.status})`,
        );
        if (response.status < 500 || attempt >= 2 || !retry)
          throw Object.assign(error, { permanent: true });
        throw error;
      }
      return await response.json();
    } catch (error) {
      if (!retry || attempt >= 2 || (error as { permanent?: boolean })?.permanent) throw error;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
}

/** Browser-compatible socket interface, carried through authenticated HTTP. */
const activeSockets = new Set<HttpsSocket>();
class HttpsSocket extends EventTarget {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  bufferedAmount = 0;
  binaryType: BinaryType = "blob";
  protocol = "";
  extensions = "";
  onopen: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  onclose: ((event: CloseEvent) => unknown) | null = null;
  private id = "";
  private ack = -1;
  private sequence = 0;
  private queue: (Frame & { size: number })[] = [];
  private conversions = Promise.resolve();
  private sending = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    readonly url: string,
    private protocols: string[],
  ) {
    super();
    activeSockets.add(this);
    void this.open();
  }
  private emit(type: "open" | "message" | "error" | "close", event: Event) {
    this.dispatchEvent(event);
    const fn = this[`on${type}`];
    if (fn) (fn as (event: Event) => unknown).call(this, event);
  }
  private async open() {
    try {
      const url = new URL(this.url);
      const relayHost = /^derp[0-9]+[a-z]*\.tailscale\.com$/.test(url.hostname) ? url.hostname : "";
      const result = await rpc("open", {
        path: url.pathname + url.search,
        relayHost,
        protocols: this.protocols,
      });
      this.id = result.id;
      this.protocol = result.protocol;
      if (this.readyState !== 0) {
        void rpc("close", { id: this.id }, false).catch(() => {});
        return;
      }
      this.readyState = 1;
      this.emit("open", new Event("open"));
      void this.poll();
    } catch (error) {
      this.fail(error);
    }
  }
  private async poll() {
    try {
      while (this.readyState === 1) {
        const result = await rpc("read", { id: this.id, ack: this.ack });
        if (this.readyState !== 1) return;
        for (const frame of result.frames as Frame[]) {
          if (typeof frame.seq !== "number" || frame.seq <= this.ack) continue;
          const bytes = frame.kind === "binary" ? decode(frame.data) : undefined;
          const data = bytes
            ? this.binaryType === "arraybuffer"
              ? bytes.buffer
              : new Blob([bytes])
            : frame.data;
          this.emit("message", new MessageEvent("message", { data }));
          this.ack = frame.seq;
        }
        if (result.closed) {
          this.finish(result.closed.code || 1006, result.closed.reason || "HTTPS connection ended");
          return;
        }
      }
    } catch (error) {
      if (this.readyState === 1) this.fail(error);
    }
  }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState !== 1)
      throw new DOMException("The socket is not open", "InvalidStateError");
    const size =
      typeof data === "string"
        ? new TextEncoder().encode(data).byteLength
        : data instanceof Blob
          ? data.size
          : data.byteLength;
    if (this.bufferedAmount + size > 4 * 1024 * 1024) {
      this.fail(new Error("HTTPS send buffer full"));
      return;
    }
    this.bufferedAmount += size;
    this.conversions = this.conversions
      .then(async () => {
        if (this.readyState !== 1) return;
        let frame: Frame;
        if (typeof data === "string") frame = { kind: "text", data };
        else {
          const bytes =
            data instanceof Blob
              ? new Uint8Array(await data.arrayBuffer())
              : ArrayBuffer.isView(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : new Uint8Array(data);
          frame = { kind: "binary", data: encode(bytes) };
        }
        this.queue.push({ ...frame, size });
        this.schedule();
      })
      .catch((error) => this.fail(error));
  }
  private schedule() {
    if (this.sending || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 40);
  }
  private async flush() {
    if (this.sending || this.readyState !== 1 || !this.queue.length) return;
    this.sending = true;
    const frames: (Frame & { size: number })[] = [];
    let bytes = 0;
    while (this.queue.length && frames.length < 128) {
      const next = this.queue[0];
      if (frames.length && bytes + next.data.length > 320 * 1024) break;
      frames.push(this.queue.shift()!);
      bytes += next.data.length;
    }
    try {
      await rpc("write", {
        id: this.id,
        sequence: this.sequence,
        frames: frames.map(({ kind, data }) => ({ kind, data })),
      });
      this.sequence++;
      this.bufferedAmount = Math.max(
        0,
        this.bufferedAmount - frames.reduce((n, f) => n + f.size, 0),
      );
    } catch (error) {
      this.fail(error);
    } finally {
      this.sending = false;
      if (this.queue.length) this.schedule();
    }
  }
  close(code = 1000, reason = "") {
    if (this.readyState >= 2) return;
    this.finish(code, reason);
  }
  private finish(code: number, reason: string) {
    if (this.readyState === 3) return;
    activeSockets.delete(this);
    this.readyState = 3;
    clearTimeout(this.timer);
    this.queue = [];
    this.bufferedAmount = 0;
    if (this.id) void rpc("close", { id: this.id }, false).catch(() => {});
    this.emit("close", new CloseEvent("close", { code, reason, wasClean: code === 1000 }));
  }
  releaseOnPageHide() {
    if (this.id)
      navigator.sendBeacon(
        "/api/remote/socket/close",
        new Blob([JSON.stringify({ id: this.id })], { type: "application/json" }),
      );
    this.finish(1000, "Page closed");
  }
  private fail(error: unknown) {
    if (this.readyState === 3) return;
    reportStartup(error instanceof Error ? error.message : "HTTPS connection interrupted", "error");
    this.emit("error", new Event("error"));
    this.finish(1006, "HTTPS connection interrupted");
  }
}

let enabled = false;
export function enableHttpsSockets(controlUrl: string) {
  if (enabled) return;
  enabled = true;
  const native = window.WebSocket,
    host = new URL(controlUrl).host;
  const relayHost = (window as Window & { __meshRelayProxy?: string }).__meshRelayProxy;
  window.WebSocket = new Proxy(native, {
    construct(target, args) {
      const url = new URL(String(args[0]));
      if (
        url.host === host ||
        url.host === relayHost ||
        /^derp[0-9]+[a-z]*\.tailscale\.com$/.test(url.hostname)
      ) {
        const protocols =
          args[1] === undefined ? [] : typeof args[1] === "string" ? [args[1]] : args[1];
        return new HttpsSocket(url.href, protocols);
      }
      return Reflect.construct(target, args);
    },
  });
  window.addEventListener("pagehide", () => {
    for (const socket of activeSockets) socket.releaseOnPageHide();
  });
  reportStartup("HTTPS fallback enabled; live traffic now uses normal HTTPS requests", "ok");
}
