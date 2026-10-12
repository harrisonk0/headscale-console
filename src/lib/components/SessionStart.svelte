<script lang="ts">
  import { ShieldCheck, ArrowRight, KeyRound, Globe } from "lucide-svelte";
  let { controlUrl, onReady }: { controlUrl: string; onReady: (key: string) => void } = $props();
  let token = $state("");
  let owner = $state(localStorage.getItem("mesh-owner") || "harrison");
  let busy = $state(false);
  let error = $state("");
  let help = $state(false);
  async function start(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = "";
    try {
      const headers = {
        Authorization: `Bearer ${token.trim()}`,
        "Content-Type": "application/json",
      };
      const usersResponse = await fetch(`${controlUrl}/api/v1/user`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!usersResponse.ok)
        throw new Error(
          usersResponse.status === 401
            ? "This approval token is invalid or expired."
            : `Headscale could not verify approval (${usersResponse.status}).`,
        );
      const { users } = await usersResponse.json();
      const user = users?.find((u: { name: string }) => u.name === owner.trim());
      if (!user) throw new Error("That Headscale user was not found. Check the account name.");
      const response = await fetch(`${controlUrl}/api/v1/preauthkey`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          user: String(user.id),
          ephemeral: true,
          reusable: false,
          expiration: new Date(Date.now() + 600000).toISOString(),
        }),
      });
      if (!response.ok)
        throw new Error(`Headscale could not create a temporary session (${response.status}).`);
      const { preAuthKey } = await response.json();
      if (!preAuthKey?.ephemeral || !preAuthKey.key)
        throw new Error("Headscale did not return an ephemeral key. The session was not started.");
      localStorage.setItem("mesh-owner", owner.trim());
      token = "";
      onReady(preAuthKey.key);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not start the session. Try again.";
    } finally {
      busy = false;
    }
  }
</script>

<main class="mesh-login">
  <div class="mesh-brand">
    <span class="mesh-mark">m</span> mesh<span class="mesh-brand-sub">/ remote</span>
  </div>
  <div class="login-grid">
    <section class="login-story">
      <p class="eyebrow"><span class="signal-dot"></span> YOUR HOMELAB. ANYWHERE.</p>
      <h1>Home is a<br /><em>connection away.</em></h1>
      <p class="hero-copy">A desktop. A terminal. Your machines, right here in the browser.</p>
      <div class="login-orbit" aria-hidden="true">
        <span class="orbit-node">⌘</span><span class="orbit-core">m</span><span class="orbit-node"
          >▣</span
        ><span class="orbit-node">›_</span>
      </div>
      <div class="login-facts">
        <span><ShieldCheck size={17} /> End-to-end encrypted</span><span
          ><Globe size={17} /> Runs in your browser</span
        >
      </div>
    </section>
    <form class="session-card" onsubmit={start}>
      <span class="session-badge"><ShieldCheck size={14} /> Temporary by design</span>
      <h2>Open your private lane.</h2>
      <p>
        Approve this browser once. Its device disappears after it goes offline; client keys stay
        only in this tab’s session.
      </p>
      <label for="owner">Headscale account</label><input
        id="owner"
        autocomplete="username"
        required
        bind:value={owner}
      />
      <label for="approval">Approval token <KeyRound size={13} /></label><input
        id="approval"
        type="password"
        autocomplete="current-password"
        required
        bind:value={token}
        placeholder="Your private Headscale API token"
      />
      <p class="field-hint">
        The token grants Headscale admin access. It is sent to your server to create one ephemeral
        join key, then cleared from this form. The site never saves it.
      </p>
      {#if error}<div class="mesh-error" role="alert">{error}</div>{/if}
      <button class="mesh-primary" type="submit" disabled={busy}
        >{busy ? "Creating your temporary session…" : "Enter your homelab"}<ArrowRight
          size={18}
        /></button
      >
      <button
        type="button"
        class="mesh-text-button"
        onclick={() => (help = !help)}
        aria-expanded={help}>Where do I get an approval token?</button
      >
      {#if help}<div class="setup-help">
          <p>
            An owner creates a token once on the Headscale server and keeps it in their password
            manager. It replaces copying a registration command for every browser session.
          </p>
          <code>sudo headscale apikeys create --expiration 90d</code>
          <p>Only use this site on a browser you trust. A new tab needs approval again.</p>
        </div>{/if}
    </form>
  </div>
</main>
