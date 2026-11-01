import { sections, type Note, type Section } from "../shared/note";

// Own psychology and Own territory are long; the dashboard shows only a few chosen sections of each.

export const PSYCHOLOGY_SECTIONS = [/^start here/i, /^latest/i];
export const TERRITORY_SECTIONS = [/^where he lives now/i, /^where to walk next/i];

export type Excerpt = { mtime: number; updated: unknown; sections: Section[] };

/** The sections whose headings match, in the order asked for. */
export function excerpt(note: Note, wanted: RegExp[]): Excerpt {
  const all = sections(note.body);
  return {
    mtime: note.mtime,
    updated: note.frontmatter.updated ?? null,
    sections: wanted.map((w) => all.find((s) => w.test(s.heading))).filter((s): s is Section => !!s),
  };
}
