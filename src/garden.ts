import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { PATHS, md, type Person } from "./vault";

// The garden: each person a plant, Alex's attention the water. Thirst is days since he
// last tended someone over how often their bed wants water. It describes his care, never
// the person: no scores, no ranking of friends.

const INTERVAL: Record<string, number> = { core: 7, close: 14, warm: 30, new: 10, drifting: 45 };

export type Thirst = "fresh" | "ok" | "thirsty" | "wilting" | "unknown";
type Source = "thread" | "tending" | "water" | "map";

export const iso = (d: Date) => d.toLocaleDateString("sv-SE"); // YYYY-MM-DD, local time
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const norm = (s: string) => s.normalize("NFC").toLowerCase().trim();

export function isoWeek(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function thirstOf(daysSince: number | null, interval: number): Thirst {
  if (daysSince === null) return "unknown";
  const r = daysSince / interval;
  return r < 0.5 ? "fresh" : r <= 1 ? "ok" : r <= 2 ? "thirsty" : "wilting";
}

// ---- Tending log ----------------------------------------------------------------------

type Entry = { kind: string; name: string; line: number; text: string; gesture: string; outcome: string };
type Block = { heading: string; date: string; start: number; end: number; intro: string; entries: Entry[] };

const ENTRY = /^- \*\*([^·*]+?) · (?:\[\[)?([^\]*]+?)(?:\]\])?\*\*(.*)$/;

export function parseTending(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let cur: Block | null = null;
  lines.forEach((l, i) => {
    const h = l.match(/^## (.+)$/);
    if (h) {
      if (cur) cur.end = i;
      const date = h[1]!.match(/(\d{4}-\d{2}-\d{2})/);
      cur = date ? { heading: h[1]!.trim(), date: date[1]!, start: i, end: lines.length, intro: "", entries: [] } : null;
      if (cur) blocks.push(cur);
      return;
    }
    if (!cur) return;
    const e = l.match(ENTRY);
    if (e) {
      const rest = e[3]!;
      cur.entries.push({
        kind: e[1]!.trim(),
        name: e[2]!.trim().normalize("NFC"),
        line: i,
        text: l.slice(2),
        gesture: rest.match(/Gesture:\s*(.*?)(?:\s*Outcome:|$)/)?.[1]?.trim() ?? "",
        outcome: rest.match(/Outcome:\s*(.*)$/)?.[1]?.trim() ?? (e[1]!.trim() === "Tended" ? "tended" : ""),
      });
    } else if (!cur.entries.length && l.trim()) cur.intro += l + "\n";
  });
  return blocks;
}

/** The tending block for this week: the latest dated within the last 6 days. kin:tend puts new blocks on top, so go by date, not position. */
const currentBlock = (blocks: Block[], today: string) =>
  blocks
    .filter((b) => days(b.date, today) >= 0 && days(b.date, today) <= 6)
    .reduce<Block | null>((best, b) => (!best || b.date > best.date ? b : best), null);

/** When each entry counts as water: an outcome's own date if it has one, else its block's. */
function tendedOn(e: Entry, b: Block): string | null {
  if (!e.outcome) return null;
  return e.outcome.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? (e.kind === "Tended" ? e.text.match(/(\d{4}-\d{2}-\d{2})/)?.[1] : null) ?? b.date;
}

// ---- Other sources of "last tended" ---------------------------------------------------

const STATE = /^(?:Estado|Status|State)[^:\n]*: \*\*([^*]+)\*\*/gm;
const NOT_SENT = /not sent|não enviad|por enviar|rascunho|draft|unsent/i;

/** The last recorded state of one thread section: "sent", "draft", or null if none. */
export function threadState(section: string): "sent" | "draft" | null {
  const last = [...section.matchAll(STATE)].at(-1)?.[1];
  if (!last) return null;
  return NOT_SENT.test(last) ? "draft" : /sent|enviad|todas|tudo/i.test(last) ? "sent" : "draft";
}

/** A person file split into its dated thread sections. */
export function threadSections(text: string) {
  return text
    .split(/^## /m)
    .slice(1)
    .map((part) => ({ date: part.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null, state: threadState(part) }))
    .filter((t): t is { date: string; state: "sent" | "draft" | null } => !!t.date);
}

/** Per person file: every thread date, the dates of the threads actually sent, and the latest of those. */
async function threads(vault: string) {
  const out = new Map<string, { dates: string[]; sent: string[]; lastSent: string | null }>();
  const dir = join(vault, PATHS.conversations);
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return out;
  }
  for (const f of files) {
    const ts = threadSections(await Bun.file(join(dir, f)).text());
    const sent = ts.filter((t) => t.state === "sent").map((t) => t.date).sort();
    out.set(norm(f.replace(/\.md$/, "")), { dates: ts.map((t) => t.date), sent, lastSent: sent.at(-1) ?? null });
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "last talked 4 Oct", "talked 24 Sep", "answered 21 Sep" in a kin map line. */
export function mapDate(note: string, today: string): string | null {
  const m = note.match(/\b(?:talked|answered|saw|met|called)\s+(\d{1,2})\s+([A-Za-z]{3})/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]!.toLowerCase());
  if (month < 0) return null;
  let year = Number(today.slice(0, 4));
  let d = `${year}-${String(month + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  if (d > today) d = `${year - 1}${d.slice(4)}`;
  return d;
}

// ---- The garden -----------------------------------------------------------------------

type Config = { pinned: { name: string; why?: string }[]; watch: { name: string; why?: string; until?: unknown }[]; changesRaw?: string };

export async function garden(vault: string, people: Person[], config: Config, today = iso(new Date())) {
  const logFile = Bun.file(join(vault, PATHS.tendingLog));
  const blocks = (await logFile.exists()) ? parseTending(await logFile.text()) : [];
  const week = currentBlock(blocks, today);
  const convo = await threads(vault);

  // Latest water per person, with where it came from, and every day it fell for the record.
  const water = new Map<string, { date: string; from: Source }>();
  const touches = new Map<string, Set<string>>();
  const offer = (name: string, date: string | null, from: Source) => {
    if (!date || date > today) return;
    const k = norm(name);
    if (!touches.has(k)) touches.set(k, new Set());
    touches.get(k)!.add(date);
    const prev = water.get(k);
    if (!prev || date > prev.date) water.set(k, { date, from });
  };
  for (const b of blocks) for (const e of b.entries) offer(e.name, tendedOn(e, b), e.kind === "Tended" ? "water" : "tending");
  for (const [k, t] of convo) for (const d of t.sent) offer(k, d, "thread");
  for (const p of people) offer(p.name, mapDate(p.note, today), "map");

  const byName = <T extends { name: string }>(list: T[]) => new Map(list.map((x) => [norm(x.name), x]));
  const pinned = byName(config.pinned ?? []);
  const watch = byName(config.watch ?? []);
  const planned = (week?.entries ?? []).filter((e) => e.kind !== "Tended");
  const thisWeek = new Set(planned.map((e) => norm(e.name)));

  const plants = people.map((p) => {
    const k = norm(p.name);
    const w = water.get(k) ?? null;
    const interval = INTERVAL[p.ring] ?? 30;
    const daysSince = w ? days(w.date, today) : null;
    const wt = watch.get(k);
    return {
      ...p,
      lastTended: w?.date ?? null,
      lastTendedFrom: w?.from ?? null,
      daysSince,
      interval,
      thirst: thirstOf(daysSince, interval),
      thisWeek: thisWeek.has(k),
      pinned: pinned.get(k)?.why ?? (pinned.has(k) ? "" : null),
      watch: wt ? { why: wt.why ?? "", until: wt.until ? String(wt.until instanceof Date ? iso(wt.until) : wt.until).slice(0, 10) : null } : null,
    };
  });

  const placeOf = byName(people);
  // Days the garden saw him: a thread written, a tending block, an outcome, a hearth change.
  const activeDays = new Set<string>();
  for (const t of convo.values()) t.dates.forEach((d) => activeDays.add(d));
  for (const b of blocks) {
    activeDays.add(b.date);
    for (const e of b.entries) {
      const d = tendedOn(e, b);
      if (d) activeDays.add(d);
    }
  }
  for (const m of (config.changesRaw ?? "").matchAll(/^- (\d{4}-\d{2}-\d{2})/gm)) activeDays.add(m[1]!);
  const rhythm = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today + "T12:00:00");
    d.setDate(d.getDate() - (6 - i));
    const date = iso(d);
    return { date, active: activeDays.has(date) };
  });

  return {
    today,
    week: week ? { heading: week.heading, intro: md(week.intro.trim()) } : null,
    thisWeek: planned.map((e) => ({
      name: e.name,
      kind: e.kind,
      place: placeOf.get(norm(e.name))?.place ?? null,
      html: md(e.text),
      gesture: e.gesture,
      outcome: e.outcome,
      done: !!e.outcome,
    })),
    plants,
    rhythm,
  };
}

// ---- Marking someone tended: the one thing Hearth writes --------------------------------------------

/**
 * Record that Alex tended someone today, in the Tending log kin:tend already reads.
 * Fills the person's empty Outcome in this week's block, or adds a "Tended" line.
 */
export async function waterPlant(vault: string, person: Person, note = "", today = iso(new Date())) {
  const file = Bun.file(join(vault, PATHS.tendingLog));
  let text = (await file.exists())
    ? await file.text()
    : `---\ntags: [kin]\ntype:\n  - tending-log\nupdated: ${today}\n---\n# Tending log\n\nThree people a week, one gesture each. Next week's run fills in the outcome. See [[Kin map]].\n`;
  const clean = note.replace(/\s+/g, " ").trim().slice(0, 200);
  const outcome = `tended ${today}${clean ? `, ${clean}` : ""}.`;
  const lines = text.split("\n");
  const week = currentBlock(parseTending(text), today);
  const entry = week?.entries.find((e) => norm(e.name) === norm(person.name) && e.kind !== "Tended");

  if (entry && !entry.outcome) {
    lines[entry.line] = lines[entry.line]!.replace(/Outcome:\s*$/, `Outcome: ${outcome}`);
    if (lines[entry.line]!.endsWith(entry.text)) lines[entry.line] += ` Outcome: ${outcome}`;
  } else {
    const who = person.linked ? `[[${person.name}]]` : person.name;
    const line = `- **Tended · ${who}** ${today}, from Hearth.${clean ? ` ${clean}` : ""}`;
    if (week) {
      let at = week.end;
      while (at > week.start && !lines[at - 1]!.trim()) at--;
      lines.splice(at, 0, line);
    } else {
      while (lines.length && !lines.at(-1)!.trim()) lines.pop();
      lines.push("", `## ${isoWeek(today)} · ${today}`, "", "Tended from Hearth, between tending runs.", "", line);
    }
  }
  text = lines.join("\n").replace(/^updated: .*$/m, `updated: ${today}`);
  if (!text.endsWith("\n")) text += "\n";
  await Bun.write(file, text);
}
