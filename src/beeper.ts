import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Who Alex talks to, counted from Beeper Desktop's local index. Read only, counts and
// timestamps only: the one exception is unread(), which passes the text of unread direct
// messages to the Talk screen and stores nothing. Direct chats only; reactions,
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
           sum(m.timestamp > ?1) recent, sum(m.timestamp <= ?1 and m.timestamp > ?2) prior,
           max(case when m.isSentByMe = 1 then m.timestamp end) lastSent,
           max(case when m.isSentByMe = 0 then m.timestamp end) lastReceived
         from mx_room_messages m join threads t on t.threadID = m.roomID
         where json_extract(t.thread, '$.type') = 'single' and m.timestamp > ?3 and m.isDeleted = 0
           and m.type in (${SPOKEN.map((_, i) => `?${i + 4}`).join(",")})
         group by m.roomID`,
      )
      // The shift counts look back four months; last contact looks back a year, so slow kin still show a date.
      .all(now - MONTH, now - 4 * MONTH, now - 12 * MONTH, ...SPOKEN) as ShiftRow[];
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

// ---- New messages: direct chats Beeper counts as unread ------------------------------------
// Kin map people only. The count is Beeper's own, so it matches the badge there; the lines are
// the newest unread ones.

export type NewMessage = { at: number; type: string; text: string };
export type Unread = {
  name: string;
  nets: string[];
  ring: string | null;
  kin: string | null;
  count: number; // Beeper's unread count, reactions included
  last: number;
  reactions: string[]; // emoji they reacted with since Alex last read the chat
  messages: NewMessage[]; // oldest first, at most SHOWN
};
export type Unreads = { at: number; chats: Unread[] } | { error: string };

type UnreadRow = { room: string; account: string; name: string | null; count: number | null; readTo: number | null; at: number | null };
type NewRow = { at: number; type: string; text: string | null; reaction: string | null };

const SHOWN = 5;
const MEDIA: Record<string, string> = { IMAGE: "📷 photo", VOICE: "🎤 voice note", AUDIO: "🎵 audio", VIDEO: "🎞 video", FILE: "📎 file", STICKER: "sticker", LOCATION: "📍 location", POLL: "📊 poll" };

export function unread(kin: { name: string; ring: string; aka?: string[] }[] = [], file = BEEPER_DB, now = Date.now()): Unreads {
  let db: Database;
  try {
    db = new Database(file, { readonly: true });
  } catch (e) {
    return { error: `Beeper's index is not readable at ${file}: ${(e as Error).message}` };
  }
  try {
    const rooms = db
      .query(
        `select t.threadID room, t.accountID account,
           (select coalesce(nullif(p.full_name, ''), p.nickname) from participants p
             where p.room_id = t.threadID and coalesce(p.is_self, 0) = 0 and coalesce(p.is_network_bot, 0) = 0 limit 1) name,
           json_extract(t.thread, '$.unreadCount') count, json_extract(t.thread, '$.lastReadMessageSortKey') readTo, t.timestamp at
         from threads t
         where json_extract(t.thread, '$.type') = 'single'
           and (json_extract(t.thread, '$.unreadCount') > 0 or json_extract(t.thread, '$.isMarkedUnread') = 1)`,
      )
      .all() as UnreadRow[];
    const lines = db.query(
      `select timestamp at, type, text_content text, json_extract(message, '$.action.reactionKey') reaction
       from mx_room_messages
       where roomID = ? and isSentByMe = 0 and isDeleted = 0 and hsOrder > ?
         and type in (${[...SPOKEN, "REACTION"].map(() => "?").join(",")})
       order by hsOrder desc limit 40`,
    );
    const match = kinMatch(rooms.flatMap((r) => (r.name ? [r.name] : [])), kin);
    const chats = new Map<string, Unread>();
    for (const r of rooms) {
      const k = r.name ? match(r.name) : null;
      if (!k) continue;
      const rows = (lines.all(r.room, r.readTo ?? 0, ...SPOKEN, "REACTION") as NewRow[]).reverse();
      const id = `kin:${k.name}`;
      const net = r.account.split(".")[0]!;
      const c = chats.get(id) ?? { name: k.name, nets: [], ring: k.ring, kin: k.name, count: 0, last: 0, reactions: [], messages: [] };
      if (!c.nets.includes(NETWORK[net] ?? net)) c.nets.push(NETWORK[net] ?? net);
      // A chat marked unread by hand has no count; it still shows, as one.
      c.count += Math.max(r.count ?? 0, 1);
      c.last = Math.max(c.last, rows.at(-1)?.at ?? r.at ?? 0);
      for (const m of rows) {
        if (m.type === "REACTION") { if (m.reaction) c.reactions.push(m.reaction); continue; }
        c.messages.push({ at: m.at, type: m.type, text: (m.text?.trim() || MEDIA[m.type] || m.type.toLowerCase()).slice(0, 400) });
      }
      chats.set(id, c);
    }
    for (const c of chats.values()) c.messages = c.messages.sort((a, b) => a.at - b.at).slice(-SHOWN);
    return { at: now, chats: [...chats.values()].sort((a, b) => b.last - a.last) };
  } catch (e) {
    return { error: `Beeper's index changed shape: ${(e as Error).message}` };
  } finally {
    db.close();
  }
}

// ---- Rhythms: when each kin person writes, and how fast each side answers ----------------
// Timestamps only, over the last half year. Hours are this Mac's local time.

export type Rhythm = {
  name: string;
  ring: string;
  n: number; // their messages in the window
  hours: number[]; // their messages per hour of the day, 0 to 23
  weekdays: number[]; // their messages per weekday, Sunday first
  peak: { from: number; to: number; share: number }; // the busiest three hours, `to` exclusive
  theyAnswer: number | null; // median minutes from Alex's message to their next one
  youAnswer: number | null; // median minutes from theirs to Alex's next one
  lastReceived: number;
  lift: number; // how much likelier than an even spread they are to write around this hour
};
export type Rhythms = { at: number; hour: number; people: Rhythm[]; around: string[] } | { error: string };

const RHYTHM_DAYS = 182;
const ANSWER_CAP = 3 * 86_400_000; // a gap longer than this is a new conversation, not an answer
const RHYTHM_MIN = 12; // fewer messages than this says nothing about a rhythm

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return Math.round((s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) / 60_000);
};

type RhythmRow = { room: string; name: string | null; at: number; me: number };

export function rhythms(kin: { name: string; ring: string; aka?: string[] }[] = [], file = BEEPER_DB, now = Date.now()): Rhythms {
  let db: Database;
  try {
    db = new Database(file, { readonly: true });
  } catch (e) {
    return { error: `Beeper's index is not readable at ${file}: ${(e as Error).message}` };
  }
  try {
    const rows = db
      .query(
        `select m.roomID room,
           (select coalesce(nullif(p.full_name, ''), p.nickname) from participants p
             where p.room_id = m.roomID and coalesce(p.is_self, 0) = 0 and coalesce(p.is_network_bot, 0) = 0 limit 1) name,
           m.timestamp at, m.isSentByMe me
         from mx_room_messages m join threads t on t.threadID = m.roomID
         where json_extract(t.thread, '$.type') = 'single' and m.timestamp > ? and m.isDeleted = 0
           and m.type in (${SPOKEN.map(() => "?").join(",")})
         order by m.roomID, m.timestamp`,
      )
      .all(now - RHYTHM_DAYS * 86_400_000, ...SPOKEN) as RhythmRow[];
    const match = kinMatch([...new Set(rows.flatMap((r) => (r.name ? [r.name] : [])))], kin);
    type Acc = { ring: string; hours: number[]; weekdays: number[]; they: number[]; you: number[]; lastReceived: number };
    const acc = new Map<string, Acc>();
    let prev: RhythmRow | null = null;
    for (const r of rows) {
      const k = r.name ? match(r.name) : null;
      if (prev?.room !== r.room) prev = null;
      if (!k) { prev = r; continue; }
      const a = acc.get(k.name) ?? { ring: k.ring, hours: Array(24).fill(0), weekdays: Array(7).fill(0), they: [], you: [], lastReceived: 0 };
      if (!r.me) {
        const d = new Date(r.at);
        a.hours[d.getHours()]++;
        a.weekdays[d.getDay()]++;
        a.lastReceived = Math.max(a.lastReceived, r.at);
      }
      // The first message after the other side's: an answer, timed from their last line.
      if (prev && prev.me !== r.me && r.at - prev.at <= ANSWER_CAP) (r.me ? a.you : a.they).push(r.at - prev.at);
      acc.set(k.name, a);
      prev = r;
    }
    const hour = new Date(now).getHours();
    const people: Rhythm[] = [];
    for (const [name, a] of acc) {
      const n = a.hours.reduce((x, y) => x + y, 0);
      if (n < RHYTHM_MIN) continue;
      const three = (h: number) => a.hours[h % 24]! + a.hours[(h + 1) % 24]! + a.hours[(h + 2) % 24]!;
      const from = [...Array(24).keys()].reduce((best, h) => (three(h) > three(best) ? h : best), 0);
      const around = three((hour + 23) % 24); // this hour and one either side
      people.push({
        name, ring: a.ring, n, hours: a.hours, weekdays: a.weekdays,
        peak: { from, to: (from + 3) % 24, share: Math.round((three(from) / n) * 100) / 100 },
        theyAnswer: median(a.they), youAnswer: median(a.you), lastReceived: a.lastReceived,
        lift: Math.round((around / n / (3 / 24)) * 10) / 10,
      });
    }
    people.sort((a, b) => b.lift - a.lift || b.n - a.n);
    // Around now: wrote in the last quarter hour, or this hour is well inside their usual ones.
    const around = people.filter((p) => now - p.lastReceived < 15 * 60_000 || (p.lift >= 1.5 && p.n >= 20)).map((p) => p.name);
    return { at: now, hour, people, around };
  } catch (e) {
    return { error: `Beeper's index changed shape: ${(e as Error).message}` };
  } finally {
    db.close();
  }
}
