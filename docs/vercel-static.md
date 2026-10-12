# Deploying the static build to Vercel

This fork builds the current upstream source and publishes the generated files to the `vercel-static` branch. The branch contains only static browser assets; it does not run a Vercel Function, VNC gateway, or VPS.

## One-time setup

1. In the GitHub repository settings, add the repository **variable** `HEADSCALE_CONTROL_URL` with the value `https://headscale.movenis.dev`. This URL is public browser configuration, not a secret.
2. In Vercel, import this repository and set the production branch to `vercel-static`.
3. Choose **Other** as the Framework Preset. Leave the Build Command, Install Command, and Output Directory blank so Vercel serves the branch's root files directly.
4. After Vercel assigns the `.vercel.app` hostname, allow that exact origin in the CORS configuration on the Headscale reverse proxy. The browser's same-origin policy otherwise blocks the console from reaching Headscale.

The workflow builds the WASM modules and frontend from current `main`, then refreshes `vercel-static` on each push to `main`. To run it before the first source change, use **Actions → Build Vercel static site → Run workflow**.

## Headscale requirements

Current upstream `main` documents testing with Headscale 0.29.4 and requires 0.29.2 or newer. The older latest tagged release, 0.7.2, documents a 0.28.0 configuration and is not used by this workflow. Headscale must be reachable by the browser over HTTPS on port 443, with WebSocket upgrades supported on `/ts2021`.

The static deployment serves only the web app. It does not make a private Headscale control server publicly reachable; network reachability and CORS must be provided by the existing Headscale host/reverse proxy.
