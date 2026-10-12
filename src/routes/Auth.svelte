<script lang="ts">
  function restart() {
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
