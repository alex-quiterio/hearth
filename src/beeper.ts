import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Who Alex talks to, counted from Beeper Desktop's local index. Read only, counts and
// timestamps only: no message text leaves the database. Direct chats only; reactions,
// membership and hidden events do not count as talking.

export const BEEPER_DB = process.env.HEARTH_BEEPER_DB ?? join(homedir(), "Library/Application Support/BeeperTexts/index.db");

/** The Talk screen is on when Beeper's index is on this machine, unless HEARTH_BEEPER=off. Checked per call, so installing Beeper turns it on. */
export const beeperOn = (file = BEEPER_DB) => process.env.HEARTH_BEEPER !== "off" && existsSync(file);

const SPOKEN = ["TEXT", "IMAGE", "VOICE", "AUDIO", "VIDEO", "FILE", "STICKER", "LOCATION", "POLL"];
const NETWORK: Record<string, string> = { instagramgo: "instagram" };

export type Talker = { name: string; nets: string[]; sent: number; received: number; total: number; last: number };
export type Talk = { days: number; at: number; people: Talker[] } | { error: string };

type Row = { room: string; account: string; name: string | null; sent: number; n: number; last: number };

// One person on several networks (the same name on Signal and WhatsApp) is one person.
const key = (name: string) =>
  name.normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim().toLowerCase() || name;

export function talk(days: number, file = BEEPER_DB, now = Date.now()): Talk {
  let db: Database;
  try {
    db = new Database(file, { readonly: true });
  } catch (e) {
    return { error: `Beeper's index is not readable at ${file}: ${(e as Error).message}` };
  }
  try {
    const rows = db
      .query(
        `select m.roomID room, t.accountID account,
           (select coalesce(nullif(p.full_name, ''), p.nickname) from participants p
             where p.room_id = m.roomID and coalesce(p.is_self, 0) = 0 and coalesce(p.is_network_bot, 0) = 0 limit 1) name,
           sum(m.isSentByMe) sent, count(*) n, max(m.timestamp) last
         from mx_room_messages m join threads t on t.threadID = m.roomID
         where json_extract(t.thread, '$.type') = 'single' and m.timestamp > ? and m.isDeleted = 0
           and m.type in (${SPOKEN.map(() => "?").join(",")})
         group by m.roomID`,
      )
      .all(now - days * 86_400_000, ...SPOKEN) as Row[];
    const people = new Map<string, Talker>();
    for (const r of rows) {
      if (!r.name) continue;
      const net = r.account.split(".")[0]!;
      const p = people.get(key(r.name)) ?? { name: r.name, nets: [], sent: 0, received: 0, total: 0, last: 0 };
      if (!p.nets.includes(NETWORK[net] ?? net)) p.nets.push(NETWORK[net] ?? net);
      p.sent += r.sent;
      p.received += r.n - r.sent;
      p.total += r.n;
      p.last = Math.max(p.last, r.last);
      people.set(key(r.name), p);
    }
    return { days, at: now, people: [...people.values()].sort((a, b) => b.total - a.total) };
  } catch (e) {
    return { error: `Beeper's index changed shape: ${(e as Error).message}` };
  } finally {
    db.close();
  }
}
