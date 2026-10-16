# hearth 🔥

A local dashboard over the `pandora` vault for kin and inner work, with Claude in a side
panel running the same buchecha skills as the terminal.

```bash
bun install
bun start            # http://127.0.0.1:4747
```

Or build a double-clickable launcher with the flame icon: `scripts/make-app.sh` puts
`Hearth.app` on the Desktop. It opens the page, starting the server first if needed; when the server is
already running it asks whether to Open or Stop it
(log in `~/Library/Logs/hearth.log`).

## How it fits together

```
pandora vault ──read──▶ hearth (Bun server) ──▶ browser dashboard
     ▲                        │
     └──── skills write ◀──── Claude Agent SDK (your Claude Code login, your plugins)
```

- **The vault is the brain.** Hearth stores nothing. It reads `4 - Archive/kin/` (Kin map,
  Tending log, Own psychology, Own territory) and `4 - Archive/conversations/`, and
  refreshes the page when any of them change.
- **Two screens.** 🕯️ Inner comes first and is where Hearth opens; 🫂 Kin (`#kin`) is the
  garden, tending and rings. Inner opens on the
  inner sky (a candle whose halo paces the breath, in for four and out for six; the last 28
  days as stars, lit where practice or a proprioception moment was logged; tonight's moon;
  a dandelion seed drifting for each spell), then **an ember**: one dated thing from the logs (a
  proprioception moment, a practice, a spell, a tending gesture) at least a week old, from a year, a
  season or a month ago today when there is one. **Sit with it** asks Claude to bring it back; **Another**
  draws the next. It gathers inner work and thinking: a Begin grid of every inner-work and thinking skill, Own psychology and
  Own territory (veiled), the latest Proprioception moments, the Practice panel, the
  Coordination partner note, and what the thinking skills lately left in Rough Notes.
- **One menu for every command.** ☰ Menu (or ⌘K) lists every buchecha skill, read from the
  plugin checkout (`HEARTH_PLUGINS_DIR`) and grouped by plugin, with the hearth's own
  `actions` first and a search box. Only "Tend the hearth" stays in the header.
- **A practice panel.** It reads `4 - Archive/practice/` (the `thinking:emergent-practice`
  log and spellbook) and the `1 - Rough Notes/Emergent *.md` experiments from
  `thinking:emergent`, sorted by their listen date. Its buttons start a practice, write a
  spell, run a woes check-in or unstick a plan, and an experiment whose date has come gets
  a Listen back button.
- **Skills run as they do in the terminal.** The chat pane starts a Claude Code session
  through the Agent SDK with your user settings, so every installed buchecha plugin is
  there. A button sends `/kin:tend`; a follow-up resumes the same session. It uses your
  Claude Code login and its usage limits, not an API key.
- **The dashboard configures itself.** Its layout lives in the note
  `4 - Archive/kin/Hearth.md`: `pinned`, `watch`, `now` (the Inner screen's list of what is
  alive inside), `actions`, `panels`. `/kin:hearth` refreshes all of it from what the skills
  wrote lately. The kin skills and
  jung-therapist edit that frontmatter when a session changes what matters and log the
  change under `## Changes`. The "Tend the hearth" button asks Claude to reshape it on
  purpose.

## Attachments

Drop files on the chat, paste an image, or use 📎. The browser never reveals a file's path, so
the page uploads a copy to `$TMPDIR/hearth-attachments` (swept after a day) and the message
lists its path for Claude to read. A note dragged in from Obsidian is not copied: it is read
in place in the vault.

## Permissions

Reads, skills and plain `obsidian …` CLI calls run without asking. Everything else shows an
Allow / Deny card in the chat, and so does any Beeper call that sends, edits or marks
anything, every single time. The server listens on 127.0.0.1 only.

## Login

`bun run password` sets a password (and changing it logs out every browser). From then on
the page asks for it once per browser and remembers it for a year, through restarts; the
form is a normal login, so the browser's password manager can save it. **🔒 Lock** in the
header logs this browser out until the password is given again. **⏱ Auto-lock** next to it
makes the page do the same on its own after `HEARTH_LOCK_AFTER` seconds (30 by default) with no input (never while Claude is
working); it is off until turned on, per browser. The hash and the
cookie secret live in `~/.config/hearth/auth.json`, outside the repo. With no password set
there is no login, which is fine while only this Mac can reach the page. Set one before
sharing it over Tailscale (`tailscale serve --bg 4747`).

## On a phone

Hearth installs as an app on Android (and on an iPhone's home screen). The server still listens on
127.0.0.1 only; the phone reaches it through Tailscale, which also gives it the `https://` address
Android needs before it offers to install:

1. Set a password first: `bun run password`.
2. On the Mac: `tailscale serve --bg 4747`. It prints `https://<mac>.<tailnet>.ts.net`.
3. On the phone, with Tailscale on: open that address in Chrome, log in, then ⋮ → **Add to Home
   screen** (or **Install app**).

It opens full screen with the flame icon; a long press on the icon jumps to Inner or Kin. The
service worker caches nothing, so no vault content is kept on the phone. When the Mac can't be
reached it shows a "hearth is asleep" page instead of the browser's error.

## Config

Copy `.env.example` to `.env` (Bun loads it on its own; `.env` is git-ignored).

| Env | Default |
| --- | --- |
| `HEARTH_VAULT` | the Obsidian vault named `pandora`, found in Obsidian's own config |
| `HEARTH_VAULT_NAME` | `pandora` |
| `HEARTH_PORT` | `4747` |
| `HEARTH_LOCK_AFTER` | `30`: seconds with no input before ⏱ Auto-lock locks the page |
| `HEARTH_KIN_DIR` | `4 - Archive/kin`: Kin map, Tending log, Hearth.md, Own psychology, Own territory, Proprioception log |
| `HEARTH_CONVERSATIONS_DIR` | `4 - Archive/conversations`: one file per person |
| `HEARTH_PRACTICE_DIR` | `4 - Archive/practice`: Emergent practice, Spells |
| `HEARTH_PROJECTS_DIR` | `4 - Archive/projects`: Coordination partner |
| `HEARTH_ROUGH_DIR` | `1 - Rough Notes` |
| `HEARTH_PLUGINS_DIR` | `~/code/alex-quiterio/buchecha/plugins`: where the menu reads the skills |
| `HEARTH_AUTH_FILE` | `~/.config/hearth/auth.json`: the password hash and cookie secret |
| `ANTHROPIC_API_KEY` | unset: runs on your Claude Code login. Set, every turn bills that API key |

## Testing

| Command | What it checks | Costs |
| --- | --- | --- |
| `bun test` | the vault parser and the permission rules, on a made-up vault in `test/fixtures` | nothing |
| `bun run demo` | the whole dashboard on that made-up vault, at http://127.0.0.1:4748 | nothing, until you chat |
| `bun run smoke` | a running server end to end: page, your real vault, one chat turn | one short turn |

The demo only fakes what the dashboard *reads*. A skill started from its chat still works
on the real `pandora`, so in the demo stick to its "Say hello" button.
