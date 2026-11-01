import { DAY_MS } from "../shared/dates";
import { nameKey } from "../shared/names";
import type { KinIdentity } from "../kin/person";
import type { CountRow, ShiftRow, TimestampRow, UnreadLineRow, UnreadRoomRow } from "./beeper-index";
import { addNet, kinMatch, networkOf } from "./kin-match";

// Who Alex talks to, from counts and timestamps only. Pure: each function is handed the index's
// rows and returns what they mean. The one exception to "never the text" is unread(), which passes
// the newest unread lines on to the Talk screen and stores nothing.

// ---- Talk: who he messages most ------------------------------------------------------------

export type Talker = { name: string; nets: string[]; sent: number; received: number; total: number; last: number };

export function countTalkers(rows: CountRow[]): Talker[] {
  const people = new Map<string, Talker>();
  for (const r of rows) {
    if (!r.name) continue;
    const p = people.get(nameKey(r.name)) ?? { name: r.name, nets: [], sent: 0, received: 0, total: 0, last: 0 };
    addNet(p.nets, networkOf(r.account));
    p.sent += r.sent;
    p.received += r.n - r.sent;
    p.total += r.n;
    p.last = Math.max(p.last, r.last);
    people.set(nameKey(r.name), p);
  }
  return [...people.values()].sort((a, b) => b.total - a.total);
}

// ---- Shifts: who is warming, cooling, gone quiet, or waiting on a reply -----------------------
// This month (the last 30 days) against the usual month over the 90 days before it.

export const MONTH_MS = 30 * DAY_MS;

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
export type ShiftsFound = { at: number; warming: Shift[]; cooling: Shift[]; quiet: Shift[]; waiting: Shift[]; all: Shift[] };

type Tally = Shift & { prior: number };

export function findShifts(rows: ShiftRow[], kin: KinIdentity[], now: number): ShiftsFound {
  const people = new Map<string, Tally>();
  for (const r of rows) {
    if (!r.name) continue;
    const p = people.get(nameKey(r.name)) ?? { name: r.name, nets: [], ring: null, kin: null, recent: 0, usual: 0, prior: 0, lastSent: 0, lastReceived: 0 };
    addNet(p.nets, networkOf(r.account));
    p.recent += r.recent;
    p.prior += r.prior;
    p.lastSent = Math.max(p.lastSent, r.lastSent ?? 0);
    p.lastReceived = Math.max(p.lastReceived, r.lastReceived ?? 0);
    people.set(nameKey(r.name), p);
  }
  // Two Beeper names for one kin map person are one person.
  const match = kinMatch([...people.values()].map((p) => p.name), kin);
  const merged = new Map<string, Tally>();
  for (const p of people.values()) {
    const k = match(p.name);
    const id = k ? `kin:${k.name}` : nameKey(p.name);
    const m = merged.get(id);
    if (!m) {
      merged.set(id, { ...p, nets: [...p.nets], name: k?.name ?? p.name, ring: k?.ring ?? null, kin: k?.name ?? null });
      continue;
    }
    for (const n of p.nets) addNet(m.nets, n);
    m.recent += p.recent;
    m.prior += p.prior;
    m.lastSent = Math.max(m.lastSent, p.lastSent);
    m.lastReceived = Math.max(m.lastReceived, p.lastReceived);
  }
  const all = [...merged.values()].map(({ prior, ...p }) => ({ ...p, usual: Math.round((prior / 3) * 10) / 10 }));
  // People on the kin map first, then by how big the shift is.
  const byKin = (a: Shift, b: Shift) => Number(!!b.ring) - Number(!!a.ring);
  return {
    at: now,
    warming: all.filter((p) => p.recent >= 10 && p.recent >= Math.max(2 * p.usual, p.usual + 10))
      .sort((a, b) => byKin(a, b) || b.recent - b.usual - (a.recent - a.usual)),
    cooling: all.filter((p) => p.usual >= 6 && p.recent > 0 && p.recent <= 0.4 * p.usual)
      .sort((a, b) => byKin(a, b) || b.usual - b.recent - (a.usual - a.recent)),
    quiet: all.filter((p) => p.usual >= 4 && p.recent === 0).sort((a, b) => byKin(a, b) || b.usual - a.usual),
    // They wrote last, at least a day ago and within the month, and there is a history between you.
    waiting: all.filter((p) => p.lastReceived > p.lastSent && now - p.lastReceived > DAY_MS && now - p.lastReceived < MONTH_MS && p.lastSent > 0)
      .sort((a, b) => byKin(a, b) || a.lastReceived - b.lastReceived),
    all,
  };
}

// ---- Unread: direct chats Beeper counts as unread ---------------------------------------------
// Kin map people only. The count is Beeper's own, so it matches the badge there.

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

const SHOWN = 5;
const MEDIA: Record<string, string> = { IMAGE: "📷 photo", VOICE: "🎤 voice note", AUDIO: "🎵 audio", VIDEO: "🎞 video", FILE: "📎 file", STICKER: "sticker", LOCATION: "📍 location", POLL: "📊 poll" };

/** linesOf: a room's unread lines after a read marker, newest first. Asked only for kin map people's rooms. */
export function collectUnread(rooms: UnreadRoomRow[], linesOf: (room: string, readTo: number) => UnreadLineRow[], kin: KinIdentity[]): Unread[] {
  const match = kinMatch(rooms.flatMap((r) => (r.name ? [r.name] : [])), kin);
  const chats = new Map<string, Unread>();
  for (const r of rooms) {
    const k = r.name ? match(r.name) : null;
    if (!k) continue;
    const rows = linesOf(r.room, r.readTo ?? 0).reverse();
    const id = `kin:${k.name}`;
    const c = chats.get(id) ?? { name: k.name, nets: [], ring: k.ring, kin: k.name, count: 0, last: 0, reactions: [], messages: [] };
    addNet(c.nets, networkOf(r.account));
    // A chat marked unread by hand has no count; it still shows, as one.
    c.count += Math.max(r.count ?? 0, 1);
    c.last = Math.max(c.last, rows.at(-1)?.at ?? r.at ?? 0);
    for (const m of rows) {
      if (m.type === "REACTION") {
        if (m.reaction) c.reactions.push(m.reaction);
        continue;
      }
      c.messages.push({ at: m.at, type: m.type, text: (m.text?.trim() || MEDIA[m.type] || m.type.toLowerCase()).slice(0, 400) });
    }
    chats.set(id, c);
  }
  for (const c of chats.values()) c.messages = c.messages.sort((a, b) => a.at - b.at).slice(-SHOWN);
  return [...chats.values()].sort((a, b) => b.last - a.last);
}

// ---- Rhythms: when each kin person writes, and how fast each side answers -------------------
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
export type RhythmsFound = { at: number; hour: number; people: Rhythm[]; around: string[] };

export const RHYTHM_DAYS = 182;
const ANSWER_CAP = 3 * DAY_MS; // a gap longer than this is a new conversation, not an answer
const RHYTHM_MIN = 12; // fewer messages than this says nothing about a rhythm

const medianMinutes = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return Math.round((s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) / 60_000);
};

/** rows: every message's time and side, chat by chat in time order. */
export function measureRhythms(rows: TimestampRow[], kin: KinIdentity[], now: number): RhythmsFound {
  const match = kinMatch([...new Set(rows.flatMap((r) => (r.name ? [r.name] : [])))], kin);
  type Acc = { ring: string; hours: number[]; weekdays: number[]; they: number[]; you: number[]; lastReceived: number };
  const acc = new Map<string, Acc>();
  let prev: TimestampRow | null = null;
  for (const r of rows) {
    const k = r.name ? match(r.name) : null;
    if (prev?.room !== r.room) prev = null;
    if (!k) {
      prev = r;
      continue;
    }
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
      theyAnswer: medianMinutes(a.they), youAnswer: medianMinutes(a.you), lastReceived: a.lastReceived,
      lift: Math.round((around / n / (3 / 24)) * 10) / 10,
    });
  }
  people.sort((a, b) => b.lift - a.lift || b.n - a.n);
  // Around now: wrote in the last quarter hour, or this hour is well inside their usual ones.
  const around = people.filter((p) => now - p.lastReceived < 15 * 60_000 || (p.lift >= 1.5 && p.n >= 20)).map((p) => p.name);
  return { at: now, hour, people, around };
}
