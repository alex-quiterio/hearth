# hearth

Local dashboard over the Obsidian vault `pandora` (kin and inner work) with a Claude Agent SDK chat pane. See README.md.

- Bun only: `bun start`, `bun run check`. No framework, no build step; the frontend is plain `public/*.{html,js,css}`.
- `src/vault.ts` reads and parses vault notes (read only, never writes). `src/agent.ts` runs Claude Code sessions and the permission bridge. `src/server.ts` is routes and the vault watcher.
- The dashboard's config is the vault note `4 - Archive/kin/Hearth.md`, not a file in this repo. Skills in `~/code/alex-quiterio/buchecha` edit it.
- Never store vault content in this repo. The server binds to 127.0.0.1 only.
- Beeper tools that change anything must always go through the Allow/Deny card.
