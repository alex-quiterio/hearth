import { dashboard } from "../src/app/dashboard";
import { fsVault } from "../src/vault/vault";
import { everyone } from "../src/kin/kin-map";
import { loadKinMap } from "../src/kin/kin-map-repository";

/** The dashboard over a vault folder, with no Beeper: tests never read this Mac's real index. */
export const state = (root: string, today?: string) => dashboard(fsVault(root), today, () => []);

/** Everyone on a vault folder's kin map. */
export const kinPeople = async (root: string) => everyone(await loadKinMap(fsVault(root)));
