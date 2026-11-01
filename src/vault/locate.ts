import { homedir } from "node:os";
import { join, basename } from "node:path";
import { config } from "../config";

/** The vault's folder: HEARTH_VAULT, or the vault with this name in Obsidian's own config. */
export async function findVault(name = config.vault.name): Promise<string> {
  if (config.vault.path) return config.vault.path;
  const cfg = join(homedir(), "Library/Application Support/obsidian/obsidian.json");
  const { vaults } = await Bun.file(cfg).json();
  const hit = Object.values(vaults as Record<string, { path: string }>).find((v) => basename(v.path) === name);
  if (!hit) throw new Error(`No Obsidian vault named ${name} in ${cfg}`);
  return hit.path;
}
