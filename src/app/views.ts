import { md } from "../shared/markdown";
import { headedSections, type Note, type Section } from "../shared/note";
import type { KinMap } from "../kin/kin-map";
import type { Person } from "../kin/person";
import type { Excerpt } from "../inner/psyche";
import type { Ember } from "../inner/embers";
import type { HearthConfig } from "../hearth/hearth-config";
import type { Garden } from "../garden/garden";

// Projections from the domain to what the page reads: markdown rendered, nothing else changed.
// The page's JSON is a published contract (public/app.js reads it), so these keep its shape.

export const sectionView = (s: Section) => ({ heading: s.heading, html: md(s.text) });

export const excerptView = (e: Excerpt | null) => (e ? { ...e, sections: e.sections.map(sectionView) } : null);

export const configView = (c: HearthConfig) => ({ ...c, changes: md(c.changesRaw) });

export function kinView<P extends Person>(map: KinMap | null, people: (p: Person) => P) {
  if (!map) return { exists: false as const };
  return {
    exists: true as const,
    updated: map.updated,
    mtime: map.mtime,
    intro: md(map.intro),
    rings: map.rings.map((r) => ({ key: r.key, title: r.title, intro: md(r.intro), people: r.people.map(people), extra: md(r.extra) })),
    weakPoints: map.weakPoints && sectionView(map.weakPoints),
    other: map.other.map(sectionView),
  };
}

/** The last two blocks of the tending log, as written. */
export const tendingView = (log: Note | null) =>
  log ? { mtime: log.mtime, latest: headedSections(log).slice(-2).map(sectionView) } : null;

export const emberView = ({ body, ...e }: Ember) => ({ date: e.date, kind: e.kind, title: e.title, html: md(body), note: e.note });

export const gardenView = <P extends Person>(g: Garden<P>) => ({
  ...g,
  week: g.week && { heading: g.week.heading, intro: md(g.week.intro) },
  thisWeek: g.thisWeek.map(({ text, ...e }) => ({ ...e, html: md(text) })),
});
