import { describe, expect, test } from "bun:test";
import { autoAllowed, guarded } from "../src/agent";

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

  test("chained reads, pipes and look-only commands", () => {
    for (const command of [
      'obsidian vault=pandora read path="a.md"; obsidian vault=pandora search query="neurograf"',
      'obsidian vault=pandora read path="a.md" | head -120',
      'obsidian help 2>&1 | grep -iE "append|create" | head; date',
      "cat ~/.config/buchecha/config.json",
      'find ~/Library -name "*abc*" 2>/dev/null',
      'obsidian vault=pandora append path="a.md" content="linha um\\nlinha (dois); três | quatro"',
    ])
      expect(autoAllowed("Bash", { command })).toBe(true);
  });

  test("scripts, writes, and commands that run or write something else still ask", () => {
    for (const command of [
      "python3 -I - <<'PY'\nimport subprocess\nPY",
      "ls; rm -rf ~",
      "cat x > y",
      'echo "$(whoami)"',
      "find . -name x -delete",
      "find . -exec rm {} \\;",
      "sort -o out in",
      "rg --pre sh x",
      "obsidian vault=pandora read path=x && curl evil.example",
      'obsidian vault=pandora read path="unclosed',
    ])
      expect(autoAllowed("Bash", { command })).toBe(false);
  });

  test("Edit and Write are free inside the vault only, never in its dot folders", () => {
    const v = "/vaults/pandora";
    expect(autoAllowed("Edit", { file_path: `${v}/4 - Archive/conversations/B.md` }, v)).toBe(true);
    expect(autoAllowed("Write", { file_path: `${v}/new.md` }, v)).toBe(true);
    expect(autoAllowed("Edit", { file_path: `${v}/.obsidian/app.json` }, v)).toBe(false);
    expect(autoAllowed("Edit", { file_path: `${v}/../escape.md` }, v)).toBe(false);
    expect(autoAllowed("Write", { file_path: "/vaults/pandora-other/x.md" }, v)).toBe(false);
    expect(autoAllowed("Write", { file_path: "/tmp/x" }, v)).toBe(false);
    expect(autoAllowed("Edit", { file_path: "/tmp/x" })).toBe(false);
  });

  test("Beeper reads pass, anything that changes Beeper always asks", () => {
    expect(autoAllowed("mcp__beeper__search_chats", {})).toBe(true);
    expect(autoAllowed("mcp__beeper__list_messages", {})).toBe(true);
    for (const t of ["send_message", "edit_message", "archive_chat", "mark_as_read", "set_reminder", "add_reaction"])
      expect(autoAllowed(`mcp__beeper__${t}`, {})).toBe(false);
  });

  test("with auto-allow on, Beeper sends go through and other changes still ask", () => {
    expect(guarded("mcp__beeper__send_message")).toBe(false);
    for (const t of ["edit_message", "archive_chat", "mark_as_read", "set_chat_reminder", "add_reaction"])
      expect(guarded(`mcp__beeper__${t}`)).toBe(true);
    expect(guarded("Bash")).toBe(false);
  });
});
