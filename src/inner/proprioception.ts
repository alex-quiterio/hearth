import { sectionText, type Note } from "../shared/note";
import type { IsoDate } from "../shared/dates";

// The Proprioception log: `### YYYY-MM-DD · <moment>` blocks under `## Moments`, and a `## Weekly` read.
// The template's own placeholder has no date, so it is never a moment.

export type Moment = { date: IsoDate; title: string; body: string };

/** Moments in the order the log keeps them. */
export function moments(log: Note | null): Moment[] {
  return sectionText(log, /^moments/i)
    .split(/^(?=### )/m)
    .map((b) => b.trim())
    .filter((b) => /^### \d{4}-\d{2}-\d{2}/.test(b))
    .map((b) => {
      const [head, ...rest] = b.split("\n");
      const [, date, title] = head!.match(/^### (\d{4}-\d{2}-\d{2})\s*·?\s*(.*)$/)!;
      return { date: date!, title: title!.trim(), body: rest.join("\n").trim() };
    });
}

export const newestFirst = <T extends { date: IsoDate }>(xs: T[]) => [...xs].sort((a, b) => b.date.localeCompare(a.date));

export const weekly = (log: Note | null) => sectionText(log, /^weekly/i);
