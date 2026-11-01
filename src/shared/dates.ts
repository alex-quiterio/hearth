// Calendar days as YYYY-MM-DD strings, the way the vault writes them.

export type IsoDate = string;

export const DAY_MS = 86_400_000;

/** A Date as YYYY-MM-DD in local time. */
export const iso = (d: Date): IsoDate => d.toLocaleDateString("sv-SE");

export const today = (): IsoDate => iso(new Date());

/** Whole days from one date to another, rounded. */
export const daysBetween = (from: IsoDate, to: IsoDate) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** A date n days on (UTC arithmetic, so no daylight saving drift). */
export const addDays = (date: IsoDate, n: number): IsoDate => new Date(Date.parse(date) + n * DAY_MS).toISOString().slice(0, 10);

/** A YAML date, which may arrive as a string or a Date. */
export const dateOf = (v: unknown): IsoDate | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = typeof v === "string" ? v.match(/^\d{4}-\d{2}-\d{2}/) : null;
  return m ? m[0] : null;
};

/** The first YYYY-MM-DD in a text, or null. */
export const firstDate = (text: string): IsoDate | null => text.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;

export function isoWeek(date: IsoDate): string {
  const d = new Date(date + "T12:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
