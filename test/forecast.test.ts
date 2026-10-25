import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { forecast, moonTurn } from "../src/forecast";
import { state } from "../src/vault";

const TODAY = "2026-10-09";
const on = (f: ReturnType<typeof forecast>, date: string) => f.days.find((d) => d.date === date)!;

describe("forecast", () => {
  const f = forecast(
    {
      people: [
        { name: "Tom", nextBirthday: { date: "2026-10-14", in: 5 } },
        { name: "Marco", nextBirthday: { date: "2026-10-20", in: 11 } },
        { name: "Far Off", nextBirthday: { date: "2027-01-02", in: 85 } },
      ],
      watch: [
        { name: "Marco", why: "birthday", until: "2026-10-20" },
        { name: "Ana", why: "the call", until: "2026-10-14" },
        { name: "Old", why: "long gone", until: "2026-09-01" },
        { name: "Late", why: "just passed", until: "2026-10-07" },
      ],
      now: [{ what: "the dream", run: "/inner-work:jung-therapist", until: new Date("2026-10-14") }],
      experiments: [{ name: "Emergent garden club", listenOn: "2026-10-12" }, { name: "Emergent no date", listenOn: null }],
    },
    TODAY,
  );

  test("fourteen days from today", () => {
    expect([f.days.length, f.days[0]!.date, f.last]).toEqual([14, TODAY, "2026-10-22"]);
  });

  test("a day's weather follows how much it holds", () => {
    expect(on(f, "2026-10-14").events.map((e) => e.kind)).toEqual(["birthday", "watch", "now"]);
    expect(on(f, "2026-10-14").weather).toBe("stormy");
    expect(on(f, "2026-10-12")).toMatchObject({ weather: "fair", events: [{ kind: "listen", what: "Listen back: garden club" }] });
    expect(on(f, "2026-10-10").weather).toBe("clear");
  });

  test("a watch that ends on that person's birthday is said once, as the birthday", () => {
    expect(on(f, "2026-10-20").events.map((e) => e.kind)).toEqual(["birthday"]);
  });

  test("passed dates from the last week are carried over, older ones left out", () => {
    expect(f.carried.map((e) => [e.date, e.name])).toEqual([["2026-10-07", "Late"]]);
  });

  test("the moon turns new and full on the right days", () => {
    expect(moonTurn("2026-10-26")).toBe("full moon");
    expect(moonTurn("2026-11-09")).toBe("new moon");
    expect(moonTurn("2026-10-18")).toBeNull();
  });
});

test("the state carries the forecast", async () => {
  const s = await state(join(import.meta.dir, "fixtures/vault"), TODAY);
  expect(on(s.forecast, "2026-10-12").events.map((e) => e.kind)).toContain("listen");
  expect(on(s.forecast, "2026-10-14").events.some((e) => e.kind === "birthday" && e.name === "Tom Placeholder")).toBe(true);
});
