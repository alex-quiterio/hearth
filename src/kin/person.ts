import { daysBetween, type IsoDate } from "../shared/dates";

// A person on the kin map: one line under a ring heading, segments split by " · ".
//   - [[Ana Exemplo]] · 🌊 lisbon · woe, weekly call · every 2 weeks · reply within a day · old friend.

export const RINGS = ["core", "close", "warm", "drifting", "new"] as const;
export type Ring = (typeof RINGS)[number];

export type Place = "here" | "land" | "lisbon" | "far";
const PLACES: Record<string, Place> = { "🏙️": "here", "🌳": "land", "🌊": "lisbon", "✈️": "far" };

/** Birthdays as MM-DD, so they recur. */
export type MonthDay = string;

export type Person = {
  name: string;
  linked: boolean;
  place: Place | null;
  placeLabel: string;
  note: string;
  ring: Ring;
  /** A woe (Working On Excellence): the rhythm after "woe, ", "" if none given; null if not a woe. */
  woe: string | null;
  /** Days between waterings from an "every <n> days|weeks|months" segment; null to use the ring's. */
  every: number | null;
  /** Days they can wait for an answer once they write, from "reply within <n> days"; null for the default. */
  replyWithin: number | null;
  /** Other names they show under on Beeper, from 'shows as "Sunny"' in the note. */
  aka: string[];
  /** From "birthday 31 Oct", "born 2 Jan 1990" or "🎂 31 Oct" in the note; null if not given. */
  birthday: MonthDay | null;
};

/** Who someone is to the chat networks: enough to match a Beeper name to them. */
export type KinIdentity = { name: string; ring: string; aka?: string[] };
export const identity = (p: Person): KinIdentity => ({ name: p.name, ring: p.ring, aka: p.aka });

// Whole segments like "every 3 days", "every 2 weeks", "every month", "every fortnight",
// and "reply within 1 day", "reply within 12 hours", "reply within a week".
const SPAN = String.raw`(?:(\d+|an?)\s+)?(hour|day|week|fortnight|month)s?$`;
const EVERY = new RegExp(`^every\\s+${SPAN}`, "i");
const REPLY = new RegExp(`^reply\\s+within\\s+${SPAN}`, "i");
const UNIT: Record<string, number> = { hour: 1 / 24, day: 1, week: 7, fortnight: 14, month: 30 };
const spanDays = (seg: string, re: RegExp) => {
  const m = seg.match(re)!;
  return (/^\d/.test(m[1] ?? "") ? Number(m[1]) : 1) * UNIT[m[2]!.toLowerCase()]!;
};
/** Takes the first segment matching re out of parts, as days. */
const takeSpan = (parts: string[], re: RegExp) => {
  const at = parts.findIndex((p) => re.test(p.trim()));
  return at < 0 ? null : spanDays(parts.splice(at, 1)[0]!.trim(), re);
};

// "Birthday 31 Oct", "born 2 January 1990", "🎂 31 Oct", "aniversário 31 Out", with an optional "on".
const MONTH_STEMS = ["jan", "feb|fev", "mar", "apr|abr", "may|mai", "jun", "jul", "aug|ago", "sep|set", "oct|out", "nov", "dec|dez"];
const BIRTHDAY = /(?:birthday|born|🎂|anivers[aá]rio|anos)\s*(?:on\s+|a\s+|em\s+)?(\d{1,2})\s+(?:de\s+)?(\p{L}{3})\p{L}*/iu;

export function birthdayOf(line: string): MonthDay | null {
  const m = line.match(BIRTHDAY);
  if (!m) return null;
  const month = MONTH_STEMS.findIndex((s) => s.split("|").includes(m[2]!.toLowerCase()));
  const d = Number(m[1]);
  if (month < 0 || d < 1 || d > 31) return null;
  return `${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The next time a birthday falls, today included, and how many days off. 29 Feb falls on 28 Feb in other years. */
export function nextBirthday(mmdd: MonthDay | null, today: IsoDate): { date: IsoDate; in: number } | null {
  if (!mmdd) return null;
  const on = (year: number) => {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return `${year}-${mmdd === "02-29" && !leap ? "02-28" : mmdd}`;
  };
  const year = Number(today.slice(0, 4));
  const date = on(year) >= today ? on(year) : on(year + 1);
  return { date, in: daysBetween(today, date) };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "last talked 4 Oct", "talked 24 Sep", "answered 21 Sep" in a kin map note, as a date never after today. */
export function mapDate(note: string, today: IsoDate): IsoDate | null {
  const m = note.match(/\b(?:talked|answered|saw|met|called)\s+(\d{1,2})\s+([A-Za-z]{3})/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]!.toLowerCase());
  if (month < 0) return null;
  const year = Number(today.slice(0, 4));
  const d = `${year}-${String(month + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return d > today ? `${year - 1}${d.slice(4)}` : d;
}

export function parsePerson(line: string, ring: Ring): Person {
  const parts = line.split(" · ");
  const head = parts[0]!;
  const link = head.match(/\[\[([^\]|]+)/);
  const name = (link ? link[1]! : head.replace(/\(.*?\)/g, "")).trim().replace(/,.*$/, "").normalize("NFC");
  const placePart = parts[1] ?? "";
  const emoji = Object.keys(PLACES).find((e) => placePart.includes(e));
  const rest = parts.slice(2);
  const woeAt = rest.findIndex((p) => /^woe\b/i.test(p.trim()));
  const woe = woeAt < 0 ? null : rest.splice(woeAt, 1)[0]!.trim().replace(/^woe,?\s*/i, "");
  const every = takeSpan(rest, EVERY);
  const replyWithin = takeSpan(rest, REPLY);
  return {
    name,
    linked: !!link,
    place: emoji ? PLACES[emoji]! : null,
    placeLabel: placePart.trim(),
    note: rest.join(" · ").trim(),
    ring,
    woe,
    every,
    replyWithin,
    aka: [...line.matchAll(/shows as "([^"]+)"/gi)].map((m) => m[1]!),
    birthday: birthdayOf(line),
  };
}
