<script lang="ts">
  import { onMount } from "svelte";
  import {
    ArrowLeft,
    Terminal,
    Monitor,
    ArrowUpRight,
    Maximize,
    RotateCcw,
    X,
    ShieldCheck,
  } from "lucide-svelte";
  import { netMap } from "$lib/store/ipn";
  import { recent, remember, type Protocol } from "$lib/store/connections";
  import {portChecks, portKey, checkPort} from "$lib/store/reachability";
  import SelectNode from "$lib/components/data/node/SelectNode.svelte";
  import Xterm from "$lib/components/connect/Xterm.svelte";
  import NoVnc from "$lib/components/connect/NoVNC.svelte";
  import IronRdp from "$lib/components/connect/IronRDP.svelte";
  const params = window.appRouter.searchParams;
  let proto = $state<Protocol>(
    ["ssh", "vnc", "rdp"].includes(params.get("proto") || "")
      ? (params.get("proto") as Protocol)
      : "vnc",
  );
  let hostname = $state(params.get("host") || "");
  let username = $state("");
  let port = $state(5900);
  let active = $state(false);
  let status = $state("Ready");
  let error = $state("");
  let generation = $state(0);
  let elapsed = $state(0);
  const selected = $derived($netMap?.peers.find((p) => p.name.split(".")[0] === hostname));
  const checkHost = $derived(selected?.addresses[0] || hostname);
  const reachability = $derived($portChecks[portKey(checkHost, proto === "ssh" ? 22 : port)]?.state);
  $effect(() => {const h=checkHost; const p=proto === "ssh" ? 22 : port; const a=active; if(!a && h){const t=setTimeout(()=>checkPort(h,p),400);return()=>clearTimeout(t);}});
  let first = true;
  $effect(() => {
    const saved = $recent.find((c) => c.host === hostname && c.proto === proto);
    username =
      saved?.username ||
      (hostname === "hk-cloud" ? "ubuntu" : hostname === "hk-mac" ? "harrisonk" : "");
    port = saved?.port || (proto === "vnc" ? 5900 : proto === "rdp" ? 3389 : 22);
    if (first && params.has("port")) {
      const n = Number(params.get("port"));
      if (n > 0 && n <= 65535) port = n;
    }
    first = false;
  });
  function connect(e?: SubmitEvent) {
    e?.preventDefault();
    error = "";
    if (!hostname.trim()) return;
    if (proto === "ssh" && (!username.trim() || username.trim() === "root")) {
      error = "Choose an existing non-root account on this machine.";
      return;
    }
    hostname = hostname.trim();
    username = username.trim();
    remember({ host: hostname, proto, username, port });
    status = "Connecting";
    elapsed = 0;
    generation++;
    active = true;
  }
  function back() {
    window.appRouter.goto(new URL("#/", location.href));
  }
  function full() {
    if (document.fullscreenElement) document.exitFullscreen();
    else
      document.documentElement
        .requestFullscreen()
        .catch(() => (error = "Fullscreen is unavailable in this browser."));
  }
  onMount(() => {
    document.body.classList.add("overflow-hidden");
    const t = setInterval(() => {
      if (active && status === "Connected") elapsed++;
    }, 1000);
    return () => {
      clearInterval(t);
      document.body.classList.remove("overflow-hidden");
    };
  });
</script>

<main class="connection-workspace">
  <header class="session-toolbar">
    <button class="icon-button" onclick={back} aria-label="Back to machines"
      ><ArrowLeft size={19} /></button
    ><span class="mesh-mark small-mark">m</span>
    <div class="session-destination">
      <strong>{active ? hostname : "New connection"}</strong><span
        >{proto.toUpperCase()}{active && proto === "ssh" ? ` · ${username}` : ""}</span
      >
    </div>
    <div class="session-toolbar-right">
      {#if active}<span class="status-pill" class:status-offline={status !== "Connected"}
          ><span class="signal-dot"></span>{status}{status === "Connected"
            ? ` · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`
            : ""}</span
        ><button
          class="icon-button"
          onclick={() => {
            generation++;
            status = "Connecting";
            error = "";
          }}
          aria-label="Reconnect"><RotateCcw size={17} /></button
        >{/if}<button class="icon-button" onclick={full} aria-label="Toggle fullscreen"
        ><Maximize size={17} /></button
      >{#if active}<button
          class="mesh-secondary compact"
          onclick={() => {
            active = false;
            status = "Ready";
          }}><X size={15} /> Disconnect</button
        >{/if}
    </div>
  </header>
  <div class="connection-stage">
    {#if !active}<div class="connection-launcher">
        <div class="launcher-intro">
          <p class="eyebrow">A LITTLE CLOSER TO HOME</p>
          <h1>Make a connection.</h1>
          <p>Choose your machine and how you’d like to connect.</p>
        </div>
        <form class="session-card" onsubmit={connect}>
          <div class="protocol-tabs" aria-label="Connection protocol">
            {#each [{ id: "ssh", label: "Terminal", icon: Terminal }, { id: "vnc", label: "VNC", icon: Monitor }, { id: "rdp", label: "RDP", icon: ArrowUpRight }] as option}<button
                type="button"
                class:active={proto === option.id}
                onclick={() => (proto = option.id as Protocol)}
                aria-pressed={proto === option.id}><option.icon size={18} />{option.label}</button
              >{/each}
          </div>
          <label>Machine <SelectNode bind:hostname /></label>{#if selected}<div
              class="selected-machine"
            >
              <span class="signal-dot" class:offline-dot={!selected.online}></span><span
                >{selected.online ? "Online" : "Offline"} · {selected.os}</span
              ><code>{selected.addresses[0]}</code>
            </div>{/if}{#if proto === "ssh"}<label for="ssh-user"
              >Log in as<input
                id="ssh-user"
                required
                autocomplete="username"
                bind:value={username}
                placeholder="Non-root username"
              /></label
            >
            <p class="field-hint">
              Use an account that exists on the remote machine. Tailscale SSH must be enabled there.
            </p>{:else}<label for="connect-port"
              >Port<input
                id="connect-port"
                type="number"
                min="1"
                max="65535"
                required
                bind:value={port}
              /></label
            >
            <p class="field-hint">
              {proto === "vnc"
                ? "You’ll be asked for the VNC password if the server requires it."
                : "Your Windows login is requested on the next screen."}
            </p>{/if}{#if selected && !selected.online}<div class="mesh-error">
              This device is currently offline. Bring it online to connect.
            </div>{/if}
          {#if hostname && reachability !== "open"}<p class="field-hint">{reachability === "unreachable" ? `Port ${proto === "ssh" ? 22 : port} is unreachable from this browser.` : "Checking port availability…"} <button type="button" class="mesh-text-button" onclick={() => checkPort(checkHost,proto === "ssh" ? 22 : port,true)}>Recheck</button></p>{/if}
          {#if proto === "ssh" && selected && !selected.tailscaleSSHEnabled}<div class="mesh-error">Tailscale SSH is not enabled on this device.</div>{/if}
          {#if error}<div class="mesh-error" role="alert">{error}</div>{/if}<button
            class="mesh-primary"
            disabled={!hostname || reachability !== "open" || (selected && (!selected.online || (proto === "ssh" && !selected.tailscaleSSHEnabled)))}
            >Connect to {hostname || "a machine"}<ArrowUpRight size={18} /></button
          >
          <p class="secure-note">
            <ShieldCheck size={14} /> Encrypted through your private network
          </p>
        </form>
      </div>
    {:else}{#key generation}{#if proto === "ssh"}<Xterm
            {hostname}
            {username}
            onState={(s) => (status = s)}
            onError={(e) => (error = e)}
          />{:else if proto === "vnc"}<NoVnc
            {hostname}
            {port}
            onState={(s) => (status = s)}
            onError={(e) => (error = e)}
          />{:else}<IronRdp {hostname} {port} />{/if}{/key}{#if error}<aside
          class="session-error"
          role="alert"
        >
          <strong>Connection needs attention</strong>
          <p>
            {error.includes("attempted methods [none]") || error.includes("tailnet policy")
              ? "The machine rejected Tailscale SSH. Check that SSH is enabled, the account exists, and Headscale permits your session."
              : error}
          </p>
          <details>
            <summary>Technical details</summary>
            <pre>{error}</pre>
          </details>
          <button
            class="mesh-secondary"
            onclick={() => {
              active = false;
              status = "Ready";
            }}>Edit connection</button
          >
        </aside>{/if}{/if}
  </div>
</main>
