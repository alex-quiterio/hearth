import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { state, md } from "../src/vault";

const VAULT = join(import.meta.dir, "fixtures/vault");
const s = await state(VAULT);
const people = s.kin.exists ? s.kin.rings.flatMap((r) => r.people) : [];
const person = (name: string) => people.find((p) => p.name === name)!;

describe("kin map", () => {
  test("reads the five rings in order", () => {
    expect(s.kin.exists && s.kin.rings.map((r) => r.key)).toEqual(["core", "close", "warm", "drifting", "new"]);
  });

  test("a ring heading that mentions another ring keeps its own", () => {
    // "Drifting (was close or warm…)" must not land in Close
    expect(person("Marco Silent").ring).toBe("drifting");
  });

  test("names come from wiki links, or plain text before the comma", () => {
    expect(person("Ana Exemplo").linked).toBe(true);
    expect(person("Rui Teste").linked).toBe(false);
  });

  test("place emoji becomes a place key", () => {
    expect(["Ana Exemplo", "Rui Teste", "Tom Placeholder", "Lena"].map((n) => person(n).place)).toEqual([
      "lisbon",
      "land",
      "here",
      "far",
    ]);
  });

  test("weak points and other sections are kept apart from rings", () => {
    expect(s.kin.exists && s.kin.weakPoints?.heading).toMatch(/Weak points/);
    expect(s.kin.exists && s.kin.other.map((o) => o.heading)).toEqual(["New ground"]);
  });
});

describe("conversation signals", () => {
  test("latest thread date and unsent drafts", () => {
    expect(person("Ana Exemplo")).toMatchObject({ lastThread: "2026-09-29", draftsWaiting: 1 });
  });

  test("accented names match files stored in decomposed Unicode", () => {
    expect(person("Inês Feijão")).toMatchObject({ lastThread: "2026-09-25", draftsWaiting: 1 });
  });

  test("no conversation file means no signals", () => {
    expect(person("Lena")).toMatchObject({ lastThread: null, draftsWaiting: 0 });
  });
});

describe("hearth config", () => {
  test("reads pinned, watch, actions and panels from the frontmatter", () => {
    expect(s.config.exists).toBe(true);
    expect(s.config.pinned[0]!.name).toBe("Ana Exemplo");
    expect(s.config.watch[0]!.name).toBe("Marco Silent");
    expect(s.config.actions.map((a) => a.label)).toEqual(["Say hello"]);
    expect(s.config.changes).toContain("demo config");
  });

  test("a missing config falls back to defaults", async () => {
    const empty = await state(join(import.meta.dir, "fixtures/nowhere"));
    expect(empty.config.exists).toBe(false);
    expect(empty.config.panels).toContain("rings");
    expect(empty.kin.exists).toBe(false);
  });
});

describe("inner work and tending", () => {
  test("only the chosen sections are shown", () => {
    expect(s.inner.psychology?.sections.map((x) => x.heading)).toEqual(["Start here next time", "Latest · 2026-10-01"]);
    expect(s.inner.territory?.sections.map((x) => x.heading)).toEqual(["Where he lives now", "Where to walk next"]);
  });

  test("tending shows the latest blocks", () => {
    expect(s.tending?.latest.map((b) => b.heading)).toEqual(["2026-W40 · 2026-09-28", "2026-W41 · 2026-10-06"]);
  });
});

describe("thinking", () => {
  test("reads the practices held, the latest log entries and the spellbook", () => {
    expect(s.thinking.exists).toBe(true);
    expect(s.thinking.practices).toContain("a sit, 5 minutes");
    expect(s.thinking.recent.match(/<li>/g)).toHaveLength(3);
    expect(s.thinking.recent).toContain("the jaw letting go");
    expect(s.thinking.recent).not.toContain("Sit, 3 min");
    expect(s.thinking.spells).toEqual(["Soft hands"]);
  });

  test("woes come from the woe segment in the kin map, kept out of the note", () => {
    expect(s.thinking.woes).toEqual([{ name: "Ana Exemplo", rhythm: "weekly call", place: "lisbon" }]);
    expect(person("Ana Exemplo").note).toBe("old friend, call slipping.");
  });

  test("emergent experiments sort by their listen date", () => {
    expect(s.thinking.experiments.map((e) => [e.name, e.listenOn])).toEqual([
      ["Emergent garden club", "2026-10-12"],
      ["Emergent shared meal", "2026-10-20"],
    ]);
  });

  test("no practice notes means an empty panel, not an error", async () => {
    const empty = await state(join(import.meta.dir, "fixtures/nowhere"));
    expect(empty.thinking).toMatchObject({ exists: false, recent: "", spells: [], experiments: [] });
    expect(empty.config.panels).toContain("thinking");
  });
});

test("wiki links open in Obsidian", () => {
  expect(md("see [[Ana Exemplo]]")).toContain('href="obsidian://open?vault=pandora&amp;file=Ana%20Exemplo"');
});
