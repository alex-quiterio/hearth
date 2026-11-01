import type { Ring } from "../kin/person";

// Thirst: days since Alex last tended someone, over how often their bed wants water.
// It describes his care, never the person: no scores, no ranking of friends.

export type Thirst = "fresh" | "ok" | "thirsty" | "wilting" | "unknown";

/** Days between waterings, by ring, unless the kin map line says "every …". */
export const INTERVAL: Record<Ring, number> = { core: 7, close: 14, warm: 30, new: 10, drifting: 45 };
/** Days their message can wait for an answer, by ring, unless the line says "reply within …". */
export const REPLY_WITHIN: Record<Ring, number> = { core: 1, close: 5, warm: 7, new: 5, drifting: 7 };

const RANK: Thirst[] = ["unknown", "fresh", "ok", "thirsty", "wilting"];

export const worse = (a: Thirst, b: Thirst) => (RANK.indexOf(a) >= RANK.indexOf(b) ? a : b);

export function thirstOf(daysSince: number | null, interval: number): Thirst {
  if (daysSince === null) return "unknown";
  const r = daysSince / interval;
  return r < 0.5 ? "fresh" : r <= 1 ? "ok" : r <= 2 ? "thirsty" : "wilting";
}
