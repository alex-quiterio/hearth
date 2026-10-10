import { expect, test } from "bun:test";
import { join } from "node:path";
import { menu, hint } from "../src/menu";

const groups = await menu(join(import.meta.dir, "fixtures/plugins"));

test("groups follow the buchecha order, unknown plugins last", () => {
  expect(groups.map((g) => g.plugin)).toEqual(["thinking", "kin", "zines"]);
  expect(groups[1]!.icon).toBe("🫂");
});

test("each skill becomes a command with its first sentence as the hint", () => {
  expect(groups[1]!.items).toEqual([
    { command: "/kin:map", name: "map", hint: "Map the network into rings." },
    { command: "/kin:tend", name: "tend", hint: "A weekly tending ritual for friendships." },
  ]);
  expect(groups[0]!.items[0]).toMatchObject({ command: "/thinking:emergent-practice", name: "emergent practice" });
  expect(groups[2]!.items[0]!.hint).toBe("");
});

test("a missing checkout means an empty menu", async () => {
  expect(await menu(join(import.meta.dir, "fixtures/nowhere"))).toEqual([]);
});

test("long hints are cut to one line", () => {
  expect(hint("x".repeat(200)).length).toBe(140);
});
