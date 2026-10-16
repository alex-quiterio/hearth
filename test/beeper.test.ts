import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { talk, beeperOn } from "../src/beeper";

// A tiny Beeper index with just the columns talk() reads.
function fixture() {
  const file = join(mkdtempSync(join(tmpdir(), "beeper-")), "index.db");
  const db = new Database(file);
  db.run(`create table threads (threadID text primary key, accountID text, thread json)`);
  db.run(`create table participants (account_id text, room_id text, id text, full_name text, nickname text, is_self int, is_network_bot int)`);
  db.run(`create table mx_room_messages (roomID text, timestamp int, isDeleted int, type text, isSentByMe int)`);
  const room = (id: string, account: string, type: string, name: string) => {
    db.run(`insert into threads values (?, ?, ?)`, [id, account, JSON.stringify({ type })]);
    db.run(`insert into participants values (?, ?, 'me', 'Alex', null, 1, 0)`, [account, id]);
    db.run(`insert into participants values (?, ?, ?, ?, null, 0, 0)`, [account, id, `@${id}`, name]);
  };
  const msg = (room: string, daysAgo: number, me: number, type = "TEXT") =>
    db.run(`insert into mx_room_messages values (?, ?, 0, ?, ?)`, [room, NOW - daysAgo * 86_400_000, type, me]);
  room("a", "signal.1", "single", "Ada Lovelace");
  room("b", "whatsapp.1", "single", "Ada Lovelace");
  room("c", "instagramgo.1", "single", "Mira");
  room("g", "whatsapp.1", "group", "Group");
  msg("a", 1, 1); msg("a", 2, 0); msg("b", 3, 0); msg("b", 3, 0, "REACTION");
  msg("c", 10, 1); msg("c", 200, 1);
  msg("g", 1, 0);
  db.close();
  return file;
}
const NOW = Date.parse("2026-10-16T12:00:00Z");

test("counts direct messages per person, merging networks and skipping reactions and groups", () => {
  const t = talk(90, fixture(), NOW);
  if ("error" in t) throw new Error(t.error);
  expect(t.people).toEqual([
    { name: "Ada Lovelace", nets: ["signal", "whatsapp"], sent: 1, received: 2, total: 3, last: NOW - 86_400_000 },
    { name: "Mira", nets: ["instagram"], sent: 1, received: 0, total: 1, last: NOW - 10 * 86_400_000 },
  ]);
});

test("the window drops older messages", () => {
  const t = talk(5, fixture(), NOW);
  if ("error" in t) throw new Error(t.error);
  expect(t.people.map((p) => p.name)).toEqual(["Ada Lovelace"]);
});

test("a missing index is an error, not a crash", () => {
  expect(talk(90, "/nonexistent/index.db")).toHaveProperty("error");
});

test("Beeper is off when its index is missing or HEARTH_BEEPER=off", () => {
  const file = fixture();
  expect(beeperOn(file)).toBe(true);
  expect(beeperOn("/nonexistent/index.db")).toBe(false);
  process.env.HEARTH_BEEPER = "off";
  try {
    expect(beeperOn(file)).toBe(false);
  } finally {
    delete process.env.HEARTH_BEEPER;
  }
});
