import { query, type CanUseTool, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";

// One Claude Code session per conversation, resumed turn by turn. It loads the user's
// settings, so every installed buchecha plugin and its skills are there as in the terminal.

export type ChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "permission"; id: string; tool: string; summary: string }
  | { type: "status"; text: string }
  | { type: "done"; costUsd: number; isError: boolean; result?: string }
  | { type: "error"; message: string };

const pending = new Map<string, (r: PermissionResult) => void>();
let running: AbortController | null = null;

export function answerPermission(id: string, allow: boolean): boolean {
  const resolve = pending.get(id);
  if (!resolve) return false;
  pending.delete(id);
  resolve(allow ? { behavior: "allow" } : { behavior: "deny", message: "Alex declined this in Hearth." });
  return true;
}

export function stop() {
  running?.abort();
}

const READ_ONLY = new Set(["Read", "Glob", "Grep", "Skill", "ToolSearch", "WebSearch", "WebFetch", "TodoWrite", "Agent", "Task"]);
// Anything on Beeper that changes the outside world asks first, every time.
const BEEPER_WRITE = /send|edit|delete|archive|mark|react|set_|create|update|remind|pin|mute/i;

/** Pre-approve what the skills do all day (read, and write notes through the Obsidian CLI); ask for the rest. */
function autoAllowed(tool: string, input: Record<string, unknown>): boolean {
  if (READ_ONLY.has(tool)) return true;
  if (tool === "Bash") {
    const cmd = String(input.command ?? "").trim();
    return /^obsidian\s/.test(cmd) && !/[;&|`$]/.test(cmd) && !/\bdelete\b|\bmove\b|\brename\b/.test(cmd);
  }
  if (tool.startsWith("mcp__beeper__")) return !BEEPER_WRITE.test(tool.slice("mcp__beeper__".length));
  return false;
}

function summarize(tool: string, input: Record<string, unknown>): string {
  if (tool === "Bash") return String(input.command ?? "");
  if (tool === "Skill") return String(input.skill ?? input.name ?? "");
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.pattern === "string") return input.pattern;
  const s = JSON.stringify(input);
  return s.length > 400 ? s.slice(0, 400) + "…" : s;
}

const APPEND = `You are running inside Hearth, Alex's local dashboard over his vault "pandora". He talks to you in a chat pane, not a terminal: ask questions in plain text (AskUserQuestion is unavailable) and keep replies short enough to read in a side panel. The dashboard re-reads the vault as soon as a skill writes to it, and its own configuration is the note "4 - Archive/kin/Hearth.md" (frontmatter: pinned, watch, actions, panels). When a session changes what matters (someone to keep an eye on, a date, a repair underway, a new routine worth a button), update that frontmatter and add one dated line under "## Changes" saying what changed and why.`;

export async function* chat(message: string, sessionId?: string): AsyncGenerator<ChatEvent> {
  running?.abort();
  const abort = new AbortController();
  running = abort;
  const queue: ChatEvent[] = [];
  let wake: (() => void) | null = null;
  const push = (e: ChatEvent) => {
    queue.push(e);
    wake?.();
  };

  const canUseTool: CanUseTool = async (tool, input, { signal }) => {
    if (autoAllowed(tool, input)) return { behavior: "allow", updatedInput: input };
    const id = crypto.randomUUID();
    push({ type: "permission", id, tool, summary: summarize(tool, input) });
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
      abortController: abort,
      includePartialMessages: true,
      permissionMode: "default",
      canUseTool,
      disallowedTools: ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"],
      systemPrompt: { type: "preset", preset: "claude_code", append: APPEND },
    },
  });

  // Drain the SDK stream into the queue so permission prompts (raised mid-stream) interleave in order.
  const pump = (async () => {
    try {
      for await (const m of q) {
        if (m.type === "system" && m.subtype === "init") push({ type: "session", sessionId: m.session_id });
        else if (m.type === "stream_event") {
          const ev = m.event as any;
          if (m.parent_tool_use_id) continue;
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") push({ type: "text", delta: ev.delta.text });
          else if (ev.type === "message_start") push({ type: "text", delta: "" });
        } else if (m.type === "assistant") {
          for (const b of m.message.content as any[])
            if (b.type === "tool_use") push({ type: "tool", name: b.name, summary: summarize(b.name, b.input ?? {}) });
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

  while (true) {
    if (!queue.length) await new Promise<void>((r) => (wake = r));
    wake = null;
    while (queue.length) {
      const e = queue.shift()!;
      if (e.type === "status" && e.text === "__end__") {
        await pump;
        if (running === abort) running = null;
        return;
      }
      yield e;
    }
  }
}
