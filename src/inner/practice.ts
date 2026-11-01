import { firstDate, type IsoDate } from "../shared/dates";
import { headedSections, sectionText, type Note } from "../shared/note";

// thinking:emergent-practice keeps a log (`## Practices` held, `## Log` newest first) and a spellbook
// (one `## ` per spell). thinking:emergent leaves experiments in Rough Notes, each with a listen date.

/** The practices held, as markdown. */
export const practicesHeld = (log: Note | null) => sectionText(log, /^practices/i);

/** Log entries, newest first: either `### ` blocks or top-level list items. */
export function practiceEntries(log: Note | null): string[] {
  const text = sectionText(log, /^log/i);
  return /^### /m.test(text)
    ? text.split(/^(?=### )/m).filter((b) => b.trim().startsWith("###"))
    : text.split(/\n(?=- )/).filter((b) => b.trim().startsWith("- "));
}

/** The day each entry was practised (its first date), once each. */
export const practiceDays = (entries: string[]) => [...new Set(entries.map(firstDate).filter((d): d is IsoDate => !!d))];

/** `- YYYY-MM-DD · what` lines in the log. */
export function datedPractices(log: Note | null): { date: IsoDate; title: string }[] {
  const out: { date: IsoDate; title: string }[] = [];
  for (const line of sectionText(log, /^log/i).split("\n")) {
    const m = line.match(/^- (\d{4}-\d{2}-\d{2})\s*·?\s*(.+)$/);
    if (m) out.push({ date: m[1]!, title: m[2]!.trim() });
  }
  return out;
}

export type Spell = { name: string; text: string; date: IsoDate | null };

export const spellbook = (spells: Note | null): Spell[] =>
  headedSections(spells).map((s) => ({ name: s.heading, text: s.text, date: firstDate(s.text) }));

export type Experiment = { name: string; listenOn: IsoDate | null; mtime: number };

export const EXPERIMENT_FILE = /^Emergent .+\.md$/;

export const listenOn = (text: string): IsoDate | null => text.match(/Listen[^\n]*?\b(\d{4}-\d{2}-\d{2})\b/i)?.[1] ?? null;

/** Soonest listen date first; undated last, newest first. */
export const byListenDate = (xs: Experiment[]) =>
  [...xs].sort((a, b) => (a.listenOn ?? "9999").localeCompare(b.listenOn ?? "9999") || b.mtime - a.mtime);
