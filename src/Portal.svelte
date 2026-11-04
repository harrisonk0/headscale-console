<script lang="ts">
  import SessionStart from "$lib/components/SessionStart.svelte";
  import { Monitor, Laptop, ArrowUpRight, LogOut } from "lucide-svelte";
  let ready = $state(false), error = $state("");
  function spotlight(event: MouseEvent) {
    const card=event.currentTarget as HTMLElement, r=card.getBoundingClientRect();
    card.style.setProperty('--x',`${event.clientX-r.left}px`);card.style.setProperty('--y',`${event.clientY-r.top}px`);
  }
  async function logout(){try{const r=await fetch('/api/remote/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error('Could not sign out.');location.assign('/');}catch(e){error=e instanceof Error?e.message:'Try again.';}}
</script>
{#if !ready}
  <SessionStart loginOnly forceLogin={location.hash.startsWith("#/reauth")} onReady={() => { ready = true; }} />
{:else}
<div class="home">
 <header><a href="/" class="brand">hk<span>remote</span><i></i></a><button class="logout" onclick={logout} aria-label="Sign out" title="Sign out"><LogOut size={19}/></button></header>
 <main>
  <div class="eyebrow"><span></span> YOUR PERSONAL SPACE</div>
  <h1>Pick up where<br/>you left off<span>.</span></h1>
  <p class="intro">Two computers. One place to come back to.</p>
  <div class="choices">
   <a class="card linux" href="/desktop/index.html?target=linux" onmousemove={spotlight}>
    <div class="top"><span class="number">01</span><ArrowUpRight size={23}/></div>
    <div class="machine"><Monitor size={74} strokeWidth={1}/><div class="screen"><span></span><span></span><span></span></div></div>
    <div class="bottom"><h2>Linux desktop</h2><p>Your own workspace.<br/>Files, apps and windows stay here.</p><span class="action">Open desktop <ArrowUpRight size={17}/></span></div>
   </a>
   <a class="card mac" href="/desktop/index.html?target=mac" onmousemove={spotlight}>
    <div class="top"><span class="number">02</span><ArrowUpRight size={23}/></div>
    <div class="machine"><Laptop size={86} strokeWidth={1}/><div class="halo"></div></div>
    <div class="bottom"><h2>This Mac</h2><p>Your familiar Mac, from anywhere.<br/>Available when it’s awake and connected.</p><span class="action">Connect to Mac <ArrowUpRight size={17}/></span></div>
   </a>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
 </main>
 <footer><span>YOURS, WHEREVER.</span><span>Password + one-time code protected</span></footer>
</div>
{/if}
<style>
 :global(body){margin:0;background:#08090b;color:#f0f0f2;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
 .home{min-height:100dvh;display:flex;flex-direction:column;background:radial-gradient(ellipse at 50% 0,#191c26 0,transparent 60%)}header,footer{display:flex;align-items:center;justify-content:space-between;padding:28px 6vw}.brand{text-decoration:none;color:#f4f4f5;font-weight:750;font-size:24px;letter-spacing:-1.4px;display:flex;align-items:center}.brand span{font-weight:400;color:#989ba7;margin-left:5px}.brand i{width:5px;height:5px;background:#c8d6ff;border-radius:50%;margin-left:9px}.logout{background:#ffffff08;border:1px solid #ffffff12;border-radius:50%;padding:12px;color:#aaaeba;cursor:pointer;display:flex}main{width:min(100%,970px);padding:40px 28px 55px;margin:auto;box-sizing:border-box}.eyebrow{display:flex;align-items:center;gap:10px;font-size:10px;letter-spacing:.22em;color:#898e9b}.eyebrow span{width:6px;height:6px;border-radius:50%;background:#bdcaff}h1{font-size:clamp(44px,6vw,72px);font-weight:500;line-height:1.05;letter-spacing:-.06em;margin:24px 0 18px}h1>span{color:#8fa8ff}.intro{font-size:16px;color:#8a8f9e}.choices{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:40px}.card{--x:-1000px;--y:-1000px;position:relative;overflow:hidden;display:block;border:1px solid #24262e;border-radius:22px;padding:26px;color:inherit;text-decoration:none;background:#101115;transition:border-color .25s,transform .25s}.card::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(350px circle at var(--x) var(--y),#b0c4ff15,transparent 80%)}.card:hover{border-color:#626879;transform:translateY(-4px)}.top{display:flex;align-items:center;justify-content:space-between;color:#8a90a0}.number{font-size:11px;font-family:monospace;letter-spacing:.1em}.machine{height:135px;display:grid;place-items:center;position:relative;color:#b9c9f5}.mac .machine{color:#c8b6dd}.screen{position:absolute;width:32px;top:53px;display:grid;gap:4px}.screen span{height:2px;background:#91aaff55}.screen span:nth-child(2){width:65%}.halo{position:absolute;width:110px;height:60px;z-index:0;background:#c79eff0a;filter:blur(20px)}h2{font-size:26px;font-weight:500;letter-spacing:-.035em;margin:4px 0 12px}.bottom p{color:#9296a3;font-size:14px;line-height:1.65;margin:0}.action{display:flex;align-items:center;justify-content:space-between;margin-top:28px;padding-top:20px;border-top:1px solid #ffffff0c;font-size:13px;color:#d2daef}footer{font-size:10px;color:#5e6473;letter-spacing:.1em}.error{color:#f6a49b}a:focus-visible,button:focus-visible{outline:2px solid #a8bfff;outline-offset:5px}@media(max-width:600px){.choices{grid-template-columns:1fr}main{padding-top:25px}.machine{height:100px}.screen{top:36px}header,footer{padding:22px}footer{gap:15px;font-size:9px}.card{padding:23px}}@media(prefers-reduced-motion:reduce){.card{transition:none}.card:hover{transform:none}}
</style>
