import { describe, expect, test } from "bun:test";
import { autoAllowed } from "../src/agent";

describe("what runs without asking", () => {
  test("reads and skills", () => {
    for (const t of ["Read", "Glob", "Grep", "Skill"]) expect(autoAllowed(t, {})).toBe(true);
  });

  test("plain obsidian CLI calls", () => {
    expect(autoAllowed("Bash", { command: 'obsidian vault=pandora read path="4 - Archive/kin/Kin map.md"' })).toBe(true);
  });

  test("obsidian calls that chain, substitute, delete or move still ask", () => {
    for (const command of [
      "obsidian vault=pandora read path=x; rm -rf ~",
      "obsidian vault=pandora read path=$(whoami)",
      "obsidian vault=pandora delete path=x",
      "obsidian vault=pandora move path=x to=y",
    ])
      expect(autoAllowed("Bash", { command })).toBe(false);
  });

  test("other shell commands and file writes ask", () => {
    expect(autoAllowed("Bash", { command: "ls" })).toBe(false);
    expect(autoAllowed("Write", { file_path: "/tmp/x" })).toBe(false);
    expect(autoAllowed("Edit", { file_path: "/tmp/x" })).toBe(false);
  });

  test("Beeper reads pass, anything that changes Beeper always asks", () => {
    expect(autoAllowed("mcp__beeper__search_chats", {})).toBe(true);
    expect(autoAllowed("mcp__beeper__list_messages", {})).toBe(true);
    for (const t of ["send_message", "edit_message", "archive_chat", "mark_as_read", "set_reminder", "add_reaction"])
      expect(autoAllowed(`mcp__beeper__${t}`, {})).toBe(false);
  });
});
