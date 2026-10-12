import { mkdir, rm, writeFile } from "node:fs/promises";

const rawUrl = process.env.HEADSCALE_CONTROL_URL?.trim();
const outputPath = new URL("../public/config.json", import.meta.url);

if (!rawUrl) {
  // Keep the checked-in public transport configuration.
  console.log("HEADSCALE_CONTROL_URL is unset; the app will use its built-in URL default.");
  process.exit(0);
}

const url = new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`);
if (url.protocol !== "https:" || url.username || url.password) {
  throw new Error("HEADSCALE_CONTROL_URL must be an HTTPS URL without embedded credentials.");
}

await mkdir(new URL("../public/", import.meta.url), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ controlUrl: url.origin, ...(process.env.HEADSCALE_RELAY_PROXY_HOST ? { relayProxyHost: process.env.HEADSCALE_RELAY_PROXY_HOST, relayOriginHost: process.env.HEADSCALE_RELAY_ORIGIN_HOST || "headscale.movenis.dev" } : {}) }, null, 2)}\n`);
console.log(`Wrote public config for ${url.origin}.`);
