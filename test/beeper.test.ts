import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { talk, beeperOn, shifts, unread, rhythms } from "../src/beeper";

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

test("shifts: warming, cooling, quiet and waiting, matched and merged with the kin map", () => {
  const file = join(mkdtempSync(join(tmpdir(), "beeper-")), "index.db");
  const db = new Database(file);
  db.run(`create table threads (threadID text primary key, accountID text, thread json)`);
  db.run(`create table participants (account_id text, room_id text, id text, full_name text, nickname text, is_self int, is_network_bot int)`);
  db.run(`create table mx_room_messages (roomID text, timestamp int, isDeleted int, type text, isSentByMe int)`);
  const room = (id: string, name: string, account = "whatsapp.1") => {
    db.run(`insert into threads values (?, ?, ?)`, [id, account, JSON.stringify({ type: "single" })]);
    db.run(`insert into participants values (?, ?, ?, ?, null, 0, 0)`, [account, id, `@${id}`, name]);
  };
  const msgs = (room: string, n: number, daysAgo: number, me = 0) => {
    for (let i = 0; i < n; i++) db.run(`insert into mx_room_messages values (?, ?, 0, 'TEXT', ?)`, [room, NOW - daysAgo * 86_400_000 - i * 1000, me]);
  };
  room("w", "Nova Reyes"); msgs("w", 20, 2, 1); msgs("w", 3, 60);        // 20 now, 1 a month before: warming
  room("c", "Ola Brandt"); msgs("c", 2, 5, 1); msgs("c", 30, 50);        // 2 now, 10 a month before: cooling
  room("q", "Ivo Marsh"); msgs("q", 15, 70, 1);                          // nothing now, 5 a month before: quiet
  room("a", "Mira Solis", "signal.1"); msgs("a", 1, 10, 1); msgs("a", 1, 3);       // she wrote last, 3 days ago
  room("b", "Mira ~ Mãe Solis", "whatsapp.1"); msgs("b", 1, 4);                   // same person on WhatsApp
  db.close();
  const s = shifts([{ name: "Mira Solis", ring: "core" }, { name: "Ivo", ring: "close" }], file, NOW);
  if ("error" in s) throw new Error(s.error);
  expect(s.warming.map((p) => p.name)).toEqual(["Nova Reyes"]);
  expect(s.cooling.map((p) => p.name)).toEqual(["Ola Brandt"]);
  expect(s.quiet.map((p) => [p.name, p.ring])).toEqual([["Ivo", "close"]]);
  expect(s.waiting.map((p) => [p.name, p.ring, p.nets])).toEqual([["Mira Solis", "core", ["signal", "whatsapp"]]]);
});

test("unread: Beeper's count, the newest unread lines and reactions, kin map people only", () => {
  const file = join(mkdtempSync(join(tmpdir(), "beeper-")), "index.db");
  const db = new Database(file);
  db.run(`create table threads (threadID text primary key, accountID text, thread json, timestamp int)`);
  db.run(`create table participants (account_id text, room_id text, id text, full_name text, nickname text, is_self int, is_network_bot int)`);
  db.run(`create table mx_room_messages (roomID text, timestamp int, hsOrder int, isDeleted int, type text, isSentByMe int, text_content text, message json)`);
  const room = (id: string, name: string, thread: object, account = "whatsapp.1", type = "single") => {
    db.run(`insert into threads values (?, ?, ?, ?)`, [id, account, JSON.stringify({ type, ...thread }), NOW]);
    db.run(`insert into participants values (?, ?, ?, ?, null, 0, 0)`, [account, id, `@${id}`, name]);
  };
  let order = 0;
  const msg = (room: string, mins: number, type: string, text: string | null, me = 0, reaction?: string) =>
    db.run(`insert into mx_room_messages values (?, ?, ?, 0, ?, ?, ?, ?)`,
      [room, NOW - mins * 60_000, ++order, type, me, text, JSON.stringify(reaction ? { action: { reactionKey: reaction } } : {})]);
  room("a", "Mira Solis", { unreadCount: 3, lastReadMessageSortKey: 1 });
  msg("a", 60, "TEXT", "read already");                 // order 1, read
  msg("a", 30, "TEXT", "are you free sunday?");
  msg("a", 20, "IMAGE", null);
  msg("a", 10, "REACTION", null, 0, "❤️");
  room("b", "Nova Reyes", { unreadCount: 0 });           // all read: not shown
  msg("b", 5, "TEXT", "hi");
  room("c", "Ola Brandt", { unreadCount: 0, isMarkedUnread: true }, "signal.1");
  room("g", "Group", { unreadCount: 9 }, "whatsapp.1", "group");
  msg("g", 1, "TEXT", "group chatter");
  room("s", "Some Stranger", { unreadCount: 2 });        // not on the kin map: not shown
  msg("s", 2, "TEXT", "hello?");
  db.close();
  const u = unread([{ name: "Ola Brandt", ring: "warm" }, { name: "Mira Solis", ring: "close" }], file, NOW);
  if ("error" in u) throw new Error(u.error);
  expect(u.chats.map((c) => [c.name, c.ring, c.count])).toEqual([["Ola Brandt", "warm", 1], ["Mira Solis", "close", 3]]);
  const mira = u.chats[1]!;
  expect(mira.messages.map((m) => m.text)).toEqual(["are you free sunday?", "📷 photo"]);
  expect(mira.reactions).toEqual(["❤️"]);
  expect(mira.last).toBe(NOW - 10 * 60_000);
});

test("rhythms: their hours, and how fast each side answers, kin only", () => {
  const file = join(mkdtempSync(join(tmpdir(), "beeper-")), "index.db");
  const db = new Database(file);
  db.run(`create table threads (threadID text primary key, accountID text, thread json)`);
  db.run(`create table participants (account_id text, room_id text, id text, full_name text, nickname text, is_self int, is_network_bot int)`);
  db.run(`create table mx_room_messages (roomID text, timestamp int, isDeleted int, type text, isSentByMe int)`);
  for (const [id, name] of [["a", "Ada Lovelace"], ["s", "Stranger"]] as const) {
    db.run(`insert into threads values (?, 'signal.1', ?)`, [id, JSON.stringify({ type: "single" })]);
    db.run(`insert into participants values ('signal.1', ?, ?, ?, null, 0, 0)`, [id, `@${id}`, name]);
  }
  const msg = (room: string, at: number, me: number) => db.run(`insert into mx_room_messages values (?, ?, 0, 'TEXT', ?)`, [room, at, me]);
  // Twenty evenings: Alex writes at 20:00 local, Ada answers 10 minutes later, Alex answers her an hour after that.
  for (let d = 1; d <= 20; d++) {
    const eve = new Date(NOW - d * 86_400_000); eve.setHours(20, 0, 0, 0);
    msg("a", eve.getTime(), 1); msg("a", eve.getTime() + 10 * 60_000, 0); msg("a", eve.getTime() + 70 * 60_000, 1);
    msg("s", eve.getTime(), 0);
  }
  db.close();
  const at = new Date(NOW); at.setHours(20, 30, 0, 0);
  const r = rhythms([{ name: "Ada Lovelace", ring: "core" }], file, at.getTime());
  if ("error" in r) throw new Error(r.error);
  expect(r.people.map((p) => p.name)).toEqual(["Ada Lovelace"]);
  const ada = r.people[0]!;
  expect([ada.n, ada.hours[20], ada.theyAnswer, ada.youAnswer]).toEqual([20, 20, 10, 60]);
  expect(ada.peak.from <= 20 && ada.peak.to > 20).toBe(true);
  expect(r.around).toEqual(["Ada Lovelace"]);
  const morning = new Date(NOW); morning.setHours(8, 0, 0, 0);
  const m = rhythms([{ name: "Ada Lovelace", ring: "core" }], file, morning.getTime());
  expect("error" in m ? m.error : m.around).toEqual([]);
});
