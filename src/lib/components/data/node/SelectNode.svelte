<script lang="ts">
  import { netMap } from "$lib/store/ipn";
  let {
    hostname = $bindable(""),
    required = true,
    filter = () => true,
  }: {
    hostname: string;
    required?: boolean;
    filter?: (peer: IPNNetMapPeerNode) => boolean;
  } = $props();
  let custom = $state(false);
  let peers = $derived(
    ($netMap?.peers || [])
      .filter(filter)
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
  );
</script>

<select
  class="mesh-select"
  aria-label="Choose a device"
  {required}
  value={custom ? "__custom" : hostname}
  onchange={(e) => {
    const value = e.currentTarget.value;
    custom = value === "__custom";
    hostname = custom ? "" : value;
  }}
  ><option value="" disabled>Choose a machine…</option>{#each peers as peer}<option
      value={peer.name.split(".")[0]}
      >{peer.name.split(".")[0]} · {peer.os}{!peer.online ? " · Offline" : ""}</option
    >{/each}<option value="__custom">Enter a hostname or IP…</option></select
>
{#if custom}<input
    class="mesh-input"
    aria-label="Custom hostname or IP address"
    placeholder="Hostname or IP address"
    bind:value={hostname}
    {required}
  />{/if}
