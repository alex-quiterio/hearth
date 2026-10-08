import { listSessions, getSessionMessages, deleteSession } from "@anthropic-ai/claude-agent-sdk";
import { summarize } from "./agent";

// Past conversations are Claude Code sessions run from this repo; Hearth reads them back.

const dir = process.cwd();

export async function sessions() {
  const list = await listSessions({ dir, limit: 200 });
  return list
    .map((s) => ({
      id: s.sessionId,
      title: s.customTitle || s.summary || s.firstPrompt || "Untitled",
      firstPrompt: s.firstPrompt ?? "",
      createdAt: s.createdAt ?? s.lastModified,
      lastModified: s.lastModified,
    }))
    .sort((a, b) => b.lastModified - a.lastModified);
}

export type Line = { kind: "user" | "assistant" | "tool"; text: string };

/** A session as the chat shows it: prompts, replies and one line per tool, nothing else. */
export async function transcript(id: string): Promise<Line[]> {
  const out: Line[] = [];
  for (const m of await getSessionMessages(id, { dir })) {
    if (m.parent_tool_use_id) continue; // a helper's own steps
    const msg = m.message as { content: string | any[] };
    const parts = typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : msg.content;
    for (const p of parts) {
      if (m.type === "user" && p.type === "text") {
        const text = userText(p.text);
        if (text) out.push({ kind: "user", text });
      } else if (m.type === "assistant" && p.type === "text" && p.text.trim()) {
        const last = out.at(-1);
        if (last?.kind === "assistant") last.text += "\n\n" + p.text;
        else out.push({ kind: "assistant", text: p.text });
      } else if (m.type === "assistant" && p.type === "tool_use") {
        out.push({ kind: "tool", text: `${p.name} · ${summarize(p.name, p.input ?? {})}` });
      }
    }
  }
  return out;
}

/** What Alex typed: a slash command shows as he wrote it; injected skill text and reminders are dropped. */
function userText(raw: string): string | null {
  const cmd = raw.match(/<command-name>([^<]+)<\/command-name>/);
  if (cmd) {
    const args = raw.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    return `${cmd[1]!.trim()}${args ? " " + args : ""}`;
  }
  if (/^\s*</.test(raw) || /^Base directory for this skill/.test(raw)) return null;
  return raw.trim() || null;
}

export const forget = (id: string) => deleteSession(id, { dir });
