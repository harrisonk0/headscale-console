<script lang="ts">
  let { takeOver }: { takeOver: () => Promise<void> } = $props();
  let busy = $state(false),
    error = $state("");
  async function move() {
    busy = true;
    try {
      await takeOver();
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not move the session.";
      busy = false;
    }
  }
</script>

<main
  class="mesh-login"
  style="position:fixed;inset:0;z-index:1000;background:var(--mesh-bg,#0b1513);overflow:auto"
>
  <div class="mesh-brand"><span class="mesh-mark">m</span> HK Remote</div>
  <section class="login-card" style="max-width:520px;margin:80px auto">
    <span class="mesh-eyebrow">YOUR EXISTING SESSION</span>
    <h1>Your homelab is open in another tab.</h1>
    <p>Continue here using the same temporary device. The other tab’s connections will close.</p>
    {#if error}<p class="mesh-error" role="alert">{error}</p>{/if}
    <button class="mesh-primary" disabled={busy} onclick={move}
      >{busy ? "Moving your session…" : "Continue in this tab"}</button
    >
  </section>
</main>
