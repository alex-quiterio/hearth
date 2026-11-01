import { PATHS } from "../vault/layout";
import type { Vault } from "../vault/vault";
import { parseKinMap, type KinMap } from "./kin-map";

export async function loadKinMap(vault: Vault): Promise<KinMap | null> {
  const note = await vault.note(PATHS.kinMap);
  return note ? parseKinMap(note) : null;
}
