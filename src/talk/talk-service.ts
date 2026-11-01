import { DAY_MS } from "../shared/dates";
import type { KinIdentity } from "../kin/person";
import { BEEPER_DB, BeeperIndex } from "./beeper-index";
import { collectUnread, countTalkers, findShifts, measureRhythms, MONTH_MS, RHYTHM_DAYS, type RhythmsFound, type ShiftsFound, type Talker, type Unread } from "./talk";

// Application service for the Talk screen: open the index, read, let the domain make sense of it.
// Read fresh on every call, so the screen is as current as Beeper is.

export { beeperOn } from "./beeper-index";

export type Failed = { error: string };
export type Talk = { days: number; at: number; people: Talker[] } | Failed;
export type Shifts = ShiftsFound | Failed;
export type Unreads = { at: number; chats: Unread[] } | Failed;
export type Rhythms = RhythmsFound | Failed;

function reading<T>(file: string, read: (ix: BeeperIndex) => T): T | Failed {
  let ix: BeeperIndex;
  try {
    ix = BeeperIndex.open(file);
  } catch (e) {
    return { error: `Beeper's index is not readable at ${file}: ${(e as Error).message}` };
  }
  try {
    return read(ix);
  } catch (e) {
    return { error: `Beeper's index changed shape: ${(e as Error).message}` };
  } finally {
    ix.close();
  }
}

export const talk = (days: number, file = BEEPER_DB, now = Date.now()): Talk =>
  reading(file, (ix) => ({ days, at: now, people: countTalkers(ix.counts(now - days * DAY_MS)) }));

// The shift counts look back four months; last contact looks back a year, so slow kin still show a date.
export const shifts = (kin: KinIdentity[] = [], file = BEEPER_DB, now = Date.now()): Shifts =>
  reading(file, (ix) => findShifts(ix.shifts(now - MONTH_MS, now - 4 * MONTH_MS, now - 12 * MONTH_MS), kin, now));

export const unread = (kin: KinIdentity[] = [], file = BEEPER_DB, now = Date.now()): Unreads =>
  reading(file, (ix) => ({ at: now, chats: collectUnread(ix.unreadRooms(), (room, readTo) => ix.unreadLines(room, readTo), kin) }));

export const rhythms = (kin: KinIdentity[] = [], file = BEEPER_DB, now = Date.now()): Rhythms =>
  reading(file, (ix) => measureRhythms(ix.timestamps(now - RHYTHM_DAYS * DAY_MS), kin, now));
