// What the thinking skills leave behind: notes in Rough Notes, and the monthly crossing pages kept in projects.

export type Output = { name: string; kind: string; mtime: number };

/** The kinds of note a thinking skill leaves in Rough Notes, by file name. */
export const ROUGH_OUTPUT = /^(Emergent|Visionary fiction|Work rhythm|Climate geopolitics brief|Crossing) .*\.md$/;
/** The monthly crossing pages kept with the projects. */
export const PROJECT_OUTPUT = /^(Crossing) \d{4}-\d{2}\.md$/;

export const latestOutputs = (xs: Output[], n = 8) => [...xs].sort((a, b) => b.mtime - a.mtime).slice(0, n);
