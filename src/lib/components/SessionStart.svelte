<script lang="ts">
  import { onMount } from "svelte";
  import { ShieldCheck, ArrowRight, Globe, Copy, Download } from "lucide-svelte";
  import ConnectionStatus from "$lib/components/ConnectionStatus.svelte";
  import { reportStartup } from "$lib/store/startup-status";
  import Qr from "$lib/components/qrcode/qr.svelte";
  let {
    onReady,
    setupToken = "",
    needsNode = true,
    prepareSession,
  }: {
    onReady: (key: string) => void;
    setupToken?: string;
    needsNode?: boolean;
    prepareSession?: (progress: (message: string) => void) => Promise<boolean>;
  } = $props();
  let password = $state(""),
    confirm = $state(""),
    code = $state(""),
    secret = $state(""),
    uri = $state("");
  let recovery = $state<string[]>([]),
    recoveryMode = $state(false),
    busy = $state(false),
    error = $state("");
  let progress = $state("Preparing your connection…");
  let stage = $state<"loading" | "login" | "setup" | "recovery" | "unconfigured" | "connection">(
    "loading",
  );
  async function post(path: string, data: Record<string, unknown>) {
    const r = await fetch(`/api/remote/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: "same-origin",
      signal: AbortSignal.timeout(20000),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error || "The service is unavailable. Try again.");
    return b;
  }
  async function enter() {
    busy = true;
    error = "";
    stage = "connection";
    try {
      const createNode = prepareSession
        ? await prepareSession((message) => {
            progress = message;
          })
        : needsNode;
      progress = createNode
        ? "Approving your temporary session…"
        : "Reconnecting your existing session…";
      reportStartup(
        createNode
          ? "Requesting a one-use temporary-device key"
          : "Reusing the existing device identity",
      );
      const b = createNode ? await post("join", {}) : { authKey: "" };
      reportStartup(
        createNode
          ? "Temporary-device key issued; starting connection"
          : "Saved device identity restored",
        "ok",
      );
      onReady(b.authKey);
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not start the session.";
      reportStartup(error, "error");
      busy = false;
    }
  }
  async function initialise() {
    busy = true;
    error = "";
    try {
      const r = await fetch("/api/remote/status", {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error("Login service is unavailable.");
      const s = await r.json();
      if (s.authenticated && !setupToken) {
        await enter();
        return;
      }
      if (s.configured) {
        stage = "login";
      } else if (setupToken) {
        const s = await post("setup/start", { setupToken });
        secret = s.secret;
        uri = s.uri;
        stage = "setup";
      } else stage = "unconfigured";
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not load login.";
      stage = "unconfigured";
    } finally {
      busy = false;
    }
  }
  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = "";
    try {
      if (stage === "connection") {
        await enter();
        return;
      }
      if (stage === "setup") {
        if (password !== confirm) throw new Error("The passwords don’t match.");
        const b = await post("setup/finish", { setupToken, password, code });
        recovery = b.recovery;
        stage = "recovery";
        secret = "";
        uri = "";
        password = "";
        confirm = "";
        code = "";
      } else {
        await post("login", { password, code: code.trim() });
        password = "";
        code = "";
        await enter();
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not sign in.";
      code = "";
    } finally {
      busy = false;
    }
  }
  function download() {
    const blob = new Blob(
      [
        "HK Remote recovery codes\nUse each code once with your password. Store offline or in your password manager.\n\n" +
          recovery.join("\n"),
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "HK-Remote-recovery-codes.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  onMount(initialise);
</script>

<main class="mesh-login">
  <div class="mesh-brand">
    <span class="mesh-mark">m</span> HK Remote<span class="mesh-brand-sub">/ private access</span>
  </div>
  <div class="login-grid">
    <section class="login-story">
      <p class="eyebrow"><span class="signal-dot"></span> YOUR HOMELAB. ANYWHERE.</p>
      <h1>Home is a<br /><em>connection away.</em></h1>
      <p class="hero-copy">
        A desktop. A terminal. Your Umbrel. Your machines, right here in the browser.
      </p>
      <div class="login-orbit" aria-hidden="true">
        <span class="orbit-node">⌘</span><span class="orbit-core">m</span><span class="orbit-node"
          >▣</span
        ><span class="orbit-node">›_</span>
      </div>
      <div class="login-facts">
        <span><ShieldCheck size={17} /> Password + authenticator</span><span
          ><Globe size={17} /> Temporary browser devices</span
        >
      </div>
    </section>
    <form class="session-card" onsubmit={submit}>
      <span class="session-badge"><ShieldCheck size={14} /> Private by design</span>
      {#if stage === "loading"}<h2>Checking your private lane…</h2>
      {:else if stage === "connection"}<h2>
          {error ? "Connection interrupted." : "Opening your homelab…"}
        </h2>
        <p>{progress}</p>
        <ConnectionStatus />
        {#if busy}<div class="mesh-loading-bar" aria-hidden="true"></div>{:else}
          <button type="button" class="mesh-primary" onclick={enter}
            >Try the connection again</button
          >
          <button type="button" class="mesh-text-button" onclick={() => location.reload()}
            >Reload and sign in again</button
          >
        {/if}
      {:else if stage === "unconfigured"}<h2>
          {error ? "Couldn’t connect." : "Ready for your setup."}
        </h2>
        <p>
          Open the private one-time setup link to choose your password and add HK Remote to your
          authenticator. Setup stays locked until you confirm a code.
        </p>
        <button type="button" class="mesh-secondary" onclick={initialise} disabled={busy}
          >Check again</button
        >
      {:else if stage === "recovery"}<h2>You’re set.</h2>
        <p>
          Save these eight recovery codes before continuing. Each can replace one authenticator
          code, but still requires your password.
        </p>
        <div class="recovery-grid">
          {#each recovery as c}<code>{c}</code>{/each}
        </div>
        <button type="button" class="mesh-secondary" onclick={download}
          ><Download size={16} /> Download recovery codes</button
        ><button type="button" class="mesh-primary" onclick={enter} disabled={busy}
          >{busy ? "Opening your session…" : "Enter your homelab"}<ArrowRight size={18} /></button
        >
      {:else}
        <h2>{stage === "setup" ? "Set up HK Remote." : "Open your private lane."}</h2>
        {#if stage === "setup"}<p>
            Scan this QR code with your authenticator, choose a unique password, and confirm the
            six-digit code.
          </p>
          <div class="totp-qr">
            <Qr
              content={uri}
              color="#102018"
              background="#ffffff"
              padding={3}
              width={240}
              height={240}
            />
          </div>
          <details class="setup-help">
            <summary>Enter the authenticator key manually</summary><code>{secret}</code><button
              type="button"
              class="mesh-text-button"
              onclick={() => navigator.clipboard.writeText(secret)}
              ><Copy size={12} /> Copy key</button
            >
          </details>{:else}<p>
            Sign in as Harrison. Your server approval token stays on the server.
          </p>{/if}
        <label for="password"
          >{stage === "setup" ? "Choose a password" : "Password"}<input
            id="password"
            type="password"
            autocomplete={stage === "setup" ? "new-password" : "current-password"}
            required
            minlength={stage === "setup" ? 12 : undefined}
            maxlength="256"
            bind:value={password}
          /></label
        >
        {#if stage === "setup"}<p class="field-hint">
            Use a unique passphrase of at least 12 characters.
          </p>
          <label for="confirm-password"
            >Confirm password<input
              id="confirm-password"
              type="password"
              autocomplete="new-password"
              required
              bind:value={confirm}
            /></label
          >{/if}
        <label for="code"
          >{recoveryMode ? "Recovery code" : "Authenticator code"}<input
            id="code"
            type="text"
            inputmode={recoveryMode ? "text" : "numeric"}
            autocomplete="one-time-code"
            required
            minlength={recoveryMode ? 24 : 6}
            maxlength={recoveryMode ? 32 : 6}
            pattern={recoveryMode ? undefined : "[0-9]{6}"}
            bind:value={code}
            placeholder={recoveryMode ? "An unused recovery code" : "000000"}
          /></label
        >
        <button class="mesh-primary" disabled={busy}
          >{busy
            ? "Verifying…"
            : stage === "setup"
              ? "Confirm and enable login"
              : "Enter your homelab"}<ArrowRight size={18} /></button
        >
        {#if stage === "login"}<button
            type="button"
            class="mesh-text-button"
            onclick={() => {
              recoveryMode = !recoveryMode;
              code = "";
            }}>{recoveryMode ? "Use authenticator instead" : "Use a recovery code"}</button
          >{/if}
        <p class="field-hint">
          Codes can be used once. Login sessions last 30 minutes. Passwords are hashed; the site
          never saves them.
        </p>
      {/if}{#if error}<div class="mesh-error" role="alert">{error}</div>{/if}
    </form>
  </div>
</main>
