import { homedir } from "node:os";
import { join, basename } from "node:path";
import { readdir, stat } from "node:fs/promises";

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

export const PATHS = {
  kinDir: "4 - Archive/kin",
  kinMap: "4 - Archive/kin/Kin map.md",
  tendingLog: "4 - Archive/kin/Tending log.md",
  hearth: "4 - Archive/kin/Hearth.md",
  psychology: "4 - Archive/kin/Own psychology.md",
  territory: "4 - Archive/kin/Own territory.md",
  conversations: "4 - Archive/conversations",
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

const RINGS = [
  { key: "core", match: /core/i },
  { key: "close", match: /close/i },
  { key: "warm", match: /warm/i },
  { key: "drifting", match: /drift/i },
  { key: "new", match: /\bnew\b/i },
] as const;

const PLACES: Record<string, string> = { "🏙️": "here", "🌳": "land", "🌊": "lisbon", "✈️": "far" };

export type Person = {
  name: string;
  linked: boolean;
  place: string | null;
  placeLabel: string;
  note: string;
  ring: string;
  lastThread: string | null;
  draftsWaiting: number;
};

function parsePerson(line: string, ring: string): Person {
  const parts = line.split(" · ");
  const head = parts[0]!;
  const link = head.match(/\[\[([^\]|]+)/);
  const name = (link ? link[1]! : head.replace(/\(.*?\)/g, "")).trim().replace(/,.*$/, "").normalize("NFC");
  const placePart = parts[1] ?? "";
  const emoji = Object.keys(PLACES).find((e) => placePart.includes(e));
  return {
    name,
    linked: !!link,
    place: emoji ? PLACES[emoji]! : null,
    placeLabel: placePart.trim(),
    note: parts.slice(2).join(" · ").trim(),
    ring,
    lastThread: null,
    draftsWaiting: 0,
  };
}

const UNSENT = /por enviar|not sent|não enviad|parcialmente|rascunho/i;

/** Per person: date of the latest thread and how many thread drafts are not fully sent. */
async function conversationSignals(vault: string) {
  const dir = join(vault, PATHS.conversations);
  const out = new Map<string, { lastThread: string | null; draftsWaiting: number }>();
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return out;
  }
  for (const f of files) {
    const text = await Bun.file(join(dir, f)).text();
    const dates = [...text.matchAll(/^## (\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1]!).sort();
    const states = [...text.matchAll(/^(?:Estado|Status|State): \*\*([^*]+)\*\*/gm)].map((m) => m[1]!);
    out.set(f.replace(/\.md$/, "").normalize("NFC"), {
      lastThread: dates.at(-1) ?? null,
      draftsWaiting: states.filter((s) => UNSENT.test(s)).length,
    });
  }
  return out;
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
    const ring = RINGS.find((r) => r.match.test(s.heading.replace(/\(.*?\)/g, "")));
    if (ring && !/weak/i.test(s.heading)) {
      const lines = s.text.split("\n");
      const people: Person[] = [];
      const introLines: string[] = [];
      const extraLines: string[] = [];
      for (const l of lines) {
        if (/^- /.test(l)) {
          const p = parsePerson(l.slice(2), ring.key);
          const sig = signals.get(p.name);
          if (sig) Object.assign(p, sig);
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

export async function hearthConfig(vault: string) {
  const note = await readNote(vault, PATHS.hearth);
  const fm = note?.frontmatter ?? {};
  return {
    exists: !!note,
    error: fm._error ?? null,
    pinned: (fm.pinned ?? []) as { name: string; why?: string }[],
    watch: (fm.watch ?? []) as { name: string; why?: string; until?: string }[],
    actions: (fm.actions ?? []) as { label: string; prompt: string; hint?: string }[],
    panels: (fm.panels ?? ["focus", "weak-points", "rings", "tending", "inner"]) as string[],
    innerVeiled: fm.inner?.veiled ?? true,
    changes: note ? md(sections(note.body).find((s) => /^changes/i.test(s.heading))?.text ?? "") : "",
  };
}

export async function state(vault: string) {
  const [config, kin, inner, tending] = await Promise.all([
    hearthConfig(vault),
    kinState(vault),
    innerState(vault),
    tendingState(vault),
  ]);
  return { vaultName: VAULT_NAME, config, kin, inner, tending, at: Date.now() };
}

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
  for (const rel of [PATHS.kinDir, PATHS.conversations]) {
    try {
      const dir = join(vault, rel);
      for (const f of await readdir(dir)) latest = Math.max(latest, (await stat(join(dir, f))).mtimeMs);
    } catch {}
  }
  return latest;
}
