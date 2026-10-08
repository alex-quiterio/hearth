# hearth 🔥

A local dashboard over the `pandora` vault for kin and inner work, with Claude in a side
panel running the same buchecha skills as the terminal.

```bash
bun install
bun start            # http://127.0.0.1:4747
```

## How it fits together

```
pandora vault ──read──▶ hearth (Bun server) ──▶ browser dashboard
     ▲                        │
     └──── skills write ◀──── Claude Agent SDK (your Claude Code login, your plugins)
```

- **The vault is the brain.** Hearth stores nothing. It reads `4 - Archive/kin/` (Kin map,
  Tending log, Own psychology, Own territory) and `4 - Archive/conversations/`, and
  refreshes the page when any of them change.
- **Skills run as they do in the terminal.** The chat pane starts a Claude Code session
  through the Agent SDK with your user settings, so every installed buchecha plugin is
  there. A button sends `/kin:tend`; a follow-up resumes the same session. It uses your
  Claude Code login and its usage limits, not an API key.
- **The dashboard configures itself.** Its layout lives in the note
  `4 - Archive/kin/Hearth.md`: `pinned`, `watch`, `actions`, `panels`. The kin skills and
  jung-therapist edit that frontmatter when a session changes what matters and log the
  change under `## Changes`. The "Tend the hearth" button asks Claude to reshape it on
  purpose.

## Permissions

Reads, skills and plain `obsidian …` CLI calls run without asking. Everything else shows an
Allow / Deny card in the chat, and so does any Beeper call that sends, edits or marks
anything, every single time. The server listens on 127.0.0.1 only.

## Config

| Env | Default |
| --- | --- |
| `HEARTH_VAULT` | the Obsidian vault named `pandora`, found in Obsidian's own config |
| `HEARTH_VAULT_NAME` | `pandora` |
| `HEARTH_PORT` | `4747` |

## Testing

| Command | What it checks | Costs |
| --- | --- | --- |
| `bun test` | the vault parser and the permission rules, on a made-up vault in `test/fixtures` | nothing |
| `bun run demo` | the whole dashboard on that made-up vault, at http://127.0.0.1:4748 | nothing, until you chat |
| `bun run smoke` | a running server end to end: page, your real vault, one chat turn | one short turn |

The demo only fakes what the dashboard *reads*. A skill started from its chat still works
on the real `pandora`, so in the demo stick to its "Say hello" button.
