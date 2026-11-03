<script lang="ts">
  import SessionStart from "$lib/components/SessionStart.svelte";
  import { House, Monitor, ArrowUpRight, LogOut } from "lucide-svelte";
  let ready = $state(false), busy = $state(false), error = $state("");
  async function umbrel() {
    busy = true; error = "";
    try {
      const r = await fetch("/api/remote/umbrel-ticket", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      const b = await r.json(); if (!r.ok) throw new Error(b.error || "Sign in again to open Umbrel.");
      location.assign(b.url);
    } catch (e) { error = e instanceof Error ? e.message : "Could not open Umbrel."; busy = false; }
  }
  async function logout() {
    busy = true;
    try { const r = await fetch("/api/remote/logout", {method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      if (!r.ok) throw new Error("Could not sign out. Try again."); location.reload();
    } catch(e) {error=e instanceof Error?e.message:"Could not sign out.";busy=false;}
  }
</script>

{#if !ready}
  <SessionStart loginOnly forceLogin={location.hash.startsWith("#/reauth")} onReady={() => { ready = true; }} />
{:else}
  <div class="portal">
    <header><a class="brand" href="/">hk<span>remote</span></a><button class="signout" onclick={logout} disabled={busy}><LogOut size={16}/> Sign out</button></header>
    <main>
      <p class="eyebrow">A LITTLE CLOSER TO HOME</p>
      <h1>Your space.<br/>Anywhere.</h1>
      <p class="intro">Everything you need, a little closer.</p>
      <div class="choices">
        <button class="choice" onclick={umbrel} disabled={busy}>
          <div class="icon"><House size={30}/></div><ArrowUpRight class="arrow" size={22}/>
          <h2>Open Umbrel</h2><p>Your home server, files and apps.<br/>Right where you left them.</p><span>Go home →</span>
        </button>
        <a class="choice desktop" href="/desktop/">
          <div class="icon"><Monitor size={30}/></div><ArrowUpRight class="arrow" size={22}/>
          <h2>Launch desktop</h2><p>Your Linux desktop, running here.<br/>Files and settings that follow you.</p><span>Make yourself at home →</span>
        </a>
      </div>
      {#if error}<p role="alert" class="error">{error}</p>{/if}
      <p class="privacy">Protected by your password and one-time code.</p>
    </main>
    <footer><span>HK REMOTE</span><a href="/#/connect?proto=ssh" onclick={() => { location.href="/#/connect?proto=ssh"; location.reload(); }}>Connection tools</a></footer>
  </div>
{/if}

<style>
  :global(body){margin:0;background:#0c1513;color:#e6eee7;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
  .portal{min-height:100dvh;display:flex;flex-direction:column;background:radial-gradient(ellipse at 85% 15%,#20362b55,transparent 60%)}
  header,footer{display:flex;justify-content:space-between;align-items:center;padding:26px 5vw}header{border-bottom:1px solid #2b403033}
  .brand{font-weight:800;font-size:26px;letter-spacing:-1.2px;color:#b7edcd;text-decoration:none}.brand span{color:#e6eee7;font-weight:400;margin-left:5px}
  .signout{display:flex;align-items:center;gap:8px;color:#b4c1b8;background:none;border:1px solid #35483c;border-radius:30px;padding:10px 17px;cursor:pointer}
  main{width:min(100%,1000px);margin:auto;padding:65px 30px 45px}.eyebrow{font-size:11px;letter-spacing:.23em;color:#9baea0;font-weight:600}h1{font-size:clamp(48px,7vw,82px);line-height:1.03;letter-spacing:-.06em;margin:22px 0;font-weight:550}.intro{color:#a7b7ab;font-size:18px}
  .choices{display:grid;grid-template-columns:repeat(2,1fr);gap:22px;margin-top:42px}.choice{position:relative;display:block;padding:32px;border-radius:24px;border:1px solid #35503d;background:#18251e;color:inherit;text-align:left;text-decoration:none;font:inherit;cursor:pointer;transition:background .15s,transform .15s}.choice:hover{background:#21352a;transform:translateY(-3px)}.choice:disabled{opacity:.6;cursor:wait}.choice:focus-visible,.signout:focus-visible{outline:3px solid #b7edcd;outline-offset:5px}.desktop{background:#172427}.desktop:hover{background:#203235}.icon{color:#b7edcd;width:58px;height:58px;display:grid;place-items:center;background:#a2e5b716;border-radius:16px}.choice :global(.arrow){position:absolute;right:30px;top:34px;color:#8ea393}h2{font-size:27px;letter-spacing:-.03em;font-weight:550;margin:28px 0 12px}.choice p{color:#a8b6ad;line-height:1.65;font-size:15px;margin:0 0 30px}.choice span{font-size:13px;color:#c2dfc9}.privacy{color:#7f9686;font-size:12px;margin-top:27px}.error{color:#ffc0b3}footer{color:#6c8373;font-size:11px;letter-spacing:.12em}footer a{letter-spacing:0;color:#a7b7aa;text-decoration:none}
  @media(max-width:640px){main{padding:40px 22px}.choices{grid-template-columns:1fr;gap:16px;margin-top:30px}.choice{padding:26px}.choice h2{margin-top:20px}.choice p{margin-bottom:20px}header,footer{padding:22px}}
  @media(prefers-reduced-motion:reduce){.choice{transition:none}.choice:hover{transform:none}}
</style>
