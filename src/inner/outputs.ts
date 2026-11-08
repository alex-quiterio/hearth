// What the thinking skills leave behind: notes in Rough Notes, and in projects the monthly crossing pages and the maker log.

export type Output = { name: string; kind: string; mtime: number };

/** The kinds of note a thinking skill leaves in Rough Notes, by file name. */
export const ROUGH_OUTPUT = /^(Emergent|Visionary fiction|Work rhythm|Climate geopolitics brief|Crossing) .*\.md$/;
/** The monthly crossing pages, and the maker log and its learnings, kept with the projects. */
export const PROJECT_OUTPUT = /^(Crossing(?= \d{4}-\d{2}\.md$)|Code making|Maker learnings)(?: \d{4}-\d{2})?\.md$/;

export const latestOutputs = (xs: Output[], n = 8) => [...xs].sort((a, b) => b.mtime - a.mtime).slice(0, n);
