import { join } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { parseNote, type Note } from "../shared/note";

// The vault is the single source of truth. Hearth reads it; skills write it.
// This port is the only way the domain sees it. Writing is a separate, narrower port,
// and only the tending log gets one (marking someone tended is the one thing Hearth writes).

export interface Vault {
  /** The vault's folder on disk, for the agent and for links dragged in from Obsidian. */
  readonly root: string;
  /** A note parsed into frontmatter and body, or null when there is none. */
  note(rel: string): Promise<Note | null>;
  /** A file's raw text, or null when there is none. */
  text(rel: string): Promise<string | null>;
  /** File names in a folder that match, or [] when the folder is missing. */
  files(dir: string, match?: RegExp): Promise<string[]>;
  mtime(rel: string): Promise<number>;
}

export interface WritableVault extends Vault {
  write(rel: string, text: string): Promise<void>;
}

export function fsVault(root: string): WritableVault {
  const at = (rel: string) => join(root, rel);
  return {
    root,
    async note(rel) {
      const f = Bun.file(at(rel));
      if (!(await f.exists())) return null;
      return parseNote(await f.text(), (await f.stat()).mtimeMs);
    },
    async text(rel) {
      const f = Bun.file(at(rel));
      return (await f.exists()) ? f.text() : null;
    },
    async files(dir, match) {
      try {
        const names = await readdir(at(dir));
        return match ? names.filter((n) => match.test(n)) : names;
      } catch {
        return [];
      }
    },
    async mtime(rel) {
      return (await stat(at(rel))).mtimeMs;
    },
    async write(rel, text) {
      await Bun.write(at(rel), text);
    },
  };
}

/** The newest change in any of these folders, in ms. */
export async function lastChange(vault: Vault, dirs: string[]): Promise<number> {
  let latest = 0;
  for (const dir of dirs)
    for (const f of await vault.files(dir)) {
      try {
        latest = Math.max(latest, await vault.mtime(`${dir}/${f}`));
      } catch {}
    }
  return latest;
}
