// An Obsidian note: YAML frontmatter, a markdown body, and its `## ` sections.

export type Frontmatter = Record<string, any>;
export type Note = { frontmatter: Frontmatter; body: string; mtime: number };
export type Section = { heading: string; text: string };

export function parseNote(text: string, mtime: number): Note {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  let frontmatter: Frontmatter = {};
  if (m) {
    try {
      frontmatter = (Bun.YAML.parse(m[1]!) as Frontmatter) ?? {};
    } catch (e) {
      frontmatter = { _error: `frontmatter did not parse: ${(e as Error).message}` };
    }
  }
  return { frontmatter, body: m ? text.slice(m[0].length) : text, mtime };
}

/** Frontmatter alone, or {} when it is missing or broken. */
export function frontmatterOf(text: string): Frontmatter {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  try {
    return (Bun.YAML.parse(m[1]!) as Frontmatter) ?? {};
  } catch {
    return {};
  }
}

/** Split a markdown body into `## ` sections, keyed by heading text. The text before the first heading has heading "". */
export function sections(body: string): Section[] {
  const out: Section[] = [];
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

/** The text of the first section whose heading matches, or "". */
export const sectionText = (note: Note | null, heading: RegExp) =>
  note ? sections(note.body).find((s) => heading.test(s.heading))?.text ?? "" : "";

/** The headed sections only. */
export const headedSections = (note: Note | null) => (note ? sections(note.body).filter((s) => s.heading) : []);
