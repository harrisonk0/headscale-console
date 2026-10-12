<script lang="ts">
  import { onMount } from "svelte";
  import {
    Search,
    Star,
    Terminal,
    Monitor,
    ArrowUpRight,
    Server,
    Smartphone,
    Laptop,
    Command,
    Plus,
    Copy,
    Check,
  } from "lucide-svelte";
  import { netMap } from "$lib/store/ipn";
  import {
    favorites,
    recent,
    favorite,
    connectionUrl,
    type Protocol,
  } from "$lib/store/connections";
  import Layout from "../Layout.svelte";
  import {portChecks, portKey, checkDevices, protocolPort} from "$lib/store/reachability";
  let checkingPorts = $state(false);
  async function refreshPorts(force=false) {if(checkingPorts)return;checkingPorts=true;try{await checkDevices(peers,force);}finally{checkingPorts=false;}}
  function available(peer: IPNNetMapPeerNode, protocol: Protocol) {return peer.online && !peer.expired && (protocol!=="ssh" || peer.tailscaleSSHEnabled) && $portChecks[portKey(peer.addresses[0],protocolPort[protocol])]?.state === "open";}
  function availabilityTitle(peer: IPNNetMapPeerNode, protocol: Protocol) {if(!peer.online)return "Device is offline";if(protocol==="ssh"&&!peer.tailscaleSSHEnabled)return "Tailscale SSH is not enabled";const state=$portChecks[portKey(peer.addresses[0],protocolPort[protocol])]?.state;return state==="open" ? `Port ${protocolPort[protocol]} is reachable` : state==="unreachable" ? `Port ${protocolPort[protocol]} is unreachable from this browser` : "Checking port availability…";}
  let search = $state("");
  let filter = $state("all");
  let copied = $state("");
  let searchInput: HTMLInputElement;
  const peers = $derived($netMap?.peers || []);
  const online = $derived(peers.filter((p) => p.online && !p.expired));
  const visible = $derived(
    peers
      .filter((p) => {
        const name = p.name.split(".")[0];
        return (
          (filter !== "online" || (p.online && !p.expired)) &&
          (filter !== "favorites" || $favorites.includes(name)) &&
          `${p.name} ${p.os} ${p.addresses.join(" ")}`.toLowerCase().includes(search.toLowerCase())
        );
      })
      .sort(
        (a, b) =>
          Number($favorites.includes(b.name.split(".")[0])) -
            Number($favorites.includes(a.name.split(".")[0])) ||
          Number(b.online) - Number(a.online) ||
          a.name.localeCompare(b.name),
      ),
  );
  function go(host: string, proto: Protocol) {
    window.appRouter.goto(new URL(connectionUrl(host, proto), location.href));
  }
  async function copy(ip: string) {
    try {
      await navigator.clipboard.writeText(ip);
      copied = ip;
      setTimeout(() => (copied = ""), 1800);
    } catch {
      copied = "";
    }
  }
  onMount(() => {
    refreshPorts();
    const key = (e: KeyboardEvent) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        searchInput?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
</script>

<Layout>
  <section class="mesh-hero">
    <div>
      <p class="eyebrow"><span class="signal-dot"></span> PRIVATE NETWORK · LIVE</p>
      <h1>Your homelab.<br /><em>Within reach.</em></h1>
      <p class="hero-copy">Pick a machine. Make yourself at home.</p>
    </div>
    <div class="hero-signal" aria-hidden="true">
      <div class="radar-ring"></div>
      <div class="radar-ring"></div>
      <div class="radar-ring"></div>
      <span class="radar-dot"></span><Command size={42} /><span class="radar-label"
        >CONNECTED TO HOME</span
      >
    </div>
  </section>
  <section class="mesh-overview" aria-label="Network overview">
    <div>
      <span class="overview-number">{online.length.toString().padStart(2, "0")}</span><span
        >online now</span
      >
    </div>
    <div>
      <span class="overview-number">{peers.length.toString().padStart(2, "0")}</span><span
        >visible devices</span
      >
    </div>
    <div><Star size={22} /><span>{$favorites.length} favourites</span></div>
    <button class="mesh-secondary" onclick={() => go("", "vnc")}
      ><Plus size={16} /> New connection</button
    >
  </section>
  {#if $recent.length}<section class="recent-strip">
      <span class="eyebrow">RECENT DESTINATIONS</span>
      <div>
        {#each $recent.slice(0, 4) as item}<button
            onclick={() => go(item.host, item.proto)}
            class="recent-chip"
            >{#if item.proto === "ssh"}<Terminal size={15} />{:else}<Monitor size={15} />{/if}<span
              >{item.host}</span
            ><small>{item.proto.toUpperCase()}</small><ArrowUpRight size={13} /></button
          >{/each}
      </div>
    </section>{/if}
  <section class="device-section">
    <div class="device-toolbar">
      <div>
        <h2>Your machines <span>{visible.length}</span></h2>
        <p>Ports are checked from this browser. Unavailable connections are greyed out.</p>
      </div>
      <label class="mesh-search"
        ><Search size={17} /><input
          bind:this={searchInput}
          bind:value={search}
          placeholder="Find a machine…"
          aria-label="Search devices"
        /><kbd>/</kbd></label
      >
    </div>
    <div class="filter-tabs" aria-label="Device filters"><button onclick={() => refreshPorts(true)} disabled={checkingPorts}>{checkingPorts ? "Checking ports…" : "↻ Check ports"}</button>
      {#each [{ id: "all", label: "All machines" }, { id: "online", label: "Online" }, { id: "favorites", label: "Favourites" }] as tab}<button
          class:active={filter === tab.id}
          onclick={() => (filter = tab.id)}
          aria-pressed={filter === tab.id}>{tab.label}</button
        >{/each}
    </div>
    <div class="device-grid">
      {#each visible as peer (peer.id)}{@const name = peer.name.split(".")[0]}
        <article class="device-card" class:device-offline={!peer.online || peer.expired}>
          <div class="device-card-top">
            <span class="device-icon"
              >{#if ["iOS", "android"].includes(peer.os)}<Smartphone
                  size={25}
                />{:else if ["macOS", "windows"].includes(peer.os)}<Laptop
                  size={25}
                />{:else}<Server size={25} />{/if}</span
            ><button
              class="icon-button favorite-button"
              class:is-favorite={$favorites.includes(name)}
              onclick={() => favorite(name)}
              aria-label={`${$favorites.includes(name) ? "Unpin" : "Pin"} ${name}`}
              aria-pressed={$favorites.includes(name)}><Star size={18} /></button
            >
          </div>
          <div class="device-title">
            <h3>{name}</h3>
            <span class="status-pill" class:status-offline={!peer.online || peer.expired}
              ><span class="signal-dot"></span>{peer.expired
                ? "Expired"
                : peer.online
                  ? "Online"
                  : "Offline"}</span
            >
          </div>
          <p class="device-os">
            {peer.os || "Device"}<span>·</span>{peer.tailscaleSSHEnabled
              ? "SSH ready"
              : "SSH not enabled"}
          </p>
          <button
            class="ip-copy"
            onclick={() => copy(peer.addresses[0] || "")}
            aria-label={`Copy ${name} IP address`}
            ><span>{peer.addresses[0]}</span>{#if copied === peer.addresses[0]}<Check
                size={13}
              />{:else}<Copy size={13} />{/if}</button
          >
          <div class="device-actions">
            <button disabled={!available(peer,"ssh")} title={availabilityTitle(peer,"ssh")} onclick={() => go(name, "ssh")}
              ><Terminal size={15} /> SSH</button
            ><button disabled={!available(peer,"vnc")} title={availabilityTitle(peer,"vnc")} onclick={() => go(name, "vnc")}
              ><Monitor size={15} /> VNC</button
            ><button
              disabled={!available(peer,"rdp")} title={availabilityTitle(peer,"rdp")}
              onclick={() => go(name, "rdp")}
              aria-label={`Remote desktop to ${name}`}><ArrowUpRight size={16} /> RDP</button
            >
          </div>
        </article>{/each}
    </div>
    {#if !visible.length}<div class="mesh-empty">
        <Search size={28} />
        <h3>{search ? "No machines match that search." : "Nothing here yet."}</h3>
        <p>
          {search
            ? "Try a hostname, operating system, or IP address."
            : filter === "favorites"
              ? "Star a machine to keep it close."
              : "Devices appear when Headscale allows this session to reach them."}
        </p>
        <button
          class="mesh-secondary"
          onclick={() => {
            search = "";
            filter = "all";
          }}>Show all machines</button
        >
      </div>{/if}
  </section>
  <footer class="mesh-footnote">
    <span class="signal-dot"></span> Encrypted from this browser to your machines.<span
      >This browser is a temporary guest.</span
    >
  </footer>
</Layout>
