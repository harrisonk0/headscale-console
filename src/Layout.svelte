<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { Sun, Moon, LogOut, ShieldCheck } from "lucide-svelte";
  import { setMode, mode } from "mode-watcher";
  import { endSession } from "$lib/store/connections";
  let { children }: { children?: Snippet } = $props();
  onMount(() => document.body.classList.remove("overflow-hidden"));
</script>

<div class="mesh-shell">
  <header class="mesh-header">
    <a class="mesh-brand" href="#/" onclick={window.appRouter.anchorOnclickHandler()}
      ><span class="mesh-mark">m</span> mesh<span class="mesh-brand-sub">/ remote</span></a
    >
    <nav aria-label="Main navigation">
      <a href="#/" onclick={window.appRouter.anchorOnclickHandler()}>Machines</a><a
        href="#/settings"
        onclick={window.appRouter.anchorOnclickHandler()}>Settings</a
      >
    </nav>
    <div class="header-actions">
      <span class="session-badge"><ShieldCheck size={14} /> Temporary session</span><button
        class="icon-button"
        onclick={() => setMode($mode === "dark" ? "light" : "dark")}
        aria-label="Switch colour theme"
        >{#if $mode === "dark"}<Sun size={18} />{:else}<Moon size={18} />{/if}</button
      ><button
        class="icon-button"
        onclick={endSession}
        aria-label="End this browser session"
        title="End session"><LogOut size={18} /></button
      >
    </div>
  </header>
  <main class="mesh-content">{@render children?.()}</main>
</div>
