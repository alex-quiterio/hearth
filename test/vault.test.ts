import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { state, md, servers, birthdayOf } from "../src/vault";

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

  test("birthdays become MM-DD, in English or Portuguese, and only when a day and month follow", () => {
    expect([person("Tom Placeholder").birthday, person("Marco Silent").birthday, person("Lena").birthday]).toEqual(["10-14", "01-02", null]);
    expect(birthdayOf("🎂 29 Feb")).toBe("02-29");
    expect(birthdayOf("faz anos a 3 de Março")).toBe("03-03");
    expect(birthdayOf("aniversário 31 Out")).toBe("10-31");
    expect(birthdayOf("his birthday message on 16 Oct")).toBeNull();
    expect(birthdayOf("a birthday at Rosa's Cantina")).toBeNull();
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
    expect(s.config.now).toEqual([{ what: "the dream of water", why: "still untold", run: "/inner-work:jung-therapist", until: "2026-10-20" }]);
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
    expect(s.thinking.days).toEqual(["2026-10-09", "2026-10-08", "2026-10-07", "2026-10-06"]);
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
    expect(empty.thinking).toMatchObject({ exists: false, recent: "", spells: [], experiments: [], days: [] });
    expect(empty.config.panels).toContain("thinking");
  });
});

describe("inner screen", () => {
  test("proprioception moments, newest first, without the template's placeholder", () => {
    const p = s.innerScreen.proprioception!;
    expect(p.count).toBe(2);
    expect(p.moments.map((m) => [m.date, m.title])).toEqual([
      ["2026-10-09", "a message left unread"],
      ["2026-10-02", "the meeting ran long"],
    ]);
    expect(p.weekly).toContain("the body registers first");
    expect(p.days).toEqual(["2026-10-09", "2026-10-02"]);
  });

  test("the coordination partner note and the thinking outputs in Rough Notes", () => {
    expect(s.innerScreen.coordination?.sections.map((x) => x.heading)).toEqual(["Active"]);
    expect(s.innerScreen.notes.map((n) => n.kind).sort()).toEqual(["Emergent", "Emergent", "Visionary fiction"]);
  });

  test("an empty vault has an empty inner screen", async () => {
    const empty = await state(join(import.meta.dir, "fixtures/nowhere"));
    expect(empty.innerScreen).toEqual({ proprioception: null, coordination: null, notes: [] });
  });
});

test("wiki links open in Obsidian", () => {
  expect(md("see [[Ana Exemplo]]")).toContain('href="obsidian://open?vault=pandora&amp;file=Ana%20Exemplo"');
});

describe("embers", () => {
  test("gathers dated entries from every log, oldest first", () => {
    expect(new Set(s.embers.map((e) => e.kind))).toEqual(new Set(["moment", "practice", "spell", "tending"]));
    expect(s.embers.map((e) => e.date)).toEqual([...s.embers.map((e) => e.date)].sort());
  });

  test("a tending entry is dated by its outcome when it has one", () => {
    expect(s.embers.find((e) => e.title === "Carrying · Rui Teste")?.date).toBe("2026-10-07");
    expect(s.embers.find((e) => e.title === "Growing · Sol Novo")?.date).toBe("2026-10-06");
  });

  test("the template placeholder is not an ember", () => {
    expect(s.embers.some((e) => /YYYY/.test(e.date + e.title))).toBe(false);
  });
});

test("servers: hosts in order, made https origins, duplicates and junk dropped", () => {
  expect(servers(["one.example.ts.net", "https://two.example.ts.net/", "one.example.ts.net", "http://127.0.0.1:4747", "::bad::"])).toEqual([
    "https://one.example.ts.net",
    "https://two.example.ts.net",
    "http://127.0.0.1:4747",
  ]);
  expect(servers(undefined)).toEqual([]);
  expect(servers("solo.example.ts.net")).toEqual(["https://solo.example.ts.net"]);
});
