import { daysBetween, firstDate, isoWeek, type IsoDate } from "../shared/dates";
import { sameName } from "../shared/names";

// The Tending log: kin:tend's weekly blocks, `## YYYY-Www · YYYY-MM-DD`, each with a few entries
//   - **Carrying · [[Rui Teste]]** (🌳). Gesture: Sunday lunch. Outcome: went, 2026-10-07.
// and "Tended" lines Hearth adds when someone is marked tended between runs.

export type TendingEntry = { kind: string; name: string; line: number; text: string; gesture: string; outcome: string };
export type TendingBlock = { heading: string; date: IsoDate; start: number; end: number; intro: string; entries: TendingEntry[] };

const ENTRY = /^- \*\*([^·*]+?) · (?:\[\[)?([^\]*]+?)(?:\]\])?\*\*(.*)$/;

export function parseTending(text: string): TendingBlock[] {
  const lines = text.split("\n");
  const blocks: TendingBlock[] = [];
  let cur: TendingBlock | null = null;
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

/** A "Tended" line is Hearth's own water; any other entry is one of kin:tend's planned gestures. */
export const isPlanned = (e: TendingEntry) => e.kind !== "Tended";

/** This week's block: the latest dated within the last 6 days. kin:tend puts new blocks on top, so go by date, not position. */
export const currentBlock = (blocks: TendingBlock[], today: IsoDate) =>
  blocks
    .filter((b) => daysBetween(b.date, today) >= 0 && daysBetween(b.date, today) <= 6)
    .reduce<TendingBlock | null>((best, b) => (!best || b.date > best.date ? b : best), null);

/** When an entry counts as water: its outcome's own date if it has one, else its block's. Null while it has no outcome. */
export function tendedOn(e: TendingEntry, b: TendingBlock): IsoDate | null {
  if (!e.outcome) return null;
  return firstDate(e.outcome) ?? (e.kind === "Tended" ? firstDate(e.text) : null) ?? b.date;
}

export const emptyLog = (today: IsoDate) =>
  `---\ntags: [kin]\ntype:\n  - tending-log\nupdated: ${today}\n---\n# Tending log\n\nThree people a week, one gesture each. Next week's run fills in the outcome. See [[Kin map]].\n`;

/**
 * The log with someone marked tended today: their empty Outcome in this week's block filled,
 * or else a "Tended" line added (in this week's block, or a small new one). A filled outcome is never overwritten.
 */
export function recordTended(text: string, who: { name: string; linked: boolean }, note: string, today: IsoDate): string {
  const clean = note.replace(/\s+/g, " ").trim().slice(0, 200);
  const outcome = `tended ${today}${clean ? `, ${clean}` : ""}.`;
  const lines = text.split("\n");
  const week = currentBlock(parseTending(text), today);
  const entry = week?.entries.find((e) => sameName(e.name) === sameName(who.name) && isPlanned(e));

  if (entry && !entry.outcome) {
    lines[entry.line] = lines[entry.line]!.replace(/Outcome:\s*$/, `Outcome: ${outcome}`);
    if (lines[entry.line]!.endsWith(entry.text)) lines[entry.line] += ` Outcome: ${outcome}`;
  } else {
    const name = who.linked ? `[[${who.name}]]` : who.name;
    const line = `- **Tended · ${name}** ${today}, from Hearth.${clean ? ` ${clean}` : ""}`;
    if (week) {
      let at = week.end;
      while (at > week.start && !lines[at - 1]!.trim()) at--;
      lines.splice(at, 0, line);
    } else {
      while (lines.length && !lines.at(-1)!.trim()) lines.pop();
      lines.push("", `## ${isoWeek(today)} · ${today}`, "", "Tended from Hearth, between tending runs.", "", line);
    }
  }
  const out = lines.join("\n").replace(/^updated: .*$/m, `updated: ${today}`);
  return out.endsWith("\n") ? out : out + "\n";
}
