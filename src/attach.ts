import { tmpdir } from "node:os";
import { join, resolve, extname, sep } from "node:path";
import { mkdir, readdir, stat, rm } from "node:fs/promises";

// Files dropped into the chat. The browser never reveals a file's path, so the page uploads the
// bytes and Claude reads the copy here. Outside the repo, and swept after a day.

export const ATTACH_DIR = process.env.HEARTH_ATTACH_DIR ?? join(tmpdir(), "hearth-attachments");
const MAX_BYTES = 50 * 1024 * 1024;
const KEEP_MS = 24 * 3600 * 1000;

export type Attachment = { name: string; path: string };

export async function saveAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is over 50 MB`);
  await mkdir(ATTACH_DIR, { recursive: true });
  const name = file.name || "pasted";
  const safe = name.normalize("NFC").replace(/[^\p{L}\p{N}._ -]+/gu, "_").replace(/^[._]+/, "").slice(-120) || "file";
  const path = join(ATTACH_DIR, `${crypto.randomUUID().slice(0, 8)}-${safe}`);
  await Bun.write(path, file);
  return { name, path };
}

/** An obsidian://open link dragged from Obsidian, as a path inside the vault. Read in place, never copied. */
export async function vaultFile(uri: string, vault: string, vaultName: string): Promise<Attachment | null> {
  let u: URL;
  try { u = new URL(uri.trim()); } catch { return null; }
  if (u.protocol !== "obsidian:" || u.searchParams.get("vault") !== vaultName) return null;
  const file = u.searchParams.get("file");
  if (!file) return null;
  const root = resolve(vault);
  for (const rel of extname(file) ? [file] : [`${file}.md`, file]) {
    const path = resolve(root, rel.normalize("NFC"));
    if (!path.startsWith(root + sep)) return null;
    if (await Bun.file(path).exists()) return { name: rel.split("/").pop()!, path };
  }
  return null;
}

export async function sweepAttachments(now = Date.now()) {
  let names: string[];
  try { names = await readdir(ATTACH_DIR); } catch { return; }
  for (const n of names) {
    const p = join(ATTACH_DIR, n);
    try { if (now - (await stat(p)).mtimeMs > KEEP_MS) await rm(p, { force: true }); } catch {}
  }
}
