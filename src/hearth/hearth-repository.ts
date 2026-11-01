import { PATHS } from "../vault/layout";
import type { Vault } from "../vault/vault";
import { parseHearthConfig } from "./hearth-config";

export const loadHearthConfig = async (vault: Vault) => parseHearthConfig(await vault.note(PATHS.hearth), PATHS.hearth);
