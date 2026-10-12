# Browser console deployment

The frontend is static on Vercel. `proxy/` contains a fixed-origin Cloudflare
Worker that forwards browser HTTP and binary WebSocket connections to the
existing Headscale/DERP service. It stores no credentials and creates no node.

The WASM build adapts the private DERP map inside the browser, keeping the
original region IDs while substituting the accessible Worker hostname. Native
device configuration and the Headscale DERP map are not changed. Unmodified
native Tailscale apps need raw HTTP upgrades and cannot use this Worker URL.

## Temporary registration

The login form accepts a private Headscale API token. It looks up the chosen
user and creates a one-use, personal, ephemeral preauth key valid for ten
minutes. The approval token stays in memory and is cleared after creation.
Only the resulting client profile is stored in tab `sessionStorage`; private
state is never stored in `localStorage` or public configuration. Legacy
disk-persisted IPN state is removed when the updated app loads.

The Headscale API token is an administrative credential. Use a trusted browser
and store it in a password manager. No API token belongs in Vercel settings,
source, Worker vars, URLs, or public files. A new tab needs approval again.

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
inside `proxy/` to deploy the transport proxy. API bodies, approval tokens and
WebSocket contents are not logged by the Worker. Proxy error logging includes
only a generic event name. HTTPS terminates at the proxy; the Tailnet payload
remains encrypted end to end.

The Firefox WASM/Wisp browsing feature is deferred.
