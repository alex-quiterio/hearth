import { resolve, sep } from "node:path";

// What Claude may do without the Allow/Deny card. Pure policy: no state, no IO.
// Reads, skills, plain `obsidian` CLI calls and vault note writes run without asking.
// Any Beeper call that changes anything asks, every time, unless Auto-allow is all the way on and it's a send.

/** The page's Auto-allow: off, "most" (everything but Beeper changes), or "all" (Beeper sends too). */
export type AutoAllow = "off" | "most" | "all";
const RANK: Record<AutoAllow, number> = { off: 0, most: 1, all: 2 };

/** What a page sends for Auto-allow; true is what a page from before the "most" mode sends for on. */
export const autoAllowOf = (raw: unknown): AutoAllow => (raw === true || raw === "all" ? "all" : raw === "most" ? "most" : "off");

const READ_ONLY = new Set(["Read", "Glob", "Grep", "Skill", "ToolSearch", "WebSearch", "WebFetch", "TodoWrite", "Agent", "Task"]);
const BEEPER = "mcp__beeper__";
const BEEPER_WRITE = /send|edit|delete|archive|mark|react|set_|create|update|remind|pin|mute/i;

/** The least Auto-allow that lets a tool run without the card: "most" for anything off Beeper, "all" for a
 *  Beeper send, null for other Beeper changes, which always ask. */
export function opensAt(tool: string): Exclude<AutoAllow, "off"> | null {
  const name = tool.startsWith(BEEPER) ? tool.slice(BEEPER.length) : "";
  if (!name || !BEEPER_WRITE.test(name)) return "most";
  return /^send/i.test(name) ? "all" : null;
}

export const covers = (mode: AutoAllow, opens: AutoAllow | null) => !!opens && mode !== "off" && RANK[mode] >= RANK[opens];

// Shell commands that only look. Read is already free for any path, so these add no reach.
const LOOK = new Set(["cat", "head", "tail", "grep", "rg", "ls", "find", "wc", "date", "echo", "sort", "cut", "stat", "file", "pwd"]);

/** A command split on ; && || | and newlines outside quotes, or null if it substitutes ($, `) or redirects. */
export function shellParts(cmd: string): string[] | null {
  const plain = cmd.replace(/\s\d?>\s*(&1|\/dev\/null)/g, " ");
  const parts: string[] = [];
  let cur = "", q = "";
  for (let i = 0; i < plain.length; i++) {
    const c = plain[i]!;
    if (q) {
      if (c === q) q = "";
      else if (q === '"' && (c === "$" || c === "`")) return null;
      else if (q === '"' && c === "\\") { cur += c + (plain[++i] ?? ""); continue; }
      cur += c;
    } else if (c === "'" || c === '"') { q = c; cur += c; }
    else if (c === "$" || c === "`" || c === ">" || c === "<" || c === "(") return null;
    else if (c === ";" || c === "|" || c === "&" || c === "\n") { if (cur.trim()) parts.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  if (q) return null;
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function partAllowed(part: string): boolean {
  const word = part.split(/\s+/)[0] ?? "";
  if (word === "obsidian") return !/\bdelete\b|\bmove\b|\brename\b/.test(part);
  if (word === "find") return !/\s-(exec|execdir|ok|okdir|delete|fprint|fprintf|fls)\b/.test(part);
  if (word === "sort") return !/\s(-o|--output)\b/.test(part);
  if (word === "rg") return !/\s--pre\b/.test(part);
  return LOOK.has(word);
}

/** Pre-approve what the skills do all day: read, look around, and write notes in the vault
 *  (through the Obsidian CLI or straight to the file). Ask for the rest. */
export function autoAllowed(tool: string, input: Record<string, unknown>, vault?: string): boolean {
  if (READ_ONLY.has(tool)) return true;
  if (tool === "Bash") {
    const parts = shellParts(String(input.command ?? ""));
    return !!parts?.length && parts.every(partAllowed);
  }
  if ((tool === "Edit" || tool === "Write") && vault && typeof input.file_path === "string") {
    const root = resolve(vault), path = resolve(input.file_path);
    return path.startsWith(root + sep) && !path.slice(root.length).split(sep).some((s) => s.startsWith("."));
  }
  if (tool.startsWith(BEEPER)) return !BEEPER_WRITE.test(tool.slice(BEEPER.length));
  return false;
}

/** The whole decision: run now, or show the card. */
export const runsWithoutCard = (tool: string, input: Record<string, unknown>, mode: AutoAllow, vault: string) =>
  covers(mode, opensAt(tool)) || autoAllowed(tool, input, vault);
