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
hashed with PBKDF2-SHA256 (600,000 iterations) using a portable implementation
because Cloudflare production caps its native PBKDF2 at 100,000 rounds; the authenticator seed is encrypted
at rest. Login is rate limited and accepted TOTP steps cannot be reused.

The approval credential stays in a Worker secret. Sessions use Secure, HttpOnly,
SameSite cookies and expire after 30 minutes. Vercel rewrites `/api/remote/*` to
the Worker so console cookies are first party. The active Tailscale profile is kept in tab sessionStorage. A shared AES-GCM
encrypted copy in localStorage allows reconnecting across tabs during the same
30-minute authenticated login. Its random decryption key is available only from
the authenticated session endpoint and is not persisted in browser storage.
A Web Lock permits one active WASM client per browser origin. A new tab can
explicitly take over: the prior page flushes encrypted state and unloads its
client without logging out the ephemeral node. Closing and reopening also
restores that identity while the web login remains valid. Logout erases the
shared encrypted cache. No private values belong in public
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
Umbrel still requires its own login. Installed app ports 30001 (Tailscale), 30003 (Uptime Kuma), and 30004
(Vaultwarden) have separate authenticated Worker origins. The dashboard adapts
app-port launch links; HTML assets, redirects, APIs, and WebSockets stay proxied.
Vaultwarden’s public API configuration is rewritten for the proxy response only.
Its existing native-client domain is preserved. Caddy accepts only the fixed
Umbrel host and ports 30000–30099, with a private bridge credential. Additional
installed app ports need a matching Worker deployment; clone an existing
wrangler.umbrel-PORT.json with that port and Worker name. This is a fixed Umbrel bridge,
not a general browser or exit-node browsing feature.

Required Worker secrets: HEADSCALE_ADMIN_KEY, AUTH_ENCRYPTION_KEY, SETUP_TOKEN,
UMBREL_BRIDGE_SECRET. Keep APP_ORIGIN, OWNER_ID and SETUP_EXPIRES_AT in Worker
configuration. The public site is https://hk-remote.vercel.app.

The dashboard address is https://hk-remote-umbrel.harrisonk-0.workers.dev.
Each app uses hk-remote-umbrel-pPORT.harrisonk-0.workers.dev, preserving a
separate browser origin and app cookies. These Workers bind to the original
AuthGuard storage, so password/TOTP enrollment is unchanged. App handoff tickets
are single-use, expire after 45 seconds, and are bound to their destination port.
They never contain the Headscale token or the user’s password. Logout revokes
all child app sessions. Since the Umbrel dashboard origin has changed, its own
login may be required once more. Existing Vaultwarden passkeys are bound to its
original domain; password login works on the proxy origin.

## Startup and restricted-network diagnostics

The public Go WASM module is downloaded and compiled while the login gate is
open. A new ephemeral join key is requested only after that work and transport
checks finish, so the two-minute key lifetime is not consumed by a first-time
client download. Existing identities still reconnect without another key.

Startup shows elapsed stages for authentication, client preparation, direct
Worker HTTPS, binary WebSocket traffic, the Tailscale WebSocket subprotocol,
identity restoration, registration and receiving the device list. The public
socket probe accepts only a fixed four-byte payload and closes after eight
seconds. The Tailscale subprotocol probe opens/closes without registering a node;
it verifies protocol negotiation, not the entire encrypted Noise exchange.

A blocked transport fails before requesting a join key. Diagnostics copied by
the user contain only these stages, elapsed times, app version and browser
version. They contain no passwords, TOTP seeds/codes, auth keys or private node
keys. Tests covered delayed cold downloads, blocked HTTPS/WebSockets, disabled
WebAssembly, and real login/reconnect/takeover/logout on a normal network. The
school's actual filtering behavior still requires an observation on that network.
