<script lang="ts">
  import ConnectionStatus from "$lib/components/ConnectionStatus.svelte";
</script>

<main class="mesh-loading">
  <span class="mesh-mark">m</span>
  <h2>Opening your private lane.</h2>
  <div class="mesh-loading-bar" aria-hidden="true"></div>
  <p>Loading the browser client and joining your homelab…</p>
  <div style="max-width:650px;width:100%"><ConnectionStatus /></div>
</main>
