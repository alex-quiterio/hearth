import { describe, expect, test } from "bun:test";
import { parseNote } from "../src/shared/note";
import type { WritableVault } from "../src/vault/vault";
import { PATHS } from "../src/vault/layout";
import { recordTended, parseTending } from "../src/tending/tending-log";
import { growGarden } from "../src/garden/garden";
import { parsePerson } from "../src/kin/person";
import { dashboard } from "../src/app/dashboard";
import { tend } from "../src/app/tend";

// The domain needs no filesystem, and the application runs over any Vault.

/** A vault held in memory: path → text. */
function memoryVault(files: Record<string, string>): WritableVault & { files_: Record<string, string> } {
  const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
  return {
    root: "/memory",
    files_: files,
    async note(rel) {
      return rel in files ? parseNote(files[rel]!, 0) : null;
    },
    async text(rel) {
      return files[rel] ?? null;
    },
    async files(dir, match) {
      return Object.keys(files).filter((p) => dirOf(p) === dir).map((p) => p.slice(dir.length + 1)).filter((n) => !match || match.test(n));
    },
    async mtime() {
      return 0;
    },
    async write(rel, text) {
      files[rel] = text;
    },
  };
}

const LOG = "---\nupdated: 2026-10-01\n---\n# Tending log\n\n## 2026-W41 · 2026-10-06\n\n- **Growing · Sol** Gesture: ask about the class. Outcome:\n";

describe("pure domain", () => {
  test("recording a tending fills the empty outcome, text in, text out", () => {
    const out = recordTended(LOG, { name: "Sol", linked: false }, "she is in", "2026-10-09");
    expect(out).toContain("Outcome: tended 2026-10-09, she is in.");
    expect(out).toContain("updated: 2026-10-09");
    expect(parseTending(out)[0]!.entries[0]!.outcome).toBe("tended 2026-10-09, she is in.");
  });

  test("the garden grows from what it is handed", () => {
    const sol = parsePerson("Sol · 🌳 land · new here.", "new");
    const g = growGarden({
      people: [sol],
      tending: parseTending(recordTended(LOG, sol, "", "2026-10-09")),
      conversations: [],
      attention: { pinned: [{ name: "sol", why: "new" }], watch: [] },
      today: "2026-10-09",
      now: Date.parse("2026-10-09T12:00:00"),
    });
    expect(g.plants[0]).toMatchObject({ lastTended: "2026-10-09", lastTendedFrom: "tending", thirst: "fresh", thisWeek: true, pinned: "new" });
    expect(g.thisWeek[0]).toMatchObject({ name: "Sol", done: true, place: "land" });
  });
});

describe("over a vault in memory", () => {
  const files = () => ({
    [PATHS.kinMap]: "# Kin map\n\n## 🌱 New\n\n- Sol · 🌳 land · new here.\n",
    [PATHS.tendingLog]: LOG,
    [`${PATHS.conversations}/Sol.md`]: "## 2026-10-08\n#### Sol (WhatsApp, 1:1), the class\nEstado: **not sent**\n",
  });

  test("the dashboard reads it", async () => {
    const s = await dashboard(memoryVault(files()), "2026-10-09", () => []);
    expect(s.kin.exists && s.kin.rings[0]!.people[0]).toMatchObject({ name: "Sol", lastThread: "2026-10-08", draftsWaiting: 1 });
    expect(s.drafts).toEqual([{ name: "Sol", date: "2026-10-08", title: "the class" }]);
    expect(s.garden.thisWeek[0]!.html).toContain("<strong>Growing · Sol</strong>");
  });

  test("tending writes only the tending log", async () => {
    const v = memoryVault(files());
    const before = { ...v.files_ };
    expect(await tend(v, "Sol", "")).toBe(true);
    expect(await tend(v, "Nobody", "")).toBe(false);
    for (const [p, t] of Object.entries(before)) if (p !== PATHS.tendingLog) expect(v.files_[p]).toBe(t);
    expect(v.files_[PATHS.tendingLog]).toMatch(/- \*\*Tended · Sol\*\* \d{4}-\d{2}-\d{2}, from Hearth\./);
  });
});
