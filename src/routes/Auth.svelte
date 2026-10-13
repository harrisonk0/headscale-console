<script lang="ts">
  import { onMount } from "svelte";
  import { reportStartup } from "$lib/store/startup-status";
  import ConnectionStatus from "$lib/components/ConnectionStatus.svelte";
  import { forgetBrowserIdentity } from "$lib/store/resume";

  const resuming = !!window.ipnProfiles.currentProfile;
  onMount(() => {
    const timer = setTimeout(
      () =>
        reportStartup(
          "Tailscale registration has not finished after 30 seconds; use the completed checks above to locate the interruption",
        ),
      30000,
    );
    return () => clearTimeout(timer);
  });
  function restart() {
    // This screen is shown when Headscale asks the current machine profile to
    // authenticate again. Clearing only sessionStorage is insufficient: the
    // authenticated cross-tab resume cache would restore the same stale key
    // during the next page load and strand the user on this screen again.
    forgetBrowserIdentity();
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith("ipn-state-")) sessionStorage.removeItem(key);
    location.reload();
  }
</script>

<main class="mesh-login">
  <section class="session-card">
    <p class="eyebrow">TEMPORARY SESSION</p>
    <h2>{resuming ? "Reconnecting your browser device…" : "Registering your browser device…"}</h2>
    <p>
      Waiting for Tailscale to finish connecting. The live status below shows which stages
      succeeded. Retry this connection to keep the same device, or start fresh if its session has
      been removed or expired.
    </p>
    <ConnectionStatus />
    <button class="mesh-primary" onclick={() => location.reload()}>Retry this connection</button>
    <button class="mesh-secondary" onclick={restart}>Start a fresh session</button>
  </section>
</main>
