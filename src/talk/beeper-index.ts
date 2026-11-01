import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { config } from "../config";

// Adapter: Beeper Desktop's local index, opened read only. Direct chats only; reactions,
// membership and hidden events do not count as talking. It runs the queries and nothing else:
// what the rows mean is the talk domain's.

export const BEEPER_DB = config.beeper.db;

/** The Talk screen is on when Beeper's index is on this machine, unless HEARTH_BEEPER=off. Checked per call, so installing Beeper turns it on. */
export const beeperOn = (file = BEEPER_DB) => config.beeper.enabled() && existsSync(file);

/** Message types that count as someone talking. */
export const SPOKEN = ["TEXT", "IMAGE", "VOICE", "AUDIO", "VIDEO", "FILE", "STICKER", "LOCATION", "POLL"];

export type CountRow = { room: string; account: string; name: string | null; sent: number; n: number; last: number };
export type ShiftRow = { account: string; name: string | null; recent: number; prior: number; lastSent: number | null; lastReceived: number | null };
export type UnreadRoomRow = { room: string; account: string; name: string | null; count: number | null; readTo: number | null; at: number | null };
export type UnreadLineRow = { at: number; type: string; text: string | null; reaction: string | null };
export type TimestampRow = { room: string; name: string | null; at: number; me: number };

// The other person in a direct chat: not Alex, not a network bridge bot.
const OTHER = (room: string) => `(select coalesce(nullif(p.full_name, ''), p.nickname) from participants p
  where p.room_id = ${room} and coalesce(p.is_self, 0) = 0 and coalesce(p.is_network_bot, 0) = 0 limit 1)`;
const SINGLE = `json_extract(t.thread, '$.type') = 'single'`;
const marks = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `?${i + from}`).join(",");

export class BeeperIndex {
  private constructor(private db: Database) {}

  /** Throws when the file is not a readable index. */
  static open(file = BEEPER_DB) {
    return new BeeperIndex(new Database(file, { readonly: true }));
  }

  close() {
    this.db.close();
  }

  /** Per direct chat since a time: messages, how many Alex sent, and the latest. */
  counts(since: number): CountRow[] {
    return this.db
      .query(
        `select m.roomID room, t.accountID account, ${OTHER("m.roomID")} name,
           sum(m.isSentByMe) sent, count(*) n, max(m.timestamp) last
         from mx_room_messages m join threads t on t.threadID = m.roomID
         where ${SINGLE} and m.timestamp > ?1 and m.isDeleted = 0 and m.type in (${marks(SPOKEN.length, 2)})
         group by m.roomID`,
      )
      .all(since, ...SPOKEN) as CountRow[];
  }

  /** Per direct chat: messages after `recentFrom`, between `priorFrom` and it, and each side's last message after `lastFrom`. */
  shifts(recentFrom: number, priorFrom: number, lastFrom: number): ShiftRow[] {
    return this.db
      .query(
        `select t.accountID account, ${OTHER("m.roomID")} name,
           sum(m.timestamp > ?1) recent, sum(m.timestamp <= ?1 and m.timestamp > ?2) prior,
           max(case when m.isSentByMe = 1 then m.timestamp end) lastSent,
           max(case when m.isSentByMe = 0 then m.timestamp end) lastReceived
         from mx_room_messages m join threads t on t.threadID = m.roomID
         where ${SINGLE} and m.timestamp > ?3 and m.isDeleted = 0 and m.type in (${marks(SPOKEN.length, 4)})
         group by m.roomID`,
      )
      .all(recentFrom, priorFrom, lastFrom, ...SPOKEN) as ShiftRow[];
  }

  /** Direct chats Beeper counts as unread, or that were marked unread by hand. */
  unreadRooms(): UnreadRoomRow[] {
    return this.db
      .query(
        `select t.threadID room, t.accountID account, ${OTHER("t.threadID")} name,
           json_extract(t.thread, '$.unreadCount') count, json_extract(t.thread, '$.lastReadMessageSortKey') readTo, t.timestamp at
         from threads t
         where ${SINGLE} and (json_extract(t.thread, '$.unreadCount') > 0 or json_extract(t.thread, '$.isMarkedUnread') = 1)`,
      )
      .all() as UnreadRoomRow[];
  }

  /** Their newest lines and reactions after Alex's read marker, newest first. */
  unreadLines(room: string, readTo: number): UnreadLineRow[] {
    return this.db
      .query(
        `select timestamp at, type, text_content text, json_extract(message, '$.action.reactionKey') reaction
         from mx_room_messages
         where roomID = ?1 and isSentByMe = 0 and isDeleted = 0 and hsOrder > ?2 and type in (${marks(SPOKEN.length + 1, 3)})
         order by hsOrder desc limit 40`,
      )
      .all(room, readTo, ...SPOKEN, "REACTION") as UnreadLineRow[];
  }

  /** Every message's time and side since a time, chat by chat in order. */
  timestamps(since: number): TimestampRow[] {
    return this.db
      .query(
        `select m.roomID room, ${OTHER("m.roomID")} name, m.timestamp at, m.isSentByMe me
         from mx_room_messages m join threads t on t.threadID = m.roomID
         where ${SINGLE} and m.timestamp > ?1 and m.isDeleted = 0 and m.type in (${marks(SPOKEN.length, 2)})
         order by m.roomID, m.timestamp`,
      )
      .all(since, ...SPOKEN) as TimestampRow[];
  }
}
