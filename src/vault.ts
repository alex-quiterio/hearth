import { homedir } from "node:os";
import { join, basename } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { garden, threadSections, openDrafts, parseTending } from "./garden";
import { beeperOn, shifts } from "./beeper";
import { forecast } from "./forecast";

// The vault is the single source of truth. Hearth only reads it; skills write it.

export const VAULT_NAME = process.env.HEARTH_VAULT_NAME ?? "pandora";

export async function findVault(): Promise<string> {
  if (process.env.HEARTH_VAULT) return process.env.HEARTH_VAULT;
  const cfg = join(homedir(), "Library/Application Support/obsidian/obsidian.json");
  const { vaults } = await Bun.file(cfg).json();
  const hit = Object.values(vaults as Record<string, { path: string }>).find(
    (v) => basename(v.path) === VAULT_NAME,
  );
  if (!hit) throw new Error(`No Obsidian vault named ${VAULT_NAME} in ${cfg}`);
  return hit.path;
}

// Vault folders, set per machine in .env. Note names inside them are fixed by the skills that write them.
const DIRS = {
  kin: process.env.HEARTH_KIN_DIR ?? "4 - Archive/kin",
  conversations: process.env.HEARTH_CONVERSATIONS_DIR ?? "4 - Archive/conversations",
  practice: process.env.HEARTH_PRACTICE_DIR ?? "4 - Archive/practice",
  projects: process.env.HEARTH_PROJECTS_DIR ?? "4 - Archive/projects",
  rough: process.env.HEARTH_ROUGH_DIR ?? "1 - Rough Notes",
};

export const PATHS = {
  kinDir: DIRS.kin,
  kinMap: `${DIRS.kin}/Kin map.md`,
  tendingLog: `${DIRS.kin}/Tending log.md`,
  hearth: `${DIRS.kin}/Hearth.md`,
  psychology: `${DIRS.kin}/Own psychology.md`,
  territory: `${DIRS.kin}/Own territory.md`,
  conversations: DIRS.conversations,
  proprioception: `${DIRS.kin}/Proprioception log.md`,
  coordination: `${DIRS.projects}/Coordination partner.md`,
  projectsDir: DIRS.projects,
  practiceDir: DIRS.practice,
  practiceLog: `${DIRS.practice}/Emergent practice.md`,
  spells: `${DIRS.practice}/Spells.md`,
  roughNotes: DIRS.rough,
};

type Note = { frontmatter: Record<string, any>; body: string; mtime: number } | null;

async function readNote(vault: string, rel: string): Promise<Note> {
  const f = Bun.file(join(vault, rel));
  if (!(await f.exists())) return null;
  const text = await f.text();
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  let frontmatter: Record<string, any> = {};
  if (m) {
    try {
      frontmatter = (Bun.YAML.parse(m[1]!) as Record<string, any>) ?? {};
    } catch (e) {
      frontmatter = { _error: `frontmatter did not parse: ${(e as Error).message}` };
    }
  }
  return { frontmatter, body: m ? text.slice(m[0].length) : text, mtime: (await f.stat()).mtimeMs };
}

/** Split a markdown body into `## ` sections, keyed by heading text. */
function sections(body: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  let cur: { heading: string; lines: string[] } = { heading: "", lines: [] };
  for (const line of body.split("\n")) {
    const h = line.match(/^## (.+)$/);
    if (h) {
      out.push({ heading: cur.heading, text: cur.lines.join("\n").trim() });
      cur = { heading: h[1]!.trim(), lines: [] };
    } else cur.lines.push(line);
  }
  out.push({ heading: cur.heading, text: cur.lines.join("\n").trim() });
  return out.filter((s) => s.heading || s.text);
}

// A ring heading reads "<emoji> <Ring> (<gloss>)"; match on the first word only, so
// "Drifting (was close…)" stays Drifting and "New ground" is not the New ring.
const RINGS = [
  { key: "core", match: /^core$/i },
  { key: "close", match: /^close$/i },
  { key: "warm", match: /^warm$/i },
  { key: "drifting", match: /^drifting$/i },
  { key: "new", match: /^new$/i },
] as const;

const ringWord = (heading: string) =>
  heading.replace(/\(.*?\)/g, "").replace(/^[^\p{L}]+/u, "").trim();

const PLACES: Record<string, string> = { "🏙️": "here", "🌳": "land", "🌊": "lisbon", "✈️": "far" };

export type Person = {
  name: string;
  linked: boolean;
  place: string | null;
  placeLabel: string;
  note: string;
  ring: string;
  /** A woe (Working On Excellence): the rhythm after "woe, ", "" if none given; null if not a woe. */
  woe: string | null;
  /** Days between waterings from an "every <n> days|weeks|months" segment; null to use the ring's. */
  every: number | null;
  /** Days they can wait for an answer once they write, from "reply within <n> days"; null for the default. */
  replyWithin: number | null;
  /** Other names they show under on Beeper, from 'shows as "Sunny"' in the note. */
  aka: string[];
  /** Their birthday as MM-DD, from "birthday 31 Oct", "born 2 Jan 1990" or "🎂 31 Oct" in the note; null if not given. */
  birthday: string | null;
  lastThread: string | null;
  draftsWaiting: number;
};

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
export function birthdayOf(line: string): string | null {
  const m = line.match(BIRTHDAY);
  if (!m) return null;
  const month = MONTH_STEMS.findIndex((s) => s.split("|").includes(m[2]!.toLowerCase()));
  const d = Number(m[1]);
  if (month < 0 || d < 1 || d > 31) return null;
  return `${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parsePerson(line: string, ring: string): Person {
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
    lastThread: null,
    draftsWaiting: 0,
  };
}

export type Draft = { name: string; date: string; title: string };

/** Per person: date of the latest thread, and the drafts still waiting to go out. */
async function conversationSignals(vault: string) {
  const dir = join(vault, PATHS.conversations);
  const out = new Map<string, { lastThread: string | null; draftsWaiting: number; drafts: Draft[] }>();
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return out;
  }
  for (const f of files) {
    const name = f.replace(/\.md$/, "").normalize("NFC");
    const ts = threadSections(await Bun.file(join(dir, f)).text());
    // "Beatriz (WhatsApp, 1:1), a morada do Ricardo" says only "a morada do Ricardo"; a bare "Name (WhatsApp, 1:1)" says nothing.
    const drafts = openDrafts(ts).map((t) => ({ name, date: t.date, title: t.title.replace(/^[^(]*\([^)]*\)\s*,?\s*/, "") }));
    out.set(name, { lastThread: ts.map((t) => t.date).sort().at(-1) ?? null, draftsWaiting: drafts.length, drafts });
  }
  return out;
}

const DRAFTS_WITHIN = 30; // days; older unsent drafts are left to the person's sheet

/** Every draft still waiting to go out, newest first, from the last DRAFTS_WITHIN days. */
export async function draftsState(vault: string, today = new Date().toLocaleDateString("sv-SE")): Promise<Draft[]> {
  const since = new Date(Date.parse(today) - DRAFTS_WITHIN * 86_400_000).toISOString().slice(0, 10);
  return [...(await conversationSignals(vault)).values()]
    .flatMap((s) => s.drafts)
    .filter((d) => d.date >= since)
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

export async function kinState(vault: string) {
  const [map, signals] = await Promise.all([readNote(vault, PATHS.kinMap), conversationSignals(vault)]);
  if (!map) return { exists: false as const };

  const rings: { key: string; title: string; intro: string; people: Person[]; extra: string }[] = [];
  const other: { heading: string; html: string }[] = [];
  let weakPoints: { heading: string; html: string } | null = null;
  let intro = "";

  for (const s of sections(map.body)) {
    if (!s.heading) {
      intro = s.text.replace(/^# .+\n?/, "").trim();
      continue;
    }
    const ring = RINGS.find((r) => r.match.test(ringWord(s.heading)));
    if (ring) {
      const lines = s.text.split("\n");
      const people: Person[] = [];
      const introLines: string[] = [];
      const extraLines: string[] = [];
      for (const l of lines) {
        if (/^- /.test(l)) {
          const p = parsePerson(l.slice(2), ring.key);
          const sig = signals.get(p.name);
          if (sig) Object.assign(p, { lastThread: sig.lastThread, draftsWaiting: sig.draftsWaiting });
          people.push(p);
        } else if (people.length === 0) introLines.push(l);
        else extraLines.push(l);
      }
      rings.push({
        key: ring.key,
        title: s.heading,
        intro: md(introLines.join("\n")),
        people,
        extra: md(extraLines.join("\n")),
      });
    } else if (/weak point/i.test(s.heading)) {
      weakPoints = { heading: s.heading, html: md(s.text) };
    } else {
      other.push({ heading: s.heading, html: md(s.text) });
    }
  }

  return {
    exists: true as const,
    updated: map.frontmatter.updated ?? null,
    mtime: map.mtime,
    intro: md(intro),
    rings,
    weakPoints,
    other,
  };
}

/** The `## ` sections of a note whose heading matches, rendered. */
async function pick(vault: string, rel: string, wanted: RegExp[]) {
  const note = await readNote(vault, rel);
  if (!note) return null;
  const all = sections(note.body);
  return {
    mtime: note.mtime,
    updated: note.frontmatter.updated ?? null,
    sections: wanted
      .map((w) => all.find((s) => w.test(s.heading)))
      .filter((s): s is { heading: string; text: string } => !!s)
      .map((s) => ({ heading: s.heading, html: md(s.text) })),
  };
}

export async function innerState(vault: string) {
  const [psychology, territory] = await Promise.all([
    pick(vault, PATHS.psychology, [/^start here/i, /^latest/i]),
    pick(vault, PATHS.territory, [/^where he lives now/i, /^where to walk next/i]),
  ]);
  return { psychology, territory };
}

export async function tendingState(vault: string) {
  const note = await readNote(vault, PATHS.tendingLog);
  if (!note) return null;
  const blocks = sections(note.body).filter((s) => s.heading);
  return { mtime: note.mtime, latest: blocks.slice(-2).map((s) => ({ heading: s.heading, html: md(s.text) })) };
}

/** The thinking panel: the emergent-practice log and spellbook, and open emergent experiments. */
export async function thinkingState(vault: string, recent = 3) {
  const [log, spells] = await Promise.all([readNote(vault, PATHS.practiceLog), readNote(vault, PATHS.spells)]);
  const logSections = log ? sections(log.body) : [];
  const practices = logSections.find((s) => /^practices/i.test(s.heading))?.text ?? "";
  // Log entries are newest first: either `### ` blocks or top-level list items.
  const logText = logSections.find((s) => /^log/i.test(s.heading))?.text ?? "";
  const entries = /^### /m.test(logText)
    ? logText.split(/^(?=### )/m).filter((b) => b.trim().startsWith("###"))
    : logText.split(/\n(?=- )/).filter((b) => b.trim().startsWith("- "));

  let experiments: { name: string; listenOn: string | null; mtime: number }[] = [];
  try {
    const dir = join(vault, PATHS.roughNotes);
    const files = (await readdir(dir)).filter((f) => /^Emergent .+\.md$/.test(f));
    experiments = await Promise.all(
      files.map(async (f) => {
        const text = await Bun.file(join(dir, f)).text();
        return {
          name: f.replace(/\.md$/, ""),
          listenOn: text.match(/Listen[^\n]*?\b(\d{4}-\d{2}-\d{2})\b/i)?.[1] ?? null,
          mtime: (await stat(join(dir, f))).mtimeMs,
        };
      }),
    );
    experiments.sort((a, b) => (a.listenOn ?? "9999").localeCompare(b.listenOn ?? "9999") || b.mtime - a.mtime);
  } catch {}

  return {
    exists: !!log || !!spells || experiments.length > 0,
    practices: md(practices),
    recent: md(entries.slice(0, recent).map((e) => e.trim()).join("\n")),
    spells: spells ? sections(spells.body).filter((s) => s.heading).map((s) => s.heading) : [],
    experiments,
    // The day each log entry was practised: its first date.
    days: [...new Set(entries.map((e) => e.match(/\d{4}-\d{2}-\d{2}/)?.[0]).filter((d): d is string => !!d))],
  };
}

/** The Inner screen's own reads: proprioception moments, the coordination partner, thinking outputs. */
export async function innerScreenState(vault: string) {
  const [log, coordination] = await Promise.all([
    readNote(vault, PATHS.proprioception),
    pick(vault, PATHS.coordination, [/./]),
  ]);
  const logSections = log ? sections(log.body) : [];
  const weekly = logSections.find((s) => /^weekly/i.test(s.heading))?.text ?? "";
  // Moments are `### YYYY-MM-DD · <moment>` blocks; the template's own placeholder has no date.
  const momentsText = logSections.find((s) => /^moments/i.test(s.heading))?.text ?? "";
  const moments = momentsText
    .split(/^(?=### )/m)
    .map((b) => b.trim())
    .filter((b) => /^### \d{4}-\d{2}-\d{2}/.test(b))
    .map((b) => {
      const [head, ...rest] = b.split("\n");
      const [, date, title] = head!.match(/^### (\d{4}-\d{2}-\d{2})\s*·?\s*(.*)$/)!;
      return { date: date!, title: title!.trim(), html: md(rest.join("\n").trim()) };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  // What the thinking skills leave in Rough Notes, plus the monthly crossing pages kept in projects, newest first.
  const OUTPUTS: [string, RegExp][] = [
    [PATHS.roughNotes, /^(Emergent|Visionary fiction|Work rhythm|Climate geopolitics brief|Crossing) .*\.md$/],
    [PATHS.projectsDir, /^(Crossing) \d{4}-\d{2}\.md$/],
  ];
  const notes: { name: string; kind: string; mtime: number }[] = [];
  for (const [rel, re] of OUTPUTS) {
    try {
      const dir = join(vault, rel);
      notes.push(
        ...(await Promise.all(
          (await readdir(dir))
            .filter((f) => re.test(f))
            .map(async (f) => ({
              name: f.replace(/\.md$/, ""),
              kind: f.match(re)![1]!,
              mtime: (await stat(join(dir, f))).mtimeMs,
            })),
        )),
      );
    } catch {}
  }
  notes.sort((a, b) => b.mtime - a.mtime);

  return {
    proprioception: log
      ? { weekly: md(weekly), moments: moments.slice(0, 3), count: moments.length, days: [...new Set(moments.map((m) => m.date))] }
      : null,
    coordination: coordination && coordination.sections.length ? coordination : null,
    notes: notes.slice(0, 8),
  };
}

export type Ember = { date: string; kind: "moment" | "practice" | "spell" | "tending"; title: string; html: string; note: string };

/** Every dated thing Alex has written down in the logs, for the Inner screen to bring one back. Oldest first. */
export async function embersState(vault: string): Promise<Ember[]> {
  const name = (rel: string) => basename(rel).replace(/\.md$/, "");
  const [moments, log, spells, tending] = await Promise.all([
    readNote(vault, PATHS.proprioception),
    readNote(vault, PATHS.practiceLog),
    readNote(vault, PATHS.spells),
    Bun.file(join(vault, PATHS.tendingLog)).exists().then((ok) => (ok ? Bun.file(join(vault, PATHS.tendingLog)).text() : "")),
  ]);
  const out: Ember[] = [];

  const momentsText = moments ? sections(moments.body).find((s) => /^moments/i.test(s.heading))?.text ?? "" : "";
  for (const b of momentsText.split(/^(?=### )/m)) {
    const m = b.trim().match(/^### (\d{4}-\d{2}-\d{2})\s*·?\s*(.*)\n?([\s\S]*)$/);
    if (m) out.push({ date: m[1]!, kind: "moment", title: m[2]!.trim() || "a moment", html: md(m[3]!.trim()), note: name(PATHS.proprioception) });
  }

  const logText = log ? sections(log.body).find((s) => /^log/i.test(s.heading))?.text ?? "" : "";
  for (const line of logText.split("\n")) {
    const m = line.match(/^- (\d{4}-\d{2}-\d{2})\s*·?\s*(.+)$/);
    if (m) out.push({ date: m[1]!, kind: "practice", title: m[2]!.trim(), html: "", note: name(PATHS.practiceLog) });
  }

  for (const s of spells ? sections(spells.body).filter((s) => s.heading) : []) {
    const date = s.text.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (date) out.push({ date, kind: "spell", title: s.heading, html: md(s.text), note: name(PATHS.spells) });
  }

  for (const b of parseTending(tending))
    for (const e of b.entries)
      out.push({
        date: e.outcome.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? b.date,
        kind: "tending",
        title: `${e.kind} · ${e.name}`,
        html: md([e.gesture && `Gesture: ${e.gesture}`, e.outcome && `Outcome: ${e.outcome}`].filter(Boolean).join("\n\n")),
        note: name(PATHS.tendingLog),
      });

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** `servers:` in Hearth.md, in order of preference: bare hosts or URLs, each made an https origin. */
export function servers(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const out: string[] = [];
  for (const s of list) {
    try {
      const host = String(s).trim();
      const origin = new URL(/^https?:\/\//.test(host) ? host : `https://${host}`).origin;
      if (!out.includes(origin)) out.push(origin);
    } catch {}
  }
  return out;
}

export async function hearthConfig(vault: string) {
  const note = await readNote(vault, PATHS.hearth);
  const fm = note?.frontmatter ?? {};
  return {
    exists: !!note,
    path: PATHS.hearth,
    error: fm._error ?? null,
    pinned: (fm.pinned ?? []) as { name: string; why?: string }[],
    watch: (fm.watch ?? []) as { name: string; why?: string; until?: string }[],
    now: (fm.now ?? []) as { what: string; why?: string; run?: string; until?: string }[],
    actions: (fm.actions ?? []) as { label: string; prompt: string; hint?: string }[],
    panels: (fm.panels ?? ["focus", "thinking", "weak-points", "rings", "tending", "inner"]) as string[],
    servers: servers(fm.servers),
    innerVeiled: fm.inner?.veiled ?? true,
    changes: note ? md(sections(note.body).find((s) => /^changes/i.test(s.heading))?.text ?? "") : "",
    changesRaw: note ? (sections(note.body).find((s) => /^changes/i.test(s.heading))?.text ?? "") : "",
  };
}

export async function state(vault: string, today?: string) {
  const [config, kin, inner, tending, thinking, innerScreen, embers, drafts] = await Promise.all([
    hearthConfig(vault),
    kinState(vault),
    innerState(vault),
    tendingState(vault),
    thinkingState(vault),
    innerScreenState(vault),
    embersState(vault),
    draftsState(vault, today),
  ]);
  // Who wrote last on Beeper, for the reply clock: timestamps only, kin map people only.
  const sh = beeperOn() ? shifts(kinPeople(kin).map((p) => ({ name: p.name, ring: p.ring, aka: p.aka }))) : null;
  const chats = sh && !("error" in sh) ? sh.all.filter((c) => c.kin) : [];
  const gardenState = await garden(vault, kinPeople(kin), config, today, chats);
  const woes = kinPeople(kin).filter((p) => p.woe != null).map((p) => ({ name: p.name, rhythm: p.woe, place: p.place }));
  const ahead = forecast({ people: gardenState.plants, watch: config.watch, now: config.now, experiments: thinking.experiments }, gardenState.today);
  return { vaultName: VAULT_NAME, config, kin, inner, tending, thinking: { ...thinking, woes }, innerScreen, embers, drafts, garden: gardenState, forecast: ahead, at: Date.now() };
}

export const kinPeople = (kin: Awaited<ReturnType<typeof kinState>>): Person[] =>
  kin.exists ? kin.rings.flatMap((r) => r.people) : [];

/** Markdown to HTML, with [[wiki links]] opening the note in Obsidian. */
export function md(src: string): string {
  if (!src.trim()) return "";
  const linked = src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, label?: string) => {
    const url = `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(target)}`;
    return `[${label ?? target}](${url})`;
  });
  return Bun.markdown.html(linked);
}

export async function lastChange(vault: string): Promise<number> {
  let latest = 0;
  for (const rel of [PATHS.kinDir, PATHS.conversations, PATHS.practiceDir]) {
    try {
      const dir = join(vault, rel);
      for (const f of await readdir(dir)) latest = Math.max(latest, (await stat(join(dir, f))).mtimeMs);
    } catch {}
  }
  return latest;
}
