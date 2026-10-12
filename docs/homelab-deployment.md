# Browser console deployment

The frontend is static on Vercel. `proxy/` contains a fixed-origin Cloudflare
Worker that forwards browser HTTP and binary WebSocket connections to the
existing Headscale/DERP service. Its private Worker secrets hold the Headscale approval credential and the Umbrel bridge key. The browser receives only one-use ephemeral registration keys.

The WASM build adapts the private DERP map inside the browser, keeping the
original region IDs while substituting the accessible Worker hostname. Native
device configuration and the Headscale DERP map are not changed. Unmodified
native Tailscale apps need raw HTTP upgrades and cannot use this Worker URL.

## Temporary registration

Login uses a user-chosen password and a TOTP authenticator code. A private,
time-limited setup link enrolls the first owner once. Save the recovery codes
when shown; each can be used once with the password. The password is salted and
hashed with PBKDF2-SHA256 (600,000 iterations); the authenticator seed is encrypted
at rest. Login is rate limited and accepted TOTP steps cannot be reused.

The approval credential stays in a Worker secret. Sessions use Secure, HttpOnly,
SameSite cookies and expire after 30 minutes. Vercel rewrites `/api/remote/*` to
the Worker so console cookies are first party. Only the resulting Tailscale
profile is kept in tab sessionStorage. No private values belong in public
configuration or repository files.

End session requests logout, which deletes an ephemeral node. If the tab is
closed or connectivity is lost, Headscale removes it after its configured
inactivity timeout (currently 30 minutes). Reloading the same tab reuses its
existing node. Headscale's interactive web registration does not honor the
client's ephemeral flag in v0.29.4, so this deployment uses API-created keys.

## Connections

Device cards have search, favourites, recent destinations, and protocol actions.
Protocol availability is checked with bounded TCP probes of ports 22, 5900 and
3389 from the browser; results are cached for one minute. A listening port is
not proof that authentication or the expected protocol will succeed. SSH also
requires the device to advertise Tailscale SSH. Custom ports can be selected in
the connection form. Usernames and ports are remembered locally; passwords are
not saved. VNC provides clipboard, fit/actual-size, view-only, Ctrl-Alt-Delete
and fullscreen controls.

## Rebuild

Install frontend dependencies with `deno install`. Fetch/build the upstream RDP
WASM artifact. Run `go mod download`, `python3 scripts/build-browser-wasm.py`,
and `deno task build`. The Python script makes a private copy of the pinned
Tailscale module and patches DERP-map delivery before transport configuration;
it never changes the Go module cache. All CI WASM builds use this script.
The `vercel-static.yml` workflow publishes built files to `vercel-static`.

Run `npm ci`, `npx wrangler types`, `npm run check`, and `npx wrangler deploy`
inside `proxy/` to deploy the transport proxy. Password fields, authenticator codes, approval tokens and
WebSocket contents are not logged by the Worker. Proxy error logging includes
only a generic event name. HTTPS terminates at the proxy; the Tailnet payload
remains encrypted end to end.

The Firefox WASM/Wisp browsing feature is deferred.

## Umbrel dashboard

“Open Umbrel web” creates a short-lived, one-use handoff to the Worker. Its
separate cookie is bound to the console session. Caddy on the existing hk-cloud
host forwards authenticated bridge requests to 100.64.0.6:80. The bridge secret
is stored in a protected service environment file; unauthorized requests receive
403. Umbrel renders normally, without an emulated browser or extra Tailnet node.
Umbrel still requires its own login. Apps using other ports or absolute local
URLs may need explicit routing before they work. This is a fixed Umbrel bridge,
not a general browser or exit-node browsing feature.

Required Worker secrets: HEADSCALE_ADMIN_KEY, AUTH_ENCRYPTION_KEY, SETUP_TOKEN,
UMBREL_BRIDGE_SECRET. Keep APP_ORIGIN, OWNER_ID and SETUP_EXPIRES_AT in Worker
configuration. The public site is https://hk-remote.vercel.app.
