import { config } from "../config";

// Presentation only: the domain keeps markdown, the read model renders it at the edge.

export type Html = string;

/** Markdown to HTML, with [[wiki links]] opening the note in Obsidian. */
export function md(src: string, vaultName = config.vault.name): Html {
  if (!src.trim()) return "";
  const linked = src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, label?: string) => {
    const url = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(target)}`;
    return `[${label ?? target}](${url})`;
  });
  return Bun.markdown.html(linked);
}
