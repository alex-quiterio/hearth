import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Who Alex talks to, counted from Beeper Desktop's local index. Read only, counts and
// timestamps only: no message text leaves the database. Direct chats only; reactions,
// membership and hidden events do not count as talking.

export const BEEPER_DB = process.env.HEARTH_BEEPER_DB ?? join(homedir(), "Library/Application Support/BeeperTexts/index.db");

/** The Talk screen is on when Beeper's index is on this machine, unless HEARTH_BEEPER=off. Checked per call, so installing Beeper turns it on. */
export const beeperOn = (file = BEEPER_DB) => process.env.HEARTH_BEEPER !== "off" && existsSync(file);

const SPOKEN = ["TEXT", "IMAGE", "VOICE", "AUDIO", "VIDEO", "FILE", "STICKER", "LOCATION", "POLL"];
const NETWORK: Record<string, string> = { instagramgo: "instagram" };

export type Talker = { name: string; nets: string[]; sent: number; received: number; total: number; last: number };
export type Talk = { days: number; at: number; people: Talker[] } | { error: string };

type Row = { room: string; account: string; name: string | null; sent: number; n: number; last: number };

// One person on several networks (the same name on Signal and WhatsApp) is one person.
const key = (name: string) =>
  name.normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim().toLowerCase() || name;

export function talk(days: number, file = BEEPER_DB, now = Date.now()): Talk {
  let db: Database;
  try {
    db = new Database(file, { readonly: true });
  } catch (e) {
    return { error: `Beeper's index is not readable at ${file}: ${(e as Error).message}` };
  }
  try {
    const rows = db
      .query(
        `select m.roomID room, t.accountID account,
           (select coalesce(nullif(p.full_name, ''), p.nickname) from participants p
             where p.room_id = m.roomID and coalesce(p.is_self, 0) = 0 and coalesce(p.is_network_bot, 0) = 0 limit 1) name,
           sum(m.isSentByMe) sent, count(*) n, max(m.timestamp) last
         from mx_room_messages m join threads t on t.threadID = m.roomID
         where json_extract(t.thread, '$.type') = 'single' and m.timestamp > ? and m.isDeleted = 0
           and m.type in (${SPOKEN.map(() => "?").join(",")})
         group by m.roomID`,
      )
      .all(now - days * 86_400_000, ...SPOKEN) as Row[];
    const people = new Map<string, Talker>();
    for (const r of rows) {
      if (!r.name) continue;
      const net = r.account.split(".")[0]!;
      const p = people.get(key(r.name)) ?? { name: r.name, nets: [], sent: 0, received: 0, total: 0, last: 0 };
      if (!p.nets.includes(NETWORK[net] ?? net)) p.nets.push(NETWORK[net] ?? net);
      p.sent += r.sent;
      p.received += r.n - r.sent;
      p.total += r.n;
      p.last = Math.max(p.last, r.last);
      people.set(key(r.name), p);
    }
    return { days, at: now, people: [...people.values()].sort((a, b) => b.total - a.total) };
  } catch (e) {
    return { error: `Beeper's index changed shape: ${(e as Error).message}` };
  } finally {
    db.close();
  }
}

// ---- Shifts: who is warming, cooling, gone quiet, or waiting on a reply -------------------
// This month (the last 30 days) against the usual month over the 90 days before it.

const MONTH = 30 * 86_400_000;
export type Shift = {
  name: string;
  nets: string[];
  ring: string | null; // the kin map ring, when this person is on the map
  kin: string | null; // their name on the kin map
  recent: number; // messages in the last 30 days
  usual: number; // messages per 30 days over the 90 days before
  lastSent: number;
  lastReceived: number;
};
export type Shifts =
  | { at: number; warming: Shift[]; cooling: Shift[]; quiet: Shift[]; waiting: Shift[]; all: Shift[] }
  | { error: string };

type ShiftRow = { account: string; name: string | null; recent: number; prior: number; lastSent: number | null; lastReceived: number | null };

/** The kin map name for a Beeper name: the same name or an alias, every word of the map name, or a first name only one Beeper person has. */
export function kinMatch(names: string[], kin: { name: string; ring: string; aka?: string[] }[]) {
  const words = (s: string) => key(s).split(" ").filter(Boolean);
  const firsts = new Map<string, number>();
  for (const n of names) firsts.set(words(n)[0] ?? "", (firsts.get(words(n)[0] ?? "") ?? 0) + 1);
  return (name: string) => {
    const w = words(name);
    return (
      kin.find((k) => key(k.name) === key(name) || k.aka?.some((a) => key(a) === key(name))) ??
      kin.find((k) => words(k.name).length > 1 && words(k.name).every((x) => w.includes(x))) ??
      kin.find((k) => words(k.name).length === 1 && words(k.name)[0] === w[0] && firsts.get(w[0]!) === 1) ??
      null
    );
  };
}

export function shifts(kin: { name: string; ring: string; aka?: string[] }[] = [], file = BEEPER_DB, now = Date.now()): Shifts {
  let db: Database;
  try {
    db = new Database(file, { readonly: true });
  } catch (e) {
    return { error: `Beeper's index is not readable at ${file}: ${(e as Error).message}` };
  }
  try {
    const rows = db
      .query(
        `select t.accountID account,
           (select coalesce(nullif(p.full_name, ''), p.nickname) from participants p
             where p.room_id = m.roomID and coalesce(p.is_self, 0) = 0 and coalesce(p.is_network_bot, 0) = 0 limit 1) name,
           sum(m.timestamp > ?1) recent, sum(m.timestamp <= ?1) prior,
           max(case when m.isSentByMe = 1 then m.timestamp end) lastSent,
           max(case when m.isSentByMe = 0 then m.timestamp end) lastReceived
         from mx_room_messages m join threads t on t.threadID = m.roomID
         where json_extract(t.thread, '$.type') = 'single' and m.timestamp > ?2 and m.isDeleted = 0
           and m.type in (${SPOKEN.map((_, i) => `?${i + 3}`).join(",")})
         group by m.roomID`,
      )
      .all(now - MONTH, now - 4 * MONTH, ...SPOKEN) as ShiftRow[];
    const people = new Map<string, Shift & { prior: number }>();
    for (const r of rows) {
      if (!r.name) continue;
      const net = r.account.split(".")[0]!;
      const p = people.get(key(r.name)) ?? { name: r.name, nets: [], ring: null, kin: null, recent: 0, usual: 0, prior: 0, lastSent: 0, lastReceived: 0 };
      if (!p.nets.includes(NETWORK[net] ?? net)) p.nets.push(NETWORK[net] ?? net);
      p.recent += r.recent;
      p.prior += r.prior;
      p.lastSent = Math.max(p.lastSent, r.lastSent ?? 0);
      p.lastReceived = Math.max(p.lastReceived, r.lastReceived ?? 0);
      people.set(key(r.name), p);
    }
    // Two Beeper names for one kin map person (a mother on Signal and on WhatsApp) are one person.
    const match = kinMatch([...people.values()].map((p) => p.name), kin);
    const merged = new Map<string, Shift & { prior: number }>();
    for (const p of people.values()) {
      const k = match(p.name);
      const id = k ? `kin:${k.name}` : key(p.name);
      const m = merged.get(id);
      if (!m) { merged.set(id, { ...p, nets: [...p.nets], name: k?.name ?? p.name, ring: k?.ring ?? null, kin: k?.name ?? null }); continue; }
      for (const n of p.nets) if (!m.nets.includes(n)) m.nets.push(n);
      m.recent += p.recent;
      m.prior += p.prior;
      m.lastSent = Math.max(m.lastSent, p.lastSent);
      m.lastReceived = Math.max(m.lastReceived, p.lastReceived);
    }
    const all = [...merged.values()].map(({ prior, ...p }) => ({ ...p, usual: Math.round((prior / 3) * 10) / 10 }));
    // People on the kin map first, then by how big the shift is.
    const byKin = (a: Shift, b: Shift) => Number(!!b.ring) - Number(!!a.ring);
    const day = 86_400_000;
    return {
      at: now,
      warming: all.filter((p) => p.recent >= 10 && p.recent >= Math.max(2 * p.usual, p.usual + 10))
        .sort((a, b) => byKin(a, b) || b.recent - b.usual - (a.recent - a.usual)),
      cooling: all.filter((p) => p.usual >= 6 && p.recent > 0 && p.recent <= 0.4 * p.usual)
        .sort((a, b) => byKin(a, b) || b.usual - b.recent - (a.usual - a.recent)),
      quiet: all.filter((p) => p.usual >= 4 && p.recent === 0).sort((a, b) => byKin(a, b) || b.usual - a.usual),
      // They wrote last, at least a day ago and within the month, and there is a history between you.
      waiting: all.filter((p) => p.lastReceived > p.lastSent && now - p.lastReceived > day && now - p.lastReceived < MONTH && p.lastSent > 0)
        .sort((a, b) => byKin(a, b) || a.lastReceived - b.lastReceived),
      all,
    };
  } catch (e) {
    return { error: `Beeper's index changed shape: ${(e as Error).message}` };
  } finally {
    db.close();
  }
}
