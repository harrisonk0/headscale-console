<script lang="ts">
  import RFB from "@novnc/novnc/lib/rfb";
  import { onMount } from "svelte";
  import { IpnRawTcpChannel } from "$package/tailscale";
  import { Clipboard, Keyboard, Eye, Scaling } from "lucide-svelte";
  let {
    hostname = "",
    port = 5900,
    onState = () => {},
    onError = () => {},
  }: {
    hostname?: string;
    port?: number;
    onState?: (s: string) => void;
    onError?: (e: string) => void;
  } = $props();
  let el: HTMLDivElement;
  let client: RFB | undefined;
  let channel: IpnRawTcpChannel | undefined;
  let credentials = $state(false);
  let password = $state("");
  let username = $state("");
  let ready = $state(false);
  let clipboard = $state("");
  let showClipboard = $state(false);
  let viewOnly = $state(false);
  let scale = $state(true);
  function sendCredentials(e: SubmitEvent) {
    e.preventDefault();
    client?.sendCredentials({ password, username, target: "" });
    password = "";
    credentials = false;
  }
  function changeView() {
    viewOnly = !viewOnly;
    if (client) client.viewOnly = viewOnly;
  }
  function changeScale() {
    scale = !scale;
    if (client) client.scaleViewport = scale;
  }
  onMount(() => {
    let closed = false;
    (async () => {
      try {
        onState("Connecting");
        const raw = await IpnRawTcpChannel.connect({ hostname, port, connectTimeoutSeconds: 20 });
        if (closed) {
          raw.close();
          return;
        }
        channel = raw;
        client = new RFB(el, raw, {});
        client.scaleViewport = true;
        client.resizeSession = true;
        client.addEventListener("connect", () => {
          if (!closed) {
            ready = true;
            onState("Connected");
          }
        });
        client.addEventListener("disconnect", (e) => {
          if (!closed) {
            ready = false;
            onState("Disconnected");
            if (!e.detail.clean)
              onError(
                "The VNC server closed the connection. Check its password and port, then retry.",
              );
          }
        });
        client.addEventListener("credentialsrequired", () => (credentials = true));
        client.addEventListener("securityfailure", (e) => {
          if (!closed) {
            onState("Disconnected");
            onError(e.detail.reason || "The VNC server rejected the login.");
          }
        });
        client.addEventListener("clipboard", (e) => (clipboard = e.detail.text));
      } catch (e) {
        if (!closed) {
          onState("Disconnected");
          onError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    const leave = (e: BeforeUnloadEvent) => {
      if (ready) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      closed = true;
      window.removeEventListener("beforeunload", leave);
      client?.disconnect();
      channel?.close();
      password = "";
    };
  });
</script>

<div class="vnc-workspace">
  <div class="vnc-screen" bind:this={el}></div>
  {#if ready}<div class="vnc-controls">
      <button onclick={() => (showClipboard = !showClipboard)} aria-label="Open clipboard"
        ><Clipboard size={16} />Clipboard</button
      ><button onclick={() => client?.sendCtrlAltDel()} disabled={viewOnly}
        ><Keyboard size={16} />Ctrl Alt Del</button
      ><button onclick={changeView} aria-pressed={viewOnly}
        ><Eye size={16} />{viewOnly ? "View only" : "Control"}</button
      ><button onclick={changeScale} aria-pressed={scale}
        ><Scaling size={16} />{scale ? "Fit" : "Actual size"}</button
      >
    </div>{/if}{#if showClipboard}<section class="clipboard-panel">
      <label for="vnc-clipboard">Shared clipboard</label><textarea
        id="vnc-clipboard"
        bind:value={clipboard}></textarea><button
        class="mesh-primary"
        disabled={viewOnly}
        onclick={() => {
          client?.clipboardPasteFrom(clipboard);
          showClipboard = false;
        }}>Send to desktop</button
      >
      <p class="field-hint">Available when the remote VNC server supports clipboard sharing.</p>
    </section>{/if}{#if credentials}<form class="vnc-auth session-card" onsubmit={sendCredentials}>
      <h2>Unlock {hostname}.</h2>
      <p>The VNC server needs credentials.</p>
      <label for="vnc-user"
        >Username, if required<input
          id="vnc-user"
          autocomplete="username"
          bind:value={username}
        /></label
      ><label for="vnc-password"
        >VNC password<input
          id="vnc-password"
          type="password"
          autocomplete="current-password"
          bind:value={password}
        /></label
      ><button class="mesh-primary">Unlock desktop</button>
      <p class="field-hint">Your password is never saved by this app.</p>
    </form>{/if}
</div>
