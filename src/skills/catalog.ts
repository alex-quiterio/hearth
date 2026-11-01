import { join } from "node:path";
import { readdir } from "node:fs/promises";

import { config } from "../config";
import { frontmatterOf } from "../shared/note";

// The skill catalog: every buchecha skill, read from the plugin checkout, grouped by plugin. It is the main menu.

export const PLUGINS_DIR = config.pluginsDir;

// Group order and icons: the inner screen's plugins first, then as in the buchecha README. Unknown plugins follow, alphabetically.
const GROUPS: Record<string, string> = {
  "inner-work": "🕯️",
  thinking: "🧠",
  kin: "🫂",
  homestead: "🌾",
  craft: "🛠️",
  writing: "✍️",
  beeper: "📬",
  readings: "🔮",
};

export type MenuItem = { command: string; name: string; hint: string };
export type MenuGroup = { plugin: string; icon: string; items: MenuItem[] };

/** The first sentence of a skill description, short enough for one line. */
export function hint(description: string): string {
  const first = description.replace(/\s+/g, " ").trim().match(/^.*?[.!?](?=\s|$)/)?.[0] ?? description.trim();
  return first.length > 140 ? `${first.slice(0, 139).trimEnd()}…` : first;
}

export async function menu(dir = PLUGINS_DIR): Promise<MenuGroup[]> {
  let plugins: string[] = [];
  try {
    plugins = await readdir(dir);
  } catch {
    return [];
  }
  const groups = await Promise.all(
    plugins.map(async (plugin) => {
      let skills: string[] = [];
      try {
        skills = await readdir(join(dir, plugin, "skills"));
      } catch {
        return null;
      }
      const items = (
        await Promise.all(
          skills.map(async (skill) => {
            const f = Bun.file(join(dir, plugin, "skills", skill, "SKILL.md"));
            if (!(await f.exists())) return null;
            const fm = frontmatterOf(await f.text());
            const name = String(fm.name ?? skill);
            return { command: `/${plugin}:${name}`, name: name.replace(/-/g, " "), hint: hint(String(fm.description ?? "")) };
          }),
        )
      )
        .filter((i): i is MenuItem => !!i)
        .sort((a, b) => a.name.localeCompare(b.name));
      return items.length ? { plugin, icon: GROUPS[plugin] ?? "✦", items } : null;
    }),
  );
  const order = Object.keys(GROUPS);
  const rank = (p: string) => (order.includes(p) ? order.indexOf(p) : order.length);
  return groups
    .filter((g): g is MenuGroup => !!g)
    .sort((a, b) => rank(a.plugin) - rank(b.plugin) || a.plugin.localeCompare(b.plugin));
}
