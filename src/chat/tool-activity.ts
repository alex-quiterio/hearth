// How a tool call reads in the chat: one line of what it touches, and what Claude is doing, in plain words.

export function summarize(tool: string, input: Record<string, unknown>): string {
  if (tool === "Bash") return String(input.command ?? "");
  if (tool === "Skill") return String(input.skill ?? input.name ?? "");
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.pattern === "string") return input.pattern;
  const s = JSON.stringify(input);
  return s.length > 400 ? s.slice(0, 400) + "…" : s;
}

/** For the working row. */
export function activity(tool: string, input: Record<string, unknown>): string {
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
