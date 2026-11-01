import { firstDate, type IsoDate } from "../shared/dates";
import type { TendingBlock } from "../tending/tending-log";
import type { Moment } from "./proprioception";
import type { Spell } from "./practice";

// An ember: one dated thing Alex wrote down in the logs, for the Inner screen to bring one back.

export type EmberKind = "moment" | "practice" | "spell" | "tending";
/** body is markdown; note is the note it came from, by name. */
export type Ember = { date: IsoDate; kind: EmberKind; title: string; body: string; note: string };

export type EmberSources = {
  moments: Moment[];
  practices: { date: IsoDate; title: string }[];
  spells: Spell[];
  tending: TendingBlock[];
  notes: Record<EmberKind, string>;
};

/** Every ember, oldest first. */
export function gatherEmbers(s: EmberSources): Ember[] {
  const out: Ember[] = [];
  for (const m of s.moments) out.push({ date: m.date, kind: "moment", title: m.title || "a moment", body: m.body, note: s.notes.moment });
  for (const p of s.practices) out.push({ date: p.date, kind: "practice", title: p.title, body: "", note: s.notes.practice });
  for (const sp of s.spells) if (sp.date) out.push({ date: sp.date, kind: "spell", title: sp.name, body: sp.text, note: s.notes.spell });
  for (const b of s.tending)
    for (const e of b.entries)
      out.push({
        date: firstDate(e.outcome) ?? b.date,
        kind: "tending",
        title: `${e.kind} · ${e.name}`,
        body: [e.gesture && `Gesture: ${e.gesture}`, e.outcome && `Outcome: ${e.outcome}`].filter(Boolean).join("\n\n"),
        note: s.notes.tending,
      });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
