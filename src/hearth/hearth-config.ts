import { sectionText, type Note } from "../shared/note";

// Hearth.md: the dashboard's own configuration, kept in the vault and edited by the skills
// (kin:hearth, the kin skills, jung-therapist), never by Hearth.

export type Pin = { name: string; why?: string };
export type Watch = { name: string; why?: string; until?: string };
export type NowItem = { what: string; why?: string; run?: string; until?: string };
export type Action = { label: string; prompt: string; hint?: string };

export type HearthConfig = {
  exists: boolean;
  path: string;
  error: string | null;
  pinned: Pin[];
  watch: Watch[];
  now: NowItem[];
  actions: Action[];
  panels: string[];
  servers: string[];
  innerVeiled: boolean;
  /** `## Changes`, as markdown. */
  changesRaw: string;
};

export const DEFAULT_PANELS = ["focus", "thinking", "weak-points", "rings", "tending", "inner"];

/** `servers:` in order of preference: bare hosts or URLs, each made an https origin. */
export function servers(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const out: string[] = [];
  for (const s of list) {
    try {
      const host = String(s).trim();
      const origin = new URL(/^https?:\/\//.test(host) ? host : `https://${host}`).origin;
      if (!out.includes(origin)) out.push(origin);
    } catch {}
  }
  return out;
}

export function parseHearthConfig(note: Note | null, path: string): HearthConfig {
  const fm = note?.frontmatter ?? {};
  return {
    exists: !!note,
    path,
    error: fm._error ?? null,
    pinned: fm.pinned ?? [],
    watch: fm.watch ?? [],
    now: fm.now ?? [],
    actions: fm.actions ?? [],
    panels: fm.panels ?? DEFAULT_PANELS,
    servers: servers(fm.servers),
    innerVeiled: fm.inner?.veiled ?? true,
    changesRaw: sectionText(note, /^changes/i),
  };
}
