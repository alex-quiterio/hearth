import { basename } from "node:path";
import { config } from "../config";

// Where each note lives in the vault. Folders come from config; note names are fixed by the skills that write them.

const DIRS = config.vault.dirs;

export const PATHS = {
  kinDir: DIRS.kin,
  kinMap: `${DIRS.kin}/Kin map.md`,
  tendingLog: `${DIRS.kin}/Tending log.md`,
  hearth: `${DIRS.kin}/Hearth.md`,
  psychology: `${DIRS.kin}/Own psychology.md`,
  territory: `${DIRS.kin}/Own territory.md`,
  conversations: DIRS.conversations,
  proprioception: `${DIRS.kin}/Proprioception log.md`,
  coordination: `${DIRS.projects}/Coordination partner.md`,
  projectsDir: DIRS.projects,
  practiceDir: DIRS.practice,
  practiceLog: `${DIRS.practice}/Emergent practice.md`,
  spells: `${DIRS.practice}/Spells.md`,
  roughNotes: DIRS.rough,
};

/** The folders whose changes refresh the page. */
export const WATCHED = [PATHS.kinDir, PATHS.conversations, PATHS.practiceDir];

/** A note's name as Obsidian shows it: the file name without .md. */
export const noteName = (rel: string) => basename(rel).replace(/\.md$/, "");
