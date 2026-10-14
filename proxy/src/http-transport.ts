type Frame = { kind: "binary" | "text"; data: string };
type QueuedFrame = Frame & { seq: number };
type Channel = {
  parent: string;
  expires: number;
  socket?: WebSocket;
  probe: boolean;
  frames: QueuedFrame[];
  bytes: number;
  nextFrame: number;
  closed?: { code: number; reason: string };
  wake?: () => void;
  reading: boolean;
  nextWrite: number;
  idleTimer: ReturnType<typeof setTimeout>;
  expiryTimer: ReturnType<typeof setTimeout>;
};
function fail(status: number, message: string): never {
  throw new Error(`AUTH_${status}: ${message}`);
}

/** Bounded, ephemeral channels for browsers whose networks reject WebSockets. */
export class HttpTransport {
  private channels = new Map<string, Channel>();
  constructor(
    private origin: string,
    private authorize: (token: string) => { hash: string; expires: number } | undefined,
    private umbrelBridge?: string,
  ) {}
  private owner(token: string) {
    const row = this.authorize(token);
    if (!row) fail(401, "Your web login expired. Reload HK Remote to sign in again.");
    return row!;
  }
  private channel(token: string, id: string) {
    const owner = this.owner(token),
      c = this.channels.get(id);
    if (!c || c.parent !== owner.hash)
      fail(404, "The HTTPS connection ended. Reconnect to continue.");
    this.touch(c!);
    return c!;
  }
  private touch(c: Channel) {
    clearTimeout(c.idleTimer);
    c.idleTimer = setTimeout(() => this.finish(c, 1001, "Connection idle"), 60000);
  }
  private finish(c: Channel, code: number, reason: string) {
    if (c.closed) return;
    c.closed = { code, reason };
    clearTimeout(c.idleTimer);
    clearTimeout(c.expiryTimer);
    try {
      c.socket?.close(1000, "HTTP bridge ended");
    } catch {}
    c.wake?.();
    setTimeout(() => {
      for (const [id, item] of this.channels) if (item === c) this.channels.delete(id);
    }, 60000);
  }
  private enqueue(c: Channel, frame: Frame) {
    if (c.closed) return;
    const size = frame.data.length;
    if (c.bytes + size > 4 * 1024 * 1024) {
      this.finish(c, 1009, "Receive buffer full");
      return;
    }
    c.bytes += size;
    c.frames.push({ ...frame, seq: c.nextFrame++ });
    c.wake?.();
  }
  async open(token: string, target: string, protocols: string[]) {
    const owner = this.owner(token);
    if (
      this.channels.size >= (this.umbrelBridge ? 8 : 12) ||
      [...this.channels.values()].filter((c) => c.parent === owner.hash && !c.closed).length >= 8
    )
      fail(429, "Too many live connections in this browser session.");
    const url = new URL(target, this.origin),
      original = new URL(this.origin);
    const probe = url.pathname === "/__proxy/socket-check";
    const publicRelay = /^derp[0-9]+[a-z]*\.tailscale\.com$/.test(url.hostname);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      url.href.length > 8192
    )
      fail(400, "Invalid transport destination.");
    if (this.umbrelBridge) {
      if (url.origin !== original.origin || url.pathname !== "/__hkremote/trpc" || protocols.length)
        fail(403, "Only the Umbrel dashboard connection is allowed.");
    } else {
      if (
        publicRelay
          ? url.pathname !== "/derp"
          : url.origin !== original.origin ||
            !["/ts2021", "/derp", "/__proxy/socket-check"].includes(url.pathname)
      )
        fail(403, "Transport destination is not allowed.");
      if (
        protocols.length > 1 ||
        protocols.some((p) => !["tailscale-control-protocol", "derp"].includes(p))
      )
        fail(400, "Unsupported transport protocol.");
      if (url.pathname === "/ts2021" && protocols[0] !== "tailscale-control-protocol")
        fail(400, "Control protocol is required.");
      if (url.pathname === "/derp" && protocols[0] !== "derp")
        fail(400, "Relay protocol is required.");
      if (probe && (publicRelay || protocols.length || url.search)) fail(400, "Invalid probe.");
    }
    // Reserve before external I/O, so concurrent opens cannot bypass limits.
    const id = crypto.randomUUID(),
      c: Channel = {
        parent: owner.hash,
        expires: owner.expires,
        probe,
        frames: [],
        bytes: 0,
        nextFrame: 0,
        reading: false,
        nextWrite: 0,
        idleTimer: setTimeout(() => {}, 0),
        expiryTimer: setTimeout(() => {}, 0),
      };
    this.channels.set(id, c);
    this.touch(c);
    c.expiryTimer = setTimeout(
      () => this.finish(c, 1008, "Web login expired"),
      Math.max(1, owner.expires - Date.now()),
    );
    try {
      let protocol = "";
      if (!probe) {
        const headers = new Headers({ Upgrade: "websocket" });
        if (this.umbrelBridge) headers.set("X-HKRemote-Bridge", this.umbrelBridge);
        if (protocols[0]) headers.set("Sec-WebSocket-Protocol", protocols[0]);
        // Bound establishment only. A signal that aborts ten seconds later can
        // also tear down the upgraded socket and interrupt a live session.
        const controller = new AbortController();
        const openTimeout = setTimeout(() => controller.abort(), 10000);
        let response: Response;
        try {
          response = await fetch(url, {
            headers,
            redirect: "manual",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(openTimeout);
        }
        if (response.status !== 101 || !response.webSocket)
          fail(502, "The homelab live connection could not be opened.");
        const socket = response.webSocket;
        c.socket = socket;
        socket.binaryType = "arraybuffer";
        socket.accept();
        protocol = response.headers.get("Sec-WebSocket-Protocol") || "";
        if (protocol !== (protocols[0] || "")) fail(502, "The homelab protocol was not accepted.");
        socket.addEventListener("message", (event) => {
          this.enqueue(
            c,
            typeof event.data === "string"
              ? { kind: "text", data: event.data }
              : { kind: "binary", data: Buffer.from(event.data).toString("base64") },
          );
        });
        socket.addEventListener("close", (event) =>
          this.finish(c, event.code, "Upstream connection closed"),
        );
        socket.addEventListener("error", () =>
          this.finish(c, 1011, "Upstream connection interrupted"),
        );
      }
      return { id, protocol };
    } catch (error) {
      this.finish(c, 1011, "Connection could not open");
      this.channels.delete(id);
      throw error;
    }
  }
  async read(token: string, id: string, ack: number) {
    const c = this.channel(token, id);
    if (!Number.isInteger(ack) || ack < -1 || ack >= c.nextFrame)
      fail(400, "Invalid connection acknowledgement.");
    while (c.frames.length && c.frames[0].seq <= ack) {
      c.bytes -= c.frames.shift()!.data.length;
    }
    if (c.reading) fail(409, "A connection read is already pending.");
    c.reading = true;
    try {
      if (!c.frames.length && !c.closed)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 15000);
          c.wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      c.wake = undefined;
      const frames: QueuedFrame[] = [];
      let size = 0;
      for (const frame of c.frames) {
        if (size >= 512 * 1024 && frames.length) break;
        frames.push(frame);
        size += frame.data.length;
      }
      return { frames, closed: c.closed && frames.length === c.frames.length ? c.closed : null };
    } finally {
      c.reading = false;
    }
  }
  async write(token: string, id: string, sequence: number, frames: Frame[]) {
    const c = this.channel(token, id);
    if (c.closed) fail(410, "The HTTPS connection closed.");
    if (sequence < c.nextWrite) return { ok: true };
    if (sequence !== c.nextWrite) fail(409, "Out-of-order connection data.");
    if (!Array.isArray(frames) || !frames.length || frames.length > 128)
      fail(400, "Invalid connection data.");
    let size = 0;
    const decoded: (string | Buffer)[] = [];
    for (const frame of frames) {
      if (!frame || typeof frame.data !== "string" || !["binary", "text"].includes(frame.kind))
        fail(400, "Invalid connection frame.");
      size += frame.data.length;
      if (size > 384 * 1024) fail(413, "Connection batch is too large.");
      if (
        frame.kind === "binary" &&
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data)
      )
        fail(400, "Invalid binary frame.");
      decoded.push(frame.kind === "binary" ? Buffer.from(frame.data, "base64") : frame.data);
    }
    for (let i = 0; i < frames.length; i++) {
      if (c.probe) {
        if (frames[i].kind !== "binary" || frames[i].data !== "SEtSTQ==")
          fail(400, "Invalid probe data.");
        this.enqueue(c, frames[i]);
      } else c.socket!.send(decoded[i]);
    }
    c.nextWrite++;
    return { ok: true };
  }
  close(token: string, id: string) {
    const c = this.channel(token, id);
    this.finish(c, 1000, "Browser connection closed");
    c.frames = [];
    c.bytes = 0;
    this.channels.delete(id);
    return { ok: true };
  }
  revoke(parent: string) {
    for (const c of this.channels.values())
      if (c.parent === parent) this.finish(c, 1008, "Web login ended");
  }
}
