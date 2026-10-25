import { query, type CanUseTool, type ModelInfo, type PermissionResult, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { resolve, sep } from "node:path";
import { PATHS, VAULT_NAME } from "./vault";

// One Claude Code session per conversation, resumed turn by turn. It loads the user's
// settings, so every installed buchecha plugin and its skills are there as in the terminal.

export type ChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "permission"; id: string; tool: string; summary: string; opensAt: Exclude<AutoAllow, "off"> | null }
  | { type: "status"; text: string }
  | { type: "activity"; text: string }
  | { type: "done"; costUsd: number; isError: boolean; result?: string }
  | { type: "error"; message: string };

const pending = new Map<string, (r: PermissionResult) => void>();
// Every turn in flight, by the run id its page sent, so tabs work side by side and Stop ends only its own.
const runs = new Map<string, AbortController>();
// Conversations with a turn in flight, to the run holding them: one turn at a time per session.
const busy = new Map<string, string>();

/** why: the optional reason typed on the Deny card, passed on so the next step can take it into account. */
export function answerPermission(id: string, allow: boolean, why = ""): boolean {
  const resolve = pending.get(id);
  if (!resolve) return false;
  pending.delete(id);
  const reason = why.trim().slice(0, 500);
  resolve(allow ? { behavior: "allow" } : { behavior: "deny", message: reason ? `Alex declined this in Hearth. Why: ${reason}` : "Alex declined this in Hearth." });
  return true;
}

/** Stops one run, or every run when no id is given (what a page from before run ids sends). */
export function stop(runId?: string) {
  if (runId) runs.get(runId)?.abort();
  else for (const a of runs.values()) a.abort();
}

const READ_ONLY = new Set(["Read", "Glob", "Grep", "Skill", "ToolSearch", "WebSearch", "WebFetch", "TodoWrite", "Agent", "Task"]);
// Anything on Beeper that changes the outside world asks first, unless auto-allow is all the way on and it's a send.
const BEEPER_WRITE = /send|edit|delete|archive|mark|react|set_|create|update|remind|pin|mute/i;

/** The page's Auto-allow: off, "most" (everything but Beeper changes), or "all" (Beeper sends too). */
export type AutoAllow = "off" | "most" | "all";
const RANK: Record<AutoAllow, number> = { off: 0, most: 1, all: 2 };

/** The least Auto-allow that lets a tool run without the card: "most" for anything off Beeper, "all" for a
 *  Beeper send, null for other Beeper changes, which always ask. */
export function opensAt(tool: string): Exclude<AutoAllow, "off"> | null {
  const name = tool.startsWith("mcp__beeper__") ? tool.slice("mcp__beeper__".length) : "";
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
  if (tool.startsWith("mcp__beeper__")) return !BEEPER_WRITE.test(tool.slice("mcp__beeper__".length));
  return false;
}

/** What Claude is doing right now, in plain words for the working row. */
function activity(tool: string, input: Record<string, unknown>): string {
  if (tool === "Skill") return `Opening ${input.skill ?? input.name ?? "a skill"}`;
  if (tool === "Bash") {
    const cmd = String(input.command ?? "");
    if (/obsidian\b.*\b(create|append|prepend|write|overwrite)\b|python3?.*obsidian/.test(cmd)) return "Writing to the vault";
    if (/obsidian\b/.test(cmd)) return "Reading the vault";
    return "Running a command";
  }
  if (tool.startsWith("mcp__beeper__")) return /send/i.test(tool) ? "Sending on Beeper" : "Reading Beeper";
  if (tool === "Read" || tool === "Grep" || tool === "Glob") return "Reading";
  if (tool === "Write" || tool === "Edit") return "Writing a file";
  if (tool === "WebSearch" || tool === "WebFetch") return "Looking on the web";
  if (tool === "Agent" || tool === "Task") return "Asking a helper";
  return `Using ${tool}`;
}

export function summarize(tool: string, input: Record<string, unknown>): string {
  if (tool === "Bash") return String(input.command ?? "");
  if (tool === "Skill") return String(input.skill ?? input.name ?? "");
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.pattern === "string") return input.pattern;
  const s = JSON.stringify(input);
  return s.length > 400 ? s.slice(0, 400) + "…" : s;
}

const append = (vault: string) => `You are running inside Hearth, Alex's local dashboard over his vault "${VAULT_NAME}". He talks to you in a chat pane, not a terminal: ask questions in plain text (AskUserQuestion is unavailable) and keep replies short enough to read in a side panel. The dashboard re-reads the vault as soon as a skill writes to it, and its own configuration is the note "${PATHS.hearth}" (frontmatter: pinned, watch, actions, panels). When a session changes what matters (someone to keep an eye on, a date, a repair underway, a new routine worth a button), update that frontmatter and add one dated line under "## Changes" saying what changed and why.

The vault is at ${vault}. To write a note, use Edit or Write on its file there, or one plain \`obsidian\` command; both run without asking Alex. Do not wrap vault writes in python or shell scripts: every one of those stops him for approval.

When you stop to ask Alex one yes or no question before you act (send this message?, commit and push?), put [[confirm]] alone on the last line of that reply. Hearth hides it and shows Yes and No buttons; a press comes back as "Yes" or "No". A Yes approves exactly what you asked, nothing more. Leave it out for open questions and for questions with more than two answers.`;

let models: Promise<ModelInfo[]> | null = null;

/** The models Claude Code offers this account, asked once from an idle session that never sends a turn. */
export function listModels(): Promise<ModelInfo[]> {
  models ??= (async () => {
    const abort = new AbortController();
    const idle = (async function* (): AsyncGenerator<SDKUserMessage> {
      await new Promise((r) => abort.signal.addEventListener("abort", r));
    })();
    const q = query({ prompt: idle, options: { cwd: process.cwd(), abortController: abort } });
    try {
      return await q.supportedModels();
    } finally {
      abort.abort();
    }
  })().catch((e) => {
    models = null;
    throw e;
  });
  return models;
}

/** autoAllow: the page's Auto-allow. "most" runs everything without asking except Beeper changes; "all" lets Beeper sends through too. */
export async function* chat(message: string, vault: string, sessionId?: string, model?: string, autoAllow: AutoAllow = "off", runId: string = crypto.randomUUID()): AsyncGenerator<ChatEvent> {
  // Another tab is mid-turn in this conversation: resuming it twice at once would fork it, so wait instead of stopping it.
  if (sessionId && busy.has(sessionId)) {
    yield { type: "error", message: "This conversation is still working in another tab. Wait for it to finish, or start a new conversation here." };
    return;
  }
  const abort = new AbortController();
  runs.set(runId, abort);
  let held = sessionId;
  if (held) busy.set(held, runId);
  const queue: ChatEvent[] = [];
  let wake: (() => void) | null = null;
  const push = (e: ChatEvent) => {
    queue.push(e);
    wake?.();
  };

  const canUseTool: CanUseTool = async (tool, input, { signal }) => {
    const opens = opensAt(tool);
    if (covers(autoAllow, opens) || autoAllowed(tool, input, vault)) return { behavior: "allow", updatedInput: input };
    const id = crypto.randomUUID();
    push({ type: "permission", id, tool, summary: summarize(tool, input), opensAt: opens });
    return new Promise<PermissionResult>((resolve) => {
      pending.set(id, (r) => resolve(r.behavior === "allow" ? { ...r, updatedInput: input } : r));
      signal.addEventListener("abort", () => answerPermission(id, false));
    });
  };

  const q = query({
    prompt: message,
    options: {
      cwd: process.cwd(),
      resume: sessionId,
      model,
      abortController: abort,
      includePartialMessages: true,
      permissionMode: "default",
      canUseTool,
      disallowedTools: ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"],
      systemPrompt: { type: "preset", preset: "claude_code", append: append(vault) },
    },
  });

  // Drain the SDK stream into the queue so permission prompts (raised mid-stream) interleave in order.
  const pump = (async () => {
    try {
      for await (const m of q) {
        if (m.type === "system" && m.subtype === "init") {
          if (!held) busy.set((held = m.session_id), runId);
          push({ type: "session", sessionId: m.session_id });
        }
        else if (m.type === "stream_event") {
          const ev = m.event as any;
          if (m.parent_tool_use_id) continue;
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") push({ type: "text", delta: ev.delta.text });
          else if (ev.type === "message_start") push({ type: "activity", text: "Thinking" });
          else if (ev.type === "content_block_start") {
            const b = ev.content_block;
            if (b?.type === "thinking") push({ type: "activity", text: "Thinking" });
            else if (b?.type === "text") push({ type: "activity", text: "Writing" });
            else if (b?.type === "tool_use") push({ type: "activity", text: "Choosing a step" });
          }
        } else if (m.type === "assistant") {
          for (const b of m.message.content as any[])
            if (b.type === "tool_use") {
              push({ type: "tool", name: b.name, summary: summarize(b.name, b.input ?? {}) });
              push({ type: "activity", text: activity(b.name, b.input ?? {}) });
            }
        } else if (m.type === "result") {
          push({
            type: "done",
            costUsd: m.total_cost_usd,
            isError: m.is_error,
            result: m.subtype === "success" ? undefined : m.subtype,
          });
        }
      }
    } catch (e) {
      push(abort.signal.aborted ? { type: "status", text: "stopped" } : { type: "error", message: (e as Error).message });
    } finally {
      push({ type: "status", text: "__end__" });
    }
  })();

  try {
    while (true) {
      if (!queue.length) await new Promise<void>((r) => (wake = r));
      wake = null;
      while (queue.length) {
        const e = queue.shift()!;
        if (e.type === "status" && e.text === "__end__") {
          await pump;
          return;
        }
        yield e;
      }
    }
  } finally {
    runs.delete(runId);
    if (held && busy.get(held) === runId) busy.delete(held);
  }
}
