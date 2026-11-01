import { config } from "./config";
import { findVault } from "./vault/locate";
import { fsVault } from "./vault/vault";
import { WATCHED } from "./vault/layout";
import { watchVault } from "./vault/watcher";
import { sweepAttachments } from "./attachments/attachments";
import { loadAuth, AUTH_FILE } from "./access/auth";
import { routes } from "./http/routes";

// The composition root: find the vault, wire the adapters to the application, serve.

const vault = fsVault(await findVault());
const watcher = await watchVault(vault, WATCHED);

sweepAttachments();
setInterval(sweepAttachments, 3600 * 1000);

const hasPassword = await loadAuth();

Bun.serve({
  hostname: "127.0.0.1", // never off this machine: the vault holds inner work
  port: config.server.port,
  idleTimeout: 0,
  routes: routes({ vault, hasPassword, onVaultChange: watcher.subscribe }),
  fetch: () => new Response("not found", { status: 404 }),
});

console.log(`hearth · vault ${vault.root}\n        http://127.0.0.1:${config.server.port}`);
if (!hasPassword) console.log(`        no password set (${AUTH_FILE}): run \`bun run password\` before sharing it beyond this Mac`);
