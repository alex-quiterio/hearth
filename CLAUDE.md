# hearth

Local dashboard over the Obsidian vault `pandora` (kin and inner work) with a Claude Agent SDK chat pane. See README.md.

- Bun only: `bun start`, `bun run check`. No framework, no build step; the frontend is plain `public/*.{html,js,css}`.
- Domain-driven layout: one folder per bounded context (`kin`, `conversations`, `tending`, `garden`, `inner`, `hearth`, `forecast`, `talk`, `chat`, `skills`, `attachments`, `access`). README "Code layout" has the map.
- Domain files are pure: they take text or rows and return values, with no IO, no `process.env` and no HTML. IO lives in `*-repository.ts` files behind the `Vault` port (`src/vault/vault.ts`) and in `talk/beeper-index.ts`. Env is read only in `src/config.ts`.
- The vault is read only. The one write is marking someone tended (`app/tend.ts`, through `WritableVault`, into the Tending log only).
- `src/app/dashboard.ts` assembles the read model and `app/views.ts` renders markdown at that edge. The JSON shape is the contract `public/app.js` reads, so keep it stable. `src/http/routes.ts` stays thin, and `src/server.ts` is the composition root.
- The dashboard's config is the vault note `4 - Archive/kin/Hearth.md`, not a file in this repo. Skills in `~/code/alex-quiterio/buchecha` edit it.
- Never store vault content in this repo. The server binds to 127.0.0.1 only.
- Beeper tools that change anything must go through the Allow/Deny card. The one exception: with Auto-allow all the way on (not "Beeper asks"), sending a message goes straight through.
