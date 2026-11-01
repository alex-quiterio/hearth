import { query, type CanUseTool, type ModelInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { opensAt, runsWithoutCard, type AutoAllow } from "./permission-policy";
import { ask } from "./permission-bridge";
import { activity, summarize } from "./tool-activity";
import { hearthPrompt } from "./system-prompt";

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

export type Turn = { message: string; vault: string; sessionId?: string; model?: string; autoAllow?: AutoAllow; runId?: string };

// Every turn in flight, by the run id its page sent, so tabs work side by side and Stop ends only its own.
const runs = new Map<string, AbortController>();
// Conversations with a turn in flight, to the run holding them: one turn at a time per session.
const busy = new Map<string, string>();

/** Stops one run, or every run when no id is given (what a page from before run ids sends). */
export function stop(runId?: string) {
  if (runId) runs.get(runId)?.abort();
  else for (const a of runs.values()) a.abort();
}

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

/** One turn, streamed as chat events. autoAllow: "most" runs everything without asking except Beeper changes; "all" lets Beeper sends through too. */
export async function* chat({ message, vault, sessionId, model, autoAllow = "off", runId = crypto.randomUUID() }: Turn): AsyncGenerator<ChatEvent> {
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
    if (runsWithoutCard(tool, input, autoAllow, vault)) return { behavior: "allow", updatedInput: input };
    const id = crypto.randomUUID();
    push({ type: "permission", id, tool, summary: summarize(tool, input), opensAt: opensAt(tool) });
    const r = await ask(id, signal);
    return r.behavior === "allow" ? { ...r, updatedInput: input } : r;
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
      systemPrompt: { type: "preset", preset: "claude_code", append: hearthPrompt(vault) },
    },
  });

  // Drain the SDK stream into the queue so permission prompts (raised mid-stream) interleave in order.
  const pump = (async () => {
    try {
      for await (const m of q) {
        if (m.type === "system" && m.subtype === "init") {
          if (!held) busy.set((held = m.session_id), runId);
          push({ type: "session", sessionId: m.session_id });
        } else if (m.type === "stream_event") {
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
          push({ type: "done", costUsd: m.total_cost_usd, isError: m.is_error, result: m.subtype === "success" ? undefined : m.subtype });
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
