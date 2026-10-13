<script lang="ts">
  import { startupSteps, diagnosticText } from "$lib/store/startup-status";
  let copied = $state(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(diagnosticText());
      copied = true;
    } catch {
      copied = false;
    }
  }
</script>

{#if $startupSteps.length}
  <div class="connection-status" aria-label="Connection status">
    <p class="eyebrow">LIVE CONNECTION STATUS</p>
    <ol aria-live="polite">
      {#each $startupSteps as step}
        <li class:error={step.state === "error"}>
          <span aria-hidden="true"
            >{step.state === "ok" ? "✓" : step.state === "error" ? "!" : "·"}</span
          >
          <span>{step.message}</span><small>{(step.at / 1000).toFixed(1)}s</small>
        </li>
      {/each}
    </ol>
    <button type="button" class="mesh-text-button" onclick={copy}
      >{copied ? "Diagnostics copied" : "Copy connection diagnostics"}</button
    >
    <p class="field-hint">
      Includes connection stages and browser version. No passwords, authenticator codes, or private
      keys.
    </p>
  </div>
{/if}

<style>
  .connection-status {
    margin-top: 22px;
    border-top: 1px solid #78988930;
    padding-top: 16px;
    text-align: left;
    font-size: 13px;
  }
  ol {
    list-style: none;
    padding: 0;
    margin: 12px 0;
    display: grid;
    gap: 9px;
  }
  li {
    display: grid;
    grid-template-columns: 14px 1fr auto;
    gap: 6px;
    align-items: start;
    line-height: 1.45;
  }
  li > span:first-child {
    color: #93d18c;
  }
  li.error > span:first-child {
    color: #f3a18e;
  }
  small {
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
  }
</style>
