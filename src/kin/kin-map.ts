import { sections, type Note } from "../shared/note";
import { parsePerson, type Person, type Ring } from "./person";

// The Kin map: the people who matter, in rings from core to new, plus the notes around them.
// Kept as markdown; the read model renders it.

export type RingOf<P> = { key: Ring; title: string; intro: string; people: P[]; extra: string };
export type Aside = { heading: string; text: string };
export type KinMap = {
  updated: unknown;
  mtime: number;
  intro: string;
  rings: RingOf<Person>[];
  weakPoints: Aside | null;
  other: Aside[];
};

// A ring heading reads "<emoji> <Ring> (<gloss>)"; match on the first word only, so
// "Drifting (was close…)" stays Drifting and "New ground" is not the New ring.
const RING_HEADINGS: { key: Ring; match: RegExp }[] = [
  { key: "core", match: /^core$/i },
  { key: "close", match: /^close$/i },
  { key: "warm", match: /^warm$/i },
  { key: "drifting", match: /^drifting$/i },
  { key: "new", match: /^new$/i },
];

const ringWord = (heading: string) => heading.replace(/\(.*?\)/g, "").replace(/^[^\p{L}]+/u, "").trim();

export function parseKinMap(note: Note): KinMap {
  const map: KinMap = { updated: note.frontmatter.updated ?? null, mtime: note.mtime, intro: "", rings: [], weakPoints: null, other: [] };
  for (const s of sections(note.body)) {
    if (!s.heading) {
      map.intro = s.text.replace(/^# .+\n?/, "").trim();
      continue;
    }
    const ring = RING_HEADINGS.find((r) => r.match.test(ringWord(s.heading)));
    if (ring) {
      const people: Person[] = [];
      const intro: string[] = [];
      const extra: string[] = [];
      for (const l of s.text.split("\n")) {
        if (/^- /.test(l)) people.push(parsePerson(l.slice(2), ring.key));
        else (people.length === 0 ? intro : extra).push(l);
      }
      map.rings.push({ key: ring.key, title: s.heading, intro: intro.join("\n"), people, extra: extra.join("\n") });
    } else if (/weak point/i.test(s.heading)) map.weakPoints = { heading: s.heading, text: s.text };
    else map.other.push({ heading: s.heading, text: s.text });
  }
  return map;
}

/** Everyone on the map, ring by ring. */
export const everyone = (map: KinMap | null): Person[] => (map ? map.rings.flatMap((r) => r.people) : []);

/** The people keeping a woe, and its rhythm. */
export const woes = (people: Person[]) => people.filter((p) => p.woe != null).map((p) => ({ name: p.name, rhythm: p.woe, place: p.place }));
