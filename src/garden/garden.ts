import { DAY_MS, daysBetween, iso, type IsoDate } from "../shared/dates";
import { byName, sameName } from "../shared/names";
import { mapDate, nextBirthday, type Person } from "../kin/person";
import { sentDates, type Conversation } from "../conversations/thread";
import { currentBlock, isPlanned, tendedOn, type TendingBlock } from "../tending/tending-log";
import { INTERVAL, REPLY_WITHIN, thirstOf, worse } from "./thirst";

// The garden: each person a plant, Alex's attention the water. A pure domain service:
// it is handed everything it reads and returns the garden, markdown unrendered.
//
// Two clocks run per plant. The pace clock: days since the last water over the bed's interval.
// The reply clock: their last Beeper message waiting for an answer, as long as their ring allows.
// The plant shows whichever clock is further along.

const WAIT_LIMIT = 30; // days; older unanswered messages fall back to the pace clock

export type WaterSource = "thread" | "tending" | "water" | "map" | "beeper";

/** One Beeper chat with a kin map person: when each side last wrote, in ms. */
export type Chat = { kin: string | null; lastSent: number; lastReceived: number };

export type Attention = {
  pinned: { name: string; why?: string }[];
  watch: { name: string; why?: string; until?: unknown }[];
  /** The `## Changes` of Hearth.md, whose dated lines count as days in the garden. */
  changesRaw?: string;
};

export type GardenInput<P extends Person> = {
  people: P[];
  tending: TendingBlock[];
  conversations: Conversation[];
  chats?: Chat[];
  attention: Attention;
  today: IsoDate;
  now: number;
};

export function growGarden<P extends Person>({ people, tending, conversations, chats = [], attention, today, now }: GardenInput<P>) {
  const week = currentBlock(tending, today);

  // Latest water per person, with where it came from.
  const water = new Map<string, { date: IsoDate; from: WaterSource }>();
  const offer = (name: string, date: IsoDate | null, from: WaterSource) => {
    if (!date || date > today) return;
    const k = sameName(name);
    const prev = water.get(k);
    if (!prev || date > prev.date) water.set(k, { date, from });
  };
  for (const b of tending) for (const e of b.entries) offer(e.name, tendedOn(e, b), isPlanned(e) ? "tending" : "water");
  for (const c of conversations) for (const d of sentDates(c.threads)) offer(c.name, d, "thread");
  for (const p of people) offer(p.name, mapDate(p.note, today), "map");
  const chatOf = new Map<string, Chat>();
  for (const c of chats) {
    if (!c.kin) continue;
    chatOf.set(sameName(c.kin), c);
    if (c.lastSent) offer(c.kin, iso(new Date(c.lastSent)), "beeper");
  }

  const pinned = byName(attention.pinned ?? []);
  const watch = byName(attention.watch ?? []);
  const planned = (week?.entries ?? []).filter(isPlanned);
  const thisWeek = new Set(planned.map((e) => sameName(e.name)));

  const plants = people.map((p) => {
    const k = sameName(p.name);
    const w = water.get(k) ?? null;
    const interval = p.every ?? INTERVAL[p.ring] ?? 30;
    const daysSince = w ? daysBetween(w.date, today) : null;
    const wt = watch.get(k);
    // Their last message, if it is newer than his, still within the month, and not answered
    // off Beeper since: a later day, or marked tended here that same day. A thread dated the
    // same day may be the message she answered, and Beeper's timestamps know better.
    const c = chatOf.get(k);
    const got = c ? iso(new Date(c.lastReceived)) : "";
    const answeredElsewhere = !!c && !!w && w.from !== "beeper" && (w.date > got || (w.date === got && w.from === "water"));
    const waiting = c && c.lastReceived > c.lastSent && now - c.lastReceived < WAIT_LIMIT * DAY_MS && !answeredElsewhere ? c.lastReceived : null;
    const replyWithin = p.replyWithin ?? REPLY_WITHIN[p.ring] ?? 7;
    const pace = thirstOf(daysSince, interval);
    return {
      ...p,
      lastTended: w?.date ?? null,
      lastTendedFrom: w?.from ?? null,
      daysSince,
      interval,
      replyWithin,
      waitingSince: waiting,
      thirst: waiting ? worse(pace, thirstOf((now - waiting) / DAY_MS, replyWithin)) : pace,
      thisWeek: thisWeek.has(k),
      nextBirthday: nextBirthday(p.birthday, today),
      pinned: pinned.get(k)?.why ?? (pinned.has(k) ? "" : null),
      watch: wt ? { why: wt.why ?? "", until: wt.until ? String(wt.until instanceof Date ? iso(wt.until) : wt.until).slice(0, 10) : null } : null,
    };
  });

  const placeOf = byName(people);
  return {
    today,
    week: week ? { heading: week.heading, intro: week.intro.trim() } : null,
    thisWeek: planned.map((e) => ({
      name: e.name,
      kind: e.kind,
      place: placeOf.get(sameName(e.name))?.place ?? null,
      text: e.text,
      gesture: e.gesture,
      outcome: e.outcome,
      done: !!e.outcome,
    })),
    plants,
    rhythm: lastSevenDays(activeDays(tending, conversations, attention.changesRaw ?? ""), today),
  };
}

export type Garden<P extends Person = Person> = ReturnType<typeof growGarden<P>>;
export type Plant<P extends Person = Person> = Garden<P>["plants"][number];

/** Days the garden saw him: a thread written, a tending block, an outcome, a hearth change. */
function activeDays(tending: TendingBlock[], conversations: Conversation[], changes: string) {
  const days = new Set<IsoDate>();
  for (const c of conversations) c.threads.forEach((t) => days.add(t.date));
  for (const b of tending) {
    days.add(b.date);
    for (const e of b.entries) {
      const d = tendedOn(e, b);
      if (d) days.add(d);
    }
  }
  for (const m of changes.matchAll(/^- (\d{4}-\d{2}-\d{2})/gm)) days.add(m[1]!);
  return days;
}

const lastSevenDays = (active: Set<IsoDate>, today: IsoDate) =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today + "T12:00:00");
    d.setDate(d.getDate() - (6 - i));
    const date = iso(d);
    return { date, active: active.has(date) };
  });
