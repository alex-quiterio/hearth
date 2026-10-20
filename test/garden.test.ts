import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { state, kinState, kinPeople } from "../src/vault";
import { garden, isoWeek, mapDate, thirstOf, threadState, waterPlant } from "../src/garden";

const FIXTURE = join(import.meta.dir, "fixtures/vault");
const TODAY = "2026-10-09";
const plant = (s: Awaited<ReturnType<typeof state>>, name: string) => s.garden.plants.find((p) => p.name === name)!;

describe("pieces", () => {
  test("thirst is days over the bed's interval", () => {
    expect([thirstOf(null, 7), thirstOf(2, 7), thirstOf(7, 7), thirstOf(10, 7), thirstOf(20, 7)]).toEqual([
      "unknown",
      "fresh",
      "ok",
      "thirsty",
      "wilting",
    ]);
  });

  test("kin map phrases become dates, never in the future", () => {
    expect(mapDate("pinned, last talked 4 Oct.", TODAY)).toBe("2026-10-04");
    expect(mapDate("talked 18 Dec", TODAY)).toBe("2025-12-18");
    expect(mapDate("since April", TODAY)).toBeNull();
  });

  test("a thread's last recorded state wins", () => {
    expect(threadState("Estado: **not sent**\n\nEstado actualizado: **enviada** (texto)")).toBe("sent");
    expect(threadState("Estado: **all chunks sent**, às 00:16")).toBe("sent");
    expect(threadState("Estado: **rascunho, não enviado**")).toBe("draft");
    expect(threadState("no state here")).toBeNull();
  });

  test("ISO weeks", () => {
    expect(isoWeek("2026-10-09")).toBe("2026-W41");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
  });
});

describe("the garden", async () => {
  const s = await state(FIXTURE, TODAY);

  test("this week is the latest tending block within six days", () => {
    expect(s.garden.week?.heading).toBe("2026-W41 · 2026-10-06");
    expect(s.garden.thisWeek.map((e) => [e.name, e.kind, e.done])).toEqual([
      ["Sol Novo", "Growing", false],
      ["Inês Feijão", "Carrying", false],
      ["Rui Teste", "Carrying", true],
    ]);
    expect(s.garden.thisWeek[0]!.gesture).toBe("ask about the Friday class.");
  });

  test("last water comes from the newest source", () => {
    expect(plant(s, "Rui Teste")).toMatchObject({ lastTended: "2026-10-07", lastTendedFrom: "tending", thirst: "fresh" });
    expect(plant(s, "Marco Silent")).toMatchObject({ lastTended: "2026-09-30", lastTendedFrom: "tending" });
    expect(plant(s, "Ana Exemplo")).toMatchObject({ lastTended: "2026-09-20", lastTendedFrom: "thread", thirst: "wilting" });
    expect(plant(s, "Lena")).toMatchObject({ lastTended: null, thirst: "unknown" });
  });

  test("pinned, watched and this week's plants are marked", () => {
    expect(plant(s, "Ana Exemplo").pinned).toBe("the call keeps slipping");
    expect(plant(s, "Marco Silent").watch).toEqual({ why: "birthday", until: "2026-10-20" });
    expect(plant(s, "Sol Novo").thisWeek).toBe(true);
    expect(plant(s, "Lena").thisWeek).toBe(false);
  });

  test("rhythm covers the last seven days", () => {
    expect(s.garden.rhythm.map((r) => r.date)).toEqual([
      "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09",
    ]);
    expect(s.garden.rhythm.filter((r) => r.active).map((r) => r.date)).toEqual(["2026-10-06", "2026-10-07"]);
  });
});

describe("each person's clocks", () => {
  const KIN = "4 - Archive/kin/Kin map.md";
  const NOW = Date.parse("2026-10-09T12:00:00");
  const H = 3_600_000;

  test("every and reply within segments set the pace and leave the note", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hearth-"));
    await cp(FIXTURE, dir, { recursive: true });
    const map = await Bun.file(join(dir, KIN)).text();
    await Bun.write(join(dir, KIN), map.replace("Lena · ✈️ far (Berlin) · postcards.", "Lena · ✈️ far (Berlin) · every 3 weeks · reply within a day · postcards."));
    const lena = kinPeople(await kinState(dir)).find((p) => p.name === "Lena")!;
    expect(lena).toMatchObject({ every: 21, replyWithin: 1, note: "postcards." });
    const ana = kinPeople(await kinState(dir)).find((p) => p.name === "Ana Exemplo")!;
    expect(ana).toMatchObject({ every: null, replyWithin: null, woe: "weekly call" });
  });

  test("their unanswered message runs the reply clock; the worse clock shows", async () => {
    const people = kinPeople(await kinState(FIXTURE)).map((p) =>
      p.name === "Rui Teste" ? { ...p, replyWithin: 1 } : p.name === "Lena" ? { ...p, replyWithin: 7 } : p,
    );
    const chats = [
      { kin: "Rui Teste", lastSent: NOW - 72 * H, lastReceived: NOW - 30 * H }, // 30h on a 1 day window
      { kin: "Lena", lastSent: NOW - 72 * H, lastReceived: NOW - 30 * H }, // 30h on a week
      { kin: "Tom Placeholder", lastSent: NOW - 2 * H, lastReceived: NOW - 30 * H }, // answered
    ];
    const g = await garden(FIXTURE, people, { pinned: [], watch: [] }, TODAY, chats, NOW);
    const p = (n: string) => g.plants.find((x) => x.name === n)!;
    // Rui was tended 2 days ago (fresh by pace), but his message is overdue.
    expect(p("Rui Teste")).toMatchObject({ waitingSince: NOW - 30 * H, thirst: "thirsty" });
    expect(p("Lena")).toMatchObject({ lastTended: "2026-10-06", lastTendedFrom: "beeper", replyWithin: 7, thirst: "fresh" });
    expect(p("Tom Placeholder")).toMatchObject({ waitingSince: null, lastTendedFrom: "beeper", replyWithin: 5, thirst: "fresh" }); // close ring's window
  });
});

describe("watering", () => {
  async function copy() {
    const dir = await mkdtemp(join(tmpdir(), "hearth-"));
    await cp(FIXTURE, dir, { recursive: true });
    const people = kinPeople(await kinState(dir));
    return { dir, who: (n: string) => people.find((p) => p.name === n)! };
  }
  const log = (dir: string) => Bun.file(join(dir, "4 - Archive/kin/Tending log.md")).text();

  test("fills this week's empty outcome", async () => {
    const { dir, who } = await copy();
    await waterPlant(dir, who("Sol Novo"), "she is in", TODAY);
    expect(await log(dir)).toContain("Gesture: ask about the Friday class. Outcome: tended 2026-10-09, she is in.");
    const s = await state(dir, TODAY);
    expect(s.garden.thisWeek[0]!.done).toBe(true);
    expect(plant(s, "Sol Novo")).toMatchObject({ lastTended: "2026-10-09", thirst: "fresh" });
  });

  test("someone outside this week gets a Tended line in this week's block", async () => {
    const { dir, who } = await copy();
    await waterPlant(dir, who("Lena"), "", TODAY);
    const text = await log(dir);
    expect(text).toContain("- **Carrying · Rui Teste** (🌳). Gesture: Sunday lunch. Outcome: went, 2026-10-07.\n- **Tended · Lena** 2026-10-09, from Hearth.");
    expect(text).toContain("updated: 2026-10-09");
    const s = await state(dir, TODAY);
    expect(plant(s, "Lena")).toMatchObject({ lastTended: "2026-10-09", lastTendedFrom: "water" });
    expect(s.garden.thisWeek.map((e) => e.name)).not.toContain("Lena");
  });

  test("with no block this week, starts a small one", async () => {
    const { dir, who } = await copy();
    await waterPlant(dir, who("Ana Exemplo"), "", "2026-10-20");
    expect(await log(dir)).toContain("## 2026-W43 · 2026-10-20\n\nTended from Hearth, between tending runs.\n\n- **Tended · [[Ana Exemplo]]** 2026-10-20, from Hearth.");
  });

  test("an already filled outcome is never overwritten", async () => {
    const { dir, who } = await copy();
    await waterPlant(dir, who("Rui Teste"), "", TODAY);
    const text = await log(dir);
    expect(text).toContain("Outcome: went, 2026-10-07.");
    expect(text).toContain("- **Tended · Rui Teste** 2026-10-09, from Hearth.");
  });
});
