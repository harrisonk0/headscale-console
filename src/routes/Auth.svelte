<script lang="ts">
  import { forgetBrowserIdentity } from "$lib/store/resume";

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
    <h2>Joining your homelab…</h2>
    <p>
      Your browser is connecting with its one-use ephemeral key. If your previous session was
      removed or its key expired, start a fresh one.
    </p>
    <button class="mesh-secondary" onclick={restart}>Start a fresh session</button>
  </section>
</main>
