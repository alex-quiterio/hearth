import { PATHS } from "../vault/layout";
import type { Vault, WritableVault } from "../vault/vault";
import { emptyLog, parseTending, type TendingBlock } from "./tending-log";

export const loadTendingText = async (vault: Vault) => (await vault.text(PATHS.tendingLog)) ?? "";

export const loadTendingBlocks = async (vault: Vault): Promise<TendingBlock[]> => parseTending(await loadTendingText(vault));

/** The log's text to change, a fresh one when there is none yet. */
export const openTendingLog = async (vault: Vault, today: string) => (await vault.text(PATHS.tendingLog)) ?? emptyLog(today);

export const saveTendingLog = (vault: WritableVault, text: string) => vault.write(PATHS.tendingLog, text);
