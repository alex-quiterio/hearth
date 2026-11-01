import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Every setting Hearth reads from the environment, in one place. Nothing else reads process.env,
// except the Beeper switch, which is checked per call so installing Beeper turns the Talk screen on.

const env = process.env;

export const config = {
  vault: {
    /** An explicit vault path; unset, the vault is found by name in Obsidian's own config. */
    path: env.HEARTH_VAULT ?? null,
    name: env.HEARTH_VAULT_NAME ?? "pandora",
    // Vault folders, set per machine. Note names inside them are fixed by the skills that write them.
    dirs: {
      kin: env.HEARTH_KIN_DIR ?? "4 - Archive/kin",
      conversations: env.HEARTH_CONVERSATIONS_DIR ?? "4 - Archive/conversations",
      practice: env.HEARTH_PRACTICE_DIR ?? "4 - Archive/practice",
      projects: env.HEARTH_PROJECTS_DIR ?? "4 - Archive/projects",
      rough: env.HEARTH_ROUGH_DIR ?? "1 - Rough Notes",
    },
  },
  server: {
    port: Number(env.HEARTH_PORT ?? 4747),
    /** Seconds of no input before ⏱ Auto-lock locks the page. */
    lockAfter: Number(env.HEARTH_LOCK_AFTER ?? 30),
  },
  beeper: {
    db: env.HEARTH_BEEPER_DB ?? join(homedir(), "Library/Application Support/BeeperTexts/index.db"),
    enabled: () => process.env.HEARTH_BEEPER !== "off",
  },
  pluginsDir: env.HEARTH_PLUGINS_DIR ?? join(homedir(), "code/alex-quiterio/buchecha/plugins"),
  authFile: env.HEARTH_AUTH_FILE ?? join(homedir(), ".config/hearth/auth.json"),
  /** Read when first asked, so a test can point it elsewhere before it loads the attachments. */
  get attachDir() {
    return env.HEARTH_ATTACH_DIR ?? join(tmpdir(), "hearth-attachments");
  },
};
