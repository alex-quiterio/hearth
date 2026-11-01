import { today as todayIs } from "../shared/dates";
import type { WritableVault } from "../vault/vault";
import type { Person } from "../kin/person";
import { recordTended } from "../tending/tending-log";
import { openTendingLog, saveTendingLog } from "../tending/tending-repository";
import { findPerson } from "./dashboard";

// Command: mark someone tended today. The one thing Hearth writes, into the Tending log kin:tend already reads.

export async function waterPlant(vault: WritableVault, person: Pick<Person, "name" | "linked">, note = "", today = todayIs()) {
  await saveTendingLog(vault, recordTended(await openTendingLog(vault, today), person, note, today));
}

/** By name, as the page sends it: false when they are not on the kin map. */
export async function tend(vault: WritableVault, name: string, note = ""): Promise<boolean> {
  const person = await findPerson(vault, name);
  if (!person) return false;
  await waterPlant(vault, person, note);
  return true;
}
